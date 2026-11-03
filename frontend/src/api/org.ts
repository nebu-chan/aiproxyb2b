import { api } from './client';
import type { OrgUser, Department, ModelSettings } from './admin';

export interface AiMediatorKey {
  id: string;
  description: string;
  isActive: boolean;
  createdAt: string;
}

export const orgApi = {
  users: {
    list: () => api.get<{ data: OrgUser[] }>('/org/users').then((r) => r.data.data),
    get: (userId: string) => api.get<{ data: OrgUser }>(`/org/users/${userId}`).then((r) => r.data.data),
    create: (body: { email: string; name?: string; surname?: string; role: 'admin' | 'member' | 'dept_lead'; departmentId?: string }) =>
      api.post<{ data: OrgUser }>('/org/users', body).then((r) => r.data.data),
    update: (userId: string, body: { email?: string; name?: string | null; surname?: string | null; phone?: string | null; modelSettings?: ModelSettings | null; role?: string; isActive?: boolean; departmentId?: string | null; password?: string; balanceRub?: number | null }) =>
      api.patch<{ data: OrgUser }>(`/org/users/${userId}`, body).then((r) => r.data.data),
    delete: (userId: string) => api.delete(`/org/users/${userId}`),
  },
  departments: {
    list: () => api.get<{ data: Department[] }>('/org/departments').then((r) => r.data.data),
    get: (deptId: string) => api.get<{ data: Department }>(`/org/departments/${deptId}`).then((r) => r.data.data),
    create: (body: { name: string }) =>
      api.post<{ data: Department }>('/org/departments', body).then((r) => r.data.data),
    update: (deptId: string, body: { name?: string; modelSettings?: ModelSettings | null; aiMediatorKeyId?: string | null; balanceRub?: number | null }) =>
      api.patch<{ data: Department }>(`/org/departments/${deptId}`, body).then((r) => r.data.data),
    delete: (deptId: string) => api.delete(`/org/departments/${deptId}`),
  },
  aiMediatorKeys: {
    list: () => api.get<{ data: AiMediatorKey[] }>('/org/ai-mediator-keys').then((r) => r.data.data),
    add: (body: { apiKey: string; description: string }) =>
      api.post<{ data: AiMediatorKey }>('/org/ai-mediator-keys', body).then((r) => r.data.data),
    update: (keyId: string, body: { description: string }) =>
      api.patch<{ data: AiMediatorKey }>(`/org/ai-mediator-keys/${keyId}`, body).then((r) => r.data.data),
    remove: (keyId: string) => api.delete(`/org/ai-mediator-keys/${keyId}`),
    balance: (keyId: string) =>
      api.post<{ balance: number }>('/org/ai-mediator/balance', { keyId }).then((r) => r.data),
  },
  balance: {
    me: () => api.get<{ data: { spentRub: number; limitRub: number | null; deptBalance: { limitRub: number; spentRub: number } | null; periodStart: string; resetDay: number } }>('/org/me/balance').then((r) => r.data.data),
    user: (userId: string) => api.get<{ data: { spentRub: number; limitRub: number | null; periodStart: string } }>(`/org/users/${userId}/balance`).then((r) => r.data.data),
    department: (deptId: string) => api.get<{ data: { spentRub: number; limitRub: number | null; periodStart: string } }>(`/org/departments/${deptId}/balance`).then((r) => r.data.data),
  },
  billing: {
    periodCost: () => api.get<{ data: { totalCostRub: number; periodStart: string; resetDay: number } }>('/org/billing/period-cost').then((r) => r.data.data),
  },
  settings: {
    get: () => api.get<{ data: { balanceResetDay: number; name: string } }>('/org/settings').then((r) => r.data.data),
    update: (body: { balanceResetDay?: number }) =>
      api.patch<{ data: { balanceResetDay: number } }>('/org/settings', body).then((r) => r.data.data),
  },
};
