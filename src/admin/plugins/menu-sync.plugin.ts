import { Injectable, Logger } from '@nestjs/common';
import { SyncPlugin } from '../../common/interfaces/sync-plugin.interface';
import { FeatureModuleDescriptor } from '../../common/interfaces/feature-module.interface';
import { MenuRegistryService } from '../services/menu-registry.service';

@Injectable()
export class MenuSyncPlugin implements SyncPlugin {
  readonly name = 'menu-sync';
  readonly order = 30;

  private readonly logger = new Logger(MenuSyncPlugin.name);

  constructor(private readonly menuRegistryService: MenuRegistryService) {}

  async onSystemStartup(
    descriptors: FeatureModuleDescriptor[],
  ): Promise<void> {
    this.logger.log('Starting menu sync from descriptors...');

    let registered = 0;
    for (const desc of descriptors) {
      if (!desc.menus || desc.menus.length === 0) continue;
      for (const menuDef of desc.menus) {
        this.menuRegistryService.registerMenuItem(menuDef);
        registered++;
      }
    }

    this.logger.log(`Menu sync complete: ${registered} menu items registered`);
  }
}
