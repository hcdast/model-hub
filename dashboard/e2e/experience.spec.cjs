const { test, expect } = require('@playwright/test');

// Isolated browser fixtures. Every API call is intercepted; no model or wallet is touched.
async function fixtures(page, { billingStatus = 'refunded', role = 'super_admin', costFailure = false, staleCount = 0 } = {}) {
  const queries = [], writes = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(role => {
    localStorage.setItem('token', 'isolated-experience'); localStorage.setItem('username', 'fixture');
    localStorage.setItem('roles', JSON.stringify([role]));
    localStorage.setItem('permissions', JSON.stringify(role === 'super_admin' ? ['*'] : ['task:read', 'billing:read', 'provider:read', 'model:read', 'stats:read']));
    localStorage.setItem('menus', '["*"]');
  }, role);
  const model = { _id: '000000000000000000000001', model_id: 'supplier/very-long-model-identifier-for-tooltip', model_name: '语音模型完整名称', provider_model_name: 'supplier/tts', provider: 'supplier', model_type: 'tts', revision: 1, disabled: false, update_time: Date.now() };
  const bill = { status: billingStatus, billingPolicy: 'internal', usageType: 'count', usageMeasure: 'characters', estimatedUsage: 22, actualUsage: 0, estimatedCost: 0.22, actualCost: 0, unitPrice: 0.01, currency: 'credit' };
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(test.info().project.use.baseURL).origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const endpoint = url.pathname.replace('/api/v1/admin', '');
    if (route.request().method() !== 'GET') { writes.push(endpoint); return route.abort(); }
    queries.push({ endpoint, params: Object.fromEntries(url.searchParams) });
    let data = { items: [], total: 0 };
    if (endpoint === '/menu') data = [];
    else if (endpoint.includes('notifications')) data = { items: [], total: 0, unreadCount: 0 };
    else if (endpoint === '/overview') data = { today: { totalTasks: 0, successRate: 0 }, total: { totalTasks: 4, successRate: 75 }, queues: {} };
    else if (endpoint === '/cost-overview') {
      if (costFailure) return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
      data = { totalSpend: 0 };
    }
    else if (endpoint === '/stats/daily') data = { items: [], trend: [], total: 0 };
    else if (endpoint === '/models') data = { items: [model], total: 1 };
    else if (endpoint === '/tasks/fixture-task') data = { taskId: 'fixture-task', model: 'tts', provider: 'supplier', featureType: 'tts', status: 'FAILED', billing: bill, createdAt: '2026-11-04T12:00:00Z' };
    else if (endpoint === '/tasks/fixture-task/diagnostics') data = { taskId: 'fixture-task', status: 'FAILED', billing: bill, queue: { state: 'completed', lastError: 'Concurrent limit' }, submitFailures: [{ errorMsg: '供应商 HTTP 502' }], providerTaskId: null, updatedAt: '2026-11-04T12:00:00Z' };
    else if (endpoint.endsWith('/timeline')) data = { timeline: [] };
    else if (endpoint.endsWith('/timing')) data = { timing: {} };
    else if (endpoint === '/provider-health/overview') data = { items: [{ provider: 'supplier', circuitState: 'CLOSED', sampleCount: 0, windowDurationMs: 300000, successRate: 0, errorRate: 0 }] };
    else if (endpoint === '/tasks/failure-summary') data = { items: [{ provider: 'supplier', model: 'tts', errorCode: 'HTTP_502', count: 125 }], total: 125 };
    else if (endpoint === '/tasks') data = { items: [{ taskId: 'fixture-task', provider: 'supplier', model: 'tts', status: 'FAILED' }], total: 125, staleCount };
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 0, data }) });
  });
  return { queries, writes, errors };
}

test('overview distinguishes unavailable metrics and an empty day from zero success', async ({ page }) => {
  const state = await fixtures(page); await page.goto('/');
  await expect(page.getByText('暂未统计', { exact: true })).toHaveCount(2);
  await expect(page.getByText('暂无任务', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '失败聚合分析' })).toBeVisible();
  expect(state.errors).toEqual([]);
});

test('failed cost requests show an error instead of a real zero', async ({ page }) => {
  await fixtures(page, { costFailure: true }); await page.goto('/');
  await expect(page.getByText('成本数据加载失败，请稍后刷新')).toBeVisible();
  const cost = page.locator('.ant-card').filter({ hasText: '模型消耗' });
  await expect(cost).toContainText('—'); await expect(cost).not.toContainText('0.00');
});

