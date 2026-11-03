import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';

export function ResetPassword() {
  const { t } = useTranslation(['pages', 'common']);
  const navigate = useNavigate();
  // Token is in the URL fragment (#token=...) so it is never sent to any server
  const token = window.location.hash.startsWith('#token=')
    ? window.location.hash.slice('#token='.length)
    : '';

  const [password, setPassword]   = useState('');
  const [confirm, setConfirm]     = useState('');
  const [error, setError]         = useState('');
  const [success, setSuccess]     = useState(false);
  const [loading, setLoading]     = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (password.length < 8) { setError(t('resetPassword.passwordTooShort')); return; }
    if (password !== confirm) { setError(t('resetPassword.passwordMismatch')); return; }
    if (!token) { setError(t('resetPassword.invalidLinkNoToken')); return; }

    setLoading(true);
    try {
      await api.post('/auth/reset-password', { token, password });
      setSuccess(true);
      setTimeout(() => navigate('/login'), 3000);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? t('resetPassword.genericError'));
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 w-full max-w-md p-8 text-center">
          <p className="text-red-600 text-sm">{t('resetPassword.invalidLink')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 w-full max-w-md p-8">
        <div className="text-center mb-8">
          <div className="text-3xl font-bold text-gray-900">AI Gateway</div>
          <p className="text-gray-500 mt-2">{t('resetPassword.subtitle')}</p>
        </div>

        {success ? (
          <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg px-4 py-3 text-sm text-center">
            {t('resetPassword.successMessage')}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('resetPassword.newPasswordLabel')} <span className="text-red-500">*</span></label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder={t('resetPassword.newPasswordPlaceholder')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('resetPassword.confirmPasswordLabel')} <span className="text-red-500">*</span></label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                placeholder={t('resetPassword.confirmPasswordPlaceholder')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-medium py-2 px-4 rounded-lg transition-colors"
            >
              {loading ? t('common:buttons.saving') : t('resetPassword.submit')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
