import { Injectable, Inject } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AdminUser, AdminUserDocument } from '../database/schemas/admin-user.schema';

@Injectable()
export class PermissionCacheService {
  private readonly CACHE_PREFIX = 'permission:user:';
  private readonly MENU_CACHE_PREFIX = 'menu:user:';
  private readonly CACHE_TTL = 15 * 60; // 15 minutes in seconds

  constructor(
    @Inject(REDIS_CLIENT)
    private readonly redisClient: Redis,
    @InjectModel(AdminUser.name)
    private readonly adminUserModel: Model<AdminUserDocument>,
  ) {}

  /**
   * 获取用户权限缓存键
   */
  private getUserCacheKey(userId: string): string {
    return `${this.CACHE_PREFIX}${userId}`;
  }

  /**
   * 获取角色相关的所有用户缓存键模式
   */
  private getRoleCachePattern(roleName: string): string {
    return `${this.CACHE_PREFIX}*`;
  }

  /**
   * 获取用户权限（从缓存）
   * 如果缓存不存在，返回 null
   */
  async getUserPermissions(userId: string): Promise<string[] | null> {
    const cacheKey = this.getUserCacheKey(userId);
    const cached = await this.redisClient.get(cacheKey);

    if (!cached) {
      return null;
    }

    try {
      return JSON.parse(cached);
    } catch (error) {
      // 如果解析失败，删除无效缓存
      await this.redisClient.del(cacheKey);
      return null;
    }
  }

  /**
   * 设置用户权限缓存
   */
  async setUserPermissions(userId: string, permissions: string[]): Promise<void> {
    const cacheKey = this.getUserCacheKey(userId);
    await this.redisClient.setex(
      cacheKey,
      this.CACHE_TTL,
      JSON.stringify(permissions),
    );
  }

  /**
   * 清除用户权限缓存
   */
  async clearUserPermissions(userId: string): Promise<void> {
    const cacheKey = this.getUserCacheKey(userId);
    await this.redisClient.del(cacheKey);
  }

  /**
   * 清除角色相关的所有用户权限和菜单缓存
   * 查找所有拥有该角色的用户并清除其缓存
   */
  async clearRolePermissions(roleName: string): Promise<void> {
    // 查找所有拥有该角色的用户
    const users = await this.adminUserModel.find({
      roles: roleName,
      deletedAt: null,
    }).select('_id').exec();

    // 清除这些用户的权限和菜单缓存
    const pipeline = this.redisClient.pipeline();
    for (const user of users) {
      const permCacheKey = this.getUserCacheKey(user._id.toString());
      const menuCacheKey = this.getUserMenuCacheKey(user._id.toString());
      pipeline.del(permCacheKey);
      pipeline.del(menuCacheKey);
    }

    if (users.length > 0) {
      await pipeline.exec();
    }
  }

  /**
   * 清除所有权限缓存
   */
  async clearAllPermissions(): Promise<void> {
    const pattern = `${this.CACHE_PREFIX}*`;

    // 使用 SCAN 命令安全地删除所有匹配的键
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.redisClient.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100,
      );
      cursor = nextCursor;

      if (keys.length > 0) {
        await this.redisClient.del(...keys);
      }
    } while (cursor !== '0');
  }

  /**
   * 获取用户菜单缓存键
   */
  private getUserMenuCacheKey(userId: string): string {
    return `${this.MENU_CACHE_PREFIX}${userId}`;
  }

  /**
   * 获取用户菜单（从缓存）
   */
  async getUserMenus(userId: string): Promise<string[] | null> {
    const cacheKey = this.getUserMenuCacheKey(userId);
    const cached = await this.redisClient.get(cacheKey);

    if (!cached) {
      return null;
    }

    try {
      return JSON.parse(cached);
    } catch {
      await this.redisClient.del(cacheKey);
      return null;
    }
  }

  /**
   * 设置用户菜单缓存
   */
  async setUserMenus(userId: string, menus: string[]): Promise<void> {
    const cacheKey = this.getUserMenuCacheKey(userId);
    await this.redisClient.setex(
      cacheKey,
      this.CACHE_TTL,
      JSON.stringify(menus),
    );
  }

  /**
   * 清除角色相关的所有用户菜单缓存
   */
  async clearRoleMenus(roleName: string): Promise<void> {
    const users = await this.adminUserModel.find({
      roles: roleName,
      deletedAt: null,
    }).select('_id').exec();

    const pipeline = this.redisClient.pipeline();
    for (const user of users) {
      const cacheKey = this.getUserMenuCacheKey(user._id.toString());
      pipeline.del(cacheKey);
    }

    if (users.length > 0) {
      await pipeline.exec();
    }
  }

  /**
   * 清除所有菜单缓存
   */
  async clearAllMenus(): Promise<void> {
    const pattern = `${this.MENU_CACHE_PREFIX}*`;

    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.redisClient.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100,
      );
      cursor = nextCursor;

      if (keys.length > 0) {
        await this.redisClient.del(...keys);
      }
    } while (cursor !== '0');
  }
}
