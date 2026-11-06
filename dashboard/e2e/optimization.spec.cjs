const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const row = { _id: '000000000000000000000001', model_id: 'fixture-tts', model_name: '语音计费测试', provider: 'fixture', model_type: 'tts', revision: 1,
  pricing: { usage_type: 'count', usage_measure: 'characters' }, unit_price_map: { default: { unit_credit: 0.01, original_unit_credit: 0.02, cost_unit_price: 0.0001, sale_unit_price: 0.03 } }, update_time: 1793880000000 };
async function fixtures(page) {
  const state = { writes: [], queries: [], fail: '', previewGate: null, saveGate: null, errors: [] };
  page.on('pageerror', e => state.errors.push(e.message));
  await page.addInitScript(() => { localStorage.setItem('token', 'fixture'); localStorage.setItem('username', 'fixture'); localStorage.setItem('roles', '["super_admin"]'); localStorage.setItem('permissions', '["*"]'); localStorage.setItem('menus', '["*"]'); });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(test.info().project.use.baseURL).origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const endpoint = url.pathname.replace('/api/v1/admin', '');
    const method = route.request().method();
    if (method !== 'GET') {
      state.writes.push({ endpoint, method, body: route.request().postDataJSON() });
      if (endpoint === '/model-routing-rules' && method === 'POST') {
        if (state.saveGate) await state.saveGate;
        return route.fulfill({ status: 400, json: { message: '模型已有规则，请编辑现有规则' } });
      }
      if (endpoint === '/models/import/preview') {
        if (state.previewGate) await state.previewGate;
        return route.fulfill({ json: { code: 0, data: { planId: 'preview-plan', excluded: 0, rows: [{ config: row, action: 'create', errors: [], warnings: [], diff: {} }] } } });
      }
      return route.abort();
    }
    state.queries.push({ endpoint, params: Object.fromEntries(url.searchParams) });
    if (state.fail === endpoint) return route.fulfill({ status: 500, json: { message: 'fixture request failure' } });
    let data = { items: [], total: 0 };
    if (endpoint === '/menu') data = [];
    else if (endpoint === '/models') data = { items: [row], total: 1 };
    else if (endpoint === '/models/detail') data = row;
    else if (endpoint === '/models/export') data = { version: 2, exported_at: new Date().toISOString(), items: [row], total: 1 };
    else if (endpoint === '/provider-configs') data = { items: [{ provider_name: 'fixture' }], total: 1 };
    else if (endpoint === '/model-routing-rules') data = { items: [{ ...row, model_id: 'existing-model', apiKey: 'client-a', enabled: true, strategy_type: 'fixed', fixed_provider: 'fixture' }], total: 1 };
    else if (endpoint === '/tasks') data = { items: [{ taskId: 'fixture-task', model: row.model_id, provider: 'fixture', status: 'SUCCESS', priority: 50, createdAt: '2026-11-05T12:00:00Z' }], total: 1 };
    else if (endpoint === '/billing/summary') data = [];
    else if (endpoint === '/stats/daily') data = { items: [], total: 0, trend: [], summary: { totalCount: 0, successCount: 0, failedCount: 0 } };
    return route.fulfill({ json: { code: 0, data } });
  });
  return state;
}
async function newRoute(page) {
  await page.goto('/model-routing-rules'); await page.getByRole('button', { name: '新建规则' }).click();
  return page.getByRole('dialog', { name: '新建路由策略', exact: true });
}
async function fillRoute(dialog) {
  await dialog.getByLabel('model_id', { exact: true }).fill('existing-model');
  await dialog.getByRole('combobox', { name: /fixed_provider/ }).click();
  await dialog.getByRole('combobox', { name: /fixed_provider/ }).press('Enter');
}
test('creating an existing model never silently updates another client rule; saving is locked', async ({ page }) => {
  const state = await fixtures(page); let release; state.saveGate = new Promise(resolve => release = resolve);
  const dialog = await newRoute(page); await fillRoute(dialog);
  await dialog.getByRole('button', { name: /^保\s*存$/ }).click({ clickCount: 2 });
  await expect.poll(() => state.writes.length).toBe(1);
  await expect(dialog.getByRole('button', { name: /^取\s*消$/ })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Close' })).toHaveCount(0);
  release(); await expect(page.getByText('模型已有规则，请编辑现有规则', { exact: true })).toBeVisible();
  await expect(dialog).toBeVisible(); expect(state.writes[0].method).toBe('POST'); expect(state.errors).toEqual([]);
});
test('route close asks before discarding edits and allows continuing', async ({ page }) => {
  await fixtures(page); const dialog = await newRoute(page);
  await dialog.getByLabel('model_id', { exact: true }).fill('unsaved'); await dialog.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click(); await expect(dialog.getByLabel('model_id', { exact: true })).toHaveValue('unsaved');
  await dialog.getByRole('button', { name: /^取\s*消$/ }).click(); await page.getByRole('button', { name: '放弃修改', exact: true }).click(); await expect(dialog).toHaveCount(0);
});
test('TTS pricing uses characters and precise dollar references with dirty close protection', async ({ page }) => {
  const state = await fixtures(page); await page.goto('/models'); await page.getByRole('button', { name: /^更多操作/ }).click(); await page.getByRole('menuitem', { name: '定价', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /定价表/ });
  await expect(dialog).toHaveAccessibleName(/按字符/); await expect(dialog).not.toContainText('图片类'); await expect(dialog).not.toContainText('每张成本');
  await expect(dialog.getByText('0.0003', { exact: true })).toBeVisible(); await expect(dialog).toContainText('credits/字符');
  await dialog.getByRole('spinbutton').first().fill('0.0002'); await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog', { name: '放弃未保存的修改？', exact: true })).toBeVisible(); await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(dialog.getByRole('spinbutton').first()).toHaveValue('0.0002'); expect(state.writes).toEqual([]);
});
test('import locks inputs during preview, invalidates changed options, and resets on reopen', async ({ page }) => {
  const state = await fixtures(page); let release; state.previewGate = new Promise(resolve => release = resolve);
  await page.goto('/models'); await page.getByRole('button', { name: '导入 JSON', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导入模型配置', exact: true });
  await dialog.locator('input[type=file]').setInputFiles({ name: 'fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ items: [row] })) });
  await dialog.getByRole('button', { name: '校验并预览' }).click();
  await expect(dialog.getByRole('checkbox')).toBeDisabled(); await expect(dialog.getByRole('combobox')).toBeDisabled(); await expect(dialog.locator('input[type=file]')).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Close' })).toHaveCount(0); release();
  await expect(dialog.getByRole('button', { name: '提交有效记录' })).toBeEnabled(); await dialog.getByRole('checkbox').uncheck();
  await expect(dialog.getByRole('button', { name: '提交有效记录' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close' }).click(); await page.getByRole('button', { name: '导入 JSON', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '校验并预览' })).toBeDisabled(); expect(state.writes.map(r => r.endpoint)).toEqual(['/models/import/preview']);
});
test('task layout keeps investigation fields, folds advanced filters and resets visible conditions', async ({ page }) => {
  await page.setViewportSize({ width: 1074, height: 1000 }); await fixtures(page); await page.goto('/tasks?model=fixture-tts');
  await expect(page.getByRole('columnheader', { name: '模型 / 供应商', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '创建时间', exact: true })).toBeVisible(); await expect(page.getByRole('columnheader', { name: '优先级', exact: true })).toHaveCount(0);
  await expect(page.getByPlaceholder('精确错误码')).toBeHidden(); await expect(page.getByText('模型：fixture-tts', { exact: true })).toBeVisible();
  await expect(page.getByText('任务详情', { exact: true })).toBeVisible(); await page.getByRole('button', { name: '重置筛选' }).click(); await expect(page).not.toHaveURL(/model=/);
});
for (const [path, endpoint] of [['/tasks', '/tasks'], ['/models', '/models'], ['/stats', '/stats/daily'], ['/billing/records', '/billing/records']]) test(`request errors distinguish empty and stale data on ${path}`, async ({ page }) => {
  const state = await fixtures(page); state.fail = endpoint; await page.goto(path);
  await expect(page.getByText('数据加载失败，请重试', { exact: true })).toBeVisible();
  state.fail = ''; await page.getByRole('button', { name: /^重\s*试$/ }).click(); await expect(page.getByText('数据加载失败，请重试', { exact: true })).toHaveCount(0);
  state.fail = endpoint; await page.getByRole('button', { name: /^(?:reload\s+)?刷\s*新(?:全部)?$/ }).click(); await expect(page.getByText('刷新失败，当前显示上次成功加载的数据', { exact: true })).toBeVisible();
});
test('billing filter controls restore URL parameters and clear them together', async ({ page }) => {
  await fixtures(page); await page.goto('/billing/records?apiKey=fixture-key&model=fixture-tts&billingPolicy=internal&status=refunded&taskId=task-one&startDate=2026-11-01T00%3A00%3A00Z&endDate=2026-11-05T00%3A00%3A00Z');
  await expect(page.getByPlaceholder('API Key', { exact: true })).toHaveValue('fixture-key'); await expect(page.getByPlaceholder('模型名称')).toHaveValue('fixture-tts');
  await expect(page.getByPlaceholder('任务 ID 精确查询')).toHaveValue('task-one'); await expect(page.locator('.ant-select-selection-item').filter({ hasText: '已退款' })).toBeVisible();
  await page.reload(); await expect(page.getByPlaceholder('模型名称')).toHaveValue('fixture-tts');
  await page.getByRole('button', { name: '重置筛选' }).click(); await expect(page).not.toHaveURL(/model=|status=|apiKey=|taskId=|startDate=/); await expect(page.getByPlaceholder('API Key', { exact: true })).toHaveValue('');
});
test('model download uses the filtered export endpoint instead of walking pages', async ({ page }) => {
  const state = await fixtures(page); await page.goto('/models?provider=fixture&status=enabled&keyword=voice');
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '导出全部筛选结果' }).click();
  const body = JSON.parse(await fs.readFile(await (await download).path(), 'utf8'));
  expect(body.total).toBe(1); expect(state.queries.find(q => q.endpoint === '/models/export').params).toMatchObject({ provider: 'fixture', status: 'enabled', keyword: 'voice' });
  expect(state.queries.filter(q => q.endpoint === '/models')).toHaveLength(1); expect(state.writes).toEqual([]);
});
