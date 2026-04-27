import {
  Injectable,
  Logger,
  OnModuleInit,
  ConflictException,
} from '@nestjs/common';
import { FeatureModuleDescriptor } from '../interfaces/feature-module.interface';
import { SyncPlugin } from '../interfaces/sync-plugin.interface';
import { isValidKebabCase } from '../utils/kebab-case.util';

@Injectable()
export class FeatureRegistryService implements OnModuleInit {
  private readonly logger = new Logger(FeatureRegistryService.name);
  private readonly descriptors = new Map<string, FeatureModuleDescriptor>();
  private readonly plugins: SyncPlugin[] = [];

  /**
   * 注册功能模块描述符
   * @throws ConflictException 当 moduleKey 重复时
   * @throws Error 当 moduleKey 格式不合法时
   */
  registerDescriptor(descriptor: FeatureModuleDescriptor): void {
    if (!isValidKebabCase(descriptor.moduleKey)) {
      throw new Error(
        `Invalid moduleKey "${descriptor.moduleKey}": must be kebab-case format`,
      );
    }

    if (this.descriptors.has(descriptor.moduleKey)) {
      throw new ConflictException(
        `Duplicate moduleKey "${descriptor.moduleKey}": already registered`,
      );
    }

    this.descriptors.set(descriptor.moduleKey, descriptor);
    this.logger.log(`Registered feature module: ${descriptor.moduleKey}`);
  }

  /**
   * 注册同步插件
   */
  registerPlugin(plugin: SyncPlugin): void {
    this.plugins.push(plugin);
    this.logger.log(`Registered sync plugin: ${plugin.name} (order: ${plugin.order})`);
  }

  /**
   * 获取所有已注册的描述符
   */
  getDescriptors(): FeatureModuleDescriptor[] {
    return Array.from(this.descriptors.values());
  }

  /**
   * 根据 moduleKey 获取描述符
   */
  getDescriptor(moduleKey: string): FeatureModuleDescriptor | undefined {
    return this.descriptors.get(moduleKey);
  }

  /**
   * 系统启动时，按 order 排序执行所有插件的 onSystemStartup
   * 单个插件失败不阻塞其他插件
   */
  async onModuleInit(): Promise<void> {
    const descriptors = this.getDescriptors();
    const sorted = [...this.plugins].sort((a, b) => a.order - b.order);

    this.logger.log(
      `Starting ${sorted.length} sync plugins for ${descriptors.length} feature modules`,
    );

    for (const plugin of sorted) {
      try {
        await plugin.onSystemStartup(descriptors);
        this.logger.log(`Plugin "${plugin.name}" completed successfully`);
      } catch (error) {
        this.logger.error(
          `Plugin "${plugin.name}" failed during startup: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}
