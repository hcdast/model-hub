import { create } from 'zustand';

interface AuthState {
  token: string | null;
  username: string | null;
  roles: string[];
  permissions: string[];
  isAuthenticated: boolean;
  login: (token: string, username: string, roles?: string[], permissions?: string[]) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem('token'),
  username: localStorage.getItem('username'),
  roles: JSON.parse(localStorage.getItem('roles') || '[]'),
  permissions: JSON.parse(localStorage.getItem('permissions') || '[]'),
  isAuthenticated: !!localStorage.getItem('token'),
  login: (token, username, roles = [], permissions = []) => {
    localStorage.setItem('token', token);
    localStorage.setItem('username', username);
    localStorage.setItem('roles', JSON.stringify(roles));
    localStorage.setItem('permissions', JSON.stringify(permissions));
    set({ token, username, roles, permissions, isAuthenticated: true });
  },
  logout: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    localStorage.removeItem('roles');
    localStorage.removeItem('permissions');
    set({ token: null, username: null, roles: [], permissions: [], isAuthenticated: false });
  },
}));
