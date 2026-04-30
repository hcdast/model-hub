import { create } from 'zustand';

type ThemeMode = 'light' | 'dark';

interface ThemeState {
  mode: ThemeMode;
  toggle: () => void;
}

/**
 * 主题状态 Store
 * 管理明暗主题切换，使用 localStorage 持久化用户偏好
 */
export const useThemeStore = create<ThemeState>((set) => ({
  mode: (localStorage.getItem('theme-mode') as ThemeMode) || 'light',
  toggle: () =>
    set((state) => {
      const next = state.mode === 'light' ? 'dark' : 'light';
      localStorage.setItem('theme-mode', next);
      return { mode: next };
    }),
}));
