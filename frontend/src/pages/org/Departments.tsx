import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { orgApi } from '../../api/org';
import type { Department } from '../../api/admin';
import { Layout } from '../../components/Layout';
import { ConfirmModal } from '../../components/ConfirmModal';
import { format } from 'date-fns';
import { getDateFnsLocale } from '../../i18n/dateLocale';

function AddDeptModal({
  onSave,
  onClose,
  isSaving,
}: {
  onSave: (name: string) => void;
  onClose: () => void;
  isSaving: boolean;
}) {
  const { t } = useTranslation(['pages', 'common']);
  const [name, setName] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-gray-900 mb-5">{t('orgDepartments.addModal.title')}</h2>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('orgDepartments.addModal.nameLabel')}</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) onSave(name.trim()); }}
            placeholder={t('orgDepartments.addModal.namePlaceholder')}
            autoFocus
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">{t('common:buttons.cancel')}</button>
          <button
            onClick={() => name.trim() && onSave(name.trim())}
            disabled={isSaving || !name.trim()}
            className="px-4 py-2 text-sm bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded-lg"
          >
            {isSaving ? t('orgDepartments.addModal.creating') : t('orgDepartments.addModal.create')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function OrgDepartments() {
  const { t } = useTranslation(['pages', 'common']);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const { data: departments = [], isLoading } = useQuery<Department[]>({
    queryKey: ['org', 'departments'],
    queryFn: orgApi.departments.list,
  });

  const createMutation = useMutation({
    mutationFn: (name: string) => orgApi.departments.create({ name }),
    onSuccess: () => {
      qc.refetchQueries({ queryKey: ['org', 'departments'] });
      setShowModal(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (deptId: string) => orgApi.departments.delete(deptId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['org', 'departments'] }); setConfirmDeleteId(null); },
  });

  function hasModelSettings(dept: Department): boolean {
    if (!dept.modelSettings) return false;
    return Object.values(dept.modelSettings).some((s) => !s.allowed);
  }

  return (
    <Layout>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('orgDepartments.title')}</h1>
          <p className="text-gray-500 text-sm mt-1">{t('orgDepartments.subtitle')}</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg"
        >
          {t('orgDepartments.addButton')}
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400 text-sm">{t('common:loading')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-5 py-3 text-gray-500 font-medium">{t('orgDepartments.table.name')}</th>
                <th className="text-left px-5 py-3 text-gray-500 font-medium">{t('orgDepartments.table.modelSettings')}</th>
                <th className="text-left px-5 py-3 text-gray-500 font-medium">{t('orgDepartments.table.apiKey')}</th>
                <th className="text-left px-5 py-3 text-gray-500 font-medium">{t('orgDepartments.table.users')}</th>
                <th className="text-left px-5 py-3 text-gray-500 font-medium">{t('orgDepartments.table.created')}</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {departments.map((dept: Department) => (
                <tr
                  key={dept.id}
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => navigate(`/org/departments/${dept.id}`)}
                >
                  <td className="px-5 py-3 font-medium text-gray-900">{dept.name}</td>
                  <td className="px-5 py-3">
                    {hasModelSettings(dept) ? (
                      <span className="inline-flex items-center gap-1 text-xs text-brand-700 bg-brand-50 border border-brand-200 px-2 py-0.5 rounded-full">
                        {t('orgDepartments.modelSettings.configured')}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400 italic">{t('orgDepartments.modelSettings.default')}</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    {dept.aiMediatorKeyId ? (
                      <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
                        {t('orgDepartments.apiKey.assigned')}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400 italic">{t('orgDepartments.apiKey.notSet')}</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-gray-500">{dept.userCount}</td>
                  <td className="px-5 py-3 text-gray-500">{format(new Date(dept.createdAt), 'MMM d, yyyy', { locale: getDateFnsLocale() })}</td>
                  <td className="px-5 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => setConfirmDeleteId(dept.id)}
                      className="text-xs text-red-400 hover:text-red-600"
                    >
                      {t('common:buttons.delete')}
                    </button>
                  </td>
                </tr>
              ))}
              {departments.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-gray-400 text-sm">{t('orgDepartments.empty')}</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      {showModal && (
        <AddDeptModal
          onSave={(name) => createMutation.mutate(name)}
          onClose={() => setShowModal(false)}
          isSaving={createMutation.isPending}
        />
      )}

      {confirmDeleteId && (() => {
        const dept = departments.find((d) => d.id === confirmDeleteId);
        return dept ? (
          <ConfirmModal
            title={t('orgDepartments.confirmDelete.title')}
            message={t('orgDepartments.confirmDelete.message', { name: dept.name })}
            confirmLabel={t('orgDepartments.confirmDelete.confirmLabel')}
            onConfirm={() => deleteMutation.mutate(dept.id)}
            onCancel={() => setConfirmDeleteId(null)}
            isPending={deleteMutation.isPending}
          />
        ) : null;
      })()}
    </Layout>
  );
}
