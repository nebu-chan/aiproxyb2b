import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { orgApi } from '../../api/org';
import { format } from 'date-fns';
import { getDateFnsLocale } from '../../i18n/dateLocale';
import { api } from '../../api/client';
import type { Department, ModelSettings } from '../../api/admin';
import { Layout } from '../../components/Layout';
import { ConfirmModal } from '../../components/ConfirmModal';

const emptyPassword = { password: '', confirm: '' };

interface ModelRow {
  allowed: boolean;
}

export function UserEdit() {
  const { t } = useTranslation(['pages', 'common']);
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [detailForm, setDetailForm] = useState({ email: '', name: '', surname: '', phone: '', role: 'member', departmentId: '', balanceRub: '' });
  const [modelRows, setModelRows] = useState<Record<string, ModelRow>>({});
  const [modelTab, setModelTab] = useState<'text' | 'image'>('text');
  const [showForbidden, setShowForbidden] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);
  const [pwForm, setPwForm] = useState(emptyPassword);
  const [pwError, setPwError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const rowsInitialized = useRef(false);

  const { data: user, isLoading } = useQuery({
    queryKey: ['org', 'users', userId],
    queryFn: () => orgApi.users.get(userId!),
    enabled: !!userId,
  });

  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ['org', 'departments'],
    queryFn: orgApi.departments.list,
  });

  const { data: userBalance } = useQuery({
    queryKey: ['org', 'users', userId, 'balance'],
    queryFn: () => orgApi.balance.user(userId!),
    enabled: !!userId,
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

  // Reset when navigating to a different user
  useEffect(() => { rowsInitialized.current = false; }, [userId]);

  // Set detail form whenever user data loads
  useEffect(() => {
    if (user) {
      setDetailForm({
        email: user.email,
        name: user.name ?? '',
        surname: user.surname ?? '',
        phone: user.phone ?? '',
        role: user.role,
        departmentId: user.departmentId ?? '',
        balanceRub: user.balanceRub ?? '',
      });
    }
  }, [user]);

  // Initialize model rows once when user, departments, and model lists are all ready.
  // Seeds from department defaults, then overlays the user's own explicit settings.
  useEffect(() => {
    if (rowsInitialized.current) return;
    if (!user) return;
    const allModels = [...textModelList, ...imageModelList];
    if (allModels.length === 0) return;
    // If user is in a department, wait until departments have loaded
    if (user.departmentId && departments.length === 0) return;

    rowsInitialized.current = true;
    const dept = departments.find((d) => d.id === user.departmentId);

    setModelRows(() => {
      const rows: Record<string, ModelRow> = {};
      // Start with department defaults for every model
      for (const m of allModels) {
        const ds = dept?.modelSettings?.[m];
        rows[m] = ds ? { allowed: ds.allowed } : { allowed: true };
      }
      // Override with the user's own explicit settings
      if (user.modelSettings) {
        for (const [id, s] of Object.entries(user.modelSettings) as [string, import('../../api/admin').ModelSetting][]) {
          rows[id] = { allowed: s.allowed };
        }
      }
      return rows;
    });
  }, [user, departments, textModelList.join(','), imageModelList.join(',')]);

  function toggleAccess(modelId: string) {
    setModelRows((prev) => ({
      ...prev,
      [modelId]: { ...prev[modelId], allowed: !prev[modelId].allowed },
    }));
  }

  function setAllAccess(allowed: boolean) {
    setModelRows((prev) => {
      const updated = { ...prev };
      for (const id of activeModelList) updated[id] = { ...updated[id], allowed };
      return updated;
    });
  }

  function resetToDepartment() {
    const dept = departments.find((d) => d.id === detailForm.departmentId);
    if (!dept?.modelSettings) return;
    setModelRows((prev) => {
      const updated = { ...prev };
      for (const id of Object.keys(updated)) {
        const ds = dept.modelSettings![id];
        updated[id] = ds ? { allowed: ds.allowed } : { allowed: true };
      }
      return updated;
    });
  }

  function buildModelSettings(): ModelSettings {
    const settings: ModelSettings = {};
    for (const [id, row] of Object.entries(modelRows)) {
      // Only persist rows that differ from default (allowed=true)
      if (!row.allowed) {
        settings[id] = { allowed: row.allowed };
      }
    }
    return settings;
  }

  const updateMutation = useMutation({
    mutationFn: () =>
      orgApi.users.update(userId!, {
        email: detailForm.email || undefined,
        name: detailForm.name || null,
        surname: detailForm.surname || null,
        phone: detailForm.phone || null,
        role: detailForm.role,
        departmentId: detailForm.departmentId || null,
        modelSettings: buildModelSettings(),
        balanceRub: detailForm.balanceRub ? parseFloat(detailForm.balanceRub) : null,
      }),
    onSuccess: () => {
      setSaveError('');
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      qc.invalidateQueries({ queryKey: ['org', 'users'] });
      qc.invalidateQueries({ queryKey: ['org', 'users', userId] });
    },
    onError: (err: any) => {
      setSaveError(err?.response?.data?.error ?? t('orgUserEdit.saveFailed'));
    },
  });

  const changePasswordMutation = useMutation({
    mutationFn: () => orgApi.users.update(userId!, { password: pwForm.password }),
    onSuccess: () => setPwForm(emptyPassword),
  });

  const resetLinkMutation = useMutation({
    mutationFn: () => api.post(`/org/users/${userId}/send-reset-link`),
  });

  const deleteMutation = useMutation({
    mutationFn: () => orgApi.users.delete(userId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org', 'users'] });
      navigate('/org/users');
    },
  });

  function handleChangePassword() {
    if (pwForm.password !== pwForm.confirm) { setPwError(t('orgUserEdit.password.mismatch')); return; }
    if (pwForm.password.length < 8) { setPwError(t('orgUserEdit.password.tooShort')); return; }
    setPwError('');
    changePasswordMutation.mutate();
  }

  if (isLoading) {
    return (
      <Layout>
        <div className="p-8 text-center text-gray-400 text-sm">{t('common:loading')}</div>
      </Layout>
    );
  }

  if (!user) {
    return (
      <Layout>
        <div className="p-8 text-center text-gray-400 text-sm">{t('orgUserEdit.notFound')}</div>
      </Layout>
    );
  }

  return (
    <Layout>
      {/* Page header */}
      <div className="mb-6">
        <button
          onClick={() => navigate('/org/users')}
          className="text-xs text-gray-400 hover:text-gray-600 mb-1.5 inline-flex items-center gap-1"
        >
          {t('orgUserEdit.backToUsers')}
        </button>
        <h1 className="text-2xl font-bold text-gray-900">
          {user.name || user.surname ? `${user.name ?? ''} ${user.surname ?? ''}`.trim() : user.email}
        </h1>
        {(user.name || user.surname) && <p className="text-sm text-gray-400 mt-0.5">{user.email}</p>}
      </div>

      <div className="max-w-2xl space-y-6">
        {/* Profile card */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-4">{t('orgUserEdit.profile.title')}</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('common:fields.firstName')}</label>
              <input
                type="text"
                value={detailForm.name}
                onChange={(e) => setDetailForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('common:fields.lastName')}</label>
              <input
                type="text"
                value={detailForm.surname}
                onChange={(e) => setDetailForm((f) => ({ ...f, surname: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('orgUserEdit.profile.phone')}</label>
              <input
                type="text"
                value={detailForm.phone}
                onChange={(e) => setDetailForm((f) => ({ ...f, phone: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('common:fields.email')}</label>
              <input
                type="email"
                value={detailForm.email}
                onChange={(e) => { setDetailForm((f) => ({ ...f, email: e.target.value })); setSaveError(''); }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>

          <h2 className="text-base font-semibold text-gray-800 mt-6 mb-4">{t('orgUserEdit.account.title')}</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('orgUserEdit.account.role')}</label>
              <select
                value={detailForm.role}
                onChange={(e) => setDetailForm((f) => ({ ...f, role: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="member">{t('orgUserEdit.account.roleOptions.member')}</option>
                <option value="dept_lead">{t('common:roles.deptLead')}</option>
                <option value="admin">{t('orgUserEdit.account.roleOptions.admin')}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('orgUserEdit.account.department')}</label>
              <select
                value={detailForm.departmentId}
                onChange={(e) => setDetailForm((f) => ({ ...f, departmentId: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="">{t('orgUserEdit.account.noDepartment')}</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('orgUserEdit.account.balanceLabel')}</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={detailForm.balanceRub}
                onChange={(e) => setDetailForm((f) => ({ ...f, balanceRub: e.target.value }))}
                placeholder={t('orgUserEdit.account.balancePlaceholder')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              {userBalance && (
                <p className="mt-1 text-xs text-gray-500">
                  {t('orgUserEdit.account.spentPrefix')} <span className="font-medium text-gray-700">{userBalance.spentRub.toFixed(2)} ₽</span>
                  {userBalance.limitRub !== null && (
                    <span className="text-gray-400"> {t('orgUserEdit.account.ofLimit', { limit: userBalance.limitRub.toFixed(2) })}</span>
                  )}
                  <span className="text-gray-400"> {t('orgUserEdit.account.sincePeriod', { date: format(new Date(userBalance.periodStart), 'MMM d', { locale: getDateFnsLocale() }) })}</span>
                </p>
              )}
              {!userBalance && <p className="mt-1 text-xs text-gray-400">{t('orgUserEdit.account.balanceHint')}</p>}
            </div>
          </div>

          {/* Model access */}
          <h2 className="text-base font-semibold text-gray-800 mt-6 mb-1">{t('orgUserEdit.modelAccess.title')}</h2>
          <p className="text-xs text-gray-400 mb-3">
            {t('orgUserEdit.modelAccess.description')}
          </p>

          {/* Tabs */}
          <div className="flex gap-1 mb-4 border border-gray-200 rounded-lg p-1 w-fit">
            <button
              type="button"
              onClick={() => setModelTab('text')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                modelTab === 'text' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {t('orgUserEdit.modelAccess.textModels')}
            </button>
            <button
              type="button"
              onClick={() => setModelTab('image')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                modelTab === 'image' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {t('orgUserEdit.modelAccess.imageModels')}
            </button>
          </div>

          {activeModelList.length === 0 ? (
            <p className="text-xs text-gray-400">{t('orgUserEdit.modelAccess.loadingModels')}</p>
          ) : (
            <>
              {/* Bulk controls */}
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => setAllAccess(true)}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 transition-colors"
                >
                  {t('orgUserEdit.modelAccess.allowAll')}
                </button>
                <button
                  type="button"
                  onClick={() => setAllAccess(false)}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 transition-colors"
                >
                  {t('orgUserEdit.modelAccess.forbidAll')}
                </button>
                <button
                  type="button"
                  onClick={resetToDepartment}
                  disabled={!detailForm.departmentId || !departments.find((d) => d.id === detailForm.departmentId)?.modelSettings}
                  title={!detailForm.departmentId ? t('orgUserEdit.modelAccess.noDepartmentSelected') : t('orgUserEdit.modelAccess.copyDepartmentPolicy')}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {t('orgUserEdit.modelAccess.resetToDepartment')}
                </button>
                <label className="ml-auto flex items-center gap-1.5 cursor-pointer select-none text-xs text-gray-500">
                  <input
                    type="checkbox"
                    checked={showForbidden}
                    onChange={(e) => setShowForbidden(e.target.checked)}
                    className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                  />
                  {t('orgUserEdit.modelAccess.showForbidden')}
                </label>
              </div>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">{t('orgUserEdit.modelAccess.tableModel')}</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">{t('orgUserEdit.modelAccess.tableAccess')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {visibleModels.map((modelId) => {
                      const row = modelRows[modelId] ?? { allowed: true };
                      return (
                        <tr key={modelId} className={row.allowed ? '' : 'bg-red-50/40'}>
                          <td className="px-3 py-2 font-mono text-xs text-gray-700">{modelId}</td>
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              onClick={() => toggleAccess(modelId)}
                              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                                row.allowed
                                  ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                  : 'bg-red-100 text-red-700 hover:bg-red-200'
                              }`}
                            >
                              {row.allowed ? t('orgUserEdit.modelAccess.allowed') : t('orgUserEdit.modelAccess.blocked')}
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

          {saveError && (
            <div className="mt-3 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
              {saveError}
            </div>
          )}
          <div className="mt-5 flex items-center gap-4">
            <button
              onClick={() => updateMutation.mutate()}
              disabled={updateMutation.isPending}
              className={`text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors ${saved ? 'bg-green-600 hover:bg-green-600' : 'bg-brand-600 hover:bg-brand-700 disabled:opacity-50'}`}
            >
              {updateMutation.isPending ? t('common:buttons.saving') : saved ? t('common:buttons.saved') : t('common:buttons.save')}
            </button>
          </div>
        </div>

        {/* Change password card */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-800">{t('orgUserEdit.changePassword.title')}</h2>
            <div className="flex items-center gap-3">
              {resetLinkMutation.isSuccess && (
                <span className="text-xs text-green-600">{t('orgUserEdit.changePassword.resetLinkSent')}</span>
              )}
              {resetLinkMutation.isError && (
                <span className="text-xs text-red-500">{t('orgUserEdit.changePassword.resetLinkFailed')}</span>
              )}
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="text-sm text-gray-600 hover:text-gray-800 font-medium border border-gray-200 hover:border-gray-300 px-3 py-1.5 rounded-lg transition-colors"
              >
                {showPassword ? t('orgUserEdit.changePassword.hidePassword') : t('orgUserEdit.changePassword.showPassword')}
              </button>
              <button
                type="button"
                onClick={() => resetLinkMutation.mutate()}
                disabled={resetLinkMutation.isPending}
                className="text-sm text-brand-600 hover:text-brand-700 disabled:opacity-50 font-medium border border-brand-200 hover:border-brand-300 px-3 py-1.5 rounded-lg transition-colors"
              >
                {resetLinkMutation.isPending ? t('orgUserEdit.changePassword.sending') : t('orgUserEdit.changePassword.sendResetLink')}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('orgUserEdit.changePassword.newPassword')}</label>
              <input
                type={showPassword ? 'text' : 'password'}
                value={pwForm.password}
                onChange={(e) => { setPwForm((f) => ({ ...f, password: e.target.value })); setPwError(''); }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                placeholder={t('orgUserEdit.changePassword.minChars')}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('orgUserEdit.changePassword.confirmPassword')}</label>
              <input
                type={showPassword ? 'text' : 'password'}
                value={pwForm.confirm}
                onChange={(e) => { setPwForm((f) => ({ ...f, confirm: e.target.value })); setPwError(''); }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                placeholder={t('orgUserEdit.changePassword.repeatPassword')}
              />
            </div>
          </div>
          {pwError && <p className="mt-2 text-xs text-red-500">{pwError}</p>}
          {changePasswordMutation.isSuccess && !pwForm.password && (
            <p className="mt-2 text-xs text-green-600">{t('orgUserEdit.changePassword.success')}</p>
          )}
          <div className="mt-4">
            <button
              onClick={handleChangePassword}
              disabled={changePasswordMutation.isPending || !pwForm.password}
              className="bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg"
            >
              {changePasswordMutation.isPending ? t('orgUserEdit.changePassword.changing') : t('orgUserEdit.changePassword.change')}
            </button>
          </div>
        </div>

        {/* Danger zone */}
        <div className="bg-white rounded-xl border border-red-100 p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-1">{t('orgUserEdit.dangerZone.title')}</h2>
          <p className="text-sm text-gray-500 mb-4">{t('orgUserEdit.dangerZone.description')}</p>
          <button
            onClick={() => setConfirmDelete(true)}
            className="bg-red-500 hover:bg-red-600 text-white text-sm font-medium px-5 py-2 rounded-lg"
          >
            {t('orgUserEdit.dangerZone.deleteButton')}
          </button>
        </div>
      </div>

      {confirmDelete && (
        <ConfirmModal
          title={t('orgUserEdit.confirmDelete.title')}
          message={t('orgUserEdit.confirmDelete.message', { email: user.email })}
          confirmLabel={t('orgUserEdit.confirmDelete.confirmLabel')}
          onConfirm={() => deleteMutation.mutate()}
          onCancel={() => setConfirmDelete(false)}
          isPending={deleteMutation.isPending}
        />
      )}
    </Layout>
  );
}
