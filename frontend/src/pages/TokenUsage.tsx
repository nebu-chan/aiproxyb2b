import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { analyticsApi, type UserStat, type DepartmentStat, type ModelStat } from '../api/analytics';
import { UsageChart } from '../components/charts/UsageChart';
import { Layout } from '../components/Layout';

type SortOrder = 'asc' | 'desc';

function SortIcon({ field, sortBy, sortOrder }: { field: string; sortBy: string; sortOrder: SortOrder }) {
  if (field !== sortBy) {
    return <span className="ml-1.5 text-gray-300 text-base leading-none">↕</span>;
  }
  return <span className="ml-1.5 text-brand-600 text-base leading-none">{sortOrder === 'asc' ? '↑' : '↓'}</span>;
}

function useSortState<T extends string>(defaultField: T) {
  const [sortBy, setSortBy] = useState<T>(defaultField);
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  function handleSort(field: T) {
    if (field === sortBy) {
      setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
  }

  return { sortBy, sortOrder, handleSort };
}

function sortData<T>(data: T[], sortBy: keyof T, sortOrder: SortOrder): T[] {
  return [...data].sort((a, b) => {
    const av = a[sortBy];
    const bv = b[sortBy];
    if (av == null && bv == null) return 0;
    if (av == null) return sortOrder === 'asc' ? -1 : 1;
    if (bv == null) return sortOrder === 'asc' ? 1 : -1;
    if (typeof av === 'string' && typeof bv === 'string') {
      return sortOrder === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    if (av < bv) return sortOrder === 'asc' ? -1 : 1;
    if (av > bv) return sortOrder === 'asc' ? 1 : -1;
    return 0;
  });
}

type UserSortField = 'displayName' | 'tokens' | 'share' | 'requests' | 'topModel';
type DeptSortField = 'departmentName' | 'tokens' | 'share' | 'requests' | 'topModel';
type ModelSortField = 'model' | 'tokens' | 'share' | 'requests' | 'avgLatencyMs';

export function TokenUsage() {
  const { t, i18n } = useTranslation(['pages', 'common']);
  const [activeTab, setActiveTab] = useState<'users' | 'departments' | 'models'>('users');

  const userSort = useSortState<UserSortField>('tokens');
  const deptSort = useSortState<DeptSortField>('tokens');
  const modelSort = useSortState<ModelSortField>('tokens');

  const { data: overview } = useQuery({
    queryKey: ['analytics', 'overview'],
    queryFn: () => analyticsApi.overview(),
  });

  const { data: daily = [] } = useQuery({
    queryKey: ['analytics', 'daily'],
    queryFn: () => analyticsApi.daily(),
  });

  const { data: userStats = [], isLoading: usersLoading } = useQuery({
    queryKey: ['analytics', 'users'] as string[],
    queryFn: (): Promise<UserStat[]> => analyticsApi.users(),
  });

  const { data: deptStats = [], isLoading: deptsLoading } = useQuery({
    queryKey: ['analytics', 'departments'] as string[],
    queryFn: (): Promise<DepartmentStat[]> => analyticsApi.departments(),
  });

  const { data: modelStats = [], isLoading: modelsLoading } = useQuery({
    queryKey: ['analytics', 'models'] as string[],
    queryFn: (): Promise<ModelStat[]> => analyticsApi.models(),
  });

  const topUser = userStats[0];
  const topDept = deptStats[0];
  const totalTokens = overview?.totalTokens ?? 0;

  // Augmented user rows with computed fields for sorting
  const userRows = userStats.map((u) => ({
    ...u,
    displayName: (u.name || u.surname ? `${u.name ?? ''} ${u.surname ?? ''}`.trim() : u.email) ?? '',
    share: totalTokens > 0 ? (u.tokens / totalTokens) * 100 : 0,
  }));

  const deptRows = deptStats.map((d) => ({
    ...d,
    share: totalTokens > 0 ? (d.tokens / totalTokens) * 100 : 0,
  }));

  const modelRows = modelStats.map((m) => ({
    ...m,
    share: totalTokens > 0 ? (m.tokens / totalTokens) * 100 : 0,
  }));

  const sortedUsers = sortData(userRows, userSort.sortBy as keyof typeof userRows[0], userSort.sortOrder);
  const sortedDepts = sortData(deptRows, deptSort.sortBy as keyof typeof deptRows[0], deptSort.sortOrder);
  const sortedModels = sortData(modelRows, modelSort.sortBy as keyof typeof modelRows[0], modelSort.sortOrder);

  function UserTh({ field, label, align = 'left' }: { field: UserSortField; label: string; align?: 'left' | 'right' }) {
    return (
      <th
        className={`px-5 py-3 text-gray-500 font-medium cursor-pointer select-none hover:text-gray-800 transition-colors ${align === 'right' ? 'text-right' : 'text-left'}`}
        onClick={() => userSort.handleSort(field)}
      >
        <span className="inline-flex items-center gap-0">
          {label}
          <SortIcon field={field} sortBy={userSort.sortBy} sortOrder={userSort.sortOrder} />
        </span>
      </th>
    );
  }

  function DeptTh({ field, label, align = 'left' }: { field: DeptSortField; label: string; align?: 'left' | 'right' }) {
    return (
      <th
        className={`px-5 py-3 text-gray-500 font-medium cursor-pointer select-none hover:text-gray-800 transition-colors ${align === 'right' ? 'text-right' : 'text-left'}`}
        onClick={() => deptSort.handleSort(field)}
      >
        <span className="inline-flex items-center gap-0">
          {label}
          <SortIcon field={field} sortBy={deptSort.sortBy} sortOrder={deptSort.sortOrder} />
        </span>
      </th>
    );
  }

  function ModelTh({ field, label, align = 'left' }: { field: ModelSortField; label: string; align?: 'left' | 'right' }) {
    return (
      <th
        className={`px-5 py-3 text-gray-500 font-medium cursor-pointer select-none hover:text-gray-800 transition-colors ${align === 'right' ? 'text-right' : 'text-left'}`}
        onClick={() => modelSort.handleSort(field)}
      >
        <span className="inline-flex items-center gap-0">
          {label}
          <SortIcon field={field} sortBy={modelSort.sortBy} sortOrder={modelSort.sortOrder} />
        </span>
      </th>
    );
  }

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('tokenUsage.title')}</h1>
        <p className="text-gray-500 text-sm mt-1">{t('tokenUsage.subtitle')}</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-sm text-gray-500">{t('tokenUsage.cards.totalTokens')}</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{totalTokens.toLocaleString(i18n.language)}</div>
          <div className="text-xs text-gray-400 mt-0.5">{t('tokenUsage.cards.today', { count: (overview?.todayTokens ?? 0).toLocaleString(i18n.language) })}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-sm text-gray-500">{t('tokenUsage.cards.topUser')}</div>
          <div className="text-lg font-bold text-gray-900 mt-1 truncate">
            {topUser
              ? (topUser.name || topUser.surname
                ? `${topUser.name ?? ''} ${topUser.surname ?? ''}`.trim()
                : topUser.email)
              : '—'}
          </div>
          <div className="text-xs text-gray-400 mt-0.5">
            {topUser ? t('tokenUsage.cards.tokensCount', { count: topUser.tokens.toLocaleString(i18n.language) }) : t('tokenUsage.cards.noDataYet')}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-sm text-gray-500">{t('tokenUsage.cards.topDepartment')}</div>
          <div className="text-lg font-bold text-gray-900 mt-1 truncate">
            {topDept?.departmentName ?? '—'}
          </div>
          <div className="text-xs text-gray-400 mt-0.5">
            {topDept ? t('tokenUsage.cards.tokensCount', { count: topDept.tokens.toLocaleString(i18n.language) }) : t('tokenUsage.cards.noDataYet')}
          </div>
        </div>
      </div>

      {/* Daily chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <h2 className="text-base font-semibold text-gray-800 mb-4">{t('tokenUsage.chart.title')}</h2>
        <UsageChart data={daily} metric="tokens" />
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex border-b border-gray-200">
          {(['users', 'departments', 'models'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-6 py-3 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? 'text-brand-600 border-b-2 border-brand-600 bg-white'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab === 'users' ? t('tokenUsage.tabs.byUser') : tab === 'departments' ? t('tokenUsage.tabs.byDepartment') : t('tokenUsage.tabs.byModel')}
            </button>
          ))}
        </div>

        {activeTab === 'users' && (
          <>
            {usersLoading ? (
              <div className="p-8 text-center text-gray-400 text-sm">{t('common:loading')}</div>
            ) : userStats.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">{t('tokenUsage.noDataYet')}</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <UserTh field="displayName" label={t('tokenUsage.columns.user')}       align="left"  />
                    <UserTh field="tokens"      label={t('tokenUsage.columns.tokens')}     align="right" />
                    <UserTh field="share"       label={t('tokenUsage.columns.percentage')} align="right" />
                    <UserTh field="requests"    label={t('tokenUsage.columns.requests')}   align="right" />
                    <UserTh field="topModel"    label={t('tokenUsage.columns.topModel')}   align="right" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sortedUsers.map((u) => {
                    const displayName = u.name || u.surname
                      ? `${u.name ?? ''} ${u.surname ?? ''}`.trim()
                      : null;
                    return (
                      <tr key={u.userId} className="hover:bg-gray-50">
                        <td className="px-5 py-3">
                          <div className="font-medium text-gray-900">{displayName ?? u.email}</div>
                          {displayName && <div className="text-xs text-gray-400">{u.email}</div>}
                        </td>
                        <td className="px-5 py-3 text-right font-medium text-gray-900">
                          {u.tokens.toLocaleString(i18n.language)}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-brand-500 rounded-full"
                                style={{ width: `${Math.min(100, u.share)}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-500 w-10 text-right">
                              {u.share.toFixed(1)}%
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-3 text-right text-gray-600">
                          {u.requests.toLocaleString(i18n.language)}
                        </td>
                        <td className="px-5 py-3 text-right font-mono text-xs text-gray-500">
                          {u.topModel ?? '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </>
        )}

        {activeTab === 'departments' && (
          <>
            {deptsLoading ? (
              <div className="p-8 text-center text-gray-400 text-sm">{t('common:loading')}</div>
            ) : deptStats.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">{t('tokenUsage.noDataYet')}</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <DeptTh field="departmentName" label={t('tokenUsage.columns.department')} align="left"  />
                    <DeptTh field="tokens"         label={t('tokenUsage.columns.tokens')} align="right" />
                    <DeptTh field="share"          label={t('tokenUsage.columns.percentage')} align="right" />
                    <DeptTh field="requests"       label={t('tokenUsage.columns.requests')}   align="right" />
                    <DeptTh field="topModel"       label={t('tokenUsage.columns.topModel')}   align="right" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sortedDepts.map((d) => (
                    <tr key={d.departmentId} className="hover:bg-gray-50">
                      <td className="px-5 py-3 font-medium text-gray-900">{d.departmentName}</td>
                      <td className="px-5 py-3 text-right font-medium text-gray-900">
                        {d.tokens.toLocaleString(i18n.language)}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-brand-500 rounded-full"
                              style={{ width: `${Math.min(100, d.share)}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-500 w-10 text-right">
                            {d.share.toFixed(1)}%
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-right text-gray-600">
                        {d.requests.toLocaleString(i18n.language)}
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-xs text-gray-500">
                        {d.topModel ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {activeTab === 'models' && (
          <>
            {modelsLoading ? (
              <div className="p-8 text-center text-gray-400 text-sm">{t('common:loading')}</div>
            ) : modelStats.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">{t('tokenUsage.noDataYet')}</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <ModelTh field="model"       label={t('tokenUsage.columns.model')}       align="left"  />
                    <ModelTh field="tokens"      label={t('tokenUsage.columns.tokens')}      align="right" />
                    <ModelTh field="share"       label={t('tokenUsage.columns.percentage')}  align="right" />
                    <ModelTh field="requests"    label={t('tokenUsage.columns.requests')}    align="right" />
                    <ModelTh field="avgLatencyMs" label={t('tokenUsage.columns.avgLatency')} align="right" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sortedModels.map((m) => (
                    <tr key={m.model ?? 'unknown'} className="hover:bg-gray-50">
                      <td className="px-5 py-3 font-mono text-gray-900">{m.model ?? '—'}</td>
                      <td className="px-5 py-3 text-right font-medium text-gray-900">
                        {m.tokens.toLocaleString(i18n.language)}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-brand-500 rounded-full"
                              style={{ width: `${Math.min(100, m.share)}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-500 w-10 text-right">
                            {m.share.toFixed(1)}%
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-right text-gray-600">
                        {m.requests.toLocaleString(i18n.language)}
                      </td>
                      <td className="px-5 py-3 text-right text-gray-500">
                        {t('tokenUsage.msValue', { value: m.avgLatencyMs })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
