import { api } from './client';
import type { OverviewStats, DailyStat } from './analytics';

export type ModelSetting = { allowed: boolean };
export type ModelSettings = Record<string, ModelSetting>;

export interface OrgUser {
  id: string;
  email: string;
  name: string | null;
  surname: string | null;
  phone: string | null;
  role: string;
  isActive: boolean;
  departmentId: string | null;
  departmentName?: string | null;
  modelSettings: ModelSettings | null;
  balanceRub: string | null;
  createdAt: string;
}

export interface Department {
  id: string;
  orgId: string;
  name: string;
  modelSettings: ModelSettings | null;
  aiMediatorKeyId: string | null;
  balanceRub: string | null;
  createdAt: string;
  userCount?: number;
}

export interface AdminUser {
  id: string;
  name: string | null;
  surname: string | null;
  email: string;
  isActive: boolean;
  createdAt: string;
}

export interface OrgAdmin {
  id: string;
  name: string | null;
  surname: string | null;
  email: string;
  isActive: boolean;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  userCount: number;
  deptCount: number;
  requests30d: number;
  tokens30d: number;
  lastActiveAt: string | null;
  admins: OrgAdmin[];
}

export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  authHeaderName: string;
  authHeaderPrefix: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface Quota {
  id: string;
  orgId: string;
  requestsPerMinute: number;
  requestsPerDay: number;
  tokensPerDay: number;
}

export interface PlatformUsageLog {
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
  orgId: string | null;
  orgName: string | null;
}

export interface OrgUsage {
  orgId: string;
  orgName: string;
  isActive: boolean;
  userCount: number;
  requests: number;
  tokens: number;
  lastActiveAt: string | null;
}

export interface PlatformStats {
  totalOrgs: number;
  activeOrgs: number;
  totalUsers: number;
  totalRequests: number;
  totalTokens: number;
}

export interface PlatformErrorStats {
  overview: { totalRequests: number; errorRequests: number; successRequests: number };
  daily: { date: string; total: number; errors: number; successes: number }[];
  byStatus: { statusCode: number | null; count: number }[];
  byModel: { model: string | null; errors: number; total: number }[];
  byOrg: { orgId: string; orgName: string; errors: number; total: number }[];
}

export interface PlatformTokenStats {
  models: { model: string | null; requests: number; tokens: number; avgLatencyMs: number }[];
  orgs: { orgId: string; orgName: string; requests: number; tokens: number; topModel: string | null }[];
}

export interface PlatformLatencyStats {
  overview: { avgMs: number; p50: number; p95: number; p99: number; minMs: number; maxMs: number };
  daily: { date: string; avgMs: number; p95: number }[];
  byModel: { model: string | null; requests: number; avgMs: number; p50: number; p95: number; p99: number; minMs: number; maxMs: number }[];
  slowest: { id: string; model: string | null; requestDurationMs: number | null; statusCode: number | null; totalTokens: number | null; createdAt: string; orgName: string }[];
}

export const adminApi = {
  orgs: {
    list: () => api.get<{ data: Organization[] }>('/admin/orgs').then((r) => r.data.data),
    admins: (orgId: string) => api.get<{ data: OrgAdmin[] }>(`/admin/orgs/${orgId}/admins`).then((r) => r.data.data),
  },

  admins: {
    list: () => api.get<{ data: AdminUser[] }>('/admin/admins').then((r) => r.data.data),
    create: (body: { name: string; surname?: string; email: string; password: string }) =>
      api.post<{ data: AdminUser }>('/admin/admins', body).then((r) => r.data.data),
    setActive: (id: string, isActive: boolean) =>
      api.patch<{ data: AdminUser }>(`/admin/admins/${id}/active`, { isActive }).then((r) => r.data.data),
    resetPassword: (id: string) =>
      api.post<{ data: { password: string } }>(`/admin/admins/${id}/reset-password`).then((r) => r.data.data),
    delete: (id: string) => api.delete(`/admin/admins/${id}`),
  },


  providers: {
    list: () => api.get<{ data: Provider[] }>('/admin/providers').then((r) => r.data.data),
    create: (body: Omit<Provider, 'id' | 'createdAt'> & { apiKey?: string }) =>
      api.post<{ data: Provider }>('/admin/providers', body).then((r) => r.data.data),
    update: (id: string, body: Partial<Provider> & { apiKey?: string }) =>
      api.patch<{ data: Provider }>(`/admin/providers/${id}`, body).then((r) => r.data.data),
    delete: (id: string) => api.delete(`/admin/providers/${id}`),
  },

  usage: () =>
    api.get<{ data: OrgUsage[] }>('/admin/orgs/usage').then((r) => r.data.data),

  logs: (limit = 50, offset = 0, sortBy = 'createdAt', sortOrder: 'asc' | 'desc' = 'desc') =>
    api.get<{ data: PlatformUsageLog[]; limit: number; offset: number; total: number }>(
      '/admin/logs', { params: { limit, offset, sortBy, sortOrder } },
    ).then((r) => r.data),

  impersonate: {
    start: (orgId: string) =>
      api.post<{ data: { orgId: string; orgName: string } }>(`/admin/impersonate/${orgId}`).then((r) => r.data.data),
    ott: (orgId: string, userId?: string) =>
      api.post<{ data: { ott: string } }>(`/admin/impersonate/ott/${orgId}`, userId ? { userId } : {}).then((r) => r.data.data),
    exchange: (ott: string) =>
      api.post<{ data: { token: string; orgId: string; orgName: string } }>('/admin/impersonate/exchange', { ott }).then((r) => r.data.data),
    exit: () =>
      api.post<{ ok: boolean }>('/admin/impersonate/exit').then((r) => r.data),
  },

  stats: () =>
    api.get<{ data: PlatformStats }>('/admin/stats').then((r) => r.data.data),

  platformOverview: (days = 30) =>
    api.get<{ data: OverviewStats }>('/admin/stats/overview', { params: { days } }).then((r) => r.data.data),

  platformDaily: (days = 30) =>
    api.get<{ data: DailyStat[] }>('/admin/stats/daily', { params: { days } }).then((r) => r.data.data),

  platformErrors: () =>
    api.get<{ data: PlatformErrorStats }>('/admin/analytics/errors').then((r) => r.data.data),

  platformTokens: () =>
    api.get<{ data: PlatformTokenStats }>('/admin/analytics/tokens').then((r) => r.data.data),

  platformLatency: () =>
    api.get<{ data: PlatformLatencyStats }>('/admin/analytics/latency').then((r) => r.data.data),
};
