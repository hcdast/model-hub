const { test, expect } = require('@playwright/test');
const model = { _id: '000000000000000000000001', model_id: 'model-one', model_name: '模型一', provider: 'fixture', model_type: 'tts', revision: 1, disabled: false,
  unit_price_map: { default: { cost_unit_price: 0.0001, sale_unit_price: 0.03, unit_credit: 0.01, original_unit_credit: 0.02 } },
  pricing: { usage_type: 'count', usage_measure: 'characters' }, update_time: Date.now() };
const model2 = { ...model, _id: '000000000000000000000002', model_id: 'model-two', model_name: '模型二', revision: 2 };
const wallets = ['a', 'b'].map((name, i) => ({ _id: name, clientRef: `client:${name}`, clientName: `客户${name.toUpperCase()}`, apiKey: `****${name}`, balance: 100 + i, available: 100 + i, frozenAmount: 0 }));
async function fixtures(page, { authenticated = true } = {}) {
  const state = { requests: [], errors: [], loginStatus: 200, creditFail: false, detailGate: null, creditGate: null, bulkCount: 0, rejectTasks: false };
  await page.addInitScript(authenticated => {
    if (sessionStorage.getItem('remaining-fixture-initialized')) return;
    sessionStorage.setItem('remaining-fixture-initialized', '1');
    localStorage.clear();
    if (authenticated) {
      localStorage.setItem('token', 'fixture'); localStorage.setItem('username', 'fixture');
      localStorage.setItem('roles', '["super_admin"]'); localStorage.setItem('permissions', '["*"]'); localStorage.setItem('menus', '["*"]');
    }
  }, authenticated);
  page.on('pageerror', error => state.errors.push(error.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(test.info().project.use.baseURL).origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const endpoint = decodeURIComponent(url.pathname.replace('/api/v1/admin', '')), method = route.request().method();
    const body = method === 'GET' ? null : route.request().postDataJSON();
    state.requests.push({ endpoint, method, body, params: Object.fromEntries(url.searchParams) });
    let data = { items: [], total: 0 };
    if (endpoint === '/auth/login') {
      if (state.loginStatus === 0) return route.abort('failed');
      if (state.loginStatus !== 200) return route.fulfill({ status: state.loginStatus, json: { message: 'fixture login error' } });
      data = { accessToken: 'fixture', roles: ['super_admin'], permissions: ['*'], menus: ['*'] };
    } else if (endpoint === '/menu') data = [{ key: 'models', label: '模型', children: [{ key: 'models-list', label: '模型配置', path: '/models' }] }, { key: 'tasks', label: '任务', children: [{ key: 'task-list', label: '任务列表', path: '/tasks' }] }];
    else if (endpoint === '/tasks' && state.rejectTasks) { state.rejectTasks = false; return route.fulfill({ status: 401, json: { message: 'expired' } }); }
    else if (endpoint === '/models') data = { items: [model, model2], total: 2 };
    else if (endpoint === '/models/detail') data = { ...(url.searchParams.get('id') === model2._id ? model2 : model), draft: { ...model, model_name: '已存草稿' }, draft_revision: 1 };
    else if (endpoint === '/provider-configs') data = { items: [{ provider_name: 'fixture' }], total: 1 };
    else if (endpoint === '/models/bulk') {
      state.bulkCount++;
      data = { results: body.items.map(item => ({ id: item.id, status: state.bulkCount === 1 && item.id === model2._id ? 'failed' : 'success', ...(state.bulkCount === 1 && item.id === model2._id ? { error: '版本冲突，请核对最新配置' } : {}) })) };
    } else if (endpoint === '/billing/wallets') data = { items: wallets, total: 2 };
    else if (/^\/billing\/wallets\//.test(endpoint)) {
      const isA = endpoint.includes('client:a'), amount = isA ? 111 : 222;
      if (isA && state.detailGate) await state.detailGate;
      if (endpoint.endsWith('/transactions')) data = { items: [{ _id: isA ? 'tx-a' : 'tx-b', type: 'credit', amount, balanceBefore: 0, balanceAfter: amount, reason: isA ? '流水A' : '流水B', createdAt: '2026-11-06T00:00:00Z' }], total: 1 };
      else if (endpoint.endsWith('/credit')) {
        if (state.creditGate) await state.creditGate;
        if (state.creditFail) return route.abort('failed');
        data = { balance: amount, frozenAmount: 0, available: amount };
      } else data = { balance: amount, frozenAmount: 0, available: amount };
    }
    return route.fulfill({ json: { code: 0, data } });
  });
  return state;
}
// Ant Design can retain the loading icon in the accessible name during its exit animation.
const loginButton = page => page.getByRole('button', { name: /登\s*录$/ });
async function login(page) { await page.getByPlaceholder('用户名', { exact: true }).fill('fixture'); await page.getByPlaceholder('密码', { exact: true }).fill('fixture-password'); await loginButton(page).click(); }
async function openWallet(page, name = '客户B') { await page.getByRole('row').filter({ hasText: name }).getByRole('button', { name: '详情', exact: true }).click(); return page.getByRole('dialog', { name: '钱包详情', exact: true }); }

