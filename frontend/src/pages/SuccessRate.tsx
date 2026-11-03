import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  analyticsApi,
  type DailyErrorStat, type StatusCodeStat, type ModelErrorStat, type UserErrorStat, type UsageLog,
} from '../api/analytics';
import { Layout } from '../components/Layout';
import { format, parseISO } from 'date-fns';
import { getDateFnsLocale } from '../i18n/dateLocale';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

// ── Sorting helpers ────────────────────────────────────────────────────────────

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
  return <span className="ml-1 text-brand-600">{order === 'asc' ? '↑' : '↓'}</span>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatusBadge({ code }: { code: number | null }) {
  if (code == null) return <span className="text-gray-400">—</span>;
  const ok = code < 400;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
      {code}
    </span>
  );
}

function userName(u: { userName: string | null; userSurname: string | null; userEmail: string | null }) {
  if (u.userName || u.userSurname) return `${u.userName ?? ''} ${u.userSurname ?? ''}`.trim();
  return u.userEmail ?? '—';
}

function StatusLogs({ statusCode }: { statusCode: number }) {
  const { t } = useTranslation(['pages', 'common']);
  const { data, isLoading } = useQuery({
    queryKey: ['analytics', 'logs', 'byStatus', statusCode],
    queryFn: () => analyticsApi.logs(50, 0, 'createdAt', 'desc', statusCode),
  });
  const logs: UsageLog[] = data?.data ?? [];

  if (isLoading) return <div className="px-5 py-3 text-xs text-gray-400">{t('common:loading')}</div>;
  if (!logs.length) return <div className="px-5 py-3 text-xs text-gray-400">{t('successRate.noRecords')}</div>;

  return (
    <div className="divide-y divide-gray-100">
      {logs.map((log) => (
        <div key={log.id} className="px-5 py-2.5 text-xs space-y-0.5">
          <div className="flex justify-between gap-4">
            <span className="text-gray-400 whitespace-nowrap">
              {format(new Date(log.createdAt), 'MMM d, HH:mm:ss', { locale: getDateFnsLocale() })}
            </span>
            <span className="font-mono text-gray-600 truncate">{log.model ?? '—'}</span>
            <span className="text-gray-600 whitespace-nowrap">{userName(log)}</span>
          </div>
          {log.errorMessage && (
            <div className="text-red-600 break-words">{log.errorMessage}</div>
          )}
          <div className="flex gap-4 text-gray-400">
            {log.endpoint && <span className="font-mono">{log.endpoint}</span>}
            {log.requestDurationMs != null && <span>{t('successRate.msValue', { value: log.requestDurationMs })}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SuccessRate() {
  const { t, i18n } = useTranslation(['pages', 'common']);
  const [expandedCode, setExpandedCode] = useState<number | null>(null);

  const statusSort = useSortState<keyof StatusCodeStat>('count');
  const modelSort  = useSortState<keyof ModelErrorStat>('errors');
  const userSort   = useSortState<keyof UserErrorStat>('errors');

  const { data, isLoading } = useQuery({
    queryKey: ['analytics', 'errors'],
    queryFn: analyticsApi.errors,
  });

  const ov = data?.overview;
  const successRate = ov && ov.totalRequests > 0
    ? ((ov.successRequests / ov.totalRequests) * 100).toFixed(1)
    : '—';
  const errorRate = ov && ov.totalRequests > 0
    ? ((ov.errorRequests / ov.totalRequests) * 100).toFixed(1)
    : '—';

  const dailyFormatted = (data?.daily ?? []).map((d: DailyErrorStat) => ({
    ...d,
    label: format(parseISO(d.date), 'MMM d', { locale: getDateFnsLocale() }),
    errorRate: d.total > 0 ? +((d.errors / d.total) * 100).toFixed(1) : 0,
  }));

  const sortedStatus = sortData(data?.byStatus ?? [], statusSort.sortBy, statusSort.sortOrder);
  const sortedModels = sortData(data?.byModel  ?? [], modelSort.sortBy,  modelSort.sortOrder);
  const sortedUsers  = sortData(data?.byUser   ?? [], userSort.sortBy,   userSort.sortOrder);

  function StatusTh({ col, label, right = true }: { col: keyof StatusCodeStat; label: string; right?: boolean }) {
    return (
      <th
        className={`px-5 py-2 text-gray-500 font-medium cursor-pointer select-none hover:text-gray-800 transition-colors ${right ? 'text-right' : 'text-left'}`}
        onClick={() => statusSort.handleSort(col)}
      >
        {label}<SortIcon active={statusSort.sortBy === col} order={statusSort.sortOrder} />
      </th>
    );
  }

  function ModelTh({ col, label, right = true }: { col: keyof ModelErrorStat; label: string; right?: boolean }) {
    return (
      <th
        className={`px-5 py-2 text-gray-500 font-medium cursor-pointer select-none hover:text-gray-800 transition-colors ${right ? 'text-right' : 'text-left'}`}
        onClick={() => modelSort.handleSort(col)}
      >
        {label}<SortIcon active={modelSort.sortBy === col} order={modelSort.sortOrder} />
      </th>
    );
  }

  function UserTh({ col, label, right = true }: { col: keyof UserErrorStat; label: string; right?: boolean }) {
    return (
      <th
        className={`px-5 py-2 text-gray-500 font-medium cursor-pointer select-none hover:text-gray-800 transition-colors ${right ? 'text-right' : 'text-left'}`}
        onClick={() => userSort.handleSort(col)}
      >
        {label}<SortIcon active={userSort.sortBy === col} order={userSort.sortOrder} />
      </th>
    );
  }

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('successRate.title')}</h1>
        <p className="text-gray-500 text-sm mt-1">{t('successRate.subtitle')}</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-sm text-gray-500">{t('successRate.cards.successRate')}</div>
          <div className="text-2xl font-bold text-green-600 mt-1">{successRate}%</div>
          <div className="text-xs text-gray-400 mt-0.5">{t('successRate.cards.succeeded', { count: ov?.successRequests.toLocaleString(i18n.language) ?? '—' })}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-sm text-gray-500">{t('successRate.cards.errorRate')}</div>
          <div className="text-2xl font-bold text-red-500 mt-1">{errorRate}%</div>
          <div className="text-xs text-gray-400 mt-0.5">{t('successRate.cards.failed', { count: ov?.errorRequests.toLocaleString(i18n.language) ?? '—' })}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-sm text-gray-500">{t('successRate.cards.totalRequests')}</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{ov?.totalRequests.toLocaleString(i18n.language) ?? '—'}</div>
          <div className="text-xs text-gray-400 mt-0.5">{t('successRate.cards.last30Days')}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-sm text-gray-500">{t('successRate.cards.distinctErrorCodes')}</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{data?.byStatus.length ?? '—'}</div>
          <div className="text-xs text-gray-400 mt-0.5">{t('successRate.cards.uniqueStatusCodes')}</div>
        </div>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-base font-semibold text-gray-800 mb-4">{t('successRate.charts.requestsOverTime')}</h2>
          {isLoading ? (
            <div className="h-52 flex items-center justify-center text-gray-400 text-sm">{t('common:loading')}</div>
          ) : (
            <ResponsiveContainer width="100%" height={208}>
              <AreaChart data={dailyFormatted} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradSuccess" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradError" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} width={40} />
                <Tooltip />
                <Legend />
                <Area type="monotone" dataKey="successes" name={t('successRate.charts.success')} stroke="#22c55e" fill="url(#gradSuccess)" strokeWidth={2} />
                <Area type="monotone" dataKey="errors" name={t('successRate.charts.errors')} stroke="#ef4444" fill="url(#gradError)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-base font-semibold text-gray-800 mb-4">{t('successRate.charts.errorRateOverTime')}</h2>
          {isLoading ? (
            <div className="h-52 flex items-center justify-center text-gray-400 text-sm">{t('common:loading')}</div>
          ) : (
            <ResponsiveContainer width="100%" height={208}>
              <AreaChart data={dailyFormatted} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradErrRate" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} width={40} unit="%" domain={[0, 100]} />
                <Tooltip formatter={(v: number) => `${v}%`} />
                <Area type="monotone" dataKey="errorRate" name={t('successRate.charts.errorRate')} stroke="#f97316" fill="url(#gradErrRate)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Tables row */}
      <div className="grid grid-cols-3 gap-6">
        {/* By status code */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-800">{t('successRate.byStatusCode.title')}</h2>
          </div>
          {isLoading ? (
            <div className="p-6 text-center text-gray-400 text-sm">{t('common:loading')}</div>
          ) : sortedStatus.length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-sm">{t('successRate.noErrors')}</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <StatusTh col="statusCode" label={t('successRate.byStatusCode.code')}  right={false} />
                  <StatusTh col="count"      label={t('successRate.byStatusCode.count')}               />
                  <th className="text-right px-5 py-2 text-gray-500 font-medium">{t('successRate.byStatusCode.pctOfErrors')}</th>
                </tr>
              </thead>
              <tbody>
                {sortedStatus.map((s) => {
                  const pct = ov && ov.errorRequests > 0
                    ? ((s.count / ov.errorRequests) * 100).toFixed(1)
                    : '0';
                  const isExpanded = expandedCode === s.statusCode;
                  return (
                    <>
                      <tr
                        key={s.statusCode}
                        onClick={() => setExpandedCode(isExpanded ? null : s.statusCode)}
                        className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer"
                      >
                        <td className="px-5 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="text-gray-300 text-xs">{isExpanded ? '▾' : '▸'}</span>
                            <StatusBadge code={s.statusCode} />
                          </div>
                        </td>
                        <td className="px-5 py-2.5 text-right font-medium text-gray-800">{s.count}</td>
                        <td className="px-5 py-2.5 text-right text-gray-500">{pct}%</td>
                      </tr>
                      {isExpanded && s.statusCode != null && (
                        <tr key={`${s.statusCode}-detail`}>
                          <td colSpan={3} className="bg-gray-50 border-t border-gray-100">
                            <StatusLogs statusCode={s.statusCode} />
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* By model */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-800">{t('successRate.byModel.title')}</h2>
          </div>
          {isLoading ? (
            <div className="p-6 text-center text-gray-400 text-sm">{t('common:loading')}</div>
          ) : sortedModels.length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-sm">{t('successRate.noErrors')}</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <ModelTh col="model"  label={t('successRate.byModel.model')}      right={false} />
                  <ModelTh col="errors" label={t('successRate.byModel.errors')}                   />
                  <ModelTh col="total"  label={t('successRate.charts.errorRate')}                  />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sortedModels.map((m) => {
                  const rate = m.total > 0 ? ((m.errors / m.total) * 100).toFixed(1) : '0';
                  return (
                    <tr key={m.model ?? 'unknown'} className="hover:bg-gray-50">
                      <td className="px-5 py-2.5 font-mono text-xs text-gray-700">{m.model ?? '—'}</td>
                      <td className="px-5 py-2.5 text-right font-medium text-red-600">{m.errors}</td>
                      <td className="px-5 py-2.5 text-right text-gray-500">{rate}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* By user */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-800">{t('successRate.byUser.title')}</h2>
          </div>
          {isLoading ? (
            <div className="p-6 text-center text-gray-400 text-sm">{t('common:loading')}</div>
          ) : sortedUsers.length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-sm">{t('successRate.noErrors')}</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <UserTh col="userName" label={t('successRate.byUser.user')}   right={false} />
                  <UserTh col="errors"   label={t('successRate.byModel.errors')}               />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sortedUsers.map((u, i) => (
                  <tr key={u.userId ?? i} className="hover:bg-gray-50">
                    <td className="px-5 py-2.5 text-gray-800">{userName(u)}</td>
                    <td className="px-5 py-2.5 text-right font-medium text-red-600">{u.errors}</td>
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
