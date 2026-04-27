import { Injectable, Logger } from '@nestjs/common';
import { SyncPlugin } from '../../common/interfaces/sync-plugin.interface';
import {
  FeatureModuleDescriptor,
} from '../../common/interfaces/feature-module.interface';

/**
 * 审计锚点插件
 * 负责从功能模块描述符中收集审计配置，构建 controllerName → resourceType 映射。
 * 对未声明审计配置的模块，使用 moduleKey 作为默认 resourceType。
 */
@Injectable()
export class AuditAnchorPlugin implements SyncPlugin {
  readonly name = 'audit-anchor';
  readonly order = 20;

  private readonly logger = new Logger(AuditAnchorPlugin.name);

  /** controllerName → resourceType 映射表 */
  private resourceMap: Map<string, string> = new Map();

  /** controllerName → 需要额外审计的 GET 方法名列表 */
  private readonly getActionsMap = new Map<string, string[]>();

  /** 所有已注册的资源类型（去重） */
  private readonly resourceTypes = new Set<string>();

  /**
   * 系统启动时从描述符收集审计配置
   * 1. 遍历所有描述符，提取显式审计配置
   * 2. 对无审计配置的模块，使用 moduleKey 作为默认 resourceType
   * 3. 收集 auditGetActions 配置
   */
  async onSystemStartup(
    descriptors: FeatureModuleDescriptor[],
  ): Promise<void> {
    this.logger.log('开始构建审计资源映射...');

    for (const desc of descriptors) {
      if (desc.audit && desc.audit.length > 0) {
        // 显式审计配置：从描述符中读取 controllerName → resourceType 映射
        for (const auditDef of desc.audit) {
          this.resourceMap.set(auditDef.controllerName, auditDef.resourceType);
          this.resourceTypes.add(auditDef.resourceType);

          // 收集需要额外审计的 GET 方法名
          if (auditDef.auditGetActions && auditDef.auditGetActions.length > 0) {
            const existing = this.getActionsMap.get(auditDef.controllerName);
            if (existing) {
              // 合并并去重
              const merged = new Set([...existing, ...auditDef.auditGetActions]);
              this.getActionsMap.set(auditDef.controllerName, Array.from(merged));
            } else {
              this.getActionsMap.set(
                auditDef.controllerName,
                [...auditDef.auditGetActions],
              );
            }
          }
        }
      } else {
        // 默认策略：使用 moduleKey 作为 resourceType
        this.resourceTypes.add(desc.moduleKey);
      }
    }

    this.logger.log(
      `审计锚点构建完成：${this.resourceMap.size} 个显式映射，${this.resourceTypes.size} 个资源类型`,
    );
  }

  /**
   * 获取控制器对应的审计资源类型
   * 找不到映射时返回 controllerName 本身
   */
  getResourceType(controllerName: string): string {
    return this.resourceMap.get(controllerName) ?? controllerName;
  }

  /**
   * 获取所有已注册的唯一资源类型列表
   */
  getAllResourceTypes(): string[] {
    return Array.from(this.resourceTypes);
  }

  /**
   * 检查指定控制器的 GET 方法是否需要审计
   */
  shouldAuditGetAction(
    controllerName: string,
    handlerName: string,
  ): boolean {
    const actions = this.getActionsMap.get(controllerName);
    if (!actions) return false;
    return actions.includes(handlerName);
  }
}
