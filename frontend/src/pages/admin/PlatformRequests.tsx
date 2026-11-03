import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { adminApi, type PlatformUsageLog } from '../../api/admin';
import { Layout } from '../../components/Layout';
import { format } from 'date-fns';
import { getDateFnsLocale } from '../../i18n/dateLocale';

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

type SortField = 'createdAt' | 'model' | 'user' | 'promptTokens' | 'completionTokens' | 'totalTokens' | 'requestDurationMs' | 'statusCode';

function StatusBadge({ code }: { code: number | null }) {
  if (code == null) return <span className="text-gray-400">—</span>;
  const ok = code < 400;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
      {code}
    </span>
  );
}

function SortIcon({ field, sortBy, sortOrder }: { field: SortField; sortBy: SortField; sortOrder: 'asc' | 'desc' }) {
  if (field !== sortBy) return <span className="ml-1.5 text-gray-300 text-base leading-none">↕</span>;
  return <span className="ml-1.5 text-brand-600 text-base leading-none">{sortOrder === 'asc' ? '↑' : '↓'}</span>;
}

function userName(log: PlatformUsageLog): string {
  if (log.userName || log.userSurname) return `${log.userName ?? ''} ${log.userSurname ?? ''}`.trim();
  return log.userEmail ?? '—';
}

