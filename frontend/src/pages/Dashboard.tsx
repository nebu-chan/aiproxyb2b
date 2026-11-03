import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation, Trans } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { analyticsApi } from '../api/analytics';
import { orgApi } from '../api/org';
import { UsageChart } from '../components/charts/UsageChart';
import { Layout } from '../components/Layout';
import { useAuth } from '../hooks/useAuth';

function useDebounce(value: number, delay = 400) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
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

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

export function Dashboard() {
  const { t, i18n } = useTranslation(['pages', 'common']);
  const { org, user } = useAuth();
  const qc = useQueryClient();
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const [days, setDays] = useState(30);
  const debouncedDays = useDebounce(days);
  const [resetDayInput, setResetDayInput] = useState('');
  const [settingsSaved, setSettingsSaved] = useState(false);

  const { data: orgSettings } = useQuery({
    queryKey: ['org', 'settings'],
    queryFn: orgApi.settings.get,
    enabled: isAdmin,
  });

  const { data: periodCost } = useQuery({
    queryKey: ['org', 'billing', 'period-cost'],
    queryFn: orgApi.billing.periodCost,
    enabled: isAdmin,
  });

  useEffect(() => {
    if (orgSettings) setResetDayInput(String(orgSettings.balanceResetDay));
  }, [orgSettings]);

  const updateSettingsMutation = useMutation({
    mutationFn: () => orgApi.settings.update({ balanceResetDay: parseInt(resetDayInput, 10) }),
    onSuccess: () => {
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 3000);
      qc.invalidateQueries({ queryKey: ['org', 'settings'] });
    },
  });

  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['analytics', 'overview', debouncedDays],
    queryFn: () => analyticsApi.overview(debouncedDays),
  });

  const { data: daily = [], isLoading: dailyLoading } = useQuery({
    queryKey: ['analytics', 'daily', debouncedDays],
    queryFn: () => analyticsApi.daily(
      new Date(Date.now() - debouncedDays * 86_400_000).toISOString(),
      new Date().toISOString(),
    ),
  });

  const successRate =
    overview && overview.totalRequests > 0
      ? Math.round((overview.successRequests / overview.totalRequests) * 100)
      : 100;

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{org?.name}</h1>
        <div className="flex items-center gap-1.5 text-gray-500 text-sm mt-1">
          {t('dashboard.last')}
          <input
            type="number"
            min={1}
            max={365}
            value={days}
            onChange={(e) => setDays(Math.max(1, Math.min(365, Number(e.target.value) || 1)))}
            className="w-14 border border-gray-200 rounded px-1.5 py-0.5 text-center text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          {t('dashboard.daysOverviewSuffix')}
        </div>
      </div>

      {overviewLoading ? (
        <div className="text-gray-400 text-sm">{t('common:loading')}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard
              label={t('dashboard.stats.totalRequests')}
              value={overview?.totalRequests.toLocaleString(i18n.language) ?? '—'}
              sub={t('dashboard.stats.lastNDays', { count: debouncedDays })}
              href="/requests"
            />
            <StatCard
              label={t('dashboard.stats.successRate')}
              value={`${successRate}%`}
              sub={t('dashboard.stats.succeeded', { count: overview?.successRequests.toLocaleString(i18n.language) })}
              href="/success-rate"
            />
            <StatCard
              label={t('dashboard.stats.tokensUsed')}
              value={overview?.totalTokens.toLocaleString(i18n.language) ?? '—'}
              sub={t('dashboard.stats.today', { count: overview?.todayTokens.toLocaleString(i18n.language) })}
              href="/token-usage"
            />
            <StatCard
              label={t('dashboard.stats.avgLatency')}
              value={t('dashboard.stats.msValue', { value: overview?.avgLatencyMs ?? 0 })}
              sub={t('dashboard.stats.perRequest')}
              href="/latency"
            />
          </div>
          {isAdmin && periodCost && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="text-sm text-gray-500">{t('dashboard.spentThisMonth')}</div>
                <div className="text-2xl font-bold text-gray-900 mt-1">{periodCost.totalCostRub.toFixed(2)} ₽</div>
                <div className="text-xs text-gray-400 mt-0.5">{t('dashboard.since', { date: new Date(periodCost.periodStart).toLocaleDateString(i18n.language, { month: 'short', day: 'numeric' }) })}</div>
              </div>
            </div>
          )}
        </>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-base font-semibold text-gray-800 mb-4">{t('dashboard.requestsPerDay')}</h2>
          {dailyLoading ? (
            <div className="h-60 flex items-center justify-center text-gray-400 text-sm">{t('common:loading')}</div>
          ) : (
            <UsageChart data={daily} metric="requests" />
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-base font-semibold text-gray-800 mb-4">{t('dashboard.tokenUsagePerDay')}</h2>
          {dailyLoading ? (
            <div className="h-60 flex items-center justify-center text-gray-400 text-sm">{t('common:loading')}</div>
          ) : (
            <UsageChart data={daily} metric="tokens" />
          )}
        </div>
      </div>

      {isAdmin && (
        <div className="mt-6 bg-white rounded-xl border border-gray-200 p-6 max-w-sm">
          <h2 className="text-base font-semibold text-gray-800 mb-1">{t('dashboard.billingCycle.title')}</h2>
          <p className="text-xs text-gray-400 mb-4">
            {t('dashboard.billingCycle.description')}
            {orgSettings && (
              <>
                {' '}
                <Trans
                  i18nKey="dashboard.billingCycle.currentPeriodStarted"
                  values={{ day: ordinal(orgSettings.balanceResetDay) }}
                  components={{ strong: <strong /> }}
                />
              </>
            )}
          </p>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-gray-600 whitespace-nowrap">{t('dashboard.billingCycle.resetOnThe')}</label>
              <input
                type="number"
                min={1}
                max={28}
                value={resetDayInput}
                onChange={(e) => setResetDayInput(e.target.value)}
                className="w-16 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              <span className="text-xs text-gray-600">{t('dashboard.billingCycle.ofMonth')}</span>
            </div>
            <button
              onClick={() => updateSettingsMutation.mutate()}
              disabled={updateSettingsMutation.isPending || !resetDayInput || parseInt(resetDayInput, 10) < 1 || parseInt(resetDayInput, 10) > 28}
              className={`text-white text-xs font-medium px-4 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${settingsSaved ? 'bg-green-600' : 'bg-brand-600 hover:bg-brand-700'}`}
            >
              {updateSettingsMutation.isPending ? t('common:buttons.saving') : settingsSaved ? t('common:buttons.saved') : t('common:buttons.save')}
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-400">{t('dashboard.billingCycle.maxDayNote')}</p>
        </div>
      )}
    </Layout>
  );
}
