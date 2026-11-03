import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useQuery } from '@tanstack/react-query';
import { format, subDays, startOfDay, startOfMonth } from 'date-fns';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { analyticsApi, type AuditLogEntry } from '../api/analytics';
import { exportToGoogleSheets } from '../utils/googleSheets';
import { Layout } from '../components/Layout';
import { getDateFnsLocale } from '../i18n/dateLocale';

// ── Action metadata ────────────────────────────────────────────────────────────
// Raw action codes are stable identifiers sent to/received from the backend and
// used as filter values — they must NOT be translated. Only the human-readable
// label shown on screen is looked up via i18n, through `auditLog.actions.<key>`.

const ACTION_LABEL_KEYS: Record<string, string> = {
  'user.created':                 'userCreated',
  'user.enabled':                 'userEnabled',
  'user.disabled':                'userDisabled',
  'user.info_updated':            'userInfoUpdated',
  'user.policy_updated':          'userPolicyUpdated',
  'user.balance_updated':         'userBalanceUpdated',
  'user.deleted':                 'userDeleted',
  'user.password_reset_sent':     'passwordResetSent',
  'user.removed_from_department': 'removedFromDept',
  'department.created':           'departmentCreated',
  'department.info_updated':      'departmentInfoUpdated',
  'department.policy_updated':    'departmentPolicyUpdated',
  'department.balance_updated':   'departmentBalanceUpdated',
  'department.deleted':           'departmentDeleted',
  'org.updated':                  'orgUpdated',
  'org.quota_updated':            'quotaUpdated',
  'org.api_key.set':              'apiKeySet',
  'org.api_key.removed':          'apiKeyRemoved',
  'provider.created':             'providerCreated',
  'provider.updated':             'providerUpdated',
  'provider.deleted':             'providerDeleted',
};

function actionLabel(t: TFunction, action: string): string {
  const key = ACTION_LABEL_KEYS[action];
  return key ? t(`auditLog.actions.${key}`) : action;
}

function actionColor(action: string): string {
  if (action.endsWith('.created') || action.endsWith('.set') || action === 'user.enabled') return 'bg-green-100 text-green-700';
  if (action.endsWith('.deleted') || action.endsWith('.removed') || action.endsWith('_from_department') || action === 'user.disabled') return 'bg-red-100 text-red-700';
  return 'bg-blue-100 text-blue-700';
}

const TARGET_TYPES = ['user', 'department', 'org', 'provider'] as const;

const ALL_ACTIONS = Object.keys(ACTION_LABEL_KEYS);

// ── Export helpers ─────────────────────────────────────────────────────────────

type ExportPeriod = 'today' | '7d' | '30d' | 'month' | 'custom';

const PERIOD_LABEL_KEYS: Record<ExportPeriod, string> = {
  today: 'today',
  '7d':  'last7Days',
  '30d': 'last30Days',
  month: 'thisMonth',
  custom: 'customRange',
};

function periodLabel(t: TFunction, p: ExportPeriod): string {
  return t(`auditLog.export.periods.${PERIOD_LABEL_KEYS[p]}`);
}

