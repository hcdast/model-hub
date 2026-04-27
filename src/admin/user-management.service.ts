import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { AdminUser, AdminUserDocument } from '../database/schemas/admin-user.schema';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { RoleManagementService } from './role-management.service';
import { PermissionCacheService } from './permission-cache.service';
import { 
  validatePasswordComplexity, 
  hashPassword, 
  verifyPassword, 
  generateTemporaryPassword 
} from './utils/password.util';
import { UserNotFoundException, InvalidPasswordException } from '../common/exceptions/rbac.exceptions';

export interface UserFilters {
  username?: string;
  enabled?: boolean;
  roles?: string[];
  includeDeleted?: boolean;
}

export interface Pagination {
  page: number;
  limit: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

@Injectable()
export class UserManagementService {
  constructor(
    @InjectModel(AdminUser.name)
    private readonly adminUserModel: Model<AdminUserDocument>,
    private readonly roleManagementService: RoleManagementService,
    private readonly permissionCacheService: PermissionCacheService,
  ) {}

  /**
   * 创建用户
   */
  async createUser(data: CreateUserDto): Promise<AdminUser> {
    // 验证用户名唯一性
    const existing = await this.adminUserModel.findOne({ 
      username: data.username,
      deletedAt: null, // 只检查未删除的用户
    });
    
    if (existing) {
      throw new BadRequestException(`User with username "${data.username}" already exists`);
    }

    // 验证角色是否存在
    const invalidRoles = await this.roleManagementService.getInvalidRoles(data.roles);
    if (invalidRoles.length > 0) {
      throw new BadRequestException(
        `Invalid roles: ${invalidRoles.join(', ')}`
      );
    }

    // 验证密码复杂度
    const complexityResult = validatePasswordComplexity(data.password);
    if (!complexityResult.isValid) {
      throw new BadRequestException(complexityResult.errors.join('; '));
    }

    // 加密密码
    const passwordHash = await hashPassword(data.password);

    const user = new this.adminUserModel({
      username: data.username,
      passwordHash,
      roles: data.roles,
      email: data.email,
      displayName: data.displayName,
      enabled: data.enabled !== undefined ? data.enabled : true,
      requirePasswordChange: false,
      deletedAt: null,
    });

    return user.save();
  }

  /**
   * 更新用户
   */
  async updateUser(userId: string, data: UpdateUserDto): Promise<AdminUser> {
    const user = await this.adminUserModel.findOne({ 
      _id: userId,
      deletedAt: null,
    });
    
    if (!user) {
      throw new UserNotFoundException(userId);
    }

    // 检查角色是否有变更
    let rolesChanged = false;

    // 如果更新角色，验证角色是否存在
    if (data.roles && data.roles.length > 0) {
      const invalidRoles = await this.roleManagementService.getInvalidRoles(data.roles);
      if (invalidRoles.length > 0) {
        throw new BadRequestException(
          `Invalid roles: ${invalidRoles.join(', ')}`
        );
      }
      
      // 检查角色是否真的变更了
      rolesChanged = JSON.stringify(user.roles.sort()) !== JSON.stringify(data.roles.sort());
      user.roles = data.roles;
    }

    // 更新其他字段
    if (data.email !== undefined) {
      user.email = data.email;
    }
    if (data.displayName !== undefined) {
      user.displayName = data.displayName;
    }
    if (data.enabled !== undefined) {
      user.enabled = data.enabled;
    }

    const updatedUser = await user.save();

    // 如果角色有变更，清除用户的权限缓存
    if (rolesChanged) {
      await this.permissionCacheService.clearUserPermissions(userId);
    }

    return updatedUser;
  }

  /**
   * 启用/禁用用户
   */
  async toggleUserStatus(userId: string, enabled: boolean): Promise<void> {
    const user = await this.adminUserModel.findOne({ 
      _id: userId,
      deletedAt: null,
    });
    
    if (!user) {
      throw new UserNotFoundException(userId);
    }

    user.enabled = enabled;
    await user.save();
  }

  /**
   * 软删除用户
   */
  async deleteUser(userId: string): Promise<void> {
    const user = await this.adminUserModel.findOne({ 
      _id: userId,
      deletedAt: null,
    });
    
    if (!user) {
      throw new UserNotFoundException(userId);
    }

    // 软删除：设置 deletedAt 时间戳
    user.deletedAt = new Date();
    await user.save();
  }

