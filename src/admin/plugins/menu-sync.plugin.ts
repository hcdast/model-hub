import { Injectable, Logger } from '@nestjs/common';
import { SyncPlugin } from '../../common/interfaces/sync-plugin.interface';
import { FeatureModuleDescriptor } from '../../common/interfaces/feature-module.interface';
import { MenuRegistryService } from '../services/menu-registry.service';
import { MenuManagementService } from '../menu-management.service';

/**
 * 菜单同步插件
 * 负责从功能模块描述符中收集菜单配置，注册到 MenuRegistryService 并持久化到数据库。
 * 执行顺序 order=30，在 PermissionSync(10) 和 AuditAnchor(20) 之后执行。
 */
@Injectable()
export class MenuSyncPlugin implements SyncPlugin {
  readonly name = 'menu-sync';
  readonly order = 30;

  private readonly logger = new Logger(MenuSyncPlugin.name);

  constructor(
    private readonly menuRegistryService: MenuRegistryService,
    private readonly menuManagementService: MenuManagementService,
  ) {}

  /**
   * 系统启动时从描述符同步菜单配置
   * 同时注册到内存（MenuRegistryService）和数据库（MenuConfig collection）
   */
  async onSystemStartup(
    descriptors: FeatureModuleDescriptor[],
  ): Promise<void> {
    this.logger.log('开始从描述符同步菜单配置...');

    let registered = 0;
    for (const desc of descriptors) {
      if (!desc.menus || desc.menus.length === 0) continue;
      for (const menuDef of desc.menus) {
        // Register to in-memory registry
        this.menuRegistryService.registerMenuItem(menuDef);

        // Persist to database
        await this.menuManagementService.upsertFromDescriptor({
          key: menuDef.path,
          label: menuDef.label,
          path: menuDef.path,
          icon: menuDef.icon,
          sortOrder: menuDef.sortOrder,
          parentKey: menuDef.parentKey,
          requiredPermission: menuDef.requiredPermission,
          associatedPermissions: menuDef.associatedPermissions,
          moduleKey: desc.moduleKey,
        });

        registered++;
      }
    }

    this.logger.log(`菜单同步完成：共注册 ${registered} 个菜单项`);
  }
}
