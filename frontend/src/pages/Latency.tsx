import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { analyticsApi, type DailyLatencyStat, type SlowestRequest } from '../api/analytics';
import { Layout } from '../components/Layout';
import { format, parseISO } from 'date-fns';
import { getDateFnsLocale } from '../i18n/dateLocale';
import {
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

function userName(r: SlowestRequest) {
  if (r.userName || r.userSurname) return `${r.userName ?? ''} ${r.userSurname ?? ''}`.trim();
  return r.userEmail ?? '—';
}

export function Latency() {
  const { t, i18n } = useTranslation(['pages', 'common']);
  const { data, isLoading } = useQuery({
    queryKey: ['analytics', 'latency'],
    queryFn: analyticsApi.latency,
  });

  const ov = data?.overview;

  const dailyFormatted = (data?.daily ?? []).map((d: DailyLatencyStat) => ({
    ...d,
    label: format(parseISO(d.date), 'MMM d', { locale: getDateFnsLocale() }),
  }));

  const msValue = (value: number) => t('latency.msValue', { value: value.toLocaleString(i18n.language) });

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('latency.title')}</h1>
        <p className="text-gray-500 text-sm mt-1">{t('latency.subtitle')}</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        {[
          { label: t('latency.cards.average'), value: ov?.avgMs },
          { label: t('latency.cards.median'), value: ov?.p50 },
          { label: t('latency.cards.p95'), value: ov?.p95 },
          { label: t('latency.cards.p99'), value: ov?.p99 },
          { label: t('latency.cards.fastest'), value: ov?.minMs },
          { label: t('latency.cards.slowest'), value: ov?.maxMs },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="text-xs text-gray-500">{label}</div>
            <div className="text-xl font-bold text-gray-900 mt-1">
              {value != null ? msValue(value) : '—'}
            </div>
          </div>
        ))}
      </div>

      {/* Daily latency chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <h2 className="text-base font-semibold text-gray-800 mb-4">{t('latency.chart.title')}</h2>
        {isLoading ? (
          <div className="h-52 flex items-center justify-center text-gray-400 text-sm">{t('common:loading')}</div>
        ) : (
          <ResponsiveContainer width="100%" height={208}>
            <LineChart data={dailyFormatted} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} width={55} unit=" ms" />
              <Tooltip formatter={(v: number) => msValue(v)} />
              <Legend />
              <Line type="monotone" dataKey="avgMs" name={t('latency.chart.avg')} stroke="#3b82f6" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="p95" name={t('latency.cards.p95')} stroke="#f97316" strokeWidth={2} dot={false} strokeDasharray="4 2" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* By model table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
        <div className="px-5 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-800">{t('latency.byModel.title')}</h2>
        </div>
        {isLoading ? (
          <div className="p-8 text-center text-gray-400 text-sm">{t('common:loading')}</div>
        ) : data?.byModel.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">{t('latency.noData')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-5 py-3 text-gray-500 font-medium">{t('latency.columns.model')}</th>
                <th className="text-right px-5 py-3 text-gray-500 font-medium">{t('latency.columns.requests')}</th>
                <th className="text-right px-5 py-3 text-gray-500 font-medium">{t('latency.cards.average')}</th>
                <th className="text-right px-5 py-3 text-gray-500 font-medium">{t('latency.columns.p50')}</th>
                <th className="text-right px-5 py-3 text-gray-500 font-medium">{t('latency.cards.p95')}</th>
                <th className="text-right px-5 py-3 text-gray-500 font-medium">{t('latency.cards.p99')}</th>
                <th className="text-right px-5 py-3 text-gray-500 font-medium">{t('latency.columns.min')}</th>
                <th className="text-right px-5 py-3 text-gray-500 font-medium">{t('latency.columns.max')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data?.byModel.map((m) => (
                <tr key={m.model ?? 'unknown'} className="hover:bg-gray-50">
                  <td className="px-5 py-3 font-mono text-xs text-gray-800">{m.model ?? '—'}</td>
                  <td className="px-5 py-3 text-right text-gray-600">{m.requests.toLocaleString(i18n.language)}</td>
                  <td className="px-5 py-3 text-right font-medium text-gray-900">{msValue(m.avgMs)}</td>
                  <td className="px-5 py-3 text-right text-gray-600">{msValue(m.p50)}</td>
                  <td className="px-5 py-3 text-right text-orange-600">{msValue(m.p95)}</td>
                  <td className="px-5 py-3 text-right text-red-500">{msValue(m.p99)}</td>
                  <td className="px-5 py-3 text-right text-gray-400">{msValue(m.minMs)}</td>
                  <td className="px-5 py-3 text-right text-gray-400">{msValue(m.maxMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Slowest requests */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-800">{t('latency.slowest.title')}</h2>
        </div>
        {isLoading ? (
          <div className="p-8 text-center text-gray-400 text-sm">{t('common:loading')}</div>
        ) : data?.slowest.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">{t('latency.noData')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-5 py-3 text-gray-500 font-medium">{t('latency.columns.time')}</th>
                <th className="text-left px-5 py-3 text-gray-500 font-medium">{t('latency.columns.model')}</th>
                <th className="text-left px-5 py-3 text-gray-500 font-medium">{t('latency.columns.user')}</th>
                <th className="text-right px-5 py-3 text-gray-500 font-medium">{t('latency.columns.duration')}</th>
                <th className="text-right px-5 py-3 text-gray-500 font-medium">{t('latency.columns.tokens')}</th>
                <th className="text-right px-5 py-3 text-gray-500 font-medium">{t('latency.columns.status')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data?.slowest.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-5 py-2.5 text-gray-500 whitespace-nowrap">
                    {format(parseISO(r.createdAt), 'MMM d, HH:mm:ss', { locale: getDateFnsLocale() })}
                  </td>
                  <td className="px-5 py-2.5 font-mono text-xs text-gray-700">{r.model ?? '—'}</td>
                  <td className="px-5 py-2.5 text-gray-800">{userName(r)}</td>
                  <td className="px-5 py-2.5 text-right font-medium text-gray-900">
                    {r.requestDurationMs != null ? msValue(r.requestDurationMs) : '—'}
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
