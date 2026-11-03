import { api } from './client';

export interface OverviewStats {
  totalRequests: number;
  successRequests: number;
  totalTokens: number;
  avgLatencyMs: number;
  todayTokens: number;
}

export interface DailyStat {
  date: string;
  requests: number;
  tokens: number;
  errors: number;
}

export interface ModelStat {
  model: string | null;
  requests: number;
  tokens: number;
  avgLatencyMs: number;
}

export interface UsageLog {
  id: string;
  model: string | null;
  endpoint: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  requestDurationMs: number | null;
  statusCode: number | null;
  errorMessage: string | null;
  createdAt: string;
  userId: string | null;
  userName: string | null;
  userSurname: string | null;
  userEmail: string | null;
  costRub: string | null;
}

export interface UserStat {
  userId: string;
  name: string | null;
  surname: string | null;
  email: string;
  requests: number;
  tokens: number;
  topModel: string | null;
}

export interface DepartmentStat {
  departmentId: string;
  departmentName: string;
  requests: number;
  tokens: number;
  topModel: string | null;
}

export interface ErrorOverview {
  totalRequests: number;
  errorRequests: number;
  successRequests: number;
}

export interface DailyErrorStat {
  date: string;
  total: number;
  errors: number;
  successes: number;
}

export interface StatusCodeStat {
  statusCode: number | null;
  count: number;
}

export interface ModelErrorStat {
  model: string | null;
  errors: number;
  total: number;
}

export interface UserErrorStat {
  userId: string | null;
  userName: string | null;
  userSurname: string | null;
  userEmail: string | null;
  errors: number;
}

export interface ErrorStats {
  overview: ErrorOverview;
  daily: DailyErrorStat[];
  byStatus: StatusCodeStat[];
  byModel: ModelErrorStat[];
  byUser: UserErrorStat[];
}

export interface LatencyOverview {
  avgMs: number;
  p50: number;
  p95: number;
  p99: number;
  minMs: number;
  maxMs: number;
}

export interface DailyLatencyStat {
  date: string;
  avgMs: number;
  p95: number;
}

export interface ModelLatencyStat {
  model: string | null;
  requests: number;
  avgMs: number;
  p50: number;
  p95: number;
  p99: number;
  minMs: number;
  maxMs: number;
}

export interface SlowestRequest {
  id: string;
  model: string | null;
  requestDurationMs: number | null;
  statusCode: number | null;
  totalTokens: number | null;
  createdAt: string;
  userName: string | null;
  userSurname: string | null;
  userEmail: string | null;
}

export interface LatencyStats {
  overview: LatencyOverview;
  daily: DailyLatencyStat[];
  byModel: ModelLatencyStat[];
  slowest: SlowestRequest[];
}

export interface AuditLogEntry {
  id: string;
  orgId: string;
  actorId: string | null;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  targetLabel: string | null;
  diff: { before?: Record<string, unknown>; after?: Record<string, unknown> } | null;
  ip: string | null;
  createdAt: string;
}

export const analyticsApi = {
  overview: (days = 30) =>
    api.get<{ data: OverviewStats }>('/analytics/overview', { params: { days } }).then((r) => r.data.data),

  daily: (from?: string, to?: string) =>
    api
      .get<{ data: DailyStat[] }>('/analytics/daily', { params: { from, to } })
      .then((r) => r.data.data),

  models: (from?: string, to?: string) =>
    api.get<{ data: ModelStat[] }>('/analytics/models', { params: { from, to } }).then((r) => r.data.data),

  logs: (limit = 50, offset = 0, sortBy = 'createdAt', sortOrder: 'asc' | 'desc' = 'desc', statusCode?: number, from?: string, to?: string) =>
    api
      .get<{ data: UsageLog[]; limit: number; offset: number; total: number }>('/analytics/logs', {
        params: { limit, offset, sortBy, sortOrder, from, to, ...(statusCode !== undefined ? { statusCode } : {}) },
      })
      .then((r) => r.data),

  exportLogs: (from?: string, to?: string) =>
    api.get<{ data: UsageLog[] }>('/analytics/export/logs', { params: { from, to } }).then((r) => r.data.data),

  users: (from?: string, to?: string) =>
    api.get<{ data: UserStat[] }>('/analytics/users', { params: { from, to } }).then((r) => r.data.data),

  departments: (from?: string, to?: string) =>
    api.get<{ data: DepartmentStat[] }>('/analytics/departments', { params: { from, to } }).then((r) => r.data.data),

  errors: () =>
    api.get<{ data: ErrorStats }>('/analytics/errors').then((r) => r.data.data),

  latency: () =>
    api.get<{ data: LatencyStats }>('/analytics/latency').then((r) => r.data.data),

  audit: (params: { from?: string; to?: string; action?: string; targetType?: string; limit?: number; offset?: number }) =>
    api.get<{ data: AuditLogEntry[]; total: number; limit: number; offset: number }>(
      '/analytics/audit', { params },
    ).then((r) => r.data),

  exportAudit: (params: { from?: string; to?: string; action?: string; targetType?: string }) =>
    api.get<{ data: AuditLogEntry[] }>('/analytics/export/audit', { params }).then((r) => r.data.data),
};
