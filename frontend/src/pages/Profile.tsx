import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { Layout } from '../components/Layout';
import { useNavigate } from 'react-router-dom';
import i18n from '../i18n';

interface ProfileData {
  id: string;
  email: string;
  name: string | null;
  surname: string | null;
  role: string;
  locale: string;
}

const SUPPORTED_LOCALES: { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'ru', label: 'Русский' },
];

export function Profile() {
  const { t } = useTranslation(['pages', 'common']);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery<{ data: ProfileData }>({
    queryKey: ['me-profile'],
    queryFn: () => api.get('/org/me').then((r) => r.data),
  });

  const profile = data?.data;

  const [name, setName] = useState('');
  const [surname, setSurname] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (profile) {
      setName(profile.name ?? '');
      setSurname(profile.surname ?? '');
      setEmail(profile.email);
    }
  }, [profile]);

  const mutation = useMutation({
    mutationFn: (body: Record<string, string>) =>
      api.patch('/org/me', body).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['me-profile'] });
      setPassword('');
      setConfirm('');
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  const resetLinkMutation = useMutation({
    mutationFn: () => api.post('/org/me/send-reset-link'),
    onSuccess: () => {
      // Log out so the user must use the reset link
      setTimeout(() => navigate('/login'), 1500);
    },
  });

  const [localeSaved, setLocaleSaved] = useState(false);
  const localeMutation = useMutation({
    mutationFn: (locale: string) => api.patch('/org/me', { locale }).then((r) => r.data),
    onSuccess: (_data, locale) => {
      i18n.changeLanguage(locale);
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['me-profile'] });
      setLocaleSaved(true);
      setTimeout(() => setLocaleSaved(false), 3000);
    },
  });

  const passwordMismatch = !!password && password !== confirm;
  const canSave = !isLoading && !mutation.isPending && !passwordMismatch && (
    name !== (profile?.name ?? '') ||
    surname !== (profile?.surname ?? '') ||
    email !== (profile?.email ?? '') ||
    !!password
  );

  function handleSave() {
    if (!canSave) return;
    const body: Record<string, string> = {};
    if (name !== (profile?.name ?? '')) body.name = name;
    if (surname !== (profile?.surname ?? '')) body.surname = surname;
    if (email !== (profile?.email ?? '')) body.email = email;
    if (password) body.password = password;
    mutation.mutate(body);
  }

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('profile.heading')}</h1>
        <p className="text-gray-500 text-sm mt-1">{t('profile.subheading')}</p>
      </div>

      <div className="max-w-lg bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        {isLoading ? (
          <div className="text-gray-400 text-sm">{t('common:loading')}</div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">{t('common:fields.firstName')}</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="John"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">{t('common:fields.lastName')}</label>
                <input
                  type="text"
                  value={surname}
                  onChange={(e) => setSurname(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="Doe"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('common:fields.email')} <span className="text-red-500">*</span></label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>

            <div className="pt-2 border-t border-gray-100">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-medium text-gray-600">{t('profile.language')}</p>
                {localeSaved && (
                  <span className="text-xs text-green-600">{t('common:buttons.saved')}</span>
                )}
              </div>
              <div className="flex gap-2">
                {SUPPORTED_LOCALES.map(({ code, label }) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => localeMutation.mutate(code)}
                    disabled={localeMutation.isPending || profile?.locale === code}
                    className={`text-sm font-medium px-4 py-2 rounded-lg border transition-colors disabled:cursor-default ${
                      profile?.locale === code
                        ? 'bg-brand-600 border-brand-600 text-white'
                        : 'border-gray-300 text-gray-600 hover:border-brand-300 hover:text-brand-600'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-2 border-t border-gray-100">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-medium text-gray-600">{t('profile.changePassword')}</p>
                <div className="flex items-center gap-2">
                  {resetLinkMutation.isSuccess && (
                    <span className="text-xs text-green-600">{t('profile.resetLinkSent')}</span>
                  )}
                  <button
                    type="button"
                    onClick={() => resetLinkMutation.mutate()}
                    disabled={resetLinkMutation.isPending}
                    className="text-xs text-brand-600 hover:text-brand-700 disabled:opacity-50 font-medium border border-brand-200 hover:border-brand-300 px-2.5 py-1 rounded-lg transition-colors"
                  >
                    {resetLinkMutation.isPending ? t('common:buttons.sending') : t('profile.sendResetLink')}
                  </button>
                </div>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">{t('profile.newPassword')}</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    placeholder={t('profile.minChars') ?? undefined}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">{t('profile.confirmPassword')}</label>
                  <input
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 ${passwordMismatch ? 'border-red-400' : 'border-gray-300'}`}
                    placeholder={t('profile.repeatPassword') ?? undefined}
                  />
                  {passwordMismatch && (
                    <p className="text-xs text-red-500 mt-1">{t('profile.passwordMismatch')}</p>
                  )}
                </div>
              </div>
            </div>

            {mutation.isError && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
                {(mutation.error as any)?.response?.data?.error ?? t('profile.saveFailed')}
              </div>
            )}

            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={handleSave}
                disabled={!canSave && !saved}
                className={`text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors ${saved ? 'bg-green-600 hover:bg-green-600' : 'bg-brand-600 hover:bg-brand-700 disabled:opacity-50'}`}
              >
                {mutation.isPending ? t('common:buttons.saving') : saved ? t('common:buttons.saved') : t('common:buttons.save')}
              </button>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
