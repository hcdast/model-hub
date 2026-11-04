const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');

// These are API fixtures, not production accounts. No request can reach a model, wallet or external notification.
const read = ['model:read', 'provider:read', 'billing:read', 'notification:read', 'task:read', 'stats:read'];
const permissions = { viewer: read, editor: [...read, 'model:update', 'model:create', 'provider:update', 'notification:update'], super_admin: ['*'] };
const base = { _id: '000000000000000000000001', model_id: 'fixture/image', provider_model_name: 'fixture/image', model_name: '回归测试模型', provider: 'fixture', model_type: 'textToImage', disabled: false, revision: 1, draft_revision: 0, tags: [],
  params: { prompt: { type: 'string', required: true, default: 'test' } }, unit_price_map: { default: { unit_credit: 1, cost_unit_price: 1, sale_unit_price: 1 } }, history: [] };
async function fixture(page, role) {
  const state = { model: structuredClone(base), writes: [], unexpected: [], conflict: false, deleteBlocked: true };
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:7332') { if (!['https://fonts.googleapis.com', 'https://fonts.gstatic.com'].includes(url.origin)) state.unexpected.push(url.origin); return route.abort(); }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const endpoint = url.pathname.replace('/api/v1/admin', ''), method = request.method();
    const send = (data, code = 0, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ code, ...(code ? { message: data } : { data }) }) });
    if (endpoint === '/auth/login') return send({ accessToken: `fixture-${role}`, roles: [role], permissions: permissions[role], menus: ['*'] });
    if (endpoint === '/menu') return send([]);
    if (endpoint.includes('/notifications')) return send({ items: [], total: 0, unreadCount: 0 });
    if (endpoint === '/tasks') return send({ items: [], total: 0 });
    if (endpoint === '/stats/daily') return send({ items: [], total: 0, trend: [{ date: '2026-11-02', totalCount: 4, successCount: 3, failedCount: 1, timeoutCount: 0, cancelledCount: 0 }, { date: '2026-11-03', totalCount: 10, successCount: 9, failedCount: 1, timeoutCount: 0, cancelledCount: 0 }], summary: { totalCount: 10, successCount: 9, failedCount: 1 } });
    if (endpoint === '/overview' || endpoint === '/cost-overview') return send({});
    if (endpoint === '/models' && method === 'GET') return send({ items: [state.model], total: 1 });
    if (endpoint === '/models/detail') return send(state.model);
    if (endpoint === '/provider-configs' && method === 'GET') return send({ items: [{ provider_name: 'fixture', enabled: false, revision: 1, base_url: 'https://example.invalid', limits: { maxConcurrent: 10, maxPerSecond: 5 }, poll_limits: { max_per_second: 5 } }], available_providers: ['fixture'] });
    if (endpoint === '/account-pool') return send({ items: [], total: 0 });
    if (endpoint === '/billing/records') return send({ items: [{ _id: 'bill', taskId: 'browser-task', clientName: '测试客户', maskedKey: 'test***', model: 'fixture/image', provider: 'fixture', usageType: 'count', estimatedCost: 1, actualCost: 1, currency: 'credit', billingPolicy: 'internal', status: 'settled', createdAt: new Date().toISOString() }], total: 125 });
    if (endpoint === '/billing/summary') return send({ items: [] });
    if (method === 'GET') { state.unexpected.push(endpoint); return send({ items: [], total: 0 }); }
    const body = request.postDataJSON(); state.writes.push({ endpoint, method, body });
    if (endpoint === '/models/toggle') return send('配置已在另一窗口更新，请刷新后重试', 1001);
    if (endpoint === '/models/import/preview') return send({ planId: 'preview-fixture', excluded: 2, rows: [{ config: state.model, action: 'update', errors: [], warnings: [], diff: { model_name: { before: '旧', after: '新' } } }] });
    if (endpoint === '/models/import/commit') return send({ success: 1, failed: 0, results: [] });
    if (endpoint === `/models/${base._id}/draft`) {
      if (state.conflict) return send('配置已在另一窗口更新，草稿未覆盖', 1001);
      state.model.draft = body.config; state.model.draft_revision++; return send(state.model);
    }
    if (endpoint.endsWith('/publish')) {
      state.model.history.push({ revision: state.model.revision, saved_at: new Date().toISOString(), config: structuredClone(base) });
      state.model = { ...state.model, ...state.model.draft, revision: state.model.revision + 1, draft: undefined }; return send(state.model);
    }
    if (endpoint.endsWith('/rollback')) { state.model = { ...state.model, ...structuredClone(base), revision: state.model.revision + 1 }; return send(state.model); }
    if (endpoint === '/provider-configs/fixture' && method === 'DELETE') return send('仍有关联模型，不能删除供应商配置', 1001);
    if (endpoint === '/billing/records/export') return send({ total: 125, csv: 'taskId,clientName\r\n' + Array.from({ length: 125 }, (_, i) => `task-${i},fixture`).join('\r\n') });
    state.unexpected.push(`${method} ${endpoint}`); return send('未定义的隔离测试请求', 1001);
  });
  const errors = []; page.on('pageerror', error => errors.push(error.message)); state.errors = errors;
  await page.goto('/login'); await page.getByPlaceholder('用户名').fill(role); await page.getByPlaceholder('密码', { exact: true }).fill('Fixture-only-password1');
  await page.getByRole('button', { name: '登 录' }).click(); await expect(page).toHaveURL('http://127.0.0.1:7332/');
  await page.goto('/models'); await expect(page.getByText('回归测试模型', { exact: true })).toBeVisible();
  return state;
}

