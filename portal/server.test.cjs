const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createPortalServer } = require('./server.cjs');

test('portal serves deep links and proxies API requests without turning errors into HTML', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'model-hub-portal-test-'));
  await fs.writeFile(path.join(root, 'index.html'), '<main>Portal</main>');
  const upstream = http.createServer((req, res) => {
    assert.equal(req.url, '/v1/catalog/models?type=image');
    assert.equal(req.headers.authorization, 'Bearer test-token');
    assert.equal(req.headers.cookie, 'session=test');
    res.writeHead(401, { 'Content-Type': 'application/json', 'Set-Cookie': 'session=updated; HttpOnly; Path=/api/v1/auth' });
    res.end(JSON.stringify({ code: 401 }));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const portal = createPortalServer({ root, apiTarget: `http://127.0.0.1:${upstream.address().port}` });
  await new Promise(resolve => portal.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${portal.address().port}`;
  try {
    const response = await fetch(`${base}/api/v1/catalog/models?type=image`, { headers: { Authorization: 'Bearer test-token', Cookie: 'session=test' } });
    assert.equal(response.status, 401);
    assert.match(response.headers.get('content-type'), /json/);
    assert.match(response.headers.get('set-cookie'), /HttpOnly/);
    assert.deepEqual(await response.json(), { code: 401 });
    const page = await fetch(`${base}/models/vendor%2Fmodel`);
    assert.equal(page.status, 200);
    assert.equal(await page.text(), '<main>Portal</main>');
    assert.equal((await fetch(`${base}/missing.js`)).status, 404);
    assert.equal((await fetch(`${base}/%00`)).status, 400);
    assert.equal((await fetch(`${base}/%E0%A4%A`)).status, 400);
  } finally {
    await Promise.all([new Promise(resolve => portal.close(resolve)), new Promise(resolve => upstream.close(resolve))]);
    await fs.rm(root, { recursive: true, force: true });
  }
});
