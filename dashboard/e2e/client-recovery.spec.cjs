const { test, expect } = require('@playwright/test');
const client = { id: '000000000000000000000001', name: '恢复测试应用', apiKey: 'mh_***fixture', source: 'admin', revision: 2, enabled: true, plainCredentialOnly: true, defaultPriority: 50, modelAllowlist: [], billingPolicy: 'internal', rateLimits: { maxQps: 10, maxConcurrent: 50, maxDailyRequests: 10000 } };
async function fixture(page) {
  const state = { conflict: false, summaryFail: false, detailGate: null, requests: [], errors: [] };
  await page.addInitScript(() => {
    if (sessionStorage.getItem('recovery-fixture')) return;
    sessionStorage.setItem('recovery-fixture', '1');
    localStorage.setItem('token', 'fixture'); localStorage.setItem('username', 'fixture'); localStorage.setItem('roles', '["super_admin"]'); localStorage.setItem('permissions', '["*"]'); localStorage.setItem('menus', '["*"]');
  });
  page.on('pageerror', error => state.errors.push(error.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(test.info().project.use.baseURL).origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const endpoint = url.pathname.replace('/api/v1/admin', ''), method = route.request().method();
    state.requests.push({ endpoint, method });
    if (method !== 'GET') return route.fulfill({ status: state.conflict ? 409 : 200, json: state.conflict ? { message: '版本冲突' } : { code: 0 } });
    let data = { items: [], total: 0 };
    if (endpoint === '/menu') data = [{ key: 'access', label: '访问控制', children: [{ key: 'apps', label: '应用管理', path: '/api-clients' }, { key: 'users', label: '用户管理', path: '/users' }] }];
    else if (endpoint === '/api-clients') data = { items: [client], total: 1, page: 1, pageSize: 20 };
    else if (endpoint === '/api-clients/usage/summary') {
      if (state.summaryFail) return route.fulfill({ status: 503, json: { message: '用量汇总暂时不可用，请稍后重试' } });
      data = [{ id: client.id, totalRequests: 3, successRequests: 2, failedRequests: 1, totalCost: 0 }];
    } else if (endpoint === `/api-clients/${client.id}/usage`) {
      const d = new Date(); const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
      data = [{ date, totalRequests: 3, successRequests: 2, failedRequests: 1, totalCost: 0 }];
    } else if (endpoint === `/api-clients/${client.id}`) {
      data = { ...client, revision: 3, defaultPriority: 12 };
      if (state.detailGate) { void state.detailGate.then(() => route.fulfill({ json: { code: 0, data } })).catch(() => {}); return; }
    } else if (endpoint === '/users') data = { users: [], pagination: { total: 0, page: 1, limit: 20 } };
    else if (endpoint === '/roles') data = [];
    return route.fulfill({ json: { code: 0, data } });
  });
  return state;
}
const confirmButton = dialog => dialog.getByRole('button', { name: /确\s*定$/ });
async function priority(page) {
  await page.getByRole('row').filter({ hasText: client.name }).getByRole('button', { name: '优先级', exact: true }).click();
  return page.getByRole('dialog', { name: '编辑默认优先级', exact: true });
}

test('usage charts and summaries never present unrecorded costs as a yuan charge', async ({ page }) => {
  const state = await fixture(page); await page.goto('/api-clients');
  const row = page.getByRole('row').filter({ hasText: client.name });
  await expect(row).toContainText('费用请以计费记录为准'); await expect(row).not.toContainText('¥');
  await row.getByRole('button', { name: /用量$/ }).click(); const dialog = page.getByRole('dialog', { name: /用量趋势/ });
  await expect(dialog).toContainText('此处仅统计请求量，费用请以计费记录为准。'); await expect(dialog.locator('canvas')).toHaveCount(1);
  await expect(dialog).not.toHaveClass(/ant-zoom/);
  await page.screenshot({ path: 'output/admin-client-usage.png', clip: { x: 0, y: 0, width: 1440, height: 600 } });
  expect(state.errors).toEqual([]);
});

