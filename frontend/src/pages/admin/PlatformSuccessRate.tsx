import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { adminApi } from '../../api/admin';
import { Layout } from '../../components/Layout';
import { format, parseISO } from 'date-fns';
import { getDateFnsLocale } from '../../i18n/dateLocale';
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

function StatusBadge({ code }: { code: number | null }) {
  if (code == null) return <span className="text-gray-400">—</span>;
  const ok = code < 400;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
      {code}
    </span>
  );
}

// ── Types for sort keys ────────────────────────────────────────────────────────

type StatusSortKey = 'statusCode' | 'count';
type ModelSortKey = 'model' | 'errors' | 'total';
type OrgSortKey = 'orgName' | 'errors' | 'total';

// ── Component ─────────────────────────────────────────────────────────────────

export function PlatformSuccessRate() {
  const { t, i18n } = useTranslation(['pages', 'common']);
  const statusSort = useSortState<StatusSortKey>('count');
  const modelSort  = useSortState<ModelSortKey>('errors');
  const orgSort    = useSortState<OrgSortKey>('errors');

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'analytics', 'errors'],
    queryFn: adminApi.platformErrors,
  });

  const ov = data?.overview;
  const successRate = ov && ov.totalRequests > 0
    ? ((ov.successRequests / ov.totalRequests) * 100).toFixed(1)
    : '—';
  const errorRate = ov && ov.totalRequests > 0
    ? ((ov.errorRequests / ov.totalRequests) * 100).toFixed(1)
    : '—';

  const dailyFormatted = (data?.daily ?? []).map((d) => ({
    ...d,
    label: format(parseISO(d.date), 'MMM d', { locale: getDateFnsLocale() }),
    errorRate: d.total > 0 ? +((d.errors / d.total) * 100).toFixed(1) : 0,
  }));

  const sortedStatus = sortData(data?.byStatus ?? [], statusSort.sortBy, statusSort.sortOrder);
  const sortedModels = sortData(data?.byModel  ?? [], modelSort.sortBy,  modelSort.sortOrder);
  const sortedOrgs   = sortData(data?.byOrg    ?? [], orgSort.sortBy,    orgSort.sortOrder);

  function StatusTh({ col, label, right = true }: { col: StatusSortKey; label: string; right?: boolean }) {
    return (
      <th
        className={`px-5 py-2 text-gray-500 font-medium cursor-pointer select-none hover:text-gray-800 transition-colors ${right ? 'text-right' : 'text-left'}`}
        onClick={() => statusSort.handleSort(col)}
      >
        {label}<SortIcon active={statusSort.sortBy === col} order={statusSort.sortOrder} />
      </th>
    );
  }

  function ModelTh({ col, label, right = true }: { col: ModelSortKey; label: string; right?: boolean }) {
    return (
      <th
        className={`px-5 py-2 text-gray-500 font-medium cursor-pointer select-none hover:text-gray-800 transition-colors ${right ? 'text-right' : 'text-left'}`}
        onClick={() => modelSort.handleSort(col)}
      >
        {label}<SortIcon active={modelSort.sortBy === col} order={modelSort.sortOrder} />
      </th>
    );
  }

  function OrgTh({ col, label, right = true }: { col: OrgSortKey; label: string; right?: boolean }) {
    return (
      <th
        className={`px-5 py-2 text-gray-500 font-medium cursor-pointer select-none hover:text-gray-800 transition-colors ${right ? 'text-right' : 'text-left'}`}
        onClick={() => orgSort.handleSort(col)}
      >
        {label}<SortIcon active={orgSort.sortBy === col} order={orgSort.sortOrder} />
      </th>
    );
  }

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('platformSuccessRate.title')}</h1>
        <p className="text-gray-500 text-sm mt-1">{t('platformSuccessRate.subtitle')}</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-sm text-gray-500">{t('platformSuccessRate.summary.successRate')}</div>
          <div className="text-2xl font-bold text-green-600 mt-1">{successRate}%</div>
          <div className="text-xs text-gray-400 mt-0.5">{t('platformSuccessRate.summary.succeeded', { count: ov?.successRequests.toLocaleString(i18n.language) ?? '—' })}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-sm text-gray-500">{t('platformSuccessRate.summary.errorRate')}</div>
          <div className="text-2xl font-bold text-red-500 mt-1">{errorRate}%</div>
          <div className="text-xs text-gray-400 mt-0.5">{t('platformSuccessRate.summary.failed', { count: ov?.errorRequests.toLocaleString(i18n.language) ?? '—' })}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-sm text-gray-500">{t('platformSuccessRate.summary.totalRequests')}</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{ov?.totalRequests.toLocaleString(i18n.language) ?? '—'}</div>
          <div className="text-xs text-gray-400 mt-0.5">{t('platformSuccessRate.summary.last30Days')}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-sm text-gray-500">{t('platformSuccessRate.summary.distinctErrorCodes')}</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{data?.byStatus.length ?? '—'}</div>
          <div className="text-xs text-gray-400 mt-0.5">{t('platformSuccessRate.summary.uniqueStatusCodes')}</div>
        </div>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-base font-semibold text-gray-800 mb-4">{t('platformSuccessRate.chart.requestsOverTime')}</h2>
          {isLoading ? (
            <div className="h-52 flex items-center justify-center text-gray-400 text-sm">{t('common:loading')}</div>
          ) : (
            <ResponsiveContainer width="100%" height={208}>
              <AreaChart data={dailyFormatted} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradSuccessPlat" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradErrorPlat" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} width={40} />
                <Tooltip />
                <Legend />
                <Area type="monotone" dataKey="successes" name={t('platformSuccessRate.chart.success')} stroke="#22c55e" fill="url(#gradSuccessPlat)" strokeWidth={2} />
                <Area type="monotone" dataKey="errors" name={t('platformSuccessRate.chart.errors')} stroke="#ef4444" fill="url(#gradErrorPlat)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-base font-semibold text-gray-800 mb-4">{t('platformSuccessRate.chart.errorRateOverTime')}</h2>
          {isLoading ? (
            <div className="h-52 flex items-center justify-center text-gray-400 text-sm">{t('common:loading')}</div>
          ) : (
            <ResponsiveContainer width="100%" height={208}>
              <AreaChart data={dailyFormatted} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradErrRatePlat" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} width={40} unit="%" domain={[0, 100]} />
                <Tooltip formatter={(v: number) => `${v}%`} />
                <Area type="monotone" dataKey="errorRate" name={t('platformSuccessRate.chart.errorRate')} stroke="#f97316" fill="url(#gradErrRatePlat)" strokeWidth={2} />
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
            <h2 className="text-sm font-semibold text-gray-800">{t('platformSuccessRate.byStatus.title')}</h2>
          </div>
          {isLoading ? (
            <div className="p-6 text-center text-gray-400 text-sm">{t('common:loading')}</div>
          ) : sortedStatus.length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-sm">{t('platformSuccessRate.noErrors')}</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <StatusTh col="statusCode" label={t('platformSuccessRate.byStatus.code')}       right={false} />
                  <StatusTh col="count"      label={t('platformSuccessRate.byStatus.count')}                    />
                  <th className="text-right px-5 py-2 text-gray-500 font-medium">{t('platformSuccessRate.byStatus.percentOfErrors')}</th>
                </tr>
              </thead>
              <tbody>
                {sortedStatus.map((s) => {
                  const pct = ov && ov.errorRequests > 0
                    ? ((s.count / ov.errorRequests) * 100).toFixed(1)
                    : '0';
                  return (
                    <tr key={s.statusCode ?? 'null'} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-5 py-2.5">
                        <StatusBadge code={s.statusCode} />
                      </td>
                      <td className="px-5 py-2.5 text-right font-medium text-gray-800">{s.count}</td>
                      <td className="px-5 py-2.5 text-right text-gray-500">{pct}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* By model */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-800">{t('platformSuccessRate.byModel.title')}</h2>
          </div>
          {isLoading ? (
            <div className="p-6 text-center text-gray-400 text-sm">{t('common:loading')}</div>
          ) : sortedModels.length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-sm">{t('platformSuccessRate.noErrors')}</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <ModelTh col="model"  label={t('platformSuccessRate.byModel.model')}      right={false} />
                  <ModelTh col="errors" label={t('platformSuccessRate.byModel.errors')}                   />
                  <ModelTh col="total"  label={t('platformSuccessRate.byModel.errorRate')}               />
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

        {/* By org */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-800">{t('platformSuccessRate.byOrg.title')}</h2>
          </div>
          {isLoading ? (
            <div className="p-6 text-center text-gray-400 text-sm">{t('common:loading')}</div>
          ) : sortedOrgs.length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-sm">{t('platformSuccessRate.noErrors')}</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <OrgTh col="orgName" label={t('platformSuccessRate.byOrg.organization')} right={false} />
                  <OrgTh col="errors"  label={t('platformSuccessRate.byOrg.errors')}                     />
                  <OrgTh col="total"   label={t('platformSuccessRate.byOrg.errorRate')}                 />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sortedOrgs.map((o) => {
                  const rate = o.total > 0 ? ((o.errors / o.total) * 100).toFixed(1) : '0';
                  return (
                    <tr key={o.orgId} className="hover:bg-gray-50">
                      <td className="px-5 py-2.5 text-gray-800">{o.orgName}</td>
                      <td className="px-5 py-2.5 text-right font-medium text-red-600">{o.errors}</td>
                      <td className="px-5 py-2.5 text-right text-gray-500">{rate}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Layout>
  );
}
