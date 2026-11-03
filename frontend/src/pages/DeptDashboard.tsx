import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { orgApi } from '../api/org';
import { Layout } from '../components/Layout';
import { format, parseISO } from 'date-fns';
import { getDateFnsLocale } from '../i18n/dateLocale';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

interface DeptOverview {
  totalRequests: number;
  successRequests: number;
  totalTokens: number;
  avgLatencyMs: number;
}

interface DeptModelStat {
  model: string | null;
  requests: number;
  tokens: number;
  avgLatencyMs: number;
}

interface DeptDailyStat {
  date: string;
  requests: number;
  tokens: number;
  errors: number;
}

interface DeptUserStat {
  userId: string;
  name: string | null;
  surname: string | null;
  email: string;
  requests: number;
  tokens: number;
  topModel: string | null;
}

interface DeptStats {
  overview: DeptOverview;
  byModel: DeptModelStat[];
  daily: DeptDailyStat[];
  byUser: DeptUserStat[];
}

type SortOrder = 'asc' | 'desc';

function useSortState<T extends string>(defaultCol: T) {
  const [sortBy, setSortBy] = useState<T>(defaultCol);
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  function handleSort(col: T) {
    if (col === sortBy) setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(col); setSortOrder('desc'); }
  }

  return { sortBy, sortOrder, handleSort };
}

function sortData<T>(data: T[], key: keyof T, order: SortOrder): T[] {
  return [...data].sort((a, b) => {
    const av = a[key] ?? '';
    const bv = b[key] ?? '';
    if (av < bv) return order === 'asc' ? -1 : 1;
    if (av > bv) return order === 'asc' ? 1 : -1;
    return 0;
  });
}

function SortIcon({ active, order }: { active: boolean; order: SortOrder }) {
  if (!active) return <span className="ml-1 text-gray-300">↕</span>;
  return <span className="ml-1">{order === 'asc' ? '↑' : '↓'}</span>;
}

function displayName(u: { name: string | null; surname: string | null; email: string }) {
  if (u.name || u.surname) return `${u.name ?? ''} ${u.surname ?? ''}`.trim();
  return u.email;
}

