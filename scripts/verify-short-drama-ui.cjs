/** Browser contract tests use isolated API fixtures; no real model or billing calls. */
require('ts-node').register({ transpileOnly: true, moduleTypes: { 'portal/src/**/*.ts': 'cjs' } });
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { exampleDrama } = require('../portal/src/utils/drama.ts');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.DRAMA_UI_ORIGIN || 'http://127.0.0.1:7004';

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  try {
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const id = randomUUID(), plan = exampleDrama(); plan.step = 2; plan.storyConfirmed = true; plan.castConfirmed = true;
    const project = { id, revision: 0, plan, updatedAt: new Date().toISOString(), candidates: [] };
    for (const [i, shot] of plan.shots.entries()) {
      const c = { id: randomUUID(), projectId: id, targetId: shot.id, kind: 'image', source: 'upload', status: 'succeeded', url: `${origin}/drama/cafe.jpg` };
      project.candidates.push(c); shot.image = c.id;
      if (i < 10) { const video = { ...c, id: randomUUID(), kind: 'video' }; project.candidates.push(video); shot.video = video.id; }
    }
    let missingKey = true, quoteRequest, generationCount = 0, conflict = false;
    await context.addCookies([{ name: 'portal_csrf_token', value: 'browser-test-only', url: origin }]);
    await page.addInitScript(() => localStorage.setItem('portal-language', 'zh'));
    await page.route('**/api/v1/**', async route => {
      const req = route.request(), url = new URL(req.url()), endpoint = url.pathname.replace('/api/v1', '');
      const body = () => req.postDataJSON();
      const send = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(status < 400 ? { code: 0, data } : data) });
      if (endpoint === '/auth/refresh') return send({ accessToken: 'ui-test-session' });
      if (endpoint === '/auth/me') return send({ id: 'ui-test-owner', email: 'ui-test@example.invalid', username: '测试创作者', role: 'user', status: 'active', usage: {} });
      if (endpoint === '/short-dramas/models') return send([
        { configId: '000000000000000000000001', modelId: 'fixture', name: 'UI 测试配置', provider: 'wavespeed-ai', type: 'textToVideo', kinds: ['video', 'image', 'script', 'character'], params: [] },
        { configId: '000000000000000000000002', modelId: 'other-fixture', name: 'UI 测试配置', provider: 'akool', type: 'textToVideo', kinds: ['video'], params: [] },
      ]);
      if (endpoint === '/short-dramas/capabilities') return send({ mp4: false, subtitles: false, reason: '成片服务尚未配置 FFmpeg。' });
      if (endpoint === `/short-dramas/${id}`) {
        if (req.method() === 'PUT') {
          if (conflict || body().revision !== project.revision) return send({ code: 'DRAMA_REVISION_CONFLICT', message: '作品已在其他窗口更新。' }, 409);
          project.plan = body().plan; project.revision++;
        }
        return send(project);
      }
      if (endpoint.endsWith('/quotes')) {
        if (missingKey) return send({ code: 1009, message: '请先启用一个 API Key。作品已保留。' }, 400);
        quoteRequest = body(); return send({ id: 'quote-fixture', kind: body().kind, count: body().targetIds.length, estimatedCost: 24, currency: 'credit', expiresAt: new Date(Date.now() + 300000).toISOString(), modelName: 'UI 测试配置', provider: 'wavespeed-ai', warnings: ['仅用于浏览器契约验证'] });
      }
      if (endpoint.endsWith('/generate')) {
        generationCount++;
        for (const targetId of quoteRequest.targetIds) project.candidates.push({ id: randomUUID(), projectId: id, targetId, kind: quoteRequest.kind, status: 'succeeded', source: 'model', url: `${origin}/drama/cafe.jpg` });
        return send(project);
      }
      return send({ items: [], total: 0 });
    });
    await page.goto(`${origin}/short-dramas/${id}`);
    await page.getByRole('textbox', { name: '画面描述', exact: true }).waitFor();
    await page.getByRole('textbox', { name: '画面描述', exact: true }).fill('女孩拿起信封，望向窗外。');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByText('已保存', { exact: true }).waitFor();
    await page.reload(); await page.getByRole('textbox', { name: '画面描述', exact: true }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: '画面描述', exact: true }).inputValue(), '女孩拿起信封，望向窗外。');
    const shotsBefore = JSON.stringify(project.candidates);
    await page.getByTestId('drama-next').click(); await page.getByText('让每一个镜头，都成为故事的一部分。').waitFor();
    await page.locator('.sd-video-grid .sd-shot').nth(10).click();
    await page.getByRole('button', { name: '仅制作这个镜头', exact: true }).click();
    await page.getByRole('button', { name: '查看本次消耗', exact: true }).click();
    await page.getByRole('link', { name: '去配置生成凭证' }).waitFor();
    assert.equal(generationCount, 0); assert.equal(JSON.stringify(project.candidates), shotsBefore);
    await page.getByRole('button', { name: '暂不开始', exact: true }).click(); missingKey = false;
    await page.getByRole('button', { name: '仅制作这个镜头', exact: true }).click();
    await page.getByRole('combobox', { name: '制作配置', exact: true }).fill('wavespeed-ai');
    await page.getByText('UI 测试配置 · 文生视频 · wavespeed-ai', { exact: true }).click();
    await page.getByRole('button', { name: '查看本次消耗', exact: true }).click();
    await page.getByRole('button', { name: /确认并开始制作/ }).waitFor(); assert.equal(generationCount, 0);
    assert.equal(quoteRequest.configId, '000000000000000000000001');
    await page.locator('.sd-quote').getByText('UI 测试配置 · wavespeed-ai', { exact: true }).waitFor();
    await page.getByRole('button', { name: /确认并开始制作/ }).click();
    await page.getByRole('button', { name: '选用这个候选', exact: true }).waitFor();
    await page.getByRole('button', { name: '选用这个候选', exact: true }).click();
    assert.equal(generationCount, 1); assert.ok(project.candidates.length > JSON.parse(shotsBefore).length);
    const dir = path.resolve('output/short-drama-ui'); fs.mkdirSync(dir, { recursive: true });
    await page.getByTestId('drama-step-2').click(); await page.screenshot({ path: path.join(dir, 'short-drama-studio-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 1000 });
    for (let i = 0; i < 5; i++) { await page.getByTestId(`drama-step-${i}`).click(); const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1); assert.equal(overflow, false, `step ${i} must fit narrow screens`); }
    await page.getByTestId('drama-step-2').click(); await page.screenshot({ path: path.join(dir, 'short-drama-studio-mobile.png'), fullPage: true });
    conflict = true; await page.getByRole('textbox', { name: '画面描述', exact: true }).fill('本机未保存编辑'); await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByText('作品已在其他窗口更新。', { exact: true }).waitFor(); assert.equal(await page.getByTestId('drama-next').isDisabled(), true);
    assert.equal(await page.getByRole('textbox', { name: '画面描述', exact: true }).inputValue(), '本机未保存编辑');
    assert.deepEqual(errors, []); console.log('Passed: persistence, preflight recovery, explicit authorization, scoped generation, candidate selection, five narrow-screen stages, conflict preservation.');
  } finally { await context.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
