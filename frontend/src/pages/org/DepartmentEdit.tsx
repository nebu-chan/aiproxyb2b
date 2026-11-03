import { useState, useEffect, useRef } from 'react';
import { format } from 'date-fns';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { orgApi } from '../../api/org';
import type { AiMediatorKey } from '../../api/org';
import { api } from '../../api/client';
import type { OrgUser, ModelSettings } from '../../api/admin';
import { Layout } from '../../components/Layout';
import { ConfirmModal } from '../../components/ConfirmModal';
import { getDateFnsLocale } from '../../i18n/dateLocale';

interface ModelRow {
  allowed: boolean;
}

function displayName(u: OrgUser) {
  if (u.name || u.surname) return `${u.name ?? ''} ${u.surname ?? ''}`.trim();
  return u.email;
}

export function DepartmentEdit() {
  const { t } = useTranslation(['pages', 'common']);
  const { deptId } = useParams<{ deptId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [name, setName] = useState('');
  const [aiMediatorKeyId, setAiMediatorKeyId] = useState<string | null>(null);
  const [balanceRub, setBalanceRub] = useState('');
  const [modelRows, setModelRows] = useState<Record<string, ModelRow>>({});
  const [modelTab, setModelTab] = useState<'text' | 'image'>('text');
  const [showForbidden, setShowForbidden] = useState(false);
  const [pageTab, setPageTab] = useState<'members' | 'policies'>('members');
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addUserId, setAddUserId] = useState('');
  const [addSearch, setAddSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const addRef = useRef<HTMLDivElement>(null);

  const { data: dept, isLoading } = useQuery({
    queryKey: ['org', 'departments', deptId],
    queryFn: () => orgApi.departments.get(deptId!),
    enabled: !!deptId,
  });

  const { data: allUsers = [] } = useQuery({
    queryKey: ['org', 'users'],
    queryFn: orgApi.users.list,
  });

  const { data: deptBalance } = useQuery({
    queryKey: ['org', 'departments', deptId, 'balance'],
    queryFn: () => orgApi.balance.department(deptId!),
    enabled: !!deptId,
  });

  const members = allUsers.filter((u) => u.departmentId === deptId);
  const available = allUsers.filter((u) => u.departmentId !== deptId);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (addRef.current && !addRef.current.contains(e.target as Node)) setAddOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const addMemberMutation = useMutation({
    mutationFn: (userId: string) => orgApi.users.update(userId, { departmentId: deptId }),
    onSuccess: () => {
      setAddUserId('');
      setAddSearch('');
      setAddOpen(false);
      qc.invalidateQueries({ queryKey: ['org', 'users'] });
      qc.invalidateQueries({ queryKey: ['org', 'departments', deptId] });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) => orgApi.users.update(userId, { departmentId: null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org', 'users'] });
      qc.invalidateQueries({ queryKey: ['org', 'departments', deptId] });
    },
  });

  const toggleStatusMutation = useMutation({
    mutationFn: ({ userId, isActive }: { userId: string; isActive: boolean }) =>
      orgApi.users.update(userId, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org', 'users'] }),
  });

  const { data: aiMediatorKeys = [] } = useQuery<AiMediatorKey[]>({
    queryKey: ['ai-mediator-keys'],
    queryFn: orgApi.aiMediatorKeys.list,
  });

  const { data: modelsResp } = useQuery<{ data: { id: string }[] }>({
    queryKey: ['ai-mediator-models'],
    queryFn: () => api.post('/org/ai-mediator/models').then((r) => r.data),
    staleTime: 5 * 60_000,
  });

  const { data: imageModelsResp } = useQuery<{ data: { id: string }[] }>({
    queryKey: ['ai-mediator-image-models'],
    queryFn: () => api.post('/org/ai-mediator/image-models').then((r) => r.data),
    staleTime: 5 * 60_000,
  });

  const textModelList = modelsResp?.data?.map((m) => m.id).sort() ?? [];
  const imageModelList = imageModelsResp?.data?.map((m) => m.id).sort() ?? [];
  const activeModelList = modelTab === 'text' ? textModelList : imageModelList;
  const visibleModels = showForbidden ? activeModelList : activeModelList.filter((id) => modelRows[id]?.allowed !== false);

  useEffect(() => {
    if (dept) {
      setName(dept.name);
      setAiMediatorKeyId(dept.aiMediatorKeyId ?? null);
      setBalanceRub(dept.balanceRub ?? '');
      const rows: Record<string, ModelRow> = {};
      if (dept.modelSettings) {
        for (const [id, s] of Object.entries(dept.modelSettings) as [string, import('../../api/admin').ModelSetting][]) {
          rows[id] = { allowed: s.allowed };
        }
      }
      setModelRows(rows);
    }
  }, [dept]);

  useEffect(() => {
    const allModels = [...textModelList, ...imageModelList];
    if (allModels.length > 0) {
      setModelRows((prev) => {
        const updated = { ...prev };
        for (const m of allModels) {
          if (!updated[m]) updated[m] = { allowed: true };
        }
        return updated;
      });
    }
  }, [textModelList.join(','), imageModelList.join(',')]);

  function toggleAccess(modelId: string) {
    setModelRows((prev) => ({ ...prev, [modelId]: { ...prev[modelId], allowed: !prev[modelId].allowed } }));
  }

  function setAllAccess(allowed: boolean) {
    setModelRows((prev) => {
      const updated = { ...prev };
      for (const id of activeModelList) updated[id] = { ...updated[id], allowed };
      return updated;
    });
  }

  function buildModelSettings(): ModelSettings {
    const settings: ModelSettings = {};
    for (const [id, row] of Object.entries(modelRows)) {
      if (!row.allowed) {
        settings[id] = { allowed: row.allowed };
      }
    }
    return settings;
  }

  const updateMutation = useMutation({
    mutationFn: () => orgApi.departments.update(deptId!, { name: name || undefined, modelSettings: buildModelSettings(), aiMediatorKeyId, balanceRub: balanceRub ? parseFloat(balanceRub) : null }),
    onSuccess: () => {
      setSaveError('');
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      qc.invalidateQueries({ queryKey: ['org', 'departments'] });
      qc.invalidateQueries({ queryKey: ['org', 'departments', deptId] });
    },
    onError: (err: any) => setSaveError(err?.response?.data?.error ?? t('orgDepartmentEdit.saveFailed')),
  });

  const deleteMutation = useMutation({
    mutationFn: () => orgApi.departments.delete(deptId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org', 'departments'] });
      navigate('/org/departments');
    },
  });

  if (isLoading) {
    return <Layout><div className="p-8 text-center text-gray-400 text-sm">{t('common:loading')}</div></Layout>;
  }
  if (!dept) {
    return <Layout><div className="p-8 text-center text-gray-400 text-sm">{t('orgDepartmentEdit.notFound')}</div></Layout>;
  }

  return (
    <Layout>
      {/* Header */}
      <div className="mb-6">
        <button onClick={() => navigate('/org/departments')} className="text-xs text-gray-400 hover:text-gray-600 mb-1.5 inline-flex items-center gap-1">
          {t('orgDepartmentEdit.backToDepartments')}
        </button>
        <h1 className="text-2xl font-bold text-gray-900">{dept.name}</h1>
        <p className="text-sm text-gray-400 mt-0.5">{t('orgDepartmentEdit.userCount', { count: dept.userCount })}</p>
      </div>

      <div className="max-w-4xl space-y-6">
        {/* General settings card */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-4">{t('orgDepartmentEdit.general.title')}</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('orgDepartmentEdit.general.name')}</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('orgDepartmentEdit.general.aiMediatorKey')}</label>
              <select
                value={aiMediatorKeyId ?? ''}
                onChange={(e) => setAiMediatorKeyId(e.target.value || null)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="">{t('orgDepartmentEdit.general.useFallbackKey')}</option>
                {aiMediatorKeys.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.description || t('orgDepartmentEdit.general.keyFallbackLabel', { id: k.id.slice(0, 8) })}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-400">{t('orgDepartmentEdit.general.aiMediatorKeyHint')}</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('orgDepartmentEdit.general.balanceLabel')}</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={balanceRub}
                onChange={(e) => setBalanceRub(e.target.value)}
                placeholder={t('orgDepartmentEdit.general.balancePlaceholder')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              {deptBalance && (
                <p className="mt-1 text-xs text-gray-500">
                  {t('orgDepartmentEdit.general.spentPrefix')} <span className="font-medium text-gray-700">{deptBalance.spentRub.toFixed(2)} ₽</span>
                  {deptBalance.limitRub !== null && (
                    <span className="text-gray-400"> {t('orgDepartmentEdit.general.ofLimit', { limit: deptBalance.limitRub.toFixed(2) })}</span>
                  )}
                  <span className="text-gray-400"> {t('orgDepartmentEdit.general.sincePeriod', { date: format(new Date(deptBalance.periodStart), 'MMM d', { locale: getDateFnsLocale() }) })}</span>
                </p>
              )}
              {!deptBalance && <p className="mt-1 text-xs text-gray-400">{t('orgDepartmentEdit.general.balanceHint')}</p>}
            </div>
          </div>
          {saveError && (
            <div className="mt-3 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{saveError}</div>
          )}
          <div className="mt-4">
            <button
              onClick={() => updateMutation.mutate()}
              disabled={updateMutation.isPending}
              className={`text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors ${saved ? 'bg-green-600 hover:bg-green-600' : 'bg-brand-600 hover:bg-brand-700 disabled:opacity-50'}`}
            >
              {updateMutation.isPending ? t('common:buttons.saving') : saved ? t('common:buttons.saved') : t('common:buttons.save')}
            </button>
          </div>
        </div>

        {/* Main tabbed card */}
        <div className="bg-white rounded-xl border border-gray-200">
          {/* Tab bar */}
          <div className="flex border-b border-gray-200">
            {(['members', 'policies'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setPageTab(tab)}
                className={`px-6 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
                  pageTab === tab
                    ? 'border-brand-600 text-brand-600'
                    : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}
              >
                {tab === 'members' ? t('orgDepartmentEdit.tabs.members') : t('orgDepartmentEdit.tabs.policies')}
              </button>
            ))}
          </div>

          <div className="p-6">
            {/* ── Members tab ── */}
            {pageTab === 'members' && (
              <>
                {members.length === 0 ? (
                  <p className="text-sm text-gray-400 mb-4">{t('orgDepartmentEdit.members.empty')}</p>
                ) : (
                  <div className="border border-gray-200 rounded-lg overflow-hidden mb-4">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          <th className="text-left px-5 py-3 text-gray-500 font-medium">{t('orgDepartmentEdit.members.table.name')}</th>
                          <th className="text-left px-5 py-3 text-gray-500 font-medium">{t('common:fields.email')}</th>
                          <th className="text-left px-5 py-3 text-gray-500 font-medium">{t('orgDepartmentEdit.members.table.role')}</th>
                          <th className="text-left px-5 py-3 text-gray-500 font-medium">{t('orgDepartmentEdit.members.table.status')}</th>
                          <th className="text-left px-5 py-3 text-gray-500 font-medium">{t('orgDepartmentEdit.members.table.joined')}</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {members.map((u) => (
                          <tr key={u.id} className="hover:bg-gray-50">
                            <td className="px-5 py-3 text-gray-900">
                              {u.name || u.surname ? `${u.name ?? ''} ${u.surname ?? ''}`.trim() : <span className="text-gray-300 italic text-xs">—</span>}
                            </td>
                            <td className="px-5 py-3 text-gray-600">{u.email}</td>
                            <td className="px-5 py-3 text-gray-500">
                              {{
                                admin: t('orgDepartmentEdit.members.roles.admin'),
                                superadmin: t('orgDepartmentEdit.members.roles.superadmin'),
                                member: t('orgDepartmentEdit.members.roles.member'),
                                dept_lead: t('common:roles.deptLead'),
                              }[u.role as 'admin' | 'superadmin' | 'member' | 'dept_lead'] ?? u.role}
                            </td>
                            <td className="px-5 py-3">
                              <button
                                onClick={(e) => { e.stopPropagation(); toggleStatusMutation.mutate({ userId: u.id, isActive: !u.isActive }); }}
                                disabled={toggleStatusMutation.isPending}
                                title={u.isActive ? t('orgDepartmentEdit.members.clickToDisable') : t('orgDepartmentEdit.members.clickToEnable')}
                                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium transition-opacity hover:opacity-70 disabled:opacity-50 ${u.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}
                              >
                                {u.isActive ? t('orgDepartmentEdit.members.active') : t('orgDepartmentEdit.members.inactive')}
                              </button>
                            </td>
                            <td className="px-5 py-3 text-gray-500">{format(new Date(u.createdAt), 'MMM d, yyyy', { locale: getDateFnsLocale() })}</td>
                            <td className="px-5 py-3 text-right">
                              <button
                                onClick={() => removeMemberMutation.mutate(u.id)}
                                disabled={removeMemberMutation.isPending}
                                className="text-xs text-red-400 hover:text-red-600 disabled:opacity-50 transition-colors"
                              >
                                {t('orgDepartmentEdit.members.remove')}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {available.length > 0 && (
                  <div className="flex items-center gap-2">
                    <div ref={addRef} className="relative flex-1 max-w-sm">
                      <input
                        type="text"
                        value={addSearch}
                        onChange={(e) => { setAddSearch(e.target.value); setAddUserId(''); setAddOpen(true); }}
                        onFocus={() => setAddOpen(true)}
                        placeholder={t('orgDepartmentEdit.members.searchPlaceholder')}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                      />
                      {addOpen && (
                        <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                          {available
                            .filter((u) => {
                              const q = addSearch.toLowerCase();
                              return !q || displayName(u).toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
                            })
                            .map((u) => (
                              <button
                                key={u.id}
                                type="button"
                                onMouseDown={() => { setAddUserId(u.id); setAddSearch(displayName(u)); setAddOpen(false); }}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center justify-between gap-2"
                              >
                                <span>
                                  <span className="text-gray-800">{displayName(u)}</span>
                                  {(u.name || u.surname) && <span className="text-xs text-gray-400 ml-1.5">{u.email}</span>}
                                </span>
                                {u.departmentName && <span className="text-xs text-gray-400 flex-shrink-0">{u.departmentName}</span>}
                              </button>
                            ))}
                          {available.filter((u) => {
                            const q = addSearch.toLowerCase();
                            return !q || displayName(u).toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
                          }).length === 0 && (
                            <div className="px-3 py-2 text-sm text-gray-400">{t('orgDepartmentEdit.members.noUsersFound')}</div>
                          )}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => addUserId && addMemberMutation.mutate(addUserId)}
                      disabled={!addUserId || addMemberMutation.isPending}
                      className="bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                    >
                      {t('orgDepartmentEdit.members.add')}
                    </button>
                  </div>
                )}
              </>
            )}

            {/* ── Policies tab ── */}
            {pageTab === 'policies' && (
              <>
                <h3 className="text-sm font-semibold text-gray-800 mb-1">{t('orgDepartmentEdit.policies.title')}</h3>
                <p className="text-xs text-gray-400 mb-3">
                  {t('orgDepartmentEdit.policies.description')}
                </p>

                {/* Text / Image model tabs */}
                <div className="flex gap-1 mb-4 border border-gray-200 rounded-lg p-1 w-fit">
                  {(['text', 'image'] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setModelTab(tab)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                        modelTab === tab ? 'bg-gray-900 text-white' : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      {tab === 'text' ? t('orgDepartmentEdit.policies.textModels') : t('orgDepartmentEdit.policies.imageModels')}
                    </button>
                  ))}
                </div>

                {activeModelList.length === 0 ? (
                  <p className="text-xs text-gray-400">{t('orgDepartmentEdit.policies.loadingModels')}</p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      <button type="button" onClick={() => setAllAccess(true)} className="px-3 py-1.5 text-xs font-medium rounded-lg bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 transition-colors">{t('orgDepartmentEdit.policies.allowAll')}</button>
                      <button type="button" onClick={() => setAllAccess(false)} className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 transition-colors">{t('orgDepartmentEdit.policies.forbidAll')}</button>
                      <label className="ml-auto flex items-center gap-1.5 cursor-pointer select-none text-xs text-gray-500">
                        <input type="checkbox" checked={showForbidden} onChange={(e) => setShowForbidden(e.target.checked)} className="rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
                        {t('orgDepartmentEdit.policies.showForbidden')}
                      </label>
                    </div>

                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 border-b border-gray-100">
                          <tr>
                            <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">{t('orgDepartmentEdit.policies.tableModel')}</th>
                            <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">{t('orgDepartmentEdit.policies.tableAccess')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {visibleModels.map((modelId) => {
                            const row = modelRows[modelId] ?? { allowed: true };
                            return (
                              <tr key={modelId} className={row.allowed ? '' : 'bg-red-50/40'}>
                                <td className="px-3 py-2 font-mono text-xs text-gray-700">{modelId}</td>
                                <td className="px-3 py-2">
                                  <button type="button" onClick={() => toggleAccess(modelId)} className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${row.allowed ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-red-100 text-red-700 hover:bg-red-200'}`}>
                                    {row.allowed ? t('orgDepartmentEdit.policies.allowed') : t('orgDepartmentEdit.policies.blocked')}
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

              </>
            )}
          </div>
        </div>

        {/* Danger zone */}
        <div className="bg-white rounded-xl border border-red-100 p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-1">{t('orgDepartmentEdit.dangerZone.title')}</h2>
          <p className="text-sm text-gray-500 mb-4">
            {t('orgDepartmentEdit.dangerZone.description')}
          </p>
          <button
            onClick={() => setConfirmDelete(true)}
            className="bg-red-500 hover:bg-red-600 text-white text-sm font-medium px-5 py-2 rounded-lg"
          >
            {t('orgDepartmentEdit.dangerZone.deleteButton')}
          </button>
        </div>
      </div>
      {confirmDelete && (
        <ConfirmModal
          title={t('orgDepartmentEdit.confirmDelete.title')}
          message={t('orgDepartmentEdit.confirmDelete.message', { name: dept.name })}
          confirmLabel={t('orgDepartmentEdit.confirmDelete.confirmLabel')}
          onConfirm={() => deleteMutation.mutate()}
          onCancel={() => setConfirmDelete(false)}
          isPending={deleteMutation.isPending}
        />
      )}
    </Layout>
  );
}
