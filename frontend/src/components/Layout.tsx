import { type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import { ImpersonationBanner } from './ImpersonationBanner';
import clsx from 'clsx';

interface NavItem {
  labelKey: string;
  path: string;
  icon: ReactNode;
  orgAdminOnly?: boolean;
  superAdminOnly?: boolean;
  deptLeadOnly?: boolean;
}

const s = { strokeWidth: 1.5, stroke: 'currentColor', fill: 'none', xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 24 24', className: 'w-4 h-4 flex-shrink-0' } as const;

const navItems: NavItem[] = [
  {
    labelKey: 'nav.dashboard', path: '/dashboard', orgAdminOnly: true,
    icon: <svg {...s}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" /></svg>,
  },
  {
    labelKey: 'nav.apiKeys', path: '/keys', orgAdminOnly: true,
    icon: <svg {...s}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" /></svg>,
  },
  {
    labelKey: 'nav.analytics', path: '/analytics', orgAdminOnly: true,
    icon: <svg {...s}><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" /></svg>,
  },
  {
    labelKey: 'nav.chat', path: '/chat',
    icon: <svg {...s}><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" /></svg>,
  },
  {
    labelKey: 'nav.imageGeneration', path: '/image-gen',
    icon: <svg {...s}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" /></svg>,
  },
  {
    labelKey: 'nav.overview', path: '/dept-dashboard', deptLeadOnly: true,
    icon: <svg {...s}><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" /></svg>,
  },
  {
    labelKey: 'nav.myDepartment', path: '/my-department', deptLeadOnly: true,
    icon: <svg {...s}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" /></svg>,
  },
  {
    labelKey: 'nav.users', path: '/org/users', orgAdminOnly: true,
    icon: <svg {...s}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></svg>,
  },
  {
    labelKey: 'nav.departments', path: '/org/departments', orgAdminOnly: true,
    icon: <svg {...s}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" /></svg>,
  },
  {
    labelKey: 'nav.auditLog', path: '/audit', orgAdminOnly: true,
    icon: <svg {...s}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" /></svg>,
  },
  {
    labelKey: 'nav.platformOverview', path: '/admin/superadmin', superAdminOnly: true,
    icon: <svg {...s}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" /></svg>,
  },
  {
    labelKey: 'nav.organizations', path: '/admin/orgs', superAdminOnly: true,
    icon: <svg {...s}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" /></svg>,
  },
  {
    labelKey: 'nav.platformAdmins', path: '/admin/admins', superAdminOnly: true,
    icon: <svg {...s}><path strokeLinecap="round" strokeLinejoin="round" d="M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z" /></svg>,
  },
];

export function Layout({ children }: { children: ReactNode }) {
  const { t } = useTranslation('common');
  const { user, logout } = useAuth();
  const location = useLocation();
  const isOrgAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const isSuperAdmin = user?.role === 'superadmin';
  const isDeptLead = user?.role === 'dept_lead';

  const visibleItems = navItems.filter((item) => {
    if (item.superAdminOnly) return isSuperAdmin;
    if (isSuperAdmin) return false; // superadmin only sees superAdminOnly items
    if (item.orgAdminOnly) return isOrgAdmin;
    if (item.deptLeadOnly) return isDeptLead;
    return true;
  });

  return (
    <div className="flex flex-col h-screen">
    <ImpersonationBanner />
    <div className="flex flex-1 overflow-hidden bg-gray-50">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 bg-gray-900 text-white flex flex-col">
        <div className="px-5 py-4 border-b border-gray-700">
          <div className="text-lg font-bold text-white">{t('appName')}</div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {visibleItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={clsx(
                'flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors',
                location.pathname.startsWith(item.path)
                  ? 'bg-brand-600 text-white'
                  : 'text-gray-300 hover:bg-gray-700 hover:text-white',
              )}
            >
              {item.icon}
              {t(item.labelKey)}
            </Link>
          ))}
        </nav>

        <div className="px-3 py-3 border-t border-gray-700">
          <Link
            to="/profile"
            className={clsx(
              'flex items-center gap-2.5 px-3 py-2 rounded-md transition-colors',
              location.pathname === '/profile'
                ? 'bg-brand-600 text-white'
                : 'hover:bg-gray-700 text-gray-300 hover:text-white',
            )}
          >
            <div className="w-7 h-7 rounded-full bg-gray-600 flex items-center justify-center text-xs font-medium flex-shrink-0">
              {user?.name || user?.surname
                ? `${user.name?.[0] ?? ''}${user.surname?.[0] ?? ''}`.toUpperCase()
                : (user?.email?.[0] ?? '?').toUpperCase()}
            </div>
            <div className="min-w-0 flex-1 text-xs">
              <div className="truncate font-medium">{user?.name ? `${user.name}${user.surname ? ' ' + user.surname : ''}` : user?.email}</div>
              <div className={clsx('truncate', location.pathname === '/profile' ? 'text-brand-200' : 'text-gray-500')}>
                {user?.role === 'superadmin' ? t('roles.superadmin') : user?.role === 'admin' ? t('roles.admin') : user?.role === 'dept_lead' ? t('roles.deptLead') : t('roles.member')}
              </div>
            </div>
          </Link>
          <button
            onClick={logout}
            className="mt-1 w-full text-left px-3 py-1.5 text-xs text-gray-500 hover:text-white rounded-md hover:bg-gray-700 transition-colors"
          >
            {t('signOut')}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="p-8">{children}</div>
      </main>
    </div>
    </div>
  );
}
