import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { adminApi, type Provider } from '../../api/admin';
import { Layout } from '../../components/Layout';
import { ConfirmModal } from '../../components/ConfirmModal';

const emptyForm = {
  name: '',
  baseUrl: '',
  authHeaderName: 'Authorization',
  authHeaderPrefix: 'Bearer',
  apiKey: '',
  isActive: true,
};

export function AdminProviders() {
  const { t } = useTranslation(['pages', 'common']);
  const qc = useQueryClient();
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const { data: providers = [], isLoading } = useQuery({
    queryKey: ['admin', 'providers'],
    queryFn: adminApi.providers.list,
  });

  const createMutation = useMutation({
    mutationFn: () => adminApi.providers.create(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'providers'] });
      setForm(emptyForm);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: typeof form }) =>
      adminApi.providers.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'providers'] });
      setEditing(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: adminApi.providers.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'providers'] }),
  });

  const Field = ({
    label,
    name,
    type = 'text',
  }: {
    label: string;
    name: keyof typeof form;
    type?: string;
  }) => (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input
        type={type}
        value={form[name] as string}
        onChange={(e) => setForm((f) => ({ ...f, [name]: e.target.value }))}
        className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
      />
    </div>
  );

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('adminProviders.title')}</h1>
        <p className="text-gray-500 text-sm mt-1">{t('adminProviders.subtitle')}</p>
      </div>

      {/* Add/edit form */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <h2 className="text-base font-semibold text-gray-800 mb-4">
          {editing ? t('adminProviders.form.editTitle') : t('adminProviders.form.addTitle')}
        </h2>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <Field label={t('adminProviders.form.name')} name="name" />
          <Field label={t('adminProviders.form.baseUrl')} name="baseUrl" />
          <Field label={t('adminProviders.form.authHeaderName')} name="authHeaderName" />
          <Field label={t('adminProviders.form.authHeaderPrefix')} name="authHeaderPrefix" />
          <Field label={t('adminProviders.form.apiKey')} name="apiKey" type="password" />
        </div>
        <div className="flex gap-3">
          <button
            onClick={() =>
              editing
                ? updateMutation.mutate({ id: editing, data: form })
                : createMutation.mutate()
            }
            disabled={!form.name || !form.baseUrl}
            className="bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
          >
            {editing ? t('common:buttons.save') : t('adminProviders.form.addProvider')}
          </button>
          {editing && (
            <button
              onClick={() => { setEditing(null); setForm(emptyForm); }}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              {t('common:buttons.cancel')}
            </button>
          )}
        </div>
      </div>

      {/* Providers list */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400 text-sm">{t('common:loading')}</div>
        ) : providers.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">{t('adminProviders.empty')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-5 py-3 text-gray-500 font-medium">{t('adminProviders.table.name')}</th>
                <th className="text-left px-5 py-3 text-gray-500 font-medium">{t('adminProviders.table.baseUrl')}</th>
                <th className="text-left px-5 py-3 text-gray-500 font-medium">{t('adminProviders.table.authHeader')}</th>
                <th className="text-left px-5 py-3 text-gray-500 font-medium">{t('adminProviders.table.status')}</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {providers.map((p: Provider) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3 font-mono font-medium text-gray-900">{p.name}</td>
                  <td className="px-5 py-3 text-gray-500 max-w-xs truncate">{p.baseUrl}</td>
                  <td className="px-5 py-3 text-gray-500">
                    {p.authHeaderPrefix} {p.authHeaderName}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${p.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {p.isActive ? t('adminProviders.table.active') : t('adminProviders.table.disabled')}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3 justify-end">
                      <button
                        onClick={() => { setEditing(p.id); setForm({ name: p.name, baseUrl: p.baseUrl, authHeaderName: p.authHeaderName, authHeaderPrefix: p.authHeaderPrefix ?? 'Bearer', apiKey: '', isActive: p.isActive }); }}
                        className="text-gray-400 hover:text-gray-700 text-xs"
                      >
                        {t('adminProviders.table.edit')}
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(p.id)}
                        className="text-red-400 hover:text-red-600 text-xs"
                      >
                        {t('common:buttons.delete')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {confirmDeleteId && (() => {
        const p = (providers as Provider[]).find((x) => x.id === confirmDeleteId);
        return p ? (
          <ConfirmModal
            title={t('adminProviders.confirmDelete.title')}
            message={t('adminProviders.confirmDelete.message', { name: p.name })}
            confirmLabel={t('adminProviders.confirmDelete.confirmLabel')}
            onConfirm={() => { deleteMutation.mutate(p.id); setConfirmDeleteId(null); }}
            onCancel={() => setConfirmDeleteId(null)}
            isPending={deleteMutation.isPending}
          />
        ) : null;
      })()}
    </Layout>
  );
}
