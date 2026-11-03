import axios from 'axios';

export const IMP_TOKEN_KEY = 'imp_token';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '/api',
  headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
  // Send HttpOnly auth cookie on every request (same-origin or with proxy)
  withCredentials: true,
});

// In impersonation tabs, override the cookie with a tab-local Bearer token stored in sessionStorage.
api.interceptors.request.use((config) => {
  const impToken = sessionStorage.getItem(IMP_TOKEN_KEY);
  if (impToken) {
    config.headers['Authorization'] = `Bearer ${impToken}`;
  }
  return config;
});

// On 401 from non-auth endpoints, clear cached user info and redirect to login
api.interceptors.response.use(
  (res) => res,
  (error) => {
    const url: string = error.config?.url ?? '';
    const isAuthEndpoint = url === '/auth/login' || url === '/auth/register';
    if (error.response?.status === 401 && !isAuthEndpoint) {
      localStorage.removeItem('user_info');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);
