import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Role, RoleDocument } from '../database/schemas/role.schema';
import { AdminUser, AdminUserDocument } from '../database/schemas/admin-user.schema';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { PermissionService } from './permission.service';
import { PermissionCacheService } from './permission-cache.service';
import { RoleNotFoundException, RoleInUseException } from '../common/exceptions/rbac.exceptions';

@Injectable()
export class RoleManagementService {
  constructor(
    @InjectModel(Role.name)
    private readonly roleModel: Model<RoleDocument>,
    @InjectModel(AdminUser.name)
    private readonly adminUserModel: Model<AdminUserDocument>,
    private readonly permissionService: PermissionService,
    private readonly permissionCacheService: PermissionCacheService,
  ) {}

  /**
   * 创建角色
   */
  async createRole(data: CreateRoleDto): Promise<Role> {
    // 验证角色名称唯一性
    const existing = await this.roleModel.findOne({ name: data.name });
    if (existing) {
      throw new BadRequestException(`Role with name "${data.name}" already exists`);
    }

    // 验证权限是否存在
    if (data.permissions && data.permissions.length > 0) {
      const invalidPermissions = await this.permissionService.getInvalidPermissions(data.permissions);
      if (invalidPermissions.length > 0) {
        throw new BadRequestException(
          `Invalid permissions: ${invalidPermissions.join(', ')}`
        );
      }
    }

    const role = new this.roleModel({
      name: data.name,
      displayName: data.displayName,
      description: data.description,
      permissions: data.permissions || [],
      isSystem: data.isSystem || false,
      enabled: data.enabled !== undefined ? data.enabled : true,
    });

    return role.save();
  }

  /**
   * 更新角色
   */
  async updateRole(roleName: string, data: UpdateRoleDto): Promise<Role> {
    const role = await this.roleModel.findOne({ name: roleName });
    if (!role) {
      throw new RoleNotFoundException(roleName);
    }

    // 验证权限是否存在
    if (data.permissions && data.permissions.length > 0) {
      const invalidPermissions = await this.permissionService.getInvalidPermissions(data.permissions);
      if (invalidPermissions.length > 0) {
        throw new BadRequestException(
          `Invalid permissions: ${invalidPermissions.join(', ')}`
        );
      }
    }

    // 检查权限是否有变更
    const permissionsChanged = data.permissions !== undefined && 
      JSON.stringify(role.permissions.sort()) !== JSON.stringify(data.permissions.sort());

    // 更新字段
    if (data.displayName !== undefined) {
      role.displayName = data.displayName;
    }
    if (data.description !== undefined) {
      role.description = data.description;
    }
    if (data.permissions !== undefined) {
      role.permissions = data.permissions;
    }
    if (data.enabled !== undefined) {
      role.enabled = data.enabled;
    }

    const updatedRole = await role.save();

    // 如果权限有变更，清除相关用户的权限缓存
    if (permissionsChanged) {
      await this.permissionCacheService.clearRolePermissions(roleName);
    }

    return updatedRole;
  }

  /**
   * 删除角色
   */
  async deleteRole(roleName: string): Promise<void> {
    const role = await this.roleModel.findOne({ name: roleName });
    if (!role) {
      throw new RoleNotFoundException(roleName);
    }

    // 检查角色是否被使用
    const isInUse = await this.isRoleInUse(roleName);
    if (isInUse) {
      throw new RoleInUseException(roleName);
    }

    await this.roleModel.deleteOne({ name: roleName });
  }

  /**
   * 查询角色列表
   */
  async listRoles(): Promise<Role[]> {
    return this.roleModel.find().sort({ name: 1 }).exec();
  }

  /**
   * 获取角色详情
   */
  async getRoleByName(roleName: string): Promise<Role> {
    const role = await this.roleModel.findOne({ name: roleName });
    if (!role) {
      throw new RoleNotFoundException(roleName);
    }
    return role;
  }

  /**
   * 为角色分配权限
   */
  async assignPermissions(roleName: string, permissionCodes: string[]): Promise<void> {
    const role = await this.roleModel.findOne({ name: roleName });
    if (!role) {
      throw new RoleNotFoundException(roleName);
    }

    // 验证权限是否存在
    const invalidPermissions = await this.permissionService.getInvalidPermissions(permissionCodes);
    if (invalidPermissions.length > 0) {
      throw new BadRequestException(
        `Invalid permissions: ${invalidPermissions.join(', ')}`
      );
    }

    role.permissions = permissionCodes;
    await role.save();

    // 清除相关用户的权限缓存
    await this.permissionCacheService.clearRolePermissions(roleName);
  }

  /**
   * 检查角色是否被使用
   */
  async isRoleInUse(roleName: string): Promise<boolean> {
    const count = await this.adminUserModel.countDocuments({
      roles: roleName,
      deletedAt: null, // 只检查未删除的用户
    });
    return count > 0;
  }

  /**
   * 验证角色是否存在
   */
  async validateRoleExists(roleName: string): Promise<boolean> {
    const role = await this.roleModel.findOne({ name: roleName });
    return role !== null;
  }

  /**
   * 批量验证角色是否存在（单次查询优化）
   */
  async validateRolesExist(roleNames: string[]): Promise<boolean> {
    if (roleNames.length === 0) return true;
    const count = await this.roleModel.countDocuments({ name: { $in: roleNames } });
    return count === roleNames.length;
  }

  /**
   * 获取不存在的角色名称列表（单次查询优化）
   */
  async getInvalidRoles(roleNames: string[]): Promise<string[]> {
    if (roleNames.length === 0) return [];
    const existing = await this.roleModel
      .find({ name: { $in: roleNames } })
      .select('name')
      .lean();
    const existingSet = new Set(existing.map(r => r.name));
    return roleNames.filter(name => !existingSet.has(name));
  }
}
