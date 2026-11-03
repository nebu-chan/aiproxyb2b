import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import type { ModelStat, UserStat, DepartmentStat, UsageLog } from '../api/analytics';
import { exportToGoogleSheets } from './googleSheets';

export type ExportFormat = 'csv' | 'xlsx' | 'pdf' | 'sheets';

// ── XLSX / CSV ─────────────────────────────────────────────────────────────────

function triggerDownload(wb: XLSX.WorkBook, filename: string, fmt: 'csv' | 'xlsx') {
  if (fmt === 'csv') {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } else {
    XLSX.writeFile(wb, `${filename}.xlsx`);
  }
}

function makeWorkbook(rows: Record<string, unknown>[], sheetName: string): XLSX.WorkBook {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return wb;
}

// ── PDF ────────────────────────────────────────────────────────────────────────

function exportPdf(
  title: string,
  columns: string[],
  rows: unknown[][],
  filename: string,
) {
  const doc = new jsPDF({ orientation: 'landscape' });
  doc.setFontSize(14);
  doc.text(title, 14, 16);
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(`Exported ${format(new Date(), 'MMM d, yyyy HH:mm')}`, 14, 22);

  autoTable(doc, {
    head: [columns],
    body: rows as unknown as string[][],
    startY: 28,
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 248, 250] },
  });

  doc.save(`${filename}.pdf`);
}


// ── Public export functions ────────────────────────────────────────────────────

function makeModelRows(models: ModelStat[]) {
  return models.map((m) => ({
    Model: m.model ?? '',
    Requests: m.requests,
    Tokens: m.tokens,
    'Avg Latency (ms)': m.avgLatencyMs,
  }));
}

function makeUserRows(users: UserStat[]) {
  return users.map((u) => ({
    Name: [u.name, u.surname].filter(Boolean).join(' ') || '',
    Email: u.email,
    Requests: u.requests,
    Tokens: u.tokens,
    'Top Model': u.topModel ?? '',
  }));
}

function makeDeptRows(depts: DepartmentStat[]) {
  return depts.map((d) => ({
    Department: d.departmentName,
    Requests: d.requests,
    Tokens: d.tokens,
    'Top Model': d.topModel ?? '',
  }));
}

function makeLogRows(logs: UsageLog[]) {
  return logs.map((l) => ({
    Time: format(new Date(l.createdAt), 'yyyy-MM-dd HH:mm:ss'),
    Model: l.model ?? '',
    User: [l.userName, l.userSurname].filter(Boolean).join(' ') || l.userEmail || '',
    Email: l.userEmail ?? '',
    'Prompt Tokens': l.promptTokens ?? '',
    'Completion Tokens': l.completionTokens ?? '',
    'Total Tokens': l.totalTokens ?? '',
    'Latency (ms)': l.requestDurationMs ?? '',
    'Status Code': l.statusCode ?? '',
    Error: l.errorMessage ?? '',
    Endpoint: l.endpoint ?? '',
  }));
}

export async function exportModels(models: ModelStat[], fmt: ExportFormat, periodLabel: string) {
  const rows = makeModelRows(models);
  const filename = `analytics_by_model_${periodLabel}`;
  if (fmt === 'csv' || fmt === 'xlsx') return triggerDownload(makeWorkbook(rows, 'By Model'), filename, fmt);
  if (fmt === 'pdf') return exportPdf(`Analytics — By Model (${periodLabel})`, ['Model', 'Requests', 'Tokens', 'Avg Latency (ms)'], rows.map(Object.values), filename);
  if (fmt === 'sheets') return exportToGoogleSheets(rows, `Analytics — By Model (${periodLabel})`);
}

export async function exportUsers(users: UserStat[], fmt: ExportFormat, periodLabel: string) {
  const rows = makeUserRows(users);
  const filename = `analytics_by_user_${periodLabel}`;
  if (fmt === 'csv' || fmt === 'xlsx') return triggerDownload(makeWorkbook(rows, 'By User'), filename, fmt);
  if (fmt === 'pdf') return exportPdf(`Analytics — By User (${periodLabel})`, ['Name', 'Email', 'Requests', 'Tokens', 'Top Model'], rows.map(Object.values), filename);
  if (fmt === 'sheets') return exportToGoogleSheets(rows, `Analytics — By User (${periodLabel})`);
}

export async function exportDepartments(depts: DepartmentStat[], fmt: ExportFormat, periodLabel: string) {
  const rows = makeDeptRows(depts);
  const filename = `analytics_by_dept_${periodLabel}`;
  if (fmt === 'csv' || fmt === 'xlsx') return triggerDownload(makeWorkbook(rows, 'By Department'), filename, fmt);
  if (fmt === 'pdf') return exportPdf(`Analytics — By Department (${periodLabel})`, ['Department', 'Requests', 'Tokens', 'Top Model'], rows.map(Object.values), filename);
  if (fmt === 'sheets') return exportToGoogleSheets(rows, `Analytics — By Department (${periodLabel})`);
}

export async function exportLogs(logs: UsageLog[], fmt: ExportFormat, periodLabel: string) {
  const rows = makeLogRows(logs);
  const filename = `analytics_request_log_${periodLabel}`;
  if (fmt === 'csv' || fmt === 'xlsx') return triggerDownload(makeWorkbook(rows, 'Request Log'), filename, fmt);
  if (fmt === 'pdf') return exportPdf(`Analytics — Request Log (${periodLabel})`, ['Time', 'Model', 'User', 'Email', 'Prompt', 'Completion', 'Total Tokens', 'Latency (ms)', 'Status', 'Error', 'Endpoint'], rows.map(Object.values), filename);
  if (fmt === 'sheets') return exportToGoogleSheets(rows, `Analytics — Request Log (${periodLabel})`);
}
