import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { orgApi } from '../../api/org';
import type { OrgUser, Department } from '../../api/admin';
import { Layout } from '../../components/Layout';
import { format } from 'date-fns';
import { getDateFnsLocale } from '../../i18n/dateLocale';
import { useAuth } from '../../hooks/useAuth';

const emptyCreate = (firstDeptId = '') => ({ email: '', name: '', surname: '', role: 'member', departmentId: firstDeptId });

function AddUserModal({
  departments,
  onSave,
  onClose,
  isSaving,
  error,
}: {
  departments: Department[];
  onSave: (data: { email: string; name?: string; surname?: string; role: string; departmentId?: string }) => void;
  onClose: () => void;
  isSaving: boolean;
  error?: string;
}) {
  const { t } = useTranslation(['pages', 'common']);
  const [form, setForm] = useState(emptyCreate(departments[0]?.id ?? ''));
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-gray-900 mb-5">{t('orgUsers.addModal.title')}</h2>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('common:fields.firstName')}</label>
              <input value={form.name} onChange={set('name')} placeholder={t('orgUsers.addModal.firstNamePlaceholder')} autoFocus
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('common:fields.lastName')}</label>
              <input value={form.surname} onChange={set('surname')} placeholder={t('orgUsers.addModal.lastNamePlaceholder')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('common:fields.email')}</label>
            <input type="email" value={form.email} onChange={set('email')} placeholder={t('orgUsers.addModal.emailPlaceholder')}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('orgUsers.addModal.role')}</label>
              <select value={form.role} onChange={set('role')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white">
                <option value="member">{t('common:roles.member')}</option>
                <option value="dept_lead">{t('common:roles.deptLead')}</option>
                <option value="admin">{t('common:roles.admin')}</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('orgUsers.addModal.department')}</label>
              <select value={form.departmentId} onChange={set('departmentId')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white">
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">{t('common:buttons.cancel')}</button>
          <button
            onClick={() => onSave({ email: form.email, name: form.name || undefined, surname: form.surname || undefined, role: form.role, departmentId: form.departmentId || undefined })}
            disabled={isSaving || !form.email.trim()}
            className="px-4 py-2 text-sm bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded-lg"
          >
            {isSaving ? t('orgUsers.addModal.creating') : t('orgUsers.addModal.createUser')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function OrgUsers() {
  const { t } = useTranslation(['pages', 'common']);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user: currentUser } = useAuth();

  const [showForm, setShowForm] = useState(false);
  const [createError, setCreateError] = useState('');

  const { data: users = [], isLoading } = useQuery<OrgUser[]>({
    queryKey: ['org', 'users'],
    queryFn: orgApi.users.list,
  });

  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ['org', 'departments'],
    queryFn: orgApi.departments.list,
  });

  const [filterName,   setFilterName]   = useState('');
  const [filterEmail,  setFilterEmail]  = useState('');
  const [filterRole,   setFilterRole]   = useState('');
  const [filterDept,   setFilterDept]   = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterJoined, setFilterJoined] = useState('');

  const ROLE_LABELS: Record<string, string> = {
    admin: t('common:roles.admin'), member: t('common:roles.member'), dept_lead: t('common:roles.deptLead'),
  };

  const joinedCutoff = (() => {
    const now = new Date();
    if (filterJoined === 'today')  { const d = new Date(now); d.setHours(0,0,0,0); return d; }
    if (filterJoined === '7d')     return new Date(now.getTime() - 7  * 86400000);
    if (filterJoined === '30d')    return new Date(now.getTime() - 30 * 86400000);
    if (filterJoined === '3m')     return new Date(now.getTime() - 90 * 86400000);
    if (filterJoined === 'year')   { return new Date(now.getFullYear(), 0, 1); }
    return null;
  })();

  const filtered = users.filter((u) => {
    const fullName = `${u.name ?? ''} ${u.surname ?? ''}`.toLowerCase();
    if (filterName   && !fullName.includes(filterName.toLowerCase()))                return false;
    if (filterEmail  && !u.email.toLowerCase().includes(filterEmail.toLowerCase()))  return false;
    if (filterRole   && u.role !== filterRole)                                        return false;
    if (filterDept   && u.departmentName !== filterDept)                              return false;
    if (filterStatus === 'active'   && !u.isActive)  return false;
    if (filterStatus === 'inactive' &&  u.isActive)  return false;
    if (joinedCutoff && new Date(u.createdAt) < joinedCutoff) return false;
    return true;
  });

  const anyFilter = filterName || filterEmail || filterRole || filterDept || filterStatus || filterJoined;
  function clearFilters() {
    setFilterName(''); setFilterEmail(''); setFilterRole(''); setFilterDept(''); setFilterStatus(''); setFilterJoined('');
  }

  const deptOptions = [...new Set(users.map((u) => u.departmentName).filter(Boolean))].sort() as string[];

  const toggleStatusMutation = useMutation({
    mutationFn: ({ userId, isActive }: { userId: string; isActive: boolean }) =>
      orgApi.users.update(userId, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org', 'users'] }),
  });

  const createMutation = useMutation({
    mutationFn: (data: { email: string; name?: string; surname?: string; role: string; departmentId?: string }) =>
      orgApi.users.create({ ...data, role: data.role as 'admin' | 'member' | 'dept_lead' }),
    onSuccess: (newUser) => {
      qc.refetchQueries({ queryKey: ['org', 'users'] });
      setShowForm(false);
      setCreateError('');
      navigate(`/org/users/${newUser.id}`);
    },
    onError: (e: any) => setCreateError(e?.response?.data?.error ?? t('orgUsers.createFailed')),
  });

  return (
    <Layout>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('common:nav.users')}</h1>
          <p className="text-gray-500 text-sm mt-1">{t('orgUsers.subtitle')}</p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg"
        >
          + {t('orgUsers.addUser')}
        </button>
      </div>

      {showForm && (
        <AddUserModal
          departments={departments as Department[]}
          onSave={(data) => createMutation.mutate(data)}
          onClose={() => { setShowForm(false); setCreateError(''); }}
          isSaving={createMutation.isPending}
          error={createError}
        />
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="p-10 flex flex-col items-center justify-center gap-3">
            <svg className="w-6 h-6 text-gray-300 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            <span className="text-sm text-gray-400">{t('orgUsers.loadingUsers')}</span>
          </div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                {/* Column headers */}
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-5 py-3 text-gray-500 font-medium">{t('orgUsers.columns.name')}</th>
                  <th className="text-left px-5 py-3 text-gray-500 font-medium">{t('common:fields.email')}</th>
                  <th className="text-left px-5 py-3 text-gray-500 font-medium">{t('orgUsers.columns.role')}</th>
                  <th className="text-left px-5 py-3 text-gray-500 font-medium">{t('orgUsers.addModal.department')}</th>
                  <th className="text-left px-5 py-3 text-gray-500 font-medium">{t('orgUsers.columns.status')}</th>
                  <th className="text-left px-5 py-3 text-gray-500 font-medium">{t('orgUsers.columns.joined')}</th>
                </tr>
                {/* Filter row */}
                <tr className="bg-white border-b border-gray-100">
                  <th className="px-3 py-2">
                    <input
                      type="text"
                      value={filterName}
                      onChange={(e) => setFilterName(e.target.value)}
                      placeholder={t('orgUsers.filters.searchName')}
                      className="w-full border border-gray-200 rounded-md px-2.5 py-1.5 text-xs font-normal text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-400"
                    />
                  </th>
                  <th className="px-3 py-2">
                    <input
                      type="text"
                      value={filterEmail}
                      onChange={(e) => setFilterEmail(e.target.value)}
                      placeholder={t('orgUsers.filters.searchEmail')}
                      className="w-full border border-gray-200 rounded-md px-2.5 py-1.5 text-xs font-normal text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-400"
                    />
                  </th>
                  <th className="px-3 py-2">
                    <select
                      value={filterRole}
                      onChange={(e) => setFilterRole(e.target.value)}
                      className="w-full border border-gray-200 rounded-md px-2.5 py-1.5 text-xs font-normal text-gray-700 focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-400 bg-white"
                    >
                      <option value="">{t('orgUsers.filters.allRoles')}</option>
                      {Object.entries(ROLE_LABELS).map(([val, label]) => (
                        <option key={val} value={val}>{label}</option>
                      ))}
                    </select>
                  </th>
                  <th className="px-3 py-2">
                    <select
                      value={filterDept}
                      onChange={(e) => setFilterDept(e.target.value)}
                      className="w-full border border-gray-200 rounded-md px-2.5 py-1.5 text-xs font-normal text-gray-700 focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-400 bg-white"
                    >
                      <option value="">{t('orgUsers.filters.allDepartments')}</option>
                      {deptOptions.map((d) => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  </th>
                  <th className="px-3 py-2">
                    <select
                      value={filterStatus}
                      onChange={(e) => setFilterStatus(e.target.value)}
                      className="w-full border border-gray-200 rounded-md px-2.5 py-1.5 text-xs font-normal text-gray-700 focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-400 bg-white"
                    >
                      <option value="">{t('orgUsers.filters.allStatuses')}</option>
                      <option value="active">{t('orgUsers.status.active')}</option>
                      <option value="inactive">{t('orgUsers.status.inactive')}</option>
                    </select>
                  </th>
                  <th className="px-3 py-2">
                    <select
                      value={filterJoined}
                      onChange={(e) => setFilterJoined(e.target.value)}
                      className="w-full border border-gray-200 rounded-md px-2.5 py-1.5 text-xs font-normal text-gray-700 focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-400 bg-white"
                    >
                      <option value="">{t('orgUsers.filters.allTime')}</option>
                      <option value="today">{t('orgUsers.filters.today')}</option>
                      <option value="7d">{t('orgUsers.filters.last7Days')}</option>
                      <option value="30d">{t('orgUsers.filters.last30Days')}</option>
                      <option value="3m">{t('orgUsers.filters.last3Months')}</option>
                      <option value="year">{t('orgUsers.filters.thisYear')}</option>
                    </select>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((user: OrgUser) => (
                  <tr
                    key={user.id}
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => navigate(`/org/users/${user.id}`)}
                  >
                    <td className="px-5 py-3 text-gray-900">
                      <span className="inline-flex items-center gap-1.5">
                        {user.name || user.surname
                          ? `${user.name ?? ''} ${user.surname ?? ''}`.trim()
                          : <span className="text-gray-300 italic text-xs">—</span>}
                        {user.id === currentUser?.id && (
                          <span className="text-xs text-gray-400 font-normal">{t('orgUsers.me')}</span>
                        )}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-gray-600">{user.email}</td>
                    <td className="px-5 py-3 text-gray-500">
                      {ROLE_LABELS[user.role] ?? user.role}
                    </td>
                    <td className="px-5 py-3 text-gray-500">
                      {user.departmentName ?? <span className="text-gray-300 italic text-xs">—</span>}
                    </td>
                    <td className="px-5 py-3">
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleStatusMutation.mutate({ userId: user.id, isActive: !user.isActive }); }}
                        disabled={toggleStatusMutation.isPending}
                        title={user.isActive ? t('orgUsers.status.clickToDisable') : t('orgUsers.status.clickToEnable')}
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium transition-opacity hover:opacity-70 disabled:opacity-50 ${user.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}
                      >
                        {user.isActive ? t('orgUsers.status.active') : t('orgUsers.status.inactive')}
                      </button>
                    </td>
                    <td className="px-5 py-3 text-gray-500">{format(new Date(user.createdAt), 'MMM d, yyyy', { locale: getDateFnsLocale() })}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center">
                      <p className="text-sm font-medium text-gray-400">{t('orgUsers.noMatch')}</p>
                      <button onClick={clearFilters} className="mt-1 text-xs text-brand-600 hover:underline">{t('orgUsers.clearFilters')}</button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {/* Footer: count */}
            <div className="px-5 py-2.5 border-t border-gray-100 flex items-center justify-between">
              <span className="text-xs text-gray-400">
                {anyFilter
                  ? t('orgUsers.footer.filteredCount', { filtered: filtered.length, total: users.length })
                  : t('orgUsers.footer.totalCount', { count: users.length })}
              </span>
              {anyFilter && (
                <button onClick={clearFilters} className="text-xs text-gray-400 hover:text-brand-600 transition-colors">
                  {t('orgUsers.clearFilters')}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
