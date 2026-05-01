import { Injectable, Logger } from '@nestjs/common';
import { FeatureMenuDef } from '../../common/interfaces/feature-module.interface';

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

/** Default menu group definitions */
const DEFAULT_GROUPS: Omit<MenuGroup, 'children'>[] = [
  { key: 'overview', label: '系统总览', icon: 'DashboardOutlined', sortOrder: 0 },
  { key: 'business', label: '业务管理', icon: 'AppstoreOutlined', sortOrder: 100 },
  { key: 'billing', label: '计费管理', icon: 'WalletOutlined', sortOrder: 150 },
  { key: 'provider', label: '厂商管理', icon: 'CloudServerOutlined', sortOrder: 200 },
  { key: 'notification', label: '通知管理', icon: 'BellOutlined', sortOrder: 300 },
  { key: 'system', label: '系统配置', icon: 'SettingOutlined', sortOrder: 400 },
  { key: 'security', label: '审计与安全', icon: 'SafetyOutlined', sortOrder: 500 },
];

@Injectable()
export class MenuRegistryService {
  private readonly logger = new Logger(MenuRegistryService.name);
  private readonly menuGroups = new Map<string, MenuGroup>();

  constructor() {
    this.initDefaultGroups();
  }

  /** Initialize the 6 default menu groups */
  initDefaultGroups(): void {
    this.menuGroups.clear();
    for (const group of DEFAULT_GROUPS) {
      this.menuGroups.set(group.key, { ...group, children: [] });
    }
  }

  /**
   * Register a menu item into the corresponding group.
   * If parentKey doesn't match any group, the item is treated as a top-level group.
   */
  registerMenuItem(item: FeatureMenuDef): void {
    const menuItem: MenuItem = {
      key: item.path,
      path: item.path,
      label: item.label,
      icon: item.icon,
      sortOrder: item.sortOrder,
      parentKey: item.parentKey,
      requiredPermission: item.requiredPermission,
    };

    if (item.parentKey && this.menuGroups.has(item.parentKey)) {
      this.menuGroups.get(item.parentKey)!.children.push(menuItem);
    } else {
      if (item.parentKey) {
        this.logger.warn(
          `Menu item "${item.label}" references unknown parentKey "${item.parentKey}", treating as top-level`,
        );
      }
      // Create a standalone group for orphan items
      this.menuGroups.set(menuItem.key!, {
        key: menuItem.key!,
        label: menuItem.label,
        icon: menuItem.icon,
        sortOrder: menuItem.sortOrder,
        children: [],
      });
    }
  }

  /** Get the full menu tree, sorted by sortOrder */
  getMenuTree(): MenuGroup[] {
    return this.sortMenuTree(
      Array.from(this.menuGroups.values()).map((g) => ({
        ...g,
        children: [...g.children],
      })),
    );
  }

  /**
   * Get menu tree filtered by user permissions.
   * Items without requiredPermission are always visible.
   * Parent groups with no visible children are removed.
   * Wildcard '*' grants access to everything.
   */
  getFilteredMenuTree(userPermissions: string[]): MenuGroup[] {
    const permSet = new Set(userPermissions);
    const hasWildcard = permSet.has('*');

    const filtered: MenuGroup[] = [];

    for (const group of this.menuGroups.values()) {
      const visibleChildren = group.children.filter((child) => {
        if (!child.requiredPermission) return true;
        if (hasWildcard) return true;
        return permSet.has(child.requiredPermission);
      });

      if (visibleChildren.length > 0 || group.children.length === 0) {
        // Keep groups that have visible children, or groups with no children at all (like overview)
        filtered.push({ ...group, children: [...visibleChildren] });
      }
    }

    return this.sortMenuTree(filtered);
  }

  /** Sort groups by sortOrder, and children within each group by sortOrder */
  sortMenuTree(tree: MenuGroup[]): MenuGroup[] {
    const sorted = [...tree].sort((a, b) => a.sortOrder - b.sortOrder);
    for (const group of sorted) {
      group.children.sort((a, b) => a.sortOrder - b.sortOrder);
    }
    return sorted;
  }
}
