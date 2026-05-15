import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { FeatureMenuDef } from '../../common/interfaces/feature-module.interface';
import { MenuConfig, MenuConfigDocument } from '../../database/schemas/menu-config.schema';

export interface MenuItem {
  key: string;
  path?: string;
  label: string;
  icon: string;
  sortOrder: number;
  parentKey?: string;
  requiredPermission?: string;
  associatedPermissions?: string[];
  enabled?: boolean;
  moduleKey?: string;
  children?: MenuItem[];
}

export interface MenuGroup {
  key: string;
  label: string;
  icon: string;
  sortOrder: number;
  children: MenuItem[];
}

/** Default menu group definitions（与功能描述符 parentKey 对齐） */
const DEFAULT_GROUPS: Omit<MenuGroup, 'children'>[] = [
  { key: 'overview', label: '仪表盘', icon: 'DashboardOutlined', sortOrder: 0 },
  { key: 'business', label: '业务接入', icon: 'AppstoreOutlined', sortOrder: 100 },
  { key: 'model-routing', label: '模型路由', icon: 'BranchesOutlined', sortOrder: 110 },
  { key: 'provider', label: '供应商管理', icon: 'CloudServerOutlined', sortOrder: 120 },
  { key: 'billing', label: '计费与成本', icon: 'WalletOutlined', sortOrder: 130 },
  { key: 'notification', label: '通知中心', icon: 'BellOutlined', sortOrder: 140 },
  { key: 'system', label: '系统设置', icon: 'SettingOutlined', sortOrder: 150 },
  { key: 'access', label: '访问控制', icon: 'TeamOutlined', sortOrder: 450 },
  { key: 'audit', label: '审计与日志', icon: 'SafetyOutlined', sortOrder: 500 },
];

const DEFAULT_GROUP_KEYS = new Set(DEFAULT_GROUPS.map((g) => g.key));

@Injectable()
export class MenuRegistryService {
  private readonly logger = new Logger(MenuRegistryService.name);
  private readonly menuGroups = new Map<string, MenuGroup>();

  constructor(
    @InjectModel(MenuConfig.name)
    private readonly menuConfigModel: Model<MenuConfigDocument>,
  ) {
    this.initDefaultGroups();
  }

