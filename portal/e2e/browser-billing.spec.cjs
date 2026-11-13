const { test, expect } = require('@playwright/test');

async function fixture(page, { legacyServer = false, cost = 2 } = {}) {
  const state = { quotes: 0, submissions: 0, keyCalls: 0, errors: [] };
  let project = { id: 'billing-fixture', revision: 1, candidates: [], pendingRequests: [], history: [], budget: { limit: 100, used: 0, reserved: 0, remaining: 100 },
    plan: { title: '未命名短剧', story: '西游记', inputMode: 'idea', style: '绘本漫剧', duration: 60, step: 0,
      characters: [], scenes: [], shots: [], production: { provider: 'akool-maas', models: {} },
      settings: { subtitles: true, subtitleStyle: 'white', musicVolume: 18, resolution: '720p' }, frame: { ratio: '9:16', fit: 'contain', voiceVolume: 100 } } };
  const quote = { id: 'quote-fixture', kind: 'script', count: 1, estimatedCost: cost, currency: 'credit', expiresAt: new Date(Date.now() + 300000).toISOString(), modelName: '测试编剧模型', provider: 'akool-maas', items: [], warnings: [] };
  const baseURL = test.info().project.use.baseURL;
  page.on('pageerror', error => state.errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('portal-language', 'zh'));
  await page.context().addCookies([{ name: 'portal_csrf_token', value: 'isolated-billing-test', url: baseURL }]);
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== new URL(baseURL).origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    let data = {};
    if (url.pathname.includes('/api-keys')) { state.keyCalls++; data = []; }
    else if (url.pathname === '/api/v1/auth/refresh') data = { accessToken: 'fixture-token' };
    else if (url.pathname === '/api/v1/auth/me') data = { id: 'fixture-user', username: 'Fixture', role: 'user', status: 'active' };
    else if (url.pathname === '/api/v1/short-dramas/models') data = [{ configId: 'test-model', modelId: 'test-script', name: '测试编剧模型', type: 'textGenerate', provider: 'akool-maas', kinds: ['script'], params: [] }];
    else if (url.pathname === '/api/v1/short-dramas/capabilities') data = { generationEnabled: true, createEnabled: true, exportEnabled: true, mp4: true, subtitles: true };
    else if (url.pathname === '/api/v1/short-dramas/billing-fixture/quotes') {
      state.quotes++;
      if (legacyServer) return route.fulfill({ status: 400, json: { code: 1009, message: '请先启用一个 API Key 作为生成凭证。' } });
      data = quote;
    } else if (url.pathname === '/api/v1/short-dramas/billing-fixture/generate') {
      state.submissions++;
      project = { ...project, candidates: [{ id: 'unfunded-candidate', projectId: project.id, kind: 'script', targetId: 'project', source: 'model', status: 'failed', createdAt: new Date().toISOString(), error: '账号可用余额不足，此项需要 2 积分。请联系管理员补足账号余额后重试。项目预算不会增加账号余额。' }] };
      data = project;
    } else if (url.pathname === '/api/v1/short-dramas/billing-fixture') {
      if (request.method() === 'PUT') project = { ...project, plan: request.postDataJSON().plan, revision: project.revision + 1 };
      data = project;
    } else if (url.pathname === '/api/v1/notifications/unread-count') data = { count: 0 };
    else data = { items: [], total: 0 };
    return route.fulfill({ json: { code: 0, data } });
  });
  await page.goto('/short-dramas/billing-fixture');
  await expect(page.getByRole('button', { name: '任务 0 · 项目剩余预算 100 积分', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '帮我完善故事', exact: true }).click();
  return state;
}

test('a signed-in creator can quote without API keys; confirmation explains insufficient account balance', async ({ page }) => {
  const state = await fixture(page);
  await page.getByRole('button', { name: '查看本次消耗', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('项目剩余预算 100 积分');
  await expect(page.getByRole('dialog')).toContainText('最终按实际用量结算，可能高于或低于预估');
  expect(state.quotes).toBe(1); expect(state.submissions).toBe(0); expect(state.keyCalls).toBe(0);
  await page.getByRole('button', { name: /确认并开始制作/ }).click();
  await expect(page.locator('.sd-script-results')).toContainText('账号可用余额不足');
  await expect(page.getByRole('link', { name: '去配置生成凭证' })).toHaveCount(0);
  expect(state.submissions).toBe(1); expect(state.keyCalls).toBe(0); expect(state.errors).toEqual([]);
  await page.screenshot({ path: 'output/browser-billing-confirmation.png', fullPage: true });
});

test('a quote above project budget stays blocked before submission', async ({ page }) => {
  const state = await fixture(page, { cost: 101 });
  await page.getByRole('button', { name: '查看本次消耗', exact: true }).click();
  await expect(page.getByRole('button', { name: /确认并开始制作/ })).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('项目剩余预算 100 积分');
  expect(state.submissions).toBe(0); expect(state.keyCalls).toBe(0); expect(state.errors).toEqual([]);
});

test('during a rolling update an old missing-key error never sends a creator to developer settings', async ({ page }) => {
  const state = await fixture(page, { legacyServer: true });
  await page.getByRole('button', { name: '查看本次消耗', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('生成服务暂时不可用');
  await expect(page.getByRole('dialog')).not.toContainText('API Key');
  await expect(page.getByRole('link', { name: '去配置生成凭证' })).toHaveCount(0);
  expect(state.submissions).toBe(0); expect(state.keyCalls).toBe(0); expect(state.errors).toEqual([]);
});
