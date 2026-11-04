import { create } from 'zustand';
import { authApi, hasPortalSessionHint, setPortalAccessToken } from '../services/auth-api';
import axios from 'axios';

interface User {
  id: string;
  email: string;
  username: string;
  avatar?: string;
  role: string;
  status: string;
  usage: {
    totalWorkflows: number;
    totalRuns: number;
    totalTokens: number;
  };
  createdAt: string;
  lastLoginAt?: string;
  authMethods?: { password: boolean; google: boolean; github: boolean };
}

interface ApiEnvelope<T> {
  data: T;
}

interface AuthPayload {
  accessToken: string;
  user: User;
}

interface AuthState {
  isInitialized: boolean;
  /** 当前用户 */
  user: User | null;
  /** 是否已登录 */
  isAuthenticated: boolean;
  /** 是否正在加载 */
  isLoading: boolean;
  /** 错误信息 */
  error: string | null;

  // Actions
  setUser: (user: User | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  /** 登录 */
  login: (email: string, password: string) => Promise<void>;

  /** 注册 */
  register: (email: string, username: string, password: string, verificationCode: string, acceptedTerms: boolean) => Promise<void>;

  /** 登出 */
  logout: () => Promise<void>;

  /** 初始化（通过会话 Cookie 恢复登录状态） */
  init: () => Promise<void>;

  /** 更新用户信息 */
  updateProfile: (data: { username?: string; avatar?: string }) => Promise<void>;
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (!axios.isAxiosError(error)) return fallback;

  const message = error.response?.data?.message;
  if (Array.isArray(message)) return message.join('; ');
  if (typeof message === 'string' && message.trim()) return message;
  if (!error.response) return 'Unable to reach the server. Please try again.';
  return fallback;
}

let initPromise: Promise<void> | null = null;
let sessionVersion = 0;

export const useAuthStore = create<AuthState>((set, get) => ({
  isInitialized: false,
  user: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,

  setUser: (user) => {
    sessionVersion += 1;
    set({ user, isAuthenticated: !!user });
  },
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),

  login: async (email: string, password: string) => {
    sessionVersion += 1;
    set({ isLoading: true, error: null });
    try {
      const response = await authApi.login({ email, password }) as unknown as ApiEnvelope<AuthPayload>;
      const { accessToken, user } = response.data;
      setPortalAccessToken(accessToken);
      set({ user, isAuthenticated: true, isLoading: false });
    } catch (error: unknown) {
      const message = getApiErrorMessage(error, 'Login failed');
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  register: async (email, username, password, verificationCode, acceptedTerms) => {
    sessionVersion += 1;
    set({ isLoading: true, error: null });
    try {
      const response = await authApi.register({ email, username, password, verificationCode, acceptedTerms }) as unknown as ApiEnvelope<AuthPayload>;
      const { accessToken, user } = response.data;
      setPortalAccessToken(accessToken);
      set({ user, isAuthenticated: true, isLoading: false });
    } catch (error: unknown) {
      const message = getApiErrorMessage(error, 'Registration failed');
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  logout: async () => {
    sessionVersion += 1;
    try {
      await authApi.logout();
    } catch {
      // 本地会话仍需清理，避免失效 Cookie 导致界面停留在登录态。
    }
    setPortalAccessToken(null);
    set({ user: null, isAuthenticated: false, isLoading: false });
  },

  init: async () => {
    if (get().isInitialized) return;
    if (initPromise) return initPromise;
    if (!hasPortalSessionHint()) {
      setPortalAccessToken(null);
      set({ user: null, isAuthenticated: false, isLoading: false, isInitialized: true });
      return;
    }
    const version = sessionVersion;
    initPromise = (async () => {
      set({ isLoading: true });
      try {
        const refreshResponse = await authApi.refreshSession() as ApiEnvelope<{ accessToken: string }>;
        if (version !== sessionVersion) return;
        setPortalAccessToken(refreshResponse.data.accessToken);
        const meResponse = await authApi.getMe() as unknown as ApiEnvelope<User>;
        if (version !== sessionVersion) return;
        set({ user: meResponse.data, isAuthenticated: true, isLoading: false });
      } catch {
        if (version !== sessionVersion) return;
        setPortalAccessToken(null);
        set({ user: null, isAuthenticated: false, isLoading: false });
      } finally {
        set({ isInitialized: true });
        initPromise = null;
      }
    })();
    return initPromise;
  },

  updateProfile: async (data: { username?: string; avatar?: string }) => {
    set({ isLoading: true, error: null });
    try {
      const response = await authApi.updateMe(data) as unknown as ApiEnvelope<User>;
      set({ user: response.data, isLoading: false });
    } catch (error: unknown) {
      const message = getApiErrorMessage(error, 'Update failed');
      set({ error: message, isLoading: false });
      throw error;
    }
  },
}));
