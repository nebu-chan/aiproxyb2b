import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getCachedUserInfo, useAuth } from './hooks/useAuth';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Dashboard } from './pages/Dashboard';
import { ApiKeys } from './pages/ApiKeys';
import { Analytics } from './pages/Analytics';
import { Chat } from './pages/Chat';
import { AdminProviders } from './pages/admin/Providers';
import { AdminOrganizations } from './pages/admin/Organizations';
import { OrgUsers } from './pages/org/Users';
import { OrgDepartments } from './pages/org/Departments';
import { UserEdit } from './pages/org/UserEdit';
import { DepartmentEdit } from './pages/org/DepartmentEdit';
import { Requests } from './pages/Requests';
import { TokenUsage } from './pages/TokenUsage';
import { SuccessRate } from './pages/SuccessRate';
import { Latency } from './pages/Latency';
import { Profile } from './pages/Profile';
import { MyDepartment } from './pages/MyDepartment';
import { DeptDashboard } from './pages/DeptDashboard';
import { DeptUserEdit } from './pages/DeptUserEdit';
import { AuditLog } from './pages/AuditLog';
import { SuperAdminDashboard } from './pages/admin/SuperAdminDashboard';
import { AdminAdmins } from './pages/admin/Admins';
import { PlatformRequests } from './pages/admin/PlatformRequests';
import { PlatformSuccessRate } from './pages/admin/PlatformSuccessRate';
import { PlatformTokenUsage } from './pages/admin/PlatformTokenUsage';
import { PlatformLatency } from './pages/admin/PlatformLatency';
import { ImageGen } from './pages/ImageGen';
import { ResetPassword } from './pages/ResetPassword';
import { ImpersonatePage } from './pages/ImpersonatePage';
import { IMP_TOKEN_KEY } from './api/client';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

function DefaultRedirect() {
  const user = getCachedUserInfo();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'superadmin') return <Navigate to="/admin/superadmin" replace />;
  if (user.role === 'admin') return <Navigate to="/dashboard" replace />;
  if (user.role === 'dept_lead') return <Navigate to="/dept-dashboard" replace />;
  return <Navigate to="/chat" replace />;
}

function RequireAuth({ children, adminOnly = false }: { children: JSX.Element; adminOnly?: boolean }) {
  // Hooks must be called unconditionally — useAuth first, then conditional returns
  const { isLoading, isAuthenticated, user } = useAuth();
  const cached = getCachedUserInfo();

  // In impersonation tabs there's no user_info in sessionStorage until /auth/me resolves —
  // show a spinner rather than redirecting to login.
  const isImpTab = !!sessionStorage.getItem(IMP_TOKEN_KEY);
  if (!cached && isLoading) {
    if (isImpTab) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="text-sm text-gray-400">Verifying session…</div>
        </div>
      );
    }
    return <Navigate to="/login" replace />;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-sm text-gray-400">Verifying session…</div>
      </div>
    );
  }

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  if (adminOnly && user?.role !== 'admin' && user?.role !== 'superadmin') {
    return <Navigate to="/chat" replace />;
  }

  return children;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/impersonate" element={<ImpersonatePage />} />

          <Route
            path="/dashboard"
            element={
              <RequireAuth adminOnly>
                <Dashboard />
              </RequireAuth>
            }
          />
          <Route
            path="/keys"
            element={
              <RequireAuth adminOnly>
                <ApiKeys />
              </RequireAuth>
            }
          />
          <Route
            path="/analytics"
            element={
              <RequireAuth adminOnly>
                <Analytics />
              </RequireAuth>
            }
          />
          <Route
            path="/chat"
            element={
              <RequireAuth>
                <Chat />
              </RequireAuth>
            }
          />
          <Route
            path="/image-gen"
            element={
              <RequireAuth>
                <ImageGen />
              </RequireAuth>
            }
          />
          <Route
            path="/admin/superadmin"
            element={
              <RequireAuth>
                <SuperAdminDashboard />
              </RequireAuth>
            }
          />
          <Route
            path="/admin/providers"
            element={
              <RequireAuth>
                <AdminProviders />
              </RequireAuth>
            }
          />
          <Route
            path="/admin/orgs"
            element={
              <RequireAuth>
                <AdminOrganizations />
              </RequireAuth>
            }
          />
          <Route path="/admin/admins" element={<RequireAuth><AdminAdmins /></RequireAuth>} />
          <Route path="/admin/requests" element={<RequireAuth><PlatformRequests /></RequireAuth>} />
          <Route path="/admin/success-rate" element={<RequireAuth><PlatformSuccessRate /></RequireAuth>} />
          <Route path="/admin/token-usage" element={<RequireAuth><PlatformTokenUsage /></RequireAuth>} />
          <Route path="/admin/latency" element={<RequireAuth><PlatformLatency /></RequireAuth>} />
          <Route
            path="/org/users"
            element={
              <RequireAuth>
                <OrgUsers />
              </RequireAuth>
            }
          />
          <Route
            path="/org/users/:userId"
            element={
              <RequireAuth>
                <UserEdit />
              </RequireAuth>
            }
          />
          <Route
            path="/org/departments"
            element={
              <RequireAuth>
                <OrgDepartments />
              </RequireAuth>
            }
          />
          <Route
            path="/org/departments/:deptId"
            element={
              <RequireAuth>
                <DepartmentEdit />
              </RequireAuth>
            }
          />

          <Route
            path="/requests"
            element={
              <RequireAuth adminOnly>
                <Requests />
              </RequireAuth>
            }
          />

          <Route
            path="/token-usage"
            element={
              <RequireAuth adminOnly>
                <TokenUsage />
              </RequireAuth>
            }
          />

          <Route
            path="/success-rate"
            element={
              <RequireAuth adminOnly>
                <SuccessRate />
              </RequireAuth>
            }
          />

          <Route
            path="/latency"
            element={
              <RequireAuth adminOnly>
                <Latency />
              </RequireAuth>
            }
          />
          <Route
            path="/audit"
            element={
              <RequireAuth adminOnly>
                <AuditLog />
              </RequireAuth>
            }
          />

          <Route
            path="/dept-dashboard"
            element={
              <RequireAuth>
                <DeptDashboard />
              </RequireAuth>
            }
          />

          <Route
            path="/my-department"
            element={
              <RequireAuth>
                <MyDepartment />
              </RequireAuth>
            }
          />

          <Route
            path="/my-department/users/:userId"
            element={
              <RequireAuth>
                <DeptUserEdit />
              </RequireAuth>
            }
          />

          <Route
            path="/profile"
            element={
              <RequireAuth>
                <Profile />
              </RequireAuth>
            }
          />

          <Route path="/" element={<DefaultRedirect />} />
          <Route path="*" element={<DefaultRedirect />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
