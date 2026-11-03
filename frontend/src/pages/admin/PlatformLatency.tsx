import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { adminApi } from '../../api/admin';
import { Layout } from '../../components/Layout';
import { format, parseISO } from 'date-fns';
import { getDateFnsLocale } from '../../i18n/dateLocale';
import {
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

type SortOrder = 'asc' | 'desc';

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

function SortIcon({ active, order }: { active: boolean; order: SortOrder }) {
  if (!active) return <span className="ml-1 text-gray-300">↕</span>;
  return <span className="ml-1 text-brand-600">{order === 'asc' ? '↑' : '↓'}</span>;
}

type ModelSortKey = 'model' | 'requests' | 'avgMs' | 'p50' | 'p95' | 'p99' | 'minMs' | 'maxMs';

export function PlatformLatency() {
  const { t, i18n } = useTranslation(['pages', 'common']);
  const modelSort = useSortState<ModelSortKey>('avgMs');

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'analytics', 'latency'],
    queryFn: adminApi.platformLatency,
  });

  const ov = data?.overview;

  const dailyFormatted = (data?.daily ?? []).map((d) => ({
    ...d,
    label: format(parseISO(d.date), 'MMM d', { locale: getDateFnsLocale() }),
  }));

  const sortedModels = sortData(data?.byModel ?? [], modelSort.sortBy, modelSort.sortOrder);

  function ModelTh({ col, label, right = true }: { col: ModelSortKey; label: string; right?: boolean }) {
    return (
      <th
        className={`px-5 py-3 text-gray-500 font-medium cursor-pointer select-none hover:text-gray-800 transition-colors ${right ? 'text-right' : 'text-left'}`}
        onClick={() => modelSort.handleSort(col)}
      >
        {label}<SortIcon active={modelSort.sortBy === col} order={modelSort.sortOrder} />
      </th>
    );
  }

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('platformLatency.title')}</h1>
        <p className="text-gray-500 text-sm mt-1">{t('platformLatency.subtitle')}</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        {[
          { label: t('platformLatency.summary.average'), value: ov?.avgMs },
          { label: t('platformLatency.summary.median'),  value: ov?.p50   },
          { label: t('platformLatency.summary.p95'),      value: ov?.p95   },
          { label: t('platformLatency.summary.p99'),      value: ov?.p99   },
          { label: t('platformLatency.summary.fastest'),  value: ov?.minMs },
          { label: t('platformLatency.summary.slowest'),  value: ov?.maxMs },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="text-xs text-gray-500">{label}</div>
            <div className="text-xl font-bold text-gray-900 mt-1">
              {value != null ? t('platformLatency.msValue', { value: value.toLocaleString(i18n.language) }) : '—'}
            </div>
          </div>
        ))}
      </div>

      {/* Daily latency chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <h2 className="text-base font-semibold text-gray-800 mb-4">{t('platformLatency.chart.title')}</h2>
        {isLoading ? (
          <div className="h-52 flex items-center justify-center text-gray-400 text-sm">{t('common:loading')}</div>
        ) : (
          <ResponsiveContainer width="100%" height={208}>
            <LineChart data={dailyFormatted} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} width={55} unit=" ms" />
              <Tooltip formatter={(v: number) => t('platformLatency.msValue', { value: v.toLocaleString(i18n.language) })} />
              <Legend />
              <Line type="monotone" dataKey="avgMs" name={t('platformLatency.chart.avg')} stroke="#3b82f6" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="p95" name={t('platformLatency.summary.p95')} stroke="#f97316" strokeWidth={2} dot={false} strokeDasharray="4 2" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* By model table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
        <div className="px-5 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-800">{t('platformLatency.table.title')}</h2>
        </div>
        {isLoading ? (
          <div className="p-8 text-center text-gray-400 text-sm">{t('common:loading')}</div>
        ) : sortedModels.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">{t('platformLatency.table.noData')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <ModelTh col="model"    label={t('platformLatency.table.columns.model')}    right={false} />
                <ModelTh col="requests" label={t('platformLatency.table.columns.requests')}               />
                <ModelTh col="avgMs"    label={t('platformLatency.chart.avg')}                             />
                <ModelTh col="p50"      label={t('platformLatency.summary.p50')}                           />
                <ModelTh col="p95"      label={t('platformLatency.summary.p95')}                           />
                <ModelTh col="p99"      label={t('platformLatency.summary.p99')}                           />
                <ModelTh col="minMs"    label={t('platformLatency.table.columns.min')}                     />
                <ModelTh col="maxMs"    label={t('platformLatency.table.columns.max')}                     />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedModels.map((m) => (
                <tr key={m.model ?? 'unknown'} className="hover:bg-gray-50">
                  <td className="px-5 py-3 font-mono text-xs text-gray-800">{m.model ?? '—'}</td>
                  <td className="px-5 py-3 text-right text-gray-600">{m.requests.toLocaleString(i18n.language)}</td>
                  <td className="px-5 py-3 text-right font-medium text-gray-900">{t('platformLatency.msValue', { value: m.avgMs.toLocaleString(i18n.language) })}</td>
                  <td className="px-5 py-3 text-right text-gray-600">{t('platformLatency.msValue', { value: m.p50.toLocaleString(i18n.language) })}</td>
                  <td className="px-5 py-3 text-right text-orange-600">{t('platformLatency.msValue', { value: m.p95.toLocaleString(i18n.language) })}</td>
                  <td className="px-5 py-3 text-right text-red-500">{t('platformLatency.msValue', { value: m.p99.toLocaleString(i18n.language) })}</td>
                  <td className="px-5 py-3 text-right text-gray-400">{t('platformLatency.msValue', { value: m.minMs.toLocaleString(i18n.language) })}</td>
                  <td className="px-5 py-3 text-right text-gray-400">{t('platformLatency.msValue', { value: m.maxMs.toLocaleString(i18n.language) })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Slowest requests */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-800">{t('platformLatency.slowest.title')}</h2>
        </div>
        {isLoading ? (
          <div className="p-8 text-center text-gray-400 text-sm">{t('common:loading')}</div>
        ) : (data?.slowest ?? []).length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">{t('platformLatency.table.noData')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-5 py-3 text-gray-500 font-medium">{t('platformLatency.slowest.columns.time')}</th>
                <th className="text-left px-5 py-3 text-gray-500 font-medium">{t('platformLatency.table.columns.model')}</th>
                <th className="text-left px-5 py-3 text-gray-500 font-medium">{t('platformLatency.slowest.columns.organization')}</th>
                <th className="text-right px-5 py-3 text-gray-500 font-medium">{t('platformLatency.slowest.columns.duration')}</th>
                <th className="text-right px-5 py-3 text-gray-500 font-medium">{t('platformLatency.slowest.columns.tokens')}</th>
                <th className="text-right px-5 py-3 text-gray-500 font-medium">{t('platformLatency.slowest.columns.status')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data?.slowest.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-5 py-2.5 text-gray-500 whitespace-nowrap">
                    {format(parseISO(r.createdAt), 'MMM d, HH:mm:ss', { locale: getDateFnsLocale() })}
                  </td>
                  <td className="px-5 py-2.5 font-mono text-xs text-gray-700">{r.model ?? '—'}</td>
                  <td className="px-5 py-2.5 text-gray-800">{r.orgName}</td>
                  <td className="px-5 py-2.5 text-right font-medium text-gray-900">
                    {r.requestDurationMs != null ? t('platformLatency.msValue', { value: r.requestDurationMs.toLocaleString(i18n.language) }) : '—'}
                  </td>
                  <td className="px-5 py-2.5 text-right text-gray-600">
                    {r.totalTokens?.toLocaleString(i18n.language) ?? '—'}
                  </td>
                  <td className="px-5 py-2.5 text-right">
                    {r.statusCode != null ? (
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${r.statusCode < 400 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {r.statusCode}
                      </span>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Layout>
  );
}