export function DeptDashboard() {
  const { t, i18n } = useTranslation(['pages', 'common']);
  const { data, isLoading } = useQuery<{ data: DeptStats }>({
    queryKey: ['analytics', 'my-department'],
    queryFn: () => api.get('/analytics/my-department').then((r) => r.data),
  });

  const { data: myBalance } = useQuery({
    queryKey: ['org', 'me', 'balance'],
    queryFn: orgApi.balance.me,
  });

  const ov = data?.data.overview;
  const byModel = data?.data.byModel ?? [];
  const byUser = data?.data.byUser ?? [];
  const daily = (data?.data.daily ?? []).map((d) => ({
    ...d,
    label: format(parseISO(d.date), 'MMM d', { locale: getDateFnsLocale() }),
  }));

  const totalTokens = ov?.totalTokens ?? 0;

  const modelSort = useSortState<keyof DeptModelStat>('tokens');
  const userSort = useSortState<keyof DeptUserStat>('tokens');

  const sortedModels = sortData(byModel, modelSort.sortBy, modelSort.sortOrder);
  const sortedUsers = sortData(byUser, userSort.sortBy, userSort.sortOrder);

  function ModelTh({ col, label, right = true }: { col: keyof DeptModelStat; label: string; right?: boolean }) {
    return (
      <th
        className={`px-5 py-2 text-xs font-medium text-gray-500 cursor-pointer select-none hover:text-gray-700 ${right ? 'text-right' : 'text-left'}`}
        onClick={() => modelSort.handleSort(col)}
      >
        {label}<SortIcon active={modelSort.sortBy === col} order={modelSort.sortOrder} />
      </th>
    );
  }

  function UserTh({ col, label, right = true }: { col: keyof DeptUserStat; label: string; right?: boolean }) {
    return (
      <th
        className={`px-5 py-2 text-xs font-medium text-gray-500 cursor-pointer select-none hover:text-gray-700 ${right ? 'text-right' : 'text-left'}`}
        onClick={() => userSort.handleSort(col)}
      >
        {label}<SortIcon active={userSort.sortBy === col} order={userSort.sortOrder} />
      </th>
    );
  }

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('deptDashboard.title')}</h1>
        <p className="text-gray-500 text-sm mt-1">{t('deptDashboard.subtitle')}</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-sm text-gray-500">{t('deptDashboard.stats.totalRequests')}</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{ov?.totalRequests.toLocaleString(i18n.language) ?? '—'}</div>
          <div className="text-xs text-gray-400 mt-0.5">{t('deptDashboard.stats.last30Days')}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-sm text-gray-500">{t('deptDashboard.stats.totalTokens')}</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{totalTokens.toLocaleString(i18n.language)}</div>
          <div className="text-xs text-gray-400 mt-0.5">{t('deptDashboard.stats.last30Days')}</div>
        </div>
        {myBalance?.deptBalance && (
          <div className={`bg-white rounded-xl border p-5 ${myBalance.deptBalance.spentRub >= myBalance.deptBalance.limitRub ? 'border-red-200 bg-red-50/30' : 'border-gray-200'}`}>
            <div className="text-sm text-gray-500">{t('deptDashboard.stats.deptSpendThisMonth')}</div>
            <div className={`text-2xl font-bold mt-1 ${myBalance.deptBalance.spentRub >= myBalance.deptBalance.limitRub ? 'text-red-600' : 'text-gray-900'}`}>
              {myBalance.deptBalance.spentRub.toFixed(2)} ₽
            </div>
            <div className="text-xs text-gray-400 mt-0.5">
              {t('deptDashboard.stats.ofLimitSince', {
                limit: myBalance.deptBalance.limitRub.toFixed(2),
                date: new Date(myBalance.periodStart).toLocaleDateString(i18n.language, { month: 'short', day: 'numeric' }),
              })}
            </div>
          </div>
        )}
      </div>

      {/* Daily chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <h2 className="text-base font-semibold text-gray-800 mb-4">{t('deptDashboard.requestsPerDay')}</h2>
        {isLoading ? (
          <div className="h-52 flex items-center justify-center text-gray-400 text-sm">{t('common:loading')}</div>
        ) : daily.length === 0 ? (
          <div className="h-52 flex items-center justify-center text-gray-400 text-sm">{t('deptDashboard.noDataYet')}</div>
        ) : (
          <ResponsiveContainer width="100%" height={208}>
            <AreaChart data={daily} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="deptGradReq" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} width={40} />
              <Tooltip />
              <Legend />
              <Area type="monotone" dataKey="requests" name={t('deptDashboard.chartLegend.requests')} stroke="#3b82f6" fill="url(#deptGradReq)" strokeWidth={2} />
              <Area type="monotone" dataKey="errors" name={t('deptDashboard.chartLegend.errors')} stroke="#ef4444" fill="none" strokeWidth={2} strokeDasharray="4 2" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* By model + By user tables */}
      <div className="grid grid-cols-2 gap-6">
        {/* By model */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-800">{t('deptDashboard.byModel.title')}</h2>
          </div>
          {isLoading ? (
            <div className="p-6 text-center text-gray-400 text-sm">{t('common:loading')}</div>
          ) : sortedModels.length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-sm">{t('deptDashboard.noDataYet')}</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <ModelTh col="model" label={t('deptDashboard.columns.model')} right={false} />
                  <ModelTh col="requests" label={t('deptDashboard.columns.requests')} />
                  <ModelTh col="tokens" label={t('deptDashboard.columns.tokens')} />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sortedModels.map((m) => (
                  <tr key={m.model ?? 'unknown'} className="hover:bg-gray-50">
                    <td className="px-5 py-2.5 font-mono text-xs text-gray-700">{m.model ?? '—'}</td>
                    <td className="px-5 py-2.5 text-right text-gray-600">{m.requests.toLocaleString(i18n.language)}</td>
                    <td className="px-5 py-2.5 text-right font-medium text-gray-900">{m.tokens.toLocaleString(i18n.language)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* By user */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-800">{t('deptDashboard.byUser.title')}</h2>
          </div>
          {isLoading ? (
            <div className="p-6 text-center text-gray-400 text-sm">{t('common:loading')}</div>
          ) : sortedUsers.length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-sm">{t('deptDashboard.noDataYet')}</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <UserTh col="name" label={t('deptDashboard.columns.user')} right={false} />
                  <UserTh col="requests" label={t('deptDashboard.columns.requests')} />
                  <UserTh col="tokens" label={t('deptDashboard.columns.tokens')} />
                  <UserTh col="topModel" label={t('deptDashboard.columns.topModel')} />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sortedUsers.map((u) => (
                  <tr key={u.userId} className="hover:bg-gray-50">
                    <td className="px-5 py-2.5">
                      <div className="font-medium text-gray-900">{displayName(u)}</div>
                      {(u.name || u.surname) && <div className="text-xs text-gray-400">{u.email}</div>}
                    </td>
                    <td className="px-5 py-2.5 text-right text-gray-600">{u.requests.toLocaleString(i18n.language)}</td>
                    <td className="px-5 py-2.5 text-right font-medium text-gray-900">{u.tokens.toLocaleString(i18n.language)}</td>
                    <td className="px-5 py-2.5 text-right font-mono text-xs text-gray-500">{u.topModel ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Layout>
  );
}
