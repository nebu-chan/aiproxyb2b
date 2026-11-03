import { useState } from 'react';
import { format } from 'date-fns';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation, Trans } from 'react-i18next';
import { adminApi, type AdminUser } from '../../api/admin';
import { Layout } from '../../components/Layout';
import { ConfirmModal } from '../../components/ConfirmModal';
import { useAuth } from '../../hooks/useAuth';
import { getDateFnsLocale } from '../../i18n/dateLocale';

function InviteModal({
  onSave,
  onClose,
  isSaving,
  error,
}: {
  onSave: (data: { name: string; surname: string; email: string; password: string }) => void;
  onClose: () => void;
  isSaving: boolean;
  error?: string;
}) {
  const { t } = useTranslation(['pages', 'common']);
  const [form, setForm] = useState({ name: '', surname: '', email: '', password: '' });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-gray-900 mb-5">{t('adminAdmins.inviteModal.title')}</h2>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('common:fields.firstName')}</label>
              <input value={form.name} onChange={set('name')} placeholder={t('adminAdmins.inviteModal.firstNamePlaceholder')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('common:fields.lastName')}</label>
              <input value={form.surname} onChange={set('surname')} placeholder={t('adminAdmins.inviteModal.lastNamePlaceholder')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('common:fields.email')}</label>
            <input type="email" value={form.email} onChange={set('email')} placeholder={t('adminAdmins.inviteModal.emailPlaceholder')}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('adminAdmins.inviteModal.initialPassword')}</label>
            <input type="password" value={form.password} onChange={set('password')} placeholder={t('adminAdmins.inviteModal.passwordPlaceholder')}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">{t('common:buttons.cancel')}</button>
          <button
            onClick={() => onSave(form)}
            disabled={isSaving || !form.name.trim() || !form.email.trim() || !form.password}
            className="px-4 py-2 text-sm bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded-lg"
          >
            {isSaving ? t('adminAdmins.inviteModal.creating') : t('adminAdmins.inviteModal.create')}
          </button>
        </div>
      </div>
    </div>
  );
}

function ResetPasswordModal({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const { t } = useTranslation(['pages', 'common']);
  const [password, setPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const resetMutation = useMutation({
    mutationFn: () => adminApi.admins.resetPassword(user.id),
    onSuccess: (data) => setPassword(data.password),
  });

  function copy() {
    if (!password) return;
    navigator.clipboard.writeText(password);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-gray-900 mb-2">{t('adminAdmins.resetPasswordModal.title')}</h2>
        <p className="text-sm text-gray-500 mb-5">
          {password
            ? t('adminAdmins.resetPasswordModal.generated')
            : <Trans
                i18nKey="adminAdmins.resetPasswordModal.confirm"
                ns="pages"
                values={{ email: user.email }}
                components={{ email: <span className="font-medium text-gray-800" /> }}
              />}
        </p>

        {password ? (
          <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 mb-5">
            <code className="flex-1 text-sm font-mono text-gray-800 select-all">{password}</code>
            <button onClick={copy} className="text-xs text-brand-600 hover:text-brand-700 font-medium whitespace-nowrap">
              {copied ? t('adminAdmins.resetPasswordModal.copied') : t('adminAdmins.resetPasswordModal.copy')}
            </button>
          </div>
        ) : null}

        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
            {password ? t('adminAdmins.resetPasswordModal.done') : t('common:buttons.cancel')}
          </button>
          {!password && (
            <button
              onClick={() => resetMutation.mutate()}
              disabled={resetMutation.isPending}
              className="px-4 py-2 text-sm bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-lg"
            >
              {resetMutation.isPending ? t('adminAdmins.resetPasswordModal.resetting') : t('adminAdmins.resetPasswordModal.reset')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function AdminAdmins() {
  const { t } = useTranslation(['pages', 'common']);
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const [showInvite, setShowInvite] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState('');

  const { data: admins = [], isLoading } = useQuery({
    queryKey: ['admin', 'admins'],
    queryFn: adminApi.admins.list,
  });

  const createMutation = useMutation({
    mutationFn: adminApi.admins.create,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'admins'] }); setShowInvite(false); setInviteError(''); },
    onError: (e: any) => setInviteError(e?.response?.data?.error ?? t('adminAdmins.errors.createFailed')),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => adminApi.admins.setActive(id, isActive),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'admins'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.admins.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'admins'] }); setConfirmDeleteId(null); },
    onError: (e: any) => { setConfirmDeleteId(null); setDeleteError(e?.response?.data?.error ?? t('adminAdmins.errors.deleteFailed')); },
  });

  return (
    <Layout>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('common:nav.platformAdmins')}</h1>
          <p className="text-gray-500 text-sm mt-1">{t('adminAdmins.subtitle')}</p>
        </div>
        <button
          onClick={() => { setInviteError(''); setShowInvite(true); }}
          className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
          </svg>
          {t('adminAdmins.addAdmin')}
        </button>
      </div>

      {deleteError && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm flex items-center justify-between">
          {deleteError}
          <button onClick={() => setDeleteError('')} className="text-red-400 hover:text-red-600 ml-4">✕</button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400 text-sm">{t('common:loading')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">{t('adminAdmins.table.name')}</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">{t('common:fields.email')}</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">{t('adminAdmins.table.status')}</th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium">{t('adminAdmins.table.created')}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(admins as AdminUser[]).map((admin) => {
                const isMe = admin.id === me?.id;
                return (
                  <tr key={admin.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {[admin.name, admin.surname].filter(Boolean).join(' ') || '—'}
                      {isMe && <span className="ml-2 text-xs text-gray-400 font-normal">{t('adminAdmins.table.you')}</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{admin.email}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => !isMe && toggleMutation.mutate({ id: admin.id, isActive: !admin.isActive })}
                        disabled={toggleMutation.isPending || isMe}
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium transition-opacity ${isMe ? 'cursor-default' : 'hover:opacity-70'} disabled:opacity-50 ${
                          admin.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {admin.isActive ? t('adminAdmins.table.active') : t('adminAdmins.table.inactive')}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {format(new Date(admin.createdAt), 'MMM d, yyyy', { locale: getDateFnsLocale() })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          onClick={() => setResetTarget(admin)}
                          className="text-xs text-gray-400 hover:text-amber-600"
                        >
                          {t('adminAdmins.table.resetPassword')}
                        </button>
                        {!isMe && (
                            <button
                              onClick={() => { setDeleteError(''); setConfirmDeleteId(admin.id); }}
                              className="text-xs text-gray-400 hover:text-red-600"
                            >
                              {t('adminAdmins.table.remove')}
                            </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {showInvite && (
        <InviteModal
          onSave={(form) => createMutation.mutate(form)}
          onClose={() => { setShowInvite(false); setInviteError(''); }}
          isSaving={createMutation.isPending}
          error={inviteError}
        />
      )}

      {resetTarget && (
        <ResetPasswordModal
          user={resetTarget}
          onClose={() => setResetTarget(null)}
        />
      )}

      {confirmDeleteId && (() => {
        const admin = (admins as AdminUser[]).find((a) => a.id === confirmDeleteId);
        return admin ? (
          <ConfirmModal
            title={t('adminAdmins.confirmDelete.title')}
            message={t('adminAdmins.confirmDelete.message', { email: admin.email })}
            confirmLabel={t('adminAdmins.confirmDelete.confirmLabel')}
            onConfirm={() => deleteMutation.mutate(admin.id)}
            onCancel={() => setConfirmDeleteId(null)}
            isPending={deleteMutation.isPending}
          />
        ) : null;
      })()}
    </Layout>
  );
}
