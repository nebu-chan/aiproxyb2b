import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, IMP_TOKEN_KEY } from '../api/client';
import { orgApi } from '../api/org';
import { Layout } from '../components/Layout';
import { useAuth } from '../hooks/useAuth';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;   // reasoning chain from <think>…</think> (reasoning models)
  images?: string[];   // base64 data URLs attached to user messages
  error?: boolean;
}

/** Parse raw streamed content into thinking chain + answer. */
function parseThinking(raw: string): { thinking: string; answer: string } {
  // Completed <think>…</think> block
  const done = raw.match(/^<think>([\s\S]*?)<\/think>([\s\S]*)$/);
  if (done) return { thinking: done[1].trim(), answer: done[2] };
  // Still inside the think block
  if (raw.startsWith('<think>')) return { thinking: raw.slice('<think>'.length), answer: '' };
  return { thinking: '', answer: raw };
}

/** Collapsible thinking section shown above the actual answer. */
function ThinkingBlock({ content }: { content: string }) {
  const { t } = useTranslation('pages');
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-2 text-xs">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-gray-400 hover:text-gray-600 transition-colors font-medium select-none"
      >
        <span className={`transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
        {t('chat.thinking')}
      </button>
      {open && (
        <pre className="mt-1.5 p-2.5 bg-gray-50 border border-gray-200 rounded-lg whitespace-pre-wrap font-mono text-[11px] text-gray-500 leading-relaxed max-h-64 overflow-y-auto">
          {content}
        </pre>
      )}
    </div>
  );
}

interface Conversation {
  id: string;
  title: string;
  model: string;
  createdAt: string;
  messages: Message[];
}

interface AiMediatorModel {
  id: string;
}

function convKey(userId: string) {
  return `ai_mediator_conversations_${userId}`;
}

function friendlyError(t: (key: string) => string, responseData: any, fallback?: string): string {
  const err = responseData?.error;
  if (err?.type === 'insufficient_funds' || err?.code === '402') {
    return t('chat.errors.insufficientBalance');
  }
  if (typeof err === 'string') return err;
  if (err?.message) return String(err.message);
  if (responseData?.message) return String(responseData.message);
  if (typeof responseData === 'string' && responseData) return responseData;
  return fallback ?? t('chat.errors.requestFailed');
}

function loadConversations(userId: string): Conversation[] {
  try { return JSON.parse(localStorage.getItem(convKey(userId)) ?? '[]'); }
  catch { return []; }
}

function saveConversations(convs: Conversation[], userId: string) {
  // Strip image data before persisting — base64 images are too large for localStorage
  const stripped = convs.map((c) => ({
    ...c,
    messages: c.messages.map((m) => m.images?.length ? { ...m, images: undefined } : m),
  }));
  try {
    localStorage.setItem(convKey(userId), JSON.stringify(stripped));
  } catch {
    // Quota exceeded — silently skip, in-memory state is still intact
  }
}

function makeTitle(text: string, hasImages: boolean, imageFallbackLabel: string) {
  if (!text.trim() && hasImages) return imageFallbackLabel;
  const clean = text.trim().replace(/\s+/g, ' ');
  return clean.length > 44 ? clean.slice(0, 44) + '…' : clean;
}

type ConversationGroupKey = 'today' | 'yesterday' | 'last7Days' | 'older';

function groupConversations(convs: Conversation[]) {
  const now = new Date();
  const todayStart     = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86_400_000;
  const weekStart      = todayStart - 7 * 86_400_000;

  const groups: { key: ConversationGroupKey; items: Conversation[] }[] = [
    { key: 'today',      items: [] },
    { key: 'yesterday',  items: [] },
    { key: 'last7Days',  items: [] },
    { key: 'older',      items: [] },
  ];

  for (const conv of convs) {
    const t = new Date(conv.createdAt).getTime();
    if      (t >= todayStart)     groups[0].items.push(conv);
    else if (t >= yesterdayStart) groups[1].items.push(conv);
    else if (t >= weekStart)      groups[2].items.push(conv);
    else                          groups[3].items.push(conv);
  }

  return groups.filter((g) => g.items.length > 0);
}

function resizeImage(file: File, maxPx = 1024, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

function buildApiContent(msg: Message) {
  if (!msg.images?.length) return msg.content;
  return [
    ...(msg.content ? [{ type: 'text', text: msg.content }] : []),
    ...msg.images.map((url) => ({ type: 'image_url', image_url: { url } })),
  ];
}

export function Chat() {
  const { t, i18n } = useTranslation(['pages', 'common']);
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const userId = user?.id ?? '';
  const [conversations, setConversations] = useState<Conversation[]>(() =>
    userId ? loadConversations(userId) : [],
  );
  const [activeId,       setActiveId]       = useState<string | null>(null);
  const [model,          setModel]          = useState('');
  const [messages,       setMessages]       = useState<Message[]>([]);
  const [input,          setInput]          = useState('');
  const [isLoading,      setIsLoading]      = useState(false);
  const [attachedImages, setAttachedImages] = useState<string[]>([]);
  const [isDragging,     setIsDragging]     = useState(false);

  const qc          = useQueryClient();
  const bottomRef   = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  useEffect(() => {
    if (userId) setConversations(loadConversations(userId));
  }, [userId]);

  const { data: chatAccess, isLoading: chatAccessLoading } = useQuery<{ ok: boolean; reason: string | null }>({
    queryKey: ['me-chat-access'],
    queryFn: () => api.get('/org/me/chat-access').then((r) => r.data),
    staleTime: 0,
  });

  const { data: myBalance } = useQuery({
    queryKey: ['org', 'me', 'balance'],
    queryFn: orgApi.balance.me,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
  const chatReady = chatAccess?.ok === true;

  const { data: modelSettingsData } = useQuery<Record<string, { allowed: boolean; dailyTokenLimit: number | null }>>({
    queryKey: ['me-model-settings'],
    queryFn: () => api.get('/org/me/model-settings').then((r) => r.data.data),
    enabled: chatReady,
    staleTime: 5 * 60_000,
  });

  const { data: usageData, refetch: refetchUsage } = useQuery<{ data: { tokensUsedToday: number; dailyTokenLimit: number | null } }>({
    queryKey: ['me-usage', model],
    queryFn: () => api.get('/org/me/usage', { params: { model } }).then((r) => r.data),
    enabled: !!model,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const tokensUsedToday  = usageData?.data?.tokensUsedToday  ?? 0;
  const tokenLimitPerDay = usageData?.data?.dailyTokenLimit  ?? null;
  const limitExceeded    = tokenLimitPerDay !== null && tokensUsedToday >= tokenLimitPerDay;

  const { data: modelsResp, isFetching: modelsFetching, isError: modelsIsError } = useQuery<{ data: AiMediatorModel[] }>({
    queryKey: ['ai-mediator-models'],
    queryFn: async () => {
      const r = await api.post<{ data: AiMediatorModel[] }>('/org/ai-mediator/models');
      return r.data;
    },
    enabled: chatReady,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const allModelList = modelsResp?.data?.map((m) => m.id).sort() ?? [];
  const policyModelList = allModelList.filter((m) => modelSettingsData?.[m]?.allowed !== false);

  function isVisionModel(id: string) {
    return /^(gpt-|gemini-|grok-|o\d)/.test(id);
  }

  const modelList = attachedImages.length > 0
    ? policyModelList.filter(isVisionModel)
    : policyModelList;

  useEffect(() => {
    if (modelList.length > 0 && !model) setModel(modelList[0]);
  }, [modelList]);

  // When images are attached and current model doesn't support vision, switch to first vision model
  useEffect(() => {
    if (attachedImages.length > 0 && model && !isVisionModel(model)) {
      const first = policyModelList.find(isVisionModel);
      if (first) setModel(first);
    }
  }, [attachedImages.length]);

  function openConversation(conv: Conversation) {
    setActiveId(conv.id);
    setMessages(conv.messages);
    setModel(conv.model);
    setAttachedImages([]);
  }

  function newChat() {
    setActiveId(null);
    setMessages([]);
    setAttachedImages([]);
  }

  function deleteConversation(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    const updated = conversations.filter((c) => c.id !== id);
    setConversations(updated);
    saveConversations(updated, userId);
    if (activeId === id) newChat();
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
  }

  async function handleFiles(files: FileList | File[]) {
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (!imageFiles.length) return;
    const dataUrls = await Promise.all(imageFiles.map((f) => resizeImage(f)));
    setAttachedImages((prev) => [...prev, ...dataUrls]);
  }

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    dragCounterRef.current++;
    setIsDragging(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setIsDragging(false);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragging(false);
    if (e.dataTransfer.files.length) await handleFiles(e.dataTransfer.files);
  }

  async function handlePaste(e: React.ClipboardEvent) {
    const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'));
    if (files.length) {
      e.preventDefault();
      await handleFiles(files);
    }
  }

  const modelBlocked = !!model && modelSettingsData?.[model]?.allowed === false;
  const canSend = (!!input.trim() || attachedImages.length > 0) && !!model && chatReady && !isLoading && !limitExceeded && !modelBlocked;

  const sendMessage = useCallback(async () => {
    if (!canSend) return;

    const userMsg: Message = {
      role: 'user',
      content: input.trim(),
      ...(attachedImages.length ? { images: attachedImages } : {}),
    };
    const history = [...messages, userMsg];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setInput('');
    setAttachedImages([]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setIsLoading(true);

    let isError = false;
    let finalContent = '';
    let finalThinking = '';

    const baseUrl = import.meta.env.VITE_API_URL ?? '/api';
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
    const impToken = sessionStorage.getItem(IMP_TOKEN_KEY);
    if (impToken) headers['Authorization'] = `Bearer ${impToken}`;

    try {
      const resp = await fetch(`${baseUrl}/org/ai-mediator/chat`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ model, messages: history.map((m) => ({ role: m.role, content: buildApiContent(m) })) }),
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        if (errData?.error === 'token_limit_exceeded' || errData?.error === 'model_access_denied' || errData?.error === 'balance_exceeded') {
          finalContent = errData.message;
        } else {
          finalContent = friendlyError(t, errData, `HTTP ${resp.status}`);
        }
        isError = true;
      } else {
        // Stream SSE chunks
        const reader = resp.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let rawContent = '';

        setIsLoading(false);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const payload = line.slice(6).trim();
            if (payload === '[DONE]') continue;
            try {
              const parsed = JSON.parse(payload);
              const delta = parsed.choices?.[0]?.delta?.content ?? '';
              if (delta) {
                rawContent += delta;
                const { thinking, answer } = parseThinking(rawContent);
                setMessages([...history, { role: 'assistant', content: answer, thinking: thinking || undefined }]);
              }
            } catch { /* ignore malformed chunks */ }
          }
        }

        const { thinking, answer } = parseThinking(rawContent);
        finalContent = answer;
        finalThinking = thinking;
      }
    } catch (err: any) {
      finalContent = err?.message || t('chat.errors.requestFailed');
      isError = true;
    }

    const assistantMsg: Message = {
      role: 'assistant',
      content: finalContent,
      ...(finalThinking ? { thinking: finalThinking } : {}),
      ...(isError ? { error: true } : {}),
    };
    const finalMessages = [...history, assistantMsg];
    setMessages(finalMessages);
    setIsLoading(false);
    refetchUsage();

    const currentActiveId = activeId;
    setConversations((prev) => {
      let updated: Conversation[];
      if (!currentActiveId) {
        const newConv: Conversation = {
          id: crypto.randomUUID(),
          title: makeTitle(userMsg.content, !!userMsg.images?.length, t('chat.imageFallbackTitle')),
          model,
          createdAt: new Date().toISOString(),
          messages: finalMessages,
        };
        setActiveId(newConv.id);
        updated = [newConv, ...prev];
      } else {
        updated = prev.map((c) =>
          c.id === currentActiveId ? { ...c, messages: finalMessages } : c,
        );
      }
      saveConversations(updated, userId);
      return updated;
    });

    setTimeout(() => textareaRef.current?.focus(), 50);
  }, [canSend, input, attachedImages, messages, model, activeId, refetchUsage]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  const groups = groupConversations(conversations);

  return (
    <Layout>
      <div className="flex gap-3 overflow-hidden" style={{ height: 'calc(100vh - 9rem)' }}>

        {/* ── History sidebar ──────────────────────────────────────────── */}
        <div className="w-52 flex-shrink-0 bg-white rounded-xl border border-gray-200 flex flex-col overflow-hidden">
          <div className="p-3 border-b border-gray-100">
            <button
              onClick={newChat}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
            >
              <span className="text-base font-bold leading-none">+</span>
              {t('chat.newChat')}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-2 py-2 space-y-3">
            {groups.length === 0 && (
              <p className="text-xs text-gray-400 text-center mt-8 px-2">
                {t('chat.noConversations')}
              </p>
            )}
            {groups.map((group) => (
              <div key={group.key}>
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-2 mb-1">
                  {t(`chat.history.groups.${group.key}`)}
                </p>
                <div className="space-y-0.5">
                  {group.items.map((conv) => (
                    <div
                      key={conv.id}
                      onClick={() => openConversation(conv)}
                      className={`group relative flex flex-col px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                        activeId === conv.id
                          ? 'bg-brand-50 border border-brand-200'
                          : 'hover:bg-gray-100'
                      }`}
                    >
                      <span
                        className={`text-xs font-medium leading-snug truncate pr-4 ${
                          activeId === conv.id ? 'text-brand-700' : 'text-gray-700'
                        }`}
                      >
                        {conv.title}
                      </span>
                      <span className="text-[10px] text-gray-400 truncate mt-0.5">
                        {conv.model}
                      </span>
                      <button
                        onClick={(e) => deleteConversation(e, conv.id)}
                        className={`absolute right-1.5 top-1.5 text-gray-400 hover:text-red-500 transition-all rounded p-0.5 leading-none text-[11px] ${activeId === conv.id ? 'opacity-50' : 'opacity-0 group-hover:opacity-100'}`}
                        title={t('chat.deleteConversation')}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Balance indicator */}
          {myBalance && myBalance.limitRub !== null && (
            <div className={`mx-2 mb-2 px-3 py-2 rounded-lg text-xs border ${
              myBalance.spentRub >= myBalance.limitRub
                ? 'bg-red-50 border-red-200 text-red-700'
                : myBalance.spentRub >= myBalance.limitRub * 0.8
                ? 'bg-amber-50 border-amber-200 text-amber-700'
                : 'bg-gray-50 border-gray-200 text-gray-500'
            }`}>
              <div className="font-medium text-[11px] mb-1">{t('chat.monthlyBudget')}</div>
              <div className="flex justify-between items-baseline">
                <span className="font-semibold">{myBalance.spentRub.toFixed(2)} ₽</span>
                <span className="text-[10px] opacity-70">{t('chat.ofLimit', { limit: myBalance.limitRub.toFixed(2) })}</span>
              </div>
              <div className="mt-1.5 h-1 rounded-full bg-gray-200 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    myBalance.spentRub >= myBalance.limitRub ? 'bg-red-500' :
                    myBalance.spentRub >= myBalance.limitRub * 0.8 ? 'bg-amber-400' : 'bg-brand-500'
                  }`}
                  style={{ width: `${Math.min(100, (myBalance.spentRub / myBalance.limitRub) * 100).toFixed(1)}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* ── Chat area ───────────────────────────────────────────────── */}
        <div
          className={`flex-1 flex flex-col bg-white rounded-xl border transition-colors overflow-hidden min-w-0 ${
            isDragging ? 'border-brand-400 bg-brand-50' : 'border-gray-200'
          }`}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {/* Drag overlay */}
          {isDragging && (
            <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
              <div className="bg-white border-2 border-dashed border-brand-400 rounded-2xl px-10 py-8 text-brand-600 font-medium text-base shadow-lg">
                {t('chat.dropImageHere')}
              </div>
            </div>
          )}

          {/* Settings panel */}
          <div className="border-b border-gray-100 px-5 py-4">
            <div className="flex gap-4 items-end">
              {isAdmin && !chatAccessLoading && (
                <div className="flex-shrink-0 flex items-center gap-2 pb-0.5">
                  {chatReady ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-green-700 bg-green-50 border border-green-200 px-2.5 py-1 rounded-full">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                      {t('chat.keyConfigured')}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                      {t('chat.noApiKey')} —{' '}
                      <a href="/keys" className="underline underline-offset-2 hover:text-amber-900">
                        {t('chat.addOne')}
                      </a>
                    </span>
                  )}
                </div>
              )}

              <div className="flex-1 min-w-0">
                {!chatAccessLoading && !chatReady ? (
                  <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    {chatAccess?.reason === 'no_department'
                      ? t('chat.noDepartment')
                      : t('chat.noDepartmentKey')}
                    {' '}{t('chat.contactAdmin')}
                  </p>
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-gray-600">{t('chat.model')}</label>
                      {chatReady && (
                        <button
                          onClick={() => qc.invalidateQueries({ queryKey: ['ai-mediator-models'] })}
                          disabled={modelsFetching}
                          className="text-[10px] text-gray-400 hover:text-brand-600 disabled:opacity-40 transition-colors"
                          title={t('chat.refreshModelList')}
                        >
                          {modelsFetching ? t('common:loading') : t('chat.refresh')}
                        </button>
                      )}
                    </div>
                    <select
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      disabled={modelsFetching || modelsIsError || modelList.length === 0}
                      className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-gray-50 disabled:text-gray-400"
                    >
                      {modelsFetching ? (
                        <option value="">{t('chat.loadingModels')}</option>
                      ) : modelList.length === 0 ? (
                        <option value="">{t('chat.noModelsAvailable')}</option>
                      ) : (
                        modelList.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))
                      )}
                    </select>
                    {modelsIsError && (
                      <p className="mt-1 text-xs text-red-500">{t('chat.failedToLoadModels')}</p>
                    )}
                  </>
                )}
              </div>
            </div>

            {tokenLimitPerDay !== null && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                {limitExceeded ? (
                  <p className="text-xs text-red-600 font-medium">
                    {t('chat.dailyLimitReached', { limit: tokenLimitPerDay.toLocaleString(i18n.language) })}
                  </p>
                ) : (
                  <>
                    <div className="flex justify-between text-[11px] text-gray-500 mb-1">
                      <span>{t('chat.tokensUsedToday')}</span>
                      <span className={tokensUsedToday / tokenLimitPerDay >= 0.9 ? 'text-amber-600 font-medium' : ''}>
                        {tokensUsedToday.toLocaleString(i18n.language)} / {tokenLimitPerDay.toLocaleString(i18n.language)}
                      </span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          tokensUsedToday / tokenLimitPerDay >= 0.9 ? 'bg-amber-400' : 'bg-brand-500'
                        }`}
                        style={{ width: `${Math.min(100, (tokensUsedToday / tokenLimitPerDay) * 100)}%` }}
                      />
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
            {messages.length === 0 && !isLoading && (
              <div className="flex flex-col items-center justify-center h-full text-center select-none">
                {!chatAccessLoading && !chatReady ? (
                  <>
                    <div className="text-4xl mb-4">🔒</div>
                    <p className="text-gray-700 font-medium text-base">{t('chat.chatUnavailable')}</p>
                    <p className="text-gray-400 text-sm mt-1 max-w-xs">
                      {chatAccess?.reason === 'no_department'
                        ? t('chat.noDepartmentNoKey')
                        : t('chat.noDepartmentKeyLong')}
                    </p>
                  </>
                ) : (
                  <>
                    <div className="text-5xl mb-4">💬</div>
                    <p className="text-gray-600 font-medium text-base">{t('chat.startConversation')}</p>
                    <p className="text-gray-400 text-sm mt-1 max-w-xs">
                      {model ? t('chat.modelViaMediator', { model }) : t('chat.selectModelAbove')}
                    </p>
                    <p className="text-gray-400 text-xs mt-1">
                      {t('chat.dragDropHint')}
                    </p>
                  </>
                )}
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'assistant' && (
                  <div className="w-7 h-7 rounded-full bg-gray-200 flex-shrink-0 flex items-center justify-center text-xs font-medium text-gray-600 mt-0.5">
                    {t('chat.aiAvatar')}
                  </div>
                )}
                <div
                  className={`max-w-[72%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-brand-600 text-white rounded-br-sm'
                      : msg.error
                      ? 'bg-red-50 text-red-700 border border-red-200 rounded-bl-sm'
                      : 'bg-gray-100 text-gray-900 rounded-bl-sm'
                  }`}
                >
                  {msg.images && msg.images.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {msg.images.map((src, idx) => (
                        <img
                          key={idx}
                          src={src}
                          alt={t('chat.attachedImageAlt')}
                          className="max-h-48 max-w-xs rounded-lg object-cover"
                        />
                      ))}
                    </div>
                  )}
                  {msg.thinking && <ThinkingBlock content={msg.thinking} />}
                  {msg.content
                    ? <p className="whitespace-pre-wrap">{msg.content}</p>
                    : msg.role === 'assistant' && !msg.error && !msg.thinking
                    ? <span className="inline-block w-2 h-4 bg-gray-400 rounded-sm animate-pulse" />
                    : null
                  }
                </div>
                {msg.role === 'user' && (
                  <div className="w-7 h-7 rounded-full bg-brand-600 flex-shrink-0 flex items-center justify-center text-xs font-medium text-white mt-0.5">
                    {t('chat.meAvatar')}
                  </div>
                )}
              </div>
            ))}

            {isLoading && (
              <div className="flex gap-3 justify-start">
                <div className="w-7 h-7 rounded-full bg-gray-200 flex-shrink-0 flex items-center justify-center text-xs font-medium text-gray-600">
                  {t('chat.aiAvatar')}
                </div>
                <div className="bg-gray-100 rounded-2xl rounded-bl-sm px-4 py-3">
                  <div className="flex gap-1 items-center h-5">
                    {[0, 150, 300].map((delay) => (
                      <span
                        key={delay}
                        className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                        style={{ animationDelay: `${delay}ms` }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="border-t border-gray-200 p-4">
            {/* Attached image thumbnails */}
            {attachedImages.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {attachedImages.map((src, idx) => (
                  <div key={idx} className="relative group">
                    <img
                      src={src}
                      alt={t('chat.attachmentPreviewAlt')}
                      className="h-16 w-16 object-cover rounded-lg border border-gray-200"
                    />
                    <button
                      onClick={() => setAttachedImages((prev) => prev.filter((_, i) => i !== idx))}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-gray-700 text-white rounded-full text-[10px] leading-none flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2 items-end">
              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.target.value = ''; }}
              />
              {/* Attachment button */}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading}
                title={t('chat.attachImage')}
                className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-xl border border-gray-300 text-gray-500 hover:text-brand-600 hover:border-brand-300 transition-colors disabled:opacity-40"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </button>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                rows={1}
                disabled={isLoading}
                className="flex-1 border border-gray-300 rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-gray-50 disabled:text-gray-400"
                placeholder={t('chat.messagePlaceholder')}
                style={{ minHeight: '44px', maxHeight: '160px' }}
              />
              <button
                onClick={sendMessage}
                disabled={!canSend}
                className="bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white px-5 py-3 rounded-xl text-sm font-medium transition-colors flex-shrink-0"
              >
                {t('common:buttons.send')}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-2 text-center">
              {t('chat.poweredBy')}
            </p>
          </div>
        </div>
      </div>
    </Layout>
  );
}