function getExportRange(p: ExportPeriod, from: string, to: string) {
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

type AuditExportFormat = 'csv' | 'xlsx' | 'pdf' | 'sheets';

function makeAuditRows(t: TFunction, rows: AuditLogEntry[]) {
  const cols = {
    time:       t('auditLog.export.columns.time'),
    actor:      t('auditLog.export.columns.actor'),
    action:     t('auditLog.export.columns.action'),
    targetType: t('auditLog.export.columns.targetType'),
    target:     t('auditLog.export.columns.target'),
    before:     t('auditLog.export.columns.before'),
    after:      t('auditLog.export.columns.after'),
    ip:         t('auditLog.export.columns.ip'),
  };
  const data = rows.map((r) => ({
    [cols.time]:       format(new Date(r.createdAt), 'yyyy-MM-dd HH:mm:ss', { locale: getDateFnsLocale() }),
    [cols.actor]:      r.actorEmail,
    [cols.action]:     actionLabel(t, r.action),
    [cols.targetType]: r.targetType,
    [cols.target]:     r.targetLabel ?? r.targetId,
    [cols.before]:     r.diff?.before ? JSON.stringify(r.diff.before) : '',
    [cols.after]:      r.diff?.after  ? JSON.stringify(r.diff.after)  : '',
    [cols.ip]:         r.ip ?? '',
  }));
  return { data, cols };
}

async function exportToFile(t: TFunction, rows: AuditLogEntry[], label: string, fmt: AuditExportFormat) {
  const { data, cols } = makeAuditRows(t, rows);
  const sheetTitle = t('auditLog.export.sheetName');

  if (fmt === 'csv' || fmt === 'xlsx') {
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetTitle);
    if (fmt === 'csv') {
      const csv = XLSX.utils.sheet_to_csv(ws);
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `audit_log_${label}.csv`; a.click();
      URL.revokeObjectURL(url);
    } else {
      XLSX.writeFile(wb, `audit_log_${label}.xlsx`);
    }
  } else if (fmt === 'pdf') {
    const doc = new jsPDF({ orientation: 'landscape' });
    doc.setFontSize(14);
    doc.text(t('auditLog.export.pdfTitle', { label }), 14, 16);
    doc.setFontSize(9); doc.setTextColor(120);
    doc.text(t('auditLog.export.exportedOn', { date: format(new Date(), 'MMM d, yyyy HH:mm', { locale: getDateFnsLocale() }) }), 14, 22);
    autoTable(doc, {
      head: [[cols.time, cols.actor, cols.action, cols.targetType, cols.target, cols.ip]],
      body: data.map((r) => [r[cols.time], r[cols.actor], r[cols.action], r[cols.targetType], r[cols.target], r[cols.ip]]),
      startY: 28,
      styles: { fontSize: 7, cellPadding: 2.5 },
      headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 248, 250] },
    });
    doc.save(`audit_log_${label}.pdf`);
  } else if (fmt === 'sheets') {
    await exportToGoogleSheets(data as Record<string, unknown>[], t('auditLog.export.pdfTitle', { label }));
  }
}

// ── Export button with period popover ─────────────────────────────────────────

