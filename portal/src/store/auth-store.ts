import { create } from 'zustand';
import { authApi, setPortalAccessToken } from '../services/auth-api';
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
}

interface ApiEnvelope<T> {
  data: T;
}

interface AuthPayload {
  accessToken: string;
  user: User;
}

interface AuthState {
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
  register: (email: string, username: string, password: string) => Promise<void>;

  /** 登出 */
  logout: () => Promise<void>;

  /** 初始化（从 localStorage 恢复登录状态） */
  init: () => Promise<void>;

  /** 更新用户信息 */
  updateProfile: (data: { username?: string; avatar?: string }) => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,

  setUser: (user) => set({ user, isAuthenticated: !!user }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),

  login: async (email: string, password: string) => {
    set({ isLoading: true, error: null });
    try {
      const response = await authApi.login({ email, password }) as unknown as ApiEnvelope<AuthPayload>;
      const { accessToken, user } = response.data;
      setPortalAccessToken(accessToken);
      set({ user, isAuthenticated: true, isLoading: false });
    } catch (error: unknown) {
      const message = axios.isAxiosError(error)
        ? String(error.response?.data?.message || 'Login failed')
        : 'Login failed';
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  register: async (email: string, username: string, password: string) => {
    set({ isLoading: true, error: null });
    try {
      const response = await authApi.register({ email, username, password }) as unknown as ApiEnvelope<AuthPayload>;
      const { accessToken, user } = response.data;
      setPortalAccessToken(accessToken);
      set({ user, isAuthenticated: true, isLoading: false });
    } catch (error: unknown) {
      const message = axios.isAxiosError(error)
        ? String(error.response?.data?.message || 'Registration failed')
        : 'Registration failed';
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  logout: async () => {
    try {
      await authApi.logout();
    } catch {
      // 本地会话仍需清理，避免失效 Cookie 导致界面停留在登录态。
    }
    setPortalAccessToken(null);
    set({ user: null, isAuthenticated: false, isLoading: false });
  },

  init: async () => {
    set({ isLoading: true });
    try {
      const refreshResponse = await authApi.refreshSession() as ApiEnvelope<{ accessToken: string }>;
      setPortalAccessToken(refreshResponse.data.accessToken);
      const meResponse = await authApi.getMe() as unknown as ApiEnvelope<User>;
      set({ user: meResponse.data, isAuthenticated: true, isLoading: false });
    } catch {
      setPortalAccessToken(null);
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },

  updateProfile: async (data: { username?: string; avatar?: string }) => {
    set({ isLoading: true, error: null });
    try {
      const response = await authApi.updateMe(data) as unknown as ApiEnvelope<User>;
      set({ user: response.data, isLoading: false });
    } catch (error: unknown) {
      const message = axios.isAxiosError(error)
        ? String(error.response?.data?.message || 'Update failed')
        : 'Update failed';
      set({ error: message, isLoading: false });
      throw error;
    }
  },
}));
