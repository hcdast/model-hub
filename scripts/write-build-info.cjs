const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
function git(args) { try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } }
const commit = process.env.GIT_COMMIT || git(['rev-parse', 'HEAD']) || null;
const dirty = !!git(['status', '--porcelain', '--untracked-files=normal']);
const builtAt = new Date().toISOString();
const info = { id: process.env.BUILD_ID || `${commit?.slice(0, 12) || 'local'}${dirty ? '-dirty' : ''}-${builtAt}`, commit, dirty, builtAt };
fs.writeFileSync(path.join(root, 'dist/build-info.json'), JSON.stringify(info, null, 2));
console.log(`Backend build manifest: ${info.id}`);
