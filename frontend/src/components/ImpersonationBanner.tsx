import { useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { useImpersonation } from '../hooks/useImpersonation';

export function ImpersonationBanner() {
  const { t } = useTranslation('common');
  const { isImpersonating, impersonatedOrg, exitImpersonation } = useImpersonation();
  const [exiting, setExiting] = useState(false);

  if (!isImpersonating) return null;

  async function handleExit() {
    setExiting(true);
    try {
      await exitImpersonation();
    } catch {
      setExiting(false);
    }
  }

  return (
    <div className="bg-yellow-400 text-yellow-900 flex items-center justify-center gap-4 px-4 py-2 text-sm font-medium shadow">
      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
      </svg>
      <span>
        <Trans
          i18nKey="impersonation.banner"
          ns="common"
          values={{ orgName: impersonatedOrg?.orgName }}
          components={{ strong: <strong /> }}
        />
      </span>
      <button
        onClick={handleExit}
        disabled={exiting}
        className="ml-2 px-3 py-1 bg-yellow-900 text-yellow-100 rounded-md text-xs font-semibold hover:bg-yellow-800 disabled:opacity-50 transition-colors"
      >
        {exiting ? t('impersonation.exiting') : t('impersonation.exit')}
      </button>
    </div>
  );
}
