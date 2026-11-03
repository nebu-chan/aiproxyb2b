import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { api } from '../api/client';
import { Layout } from '../components/Layout';
import type { ModelSettings } from '../api/admin';
import { format } from 'date-fns';
import { getDateFnsLocale } from '../i18n/dateLocale';

interface DeptMember {
  id: string;
  email: string;
  name: string | null;
  surname: string | null;
  role: string;
  isActive: boolean;
  modelSettings: ModelSettings | null;
  createdAt: string;
}

interface DeptInfo {
  id: string;
  name: string;
  modelSettings: ModelSettings | null;
}

interface MyDeptData {
  dept: DeptInfo;
  members: DeptMember[];
}

function displayName(m: { name: string | null; surname: string | null; email: string }) {
  if (m.name || m.surname) return `${m.name ?? ''} ${m.surname ?? ''}`.trim();
  return m.email;
}

export function MyDepartment() {
  const { t } = useTranslation(['pages', 'common']);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({ email: '', password: '', name: '', surname: '' });
  const [addError, setAddError] = useState('');

  const { data, isLoading } = useQuery<{ data: MyDeptData }>({
    queryKey: ['my-department'],
    queryFn: () => api.get('/org/my-department').then((r) => r.data),
  });

  const dept = data?.data.dept;
  const members = data?.data.members ?? [];

  const addMutation = useMutation({
    mutationFn: () => api.post('/org/my-department/users', addForm).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-department'] });
      setShowAddForm(false);
      setAddForm({ email: '', password: '', name: '', surname: '' });
      setAddError('');
    },
    onError: (err: any) => {
      setAddError(err?.response?.data?.error ?? t('myDepartment.addForm.createError'));
    },
  });

  if (isLoading) {
    return (
      <Layout>
        <div className="p-8 text-center text-gray-400 text-sm">{t('common:loading')}</div>
      </Layout>
    );
  }

  if (!dept) {
    return (
      <Layout>
        <div className="p-8 text-center text-gray-400 text-sm">
          {t('myDepartment.notAssigned')}
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{dept.name}</h1>
          <p className="text-gray-500 text-sm mt-1">{t('myDepartment.memberCount', { count: members.length })}</p>
        </div>
        <button
          onClick={() => setShowAddForm((v) => !v)}
          className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg"
        >
          {t('myDepartment.addMember')}
        </button>
      </div>


      {/* Add member form */}
      {showAddForm && (
        <div className="mb-6 p-4 bg-white border border-gray-200 rounded-xl flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{t('common:fields.firstName')}</label>
            <input
              type="text"
              value={addForm.name}
              onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 w-32"
              placeholder={t('myDepartment.addForm.firstNamePlaceholder')}
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{t('common:fields.lastName')}</label>
            <input
              type="text"
              value={addForm.surname}
              onChange={(e) => setAddForm((f) => ({ ...f, surname: e.target.value }))}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 w-32"
              placeholder={t('myDepartment.addForm.lastNamePlaceholder')}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{t('common:fields.email')}</label>
            <input
              type="email"
              value={addForm.email}
              onChange={(e) => { setAddForm((f) => ({ ...f, email: e.target.value })); setAddError(''); }}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 w-48"
              placeholder={t('myDepartment.addForm.emailPlaceholder')}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{t('common:fields.password')}</label>
            <input
              type="password"
              value={addForm.password}
              onChange={(e) => setAddForm((f) => ({ ...f, password: e.target.value }))}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 w-36"
              placeholder={t('myDepartment.addForm.passwordPlaceholder')}
            />
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex gap-2">
              <button
                onClick={() => addMutation.mutate()}
                disabled={addMutation.isPending || !addForm.email || !addForm.password}
                className="bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-1.5 rounded-lg"
              >
                {t('myDepartment.addForm.add')}
              </button>
              <button
                onClick={() => { setShowAddForm(false); setAddForm({ email: '', password: '', name: '', surname: '' }); setAddError(''); }}
                className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5"
              >
                {t('common:buttons.cancel')}
              </button>
            </div>
            {addError && <p className="text-xs text-red-500">{addError}</p>}
          </div>
        </div>
      )}

      {/* Members table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-5 py-3 text-gray-500 font-medium">{t('myDepartment.columns.name')}</th>
              <th className="text-left px-5 py-3 text-gray-500 font-medium">{t('myDepartment.columns.email')}</th>
              <th className="text-left px-5 py-3 text-gray-500 font-medium">{t('myDepartment.columns.limits')}</th>
              <th className="text-left px-5 py-3 text-gray-500 font-medium">{t('myDepartment.columns.joined')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {members.map((m) => {
              const hasLimits = m.modelSettings && Object.keys(m.modelSettings).length > 0;
              return (
                <tr
                  key={m.id}
                  onClick={() => navigate(`/my-department/users/${m.id}`)}
                  className="hover:bg-gray-50 cursor-pointer"
                >
                  <td className="px-5 py-3 font-medium text-gray-900">
                    {displayName(m)}
                    {m.id === user?.id && <span className="ml-1.5 text-xs text-gray-400 font-normal">{t('myDepartment.me')}</span>}
                  </td>
                  <td className="px-5 py-3 text-gray-500">{m.email}</td>
                  <td className="px-5 py-3">
                    {hasLimits ? (
                      <span className="inline-flex items-center gap-1 text-xs text-brand-700 bg-brand-50 border border-brand-200 px-2 py-0.5 rounded-full">
                        {t('myDepartment.configured')}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400 italic">{t('myDepartment.default')}</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-gray-500">{format(new Date(m.createdAt), 'MMM d, yyyy', { locale: getDateFnsLocale() })}</td>
                </tr>
              );
            })}
            {members.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-gray-400 text-sm">{t('myDepartment.noMembers')}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}