for (const role of ['viewer', 'editor', 'super_admin']) test(`${role}: login, model and supplier permissions`, async ({ page }) => {
  const state = await fixture(page, role);
  const row = page.locator('tr').filter({ hasText: '回归测试模型' });
  await expect(row.getByRole('button', { name: /编\s*辑/  })).toBeEnabled({ enabled: role !== 'viewer' });
  await expect(row.getByRole('switch')).toBeEnabled({ enabled: role !== 'viewer' });
  await expect(row.getByRole('button', { name: /删\s*除/  })).toHaveCount(role === 'super_admin' ? 1 : 0);
  await page.goto('/provider-configs'); const supplier = page.locator('tr').filter({ hasText: 'https://example.invalid' });
  await expect(supplier.getByRole('button', { name: /编\s*辑/  })).toBeEnabled({ enabled: role !== 'viewer' });
  await expect(supplier.getByRole('button', { name: /删\s*除/  })).toBeEnabled({ enabled: role === 'super_admin' });
  if (role === 'viewer') { await page.goto(`/models/edit/${base._id}`); await expect(page.getByText('抱歉，您没有权限访问此页面。')).toBeVisible(); }
  expect(state.writes).toHaveLength(0); expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});

test('business failure is visible and does not report a successful toggle', async ({ page }) => {
  const state = await fixture(page, 'editor'); await page.locator('tr').filter({ hasText: '回归测试模型' }).getByRole('switch').click();
  await expect(page.getByText('配置已在另一窗口更新，请刷新后重试', { exact: false })).toBeVisible();
  await expect(page.getByText('已禁用', { exact: true })).toHaveCount(0);
  expect(state.writes[0].body.expected_revision).toBe(1); expect(state.model.disabled).toBe(false);
});

test('import requires preview; changing options invalidates it before commit', async ({ page }) => {
  const state = await fixture(page, 'editor'); await page.getByRole('button', { name: '导入 JSON' }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ items: [] })) });
  await page.getByRole('button', { name: '校验并预览' }).click(); await expect(page.getByRole('button', { name: '提交有效记录' })).toBeEnabled();
  expect(state.writes.map(x => x.endpoint)).toEqual(['/models/import/preview']);
  await page.getByRole('checkbox', { name: '仅 MaaS', exact: false }).uncheck(); await expect(page.getByRole('button', { name: '提交有效记录' })).toHaveCount(0);
  await page.getByRole('button', { name: '校验并预览' }).click(); await page.getByRole('button', { name: '提交有效记录' }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: '提交已预览的有效记录？' }); await dialog.getByRole('button', { name: /确.*定/ }).click();
  await expect(page.getByText('导入完成：成功 1，失败 0')).toBeVisible(); expect(state.writes.at(-1).body).toEqual({ planId: 'preview-fixture' });
});

