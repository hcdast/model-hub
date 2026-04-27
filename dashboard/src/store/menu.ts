import { create } from 'zustand';
import { menuApi } from '../services/api';

export interface MenuItem {
  key: string;
  path?: string;
  label: string;
  icon: string;
  sortOrder: number;
  parentKey?: string;
  requiredPermission?: string;
  children?: MenuItem[];
}

export interface MenuGroup {
  key: string;
  label: string;
  icon: string;
  sortOrder: number;
  children: MenuItem[];
}

// Fallback menu when API fails
const FALLBACK_MENU: MenuGroup[] = [
  {
    key: 'overview',
    label: '系统总览',
    icon: 'DashboardOutlined',
    sortOrder: 0,
    children: [
      { key: 'dashboard', path: '/', label: '总览', icon: 'DashboardOutlined', sortOrder: 0 },
    ],
  },
];

interface MenuState {
  menuGroups: MenuGroup[];
  loading: boolean;
  error: boolean;
  fetchMenu: () => Promise<void>;
  reset: () => void;
}

export const useMenuStore = create<MenuState>((set) => ({
  menuGroups: [],
  loading: false,
  error: false,
  fetchMenu: async () => {
    set({ loading: true, error: false });
    try {
      const res: any = await menuApi.getMenuTree();
      const groups = res.data ?? res ?? [];
      set({ menuGroups: Array.isArray(groups) ? groups : [], loading: false });
    } catch {
      set({ menuGroups: FALLBACK_MENU, loading: false, error: true });
    }
  },
  reset: () => set({ menuGroups: [], loading: false, error: false }),
}));
