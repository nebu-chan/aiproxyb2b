import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminApi } from '../api/admin';
import { IMP_TOKEN_KEY } from '../api/client';

export function ImpersonatePage() {
  const { t } = useTranslation(['pages', 'common']);
  const [error, setError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ott = params.get('ott');
    if (!ott) {
      setError(t('impersonatePage.invalidLink'));
      return;
    }

    adminApi.impersonate.exchange(ott)
      .then(({ token }) => {
        sessionStorage.setItem(IMP_TOKEN_KEY, token);
        window.location.replace('/dashboard');
      })
      .catch(() => setError(t('impersonatePage.failed')));
  }, []);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-6 py-4 max-w-sm text-center">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-sm text-gray-400">{t('impersonatePage.starting')}</div>
    </div>
  );
}
