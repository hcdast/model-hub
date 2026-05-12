import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { FeatureRegistryService } from '../common/services/feature-registry.service';
import { PermissionService } from './permission.service';
import { PermissionCheckService } from './permission-check.service';
import { PermissionCacheService } from './permission-cache.service';
import { RoleManagementService } from './role-management.service';
import { UserManagementService } from './user-management.service';
import { RbacInitializationService } from './rbac-initialization.service';
import { AuditLogService } from './audit-log.service';
import { PermissionGuard } from './guards/permission.guard';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { AdminAuthService } from './admin-auth.service';
import { UserManagementController } from './user-management.controller';
import { RoleManagementController } from './role-management.controller';
import { PermissionManagementController } from './permission-management.controller';
import { AuditInterceptor } from './interceptors/audit.interceptor';
import { PermissionSyncPlugin } from './plugins/permission-sync.plugin';
import { AuditAnchorPlugin } from './plugins/audit-anchor.plugin';
import { MenuSyncPlugin } from './plugins/menu-sync.plugin';
import { MenuRegistryService } from './services/menu-registry.service';
import { MenuManagementService } from './menu-management.service';
import { MenuManagementController } from './menu-management.controller';

/**
 * RBAC模块
 * 封装所有基于角色的访问控制相关服务、控制器和守卫。
 * 导出 PermissionCheckService、PermissionGuard 等供其他模块使用。
 */
@Module({
  imports: [
    DatabaseModule,
    // RedisModule is @Global(), no need to import explicitly
  ],
  controllers: [
    UserManagementController,
    RoleManagementController,
    PermissionManagementController,
    MenuManagementController,
  ],
  providers: [
    PermissionService,
    PermissionCheckService,
    PermissionCacheService,
    RoleManagementService,
    UserManagementService,
    RbacInitializationService,
    AuditLogService,
    PermissionGuard,
    AdminJwtGuard,
    AdminAuthService,
    AuditInterceptor,
    PermissionSyncPlugin,
    AuditAnchorPlugin,
    MenuSyncPlugin,
    MenuRegistryService,
    MenuManagementService,
    {
      provide: 'PERMISSION_SYNC_PLUGIN_INIT',
      useFactory: (
        registry: FeatureRegistryService,
        plugin: PermissionSyncPlugin,
      ) => {
        registry.registerPlugin(plugin);
        return true;
      },
      inject: [FeatureRegistryService, PermissionSyncPlugin],
    },
    {
      provide: 'AUDIT_ANCHOR_PLUGIN_INIT',
      useFactory: (
        registry: FeatureRegistryService,
        plugin: AuditAnchorPlugin,
      ) => {
        registry.registerPlugin(plugin);
        return true;
      },
      inject: [FeatureRegistryService, AuditAnchorPlugin],
    },
    {
      provide: 'MENU_SYNC_PLUGIN_INIT',
      useFactory: (
        registry: FeatureRegistryService,
        plugin: MenuSyncPlugin,
      ) => {
        registry.registerPlugin(plugin);
        return true;
      },
      inject: [FeatureRegistryService, MenuSyncPlugin],
    },
  ],
  exports: [
    PermissionService,
    PermissionCheckService,
    PermissionCacheService,
    RoleManagementService,
    UserManagementService,
    AuditLogService,
    PermissionGuard,
    AdminJwtGuard,
    AdminAuthService,
    AuditInterceptor,
    PermissionSyncPlugin,
    AuditAnchorPlugin,
    MenuSyncPlugin,
    MenuRegistryService,
    MenuManagementService,
  ],
})
export class RbacModule {}