test('a failed summary is shown explicitly and refresh clears the failure after recovery', async ({ page }) => {
  const state = await fixture(page); state.summaryFail = true; await page.goto('/api-clients');
  const row = page.getByRole('row').filter({ hasText: client.name }); await expect(row).toContainText('用量加载失败'); await expect(row).not.toContainText('今日: 0');
  state.summaryFail = false; await page.getByRole('button', { name: /刷新$/ }).click();
  await expect(row).toContainText('今日: 3'); await expect(row).not.toContainText('用量加载失败');
});

test('latest-config reads lock the editor and are discarded after leaving its page', async ({ page }) => {
  const state = await fixture(page); state.conflict = true; await page.goto('/users'); await page.getByRole('menuitem', { name: '应用管理', exact: true }).click();
  const dialog = await priority(page); await dialog.getByRole('spinbutton').fill('25'); await confirmButton(dialog).click(); await expect(dialog.getByRole('alert')).toContainText('当前输入已保留');
  let release; state.detailGate = new Promise(resolve => { release = resolve; });
  await dialog.getByRole('button', { name: '查看最新配置' }).dblclick();
  await expect.poll(() => state.requests.filter(r => r.endpoint === `/api-clients/${client.id}`).length).toBe(1);
  await expect(dialog.getByRole('spinbutton')).toBeDisabled(); await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
  await page.goBack(); const leave = page.getByRole('dialog', { name: '确认离开', exact: true }); await expect(leave).toBeVisible(); await leave.getByRole('button', { name: /离\s*开/, exact: true }).click();
  await expect(page).toHaveURL(/\/users$/);
  const response = page.waitForResponse(r => new URL(r.url()).pathname === `/api/v1/admin/api-clients/${client.id}`);
  release(); await response;
  await expect(page.getByRole('dialog', { name: '对比最新配置' })).toHaveCount(0);
  await page.getByRole('menuitem', { name: '应用管理', exact: true }).click(); const fresh = await priority(page); await expect(fresh.getByRole('spinbutton')).toHaveValue('50');
  expect(state.errors).toEqual([]);
});

test('an open comparison is destroyed when the edited page unmounts', async ({ page, context }) => {
  const state = await fixture(page); state.conflict = true; await page.goto('/api-clients');
  const dialog = await priority(page); await dialog.getByRole('spinbutton').fill('25'); await confirmButton(dialog).click();
  await expect(dialog.getByRole('alert')).toContainText('当前输入已保留'); await dialog.getByRole('button', { name: '查看最新配置' }).click();
  await expect(page.getByRole('dialog', { name: '对比最新配置' })).toBeVisible();
  const other = await context.newPage(); await fixture(other); await other.goto('/api-clients'); await other.evaluate(() => localStorage.clear());
  await expect(page).toHaveURL(/\/login\?returnTo=/);
  await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.getByRole('button', { name: /登\s*录/ })).toBeVisible();
});

test('repeated close events produce one discard dialog and continuing keeps edits', async ({ page }) => {
  await fixture(page); await page.goto('/api-clients'); const dialog = await priority(page); await dialog.getByRole('spinbutton').fill('25');
  // Same-tick events model a rapid double click before React renders the confirmation.
  await dialog.getByRole('button', { name: /取\s*消/ }).evaluate(button => { button.click(); button.click(); });
  const discard = page.getByRole('dialog', { name: '放弃未保存的修改？', exact: true }); await expect(discard).toHaveCount(1);
  await discard.getByRole('button', { name: '继续编辑' }).click(); await expect(discard).toHaveCount(0); await expect(dialog.getByRole('spinbutton')).toHaveValue('25');
  await dialog.getByRole('button', { name: /取\s*消/ }).click(); await expect(discard).toHaveCount(1);
});
