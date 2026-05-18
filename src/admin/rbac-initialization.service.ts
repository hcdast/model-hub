import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { Role, RoleDocument } from '../database/schemas/role.schema';
import { AdminUser, AdminUserDocument } from '../database/schemas/admin-user.schema';
import { APP_CONFIG } from '../config/config.module';
import { AppConfig } from '../config/interfaces/config.interface';

@Injectable()
export class RbacInitializationService implements OnModuleInit {
  private readonly logger = new Logger(RbacInitializationService.name);

  constructor(
    @InjectModel(Role.name)
    private readonly roleModel: Model<RoleDocument>,
    @InjectModel(AdminUser.name)
    private readonly adminUserModel: Model<AdminUserDocument>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onModuleInit() {
    this.logger.log('Initializing RBAC system...');
    try {
      // Permission registration is now handled by PermissionSyncPlugin via Feature Registry
      await this.initializeRoles();
      await this.initializeSuperAdmin();
      this.logger.log('RBAC system initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize RBAC system', error);
      // Don't throw - allow the application to start even if initialization fails
    }
  }

  /**
   * 初始化系统预定义角色
   */
  private async initializeRoles(): Promise<void> {
    this.logger.log('Initializing roles...');

    const roles = [
      {
        name: 'super_admin',
        displayName: '超级管理员',
        description: '拥有所有权限的超级管理员',
        permissions: [], // super_admin 通过代码逻辑拥有所有权限
        menus: ['*'], // super_admin 通过通配符显示所有菜单
        isSystem: true,
      },
      {
        name: 'admin',
        displayName: '管理员',
        description: '除用户和角色管理外的所有权限',
        permissions: [
          'model:read', 'model:create', 'model:update', 'model:delete',
          'task:read', 'task:create', 'task:update', 'task:delete',
          'api-client:read', 'api-client:create', 'api-client:update', 'api-client:delete',
          'audit:read',
          'stats:read',
          'queue:read',
          'provider:read', 'provider:create', 'provider:update', 'provider:delete',
          'permission:read',
          'link-conversion:read', 'link-conversion:update',
          'notification:read', 'notification:create', 'notification:update', 'notification:delete',
          'callback-log:read',
          'system:read',
          'billing:read', 'billing:write',
          'menu:read',
        ],
        menus: [
          '/', '/tasks', '/queues', '/api-clients', '/models', '/model-routing-rules',
          '/link-conversion-config',
          '/provider-configs', '/account-pool', '/provider-health',
          '/billing/records', '/billing/wallets', '/account-costs',
          '/notification-rules', '/notification-records', '/notifications',
          '/callback-logs', '/system-info', '/stats',
          '/audit-logs',
          '/permissions', '/menus',
        ],
        isSystem: true,
      },
      {
        name: 'operator',
        displayName: '操作员',
        description: '模型配置和任务记录的读写权限',
        permissions: [
          'model:read', 'model:create', 'model:update',
          'task:read', 'task:create', 'task:update',
          'stats:read',
          'queue:read',
          'link-conversion:read', 'link-conversion:update',
          'notification:read',
          'billing:read',
          'callback-log:read',
          'system:read',
        ],
        menus: [
          '/', '/tasks', '/queues', '/models', '/model-routing-rules',
          '/link-conversion-config',
          '/notification-rules', '/notification-records', '/notifications',
          '/callback-logs', '/system-info', '/stats',
          '/billing/records',
        ],
        isSystem: true,
      },
      {
        name: 'viewer',
        displayName: '查看者',
        description: '所有资源的只读权限',
        permissions: [
          'user:read',
          'role:read',
          'permission:read',
          'model:read',
          'task:read',
          'api-client:read',
          'audit:read',
          'stats:read',
          'queue:read',
          'provider:read',
          'link-conversion:read',
          'notification:read',
          'billing:read',
          'callback-log:read',
          'system:read',
        ],
        menus: [
          '/', '/tasks', '/queues', '/api-clients', '/models', '/model-routing-rules',
          '/link-conversion-config',
          '/provider-configs', '/account-pool', '/provider-health',
          '/billing/records', '/billing/wallets', '/account-costs',
          '/notification-rules', '/notification-records', '/notifications',
          '/callback-logs', '/system-info', '/stats',
          '/audit-logs',
          '/permissions', '/users', '/roles',
        ],
        isSystem: true,
      },
    ];

    for (const roleData of roles) {
      const existing = await this.roleModel.findOne({ name: roleData.name });
      if (existing) {
        // Update permissions and menus if role exists
        existing.permissions = roleData.permissions;
        existing.displayName = roleData.displayName;
        existing.description = roleData.description;
        existing.menus = roleData.menus;
        await existing.save();
        this.logger.log(`Updated role: ${roleData.name}`);
      } else {
        // Create new role
        const role = new this.roleModel(roleData);
        await role.save();
        this.logger.log(`Created role: ${roleData.name}`);
      }
    }

    this.logger.log(`Initialized ${roles.length} roles`);
  }

  /**
   * 初始化默认超级管理员账户
   * 使用 config 中的 admin.defaultUsername / admin.defaultPassword
   */
  private async initializeSuperAdmin(): Promise<void> {
    this.logger.log('Initializing super admin account...');

    const superAdminUsername = this.config.admin.defaultUsername;
    const defaultPassword = this.config.admin.defaultPassword;
    const existing = await this.adminUserModel.findOne({ username: superAdminUsername });

    if (existing) {
      // 确保已有的默认管理员拥有 super_admin 角色
      if (!existing.roles.includes('super_admin')) {
        existing.roles = [...new Set([...existing.roles, 'super_admin'])];
        await existing.save();
        this.logger.log(`Ensured super_admin role for existing user: ${superAdminUsername}`);
      } else {
        this.logger.log('Super admin account already exists');
      }
      return;
    }

    const passwordHash = await bcrypt.hash(defaultPassword, 10);

    const superAdmin = new this.adminUserModel({
      username: superAdminUsername,
      passwordHash,
      roles: ['super_admin'],
      enabled: true,
      displayName: 'Super Administrator',
      requirePasswordChange: false,
    });

    await superAdmin.save();
    this.logger.log(`Created super admin account: ${superAdminUsername}`);
    this.logger.warn(`Default password from config - PLEASE CHANGE IT IMMEDIATELY!`);
  }
}
