import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AdminUser, AdminUserDocument } from '../database/schemas/admin-user.schema';
import { Role, RoleDocument } from '../database/schemas/role.schema';
import { PermissionCacheService } from './permission-cache.service';
import { UserNotFoundException } from '../common/exceptions/rbac.exceptions';

@Injectable()
export class PermissionCheckService {
  constructor(
    @InjectModel(AdminUser.name)
    private readonly adminUserModel: Model<AdminUserDocument>,
    @InjectModel(Role.name)
    private readonly roleModel: Model<RoleDocument>,
    private readonly permissionCacheService: PermissionCacheService,
  ) {}

  /**
   * 获取用户的所有权限（合并所有角色权限）
   * 实现 super_admin 权限继承逻辑
   * 使用缓存提高性能
   */
  async getUserPermissions(userId: string): Promise<string[]> {
    // 尝试从缓存获取
    const cachedPermissions = await this.permissionCacheService.getUserPermissions(userId);
    if (cachedPermissions !== null) {
      return cachedPermissions;
    }

    // 缓存未命中，从数据库查询
    const permissions = await this.fetchUserPermissionsFromDB(userId);

    // 存入缓存
    await this.permissionCacheService.setUserPermissions(userId, permissions);

    return permissions;
  }

  /**
   * 获取用户的所有授权菜单 key（合并所有角色的 menus）
   * super_admin 角色返回 ['*']（显示所有菜单）
   * 使用缓存提高性能
   */
  async getUserMenus(userId: string): Promise<string[]> {
    // 尝试从缓存获取
    const cachedMenus = await this.permissionCacheService.getUserMenus(userId);
    if (cachedMenus !== null) {
      return cachedMenus;
    }

    // 缓存未命中，从数据库查询
    const menus = await this.fetchUserMenusFromDB(userId);

    // 存入缓存
    await this.permissionCacheService.setUserMenus(userId, menus);

    return menus;
  }

  /**
   * 从数据库获取用户权限（内部方法）
   */
  private async fetchUserPermissionsFromDB(userId: string): Promise<string[]> {
    // 获取用户
    const user = await this.adminUserModel.findOne({
      _id: userId,
      deletedAt: null,
    });

    if (!user) {
      throw new UserNotFoundException(userId);
    }

    // 如果用户被禁用，返回空权限列表
    if (!user.enabled) {
      return [];
    }

    // 检查用户是否拥有 super_admin 角色
    if (user.roles.includes('super_admin')) {
      // super_admin 拥有所有权限，返回特殊标记
      return ['*'];
    }

    // 获取用户所有角色的权限
    const roles = await this.roleModel.find({
      name: { $in: user.roles },
      enabled: true,
    });

    // 合并所有角色的权限（去重）
    const permissionsSet = new Set<string>();
    for (const role of roles) {
      for (const permission of role.permissions) {
        permissionsSet.add(permission);
      }
    }

    return Array.from(permissionsSet);
  }

  /**
   * 从数据库获取用户菜单（内部方法）
   */
  private async fetchUserMenusFromDB(userId: string): Promise<string[]> {
    const user = await this.adminUserModel.findOne({
      _id: userId,
      deletedAt: null,
    });

    if (!user) {
      throw new UserNotFoundException(userId);
    }

    if (!user.enabled) {
      return [];
    }

    // super_admin 拥有所有菜单
    if (user.roles.includes('super_admin')) {
      return ['*'];
    }

    // 获取用户所有角色的菜单
    const roles = await this.roleModel.find({
      name: { $in: user.roles },
      enabled: true,
    });

    // 合并所有角色的菜单（去重）
    const menusSet = new Set<string>();
    for (const role of roles) {
      for (const menu of role.menus || []) {
        menusSet.add(menu);
      }
    }

    return Array.from(menusSet);
  }

  /**
   * 检查用户是否拥有指定权限
   */
  async checkPermission(userId: string, permissionCode: string): Promise<boolean> {
    const userPermissions = await this.getUserPermissions(userId);

    // super_admin 拥有所有权限
    if (userPermissions.includes('*')) {
      return true;
    }

    return userPermissions.includes(permissionCode);
  }

  /**
   * 检查用户是否拥有任一权限（OR逻辑）
   */
  async checkAnyPermission(userId: string, permissionCodes: string[]): Promise<boolean> {
    const userPermissions = await this.getUserPermissions(userId);

    // super_admin 拥有所有权限
    if (userPermissions.includes('*')) {
      return true;
    }

    // 检查是否拥有任一权限
    for (const code of permissionCodes) {
      if (userPermissions.includes(code)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 检查用户是否拥有所有权限（AND逻辑）
   */
  async checkAllPermissions(userId: string, permissionCodes: string[]): Promise<boolean> {
    const userPermissions = await this.getUserPermissions(userId);

    // super_admin 拥有所有权限
    if (userPermissions.includes('*')) {
      return true;
    }

    // 检查是否拥有所有权限
    for (const code of permissionCodes) {
      if (!userPermissions.includes(code)) {
        return false;
      }
    }

    return true;
  }
}
