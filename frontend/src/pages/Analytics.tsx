import { useState, useMemo, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { analyticsApi, type UsageLog, type ModelStat, type UserStat, type DepartmentStat } from '../api/analytics';
import { UsageChart } from '../components/charts/UsageChart';
import { Layout } from '../components/Layout';
import { format, subDays, startOfDay, startOfMonth } from 'date-fns';
import { getDateFnsLocale } from '../i18n/dateLocale';
import { exportModels, exportUsers, exportDepartments, exportLogs, type ExportFormat } from '../utils/exportAnalytics';

// ── Period ─────────────────────────────────────────────────────────────────────

type Period = 'today' | '7d' | '30d' | 'month' | 'custom';

const PERIOD_KEYS: Exclude<Period, 'custom'>[] = ['today', '7d', '30d', 'month'];

function getPeriodRange(period: Period, customFrom: string, customTo: string): { from: string; to: string } {
  const now = new Date();
  if (period === 'today')  return { from: startOfDay(now).toISOString(), to: now.toISOString() };
  if (period === '7d')     return { from: subDays(now, 7).toISOString(), to: now.toISOString() };
  if (period === '30d')    return { from: subDays(now, 30).toISOString(), to: now.toISOString() };
  if (period === 'month')  return { from: startOfMonth(now).toISOString(), to: now.toISOString() };
  return {
    from: customFrom ? new Date(customFrom + 'T00:00:00').toISOString() : subDays(now, 30).toISOString(),
    to:   customTo   ? new Date(customTo   + 'T23:59:59').toISOString() : now.toISOString(),
  };
}

// ── Sorting helpers ────────────────────────────────────────────────────────────

type SortOrder = 'asc' | 'desc';

function useSortState<T extends string>(defaultCol: T) {
  const [sortBy, setSortBy]     = useState<T>(defaultCol);
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

// ── Log table sort (server-side) ───────────────────────────────────────────────

type LogSortField = 'createdAt' | 'model' | 'user' | 'promptTokens' | 'completionTokens' | 'totalTokens' | 'requestDurationMs' | 'statusCode';

function LogSortIcon({ field, sortBy, sortOrder }: { field: LogSortField; sortBy: LogSortField; sortOrder: SortOrder }) {
  if (field !== sortBy) return <span className="ml-1.5 text-gray-300 text-base leading-none">↕</span>;
  return <span className="ml-1.5 text-brand-600 text-base leading-none">{sortOrder === 'asc' ? '↑' : '↓'}</span>;
}

function userName(log: UsageLog): string {
  if (log.userName || log.userSurname) return `${log.userName ?? ''} ${log.userSurname ?? ''}`.trim();
  return log.userEmail ?? '—';
}

// ── Export period popover ──────────────────────────────────────────────────────

type ExportPeriod = 'today' | '7d' | '30d' | 'month' | 'custom';

const EXPORT_PERIOD_KEYS: ExportPeriod[] = ['today', '7d', '30d', 'month', 'custom'];

function getExportRange(p: ExportPeriod, from: string, to: string): { from: string; to: string; label: string } {
  const now = new Date();
  if (p === 'today')  return { from: startOfDay(now).toISOString(), to: now.toISOString(), label: 'today' };
  if (p === '7d')     return { from: subDays(now, 7).toISOString(),  to: now.toISOString(), label: 'last_7d' };
  if (p === '30d')    return { from: subDays(now, 30).toISOString(), to: now.toISOString(), label: 'last_30d' };
  if (p === 'month')  return { from: startOfMonth(now).toISOString(), to: now.toISOString(), label: 'this_month' };
  return {
    from: from ? new Date(from + 'T00:00:00').toISOString() : subDays(now, 30).toISOString(),
    to:   to   ? new Date(to   + 'T23:59:59').toISOString() : now.toISOString(),
    label: `${from || 'start'}_to_${to || 'end'}`,
  };
}

function ExportButtons({ onExport, loading }: {
  onExport: (fmt: ExportFormat, from: string, to: string, label: string) => Promise<void>;
  loading: boolean;
}) {
  const { t } = useTranslation(['pages', 'common']);
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState<ExportPeriod>('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [exportError, setExportError] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  async function doExport(fmt: ExportFormat) {
    setExportError('');
    const { from, to, label } = getExportRange(period, customFrom, customTo);
    try {
      await onExport(fmt, from, to, label);
      if (fmt !== 'sheets') setOpen(false);
    } catch (err: any) {
      setExportError(err?.message ?? t('analytics.export.exportFailed'));
    }
  }

  const canExport = period !== 'custom' || (customFrom && customTo);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={loading}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 border border-gray-200 hover:border-gray-300 rounded-lg transition-colors disabled:opacity-40 bg-white"
      >
        {loading ? '…' : (
          <>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {t('analytics.export.button')}
          </>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 w-64 bg-white border border-gray-200 rounded-xl shadow-lg p-3">
          <p className="text-xs font-medium text-gray-500 mb-2">{t('analytics.export.periodLabel')}</p>

          <div className="flex flex-col gap-1 mb-3">
            {EXPORT_PERIOD_KEYS.map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`text-left px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  period === p
                    ? 'bg-brand-50 text-brand-700 border border-brand-200'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {t(`analytics.exportPeriods.${p}`)}
              </button>
            ))}
          </div>

          {period === 'custom' && (
            <div className="flex flex-col gap-1.5 mb-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 w-8">{t('analytics.export.from')}</span>
                <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                  className="flex-1 border border-gray-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 w-8">{t('analytics.export.to')}</span>
                <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                  className="flex-1 border border-gray-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500" />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-1.5 pt-2 border-t border-gray-100">
            <button onClick={() => doExport('csv')} disabled={!canExport}
              className="py-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 border border-gray-200 hover:border-gray-300 rounded-lg transition-colors disabled:opacity-40">
              ↓ CSV
            </button>
            <button onClick={() => doExport('xlsx')} disabled={!canExport}
              className="py-1.5 text-xs font-medium text-emerald-700 hover:text-emerald-900 border border-emerald-200 hover:border-emerald-300 rounded-lg transition-colors disabled:opacity-40 bg-emerald-50">
              ↓ XLSX
            </button>
            <button onClick={() => doExport('pdf')} disabled={!canExport}
              className="py-1.5 text-xs font-medium text-red-600 hover:text-red-800 border border-red-200 hover:border-red-300 rounded-lg transition-colors disabled:opacity-40 bg-red-50">
              ↓ PDF
            </button>
            <button onClick={() => doExport('sheets')} disabled={!canExport}
              className="py-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 border border-blue-200 hover:border-blue-300 rounded-lg transition-colors disabled:opacity-40 bg-blue-50">
              ↗ Sheets
            </button>
          </div>
          {exportError && (
            <p className="mt-2 text-[11px] text-red-500 whitespace-pre-wrap">{exportError}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function Analytics() {
  const { t, i18n } = useTranslation(['pages', 'common']);
  const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

  const [metric, setMetric]   = useState<'requests' | 'tokens'>('requests');
  const [page, setPage]       = useState(0);
  const [pageSize, setPageSize] = useState(50);

  // Period
  const [period, setPeriod]       = useState<Period>('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo]     = useState('');

  const { from, to } = useMemo(
    () => getPeriodRange(period, customFrom, customTo),
    [period, customFrom, customTo],
  );

  // Export loading state (key = "section-format")
  const [exportLoading, setExportLoading] = useState<string | null>(null);

  // Client-side sort state per table
  const modelSort = useSortState<keyof ModelStat>('requests');
  const userSort  = useSortState<keyof UserStat>('requests');
  const deptSort  = useSortState<keyof DepartmentStat>('requests');

  // Server-side sort for request log
  const [logSortBy, setLogSortBy]       = useState<LogSortField>('createdAt');
  const [logSortOrder, setLogSortOrder] = useState<SortOrder>('desc');

  function handleLogSort(field: LogSortField) {
    if (field === logSortBy) setLogSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    else { setLogSortBy(field); setLogSortOrder('desc'); }
    setPage(0);
  }

  // Queries — all use the selected period
  const { data: daily = [] } = useQuery({
    queryKey: ['analytics', 'daily', from, to],
    queryFn: () => analyticsApi.daily(from, to),
  });

  const { data: models = [] } = useQuery({
    queryKey: ['analytics', 'models', from, to],
    queryFn: () => analyticsApi.models(from, to),
  });

  const { data: userStats = [] } = useQuery({
    queryKey: ['analytics', 'users', from, to],
    queryFn: () => analyticsApi.users(from, to),
  });

  const { data: deptStats = [] } = useQuery({
    queryKey: ['analytics', 'departments', from, to],
    queryFn: () => analyticsApi.departments(from, to),
  });

  const { data: logsData, isLoading: logsLoading } = useQuery({
    queryKey: ['analytics', 'logs', page, pageSize, logSortBy, logSortOrder, from, to],
    queryFn: () => analyticsApi.logs(pageSize, page * pageSize, logSortBy, logSortOrder, undefined, from, to),
  });

  const logs = logsData?.data ?? [];
  const logsTotal = logsData?.total ?? 0;
  const logsTotalPages = Math.ceil(logsTotal / pageSize);

  // Apply client-side sorting
  const sortedModels = sortData(models, modelSort.sortBy, modelSort.sortOrder);
  const sortedUsers  = sortData(userStats, userSort.sortBy, userSort.sortOrder);
  const sortedDepts  = sortData(deptStats, deptSort.sortBy, deptSort.sortOrder);

  // Export handlers
  async function handleExport(
    section: 'models' | 'users' | 'departments' | 'logs',
    fmt: ExportFormat,
    exportFrom: string,
    exportTo: string,
    exportLabel: string,
  ) {
    const key = `${section}-${fmt}`;
    setExportLoading(key);
    try {
      if (section === 'models') {
        const data = await analyticsApi.models(exportFrom, exportTo);
        await exportModels(data, fmt, exportLabel);
      } else if (section === 'users') {
        const data = await analyticsApi.users(exportFrom, exportTo);
        await exportUsers(data, fmt, exportLabel);
      } else if (section === 'departments') {
        const data = await analyticsApi.departments(exportFrom, exportTo);
        await exportDepartments(data, fmt, exportLabel);
      } else {
        const allLogs = await analyticsApi.exportLogs(exportFrom, exportTo);
        await exportLogs(allLogs, fmt, exportLabel);
      }
    } finally {
      setExportLoading(null);
    }
  }

  // Th helpers
  function ModelTh({ col, label, right = true }: { col: keyof ModelStat; label: string; right?: boolean }) {
    return (
      <th
        className={`py-2 text-gray-500 font-medium cursor-pointer select-none hover:text-gray-800 transition-colors ${right ? 'text-right' : 'text-left'}`}
        onClick={() => modelSort.handleSort(col)}
      >
        {label}<SortIcon active={modelSort.sortBy === col} order={modelSort.sortOrder} />
      </th>
    );
  }

  function UserTh({ col, label, right = true }: { col: keyof UserStat; label: string; right?: boolean }) {
    return (
      <th
        className={`py-2 text-gray-500 font-medium cursor-pointer select-none hover:text-gray-800 transition-colors ${right ? 'text-right' : 'text-left'}`}
        onClick={() => userSort.handleSort(col)}
      >
        {label}<SortIcon active={userSort.sortBy === col} order={userSort.sortOrder} />
      </th>
    );
  }

  function DeptTh({ col, label, right = true }: { col: keyof DepartmentStat; label: string; right?: boolean }) {
    return (
      <th
        className={`py-2 text-gray-500 font-medium cursor-pointer select-none hover:text-gray-800 transition-colors ${right ? 'text-right' : 'text-left'}`}
        onClick={() => deptSort.handleSort(col)}
      >
        {label}<SortIcon active={deptSort.sortBy === col} order={deptSort.sortOrder} />
      </th>
    );
  }

  function LogTh({ field, label, align = 'left' }: { field: LogSortField; label: string; align?: 'left' | 'right' }) {
    return (
      <th
        className={`px-5 py-3 text-gray-500 font-medium cursor-pointer select-none hover:text-gray-800 transition-colors ${align === 'right' ? 'text-right' : 'text-left'}`}
        onClick={() => handleLogSort(field)}
      >
        <span className="inline-flex items-center">
          {label}
          <LogSortIcon field={field} sortBy={logSortBy} sortOrder={logSortOrder} />
        </span>
      </th>
    );
  }

  return (
    <Layout>
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">{t('analytics.title')}</h1>
      </div>

      {/* Period selector */}
      <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 mb-6 flex flex-wrap items-center gap-3">
        <span className="text-xs font-medium text-gray-500 mr-1">{t('analytics.periodColon')}</span>
        <div className="flex gap-1.5">
          {PERIOD_KEYS.map((p) => (
            <button
              key={p}
              onClick={() => { setPeriod(p); setPage(0); }}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                period === p
                  ? 'bg-brand-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {t(`analytics.periods.${p}`)}
            </button>
          ))}
          <button
            onClick={() => { setPeriod('custom'); setPage(0); }}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              period === 'custom'
                ? 'bg-brand-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {t('analytics.periods.custom')}
          </button>
        </div>

        {period === 'custom' && (
          <div className="flex items-center gap-2 ml-1">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => { setCustomFrom(e.target.value); setPage(0); }}
              className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            <span className="text-xs text-gray-400">—</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => { setCustomTo(e.target.value); setPage(0); }}
              className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
        )}

        {period !== 'custom' && (
          <span className="ml-auto text-xs text-gray-400">
            {format(new Date(from), 'MMM d, yyyy', { locale: getDateFnsLocale() })} — {format(new Date(to), 'MMM d, yyyy', { locale: getDateFnsLocale() })}
          </span>
        )}
      </div>

      {/* Chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-800">{t('analytics.usageOverTime')}</h2>
          <div className="flex gap-2">
            {(['requests', 'tokens'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMetric(m)}
                className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                  metric === m ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {t(`analytics.metrics.${m}`)}
              </button>
            ))}
          </div>
        </div>
        <UsageChart data={daily} metric={metric} />
      </div>

      {/* By model */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-800">{t('analytics.byModel.title')}</h2>
          <ExportButtons
            onExport={(fmt, f, to, l) => handleExport('models', fmt, f, to, l)}
            loading={exportLoading?.startsWith('models') ?? false}
          />
        </div>
        {models.length === 0 ? (
          <div className="py-6 text-center">
            <p className="text-sm text-gray-400">{t('analytics.byModel.empty')}</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100">
              <tr>
                <ModelTh col="model"        label={t('analytics.columns.model')}       right={false} />
                <ModelTh col="requests"     label={t('analytics.columns.requests')}                  />
                <ModelTh col="tokens"       label={t('analytics.columns.tokens')}                    />
                <ModelTh col="avgLatencyMs" label={t('analytics.columns.avgLatency')}               />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sortedModels.map((m) => (
                <tr key={m.model ?? 'unknown'} className="hover:bg-gray-50">
                  <td className="py-2 font-mono text-gray-900">{m.model ?? '—'}</td>
                  <td className="py-2 text-right text-gray-700">{m.requests.toLocaleString(i18n.language)}</td>
                  <td className="py-2 text-right text-gray-700">{m.tokens.toLocaleString(i18n.language)}</td>
                  <td className="py-2 text-right text-gray-500">{t('analytics.msValue', { value: m.avgLatencyMs })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* By user */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-800">{t('analytics.byUser.title')}</h2>
          <ExportButtons
            onExport={(fmt, f, to, l) => handleExport('users', fmt, f, to, l)}
            loading={exportLoading?.startsWith('users') ?? false}
          />
        </div>
        {userStats.length === 0 ? (
          <div className="py-6 text-center">
            <p className="text-sm text-gray-400">{t('analytics.byUser.empty')}</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100">
              <tr>
                <UserTh col="name"     label={t('analytics.columns.name')}      right={false} />
                <UserTh col="email"    label={t('analytics.columns.email')}     right={false} />
                <UserTh col="requests" label={t('analytics.columns.requests')}               />
                <UserTh col="tokens"   label={t('analytics.columns.tokens')}                 />
                <UserTh col="topModel" label={t('analytics.columns.topModel')}              />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sortedUsers.map((u) => (
                <tr key={u.userId} className="hover:bg-gray-50">
                  <td className="py-2 text-gray-900">
                    {u.name || u.surname ? `${u.name ?? ''} ${u.surname ?? ''}`.trim() : '—'}
                  </td>
                  <td className="py-2 text-gray-500">{u.email}</td>
                  <td className="py-2 text-right text-gray-700">{u.requests.toLocaleString(i18n.language)}</td>
                  <td className="py-2 text-right text-gray-700">{u.tokens.toLocaleString(i18n.language)}</td>
                  <td className="py-2 text-right font-mono text-gray-500">{u.topModel ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* By department */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-800">{t('analytics.byDepartment.title')}</h2>
          <ExportButtons
            onExport={(fmt, f, to, l) => handleExport('departments', fmt, f, to, l)}
            loading={exportLoading?.startsWith('departments') ?? false}
          />
        </div>
        {deptStats.length === 0 ? (
          <div className="py-6 text-center">
            <p className="text-sm text-gray-400">{t('analytics.byDepartment.empty')}</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100">
              <tr>
                <DeptTh col="departmentName" label={t('analytics.columns.department')} right={false} />
                <DeptTh col="requests"       label={t('analytics.columns.requests')}               />
                <DeptTh col="tokens"         label={t('analytics.columns.tokens')}                 />
                <DeptTh col="topModel"       label={t('analytics.columns.topModel')}              />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sortedDepts.map((d) => (
                <tr key={d.departmentId} className="hover:bg-gray-50">
                  <td className="py-2 text-gray-900">{d.departmentName}</td>
                  <td className="py-2 text-right text-gray-700">{d.requests.toLocaleString(i18n.language)}</td>
                  <td className="py-2 text-right text-gray-700">{d.tokens.toLocaleString(i18n.language)}</td>
                  <td className="py-2 text-right font-mono text-gray-500">{d.topModel ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Request log */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800">{t('analytics.requestLog.title')}</h2>
          <ExportButtons
            onExport={(fmt, f, to, l) => handleExport('logs', fmt, f, to, l)}
            loading={exportLoading?.startsWith('logs') ?? false}
          />
        </div>
        {logsLoading ? (
          <div className="p-10 flex flex-col items-center justify-center gap-3">
            <svg className="w-6 h-6 text-gray-300 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            <span className="text-sm text-gray-400">{t('analytics.requestLog.loading')}</span>
          </div>
        ) : logs.length === 0 ? (
          <div className="p-8 flex flex-col items-center justify-center gap-1.5">
            <p className="text-sm font-medium text-gray-400">{t('analytics.requestLog.empty.title')}</p>
            <p className="text-xs text-gray-300">{t('analytics.requestLog.empty.subtitle')}</p>
          </div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <LogTh field="createdAt"         label={t('analytics.columns.time')}     align="left"  />
                  <LogTh field="model"             label={t('analytics.columns.model')}    align="left"  />
                  <LogTh field="user"              label={t('analytics.columns.user')}     align="left"  />
                  <LogTh field="totalTokens"       label={t('analytics.columns.tokens')}   align="right" />
                  <LogTh field="requestDurationMs" label={t('analytics.columns.latency')}  align="right" />
                  <LogTh field="statusCode"        label={t('analytics.columns.status')}   align="right" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {logs.map((log: UsageLog) => (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="px-5 py-2.5 text-gray-500 whitespace-nowrap">
                      {format(new Date(log.createdAt), 'MMM d, HH:mm:ss', { locale: getDateFnsLocale() })}
                    </td>
                    <td className="px-5 py-2.5 font-mono text-gray-700">{log.model ?? '—'}</td>
                    <td className="px-5 py-2.5 text-gray-500 truncate max-w-[200px]">{userName(log)}</td>
                    <td className="px-5 py-2.5 text-right text-gray-700">
                      {log.totalTokens?.toLocaleString(i18n.language) ?? '—'}
                    </td>
                    <td className="px-5 py-2.5 text-right text-gray-500">
                      {log.requestDurationMs != null ? t('analytics.msValue', { value: log.requestDurationMs }) : '—'}
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          (log.statusCode ?? 0) < 400
                            ? 'bg-green-100 text-green-700'
                            : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {log.statusCode ?? '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100">
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-400">
                  {t('analytics.pagination.range', {
                    from: page * pageSize + 1,
                    to: Math.min((page + 1) * pageSize, logsTotal),
                    total: logsTotal.toLocaleString(i18n.language),
                  })}
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-400">{t('analytics.pagination.show')}</span>
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
                  {t('analytics.pagination.previous')}
                </button>
                <button
                  disabled={page + 1 >= logsTotalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="text-xs text-gray-500 hover:text-gray-900 disabled:opacity-40 px-2 py-1"
                >
                  {t('analytics.pagination.next')}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
