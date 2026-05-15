import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SyncPlugin } from '../../common/interfaces/sync-plugin.interface';
import { FeatureModuleDescriptor } from '../../common/interfaces/feature-module.interface';
import {
  Permission,
  PermissionDocument,
} from '../../database/schemas/permission.schema';
import { Role, RoleDocument } from '../../database/schemas/role.schema';

/** Default CRUD actions generated for modules without explicit permissions */
const DEFAULT_CRUD_ACTIONS = ['read', 'create', 'update', 'delete'];
const DEFAULT_CRUD_DISPLAY: Record<string, string> = {
  read: '查看',
  create: '创建',
  update: '更新',
  delete: '删除',
};

@Injectable()
export class PermissionSyncPlugin implements SyncPlugin {
  readonly name = 'permission-sync';
  readonly order = 10;

  private readonly logger = new Logger(PermissionSyncPlugin.name);

  constructor(
    @InjectModel(Permission.name)
    private readonly permissionModel: Model<PermissionDocument>,
    @InjectModel(Role.name)
    private readonly roleModel: Model<RoleDocument>,
  ) {}

  /**
   * 系统启动时同步权限
   * 1. 收集所有描述符的权限定义（含自动 CRUD 生成）
   * 2. 与数据库已有权限比对
   * 3. 注册新权限
   * 4. 标记已移除的权限为 deprecated
   * 5. 更新 super_admin 角色
   */
  async onSystemStartup(
    descriptors: FeatureModuleDescriptor[],
  ): Promise<void> {
    this.logger.log('Starting permission sync...');

    // Step 1: Collect all desired permissions from descriptors
    const desiredPermissions = this.collectPermissions(descriptors);
    const desiredCodes = new Set(desiredPermissions.map((p) => p.code));

    // Step 2: Get existing permissions from database
    const existingPermissions = await this.permissionModel.find().lean();
    const existingCodes = new Set(existingPermissions.map((p) => p.code));

    // Step 3: Register new permissions
    const newPerms = desiredPermissions.filter(
      (p) => !existingCodes.has(p.code),
    );
    let registeredCount = 0;
    for (const perm of newPerms) {
      try {
        await this.permissionModel.create(perm);
        registeredCount++;
      } catch (error) {
        // Duplicate key race condition — skip
        if (
          error instanceof Error &&
          error.message.includes('duplicate key')
        ) {
          continue;
        }
        throw error;
      }
    }

    // Step 4: Mark deprecated permissions
    const deprecatedCodes = existingPermissions
      .filter((p) => !p.deprecated && !desiredCodes.has(p.code))
      .map((p) => p.code);

    let deprecatedCount = 0;
    if (deprecatedCodes.length > 0) {
      const result = await this.permissionModel.updateMany(
        { code: { $in: deprecatedCodes } },
        { $set: { deprecated: true } },
      );
      deprecatedCount = result.modifiedCount;
    }

    // Un-deprecate permissions that are back in descriptors
    const reactivatedCodes = existingPermissions
      .filter((p) => p.deprecated && desiredCodes.has(p.code))
      .map((p) => p.code);
    if (reactivatedCodes.length > 0) {
      await this.permissionModel.updateMany(
        { code: { $in: reactivatedCodes } },
        { $set: { deprecated: false } },
      );
    }

    // Step 5: Update super_admin role with all non-deprecated permission codes
    await this.updateSuperAdminRole(desiredCodes);

    const skippedCount = desiredPermissions.length - registeredCount;
    this.logger.log(
      `Permission sync complete: ${registeredCount} registered, ${skippedCount} skipped, ${deprecatedCount} deprecated`,
    );
  }

  /**
   * 从描述符中收集所有权限定义
   * 对无显式权限定义的模块自动生成标准 CRUD 权限
   */
  collectPermissions(
    descriptors: FeatureModuleDescriptor[],
  ): Array<{
    code: string;
    resource: string;
    action: string;
    displayName: string;
    module: string;
  }> {
    const result: Array<{
      code: string;
      resource: string;
      action: string;
      displayName: string;
      module: string;
    }> = [];

    for (const desc of descriptors) {
      if (desc.permissions && desc.permissions.length > 0) {
        // Explicit permissions
        for (const permDef of desc.permissions) {
          for (const action of permDef.actions) {
            result.push({
              code: `${permDef.resource}:${action}`,
              resource: permDef.resource,
              action,
              displayName:
                permDef.displayNames[action] ||
                `${action} ${permDef.resource}`,
              module: permDef.module,
            });
          }
        }
      } else {
        // Auto CRUD generation
        for (const action of DEFAULT_CRUD_ACTIONS) {
          result.push({
            code: `${desc.moduleKey}:${action}`,
            resource: desc.moduleKey,
            action,
            displayName: `${DEFAULT_CRUD_DISPLAY[action]}${desc.displayName}`,
            module: `${desc.moduleKey}-management`,
          });
        }
      }
    }

    return result;
  }

  /**
   * 更新 super_admin 角色，确保拥有所有当前有效权限
   */
  private async updateSuperAdminRole(
    desiredCodes: Set<string>,
  ): Promise<void> {
    const allCodes = Array.from(desiredCodes);
    await this.roleModel.updateOne(
      { name: 'super_admin' },
      { $set: { permissions: allCodes } },
    );
    this.logger.log(
      `Updated super_admin role with ${allCodes.length} permissions`,
    );
  }
}