test('TTS uses character units and refunded diagnosis hides repair and raw JSON by default', async ({ page }) => {
  const state = await fixtures(page); await page.goto('/tasks/fixture-task');
  await expect(page.getByText('22 字符', { exact: true })).toBeVisible();
  await expect(page.getByText('按字符', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '运行诊断' }).click();
  const dialog = page.getByRole('dialog', { name: '任务与队列、计费诊断' });
  await expect(dialog.getByText('任务已结束且已退款，无需重复修复。')).toBeVisible();
  await expect(dialog.getByText('供应商 HTTP 502', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '已核验失败后修复' })).toHaveCount(0);
  await expect(dialog.locator('pre')).toBeHidden();
  await dialog.getByText('原始诊断数据', { exact: true }).click();
  await expect(dialog.locator('pre')).toBeVisible();
  expect(state.writes).toEqual([]); expect(state.errors).toEqual([]);
});

test('outstanding reservations offer repair only with task and billing write permissions', async ({ page }) => {
  await fixtures(page, { billingStatus: 'pre_deducted' }); await page.goto('/tasks/fixture-task');
  await page.getByRole('button', { name: '运行诊断' }).click();
  await expect(page.getByRole('button', { name: '已核验失败后修复' })).toBeVisible();
});

test('read-only users cannot repair even an outstanding reservation', async ({ page }) => {
  await fixtures(page, { billingStatus: 'pre_deducted', role: 'viewer' }); await page.goto('/tasks/fixture-task');
  await page.getByRole('button', { name: '运行诊断' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: '已核验失败后修复' })).toHaveCount(0);
});

test('supplier state differentiates no samples from closed circuit and exposes the window', async ({ page }) => {
  await fixtures(page); await page.goto('/provider-health');
  await expect(page.getByText('最近 5 分钟 · 暂无样本', { exact: true })).toBeVisible();
  await expect(page.getByText('未熔断', { exact: true })).toBeVisible();
  await expect(page.locator('.ant-tag-green')).toHaveCount(0);
});

test('model actions are compact and optional columns can be shown', async ({ page }) => {
  const state = await fixtures(page); await page.goto('/models');
  await expect(page.getByText('语音模型完整名称', { exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '厂商模型标识' })).toHaveCount(0);
  await page.getByRole('button', { name: '显示列' }).click();
  await page.getByRole('checkbox', { name: '厂商模型标识' }).check();
  await page.getByRole('button', { name: '显示列' }).click();
  await expect(page.getByRole('columnheader', { name: '厂商模型标识' })).toBeVisible();
  await page.getByRole('button', { name: /^更多操作/ }).click();
  await expect(page.getByRole('menuitem', { name: '定价', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '删除', exact: true })).toBeVisible();
  expect(state.writes).toEqual([]); expect(state.errors).toEqual([]);
});

test('failure aggregation drilldown preserves provider, model and error filters', async ({ page }) => {
  const state = await fixtures(page); await page.goto('/tasks?view=failures');
  await expect(page.getByText('失败及超时聚合 · 共 125 个任务', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '查看任务', exact: true }).click();
  await expect(page).toHaveURL(/errorCode=HTTP_502/);
  await expect.poll(() => state.queries.filter(query => query.endpoint === '/tasks').at(-1)?.params).toMatchObject({ provider: 'supplier', model: 'tts', errorCode: 'HTTP_502', failureOnly: '1' });
  expect(state.writes).toEqual([]); expect(state.errors).toEqual([]);
});

test('stale task investigation leaves failure-only filters', async ({ page }) => {
  const state = await fixtures(page, { staleCount: 2 });
  await page.goto('/tasks?view=failures&failureOnly=1&errorCode=HTTP_502');
  await page.getByRole('button', { name: '查看待排查任务', exact: true }).click();
  await expect(page).toHaveURL(/staleMinutes=15/);
  await expect(page).not.toHaveURL(/view=|failureOnly=|errorCode=/);
  await expect(page.getByText(/失败及超时聚合/)).toHaveCount(0);
  await expect.poll(() => state.queries.filter(query => query.endpoint === '/tasks').at(-1)?.params.staleMinutes).toBe('15');
});

for (const width of [390, 1366, 1920]) test(`model layout keeps its names and actions within ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await fixtures(page); await page.goto('/models');
  await expect(page.getByText('语音模型完整名称', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^更多操作/ })).toBeVisible();
  await expect.poll(() => page.locator('.ant-table-content').first().evaluate(element => element.scrollWidth <= element.clientWidth + 2)).toBe(true);
});
