/** 校验核心技术、设计、交互文档的目录边界与本地文件链接。 */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const docs = path.join(root, 'docs');
const errors = [];
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}
const files = walk(docs);
const allowed = new Set(['README.md', 'technical.md', 'design.md', 'interaction.md']);
for (const file of files) {
  const relative = path.relative(docs, file);
  if (!allowed.has(relative)) {
    errors.push(`${relative}: docs 仅维护索引与 technical.md、design.md、interaction.md；新增内容请合并到对应章节`);
  }
}
for (const file of allowed) if (!fs.existsSync(path.join(docs, file))) errors.push(`${file}: 核心文档缺失`);
function prose(file) {
  return fs.readFileSync(file, 'utf8').replace(/^\s*(```|~~~)[\s\S]*?^\s*\1.*$/gm, '');
}
function anchors(file) {
  const content = prose(file);
  const result = new Set([...content.matchAll(/<a\s+id="([^"]+)"\s*>/g)].map(match => match[1]));
  const seen = new Map();
  for (const match of content.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const base = match[1].toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}\p{M}_\- ]/gu, '').replace(/ /g, '-');
    const count = seen.get(base) || 0; seen.set(base, count + 1);
    result.add(count ? `${base}-${count}` : base);
  }
  return result;
}
let links = 0;
for (const file of [path.join(root, 'README.md'), ...files.filter(file => file.endsWith('.md'))]) {
  // 代码块中的演示 Markdown 不参与链接校验。
  const source = prose(file);
  for (const match of source.matchAll(/!?\[[^\]\n]*\]\((<?[^)\n]+>?)\)/g)) {
    const href = match[1].replace(/^<|>$/g, '').split(/\s+"/)[0];
    if (/^(?:https?:|mailto:|app:|codex:)/.test(href)) continue;
    links++;
    const [target, fragment] = decodeURIComponent(href).split('#');
    const resolved = target ? path.resolve(path.dirname(file), target.replace(/:\d+$/, '')) : file;
    if (!resolved.startsWith(root + path.sep) || !fs.existsSync(resolved)) {
      errors.push(`${path.relative(root, file)}: 本地链接不存在或超出仓库：${href}`);
    } else if (fragment && resolved.endsWith('.md') && !anchors(resolved).has(fragment)) {
      errors.push(`${path.relative(root, file)}: 章节锚点不存在：${href}`);
    }
  }
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log(`文档检查通过：${files.length} 篇核心文档、${links} 个本地文件链接。`);
