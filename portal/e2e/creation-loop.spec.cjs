const { test, expect } = require('@playwright/test');
const projectId = 'f50c7846-cf31-4b7c-a3c4-56718a849c08';
const workflowId = '507f1f77bcf86cd799439011';
const template = { id: 'letter-story-v1', version: 1, name: '雨后的一封信', description: '单角色、两镜头的绘本叙事，适合先试做。', kind: 'short-drama', source: 'official', generatedMedia: false, ratio: '9:16', shotCount: 2, metrics: { copies: 4, creators: 3, startedProjects: 3, completedProjects: 2, startedCreators: 2, completedCreators: 2 },
  story: '小雨走进咖啡馆，看到一封信。', characters: [{ name: '小雨', description: '米色风衣' }], shots: [{ title: '镜头 1', description: '推门走进咖啡馆', duration: 5 }, { title: '镜头 2', description: '打开信件', duration: 5 }] };
const project = () => ({ id: projectId, revision: 0, archived: false, candidates: [], budget: { limit: 100, used: 0, reserved: 0, remaining: 100 }, pendingRequests: [],
  plan: { title: '我的第一部短剧', story: template.story, inputMode: 'idea', style: '绘本', duration: 30, step: 2, storyConfirmed: true, castConfirmed: true, storyboardConfirmed: false,
    characters: [{ id: 'lead', name: '小雨', description: '米色风衣' }], scenes: [], shots: template.shots.map((s, i) => ({ ...s, id: `shot-${i + 1}`, narration: s.description, characterIds: ['lead'] })),
    production: { provider: 'akool-maas', models: {} }, settings: { subtitles: true, subtitleStyle: 'white', musicVolume: 18, resolution: '720p' }, frame: { ratio: '9:16', fit: 'contain', voiceVolume: 100 } } });
async function fixture(page, authenticated = false) {
  const errors = [], calls = [], p = project();
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('portal-language', 'zh'));
  if (authenticated) await page.context().addCookies([{ name: 'portal_csrf_token', value: 'isolated-browser-session', url: 'http://127.0.0.1:7333' }]);
  await page.route('**/api/v1/**', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname.replace('/api/v1', ''), method = req.method();
    calls.push({ path, method, body: req.postDataJSON(), query: Object.fromEntries(url.searchParams) });
    let data;
    if (path === '/auth/refresh') data = { accessToken: 'isolated-session' };
    else if (path === '/auth/me') data = { id: 'owner', username: '创作者', role: 'user', status: 'active', usage: { totalWorkflows: 1, totalRuns: 1, totalTokens: 0 } };
    else if (path === '/catalog/drama-templates') { const search = url.searchParams.get('search') || ''; const source = url.searchParams.get('source') || ''; const items = template.name.includes(search) && (!source || source === template.source) ? [template] : []; data = { items, total: items.length, page: 1, pageSize: 12 }; }
    else if (path === '/catalog/drama-templates/letter-story-v1') data = template;
    else if (path === '/catalog/workflow-templates') data = { items: [], total: 0, page: 1, pageSize: 12 };
    else if (path === '/short-dramas/templates/letter-story-v1/create') data = p;
    else if (path === '/short-dramas/models') data = [];
    else if (path === `/short-dramas/${projectId}/stage-templates`) { p.plan.characters.push({ id: 'appended-role', name: '模板角色', description: '追加设定' }); p.revision++; data = p; }
    else if (path === '/short-dramas/capabilities') data = { mp4: true, subtitles: true, generationEnabled: true, createEnabled: true, exportEnabled: true };
    else if (path === '/short-dramas') data = { items: [p], total: 1, pageSize: 24 };
    else if (path === '/short-dramas/' + projectId) { if (method === 'PUT') { p.plan = req.postDataJSON().plan; p.revision++; } data = p; }
    else if (path === '/workflows/validate') data = { valid: true };
    else if (path === `/workflows/${workflowId}/run`) data = { runId: 'isolated-run', status: 'running' };
    else if (path === '/workflows/runs/isolated-run') data = { runId: 'isolated-run', workflowId, status: 'succeeded', nodeStates: [{ nodeId: 'shot', status: 'succeeded', output: { image: 'https://cdn.test/result.png' } }] };
    else if (path === '/workflows/' + workflowId) data = { _id: workflowId, name: '镜头高级流程', nodes: [{ id: 'shot', type: 'text-to-image', position: { x: 150, y: 150 }, data: { type: 'text-to-image', label: '分镜画面', modelId: 'fixture-image', parameters: { prompt: '咖啡馆' } } }], edges: [] };
    else if (path === '/workflows') data = { items: [{ _id: workflowId, name: '我的专业工作流', status: 'draft', nodes: [], edges: [], updatedAt: '2026-11-05T10:00:00Z' }], total: 1 };
    else if (path.startsWith('/drama-workflows/by-workflow/')) data = { id: 'shot-link', projectId, shotId: 'shot-1', kind: 'image', sourceRevision: 0, workflowId };
    else if (path === '/drama-workflows') data = { id: 'shot-link', projectId, shotId: 'shot-1', kind: 'image', sourceRevision: 0, workflowId };
    else if (path === '/drama-workflows/shot-link/import') data = { projectId, candidate: { id: 'imported-candidate', status: 'succeeded' } };
    else if (path === '/creation-templates/submissions') data = method === 'POST' ? { _id: 'submitted-template', status: 'pending' } : { items: [{ _id: 'submitted-template', kind: 'short-drama', sourceId: projectId, name: '我的故事模板', description: '可以复用的短剧结构', status: 'pending', reviewNote: '' }], total: 1 };
    else if (path === '/notifications/unread-count') data = { count: 0 };
    else data = { items: [], total: 0 };
    await route.fulfill({ json: { code: 0, message: 'Success', data } });
  });
  return { calls, errors };
}

