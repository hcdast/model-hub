const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { plan } = require('./prune-dashboard-assets.cjs');
test('protects current dynamic imports, CSS and image references while selecting only old orphans', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assets-test-'));
  try {
    fs.mkdirSync(path.join(dir, 'assets'));
    const files = { 'index.html': '<script src="/assets/app.js"></script>', 'assets/app.js': 'import("./lazy.js");import "./app.css";const deps=["assets/mapped.js"]', 'assets/mapped.js': 'console.log("Vite map dependency")', 'assets/lazy.js': 'console.log("kept")', 'assets/app.css': 'url("./image.png")', 'assets/image.png': 'image', 'assets/old.js': 'obsolete', 'assets/new.js': 'retained for old session' };
    for (const [file, content] of Object.entries(files)) { const target = path.join(dir, file); fs.writeFileSync(target, content); if (file !== 'assets/new.js') fs.utimesSync(target, new Date(0), new Date(0)); }
    assert.deepEqual(plan(dir).map(file => path.basename(file)), ['old.js']);
    assert.throws(() => plan(dir, 1), /at least 7/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
