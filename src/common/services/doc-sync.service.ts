import { Injectable, Logger } from '@nestjs/common';
import {
  FeatureModuleDescriptor,
  FeatureDocDef,
} from '../interfaces/feature-module.interface';

/**
 * 文档同步服务
 * 根据模块描述符生成文档片段，使用标记注释包裹自动生成的内容区域，
 * 并支持在已有文档中替换标记之间的内容。
 */
@Injectable()
export class DocSyncService {
  private readonly logger = new Logger(DocSyncService.name);

  /**
   * 生成带标记注释包裹的文档片段
   */
  generateFragment(moduleKey: string, content: string): string {
    const startMarker = `<!-- AUTO:${moduleKey}:START -->`;
    const endMarker = `<!-- AUTO:${moduleKey}:END -->`;
    return `${startMarker}\n${content}\n${endMarker}`;
  }

  /**
   * 在已有文档内容中替换标记之间的内容，如果标记不存在则追加
   */
  replaceMarkedContent(
    document: string,
    moduleKey: string,
    newContent: string,
  ): string {
    const startMarker = `<!-- AUTO:${moduleKey}:START -->`;
    const endMarker = `<!-- AUTO:${moduleKey}:END -->`;
    const fragment = this.generateFragment(moduleKey, newContent);

    const startIdx = document.indexOf(startMarker);
    const endIdx = document.indexOf(endMarker);

    if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
      // Markers not found or malformed — append fragment
      const trimmed = document.trimEnd();
      return trimmed.length > 0 ? `${trimmed}\n\n${fragment}` : fragment;
    }

    const before = document.substring(0, startIdx);
    const after = document.substring(endIdx + endMarker.length);
    return `${before}${fragment}${after}`;
  }

  /**
   * 根据模块描述符生成 architecture 文档片段
   */
  generateArchitectureContent(descriptor: FeatureModuleDescriptor): string {
    const lines: string[] = [];
    lines.push(`### ${descriptor.displayName} (${descriptor.moduleKey})`);
    lines.push('');

    const archDocs = (descriptor.docs || []).filter(
      (d) => d.section === 'architecture',
    );
    if (archDocs.length > 0) {
      for (const doc of archDocs) {
        lines.push(`#### ${doc.title}`);
        lines.push('');
        lines.push(doc.description);
        lines.push('');
      }
    }

    if (descriptor.permissions && descriptor.permissions.length > 0) {
      lines.push('#### 权限定义');
      lines.push('');
      lines.push('| 资源 | 操作 | 所属模块 |');
      lines.push('|------|------|---------|');
      for (const perm of descriptor.permissions) {
        lines.push(
          `| ${perm.resource} | ${perm.actions.join(', ')} | ${perm.module} |`,
        );
      }
      lines.push('');
    }

    if (descriptor.menus && descriptor.menus.length > 0) {
      lines.push('#### 菜单配置');
      lines.push('');
      lines.push('| 路径 | 标签 | 父级 | 排序 |');
      lines.push('|------|------|------|------|');
      for (const menu of descriptor.menus) {
        lines.push(
          `| ${menu.path} | ${menu.label} | ${menu.parentKey || '-'} | ${menu.sortOrder} |`,
        );
      }
      lines.push('');
    }

    if (descriptor.audit && descriptor.audit.length > 0) {
      lines.push('#### 审计配置');
      lines.push('');
      lines.push('| 控制器 | 资源类型 |');
      lines.push('|--------|---------|');
      for (const audit of descriptor.audit) {
        lines.push(`| ${audit.controllerName} | ${audit.resourceType} |`);
      }
      lines.push('');
    }

    return lines.join('\n').trimEnd();
  }

  /**
   * 根据模块描述符生成 technical-design 文档片段
   */
  generateTechnicalDesignContent(
    descriptor: FeatureModuleDescriptor,
  ): string {
    const lines: string[] = [];
    lines.push(`### ${descriptor.displayName} (${descriptor.moduleKey})`);
    lines.push('');

    const techDocs = (descriptor.docs || []).filter(
      (d) => d.section === 'technical-design',
    );
    if (techDocs.length > 0) {
      for (const doc of techDocs) {
        lines.push(`#### ${doc.title}`);
        lines.push('');
        lines.push(doc.description);
        lines.push('');
      }
    } else {
      lines.push(`模块 \`${descriptor.moduleKey}\` 暂无技术设计文档。`);
      lines.push('');
    }

    return lines.join('\n').trimEnd();
  }

  /**
   * 为所有描述符同步文档内容
   * 返回更新后的 { architecture, technicalDesign } 文档字符串
   */
  syncAllDescriptors(
    descriptors: FeatureModuleDescriptor[],
    existingArchitecture: string,
    existingTechnicalDesign: string,
  ): { architecture: string; technicalDesign: string } {
    let architecture = existingArchitecture;
    let technicalDesign = existingTechnicalDesign;

    for (const descriptor of descriptors) {
      const archContent = this.generateArchitectureContent(descriptor);
      architecture = this.replaceMarkedContent(
        architecture,
        descriptor.moduleKey,
        archContent,
      );

      const techContent = this.generateTechnicalDesignContent(descriptor);
      technicalDesign = this.replaceMarkedContent(
        technicalDesign,
        descriptor.moduleKey,
        techContent,
      );
    }

    return { architecture, technicalDesign };
  }
}
