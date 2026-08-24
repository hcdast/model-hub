import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

let accessToken: string | null = null;
let refreshPromise: Promise<string> | null = null;
function hasAccessToken(value: unknown): value is { data: { accessToken: string } } {
  if (value === null || typeof value !== 'object') return false;
  const data = Reflect.get(value, 'data');
  return (
    data !== null &&
    typeof data === 'object' &&
    typeof Reflect.get(data, 'accessToken') === 'string'
  );
}
function getCsrfToken(): string | undefined {
  const prefix = 'portal_csrf_token=';
  const cookie = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : undefined;
}



function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = axios
      .post(
        '/api/v1/auth/refresh',
        {},
        {
          withCredentials: true,
          headers: { 'X-CSRF-Token': getCsrfToken() ?? '' },
        },
      )
      .then((response) => {
        const body: unknown = response.data;
        if (!hasAccessToken(body)) {
          throw new Error('Invalid refresh response');
        }
        const token = body.data.accessToken;
        return token;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

export function setPortalAccessToken(token: string | null): void {
  accessToken = token;
}

export const portalApi = axios.create({
  baseURL: '/api/v1',
  timeout: 15000,
  withCredentials: true,
});

portalApi.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  const method = config.method?.toUpperCase();
  if (method && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    config.headers['X-CSRF-Token'] = getCsrfToken() ?? '';
  }
  return config;
});

portalApi.interceptors.response.use(
  (response) => response.data,
  async (error: AxiosError) => {
    const originalRequest = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
    if (
      error.response?.status !== 401 ||
      !originalRequest ||
      originalRequest._retry ||
      originalRequest.url?.includes('/auth/refresh')
    ) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;
    try {
      accessToken = await refreshAccessToken();
      originalRequest.headers.Authorization = `Bearer ${accessToken}`;
      return portalApi(originalRequest);
    } catch (refreshError) {
      accessToken = null;
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
      return Promise.reject(refreshError);
    }
  },
);

export const authApi = {
  register: (data: { email: string; username: string; password: string }) =>
    portalApi.post('/auth/register', data),
  login: (data: { email: string; password: string }) =>
    portalApi.post('/auth/login', data),
  logout: () => portalApi.post('/auth/logout'),
  refreshSession: () =>
    refreshAccessToken().then((token) => ({
      data: { accessToken: token },
    })),
  getMe: () => portalApi.get('/auth/me'),
  updateMe: (data: { username?: string; avatar?: string }) =>
    portalApi.put('/auth/me', data),
  changePassword: (data: { oldPassword: string; newPassword: string }) =>
    portalApi.post('/auth/change-password', data),
};

export const apiKeyApi = {
  getLimits: () => portalApi.get('/api-keys/limits'),
  list: () => portalApi.get('/api-keys'),
  create: (data: {
    name: string;
    permissions?: string[];
    rateLimit?: { maxQps?: number; maxDailyRequests?: number };
  }) => portalApi.post('/api-keys', data),
  delete: (id: string) => portalApi.delete(`/api-keys/${id}`),
  update: (
    id: string,
    data: {
      name?: string;
      enabled?: boolean;
      rateLimit?: { maxQps?: number; maxDailyRequests?: number };
    },
  ) => portalApi.put(`/api-keys/${id}`, data),
};

export default portalApi;
