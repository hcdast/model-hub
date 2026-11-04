/**
 * 文档同步 CLI 脚本
 * 读取模块描述符，统一更新 docs/technical.md 的权限、菜单、审计与设计片段。
 *
 * 用法:
 *   node scripts/sync-docs.cjs
 *
 * Requirements: 6.5
 */
const fs = require('fs');
const path = require('path');

// ─── Doc Sync 核心逻辑（与 src/common/services/doc-sync.service.ts 保持一致） ───

function generateFragment(moduleKey, content) {
  const startMarker = `<!-- AUTO:${moduleKey}:START -->`;
  const endMarker = `<!-- AUTO:${moduleKey}:END -->`;
  return `${startMarker}\n${content}\n${endMarker}`;
}

function replaceMarkedContent(document, moduleKey, newContent) {
  const startMarker = `<!-- AUTO:${moduleKey}:START -->`;
  const endMarker = `<!-- AUTO:${moduleKey}:END -->`;
  const fragment = generateFragment(moduleKey, newContent);

  const startIdx = document.indexOf(startMarker);
  const endIdx = document.indexOf(endMarker);

  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    const trimmed = document.trimEnd();
    return trimmed.length > 0 ? `${trimmed}\n\n${fragment}` : fragment;
  }

  const before = document.substring(0, startIdx);
  const after = document.substring(endIdx + endMarker.length);
  return `${before}${fragment}${after}`;
}

function generateArchitectureContent(descriptor) {
  const lines = [];
  lines.push(`### ${descriptor.displayName} (${descriptor.moduleKey})`);
  lines.push('');

  const archDocs = (descriptor.docs || []).filter(d => d.section === 'architecture');
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
      lines.push(`| ${perm.resource} | ${perm.actions.join(', ')} | ${perm.module} |`);
    }
    lines.push('');
  }

  if (descriptor.menus && descriptor.menus.length > 0) {
    lines.push('#### 菜单配置');
    lines.push('');
    lines.push('| 路径 | 标签 | 父级 | 排序 |');
    lines.push('|------|------|------|------|');
    for (const menu of descriptor.menus) {
      lines.push(`| ${menu.path} | ${menu.label} | ${menu.parentKey || '-'} | ${menu.sortOrder} |`);
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

function generateTechnicalDesignContent(descriptor) {
  const lines = [];
  lines.push(`### ${descriptor.displayName} (${descriptor.moduleKey})`);
  lines.push('');

  const techDocs = (descriptor.docs || []).filter(d => d.section === 'technical-design');
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


// ─── 内置模块描述符（与 src/common/descriptors/index.ts 保持一致） ───
// 脚本直接内联描述符数据，避免依赖 TypeScript 编译产物

function loadDescriptors() {
  // Try loading from compiled dist first
  try {
    const { builtInDescriptors } = require('../dist/common/descriptors/index');
    if (builtInDescriptors && builtInDescriptors.length > 0) {
      console.log(`从 dist/ 加载了 ${builtInDescriptors.length} 个模块描述符`);
      return builtInDescriptors;
    }
  } catch (_) {
    // dist not available, fall through
  }

  // Try loading via ts-node register
  try {
    require('ts-node').register({
      project: path.resolve(__dirname, '../tsconfig.json'),
      transpileOnly: true,
    });
    const { builtInDescriptors } = require('../src/common/descriptors/index');
    if (builtInDescriptors && builtInDescriptors.length > 0) {
      console.log(`通过 ts-node 加载了 ${builtInDescriptors.length} 个模块描述符`);
      return builtInDescriptors;
    }
  } catch (_) {
    // ts-node not available, fall through
  }

  console.error('无法加载模块描述符。请先运行 npm run build 或安装 ts-node。');
  process.exit(1);
}

// ─── 主流程 ─────────────────────────────────────────────────────

function main() {
  const documentPath = path.resolve(__dirname, '../docs/technical.md');
  const descriptors = loadDescriptors();
  // 主文档缺失时拒绝创建孤立的片段文件，避免误将资料丢失当作正常同步。
  let content = fs.readFileSync(documentPath, 'utf8');
  let updated = 0;
  for (const descriptor of descriptors) {
    let fragment = generateArchitectureContent(descriptor);
    if ((descriptor.docs || []).some(doc => doc.section === 'technical-design')) {
      const design = generateTechnicalDesignContent(descriptor).replace(/^### [^\n]+\n\n/, '');
      fragment += `\n\n${design}`;
    }
    const next = replaceMarkedContent(content, descriptor.moduleKey, fragment);
    if (next !== content) updated++;
    content = next;
  }
  fs.writeFileSync(documentPath, content, 'utf8');
  console.log(`technical.md 同步完成：${descriptors.length} 个模块，${updated} 个片段已更新。`);
}

main();
