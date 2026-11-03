import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { orgApi } from '../api/org';
import { Layout } from '../components/Layout';
import { useAuth } from '../hooks/useAuth';

interface ImageRef {
  fileId?: string;
  url?: string;
  revised_prompt?: string;
}

interface ImageGenEntry {
  id: string;
  prompt: string;
  model: string;
  size: string | null;
  quality: string | null;
  n: number;
  createdAt: string;
  images: ImageRef[];
}

interface AiMediatorModel { id: string }

const SIZE_OPTIONS = [
  { value: '',          label: 'Default' },
  { value: '1024x1024', label: '1024×1024' },
  { value: '1024x1536', label: '1024×1536' },
  { value: '1536x1024', label: '1536×1024' },
];
const QUALITY_VALUES = ['', 'low', 'medium', 'high'] as const;

const API_BASE = (api.defaults.baseURL ?? '/api').replace(/\/$/, '');

/** Returns a renderable src for an image ref. */
function imgSrc(img: ImageRef): string | undefined {
  if (img.fileId) return `${API_BASE}/org/images/files/${img.fileId}`;
  if (img.url) return img.url;
  return undefined;
}

function friendlyError(t: (key: string) => string, responseData: any): string {
  const err = responseData?.error;
  if (err?.type === 'insufficient_funds' || err?.code === '402')
    return t('imageGen.errors.insufficientBalance');
  if (typeof err === 'string') return err;
  if (err?.message) return String(err.message);
  return t('imageGen.errors.requestFailed');
}

/** Live elapsed seconds counter while generation is in progress. */
function useElapsedSeconds(running: boolean) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (running) {
      startRef.current = Date.now();
      setElapsed(0);
      const id = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startRef.current!) / 1000));
      }, 1000);
      return () => clearInterval(id);
    } else {
      startRef.current = null;
      setElapsed(0);
    }
  }, [running]);

  return elapsed;
}