test('visitors can discover stories, inspect them and sign in without starting generation', async ({ page }) => {
  const { calls, errors } = await fixture(page);
  await page.goto('/discover');
  await expect(page.getByRole('link', { name: '我的作品', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: '开始创作', exact: true }).first()).toBeVisible();
  await page.getByRole('link', { name: '查看详情', exact: true }).click();
  await expect(page.getByRole('heading', { name: '故事预览' })).toBeVisible();
  await page.getByRole('button', { name: '用此模板创建作品' }).first().click();
  await expect(page.getByRole('dialog')).toContainText('登录');
  expect(calls.some(c => c.method === 'POST' && !c.path.startsWith('/creation-events'))).toBe(false); expect(errors).toEqual([]);
});
test('discovery shows real activity and preserves recommendation and source choices', async ({ page }) => {
  const { calls, errors } = await fixture(page);
  await page.goto('/discover?type=short-drama');
  await expect(page.getByText('3 位创作者使用', { exact: true })).toBeVisible();
  await expect(page.getByText('2 个项目导出成功', { exact: true })).toBeVisible();
  await expect(page.getByText(/推荐参考独立创作者/)).toBeVisible();
  await page.screenshot({ path: 'output/template-recommendations.png', fullPage: true });
  await page.locator('.ant-select').filter({ has: page.getByRole('combobox', { name: '模板排序' }) }).click();
  await page.locator('.ant-select-item-option-content').filter({ hasText: /^最新$/ }).click();
  await expect(page).toHaveURL(/order=newest/);
  await page.locator('.ant-select').filter({ has: page.getByRole('combobox', { name: '模板来源' }) }).click();
  await page.locator('.ant-select-item-option-content').filter({ hasText: /^社区$/ }).click();
  await expect(page).toHaveURL(/source=community/);
  await expect(page.getByText('没有匹配的模板，请调整搜索或开始新作品。')).toBeVisible();
  expect(calls.some(call => call.path === '/catalog/drama-templates' && call.query.order === 'newest' && call.query.source === 'community')).toBe(true);
  expect(calls.some(call => call.method !== 'GET')).toBe(false); expect(errors).toEqual([]);
});
test('template adoption creates one personal project and does not submit paid tasks', async ({ page }) => {
  const { calls, errors } = await fixture(page, true);
  await page.goto('/drama-templates/letter-story-v1');
  await page.getByRole('button', { name: '用此模板创建作品' }).first().click();
  await expect(page).toHaveURL(new RegExp('/short-dramas/' + projectId));
  await expect(page.getByRole('textbox', { name: '作品名称', exact: true })).toHaveValue('我的第一部短剧');
  expect(calls.filter(c => c.method === 'POST' && !c.path.startsWith('/creation-events')).map(c => c.path)).toEqual(['/auth/refresh', '/short-dramas/templates/letter-story-v1/create']);
  expect(errors).toEqual([]);
});
test('works collects both project types, preserves legacy links and shows submission status', async ({ page }) => {
  const { errors } = await fixture(page, true);
  await page.goto('/short-dramas?search=我的'); await expect(page).toHaveURL(/\/works\?search=.*type=short-drama/);
  await expect(page.getByText('我的第一部短剧', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '专业工作流' }).click(); await expect(page.getByText('我的专业工作流', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '模板投稿' }).click(); await expect(page.getByText('我的故事模板', { exact: true })).toBeVisible();
  await page.goto('/workflows?search=专业'); await expect(page).toHaveURL(/\/works\?search=.*type=workflow/); expect(errors).toEqual([]);
});
test('shot advanced workflow discloses billing, imports successful output and returns to the source shot', async ({ page }) => {
  const { calls, errors } = await fixture(page, true);
  await page.goto('/short-dramas/' + projectId);
  await page.getByRole('button', { name: '高级流程', exact: true }).click(); await expect(page.getByRole('dialog')).toContainText('计入原短剧项目预算');
  await page.getByRole('button', { name: '保存并打开画布' }).click(); await expect(page).toHaveURL(new RegExp('/workflows/' + workflowId));
  await expect(page.getByText('当前镜头的自定义流程', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: /运行$/ }).click();
  await expect(page.getByRole('button', { name: '加入原镜头候选', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '加入原镜头候选', exact: true }).click();
  await expect(page.getByText('已加入原镜头候选，请返回作品预览并选用')).toBeVisible();
  expect(calls.find(c => c.path === '/drama-workflows/shot-link/import').body).toEqual({ runId: 'isolated-run', nodeId: 'shot' });
  await page.getByRole('button', { name: '返回原镜头', exact: true }).click(); await expect(page).toHaveURL(/shot=shot-1&step=2/); expect(errors).toEqual([]);
});
test('creators can submit a template snapshot for review without publishing it', async ({ page }) => {
  const { calls, errors } = await fixture(page, true);
  await page.goto('/short-dramas/' + projectId); await page.getByRole('button', { name: '提交为模板', exact: true }).click();
  await page.getByLabel('用途与适合人群').fill('适合初次制作短剧的用户'); await page.getByLabel('使用步骤、所需素材与限制').fill('先修改故事，然后确认角色和分镜。');
  await page.getByRole('button', { name: '保存快照并提交审核' }).click(); await expect(page.getByText('模板已提交审核', { exact: false })).toBeVisible();
  const submission = calls.find(c => c.path === '/creation-templates/submissions' && c.method === 'POST'); expect(submission.body).toMatchObject({ kind: 'short-drama', sourceId: projectId }); expect(submission.body).not.toHaveProperty('status'); expect(errors).toEqual([]);
});
test('mobile discovery and creation remain navigable without horizontal overflow', async ({ page }) => {
  const { errors } = await fixture(page); await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/discover?type=short-drama'); await expect(page.getByRole('button', { name: '制作同款短剧' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('link', { name: '开始创作', exact: true }).first().click(); await expect(page.getByRole('heading', { name: '开始创作', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); expect(errors).toEqual([]);
  await page.screenshot({ path: 'output/creation-mobile.png', fullPage: true });
});


test('stage templates append into the saved project without starting paid generation', async ({ page }) => {
  const { calls, errors } = await fixture(page, true);
  await page.goto('/short-dramas/' + projectId);
  await page.getByRole('button', { name: '阶段模板', exact: true }).click();
  await page.locator('.ant-select').filter({ has: page.getByRole('combobox', { name: '阶段模板选择' }) }).click();
  await page.locator('.ant-select-item-option-content').filter({ hasText: /雨后的一封信/ }).click();
  await page.getByRole('button', { name: '保存并追加', exact: true }).click();
  await expect(page.getByText('已追加模板内容，请检查并重新确认角色和分镜')).toBeVisible();
  const request = calls.find(c => c.path.endsWith('/stage-templates')); expect(request.body).toMatchObject({ templateId: 'letter-story-v1', stage: 'characters' });
  expect(calls.some(c => /quotes|generate|exports$/.test(c.path) && c.method === 'POST')).toBe(false);
  expect(errors).toEqual([]);
});
