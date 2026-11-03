import { api } from './client';

export interface AuthUser {
  id: string;
  email: string;
  role: string;
  name: string | null;
  surname: string | null;
  locale: string;
}

export interface AuthOrg {
  id: string;
  name: string;
  slug: string;
}

export interface AuthImpersonating {
  orgId: string;
  orgName: string;
  sessionHandle: string;
}

export interface AuthResponse {
  user: AuthUser;
  org: AuthOrg;
  impersonating?: AuthImpersonating;
}

export const authApi = {
  login: (email: string, password: string) =>
    api.post<AuthResponse>('/auth/login', { email, password }).then((r) => r.data),

  register: (orgName: string, email: string, password: string) =>
    api.post<AuthResponse>('/auth/register', { orgName, email, password }).then((r) => r.data),

  logout: () =>
    api.post('/auth/logout').then((r) => r.data),

  me: () =>
    api.get<{ user: AuthUser; org: AuthOrg; impersonating?: AuthImpersonating }>('/auth/me').then((r) => r.data),
};
