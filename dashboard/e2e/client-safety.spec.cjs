const { test, expect } = require('@playwright/test');
const client = { id: '000000000000000000000001', apiKey: 'mh_***test', name: '测试应用', source: 'admin', revision: 4, enabled: true, plainCredentialOnly: true, defaultPriority: 50, billingPolicy: 'internal', rateLimits: { maxQps: 10, maxConcurrent: 50, maxDailyRequests: 10000 }, modelAllowlist: ['keep/*'] };
async function fixture(page) {
  const state = { requests: [], errors: [], listGate: null, modelGate: null, writeGate: null, conflict: false, modelsFail: false, usageFail: true };
  await page.addInitScript(() => {
    if (sessionStorage.getItem('client-fixture')) return;
    sessionStorage.setItem('client-fixture', '1'); localStorage.setItem('token', 'fixture'); localStorage.setItem('username', 'fixture');
    localStorage.setItem('roles', '["super_admin"]'); localStorage.setItem('permissions', '["*"]'); localStorage.setItem('menus', '["*"]');
  });
  page.on('pageerror', error => state.errors.push(error.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(test.info().project.use.baseURL).origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const endpoint = url.pathname.replace('/api/v1/admin', ''), method = route.request().method();
    const body = method === 'GET' ? null : route.request().postDataJSON();
    state.requests.push({ endpoint, method, body, params: Object.fromEntries(url.searchParams) });
    let data = { items: [], total: 0 };
    if (method !== 'GET') {
      if (state.writeGate) await state.writeGate;
      if (state.conflict) return route.fulfill({ status: 409, json: { message: '配置已被其他管理员修改' } });
      return route.fulfill({ json: { code: 0, data: {} } });
    }
    if (endpoint === '/menu') data = [{ key: 'access', label: '应用与用户', children: [{ key: 'apps', label: '应用管理', path: '/api-clients' }, { key: 'users', label: '用户管理', path: '/users' }] }];
    else if (endpoint === '/api-clients') {
      const p = Number(url.searchParams.get('page') || 1);
      data = { items: [{ ...client, name: p === 1 ? client.name : `第${p}页应用` }], total: 60, page: p, pageSize: 20 };
      if (p === 2 && state.listGate) { void state.listGate.then(() => route.fulfill({ json: { code: 0, data } })).catch(() => {}); return; }
    } else if (endpoint === `/api-clients/${client.id}`) data = { ...client, revision: 5, defaultPriority: 12 };
    else if (endpoint === '/api-clients/usage/summary') data = [];
    else if (endpoint.endsWith('/usage')) {
      if (state.usageFail) return route.fulfill({ status: 503, json: { message: 'unavailable' } });
      data = [];
    } else if (endpoint === '/models') {
      if (state.modelsFail) return route.fulfill({ status: 503, json: { message: 'unavailable' } });
      const type = url.searchParams.get('model_type'), p = Number(url.searchParams.get('page'));
      data = type ? { items: [{ model_id: type === 'textToImage' ? 'old-filter-model' : 'new-filter-model' }], total: 1 }
        : { items: Array.from({ length: p === 1 ? 100 : 51 }, (_, i) => ({ model_id: `model-${(p - 1) * 100 + i + 1}` })), total: 151 };
      if (type === 'textToImage' && state.modelGate) { void state.modelGate.then(() => route.fulfill({ json: { code: 0, data } })).catch(() => {}); return; }
    } else if (endpoint === '/roles') data = [{ name: 'editor', displayName: '编辑角色', permissions: [], menus: [] }];
    else if (endpoint === '/permissions') data = [{ code: 'task:read', resource: 'task', action: 'read', displayName: '读取任务', module: 'task' }];
    else if (['/menus', '/menus/flat'].includes(endpoint)) data = [{ key: 'tasks', label: '任务菜单', path: '/tasks', icon: 'AppstoreOutlined', sortOrder: 0, associatedPermissions: ['task:read'], enabled: true, children: [] }];
    else if (endpoint === '/users') data = { users: [{ _id: client.id, username: 'fixture-user', displayName: '测试用户', email: '', roles: ['editor'], enabled: true }], pagination: { page: 1, limit: 20, total: 1 } };
    return route.fulfill({ json: { code: 0, data } });
  });
  return state;
}
const ok = dialog => dialog.getByRole('button', { name: /^确\s*定$/ });
const writeRequests = state => state.requests.filter(r => r.method !== 'GET');
async function openEditor(page, button, title) {
  await page.getByRole('row').filter({ hasText: client.name }).getByRole('button', { name: new RegExp(`${button}$`) }).click();
  return page.getByRole('dialog', { name: title });
}

