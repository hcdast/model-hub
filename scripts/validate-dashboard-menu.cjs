/**
 * P0：校验 builtInDescriptors 菜单 path 在 dashboard App.tsx 中有对应路由，
 * 且菜单/分组 icon 均在 iconMap 中有映射（避免侧栏回退默认图标）。
 *
 * 路由规则：菜单 path 为 M（M !== '/'）时，存在某 Route path R 满足
 *   R === M || R.startsWith(M + '/')  （例如 /tasks 覆盖 /tasks/:taskId；/models 覆盖 /models/create）
 * M === '/' 时要求存在 path="/" 的 Route（非通配）。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DESCRIPTORS_FILE = path.join(ROOT, 'src', 'common', 'descriptors', 'index.ts');
const APP_TSX = path.join(ROOT, 'dashboard', 'src', 'App.tsx');
const MENU_REGISTRY = path.join(ROOT, 'src', 'admin', 'services', 'menu-registry.service.ts');

function loadDescriptors() {
  require('ts-node').register({
    transpileOnly: true,
    project: path.join(ROOT, 'tsconfig.json'),
  });
  const { builtInDescriptors } = require('../src/common/descriptors/index.ts');
  return builtInDescriptors;
}

function collectMenuPathsAndIcons(descriptors) {
  const paths = new Set();
  const icons = new Set();
  for (const d of descriptors) {
    for (const m of d.menus || []) {
      if (m.path) paths.add(m.path);
      if (m.icon) icons.add(m.icon);
    }
  }
  return { paths: [...paths], icons: [...icons] };
}

/** 从 menu-registry.service.ts 解析 DEFAULT_GROUPS 的 icon */
function collectDefaultGroupIcons() {
  const src = fs.readFileSync(MENU_REGISTRY, 'utf8');
  const start = src.indexOf('const DEFAULT_GROUPS');
  if (start === -1) return [];
  const end = src.indexOf('];', start);
  const block = src.slice(start, end);
  const icons = [];
  const re = /icon:\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(block)) !== null) icons.push(m[1]);
  return icons;
}

function collectRoutePathsFromAppTsx() {
  const src = fs.readFileSync(APP_TSX, 'utf8');
  const routes = [];
  const re = /<Route\s+path="([^"]+)"/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    routes.push(m[1]);
  }
  return routes;
}

function collectIconMapKeysFromAppTsx() {
  const src = fs.readFileSync(APP_TSX, 'utf8');
  const start = src.indexOf('const iconMap');
  if (start === -1) throw new Error('App.tsx: iconMap not found');
  const brace = src.indexOf('{', start);
  let depth = 0;
  let i = brace;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  const block = src.slice(brace, i);
  const keys = [];
  const re = /^\s*([A-Za-z0-9_]+):\s*</gm;
  while ((m = re.exec(block)) !== null) keys.push(m[1]);
  return keys;
}

function menuPathCoveredByRoutes(menuPath, routePaths) {
  if (menuPath === '/') {
    return routePaths.some((r) => r === '/');
  }
  const normalized = menuPath.endsWith('/') && menuPath.length > 1 ? menuPath.slice(0, -1) : menuPath;
  return routePaths.some((r) => {
    if (r === '*' || r.startsWith('*')) return false;
    if (r === normalized) return true;
    if (r.startsWith(`${normalized}/`)) return true;
    return false;
  });
}

function main() {
  const errors = [];

  let descriptors;
  try {
    descriptors = loadDescriptors();
  } catch (e) {
    errors.push(`加载 builtInDescriptors 失败: ${e.message}`);
    console.error(errors.join('\n'));
    process.exit(1);
  }

  const { paths: menuPaths, icons: menuIcons } = collectMenuPathsAndIcons(descriptors);
  const groupIcons = collectDefaultGroupIcons();
  const routePaths = collectRoutePathsFromAppTsx();
  const iconMapKeys = new Set(collectIconMapKeysFromAppTsx());

  for (const p of menuPaths) {
    if (!menuPathCoveredByRoutes(p, routePaths)) {
      errors.push(`菜单 path 无对应前端路由: "${p}"（请在 dashboard/src/App.tsx 增加 Route）`);
    }
  }

  for (const icon of [...menuIcons, ...groupIcons]) {
    if (!icon) continue;
    if (!iconMapKeys.has(icon)) {
      errors.push(`icon 未在 App.tsx iconMap 注册: "${icon}"`);
    }
  }

  if (errors.length) {
    console.error('[validate-dashboard-menu] 校验失败:\n' + errors.map((e) => `  - ${e}`).join('\n'));
    process.exit(1);
  }

  console.log(
    `[validate-dashboard-menu] OK — ${menuPaths.length} 个菜单 path, ${new Set([...menuIcons, ...groupIcons]).size} 个图标已对齐`,
  );
}

main();
