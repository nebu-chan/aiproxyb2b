import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { adminApi } from '../../api/admin';
import { Layout } from '../../components/Layout';
import { UsageChart } from '../../components/charts/UsageChart';

function useDebounce(value: number, delay = 400) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function StatCard({ label, value, sub, href }: { label: string; value: string; sub?: string; href?: string }) {
  const inner = (
    <>
      <div className="text-sm text-gray-500">{label}</div>
      <div className="text-2xl font-bold text-gray-900 mt-1">{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </>
  );
  if (href) {
    return (
      <Link to={href} className="block bg-white rounded-xl border border-gray-200 p-5 hover:border-brand-300 hover:shadow-sm transition-all">
        {inner}
      </Link>
    );
  }
  return <div className="bg-white rounded-xl border border-gray-200 p-5">{inner}</div>;
}

export function SuperAdminDashboard() {
  const { t, i18n } = useTranslation(['pages', 'common']);
  const [days, setDays] = useState(30);
  const debouncedDays = useDebounce(days);

  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['admin', 'stats', 'overview', debouncedDays],
    queryFn: () => adminApi.platformOverview(debouncedDays),
  });

  const { data: daily = [], isLoading: dailyLoading } = useQuery({
    queryKey: ['admin', 'stats', 'daily', debouncedDays],
    queryFn: () => adminApi.platformDaily(debouncedDays),
  });

  const successRate = overview && overview.totalRequests > 0
    ? Math.round((overview.successRequests / overview.totalRequests) * 100)
    : 100;

  return (
    <Layout>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('superAdminDashboard.title')}</h1>
          <div className="flex items-center gap-1.5 text-gray-500 text-sm mt-1">
            {t('superAdminDashboard.header.last')}
            <input
              type="number"
              min={1}
              max={365}
              value={days}
              onChange={(e) => setDays(Math.max(1, Math.min(365, Number(e.target.value) || 1)))}
              className="w-14 border border-gray-200 rounded px-1.5 py-0.5 text-center text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            {t('superAdminDashboard.header.daysOverview')}
          </div>
        </div>

        {overviewLoading ? (
          <div className="text-gray-400 text-sm">{t('common:loading')}</div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label={t('superAdminDashboard.stats.totalRequests')}
              value={overview?.totalRequests.toLocaleString(i18n.language) ?? '—'}
              sub={t('superAdminDashboard.stats.lastNDays', { count: debouncedDays })}
              href="/admin/requests"
            />
            <StatCard
              label={t('superAdminDashboard.stats.successRate')}
              value={`${successRate}%`}
              sub={t('superAdminDashboard.stats.succeeded', { value: overview?.successRequests.toLocaleString(i18n.language) })}
              href="/admin/success-rate"
            />
            <StatCard
              label={t('superAdminDashboard.stats.tokensUsed')}
              value={overview?.totalTokens != null ? formatNum(overview.totalTokens) : '—'}
              sub={t('superAdminDashboard.stats.today', { value: overview?.todayTokens != null ? formatNum(overview.todayTokens) : '—' })}
              href="/admin/token-usage"
            />
            <StatCard
              label={t('superAdminDashboard.stats.avgLatency')}
              value={t('superAdminDashboard.stats.msValue', { value: overview?.avgLatencyMs ?? 0 })}
              sub={t('superAdminDashboard.stats.perRequest')}
              href="/admin/latency"
            />
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-base font-semibold text-gray-800 mb-4">{t('superAdminDashboard.charts.requestsPerDay')}</h2>
            {dailyLoading ? (
              <div className="h-60 flex items-center justify-center text-gray-400 text-sm">{t('common:loading')}</div>
            ) : (
              <UsageChart data={daily} metric="requests" />
            )}
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-base font-semibold text-gray-800 mb-4">{t('superAdminDashboard.charts.tokenUsagePerDay')}</h2>
            {dailyLoading ? (
              <div className="h-60 flex items-center justify-center text-gray-400 text-sm">{t('common:loading')}</div>
            ) : (
              <UsageChart data={daily} metric="tokens" />
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
