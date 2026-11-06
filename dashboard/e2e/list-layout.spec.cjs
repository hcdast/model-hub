const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const fitExpect = expect.configure({ soft: true });
const paths = ['/models', '/model-routing-rules', '/tasks', '/provider-configs', '/provider-health', '/account-pool', '/account-costs', '/api-clients', '/workflows', '/billing/records', '/billing/wallets', '/stats', '/audit-logs', '/notification-rules', '/notification-records', '/notifications', '/callback-logs', '/users', '/portal-users', '/roles', '/permissions', '/menus', '/queues', '/'];
const row = { role: 'user', label: '布局测试菜单', displayName: '模型读取', resource: 'model', queueName: 'fixture-queue-long-identifier', jobId: 'fixture-job-long-identifier', waiting: 1, active: 0, depth: 1, failed: 0, completed: 1, throughputPerMin: 1, _id: '000000000000000000000001', id: 'fixture', key: 'fixture', taskId: '01LAYOUTLONGTASKIDENTIFIER12345', model_id: 'akool-premium/headswap/long-model-identifier', provider_model_name: 'fixture/long-provider-model-name', model_name: '列表布局测试模型', model: 'fixture/long-model-name', model_type: 'textToImage', provider: 'fixture', provider_name: 'fixture', base_url: 'https://example.invalid/long-base-url', icon_url: '', account_alias: '布局测试账号', apiKey: 'fixture***masked', clientName: '布局测试客户', name: '布局测试记录', title: '布局测试记录', username: 'fixture-user', email: 'fixture@example.invalid', status: 'SUCCESS', enabled: true, disabled: false, revision: 1, priority: 1, strategy_type: 'primary_fallback', primary_provider: 'fixture-primary', fallback_provider: 'fixture-backup', limits: { maxConcurrent: 10, maxPerSecond: 5 }, poll_limits: { max_per_second: 5 }, params: {}, unit_price_map: { default: { unit_credit: 1, cost_unit_price: 1, sale_unit_price: 1 } }, featureType: 'image_generate', createdAt: '2026-11-05T12:00:00Z', updatedAt: '2026-11-05T12:00:00Z', update_time: 1793880000000, roles: ['viewer'], permissions: ['model:read'], menus: [], eventTypes: ['provider_error'], severities: ['info'], eventType: 'provider_error', severity: 'info', channelType: 'in_app', channelConfig: {}, recipients: [], cooldownMs: 0, aggregationWindowMs: 0, maxCountPerWindow: 0, ruleName: '布局通知规则', eventPayload: {}, action: 'update', resourceType: 'model', resourceId: 'fixture', module: 'model', code: 'model:read', description: '长文本需要自然换行而不是撑宽表格'.repeat(5), path: '/models', type: 'menu', sort: 1, balance: 100, frozenAmount: 10, availableBalance: 90, lowBalanceThreshold: 1, billingPolicy: 'internal', usageType: 'count', currency: 'credit', estimatedCost: 1, actualCost: 1, totalCost: 1, totalRequests: 10, successCount: 9, failedCount: 1, totalCount: 10, timeoutCount: 0, cancelledCount: 0, date: '2026-11-05', sampleCount: 0, circuitState: 'CLOSED', nodes: [], tags: [], modelAllowlist: [], featurePermissions: [], auth: {}, callbackUrl: 'https://example.invalid/very-long-callback-address', attemptCount: 1, read: false };
async function fixtures(page) {
  const errors = [], writes = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { localStorage.setItem('token', 'isolated-layout'); localStorage.setItem('username', 'fixture'); localStorage.setItem('roles', '["super_admin"]'); localStorage.setItem('permissions', '["*"]'); localStorage.setItem('menus', '["*"]'); });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(test.info().project.use.baseURL).origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const endpoint = url.pathname.replace('/api/v1/admin', '');
    if (route.request().method() !== 'GET') {
      writes.push(endpoint);
      if (endpoint === '/models/import/preview') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 0, data: { planId: 'isolated', excluded: 0, rows: [{ config: row, action: 'update', errors: [], warnings: [], diff: { model_name: { before: '旧名称', after: row.model_name } } }] } }) });
      return route.abort();
    }
    let data = { items: [{ ...row }], total: 1, page: 1, pageSize: 20 };
    if (endpoint === '/menu') data = [];
    else if (['/roles', '/permissions', '/menus', '/menus/flat'].includes(endpoint)) data = [{ ...row }];
    else if (endpoint === '/permissions/modules') data = ['model'];
    else if (endpoint === '/audit-logs/resource-types') data = ['model'];
    else if (endpoint === '/provider-configs') data = { ...data, available_providers: ['fixture'] };
    else if (endpoint === '/provider-health/overview') data = { items: [{ ...row }] };
    else if (endpoint === '/billing/summary' || endpoint === '/api-clients/summary') data = [];
    else if (endpoint === '/stats/daily') data = { ...data, trend: [], summary: { totalCount: 10, successCount: 9, failedCount: 1 } };
    else if (endpoint === '/account-costs' || endpoint === '/account-costs/summary') data = { items: [{ ...row, account_id: row._id, total_cost: 1, request_count: 10, success_count: 9, failure_count: 1, total_requests: 10, total_success: 9, total_failure: 1 }], total: 1, trend: [] };
    else if (endpoint === '/models/detail') data = { ...row };
    else if (endpoint === '/overview' || endpoint === '/cost-overview') data = {};
    else if (endpoint === '/portal-users/stats/overview') data = { totalUsers: 1, activeUsers: 1, suspendedUsers: 0 };
    else if (endpoint === '/queues/stats') data = { queues: [{ ...row }] };
    else if (endpoint === '/creation-templates/insights') data = { items: [{ id: row._id, name: row.name, published: true, source: 'fixture', metrics: { copies: 2, creators: 1, startedProjects: 1, completedProjects: 1 } }], total: 1, totals: { copies: 2, startedProjects: 1, completedProjects: 1 }, computedAt: row.createdAt };
    else if (endpoint === '/creation-templates/funnel') data = { from: row.createdAt, to: row.updatedAt, counts: { template_view: 2, create_click: 1, quote_viewed: 1, take_selected: 1, download_started: 1 } };
    else if (endpoint.includes('notifications')) data = { ...data, unreadCount: 0 };
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 0, data }) });
  });
  return { errors, writes };
}
for (const width of [1920, 1366, 768, 390]) test(`all admin lists fit at ${width}px`, async ({ page }) => {
  test.setTimeout(180000); page.setDefaultTimeout(10000); await page.setViewportSize({ width, height: 1000 });
  const state = await fixtures(page); const measured = [];
  for (const path of paths) {
    console.log(`Layout check ${width}px ${path}`);
    await page.goto(path);
    if (path === '/queues') await page.locator('.ant-segmented-item').nth(1).click();
    await expect(page.locator('.admin-table-container').first(), path).toBeVisible();
    await expect(page.locator('.ant-table-row').first(), `fixture row on ${path}`).toBeVisible();
    await assertFit(page, path);
    if (path === '/account-pool' && width === 390) await expect(page.getByText(row.account_alias, { exact: true }).first()).toBeVisible();
    expect(state.errors, path).toEqual([]); measured.push({ path, width });
    if (path === '/model-routing-rules' || path === '/models') await page.screenshot({ path: `output/list-layout-${width}-${path.slice(1)}.png`, fullPage: true });
    if (path === '/queues') {
      await page.locator('.ant-table-row').first().getByText(row.queueName, { exact: true }).click();
      await expect(page.locator('.ant-table-expanded-row .ant-table-row').first()).toBeVisible();
      await assertFit(page, 'expanded queue');
    }
    if (path === '/provider-configs') {
      const manage = page.getByRole('button', { name: /管\s*理/ });
      if (!await manage.isVisible()) await page.getByRole('button', { name: '查看更多字段' }).first().click();
      await manage.click();
      const dialog = page.getByRole('dialog', { name: '账号池 — fixture' });
      await expect(dialog.locator('.ant-table-row').first()).toBeVisible();
      await assertFit(page, 'provider account modal');
      await dialog.getByRole('button', { name: /关闭|Close/ }).first().click();
      const fields = page.getByRole('dialog', { name: '更多字段' });
      if (await fields.isVisible()) await fields.getByRole('button', { name: /关闭|Close/ }).click();
    }
    if (path === '/model-routing-rules' && width === 390) {
      await page.getByRole('button', { name: '查看更多字段' }).first().click();
      const drawer = page.getByRole('dialog', { name: '更多字段' }); await expect(drawer).toBeVisible();
      await expect(drawer.getByText('apiKey', { exact: true })).toBeVisible();
      await drawer.getByRole('button', { name: /关闭|Close/ }).click();
    }
  }
  expect(state.writes).toEqual([]); await fs.writeFile(`output/list-layout-${width}.json`, JSON.stringify(measured));
});