test('login preserves protected destination, query and hash through a failed password and successful retry', async ({ page }) => {
  const state = await fixtures(page, { authenticated: false }); await page.goto('/tasks?status=FAILED#focus');
  await expect(page).toHaveURL(/login\?returnTo=/); state.loginStatus = 401;
  await login(page); await expect(page.getByRole('alert')).toContainText('用户名或密码错误');
  await expect(page.getByPlaceholder('用户名', { exact: true })).toHaveValue('fixture'); await expect(page).toHaveURL(/returnTo=/);
  state.loginStatus = 200; await loginButton(page).click(); await expect(page).toHaveURL(/\/tasks\?status=FAILED#focus$/);
  expect(state.errors).toEqual([]);
});
for (const [status, text] of [[500, '登录服务暂时不可用'], [429, '登录尝试过于频繁'], [0, '无法连接服务器']]) test(`login identifies failure ${status} without clearing inputs or navigating`, async ({ page }) => {
  const state = await fixtures(page, { authenticated: false }); state.loginStatus = status; await page.goto('/login'); await login(page);
  await expect(page.getByRole('alert')).toContainText(text); await expect(page.getByPlaceholder('用户名', { exact: true })).toHaveValue('fixture');
  await expect(page).toHaveURL(/\/login$/);
});
test('expired API authentication preserves current task filter and can log back in', async ({ page }) => {
  const state = await fixtures(page); state.rejectTasks = true; await page.goto('/tasks?model=model-one');
  await expect(page).toHaveURL(/login\?returnTo=/); await login(page); await expect(page).toHaveURL(/\/tasks\?model=model-one$/);
});
test('external return URLs cannot redirect outside the application', async ({ page }) => {
  await fixtures(page, { authenticated: false }); await page.goto('/login?returnTo=https%3A%2F%2Fexample.com'); await login(page);
  await expect(page).toHaveURL(new URL('/', test.info().project.use.baseURL).href);
});
test('dirty editor protects sidebar navigation, cancel preserves edits, and back navigation can be confirmed', async ({ page }) => {
  const state = await fixtures(page); await page.goto('/models');
  await page.getByRole('row').filter({ hasText: 'model-one' }).getByRole('button', { name: /编辑/ }).click();
  await page.getByLabel('model_name（展示名称）').fill('未保存名称');
  await page.getByRole('menuitem', { name: '任务列表', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '确认离开', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click(); await expect(page.getByRole('dialog', { name: '确认离开', exact: true })).toHaveCount(0); await expect(page.getByLabel('model_name（展示名称）')).toHaveValue('未保存名称');
  await page.goBack(); await expect(page.getByRole('dialog', { name: '确认离开', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^离\s*开$/ }).click(); await expect(page).toHaveURL(/\/models$/);
  expect(state.requests.filter(r => r.method !== 'GET')).toEqual([]); expect(state.errors).toEqual([]);
});
test('loading a saved draft requires consent before overwriting local edits', async ({ page }) => {
  await fixtures(page); await page.goto(`/models/edit/${model._id}`);
  await page.getByLabel('model_name（展示名称）').fill('本地修改'); await page.getByRole('button', { name: '加载草稿', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '加载草稿将覆盖当前修改' });
  await dialog.getByRole('button', { name: '继续编辑', exact: true }).click(); await expect(dialog).toHaveCount(0); await expect(page.getByLabel('model_name（展示名称）')).toHaveValue('本地修改');
  await page.getByRole('button', { name: '加载草稿', exact: true }).click(); await dialog.getByRole('button', { name: '加载草稿', exact: true }).click();
  await expect(page.getByLabel('model_name（展示名称）')).toHaveValue('已存草稿');
});
test('a delayed wallet A response cannot replace wallet B after closing and switching', async ({ page }) => {
  const state = await fixtures(page); let release; state.detailGate = new Promise(resolve => release = resolve);
  await page.goto('/billing/wallets'); const dialog = await openWallet(page, '客户A'); await dialog.getByRole('button', { name: 'Close' }).click();
  await openWallet(page); await expect(dialog.getByText('流水B', { exact: true })).toBeVisible();
  const completed = page.waitForResponse(response => decodeURIComponent(response.url()).includes('client:a') && new URL(response.url()).pathname.endsWith('/transactions'));
  release(); await completed; await expect(dialog.getByText('流水B', { exact: true })).toBeVisible(); await expect(dialog).not.toContainText('流水A'); await expect(dialog).toContainText('222.00');
  expect(state.errors).toEqual([]);
});
test('wallet refresh retains an applied search and reset clears it', async ({ page }) => {
  const state = await fixtures(page); await page.goto('/billing/wallets');
  const search = page.getByPlaceholder('搜索 API Key / 名称'); await search.fill('客户B'); await search.press('Enter');
  await expect.poll(() => state.requests.filter(r => r.endpoint === '/billing/wallets').at(-1).params.keyword).toBe('客户B');
  await page.getByRole('button', { name: /^reload 刷新$/ }).click(); await expect(search).toHaveValue('客户B');
  await expect.poll(() => state.requests.filter(r => r.endpoint === '/billing/wallets').at(-1).params.keyword).toBe('客户B');
  await page.getByRole('button', { name: '重置筛选', exact: true }).click(); await expect(search).toHaveValue('');
  await expect.poll(() => state.requests.filter(r => r.endpoint === '/billing/wallets').at(-1).params.keyword).toBeUndefined();
});
test('an uncertain topup locks inputs, survives reload and retries with the same operation identity', async ({ page }) => {
  const state = await fixtures(page); state.creditFail = true; let release; state.creditGate = new Promise(resolve => release = resolve);
  await page.goto('/billing/wallets'); let detail = await openWallet(page); await detail.getByRole('button', { name: /充值/ }).click();
  let dialog = page.getByRole('dialog', { name: '钱包充值', exact: true }); await dialog.getByLabel('充值金额').fill('10'); await dialog.getByLabel('充值原因').fill('fixture reason');
  await dialog.getByRole('button', { name: '确认充值', exact: true }).click({ clickCount: 2 });
  await expect.poll(() => state.requests.filter(r => r.endpoint.endsWith('/credit')).length).toBe(1);
  await expect(dialog.getByRole('button', { name: 'Close' })).toHaveCount(0); release(); await expect(dialog.getByRole('button', { name: '核对并重试原充值' })).toBeEnabled();
  await expect(dialog.getByLabel('充值金额')).toBeDisabled(); const first = state.requests.find(r => r.endpoint.endsWith('/credit')).body;
  await page.reload(); detail = await openWallet(page); await detail.getByRole('button', { name: /充值/ }).click(); dialog = page.getByRole('dialog', { name: '钱包充值', exact: true });
  await expect(dialog.getByLabel('充值金额')).toHaveValue('10.00'); await expect(dialog.getByLabel('充值原因')).toHaveValue('fixture reason');
  state.creditFail = false; await dialog.getByRole('button', { name: '核对并重试原充值' }).click(); await expect(dialog).toHaveCount(0);
  expect(state.requests.filter(r => r.endpoint.endsWith('/credit')).map(r => r.body)).toEqual([first, first]);
  expect(first.operationId).toMatch(/^[0-9a-f-]{36}$/); expect(state.errors).toEqual([]);
});
test('partial bulk failure stays visible, retains failed selection and retries only that model after reviewing fresh state', async ({ page }) => {
  const state = await fixtures(page); await page.goto('/models'); await page.getByRole('checkbox', { name: 'Select all', exact: true }).check();
  await page.getByRole('button', { name: '批量禁用', exact: true }).click();
  await page.getByRole('dialog', { name: /确认修改选中 2 条模型/ }).getByRole('button', { name: /^确\s*定$/ }).click();
  const results = page.getByRole('dialog', { name: '批量处理结果', exact: true }); await expect(results).toContainText('版本冲突');
  await expect(page.getByRole('dialog', { name: /确认修改选中 2 条模型/ })).toHaveCount(0);
  await page.screenshot({ path: 'output/admin-remaining-bulk.png', fullPage: false });
  await expect(page.getByText('已选 1 条', { exact: true })).toBeVisible();
  await results.getByRole('button', { name: '仅重试失败项' }).click();
  const retry = page.getByRole('dialog', { name: /确认修改选中 1 条模型/ }); await expect(retry).toContainText('model-two'); await expect(retry).not.toContainText('model-one');
  await retry.getByRole('button', { name: /^确\s*定$/ }).click(); await expect.poll(() => state.bulkCount).toBe(2);
  await expect(results).not.toContainText('版本冲突'); await expect(results.getByRole('button', { name: '仅重试失败项' })).toBeDisabled();
  expect(state.requests.filter(r => r.endpoint === '/models/bulk')[1].body.items).toEqual([{ id: model2._id, expected_revision: 2 }]); expect(state.errors).toEqual([]);
});
