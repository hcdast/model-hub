const { test, expect } = require('@playwright/test');

for (const canReview of [false, true]) test(`template review: ${canReview ? 'publish and withdraw' : 'read-only permissions'}`, async ({ page }) => {
  const writes = [], errors = [], insightRequests = [];
  const submission = { _id: '000000000000000000000001', kind: 'short-drama', name: '审核故事模板', description: '可复用分镜', instructions: '先修改故事', sourceId: 'fixture-project', sourceRevision: 3, status: 'pending', reviewNote: '', dramaPlan: { title: '故事快照', shots: [{ id: 'shot-1', description: '咖啡馆' }] } };
  await page.addInitScript(canReview => {
    localStorage.setItem('token', 'isolated-review-fixture'); localStorage.setItem('username', 'isolated-reviewer');
    localStorage.setItem('roles', JSON.stringify(['admin'])); localStorage.setItem('menus', JSON.stringify(['*']));
    localStorage.setItem('permissions', JSON.stringify(canReview ? ['workflow:read', 'workflow:update'] : ['workflow:read']));
  }, canReview);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:7334') return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const endpoint = url.pathname.replace('/api/v1/admin', ''); let data;
    if (endpoint === '/creation-templates') data = { items: [submission], total: 1 };
    else if (endpoint === '/creation-templates/funnel') data = { from: '2026-10-06T10:00:00Z', to: '2026-11-05T10:00:00Z', counts: { template_view: 12, create_click: 5, quote_viewed: 3, take_selected: 2, download_started: 1 } };
    else if (endpoint === '/creation-templates/insights') {
      const kind = url.searchParams.get('kind'); insightRequests.push(kind);
      data = kind === 'workflow' ? { items: [], total: 0, totals: { copies: 0, startedProjects: 0, completedProjects: 0 } }
        : { items: [{ id: 'stat', name: '使用统计模板', published: true, metrics: { copies: 4, creators: 3, startedProjects: 3, completedProjects: 2 } }], total: 1, totals: { copies: 4, startedProjects: 3, completedProjects: 2 } };
      data.computedAt = '2026-11-05T10:00:00Z';
    }
    else if (endpoint === `/creation-templates/${submission._id}`) data = submission;
    else if (endpoint.endsWith('/review') && request.method() === 'PUT') {
      const body = request.postDataJSON(); writes.push(body); submission.status = body.action === 'publish' ? 'published' : 'withdrawn'; data = { status: submission.status };
    } else if (endpoint === '/menu') data = [];
    else data = { items: [], total: 0, unreadCount: 0 };
    return route.fulfill({ json: { code: 0, data } });
  });
  await page.goto('http://127.0.0.1:7334/workflows');
  const insights = page.locator('.ant-card').filter({ has: page.getByText('模板复用效果', { exact: true }) });
  await expect(insights.getByText('50.0%', { exact: true })).toHaveCount(2);
  await expect(insights.getByText('近 30 天操作漏斗', { exact: true })).toBeVisible();
  if (canReview) await page.screenshot({ path: 'output/template-insights.png', fullPage: true });
  await insights.getByText('工作流模板', { exact: true }).click();
  await expect(insights.getByText('运行成功', { exact: true }).first()).toBeVisible();
  await expect(insights.getByText('使用统计模板')).toHaveCount(0);
  await expect(insights.getByText('NaN')).toHaveCount(0);
  expect(insightRequests).toEqual(['short-drama', 'workflow']);
  await expect(page.getByText('审核故事模板', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '查看快照与审核' }).click();
  const drawer = page.getByRole('dialog', { name: '模板快照审核' });
  await expect(drawer.locator('pre')).toContainText('故事快照');
  await expect(drawer.getByRole('button', { name: '通过并发布' })).toHaveCount(canReview ? 1 : 0);
  if (canReview) {
    await drawer.getByRole('textbox', { name: '模板审核意见' }).fill('结构清晰，可以复用');
    await drawer.getByRole('button', { name: '通过并发布' }).click();
    await page.getByRole('button', { name: /确\s*定/ }).click();
    await expect(page.getByText('已发布', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '查看快照与审核' }).click();
    await drawer.getByRole('button', { name: /^下\s*架$/ }).click();
    await page.getByRole('button', { name: /确\s*定/ }).click();
    await expect(page.getByText('已下架', { exact: true })).toBeVisible();
    expect(writes.map(write => write.action)).toEqual(['publish', 'withdraw']);
    expect(writes[0].note).toBe('结构清晰，可以复用');
  } else expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});
