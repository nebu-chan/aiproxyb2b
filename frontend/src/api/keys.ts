import { api } from './client';

export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface CreatedApiKey {
  key: string; // full raw key, shown once
  data: ApiKey;
}

export const keysApi = {
  list: () => api.get<{ data: ApiKey[] }>('/api-keys').then((r) => r.data.data),

  create: (name: string) =>
    api.post<CreatedApiKey>('/api-keys', { name }).then((r) => r.data),

  toggle: (id: string, isActive: boolean) =>
    api.patch<{ data: ApiKey }>(`/api-keys/${id}`, { isActive }).then((r) => r.data.data),

  delete: (id: string) => api.delete(`/api-keys/${id}`),
};
