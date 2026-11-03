import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Layout } from '../components/Layout';
import type { ModelSettings } from '../api/admin';

interface DeptMember {
  id: string;
  email: string;
  name: string | null;
  surname: string | null;
  role: string;
  isActive: boolean;
  modelSettings: ModelSettings | null;
  createdAt: string;
}

interface DeptInfo {
  id: string;
  name: string;
  modelSettings: ModelSettings | null;
}

interface ModelRow {
  allowed: boolean;
}

function displayName(m: { name: string | null; surname: string | null; email: string }) {
  if (m.name || m.surname) return `${m.name ?? ''} ${m.surname ?? ''}`.trim();
  return m.email;
}

export function DeptUserEdit() {
  const { t } = useTranslation(['pages', 'common']);
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [modelRows, setModelRows] = useState<Record<string, ModelRow>>({});
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);

  const { data: deptData, isLoading: deptLoading } = useQuery<{ data: { dept: DeptInfo; members: DeptMember[] } }>({
    queryKey: ['my-department'],
    queryFn: () => api.get('/org/my-department').then((r) => r.data),
  });

  const dept = deptData?.data.dept;
  const member = deptData?.data.members.find((m) => m.id === userId);
  const deptSettings = dept?.modelSettings ?? null;

  const { data: modelsResp } = useQuery<{ data: { id: string }[] }>({
    queryKey: ['ai-mediator-models'],
    queryFn: () => api.post('/org/ai-mediator/models').then((r) => r.data),
    staleTime: 5 * 60_000,
  });
  const modelList = (modelsResp?.data?.map((m) => m.id).sort() ?? []).filter((id) => !deptBlocked(id));

  // Init rows from member's existing settings
  useEffect(() => {
    if (!member || modelList.length === 0) return;
    const rows: Record<string, ModelRow> = {};
    for (const m of modelList) {
      const existing = member.modelSettings?.[m];
      rows[m] = { allowed: existing ? existing.allowed : true };
    }
    setModelRows(rows);
  }, [member?.id, modelList.join(',')]);

  function toggleAccess(modelId: string) {
    setModelRows((prev) => ({ ...prev, [modelId]: { ...prev[modelId], allowed: !prev[modelId].allowed } }));
  }

  function setAllAccess(allowed: boolean) {
    setModelRows((prev) => {
      const updated = { ...prev };
      for (const id of Object.keys(updated)) {
        if (!deptBlocked(id)) updated[id] = { ...updated[id], allowed };
      }
      return updated;
    });
  }

  function deptBlocked(modelId: string): boolean {
    return deptSettings?.[modelId]?.allowed === false;
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const modelSettings: ModelSettings = {};
      for (const [id, row] of Object.entries(modelRows)) {
        if (!row.allowed) {
          modelSettings[id] = { allowed: row.allowed };
        }
      }
      return api.patch(`/org/my-department/users/${userId}`, { modelSettings }).then((r) => r.data);
    },
    onSuccess: () => {
      setSaveError('');
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      qc.invalidateQueries({ queryKey: ['my-department'] });
      navigate('/my-department');
    },
    onError: (err: any) => {
      setSaveError(err?.response?.data?.error ?? t('deptUserEdit.saveFailed'));
    },
  });

  if (deptLoading) {
    return <Layout><div className="p-8 text-center text-gray-400 text-sm">{t('common:loading')}</div></Layout>;
  }

  if (!member) {
    return <Layout><div className="p-8 text-center text-gray-400 text-sm">{t('deptUserEdit.userNotFound')}</div></Layout>;
  }

  return (
    <Layout>
      <div className="mb-6">
        <button
          onClick={() => navigate('/my-department')}
          className="text-xs text-gray-400 hover:text-gray-600 mb-1.5 inline-flex items-center gap-1"
        >
          ← {t('common:nav.myDepartment')}
        </button>
        <h1 className="text-2xl font-bold text-gray-900">{displayName(member)}</h1>
        {(member.name || member.surname) && (
          <p className="text-sm text-gray-400 mt-0.5">{member.email}</p>
        )}
      </div>

      <div className="max-w-2xl">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-1">{t('deptUserEdit.modelAccessTitle')}</h2>
          <p className="text-xs text-gray-400 mb-4">
            {t('deptUserEdit.modelAccessDescription')}
          </p>

          {modelList.length === 0 ? (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              {t('deptUserEdit.loadingModels')}
            </p>
          ) : (
            <>
              {/* Bulk controls */}
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => setAllAccess(true)}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 transition-colors"
                >
                  {t('deptUserEdit.allowAll')}
                </button>
                <button
                  type="button"
                  onClick={() => setAllAccess(false)}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 transition-colors"
                >
                  {t('deptUserEdit.forbidAll')}
                </button>
              </div>

              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">{t('deptUserEdit.modelColumn')}</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">{t('deptUserEdit.accessColumn')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {modelList.map((modelId) => {
                      const row = modelRows[modelId] ?? { allowed: true };
                      const blocked = deptBlocked(modelId);
                      return (
                        <tr key={modelId} className={blocked || !row.allowed ? 'bg-red-50/40' : ''}>
                          <td className="px-3 py-2 font-mono text-xs text-gray-700">{modelId}</td>
                          <td className="px-3 py-2">
                            {blocked ? (
                              <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">
                                {t('deptUserEdit.deptBlocked')}
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => toggleAccess(modelId)}
                                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                                  row.allowed
                                    ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                    : 'bg-red-100 text-red-700 hover:bg-red-200'
                                }`}
                              >
                                {row.allowed ? t('deptUserEdit.allowed') : t('deptUserEdit.blocked')}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {saveError && (
            <div className="mt-3 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
              {saveError}
            </div>
          )}
          <div className="mt-5 flex items-center gap-3">
            <button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className={`text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors ${saved ? 'bg-green-600 hover:bg-green-600' : 'bg-brand-600 hover:bg-brand-700 disabled:opacity-50'}`}
            >
              {saveMutation.isPending ? t('common:buttons.saving') : saved ? t('common:buttons.saved') : t('common:buttons.save')}
            </button>
            <button
              onClick={() => navigate('/my-department')}
              className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2"
            >
              {t('common:buttons.cancel')}
            </button>
          </div>
        </div>
      </div>
    </Layout>
  );
}