async function assertFit(page, label) {
  await fitExpect.poll(async () => page.locator('.admin-table-container').evaluateAll(tables => tables.map(table => ({ width: table.clientWidth, overflow: [...table.querySelectorAll('.ant-table-content, .ant-table-body')].some(element => element.scrollWidth > element.clientWidth + 2) })).filter(table => table.overflow)), label).toEqual([]);
  await fitExpect.poll(async () => page.locator('.admin-page-content').evaluate(element => element.scrollWidth - element.clientWidth), `page width on ${label}`).toBeLessThanOrEqual(2);
  await fitExpect.poll(async () => page.locator('.ant-modal-body:visible, .ant-drawer-body:visible').evaluateAll(elements => elements.map(element => element.scrollWidth - element.clientWidth).filter(overflow => overflow > 2)), `dialog width on ${label}`).toEqual([]);
}

for (const width of [1920, 1366, 768, 390]) test(`editable and import lists fit at ${width}px`, async ({ page }) => {
  page.setDefaultTimeout(10000); await page.setViewportSize({ width, height: 1000 });
  const state = await fixtures(page); await page.goto('/models');
  await page.getByRole('button', { name: /^更多操作/ }).click();
  await page.getByRole('menuitem', { name: '定价' }).click();
  const pricing = page.getByRole('dialog', { name: /定价表/ });
  await expect(pricing.locator('.ant-table-row')).toBeVisible(); await assertFit(page, 'pricing modal');
  if (width < 1366) {
    await pricing.getByRole('button', { name: '查看更多字段' }).click();
    const fields = page.getByRole('dialog', { name: '更多字段' });
    if (width === 390) {
      const amount = fields.getByRole('spinbutton').first(); await expect(amount).toBeVisible();
      await amount.fill('2'); await amount.blur(); await expect(amount).toHaveValue('2');
    } else await expect(fields.getByText('参考收入（USD/张）', { exact: true })).toBeVisible();
    await fields.getByRole('button', { name: /关闭|Close/ }).click();
  }
  await pricing.getByRole('button', { name: /关闭|Close/ }).click();
  if (width === 390) await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  await page.getByRole('button', { name: '导入 JSON' }).click();
  const importing = page.getByRole('dialog', { name: '导入模型配置' });
  await importing.locator('input[type=file]').setInputFiles({ name: 'layout-fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ items: [row] })) });
  await importing.getByRole('button', { name: '校验并预览' }).click();
  await expect(importing.locator('.ant-table-row')).toBeVisible();
  await importing.locator('.ant-table-row-expand-icon').click();
  await expect(importing.locator('.ant-table-expanded-row')).toBeVisible(); await assertFit(page, 'expanded import preview');
  expect(state.errors).toEqual([]); expect(state.writes).toEqual(['/models/import/preview']);
});
