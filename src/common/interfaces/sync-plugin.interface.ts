import { FeatureModuleDescriptor } from './feature-module.interface';

/**
 * 同步插件接口
 * 每个同步维度（权限、审计、菜单、文档）作为独立的同步插件实现此接口
 */
export interface SyncPlugin {
  /** 插件名称 */
  readonly name: string;
  /** 执行顺序，越小越先执行 */
  readonly order: number;

  /** 系统启动时调用，接收所有已注册的描述符 */
  onSystemStartup(descriptors: FeatureModuleDescriptor[]): Promise<void>;
  /** 新模块注册时调用（可选） */
  onModuleRegistered?(descriptor: FeatureModuleDescriptor): Promise<void>;
  /** 模块移除时调用（可选） */
  onModuleRemoved?(moduleKey: string): Promise<void>;
}