  /** Initialize the default menu groups (see DEFAULT_GROUPS) */
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
      children: [],
    };

    if (item.parentKey && this.menuGroups.has(item.parentKey)) {
      this.menuGroups.get(item.parentKey)!.children.push(menuItem);
    } else {
      if (item.parentKey) {
        this.logger.warn(
          `Menu item "${item.label}" references unknown parentKey "${item.parentKey}", treating as top-level`,
        );
      }
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
      const visibleChildren = this.filterItemsByPermission(group.children, permSet, hasWildcard);

      if (visibleChildren.length > 0 || group.children.length === 0) {
        filtered.push({ ...group, children: visibleChildren });
      }
    }

    return this.sortMenuTree(filtered);
  }

  /**
   * Get menu tree filtered by user's authorized menu keys.
   * Items whose key is in the user's menu set are visible.
   * Parent groups with no visible children are removed.
   * Wildcard '*' grants access to everything.
   */
  getFilteredMenuTreeByKeys(userMenuKeys: string[]): MenuGroup[] {
    const keySet = new Set(userMenuKeys);
    const hasWildcard = keySet.has('*');

    const filtered: MenuGroup[] = [];

    for (const group of this.menuGroups.values()) {
      const groupVisible = hasWildcard || keySet.has(group.key);
      const visibleChildren = this.filterItemsByKeys(group.children, keySet, hasWildcard);

      if (!groupVisible) {
        if (visibleChildren.length > 0) {
          filtered.push({ ...group, children: visibleChildren });
        }
        continue;
      }

      if (group.children.length === 0) {
        filtered.push({ ...group, children: [] });
      } else {
        filtered.push({ ...group, children: visibleChildren });
      }
    }

    return this.sortMenuTree(filtered);
  }

  /** Sort groups by sortOrder, and children within each group by sortOrder (recursive) */
  sortMenuTree(tree: MenuGroup[]): MenuGroup[] {
    const sorted = [...tree].sort((a, b) => a.sortOrder - b.sortOrder);
    for (const group of sorted) {
      this.sortMenuItems(group.children);
    }
    return sorted;
  }

  private sortMenuItems(items: MenuItem[]): void {
    items.sort((a, b) => a.sortOrder - b.sortOrder);
    for (const it of items) {
      if (it.children?.length) {
        this.sortMenuItems(it.children);
      }
    }
  }

  private filterItemsByPermission(
    items: MenuItem[],
    permSet: Set<string>,
    hasWildcard: boolean,
  ): MenuItem[] {
    const out: MenuItem[] = [];
    for (const item of items) {
      const selfOk =
        !item.requiredPermission || hasWildcard || permSet.has(item.requiredPermission);
      const sub = item.children?.length
        ? this.filterItemsByPermission(item.children, permSet, hasWildcard)
        : [];
      if (selfOk || sub.length > 0) {
        out.push({
          ...item,
          children: sub.length > 0 ? sub : undefined,
        });
      }
    }
    return out;
  }

  private filterItemsByKeys(
    items: MenuItem[],
    keySet: Set<string>,
    hasWildcard: boolean,
  ): MenuItem[] {
    const out: MenuItem[] = [];
    for (const item of items) {
      const selfVisible = hasWildcard || keySet.has(item.key);
      const sub = item.children?.length
        ? this.filterItemsByKeys(item.children, keySet, hasWildcard)
        : [];
      if (selfVisible || sub.length > 0) {
        out.push({
          ...item,
          children: sub.length > 0 ? sub : undefined,
        });
      }
    }
    return out;
  }

  /**
   * Reload menu tree from database.
   * Called after CRUD operations on menu_configs collection.
   * 支持：挂在分组下的一级菜单、以及以其它菜单项为父级的多级子菜单。
   */
  async reloadFromDb(): Promise<void> {
    this.logger.log('从数据库重新加载菜单配置...');
    this.menuGroups.clear();
    this.initDefaultGroups();

    const menus = await this.menuConfigModel
      .find({ enabled: true })
      .sort({ sortOrder: 1 })
      .lean()
      .exec();

    const menuItemByKey = new Map<string, MenuItem>();

    for (const menu of menus) {
      const menuItem: MenuItem = {
        key: menu.key,
        path: menu.path,
        label: menu.label,
        icon: menu.icon,
        sortOrder: menu.sortOrder,
        parentKey: menu.parentKey,
        requiredPermission: menu.requiredPermission,
        associatedPermissions: menu.associatedPermissions,
        enabled: menu.enabled,
        moduleKey: menu.moduleKey,
        children: [],
      };
      menuItemByKey.set(menu.key, menuItem);
    }

    const pendingUnderMenuParent: MenuItem[] = [];

    for (const menu of menus) {
      const menuItem = menuItemByKey.get(menu.key)!;

      if (!menu.parentKey) {
        if (this.menuGroups.has(menu.key)) {
          const group = this.menuGroups.get(menu.key)!;
          group.label = menu.label;
          group.icon = menu.icon;
          group.sortOrder = menu.sortOrder;
        } else {
          this.menuGroups.set(menu.key, {
            key: menu.key,
            label: menu.label,
            icon: menu.icon,
            sortOrder: menu.sortOrder,
            children: [],
          });
        }
        continue;
      }

      if (menu.parentKey && DEFAULT_GROUP_KEYS.has(menu.parentKey)) {
        this.menuGroups.get(menu.parentKey)!.children.push(menuItem);
        continue;
      }

      if (menu.parentKey && menuItemByKey.has(menu.parentKey)) {
        pendingUnderMenuParent.push(menuItem);
        continue;
      }

      this.logger.warn(
        `菜单 "${menu.label}" (${menu.key}) 的父级 "${menu.parentKey}" 不存在，已跳过注册`,
      );
    }

    for (const child of pendingUnderMenuParent) {
      const parentKey = child.parentKey!;
      const parent = menuItemByKey.get(parentKey);
      if (!parent) continue;
      if (!parent.children) parent.children = [];
      parent.children.push(child);
    }

    for (const group of this.menuGroups.values()) {
      this.sortMenuItems(group.children);
    }

    this.logger.log(`菜单重新加载完成：${menus.length} 个菜单项`);
  }
}