export function PlatformRequests() {
  const { t, i18n } = useTranslation(['pages', 'common']);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [sortBy, setSortBy] = useState<SortField>('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function handleSort(field: SortField) {
    if (field === sortBy) {
      setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
    setPage(0);
  }

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'logs', page, pageSize, sortBy, sortOrder],
    queryFn: () => adminApi.logs(pageSize, page * pageSize, sortBy, sortOrder),
  });

  const logs = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  function Th({ field, label, align = 'left' }: { field: SortField; label: string; align?: 'left' | 'right' }) {
    return (
      <th
        className={`px-5 py-3 text-gray-500 font-medium cursor-pointer select-none hover:text-gray-800 transition-colors ${align === 'right' ? 'text-right' : 'text-left'}`}
        onClick={() => handleSort(field)}
      >
        <span className="inline-flex items-center justify-end gap-0">
          {label}
          <SortIcon field={field} sortBy={sortBy} sortOrder={sortOrder} />
        </span>
      </th>
    );
  }

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('platformRequests.title')}</h1>
        <p className="text-gray-500 text-sm mt-1">
          {total > 0 ? t('platformRequests.totalRequests', { count: total.toLocaleString(i18n.language) }) : t('platformRequests.allRequests')}
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="p-10 flex flex-col items-center justify-center gap-3">
            <svg className="w-6 h-6 text-gray-300 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            <span className="text-sm text-gray-400">{t('platformRequests.loadingRequests')}</span>
          </div>
        ) : logs.length === 0 ? (
          <div className="p-10 flex flex-col items-center justify-center gap-2">
            <p className="text-sm font-medium text-gray-500">{t('platformRequests.noRequestsYet')}</p>
          </div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <Th field="createdAt"         label={t('platformRequests.columns.time')}         align="left"  />
                  <Th field="model"             label={t('platformRequests.columns.model')}        align="left"  />
                  <Th field="user"              label={t('platformRequests.columns.user')}         align="left"  />
                  <th className="px-5 py-3 text-left text-gray-500 font-medium">{t('platformRequests.columns.organization')}</th>
                  <Th field="promptTokens"      label={t('platformRequests.columns.prompt')}       align="right" />
                  <Th field="completionTokens"  label={t('platformRequests.columns.completion')}   align="right" />
                  <Th field="totalTokens"       label={t('platformRequests.columns.totalTokens')} align="right" />
                  <Th field="requestDurationMs" label={t('platformRequests.columns.latency')}      align="right" />
                  <Th field="statusCode"        label={t('platformRequests.columns.status')}       align="right" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {logs.map((log: PlatformUsageLog) => (
                  <>
                    <tr
                      key={log.id}
                      onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                      className="hover:bg-gray-50 cursor-pointer"
                    >
                      <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">
                        {format(new Date(log.createdAt), 'MMM d, HH:mm:ss', { locale: getDateFnsLocale() })}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-gray-800 text-xs">{log.model ?? '—'}</td>
                      <td className="px-4 py-2.5">
                        <div className="text-gray-800">{userName(log)}</div>
                        {(log.userName || log.userSurname) && (
                          <div className="text-xs text-gray-400">{log.userEmail}</div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-gray-600">{log.orgName ?? '—'}</td>
                      <td className="px-4 py-2.5 text-right text-gray-600">{log.promptTokens?.toLocaleString(i18n.language) ?? '—'}</td>
                      <td className="px-4 py-2.5 text-right text-gray-600">{log.completionTokens?.toLocaleString(i18n.language) ?? '—'}</td>
                      <td className="px-4 py-2.5 text-right font-medium text-gray-800">{log.totalTokens?.toLocaleString(i18n.language) ?? '—'}</td>
                      <td className="px-4 py-2.5 text-right text-gray-500">
                        {log.requestDurationMs != null ? t('platformRequests.msValue', { value: log.requestDurationMs }) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <StatusBadge code={log.statusCode} />
                      </td>
                    </tr>
                    {expandedId === log.id && (
                      <tr key={`${log.id}-detail`} className="bg-gray-50 border-b border-gray-100">
                        <td colSpan={9} className="px-5 py-3">
                          <div className="grid grid-cols-2 gap-x-12 gap-y-2 text-xs">
                            <div className="flex gap-3 items-baseline">
                              <span className="text-gray-400 w-24 flex-shrink-0 font-medium">{t('platformRequests.detail.requestId')}</span>
                              <span className="font-mono text-gray-600 break-all">{log.id}</span>
                            </div>
                            <div className="flex gap-3 items-baseline">
                              <span className="text-gray-400 w-24 flex-shrink-0 font-medium">{t('platformRequests.detail.endpoint')}</span>
                              <span className="font-mono text-gray-600">{log.endpoint ?? '—'}</span>
                            </div>
                            <div className="flex gap-3 items-baseline">
                              <span className="text-gray-400 w-24 flex-shrink-0 font-medium">{t('platformRequests.detail.userId')}</span>
                              <span className="font-mono text-gray-600">{log.userId ?? '—'}</span>
                            </div>
                            <div className="flex gap-3 items-baseline">
                              <span className="text-gray-400 w-24 flex-shrink-0 font-medium">{t('platformRequests.detail.orgId')}</span>
                              <span className="font-mono text-gray-600">{log.orgId ?? '—'}</span>
                            </div>
                            {log.errorMessage && (
                              <div className="flex gap-3 items-baseline col-span-2">
                                <span className="text-gray-400 w-24 flex-shrink-0 font-medium">{t('platformRequests.detail.error')}</span>
                                <span className="text-red-500 bg-red-50 px-2 py-0.5 rounded">{log.errorMessage}</span>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>

            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-400">
                  {t('platformRequests.pagination.range', {
                    from: page * pageSize + 1,
                    to: Math.min((page + 1) * pageSize, total),
                    total: total.toLocaleString(i18n.language),
                  })}
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-400">{t('platformRequests.pagination.show')}</span>
                  {PAGE_SIZE_OPTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => { setPageSize(s); setPage(0); }}
                      className={`text-xs px-2 py-0.5 rounded transition-colors ${pageSize === s ? 'bg-brand-600 text-white' : 'text-gray-500 hover:text-gray-900'}`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                  className="text-xs text-gray-500 hover:text-gray-900 disabled:opacity-40 px-2 py-1"
                >
                  {t('platformRequests.pagination.previous')}
                </button>
                <button
                  disabled={page + 1 >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="text-xs text-gray-500 hover:text-gray-900 disabled:opacity-40 px-2 py-1"
                >
                  {t('platformRequests.pagination.next')}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
