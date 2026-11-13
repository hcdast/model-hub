const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');

function snapshot(directory, ignored = new Set()) {
  const result = {};
  if (!fs.existsSync(directory)) return result;
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(directory, absolute).split(path.sep).join('/');
      if (ignored.has(relative)) continue;
      if (entry.isSymbolicLink()) throw new Error(`Build directory must not contain symlinks: ${absolute}`);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) result[relative] = createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
    }
  }
  visit(directory);
  return result;
}

function configurationHash(root) {
  const hash = createHash('sha256');
  for (const filename of ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'nest-cli.json', 'scripts/build-backend.cjs']) {
    hash.update(filename).update('\0');
    const file = path.join(root, filename);
    hash.update(fs.existsSync(file) ? fs.readFileSync(file) : '<missing>');
  }
  for (const dependency of ['typescript', '@nestjs/cli']) {
    hash.update(fs.readFileSync(require.resolve(`${dependency}/package.json`, { paths: [root, __dirname] })));
  }
  return hash.update(process.version).digest('hex');
}

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

async function buildBackend({ root = path.resolve(__dirname, '..'), clean = false, log = console.log } = {}) {
  const started = Date.now();
  log('[backend] Checking source files and cached output...');
  root = fs.realpathSync(root);
  const dist = path.resolve(root, 'dist');
  // Every recursive cleanup is limited to this checkout's literal dist directory.
  if (path.dirname(dist) !== root || (fs.existsSync(dist) && fs.lstatSync(dist).isSymbolicLink())) {
    throw new Error(`Unsafe backend output directory: ${dist}`);
  }
  const stateFile = path.join(dist, '.backend-build.json');
  const cacheFile = path.join(dist, 'backend.tsbuildinfo');
  const ignoredOutputs = new Set(['.backend-build.json', 'build-info.json']);
  const sources = snapshot(path.join(root, 'src'));
  const configuration = configurationHash(root);
  let previous;
  try { previous = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { /* First or interrupted build. */ }
  const outputs = snapshot(dist, ignoredOutputs);
  const reusable = previous?.version === 1 && previous.configuration === configuration
    && same(Object.keys(previous.sources || {}), Object.keys(sources))
    && !!previous.outputs?.['main.js'] && !!previous.outputs?.['backend.tsbuildinfo']
    && same(previous.outputs, outputs);

  if (!clean && reusable && same(previous.sources, sources)) {
    log(`[backend] Sources and compiled files are unchanged; skipping compilation (${((Date.now() - started) / 1000).toFixed(1)}s).`);
    return { skipped: true };
  }
  if (clean || !reusable) {
    log('[backend] Clean build: configuration, source file list or output changed.');
    fs.rmSync(dist, { recursive: true, force: true });
  } else {
    log('[backend] Incremental build: reusing TypeScript cache.');
  }
  fs.mkdirSync(dist, { recursive: true });
  // A failed or interrupted build must never be accepted as a successful cache hit.
  fs.rmSync(stateFile, { force: true });
  fs.rmSync(path.join(dist, 'build-info.json'), { force: true });
  const heartbeat = setInterval(() => log(`[backend] Still compiling (${Math.round((Date.now() - started) / 1000)}s)...`), 15000);
  try {
    const compiler = require.resolve('@nestjs/cli/bin/nest.js', { paths: [root, __dirname] });
    const child = spawn(process.execPath, [compiler, 'build'], { cwd: root, stdio: 'inherit', windowsHide: true });
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => signal ? reject(new Error(`Backend compiler stopped by ${signal}`)) : resolve(code));
    });
    if (code !== 0) throw new Error(`Backend compilation failed (exit ${code}).`);
    if (!same(sources, snapshot(path.join(root, 'src'))) || configuration !== configurationHash(root)) {
      throw new Error('Build inputs changed during compilation; run the build again.');
    }
    const compiled = snapshot(dist, ignoredOutputs);
    if (!compiled['main.js'] || !compiled['backend.tsbuildinfo']) throw new Error('Backend compilation did not produce main.js and its cache.');
    fs.writeFileSync(stateFile, JSON.stringify({ version: 1, configuration, sources, outputs: compiled }));
    log(`[backend] Build completed in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
    return { skipped: false };
  } catch (error) {
    fs.rmSync(cacheFile, { force: true });
    throw error;
  } finally {
    clearInterval(heartbeat);
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--clean')) {
    console.error('Usage: npm run build [-- --clean]');
    process.exitCode = 1;
  } else {
    buildBackend({ clean: args.includes('--clean') }).catch(error => {
      console.error(`[backend] ${error.message}`);
      process.exitCode = 1;
    });
  }
}

module.exports = { buildBackend };