test('allowlist includes models beyond 100 and preserves custom patterns', async ({ page }) => {
  const state = await fixture(page); await page.goto('/api-clients');
  const dialog = await openEditor(page, '白名单', /编辑模型白名单/);
  await expect.poll(() => state.requests.filter(r => r.endpoint === '/models').length).toBe(2);
  const input = dialog.getByRole('combobox').last(); await input.fill('model-151');
  await page.getByTitle('model-151', { exact: true }).click(); await ok(dialog).click();
  await expect(dialog).toHaveCount(0);
  expect(writeRequests(state)[0].body).toEqual({ modelAllowlist: ['keep/*', 'model-151'], expected_revision: 4 });
  expect(state.errors).toEqual([]);
});

test('allowlist rejects obsolete filter responses and recovers visibly from loading errors', async ({ page }) => {
  const state = await fixture(page); await page.goto('/api-clients');
  const dialog = await openEditor(page, '白名单', /编辑模型白名单/);
  await expect.poll(() => state.requests.filter(r => r.endpoint === '/models').length).toBe(2);
  let release; state.modelGate = new Promise(resolve => { release = resolve; });
  const filter = dialog.getByRole('combobox').first();
  await filter.click(); await page.getByText('文生图 (textToImage)', { exact: true }).click();
  await expect.poll(() => state.requests.some(r => r.params.model_type === 'textToImage')).toBe(true);
  const filterBox = dialog.locator('.ant-select').first();
  await expect(filterBox).not.toHaveClass(/ant-select-open/);
  await filterBox.locator('.ant-select-selector').click();
  await expect(filterBox).toHaveClass(/ant-select-open/);
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option[title="图生图 (imageToImage)"]').click();
  await expect.poll(() => state.requests.some(r => r.params.model_type === 'imageToImage')).toBe(true);
  release(); await dialog.getByRole('combobox').last().fill('filter-model');
  await expect(page.getByTitle('new-filter-model', { exact: true })).toBeVisible(); await expect(page.getByTitle('old-filter-model', { exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape'); state.modelsFail = true;
  await filterBox.locator('.ant-select-selector').click(); await page.getByText('文生视频 (textToVideo)', { exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('模型候选加载失败');
  await expect(dialog).toContainText('keep/*'); state.modelsFail = false;
  await dialog.getByRole('button', { name: /^重\s*试$/ }).click(); await expect(dialog.getByRole('alert')).toHaveCount(0);
});

test('a delayed second page cannot replace the third page', async ({ page }) => {
  const state = await fixture(page); await page.goto('/api-clients'); await expect(page.getByText(client.name, { exact: true })).toBeVisible();
  let release; state.listGate = new Promise(resolve => { release = resolve; });
  await page.locator('.ant-pagination-item-2').click(); await expect.poll(() => state.requests.some(r => r.endpoint === '/api-clients' && r.params.page === '2')).toBe(true);
  await page.locator('.ant-pagination-item-3').press('Enter'); await expect(page.getByText('第3页应用', { exact: true })).toBeVisible();
  release(); await expect(page.locator('.ant-pagination-item-active')).toHaveText('3'); await expect(page.getByText('第2页应用', { exact: true })).toHaveCount(0);
});

test('conflicts preserve input and require reviewing the new version before resubmission', async ({ page }) => {
  const state = await fixture(page); state.conflict = true; await page.goto('/api-clients');
  const dialog = await openEditor(page, '优先级', '编辑默认优先级'); await dialog.getByRole('spinbutton').fill('25'); await ok(dialog).click();
  await expect(dialog.getByRole('alert')).toContainText('当前输入已保留'); await expect(dialog.getByRole('spinbutton')).toHaveValue('25');
  await expect(dialog).not.toHaveClass(/ant-zoom/);
  await page.screenshot({ path: 'output/admin-client-conflict.png', clip: { x: 0, y: 0, width: 1440, height: 520 } });
  await dialog.getByRole('button', { name: '查看最新配置' }).click(); const review = page.getByRole('dialog', { name: '对比最新配置' });
  await expect(review).toContainText('25'); await expect(review).toContainText('12');
  await review.getByRole('button', { name: '保留当前输入' }).click(); await expect(dialog.getByRole('spinbutton')).toHaveValue('25');
  await dialog.getByRole('button', { name: '查看最新配置' }).click(); await page.getByRole('dialog', { name: '对比最新配置' }).getByRole('button', { name: '加载最新配置' }).click();
  await expect(dialog.getByRole('spinbutton')).toHaveValue('12'); state.conflict = false; await dialog.getByRole('spinbutton').fill('30'); await ok(dialog).click();
  await expect(dialog).toHaveCount(0); expect(writeRequests(state).map(r => r.body)).toEqual([{ defaultPriority: 25, expected_revision: 4 }, { defaultPriority: 30, expected_revision: 5 }]);
});

test('saving blocks repeated submission and closing while a request is pending', async ({ page }) => {
  const state = await fixture(page); await page.goto('/api-clients'); let release; state.writeGate = new Promise(resolve => { release = resolve; });
  const dialog = await openEditor(page, '限流', /编辑限流配置/); await dialog.getByRole('spinbutton').first().fill('20');
  await ok(dialog).dblclick(); await expect.poll(() => writeRequests(state).length).toBe(1);
  await expect(dialog.getByRole('spinbutton').first()).toBeDisabled(); await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
  release(); await expect(dialog).toHaveCount(0); expect(writeRequests(state)[0].body.expected_revision).toBe(4);
});

test('usage failure is distinct from empty data and supports retry', async ({ page }) => {
  const state = await fixture(page); await page.goto('/api-clients');
  const dialog = await openEditor(page, '用量', /用量趋势/); await expect(dialog.getByRole('alert')).toContainText('用量数据加载失败');
  await expect(dialog.locator('canvas')).toHaveCount(0); state.usageFail = false; await dialog.getByRole('button', { name: /^重\s*试$/ }).click();
  await expect(dialog).toContainText('该时段暂无用量记录'); await expect(dialog.getByRole('alert')).toHaveCount(0);
});

for (const [path, title, field] of [['/users', '新建用户', '用户名'], ['/roles', '新建角色', '角色名'], ['/menus', '新建菜单', '菜单标识']]) test(`${path} protects unsaved modal changes`, async ({ page }) => {
  const state = await fixture(page); await page.goto(path); await page.getByRole('button', { name: /新建/, exact: false }).first().click();
  const dialog = page.getByRole('dialog', { name: title }); await dialog.getByLabel(field, { exact: true }).fill('unsaved');
  await page.keyboard.press('Escape'); const confirm = page.getByRole('dialog', { name: '放弃未保存的修改？' }); await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: '继续编辑' }).click(); await expect(dialog.getByLabel(field, { exact: true })).toHaveValue('unsaved');
  await dialog.getByRole('button', { name: /取\s*消/ }).click(); await page.getByRole('dialog', { name: '放弃未保存的修改？' }).getByRole('button', { name: '放弃修改' }).click(); await expect(dialog).toHaveCount(0);
  expect(writeRequests(state)).toEqual([]); expect(state.errors).toEqual([]);
});

test('browser back preserves an edited client dialog when leaving is canceled', async ({ page }) => {
  await fixture(page); await page.goto('/users'); await page.getByRole('menuitem', { name: '应用管理', exact: true }).click();
  const dialog = await openEditor(page, '优先级', '编辑默认优先级'); await dialog.getByRole('spinbutton').fill('21');
  await page.goBack(); const confirmation = page.getByRole('dialog', { name: '确认离开', exact: true }); await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: '继续编辑' }).click(); await expect(page).toHaveURL(/\/api-clients$/); await expect(dialog.getByRole('spinbutton')).toHaveValue('21');
});

test('role menu selections alone trigger unsaved protection and pristine forms close directly', async ({ page }) => {
  await fixture(page); await page.goto('/roles'); await page.getByRole('button', { name: /新建/ }).first().click();
  let dialog = page.getByRole('dialog', { name: '新建角色' }); await dialog.getByRole('button', { name: /取\s*消/ }).click(); await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: /新建/ }).first().click(); dialog = page.getByRole('dialog', { name: '新建角色' });
  await dialog.locator('.ant-tree-checkbox').first().click(); await dialog.getByRole('button', { name: /取\s*消/ }).click();
  await expect(page.getByRole('dialog', { name: '放弃未保存的修改？' })).toBeVisible();
});

test('corrupted authentication storage returns to a usable login page', async ({ page }) => {
  await fixture(page); await page.addInitScript(() => localStorage.setItem('roles', '{invalid-json'));
  await page.goto('/api-clients'); await expect(page.getByRole('heading', { name: 'Model-Hub 管理后台' })).toBeVisible(); await expect(page).toHaveURL(/\/login\?returnTo=/);
});

test('logging out in another tab updates the active tab immediately', async ({ page, context }) => {
  await fixture(page); await page.goto('/api-clients'); const other = await context.newPage(); await fixture(other); await other.goto('/api-clients');
  await other.evaluate(() => localStorage.clear()); await expect(page).toHaveURL(/\/login\?returnTo=/); await expect(page.getByRole('button', { name: /登\s*录/ })).toBeVisible();
});