function ExportButton({ actionFilter, targetTypeFilter }: { actionFilter: string; targetTypeFilter: string }) {
  const { t } = useTranslation(['pages', 'common']);
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(false);
  const [period, setPeriod]   = useState<ExportPeriod>('30d');
  const [cFrom, setCFrom]     = useState('');
  const [cTo,   setCTo]       = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const [exportError, setExportError] = useState('');

  async function doExport(fmt: AuditExportFormat) {
    setExportError('');
    const { from, to, label } = getExportRange(period, cFrom, cTo);
    if (fmt !== 'sheets') setOpen(false);
    setLoading(true);
    try {
      const rows = await analyticsApi.exportAudit({ from, to, ...(actionFilter ? { action: actionFilter } : {}), ...(targetTypeFilter ? { targetType: targetTypeFilter } : {}) });
      await exportToFile(t, rows, label, fmt);
    } catch (err: any) {
      setExportError(err?.message ?? t('auditLog.export.exportFailed'));
    } finally { setLoading(false); }
  }

  const canExport = period !== 'custom' || (cFrom && cTo);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={loading}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 border border-gray-200 hover:border-gray-300 rounded-lg bg-white transition-colors disabled:opacity-40"
      >
        {loading ? '…' : (
          <>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {t('auditLog.export.button')}
          </>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 w-60 bg-white border border-gray-200 rounded-xl shadow-lg p-3">
          <p className="text-xs font-medium text-gray-500 mb-2">{t('auditLog.export.periodLabel')}</p>
          <div className="flex flex-col gap-1 mb-3">
            {(Object.keys(PERIOD_LABEL_KEYS) as ExportPeriod[]).map((p) => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`text-left px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${period === p ? 'bg-brand-50 text-brand-700 border border-brand-200' : 'text-gray-600 hover:bg-gray-50'}`}>
                {periodLabel(t, p)}
              </button>
            ))}
          </div>
          {period === 'custom' && (
            <div className="flex flex-col gap-1.5 mb-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 w-8">{t('auditLog.export.from')}</span>
                <input type="date" value={cFrom} onChange={(e) => setCFrom(e.target.value)} className="flex-1 border border-gray-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 w-8">{t('auditLog.export.to')}</span>
                <input type="date" value={cTo} onChange={(e) => setCTo(e.target.value)} className="flex-1 border border-gray-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500" />
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-1.5 pt-2 border-t border-gray-100">
            <button onClick={() => doExport('csv')} disabled={!canExport} className="py-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 border border-gray-200 hover:border-gray-300 rounded-lg transition-colors disabled:opacity-40">↓ CSV</button>
            <button onClick={() => doExport('xlsx')} disabled={!canExport} className="py-1.5 text-xs font-medium text-emerald-700 hover:text-emerald-900 border border-emerald-200 hover:border-emerald-300 rounded-lg bg-emerald-50 transition-colors disabled:opacity-40">↓ XLSX</button>
            <button onClick={() => doExport('pdf')} disabled={!canExport} className="py-1.5 text-xs font-medium text-red-600 hover:text-red-800 border border-red-200 hover:border-red-300 rounded-lg bg-red-50 transition-colors disabled:opacity-40">↓ PDF</button>
            <button onClick={() => doExport('sheets')} disabled={!canExport} className="py-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 border border-blue-200 hover:border-blue-300 rounded-lg bg-blue-50 transition-colors disabled:opacity-40">↗ Sheets</button>
          </div>
          {exportError && (
            <p className="mt-2 text-[11px] text-red-500 whitespace-pre-wrap">{exportError}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Diff viewer ────────────────────────────────────────────────────────────────

type ModelSetting = { allowed: boolean; dailyTokenLimit: number | null };

/** Normalize absent/null model settings to canonical defaults for comparison. */
function normalizeSetting(s: ModelSetting | undefined): { allowed: boolean; dailyTokenLimit: number | null } {
  return { allowed: s?.allowed ?? false, dailyTokenLimit: s?.dailyTokenLimit ?? null };
}

function modelSettingsChanged(
  before: Record<string, ModelSetting> | null | undefined,
  after:  Record<string, ModelSetting> | null | undefined,
): boolean {
  const allModels = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  return Array.from(allModels).some((m) => {
    const nb = normalizeSetting((before ?? {})[m]);
    const na = normalizeSetting((after  ?? {})[m]);
    return nb.allowed !== na.allowed || nb.dailyTokenLimit !== na.dailyTokenLimit;
  });
}

function diffHasChanges(diff: AuditLogEntry['diff']): boolean {
  if (!diff) return false;
  const allKeys = Array.from(new Set([...Object.keys(diff.before ?? {}), ...Object.keys(diff.after ?? {})]));
  return allKeys.some((k) => {
    const bVal = (diff.before ?? {})[k];
    const aVal = (diff.after  ?? {})[k];
    if (k === 'modelSettings') {
      return modelSettingsChanged(
        bVal as Record<string, ModelSetting>,
        aVal as Record<string, ModelSetting>,
      );
    }
    return JSON.stringify(bVal) !== JSON.stringify(aVal);
  });
}

/** Renders a human-readable summary of modelSettings changes. */
function ModelSettingsDiff({
  before,
  after,
}: {
  before: Record<string, ModelSetting> | null | undefined;
  after:  Record<string, ModelSetting> | null | undefined;
}) {
  const { t, i18n } = useTranslation(['pages', 'common']);
  const allModels = Array.from(
    new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]),
  ).sort();

  const changes: { model: string; lines: { label: string; from: string; to: string }[] }[] = [];

  for (const model of allModels) {
    const nb = normalizeSetting((before ?? {})[model]);
    const na = normalizeSetting((after  ?? {})[model]);

    // Skip if nothing actually changed after normalization
    if (nb.allowed === na.allowed && nb.dailyTokenLimit === na.dailyTokenLimit) continue;

    const lines: { label: string; from: string; to: string }[] = [];

    if (nb.allowed !== na.allowed) {
      lines.push({
        label: t('auditLog.diff.access'),
        from:  nb.allowed ? t('auditLog.diff.allowed') : t('auditLog.diff.blocked'),
        to:    na.allowed ? t('auditLog.diff.allowed') : t('auditLog.diff.blocked'),
      });
    }
    if (nb.dailyTokenLimit !== na.dailyTokenLimit) {
      lines.push({
        label: t('auditLog.diff.dailyLimit'),
        from:  nb.dailyTokenLimit != null ? nb.dailyTokenLimit.toLocaleString(i18n.language) : '—',
        to:    na.dailyTokenLimit != null ? na.dailyTokenLimit.toLocaleString(i18n.language) : '—',
      });
    }
    if (lines.length) changes.push({ model, lines });
  }

  if (!changes.length) return <span className="text-gray-400 text-xs italic">{t('auditLog.diff.noModelChanges')}</span>;

  return (
    <div className="space-y-2">
      {changes.map(({ model, lines }) => (
        <div key={model} className="flex flex-col gap-0.5">
          <span className="font-mono text-xs text-gray-700 font-medium">{model}</span>
          {lines.map(({ label, from, to }) => (
            <span key={label} className="text-xs text-gray-500 pl-3">
              {label}:{' '}
              <span className="text-red-500 line-through">{from}</span>
              {' → '}
              <span className="text-green-600 font-medium">{to}</span>
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function FieldValue({ value }: { value: unknown }) {
  const { t } = useTranslation(['pages', 'common']);
  if (value === null || value === undefined) return <span className="text-gray-400 italic text-xs">{t('auditLog.diff.empty')}</span>;
  if (typeof value === 'boolean') return <span>{value ? t('auditLog.diff.yes') : t('auditLog.diff.no')}</span>;
  if (typeof value === 'string' && value === '(changed)') return <span className="italic text-gray-500">{t('auditLog.diff.changed')}</span>;
  return <span>{String(value)}</span>;
}

function DiffView({ diff }: { diff: AuditLogEntry['diff'] }) {
  const { t } = useTranslation(['pages', 'common']);
  if (!diff) return null;

  const allKeys = Array.from(
    new Set([...Object.keys(diff.before ?? {}), ...Object.keys(diff.after ?? {})]),
  );

  // Filter out keys where before === after (no actual change — e.g. name passed unchanged in body)
  const changedKeys = allKeys.filter(
    (k) => JSON.stringify((diff.before ?? {})[k]) !== JSON.stringify((diff.after ?? {})[k]),
  );

  // Also show keys that only appear in before (deleted) or only in after (new)
  const displayKeys = changedKeys.length > 0 ? changedKeys : allKeys;
  if (!displayKeys.length) return null;

  return (
    <div className="space-y-2">
      {displayKeys.map((k) => {
        const bVal = (diff.before ?? {})[k];
        const aVal = (diff.after  ?? {})[k];

        if (k === 'modelSettings') {
          return (
            <div key={k}>
              <p className="text-xs font-medium text-gray-500 mb-1.5">{t('auditLog.diff.modelPolicyChanges')}</p>
              <ModelSettingsDiff
                before={bVal as Record<string, ModelSetting>}
                after={aVal  as Record<string, ModelSetting>}
              />
            </div>
          );
        }

        return (
          <div key={k} className="flex items-baseline gap-3 text-xs">
            <span className="font-medium text-gray-500 w-28 shrink-0 capitalize">{k.replace(/([A-Z])/g, ' $1').toLowerCase()}</span>
            {bVal !== undefined && (
              <>
                <span className="text-red-500 line-through font-mono"><FieldValue value={bVal} /></span>
                <span className="text-gray-300">→</span>
              </>
            )}
            {aVal !== undefined && (
              <span className="text-green-600 font-medium font-mono"><FieldValue value={aVal} /></span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

export function AuditLog() {
  const { t, i18n } = useTranslation(['pages', 'common']);
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const [fromDate, setFromDate]               = useState('');
  const [toDate,   setToDate]                 = useState('');
  const [actionFilter, setActionFilter]       = useState('');
  const [targetTypeFilter, setTargetTypeFilter] = useState('');
  const [search, setSearch]                   = useState('');
  const [expandedId, setExpandedId]           = useState<string | null>(null);

  function resetPage() { setPage(0); }

  const params = {
    limit:  pageSize,
    offset: page * pageSize,
    ...(fromDate       ? { from:       new Date(fromDate + 'T00:00:00').toISOString() } : {}),
    ...(toDate         ? { to:         new Date(toDate   + 'T23:59:59').toISOString() } : {}),
    ...(actionFilter   ? { action:     actionFilter }     : {}),
    ...(targetTypeFilter ? { targetType: targetTypeFilter } : {}),
  };

  const { data, isLoading } = useQuery({
    queryKey: ['audit', params],
    queryFn: () => analyticsApi.audit(params),
  });

  const allRows = data?.data  ?? [];
  const total   = data?.total ?? 0;

  const rows = search
    ? allRows.filter((r) => {
        const q = search.toLowerCase();
        return (
          r.actorEmail?.toLowerCase().includes(q) ||
          (r.targetLabel ?? r.targetId)?.toLowerCase().includes(q)
        );
      })
    : allRows;

  return (
    <Layout>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">{t('common:nav.auditLog')}</h1>
        <ExportButton actionFilter={actionFilter} targetTypeFilter={targetTypeFilter} />
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 mb-5 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 font-medium">{t('auditLog.export.from')}</span>
          <input type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); resetPage(); }}
            className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 font-medium">{t('auditLog.export.to')}</span>
          <input type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); resetPage(); }}
            className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500" />
        </div>
        <select value={actionFilter} onChange={(e) => { setActionFilter(e.target.value); resetPage(); }}
          className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500 text-gray-600">
          <option value="">{t('auditLog.filters.allActions')}</option>
          {ALL_ACTIONS.map((a) => <option key={a} value={a}>{actionLabel(t, a)}</option>)}
        </select>
        <select value={targetTypeFilter} onChange={(e) => { setTargetTypeFilter(e.target.value); resetPage(); }}
          className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500 text-gray-600">
          <option value="">{t('auditLog.filters.allTargets')}</option>
          {TARGET_TYPES.map((tt) => <option key={tt} value={tt}>{t(`auditLog.targetTypes.${tt}`)}</option>)}
        </select>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('auditLog.filters.searchPlaceholder')}
          className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500 w-44"
        />
        {(fromDate || toDate || actionFilter || targetTypeFilter || search) && (
          <button onClick={() => { setFromDate(''); setToDate(''); setActionFilter(''); setTargetTypeFilter(''); setSearch(''); resetPage(); }}
            className="text-xs text-gray-400 hover:text-gray-700 transition-colors">
            {t('auditLog.filters.clearFilters')}
          </button>
        )}
        {total > 0 && (
          <span className="ml-auto text-xs text-gray-400">{t('auditLog.entriesCount', { count: total.toLocaleString(i18n.language) })}</span>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="p-10 flex flex-col items-center justify-center gap-3">
            <svg className="w-6 h-6 text-gray-300 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            <span className="text-sm text-gray-400">{t('auditLog.loading')}</span>
          </div>
        ) : rows.length === 0 ? (
          <div className="p-10 flex flex-col items-center justify-center gap-2">
            <div className="text-3xl mb-1">🔍</div>
            <p className="text-sm font-medium text-gray-500">{t('auditLog.empty.title')}</p>
            <p className="text-xs text-gray-400">{t('auditLog.empty.subtitle')}</p>
          </div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">{t('auditLog.export.columns.time')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">{t('auditLog.export.columns.actor')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">{t('auditLog.export.columns.action')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">{t('auditLog.export.columns.target')}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">{t('auditLog.export.columns.ip')}</th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-500 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((row: AuditLogEntry) => {
                  const expanded = expandedId === row.id;
                  const hasDiff = diffHasChanges(row.diff);
                  return (
                    <>
                      <tr
                        key={row.id}
                        className={`hover:bg-gray-50 ${hasDiff ? 'cursor-pointer' : ''}`}
                        onClick={() => hasDiff && setExpandedId(expanded ? null : row.id)}
                      >
                        <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap text-xs">
                          {format(new Date(row.createdAt), 'MMM d, yyyy HH:mm:ss', { locale: getDateFnsLocale() })}
                        </td>
                        <td className="px-4 py-2.5 text-gray-700 max-w-[220px] truncate text-xs" title={row.actorEmail}>
                          {row.actorEmail}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${actionColor(row.action)}`}>
                            {actionLabel(t, row.action)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-xs">
                          <span className="text-gray-400 mr-1.5">{t(`auditLog.targetTypes.${row.targetType}`, { defaultValue: row.targetType })}</span>
                          <span className="text-gray-700">{row.targetLabel ?? row.targetId}</span>
                        </td>
                        <td className="px-4 py-2.5 text-gray-400 font-mono text-xs">{row.ip ?? '—'}</td>
                        <td className="px-4 py-2.5 text-gray-300 text-xs">
                          {hasDiff && <span>{expanded ? '▲' : '▼'}</span>}
                        </td>
                      </tr>
                      {expanded && hasDiff && (
                        <tr key={`${row.id}-diff`} className="bg-gray-50">
                          <td colSpan={6} className="px-8 py-3">
                            <DiffView diff={row.diff} />
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>

            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
              <span className="text-xs text-gray-400">
                {t('auditLog.pagination.range', {
                  from: page * pageSize + 1,
                  to: Math.min((page + 1) * pageSize, total),
                  total: total.toLocaleString(i18n.language),
                })}
              </span>
              <div className="flex gap-2">
                <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}
                  className="text-xs text-gray-500 hover:text-gray-900 disabled:opacity-40 px-2 py-1">
                  ← {t('auditLog.pagination.previous')}
                </button>
                <button disabled={(page + 1) * pageSize >= total} onClick={() => setPage((p) => p + 1)}
                  className="text-xs text-gray-500 hover:text-gray-900 disabled:opacity-40 px-2 py-1">
                  {t('auditLog.pagination.next')} →
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
