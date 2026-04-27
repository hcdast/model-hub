import { Injectable, Logger } from '@nestjs/common';
import { SyncPlugin } from '../../common/interfaces/sync-plugin.interface';
import {
  FeatureModuleDescriptor,
  FeatureAuditDef,
} from '../../common/interfaces/feature-module.interface';

@Injectable()
export class AuditAnchorPlugin implements SyncPlugin {
  readonly name = 'audit-anchor';
  readonly order = 20;

  private readonly logger = new Logger(AuditAnchorPlugin.name);

  /** controllerName → resourceType */
  private readonly resourceMap = new Map<string, string>();

  /** controllerName → auditGetActions */
  private readonly getActionsMap = new Map<string, string[]>();

  /** All registered resource types (deduplicated) */
  private readonly resourceTypes = new Set<string>();

  async onSystemStartup(
    descriptors: FeatureModuleDescriptor[],
  ): Promise<void> {
    this.logger.log('Building audit resource mappings...');

    for (const desc of descriptors) {
      if (desc.audit && desc.audit.length > 0) {
        // Explicit audit configuration
        for (const auditDef of desc.audit) {
          this.resourceMap.set(auditDef.controllerName, auditDef.resourceType);
          this.resourceTypes.add(auditDef.resourceType);

          if (auditDef.auditGetActions && auditDef.auditGetActions.length > 0) {
            const existing = this.getActionsMap.get(auditDef.controllerName);
            if (existing) {
              // Merge with existing actions, deduplicating
              const merged = new Set([...existing, ...auditDef.auditGetActions]);
              this.getActionsMap.set(auditDef.controllerName, Array.from(merged));
            } else {
              this.getActionsMap.set(
                auditDef.controllerName,
                auditDef.auditGetActions,
              );
            }
          }
        }
      } else {
        // Default strategy: use moduleKey as resourceType
        this.resourceTypes.add(desc.moduleKey);
      }
    }

    this.logger.log(
      `Audit anchor setup complete: ${this.resourceMap.size} explicit mappings, ${this.resourceTypes.size} resource types`,
    );
  }

  /**
   * Get the resource type for a given controller name.
   * Falls back to lowercased controller name if no mapping exists.
   */
  getResourceType(controllerName: string): string {
    return this.resourceMap.get(controllerName) ?? controllerName.toLowerCase();
  }

  /**
   * Get all registered resource types.
   */
  getAllResourceTypes(): string[] {
    return Array.from(this.resourceTypes);
  }

  /**
   * Check if a GET action should be audited for a given controller.
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
