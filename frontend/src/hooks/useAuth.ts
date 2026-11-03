import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { authApi, type AuthUser } from '../api/auth';
import { IMP_TOKEN_KEY } from '../api/client';
import i18n from '../i18n';

// Small non-sensitive cache for synchronous route guards (role, id, email only — no token).
// Actual authentication is enforced server-side via HttpOnly cookie.
// In impersonation tabs (identified by sessionStorage.imp_token) we use sessionStorage
// to keep the cached user info isolated from the superadmin's localStorage.
const USER_INFO_KEY = 'user_info';

function isImpersonationTab(): boolean {
  return !!sessionStorage.getItem(IMP_TOKEN_KEY);
}

function userInfoStorage(): Storage {
  return isImpersonationTab() ? sessionStorage : localStorage;
}

export function getCachedUserInfo(): AuthUser | null {
  try {
    const raw = userInfoStorage().getItem(USER_INFO_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setCachedUserInfo(user: AuthUser) {
  userInfoStorage().setItem(USER_INFO_KEY, JSON.stringify(user));
}

function clearCachedUserInfo() {
  userInfoStorage().removeItem(USER_INFO_KEY);
  if (isImpersonationTab()) {
    sessionStorage.removeItem(IMP_TOKEN_KEY);
  }
}

export function useAuth() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: authApi.me,
    retry: false,
    // In impersonation tabs the Bearer token is the auth signal; in normal tabs use the cached user.
    enabled: isImpersonationTab() || !!localStorage.getItem(USER_INFO_KEY),
    // On 401 (expired/revoked session), clear the cache so RequireAuth redirects to login
    throwOnError: false,
  });

  // Keep the localStorage cache in sync with fresh server data
  useEffect(() => {
    if (data?.user) {
      setCachedUserInfo(data.user);
      if (data.user.locale && data.user.locale !== i18n.language) {
        i18n.changeLanguage(data.user.locale);
      }
    }
  }, [data?.user]);

  const loginMutation = useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      authApi.login(email, password),
    onSuccess: (data) => {
      setCachedUserInfo(data.user);
      if (data.user.locale && data.user.locale !== i18n.language) i18n.changeLanguage(data.user.locale);
      queryClient.setQueryData(['me'], { user: data.user, org: data.org });
      const role = data.user.role;
      navigate(role === 'superadmin' ? '/admin/superadmin' : role === 'admin' ? '/dashboard' : role === 'dept_lead' ? '/dept-dashboard' : '/chat');
    },
  });

  const registerMutation = useMutation({
    mutationFn: ({ orgName, email, password }: { orgName: string; email: string; password: string }) =>
      authApi.register(orgName, email, password),
    onSuccess: (data) => {
      setCachedUserInfo(data.user);
      if (data.user.locale && data.user.locale !== i18n.language) i18n.changeLanguage(data.user.locale);
      queryClient.setQueryData(['me'], { user: data.user, org: data.org });
      navigate('/dashboard');
    },
  });

  const logout = async () => {
    try { await authApi.logout(); } catch { /* ignore */ }
    clearCachedUserInfo();
    queryClient.clear();
    navigate('/login');
  };

  return {
    user: data?.user ?? null,
    org: data?.org ?? null,
    impersonating: data?.impersonating ?? null,
    isLoading,
    isAuthenticated: !!data?.user,
    login: loginMutation,
    register: registerMutation,
    logout,
  };
}