export function ImageGen() {
  const { t, i18n } = useTranslation(['pages', 'common']);
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const qc = useQueryClient();

  const [activeId, setActiveId] = useState<string | null>(null);

  const [model,   setModel]   = useState('');
  const [prompt,  setPrompt]  = useState('');
  const [size,    setSize]    = useState('');
  const [quality, setQuality] = useState('');
  const [n,       setN]       = useState(1);

  const [isLoading, setIsLoading] = useState(false);
  const [error,     setError]     = useState('');

  const elapsed = useElapsedSeconds(isLoading);

  const { data: keyStatus } = useQuery<{ configured: boolean }>({
    queryKey: ['ai-mediator-key-status'],
    queryFn: () => api.get('/org/ai-mediator-key').then((r) => r.data),
    staleTime: 60_000,
  });
  const keyConfigured = keyStatus?.configured ?? false;

  const { data: modelSettingsData } = useQuery<Record<string, { allowed: boolean }>>({
    queryKey: ['me-model-settings'],
    queryFn: () => api.get('/org/me/model-settings').then((r) => r.data.data),
    staleTime: 60_000,
  });

  const { data: modelsResp, isFetching: modelsFetching, isError: modelsError } = useQuery<{ data: AiMediatorModel[] }>({
    queryKey: ['ai-mediator-image-models'],
    queryFn: () => api.post<{ data: AiMediatorModel[] }>('/org/ai-mediator/image-models').then((r) => r.data),
    enabled: keyConfigured,
    staleTime: 0,
    refetchOnMount: 'always',
    retry: false,
  });

  const allImageModelList = modelsResp?.data?.map((m) => m.id).sort() ?? [];
  const modelList = allImageModelList.filter((m) => modelSettingsData?.[m]?.allowed !== false);

  // Auto-select first model
  const currentModel = model && modelList.includes(model) ? model : (modelList[0] ?? '');
  if (currentModel !== model && currentModel) setModel(currentModel);

  // Monthly balance
  const { data: myBalance, refetch: refetchBalance } = useQuery({
    queryKey: ['org', 'me', 'balance'],
    queryFn: orgApi.balance.me,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  // Image history from DB
  const { data: historyResp, refetch: refetchHistory } = useQuery<{ data: ImageGenEntry[] }>({
    queryKey: ['image-history'],
    queryFn: () => api.get('/org/images').then((r) => r.data),
    staleTime: 0,
  });
  const history = historyResp?.data ?? [];

  const activeEntry = history.find((e) => e.id === activeId) ?? null;

  async function generate() {
    if (!prompt.trim() || !currentModel || isLoading) return;
    setIsLoading(true);
    setError('');

    const requestPayload: Record<string, unknown> = { model: currentModel, prompt: prompt.trim(), n };
    if (size)    requestPayload.size    = size;
    if (quality) requestPayload.quality = quality;

    try {
      const resp = await api.post<{ generationId: string; data: ImageRef[] }>('/org/ai-mediator/images', requestPayload);
      setPrompt('');
      await refetchHistory();
      setActiveId(resp.data.generationId);
      refetchBalance();
    } catch (err: any) {
      const data = err?.response?.data;
      if (data?.error === 'model_access_denied') setError(data.message);
      else if (data?.error === 'balance_exceeded') setError(data.message);
      else setError(friendlyError(t, data) || err?.message || t('imageGen.errors.requestFailed'));
    } finally {
      setIsLoading(false);
    }
  }

  async function deleteEntry(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    try {
      await api.delete(`/org/images/${id}`);
      if (activeId === id) setActiveId(null);
      qc.setQueryData<{ data: ImageGenEntry[] }>(['image-history'], (old) =>
        old ? { data: old.data.filter((en) => en.id !== id) } : old,
      );
    } catch { /* ignore */ }
  }

  function newGeneration() {
    setActiveId(null);
    setError('');
  }

  const canGenerate = !!prompt.trim() && !!currentModel && keyConfigured && !isLoading;

  return (
    <Layout>
      <div className="flex gap-3" style={{ height: 'calc(100vh - 9rem)' }}>

        {/* ── History sidebar ──────────────────────────────────────────── */}
        <div className="w-52 flex-shrink-0 bg-white rounded-xl border border-gray-200 flex flex-col overflow-hidden">
          <div className="p-3 border-b border-gray-100">
            <button
              onClick={newGeneration}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
            >
              <span className="text-base font-bold leading-none">+</span>
              {t('imageGen.newImage')}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
            {history.length === 0 && (
              <p className="text-xs text-gray-400 text-center mt-8 px-2">{t('imageGen.noImagesYet')}</p>
            )}
            {history.map((entry) => {
              const thumb = imgSrc(entry.images[0] ?? {});
              return (
                <div
                  key={entry.id}
                  onClick={() => setActiveId(entry.id)}
                  className={`group relative flex gap-2 px-2 py-2 rounded-lg cursor-pointer transition-colors ${
                    activeId === entry.id ? 'bg-brand-50 border border-brand-200' : 'hover:bg-gray-100'
                  }`}
                >
                  {thumb ? (
                    <img
                      src={thumb}
                      alt=""
                      className="w-9 h-9 rounded object-cover flex-shrink-0 border border-gray-200"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  ) : (
                    <div className="w-9 h-9 rounded bg-gray-100 flex-shrink-0 flex items-center justify-center text-gray-300 text-xs">?</div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-medium leading-snug truncate ${activeId === entry.id ? 'text-brand-700' : 'text-gray-700'}`}>
                      {entry.prompt}
                    </p>
                    <p className="text-[10px] text-gray-400 truncate mt-0.5">{entry.model}</p>
                  </div>
                  <button
                    onClick={(e) => deleteEntry(e, entry.id)}
                    className={`absolute right-1 top-1 text-gray-400 hover:text-red-500 transition-all rounded p-0.5 leading-none text-[11px] ${activeId === entry.id ? 'opacity-50' : 'opacity-0 group-hover:opacity-100'}`}
                    title={t('imageGen.deleteImage')}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>

          {/* Monthly budget widget */}
          {myBalance && myBalance.limitRub !== null && (
            <div className={`mx-2 mb-2 px-3 py-2 rounded-lg text-xs border ${
              myBalance.spentRub >= myBalance.limitRub
                ? 'bg-red-50 border-red-200 text-red-700'
                : myBalance.spentRub >= myBalance.limitRub * 0.8
                ? 'bg-amber-50 border-amber-200 text-amber-700'
                : 'bg-gray-50 border-gray-200 text-gray-500'
            }`}>
              <div className="font-medium text-[11px] mb-1">{t('imageGen.monthlyBudget')}</div>
              <div className="flex justify-between items-baseline">
                <span className="font-semibold">{myBalance.spentRub.toFixed(2)} ₽</span>
                <span className="text-[10px] opacity-70">{t('imageGen.ofLimit', { limit: myBalance.limitRub.toFixed(2) })}</span>
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

        {/* ── Main area ────────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col bg-white rounded-xl border border-gray-200 overflow-hidden min-w-0">

          {/* Settings panel */}
          <div className="border-b border-gray-100 px-5 py-3 flex flex-col">
          <div className="flex flex-wrap items-end gap-4">

            {isAdmin && (
              <div className="flex-shrink-0 flex items-center gap-2 pb-0.5">
                {keyConfigured ? (
                  <span className="inline-flex items-center gap-1.5 text-xs text-green-700 bg-green-50 border border-green-200 px-2.5 py-1 rounded-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                    {t('imageGen.keyConfigured')}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                    {t('imageGen.noApiKey')} —{' '}
                    <a href="/keys" className="underline underline-offset-2 hover:text-amber-900">{t('imageGen.addOne')}</a>
                  </span>
                )}
              </div>
            )}

            {/* Model */}
            <div className="min-w-[180px]">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-gray-600">{t('imageGen.model')}</label>
                {keyConfigured && (
                  <button
                    onClick={() => qc.invalidateQueries({ queryKey: ['ai-mediator-image-models'] })}
                    disabled={modelsFetching}
                    className="text-[10px] text-gray-400 hover:text-brand-600 disabled:opacity-40 transition-colors"
                  >
                    {modelsFetching ? t('common:loading') : t('imageGen.refresh')}
                  </button>
                )}
              </div>
              <select
                value={currentModel}
                onChange={(e) => setModel(e.target.value)}
                disabled={modelsFetching || modelList.length === 0}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-gray-50 disabled:text-gray-400"
              >
                {modelsFetching ? <option>{t('common:loading')}</option>
                  : modelList.length === 0 ? <option>{keyConfigured ? t('imageGen.noModels') : t('imageGen.noApiKeyShort')}</option>
                  : modelList.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              {modelsError && <p className="mt-1 text-xs text-red-500">{t('imageGen.failedToLoadModels')}</p>}
            </div>

            {/* Size */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('imageGen.size')}</label>
              <select
                value={size}
                onChange={(e) => setSize(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                {SIZE_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.value === '' ? t('imageGen.defaultOption') : s.label}</option>
                ))}
              </select>
            </div>

            {/* Quality */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('imageGen.quality')}</label>
              <div className="flex gap-1">
                {QUALITY_VALUES.map((v) => (
                  <button key={v} type="button" onClick={() => setQuality(v)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                      quality === v ? 'bg-brand-600 text-white border-brand-600' : 'text-gray-600 border-gray-300 hover:border-gray-400'
                    }`}
                  >
                    {t(`imageGen.qualityOptions.${v || 'default'}`)}
                  </button>
                ))}
              </div>
            </div>

            {/* Count */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('imageGen.count')}</label>
              <div className="flex gap-1">
                {[1, 2, 3, 4].map((v) => (
                  <button key={v} type="button" onClick={() => setN(v)}
                    className={`w-8 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                      n === v ? 'bg-brand-600 text-white border-brand-600' : 'text-gray-600 border-gray-300 hover:border-gray-400'
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          </div>
          </div>

          {/* Image display area */}
          <div className="flex-1 overflow-y-auto px-6 py-6">
            {!activeEntry && !isLoading && (
              <div className="flex flex-col items-center justify-center h-full text-center select-none">
                <div className="text-5xl mb-4">🖼️</div>
                <p className="text-gray-600 font-medium text-base">{t('imageGen.generateAnImage')}</p>
                <p className="text-gray-400 text-sm mt-1">
                  {!keyConfigured ? t('imageGen.enterApiKeyHint') : t('imageGen.enterPromptHint')}
                </p>
              </div>
            )}

            {isLoading && (
              <div className="flex flex-col items-center justify-center h-full gap-5">
                <svg className="w-10 h-10 text-brand-500 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                <div className="text-center">
                  <p className="text-sm font-medium text-gray-600">{t('imageGen.generatingImage')}</p>
                  <p className="text-xs text-gray-400 mt-1 tabular-nums">{t('imageGen.elapsedHint', { count: elapsed })}</p>
                </div>
              </div>
            )}

            {activeEntry && !isLoading && (
              <div>
                <div className="mb-4">
                  <p className="text-sm text-gray-700 font-medium">{activeEntry.prompt}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {activeEntry.model}
                    {activeEntry.size ? ` · ${activeEntry.size}` : ''}
                    {activeEntry.quality ? ` · ${t('imageGen.qualitySuffix', { quality: t(`imageGen.qualityOptions.${activeEntry.quality}`) })}` : ''}
                    {' · '}{new Date(activeEntry.createdAt).toLocaleString(i18n.language)}
                  </p>
                </div>
                <div className={`grid gap-4 ${activeEntry.images.length === 1 ? 'grid-cols-1 max-w-xl' : 'grid-cols-2'}`}>
                  {activeEntry.images.map((img, i) => {
                    const src = imgSrc(img);
                    const downloadUrl = img.fileId ? `${API_BASE}/org/images/files/${img.fileId}?download=1` : src;
                    return (
                      <div key={i} className="group relative rounded-xl overflow-hidden border border-gray-200">
                        {src && <img src={src} alt={activeEntry.prompt} className="w-full object-cover" />}
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                          {downloadUrl && (
                            <a
                              href={downloadUrl}
                              download={img.fileId ? `image_${i + 1}.png` : undefined}
                              target={img.url && !img.fileId ? '_blank' : undefined}
                              rel="noopener noreferrer"
                              className="bg-white/90 text-gray-800 text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-white transition-colors"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {img.fileId ? t('imageGen.download') : t('imageGen.openFullSize')}
                            </a>
                          )}
                        </div>
                        {img.revised_prompt && img.revised_prompt !== activeEntry.prompt && (
                          <div className="px-3 py-2 bg-gray-50 border-t border-gray-200">
                            <p className="text-[11px] text-gray-500 italic leading-snug">
                              <span className="font-medium not-italic text-gray-400">{t('imageGen.revisedPrefix')} </span>
                              {img.revised_prompt}
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Prompt input */}
          <div className="border-t border-gray-200 p-4">
            {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
            <div className="flex gap-3 items-end">
              <textarea
                value={prompt}
                onChange={(e) => { setPrompt(e.target.value); setError(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); generate(); } }}
                rows={2}
                disabled={isLoading}
                className="flex-1 border border-gray-300 rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-gray-50 disabled:text-gray-400"
                placeholder={t('imageGen.promptPlaceholder')}
              />
              <button
                onClick={generate}
                disabled={!canGenerate}
                className="bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white px-5 py-3 rounded-xl text-sm font-medium transition-colors flex-shrink-0 flex items-center gap-2"
              >
                {isLoading && (
                  <svg className="w-4 h-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                )}
                {isLoading ? t('imageGen.generatingShort', { count: elapsed }) : t('imageGen.generate')}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-2 text-center">
              {t('imageGen.poweredBy')}
            </p>
          </div>
        </div>


      </div>
    </Layout>
  );
}