  /**
   * 查询用户列表（分页）
   */
  async listUsers(
    filters: UserFilters = {},
    pagination: Pagination = { page: 1, limit: 10 },
  ): Promise<PaginatedResult<AdminUser>> {
    const query: any = {};

    // 默认不包含已删除的用户
    if (!filters.includeDeleted) {
      query.deletedAt = null;
    }

    if (filters.username) {
      query.username = { $regex: filters.username, $options: 'i' };
    }

    if (filters.enabled !== undefined) {
      query.enabled = filters.enabled;
    }

    if (filters.roles && filters.roles.length > 0) {
      query.roles = { $in: filters.roles };
    }

    const skip = (pagination.page - 1) * pagination.limit;
    
    const [data, total] = await Promise.all([
      this.adminUserModel
        .find(query)
        .skip(skip)
        .limit(pagination.limit)
        .sort({ createdAt: -1 })
        .exec(),
      this.adminUserModel.countDocuments(query),
    ]);

    return {
      data,
      total,
      page: pagination.page,
      limit: pagination.limit,
      totalPages: Math.ceil(total / pagination.limit),
    };
  }

  /**
   * 获取用户详情
   */
  async getUserById(userId: string): Promise<AdminUser> {
    const user = await this.adminUserModel.findOne({ 
      _id: userId,
      deletedAt: null,
    });
    
    if (!user) {
      throw new UserNotFoundException(userId);
    }

    return user;
  }

  /**
   * 根据用户名获取用户
   */
  async getUserByUsername(username: string): Promise<AdminUser | null> {
    return this.adminUserModel.findOne({ 
      username,
      deletedAt: null,
    });
  }

  /**
   * 为用户分配角色
   */
  async assignRoles(userId: string, roleNames: string[]): Promise<void> {
    const user = await this.adminUserModel.findOne({ 
      _id: userId,
      deletedAt: null,
    });
    
    if (!user) {
      throw new UserNotFoundException(userId);
    }

    // 验证至少有一个角色
    if (!roleNames || roleNames.length === 0) {
      throw new BadRequestException('User must have at least one role');
    }

    // 验证角色是否存在
    const invalidRoles = await this.roleManagementService.getInvalidRoles(roleNames);
    if (invalidRoles.length > 0) {
      throw new BadRequestException(
        `Invalid roles: ${invalidRoles.join(', ')}`
      );
    }

    user.roles = roleNames;
    await user.save();

    // 清除用户的权限缓存
    await this.permissionCacheService.clearUserPermissions(userId);
  }

  /**
   * 移除用户角色
   */
  async removeRoles(userId: string, roleNames: string[]): Promise<void> {
    const user = await this.adminUserModel.findOne({ 
      _id: userId,
      deletedAt: null,
    });
    
    if (!user) {
      throw new UserNotFoundException(userId);
    }

    // 过滤掉要移除的角色
    const remainingRoles = user.roles.filter(role => !roleNames.includes(role));

    // 验证至少保留一个角色
    if (remainingRoles.length === 0) {
      throw new BadRequestException('User must have at least one role');
    }

    user.roles = remainingRoles;
    await user.save();

    // 清除用户的权限缓存
    await this.permissionCacheService.clearUserPermissions(userId);
  }

  /**
   * 修改密码（用户自己修改）
   * 需要验证旧密码
   */
  async changePassword(userId: string, data: ChangePasswordDto): Promise<void> {
    const user = await this.adminUserModel.findOne({ 
      _id: userId,
      deletedAt: null,
    });
    
    if (!user) {
      throw new UserNotFoundException(userId);
    }

    // 验证旧密码
    const isOldPasswordValid = await verifyPassword(data.oldPassword, user.passwordHash);
    if (!isOldPasswordValid) {
      throw new InvalidPasswordException('Old password is incorrect');
    }

    // 验证新密码复杂度
    const complexityResult = validatePasswordComplexity(data.newPassword);
    if (!complexityResult.isValid) {
      throw new BadRequestException(complexityResult.errors.join('; '));
    }

    // 加密新密码
    user.passwordHash = await hashPassword(data.newPassword);
    
    // 清除密码修改要求标记
    user.requirePasswordChange = false;
    
    await user.save();
  }

  /**
   * 重置密码（管理员操作）
   * 生成临时密码并要求用户首次登录时修改
   */
  async resetPassword(userId: string): Promise<string> {
    const user = await this.adminUserModel.findOne({ 
      _id: userId,
      deletedAt: null,
    });
    
    if (!user) {
      throw new UserNotFoundException(userId);
    }

    // 生成临时密码
    const temporaryPassword = generateTemporaryPassword();

    // 加密临时密码
    user.passwordHash = await hashPassword(temporaryPassword);
    
    // 设置要求修改密码标记
    user.requirePasswordChange = true;
    
    await user.save();

    // 返回临时密码（仅此一次，不会再次显示）
    return temporaryPassword;
  }
}
