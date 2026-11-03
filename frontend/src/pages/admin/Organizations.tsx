import { useState, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { adminApi, type Organization, type OrgAdmin } from '../../api/admin';
import { Layout } from '../../components/Layout';
import { format } from 'date-fns';
import { getDateFnsLocale } from '../../i18n/dateLocale';

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

type SortCol = 'name' | 'createdAt' | 'userCount' | 'deptCount' | 'requests30d' | 'tokens30d' | 'lastActiveAt';

function SortIcon({ col, sortCol, sortDir }: { col: SortCol; sortCol: SortCol; sortDir: 'asc' | 'desc' }) {
  if (col !== sortCol) return <span className="ml-1 text-gray-300">↕</span>;
  return <span className="ml-1 text-brand-600">{sortDir === 'asc' ? '↑' : '↓'}</span>;
}

function LoginAsCell({ admins, orgId }: { admins: OrgAdmin[]; orgId: string }) {
  const { t } = useTranslation(['pages', 'common']);
  const [selectedId, setSelectedId] = useState(() => admins.find((a) => a.isActive)?.id ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const impersonateMutation = useMutation({
    mutationFn: ({ orgId, userId }: { orgId: string; userId: string }) =>
      adminApi.impersonate.ott(orgId, userId),
    onSuccess: ({ ott }) => {
      setLoading(false);
      window.open(`/impersonate?ott=${encodeURIComponent(ott)}`, '_blank', 'noopener');
    },
    onError: (err: any) => {
      setLoading(false);
      setError(err?.response?.data?.error ?? t('adminOrganizations.loginAs.failed'));
    },
  });

  if (admins.length === 0) return <span className="text-xs text-gray-400">{t('adminOrganizations.loginAs.noAdmins')}</span>;

  const selected = admins.find((a) => a.id === selectedId);

  return (
    <div className="flex items-center gap-2 justify-end">
      {error && <span className="text-xs text-red-500">{error}</span>}
      <select
        value={selectedId}
        onChange={(e) => { setSelectedId(e.target.value); setError(''); }}
        className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
      >
        {admins.map((admin) => {
          const label = [admin.name, admin.surname].filter(Boolean).join(' ') || admin.email;
          return (
            <option key={admin.id} value={admin.id} disabled={!admin.isActive}>
              {label}{!admin.isActive ? t('adminOrganizations.loginAs.inactiveSuffix') : ''}
            </option>
          );
        })}
      </select>
      <button
        onClick={() => { setLoading(true); setError(''); impersonateMutation.mutate({ orgId, userId: selectedId }); }}
        disabled={loading || !selectedId || !selected?.isActive}
        className="px-3 py-1.5 text-xs font-medium text-brand-600 hover:text-brand-800 border border-brand-200 hover:border-brand-300 rounded-lg bg-brand-50 transition-colors disabled:opacity-40 whitespace-nowrap"
      >
        {loading ? t('adminOrganizations.loginAs.opening') : t('adminOrganizations.loginAs.loginAs')}
      </button>
    </div>
  );
}

export function AdminOrganizations() {
  const { t } = useTranslation(['pages', 'common']);
  const [sortCol, setSortCol] = useState<SortCol>('requests30d');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const { data: orgs = [], isLoading } = useQuery({
    queryKey: ['admin', 'orgs'],
    queryFn: adminApi.orgs.list,
  });

  function handleSort(col: SortCol) {
    if (col === sortCol) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortCol(col); setSortDir('desc'); }
  }

  const sorted = useMemo(() => {
    return [...(orgs as Organization[])].sort((a, b) => {
      let av: any = a[sortCol];
      let bv: any = b[sortCol];
      if (sortCol === 'lastActiveAt' || sortCol === 'createdAt') {
        av = av ? new Date(av).getTime() : 0;
        bv = bv ? new Date(bv).getTime() : 0;
      }
      if (typeof av === 'string') { av = av.toLowerCase(); bv = (bv as string).toLowerCase(); }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [orgs, sortCol, sortDir]);

  function Th({ col, label, align = 'left' }: { col: SortCol; label: string; align?: 'left' | 'right' }) {
    return (
      <th
        className={`px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-gray-800 transition-colors ${align === 'right' ? 'text-right' : 'text-left'}`}
        onClick={() => handleSort(col)}
      >
        {label}<SortIcon col={col} sortCol={sortCol} sortDir={sortDir} />
      </th>
    );
  }

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('adminOrganizations.title')}</h1>
        <p className="text-gray-500 text-sm mt-1">{t('adminOrganizations.subtitle', { count: (orgs as Organization[]).length })}</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400 text-sm">{t('common:loading')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <Th col="name"         label={t('adminOrganizations.table.organization')} />
                <Th col="createdAt"    label={t('adminOrganizations.table.created')}      />
                <Th col="userCount"    label={t('adminOrganizations.table.users')}        align="right" />
                <Th col="deptCount"    label={t('adminOrganizations.table.departments')}  align="right" />
                <Th col="requests30d"  label={t('adminOrganizations.table.requests30d')} align="right" />
                <Th col="tokens30d"    label={t('adminOrganizations.table.tokens30d')}   align="right" />
                <Th col="lastActiveAt" label={t('adminOrganizations.table.lastActive')}  />
                <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider text-right">{t('adminOrganizations.table.admins')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sorted.map((org) => (
                <tr key={org.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{org.name}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                    {format(new Date(org.createdAt), 'MMM d, yyyy', { locale: getDateFnsLocale() })}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600">{org.userCount}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{org.deptCount}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{formatNum(org.requests30d)}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{formatNum(org.tokens30d)}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                    {org.lastActiveAt ? format(new Date(org.lastActiveAt), 'MMM d, yyyy HH:mm', { locale: getDateFnsLocale() }) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <LoginAsCell admins={org.admins} orgId={org.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Layout>
  );
}
