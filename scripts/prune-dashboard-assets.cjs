const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..', 'dashboard', 'dist');
const assets = path.join(root, 'assets');

/** Follow the entire current module graph, including CSS URLs and lazy chunk imports. */
function referencedAssets(directory) {
  const referenced = new Set(), pending = [path.join(directory, 'index.html')];
  while (pending.length) {
    const file = pending.pop();
    const text = fs.readFileSync(file, 'utf8');
    const matches = [...text.matchAll(/(?:["'`(])((?:\/?assets\/|\.\/|\.\.\/)?[\w@./-]+\.(?:js|css|woff2?|ttf|otf|png|jpe?g|gif|svg|webp|ico))(?:[?#][^"'`)\s]*)?["'`)]/g)];
    for (const [, url] of matches) {
      const candidate = path.resolve(/^\/?assets\//.test(url) ? directory : path.dirname(file), url.startsWith('/') ? url.slice(1) : url);
      if (!candidate.startsWith(path.join(directory, 'assets') + path.sep) || referenced.has(candidate) || !fs.existsSync(candidate)) continue;
      referenced.add(candidate);
      if (/\.(js|css)$/.test(candidate)) pending.push(candidate);
    }
  }
  return referenced;
}

function plan(directory, days = 30, now = Date.now()) {
  if (!Number.isFinite(days) || days < 7) throw new Error('Retention must be at least 7 days');
  const protectedFiles = referencedAssets(directory), target = path.resolve(directory, 'assets');
  if (!protectedFiles.size) throw new Error('Current asset graph is empty; refusing cleanup');
  const candidates = fs.readdirSync(target, { withFileTypes: true }).filter(entry => entry.isFile()).map(entry => path.join(target, entry.name));
  return candidates.filter(file => !protectedFiles.has(file) && now - fs.statSync(file).mtimeMs > days * 86400000);
}
if (require.main === module) {
  const index = process.argv.indexOf('--days'), days = index >= 0 ? Number(process.argv[index + 1]) : 30;
  const obsolete = plan(root, days);
  console.log(JSON.stringify({ apply: process.argv.includes('--apply'), retentionDays: days, files: obsolete.map(file => path.relative(root, file)) }, null, 2));
  if (process.argv.includes('--apply')) for (const file of obsolete) {
    // No recursive deletion; only regular files resolved inside this checkout's assets directory.
    if (path.dirname(file) !== assets || fs.lstatSync(file).isSymbolicLink()) throw new Error('Unsafe cleanup target');
    fs.unlinkSync(file);
  }
}
module.exports = { plan, referencedAssets };
