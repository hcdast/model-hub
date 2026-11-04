const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { spawn } = require('node:child_process');
const { prepare } = require('./prepare-seedance25-maas.cjs');
const fs = require('node:fs');
const path = require('node:path');
const prices = Object.fromEntries(['default', '480p', '720p', '1080p', '480p:video', '720p:video'].map(k => [k, { cost_unit_price: 1, sale_unit_price: 2, unit_credit: 3 }])); // local test fixture only

test('configuration preparation requires prices and never auto-enables a model', () => {
  assert.equal(prepare().ready, false);
  assert.throws(() => prepare({ default: prices.default }), /480p/);
  assert.throws(() => prepare({ ...prices, '720p': { ...prices['720p'], unit_credit: 0 } }), /unit_credit/);
  assert.throws(() => prepare({ ...prices, '720p:video': undefined }), /720p:video/);
  assert.equal(prepare(prices).contract.disabled, true);
});

test('smoke preflight is read-only, enforces an estimate limit, and can resume terminal billing verification', async () => {
  const contract = prepare(prices).contract;
  const doc = { ...contract, config_id: '507f1f77bcf86cd799439011', revision: 1,
    params: Object.entries(contract.params).map(([name, def]) => ({ name, ...def })),
    public_pricing: { currency: 'credit', usage_type: 'duration', tier_param: 'resolution', tier_rules: contract.pricing.tier_rules, tiers: { '720p': 3, '720p:video': 1 } } };
  const requests = [];
  const server = createServer((req, res) => {
    let body = ''; req.on('data', chunk => body += chunk); req.on('end', () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : undefined });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 0, data: req.url.startsWith('/v1/catalog/') ? doc : req.method === 'POST' ? { taskId: 'fixture-task' } : { taskId: 'fixture-task', status: 'SUCCESS', result: { videos: ['https://example.com/result.mp4'] }, billing: { status: 'settled', actualCost: 15 } } }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const dir = path.resolve(__dirname, '../node_modules/.cache/seedance25-script-test'); fs.mkdirSync(dir, { recursive: true });
  const inputFile = path.join(dir, 'input.json'); fs.writeFileSync(inputFile, JSON.stringify(contract.examples[0].input));
  const run = args => new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(__dirname, 'smoke-seedance25-maas.cjs'), ...args], { env: { ...process.env, MODEL_HUB_API_BASE: `http://127.0.0.1:${server.address().port}/v1`, MODEL_HUB_API_KEY: 'local-fixture', MODEL_HUB_IDEMPOTENCY_KEY: 'stable-fixture' }, windowsHide: true });
    let output = ''; child.stdout.on('data', c => output += c); child.stderr.on('data', c => output += c); child.on('exit', code => resolve({ code, output }));
  });
  try {
    assert.equal((await run([])).code, 0); assert.equal(requests.filter(r => r.method === 'POST').length, 0);
    assert.equal((await run(['--run', '--input', inputFile, '--max-estimated-credits', '1'])).code, 1);
    assert.equal(requests.filter(r => r.method === 'POST').length, 0);
    const success = await run(['--run', '--input', inputFile, '--max-estimated-credits', '15']);
    assert.equal(success.code, 0, success.output); assert.match(success.output, /verified/);
    const submitted = requests.filter(r => r.method === 'POST'); assert.equal(submitted.length, 1);
    assert.equal(submitted[0].headers['x-idempotency-key'], 'stable-fixture');
    assert.equal(submitted[0].body.options.configRevision, 1);
    assert.equal((await run(['--task-id', 'fixture-task'])).code, 0);
    assert.equal(requests.filter(r => r.method === 'POST').length, 1);
    fs.writeFileSync(inputFile, JSON.stringify({ ...contract.examples[0].input, videos: ['https://example.com/reference.mp4'] }));
    const video = await run(['--run', '--input', inputFile, '--max-estimated-credits', '5']);
    assert.equal(video.code, 0, video.output); assert.match(video.output, /"estimatedCredits":5/);
    assert.equal(requests.filter(r => r.method === 'POST').length, 2);
  } finally { await new Promise(resolve => server.close(resolve)); fs.unlinkSync(inputFile); }
});
