import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { orgApi } from '../api/org';
import type { AiMediatorKey } from '../api/org';
import { Layout } from '../components/Layout';
import { ConfirmModal } from '../components/ConfirmModal';

const MAX_KEYS = 6;

function KeyBalance({ keyId }: { keyId: string }) {
  const { t, i18n } = useTranslation(['pages', 'common']);
  const { data, isLoading, isError, refetch, isFetching } = useQuery<{ balance: number }>({
    queryKey: ['ai-mediator-balance', keyId],
    queryFn: () => orgApi.aiMediatorKeys.balance(keyId),
    staleTime: 60_000,
  });

  return (
    <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
      <span className="text-sm font-medium text-gray-700">{t('apiKeys.accountBalance')}</span>
      <div className="flex items-center gap-3">
        {isLoading || isFetching ? (
          <span className="text-sm text-gray-400">{t('common:loading')}</span>
        ) : isError ? (
          <span className="text-xs text-red-500">{t('apiKeys.balanceLoadError')}</span>
        ) : (
          <span className="text-base font-bold text-gray-900">
            ₽{data?.balance.toLocaleString(i18n.language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        )}
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-50"
        >
          {t('apiKeys.refresh')}
        </button>
      </div>
    </div>
  );
}

function KeyRow({ k, onRemove, removing }: { k: AiMediatorKey; onRemove: () => void; removing: boolean }) {
  const { t } = useTranslation(['pages', 'common']);
  const [showBalance, setShowBalance] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  return (
    <div className="px-5 py-4">
      <div className="flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm text-gray-800">
            {k.description || <span className="text-gray-400 italic">{t('apiKeys.noDescription')}</span>}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <code className="text-xs text-gray-400 font-mono">••••••••••••••••••••</code>
            <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${k.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              <span className={`w-1.5 h-1.5 rounded-full inline-block ${k.isActive ? 'bg-green-500' : 'bg-gray-400'}`} />
              {k.isActive ? t('apiKeys.active') : t('apiKeys.inactive')}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <button
            onClick={() => setShowBalance((v) => !v)}
            className="text-xs text-gray-500 hover:text-gray-700 font-medium"
          >
            {showBalance ? t('apiKeys.hideBalance') : t('apiKeys.checkBalance')}
          </button>
          <button
            onClick={() => setConfirmRemove(true)}
            className="text-sm text-red-400 hover:text-red-600"
          >
            {t('apiKeys.remove')}
          </button>
        </div>
      </div>
      {showBalance && <KeyBalance keyId={k.id} />}
      {confirmRemove && (
        <ConfirmModal
          title={t('apiKeys.removeModalTitle')}
          message={t('apiKeys.removeModalMessage', { name: k.description || t('apiKeys.thisKey') })}
          confirmLabel={t('apiKeys.removeKeyConfirm')}
          onConfirm={() => { onRemove(); setConfirmRemove(false); }}
          onCancel={() => setConfirmRemove(false)}
          isPending={removing}
        />
      )}
    </div>
  );
}

function AddKeyModal({
  onSave,
  onClose,
  isSaving,
  error,
}: {
  onSave: (data: { apiKey: string; description: string }) => void;
  onClose: () => void;
  isSaving: boolean;
  error?: string;
}) {
  const { t } = useTranslation(['pages', 'common']);
  const [inputKey, setInputKey] = useState('');
  const [inputDesc, setInputDesc] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-gray-900 mb-5">{t('apiKeys.addModalTitle')}</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('apiKeys.apiKeyLabel')}</label>
            <input
              type="password"
              value={inputKey}
              onChange={(e) => setInputKey(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 font-mono"
              placeholder={t('apiKeys.apiKeyPlaceholder')}
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('apiKeys.descriptionLabel')}</label>
            <input
              type="text"
              value={inputDesc}
              onChange={(e) => setInputDesc(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && inputKey.trim()) onSave({ apiKey: inputKey.trim(), description: inputDesc.trim() }); }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              placeholder={t('apiKeys.descriptionPlaceholder')}
            />
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">{t('common:buttons.cancel')}</button>
          <button
            onClick={() => inputKey.trim() && onSave({ apiKey: inputKey.trim(), description: inputDesc.trim() })}
            disabled={isSaving || !inputKey.trim()}
            className="px-4 py-2 text-sm bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded-lg"
          >
            {isSaving ? t('common:buttons.saving') : t('apiKeys.saveKey')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ApiKeys() {
  const { t } = useTranslation(['pages', 'common']);
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [addError, setAddError] = useState('');

  const { data: keys = [], isLoading } = useQuery<AiMediatorKey[]>({
    queryKey: ['ai-mediator-keys'],
    queryFn: orgApi.aiMediatorKeys.list,
  });

  const addMutation = useMutation({
    mutationFn: (data: { apiKey: string; description: string }) => orgApi.aiMediatorKeys.add(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-mediator-keys'] });
      qc.invalidateQueries({ queryKey: ['ai-mediator-key-status'] });
      qc.invalidateQueries({ queryKey: ['ai-mediator-models'] });
      setShowModal(false);
      setAddError('');
    },
    onError: (e: any) => setAddError(e?.response?.data?.error ?? t('apiKeys.saveFailed')),
  });

  const removeMutation = useMutation({
    mutationFn: (keyId: string) => orgApi.aiMediatorKeys.remove(keyId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-mediator-keys'] });
      qc.invalidateQueries({ queryKey: ['ai-mediator-key-status'] });
    },
  });

  if (isLoading) {
    return <Layout><div className="p-8 text-center text-gray-400 text-sm">{t('common:loading')}</div></Layout>;
  }

  const canAdd = keys.length < MAX_KEYS;

  return (
    <Layout>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('apiKeys.title')}</h1>
          <p className="text-gray-500 text-sm mt-1">
            {t('apiKeys.subtitle', { max: MAX_KEYS })}
          </p>
        </div>
        {canAdd && (
          <button
            onClick={() => { setAddError(''); setShowModal(true); }}
            className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg"
          >
            {t('apiKeys.addKey')}
          </button>
        )}
      </div>

      <div className="max-w-2xl space-y-4">
        {/* Keys list */}
        {keys.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
            <p className="text-gray-400 text-sm">{t('apiKeys.emptyState')}</p>
            <button
              onClick={() => { setAddError(''); setShowModal(true); }}
              className="mt-3 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg"
            >
              {t('apiKeys.addFirstKey')}
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            {keys.map((k) => (
              <KeyRow
                key={k.id}
                k={k}
                onRemove={() => removeMutation.mutate(k.id)}
                removing={removeMutation.isPending}
              />
            ))}
          </div>
        )}

        {/* Slot counter */}
        {keys.length > 0 && (
          <p className="text-xs text-gray-400 text-right">
            {t('apiKeys.slotCounter', { count: keys.length, max: MAX_KEYS })}
            {!canAdd && t('apiKeys.limitReached')}
          </p>
        )}

        <div className="bg-blue-50 border border-blue-100 rounded-xl px-5 py-4 text-sm text-blue-800">
          {t('apiKeys.assignInfoPrefix')}{' '}
          <a href="/departments" className="font-medium underline underline-offset-2 hover:text-blue-900">
            {t('apiKeys.departmentsPageLink')}
          </a>
          {t('apiKeys.assignInfoSuffix')}
        </div>
      </div>

      {showModal && (
        <AddKeyModal
          onSave={(data) => addMutation.mutate(data)}
          onClose={() => { setShowModal(false); setAddError(''); }}
          isSaving={addMutation.isPending}
          error={addError}
        />
      )}
    </Layout>
  );
}
