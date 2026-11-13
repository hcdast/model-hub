const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { buildBackend } = require('./build-backend.cjs');

test('backend cache preserves checked output and recovers from missing, removed and invalid inputs', async () => {
  const fixtures = path.resolve(__dirname, '../output');
  fs.mkdirSync(fixtures, { recursive: true });
  const root = fs.mkdtempSync(path.join(fixtures, 'backend-build-test-'));
  const write = (file, content) => fs.writeFileSync(path.join(root, file), content);
  const run = options => buildBackend({ root, log: () => {}, ...options });
  try {
    fs.mkdirSync(path.join(root, 'src'));
    write('package.json', '{"private":true}');
    write('nest-cli.json', JSON.stringify({ sourceRoot: 'src', compilerOptions: { deleteOutDir: false } }));
    write('tsconfig.build.json', JSON.stringify({
      compilerOptions: { target: 'ES2021', module: 'commonjs', strict: true, skipLibCheck: true,
        incremental: true, tsBuildInfoFile: './dist/backend.tsbuildinfo', outDir: './dist',
        rootDir: './src', types: [], noEmitOnError: true },
      include: ['src/**/*.ts'],
    }));
    write('src/main.ts', 'export const value: number = 1;');
    write('src/obsolete.ts', 'export const obsolete = true;');
    assert.equal((await run()).skipped, false);
    const firstTime = fs.statSync(path.join(root, 'dist/main.js')).mtimeMs;
    // The postbuild manifest changes every run and must not invalidate compiler output.
    write('dist/build-info.json', '{"builtAt":"new"}');
    assert.equal((await run()).skipped, true);
    assert.equal(fs.statSync(path.join(root, 'dist/main.js')).mtimeMs, firstTime);

    write('src/main.ts', 'export const value: number = 2;');
    assert.equal((await run()).skipped, false);
    assert.match(fs.readFileSync(path.join(root, 'dist/main.js'), 'utf8'), /value = 2/);

    fs.unlinkSync(path.join(root, 'dist/main.js'));
    assert.equal((await run()).skipped, false);
    assert.ok(fs.existsSync(path.join(root, 'dist/main.js')));

    write('dist/main.js', 'broken output');
    assert.equal((await run()).skipped, false);
    assert.match(fs.readFileSync(path.join(root, 'dist/main.js'), 'utf8'), /value = 2/);

    fs.unlinkSync(path.join(root, 'src/obsolete.ts'));
    assert.equal((await run()).skipped, false);
    assert.equal(fs.existsSync(path.join(root, 'dist/obsolete.js')), false);

    write('src/main.ts', 'export const value: number = "invalid";');
    await assert.rejects(run(), /compilation failed/);
    assert.equal(fs.existsSync(path.join(root, 'dist/.backend-build.json')), false);
    assert.equal(fs.existsSync(path.join(root, 'dist/backend.tsbuildinfo')), false);
    write('src/main.ts', 'export const value: number = 3;');
    assert.equal((await run()).skipped, false);
    assert.match(fs.readFileSync(path.join(root, 'dist/main.js'), 'utf8'), /value = 3/);
    assert.equal((await run()).skipped, true);
    write('package-lock.json', '{"lockfileVersion":3}');
    assert.equal((await run()).skipped, false);
    assert.equal((await run({ clean: true })).skipped, false);
  } finally {
    // root is the absolute mkdtemp child under the workspace's output directory.
    assert.equal(path.dirname(root), fixtures);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
