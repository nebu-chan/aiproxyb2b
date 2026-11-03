import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { adminApi } from '../api/admin';
import { IMP_TOKEN_KEY } from '../api/client';

export function useImpersonation() {
  const { impersonating } = useAuth();
  const queryClient = useQueryClient();

  async function exitImpersonation() {
    await adminApi.impersonate.exit();
    queryClient.clear();

    if (sessionStorage.getItem(IMP_TOKEN_KEY)) {
      // New-tab flow: clean up and close this tab
      sessionStorage.removeItem(IMP_TOKEN_KEY);
      sessionStorage.removeItem('user_info');
      window.close();
      // Fallback if the browser blocks window.close() (e.g. not opened via script)
      window.location.href = '/login';
    } else {
      // Legacy same-tab flow
      window.location.href = '/admin/superadmin';
    }
  }

  return {
    isImpersonating: !!impersonating,
    impersonatedOrg: impersonating,
    exitImpersonation,
  };
}