test('supplier dependency rejection stays visible and preserves the row', async ({ page }) => {
  const state = await fixture(page, 'super_admin'); await page.goto('/provider-configs');
  await page.locator('tr').filter({ hasText: 'https://example.invalid' }).getByRole('button', { name: /删\s*除/  }).click();
  await page.getByRole('dialog').getByRole('button', { name: /删\s*除/  }).click();
  await expect(page.getByText('仍有关联模型，不能删除供应商配置', { exact: false })).toBeVisible();
  await expect(page.getByText('https://example.invalid', { exact: true })).toBeVisible(); expect(state.writes).toHaveLength(1);
});

test('all-filtered billing export downloads 125 rows rather than the current page', async ({ page }) => {
  const state = await fixture(page, 'viewer'); await page.goto('/billing/records?model=fixture%2Fimage');
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '导出全部筛选结果 CSV' }).click();
  const file = await download; const csv = await fs.readFile(await file.path(), 'utf8');
  expect(csv.trim().split(/\r?\n/)).toHaveLength(126); expect(state.writes.at(-1).endpoint).toBe('/billing/records/export');
});

test('draft conflicts retain edits; publishing and rollback send expected revisions', async ({ page }) => {
  const state = await fixture(page, 'editor'); await page.getByRole('button', { name: /编\s*辑/  }).click();
  const name = page.getByRole('textbox', { name: /model_name（展示名称）/ }); await name.fill('浏览器编辑草稿');
  state.conflict = true; await page.getByRole('button', { name: /^(?:loading )?保存草稿$/ }).click();
  await expect(page.getByText('配置已在另一窗口更新，草稿未覆盖', { exact: false })).toBeVisible(); await expect(name).toHaveValue('浏览器编辑草稿'); await expect(page.getByRole('button', { name: /^(?:loading )?保存草稿$/ })).not.toHaveClass(/ant-btn-loading/);
  state.conflict = false; await page.getByRole('button', { name: /^(?:loading )?保存草稿$/ }).click();
  await expect(page.getByText('草稿已保存，活动配置未改变')).toBeVisible(); expect(state.model.model_name).toBe(base.model_name);
  await page.getByRole('button', { name: '发布已保存草稿' }).click(); await page.getByRole('dialog').getByRole('button', { name: /确.*定/ }).click();
  await expect(page.getByText('已发布', { exact: true })).toBeVisible(); expect(state.model.revision).toBe(2);
  await page.getByRole('button', { name: '历史版本与差异' }).click();
  await page.getByRole('dialog').getByRole('combobox').click(); await page.getByText(/^版本 1 ·/).click();
  await page.getByRole('button', { name: '预览并回滚' }).click(); await page.getByRole('dialog').filter({ hasText: '回滚到版本 1：立即生效' }).getByRole('button', { name: /确.*定/ }).click();
  await expect(page.getByText('已回滚', { exact: true })).toBeVisible();
  expect(state.writes.at(-1).body).toMatchObject({ expected_revision: 2, target_revision: 1 }); expect(state.errors).toEqual([]);
});


test('tree-shaken chart modules render the statistics trend', async ({ page }) => {
  const state = await fixture(page, 'viewer'); await page.goto('/stats');
  await expect(page.getByRole('heading', { name: '统计报表' })).toBeVisible();
  const canvas = page.locator('.echarts-for-react canvas').first(); await expect(canvas).toBeVisible();
  expect(await canvas.getAttribute('width')).not.toBe('0');
  await expect.poll(() => canvas.evaluate(element => {
    const pixels = element.getContext('2d').getImageData(0, 70, element.width, element.height - 100).data;
    let colored = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] && Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) - Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) > 60) colored++;
    return colored;
  })).toBeGreaterThan(150);
  await page.screenshot({ path: 'output/admin-browser-chart.png', fullPage: true });
  expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});
