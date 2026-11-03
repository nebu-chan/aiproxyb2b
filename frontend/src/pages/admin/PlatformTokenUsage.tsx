import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { adminApi } from '../../api/admin';
import { UsageChart } from '../../components/charts/UsageChart';
import { Layout } from '../../components/Layout';

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

type ModelSortField = 'model' | 'tokens' | 'share' | 'requests' | 'avgLatencyMs';
type OrgSortField = 'orgName' | 'tokens' | 'share' | 'requests' | 'topModel';

export function PlatformTokenUsage() {
  const { t, i18n } = useTranslation(['pages', 'common']);
  const [activeTab, setActiveTab] = useState<'models' | 'orgs'>('models');

  const modelSort = useSortState<ModelSortField>('tokens');
  const orgSort   = useSortState<OrgSortField>('tokens');

  const { data: overview } = useQuery({
    queryKey: ['admin', 'stats', 'overview'],
    queryFn: () => adminApi.platformOverview(),
  });

  const { data: daily = [] } = useQuery<import('../../api/analytics').DailyStat[]>({
    queryKey: ['admin', 'stats', 'daily'],
    queryFn: () => adminApi.platformDaily(),
  });

  const { data: tokenStats, isLoading } = useQuery({
    queryKey: ['admin', 'analytics', 'tokens'],
    queryFn: adminApi.platformTokens,
  });

  const totalTokens = overview?.totalTokens ?? 0;

  const modelRows = (tokenStats?.models ?? []).map((m) => ({
    ...m,
    share: totalTokens > 0 ? (m.tokens / totalTokens) * 100 : 0,
  }));

  const orgRows = (tokenStats?.orgs ?? []).map((o) => ({
    ...o,
    share: totalTokens > 0 ? (o.tokens / totalTokens) * 100 : 0,
  }));

  const topOrg   = tokenStats?.orgs[0];
  const topModel = tokenStats?.models[0];

  const sortedModels = sortData(modelRows, modelSort.sortBy as keyof typeof modelRows[0], modelSort.sortOrder);
  const sortedOrgs   = sortData(orgRows,   orgSort.sortBy   as keyof typeof orgRows[0],   orgSort.sortOrder);

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

  function OrgTh({ field, label, align = 'left' }: { field: OrgSortField; label: string; align?: 'left' | 'right' }) {
    return (
      <th
        className={`px-5 py-3 text-gray-500 font-medium cursor-pointer select-none hover:text-gray-800 transition-colors ${align === 'right' ? 'text-right' : 'text-left'}`}
        onClick={() => orgSort.handleSort(field)}
      >
        <span className="inline-flex items-center gap-0">
          {label}
          <SortIcon field={field} sortBy={orgSort.sortBy} sortOrder={orgSort.sortOrder} />
        </span>
      </th>
    );
  }

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('platformTokenUsage.title')}</h1>
        <p className="text-gray-500 text-sm mt-1">{t('platformTokenUsage.subtitle')}</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-sm text-gray-500">{t('platformTokenUsage.summary.totalTokens')}</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{totalTokens.toLocaleString(i18n.language)}</div>
          <div className="text-xs text-gray-400 mt-0.5">{t('platformTokenUsage.summary.today', { count: (overview?.todayTokens ?? 0).toLocaleString(i18n.language) })}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-sm text-gray-500">{t('platformTokenUsage.summary.topOrg')}</div>
          <div className="text-lg font-bold text-gray-900 mt-1 truncate">
            {topOrg?.orgName ?? '—'}
          </div>
          <div className="text-xs text-gray-400 mt-0.5">
            {topOrg ? t('platformTokenUsage.summary.tokensCount', { count: topOrg.tokens.toLocaleString(i18n.language) }) : t('platformTokenUsage.summary.noDataYet')}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-sm text-gray-500">{t('platformTokenUsage.summary.topModel')}</div>
          <div className="text-lg font-bold text-gray-900 mt-1 truncate font-mono">
            {topModel?.model ?? '—'}
          </div>
          <div className="text-xs text-gray-400 mt-0.5">
            {topModel ? t('platformTokenUsage.summary.tokensCount', { count: topModel.tokens.toLocaleString(i18n.language) }) : t('platformTokenUsage.summary.noDataYet')}
          </div>
        </div>
      </div>

      {/* Daily chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <h2 className="text-base font-semibold text-gray-800 mb-4">{t('platformTokenUsage.chartTitle')}</h2>
        <UsageChart data={daily} metric="tokens" />
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex border-b border-gray-200">
          {(['models', 'orgs'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-6 py-3 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? 'text-brand-600 border-b-2 border-brand-600 bg-white'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab === 'models' ? t('platformTokenUsage.tabs.byModel') : t('platformTokenUsage.tabs.byOrg')}
            </button>
          ))}
        </div>

        {activeTab === 'models' && (
          <>
            {isLoading ? (
              <div className="p-8 text-center text-gray-400 text-sm">{t('common:loading')}</div>
            ) : sortedModels.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">{t('platformTokenUsage.summary.noDataYet')}</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <ModelTh field="model"        label={t('platformTokenUsage.columns.model')}       align="left"  />
                    <ModelTh field="tokens"       label={t('platformTokenUsage.columns.tokens')}      align="right" />
                    <ModelTh field="share"        label={t('platformTokenUsage.columns.percentage')}  align="right" />
                    <ModelTh field="requests"     label={t('platformTokenUsage.columns.requests')}    align="right" />
                    <ModelTh field="avgLatencyMs" label={t('platformTokenUsage.columns.avgLatency')} align="right" />
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
                        {t('platformTokenUsage.msValue', { value: m.avgLatencyMs })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {activeTab === 'orgs' && (
          <>
            {isLoading ? (
              <div className="p-8 text-center text-gray-400 text-sm">{t('common:loading')}</div>
            ) : sortedOrgs.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">{t('platformTokenUsage.summary.noDataYet')}</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <OrgTh field="orgName"  label={t('platformTokenUsage.columns.organization')} align="left"  />
                    <OrgTh field="tokens"   label={t('platformTokenUsage.columns.tokens')}       align="right" />
                    <OrgTh field="share"    label={t('platformTokenUsage.columns.percentage')}   align="right" />
                    <OrgTh field="requests" label={t('platformTokenUsage.columns.requests')}     align="right" />
                    <OrgTh field="topModel" label={t('platformTokenUsage.columns.topModel')}    align="right" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sortedOrgs.map((o) => (
                    <tr key={o.orgId} className="hover:bg-gray-50">
                      <td className="px-5 py-3 font-medium text-gray-900">{o.orgName}</td>
                      <td className="px-5 py-3 text-right font-medium text-gray-900">
                        {o.tokens.toLocaleString(i18n.language)}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-brand-500 rounded-full"
                              style={{ width: `${Math.min(100, o.share)}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-500 w-10 text-right">
                            {o.share.toFixed(1)}%
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-right text-gray-600">
                        {o.requests.toLocaleString(i18n.language)}
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-xs text-gray-500">
                        {o.topModel ?? '—'}
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
