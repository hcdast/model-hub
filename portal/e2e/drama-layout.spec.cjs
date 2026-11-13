const { test, expect } = require('@playwright/test');

async function fixture(page, planOverrides = {}, candidates = [], baseURL = test.info().project.use.baseURL) {
  const errors = [];
  let project = { id: 'layout-fixture', revision: 1, candidates: [], pendingRequests: [], history: [], budget: { limit: 100, used: 0, reserved: 0, remaining: 100 },
    plan: { title: '未命名短剧', story: '', inputMode: 'idea', style: '绘本漫剧', duration: 60, step: 0,
      characters: [], scenes: [], shots: [], production: { provider: 'akool-maas', models: {} },
      settings: { subtitles: true, subtitleStyle: 'white', musicVolume: 18, resolution: '720p' }, frame: { ratio: '9:16', fit: 'contain', voiceVolume: 100 } } };
  project.plan = { ...project.plan, ...planOverrides };
  project.candidates = candidates;
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('portal-language', 'zh'));
  await page.context().addCookies([{ name: 'portal_csrf_token', value: 'isolated-layout-test', url: baseURL }]);
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== new URL(baseURL).origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    let data = {};
    if (url.pathname === '/api/v1/auth/refresh') data = { accessToken: 'fixture-token' };
    else if (url.pathname === '/api/v1/auth/me') data = { id: 'fixture-user', username: 'Fixture', role: 'user', status: 'active' };
    else if (url.pathname === '/api/v1/short-dramas/models') data = [];
    else if (url.pathname === '/api/v1/short-dramas/capabilities') data = { generationEnabled: true, createEnabled: true, exportEnabled: true, mp4: true, subtitles: true };
    else if (url.pathname === '/api/v1/short-dramas/layout-fixture') {
      if (request.method() === 'PUT') project = { ...project, plan: request.postDataJSON().plan, revision: project.revision + 1 };
      data = project;
    } else if (url.pathname === '/api/v1/notifications/unread-count') data = { count: 0 };
    else data = { items: [], total: 0 };
    return route.fulfill({ json: { code: 0, data } });
  });
  return errors;
}

const castDescription = '一只由石头中蹦裂出的猴子，周身覆盖灰褐色毛发，毛发上残留石质斑纹与裂纹，身上没有衣物，四肢精瘦而有力，眼睛金黄明亮，动作带兽性与初生的好奇。';
const previewPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5ioAAAAASUVORK5CYII=', 'base64');

async function imageFixture(page, url, baseURL) {
  return fixture(page, { step: 1, characters: [{ id: 'monkey', name: '石猴', description: castDescription }] }, [
    { id: 'monkey-image', projectId: 'layout-fixture', kind: 'character', targetId: 'monkey', status: 'succeeded', source: 'model', url },
  ], baseURL);
}

async function expectDecoded(image) {
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
}

test('blocked image links load through authenticated media in candidates, preview and selected cast', async ({ page }) => {
  const errors = await imageFixture(page, 'https://media.invalid/blocked.png');
  const mediaRequests = [], generations = [];
  page.on('request', request => { if (/\/(generate|quotes)$/.test(new URL(request.url()).pathname)) generations.push(request.url()); });
  await page.route('https://media.invalid/blocked.png', route => route.fulfill({ status: 403, body: 'Forbidden' }));
  await page.route('**/short-dramas/layout-fixture/candidates/monkey-image/media', route => {
    mediaRequests.push(route.request().headers().authorization);
    return route.fulfill({ contentType: 'image/png', body: previewPng });
  });
  await page.goto('/short-dramas/layout-fixture');
  await expectDecoded(page.locator('.sd-candidate img'));
  await expect(page.locator('.sd-role-placeholder')).toBeVisible();
  await page.getByRole('button', { name: '放大预览', exact: true }).click();
  await expectDecoded(page.getByRole('dialog').getByRole('img', { name: '候选画面', exact: true }));
  await page.getByRole('button', { name: '设为当前，保留旧候选', exact: true }).click();
  await expectDecoded(page.locator('.sd-cast-image'));
  await expectDecoded(page.locator('.sd-shot-editor-photo'));
  expect(mediaRequests.length).toBeGreaterThanOrEqual(4);
  expect(mediaRequests.every(auth => auth === 'Bearer fixture-token')).toBe(true);
  expect(generations).toEqual([]);
  expect(errors).toEqual([]);
});

test('failed image reads show a retry that fetches the saved image without generating again', async ({ page }) => {
  const errors = await imageFixture(page, 'https://media.invalid/unavailable.png');
  let reads = 0;
  const generations = [];
  page.on('request', request => { if (/\/(generate|quotes)$/.test(new URL(request.url()).pathname)) generations.push(request.url()); });
  await page.route('**/short-dramas/layout-fixture/candidates/monkey-image/media', route => {
    reads++;
    return reads === 1 ? route.fulfill({ status: 502, json: { message: 'Unavailable' } }) : route.fulfill({ contentType: 'image/png', body: previewPng });
  });
  await page.goto('/short-dramas/layout-fixture');
  await expect(page.getByRole('alert')).toContainText('图片暂时无法加载，结果已保留');
  await page.getByRole('button', { name: '重试读取图片', exact: true }).click();
  await expectDecoded(page.locator('.sd-candidate img'));
  expect(reads).toBe(2);
  expect(generations).toEqual([]);
  expect(errors).toEqual([]);
});

test('public images render directly without an authenticated media download', async ({ page }) => {
  const errors = await imageFixture(page, '/fixtures/public-image.png');
  let reads = 0;
  await page.route('**/fixtures/public-image.png', route => route.fulfill({ contentType: 'image/png', body: previewPng }));
  await page.route('**/short-dramas/layout-fixture/candidates/monkey-image/media', route => { reads++; return route.abort(); });
  await page.goto('/short-dramas/layout-fixture');
  await expectDecoded(page.locator('.sd-candidate img'));
  expect(reads).toBe(0);
  expect(errors).toEqual([]);
});

test('HTTPS pages display HTTP image sources without requesting the CDN over HTTPS', async ({ page }) => {
  const secureOrigin = 'https://secure-portal.invalid';
  const errors = await imageFixture(page, 'http://cdn.zhihexu.cn/fixture.png', secureOrigin);
  const cdnRequests = [], mediaRequests = [];
  page.on('request', request => { if (new URL(request.url()).hostname === 'cdn.zhihexu.cn') cdnRequests.push(request.url()); });
  await page.route(`${secureOrigin}/**`, async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/')) return route.fallback();
    const response = await page.request.get(`${test.info().project.use.baseURL}${url.pathname}${url.search}`);
    return route.fulfill({ response });
  });
  await page.route('**/short-dramas/layout-fixture/candidates/monkey-image/media', route => {
    mediaRequests.push(route.request().headers().authorization);
    return route.fulfill({ contentType: 'image/png', body: previewPng });
  });
  await page.goto(`${secureOrigin}/short-dramas/layout-fixture`);
  expect(await page.evaluate(() => location.protocol)).toBe('https:');
  await expectDecoded(page.locator('.sd-candidate img'));
  await page.getByRole('button', { name: '放大预览', exact: true }).click();
  await expectDecoded(page.getByRole('dialog').getByRole('img', { name: '候选画面', exact: true }));
  await page.getByRole('button', { name: '设为当前，保留旧候选', exact: true }).click();
  await expectDecoded(page.locator('.sd-cast-image'));
  await expectDecoded(page.locator('.sd-shot-editor-photo'));
  expect(cdnRequests).toEqual([]);
  expect(mediaRequests.length).toBeGreaterThanOrEqual(4);
  expect(mediaRequests.every(auth => auth === 'Bearer fixture-token')).toBe(true);
  expect(errors).toEqual([]);
});

test('HTTP pages keep reachable HTTP image sources on HTTP', async ({ page }) => {
  const errors = await imageFixture(page, 'http://cdn.zhihexu.cn/fixture.png');
  const cdnRequests = [];
  let reads = 0;
  page.on('request', request => { if (new URL(request.url()).hostname === 'cdn.zhihexu.cn') cdnRequests.push(request.url()); });
  await page.route('http://cdn.zhihexu.cn/fixture.png', route => route.fulfill({ contentType: 'image/png', body: previewPng }));
  await page.route('**/short-dramas/layout-fixture/candidates/monkey-image/media', route => { reads++; return route.abort(); });
  await page.goto('/short-dramas/layout-fixture');
  await expectDecoded(page.locator('.sd-candidate img'));
  expect(cdnRequests).toEqual(['http://cdn.zhihexu.cn/fixture.png']);
  expect(reads).toBe(0);
  expect(errors).toEqual([]);
});

for (const [width, height] of [[1920, 1080], [1440, 900], [768, 1024], [390, 844]]) {
  test(`populated cast has bounded cards and usable settings at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const errors = await fixture(page, { step: 1, characters: [{ id: 'monkey', name: '石猴', description: castDescription }] });
    await page.goto('/short-dramas/layout-fixture');
    await expect(page.getByLabel('角色或场景名称')).toHaveValue('石猴');
    const card = await page.locator('.sd-cast-card').boundingBox();
    const placeholder = await page.locator('.sd-role-placeholder').boundingBox();
    const editor = await page.locator('.sd-cast-layout > .sd-editor').boundingBox();
    expect(card.width).toBeLessThanOrEqual(320);
    expect(placeholder.height).toBeLessThanOrEqual(400);
    if (width > 980) {
      expect(editor.width).toBeGreaterThanOrEqual(360);
      expect(Math.abs(editor.y - card.y)).toBeLessThan(2);
      expect(editor.x - (card.x + card.width)).toBeLessThanOrEqual(25);
      expect(editor.height).toBeLessThan(700);
    } else {
      expect(editor.y).toBeGreaterThanOrEqual(card.y + card.height);
    }
    const filters = page.locator('.sd-cast-layout .ant-segmented-item');
    await expect(filters).toHaveCount(3);
    for (const filter of await filters.all()) {
      const bounds = await filter.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(editor.x);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(editor.x + editor.width);
    }
    await filters.nth(2).click();
    await expect(page.getByText('没有失败记录', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `output/drama-cast-${width}x${height}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });
}

test('multiple cast cards, selected images and scene settings share the compact layout', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const picture = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="400" height="500" fill="#526a58"/></svg>')}`;
  const errors = await fixture(page, {
    step: 1,
    characters: [
      { id: 'monkey', name: '石猴', description: castDescription, selected: 'monkey-image' },
      { id: 'master', name: '师父', description: '穿灰色长袍的老师父。' },
      { id: 'child', name: '童子', description: '在山间玩耍的童子。' },
    ],
    scenes: [{ id: 'mountain', name: '花果山', description: '山林瀑布和水帘洞。' }],
  }, [{ id: 'monkey-image', projectId: 'layout-fixture', kind: 'character', targetId: 'monkey', status: 'succeeded', source: 'upload', url: picture }]);
  await page.goto('/short-dramas/layout-fixture');
  await expect(page.locator('.sd-cast-card')).toHaveCount(3);
  await expect(page.locator('.sd-cast-image')).toBeVisible();
  for (const card of await page.locator('.sd-cast-card').all()) {
    expect((await card.boundingBox()).width).toBeLessThanOrEqual(280);
  }
  const editor = await page.locator('.sd-cast-layout > .sd-editor').boundingBox();
  expect(editor.width).toBeGreaterThanOrEqual(360);
  await page.locator('.sd-cast-card').filter({ hasText: '师父' }).click();
  await expect(page.getByLabel('角色或场景名称')).toHaveValue('师父');
  await page.getByRole('button', { name: '场景设定', exact: true }).click();
  await expect(page.getByLabel('角色或场景名称')).toHaveValue('花果山');
  await expect(page.locator('.sd-cast-card')).toHaveCount(1);
  expect((await page.locator('.sd-cast-card').boundingBox()).width).toBeLessThanOrEqual(320);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

for (const [width, height] of [[2424, 1267], [1440, 1400], [1440, 900], [768, 1024], [390, 844]]) {
  test(`short-drama editing starts below the topbar and stays usable at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const errors = await fixture(page);
    await page.goto('/short-dramas/layout-fixture');
    await expect(page.locator('#drama-story')).toBeVisible();
    const topbar = await page.locator('.sd-topbar').boundingBox();
    const heading = await page.locator('.sd-project-heading').boundingBox();
    expect(heading.y - (topbar.y + topbar.height)).toBeLessThan(30);
    await expect(page.locator('.sd-bottom')).toBeInViewport();
    if (width > 980) {
      const form = await page.locator('.sd-story-grid > .sd-panel').boundingBox();
      const poster = await page.locator('.sd-poster').boundingBox();
      expect(poster.width).toBeLessThanOrEqual(360);
      expect(form.width).toBeGreaterThan(poster.width * 1.5);
    }
    await page.screenshot({ path: `output/drama-layout-${width}x${height}.png`, fullPage: true });
    for (let step = 0; step < 5; step++) {
      await page.getByTestId(`drama-step-${step}`).click();
      await expect(page.getByTestId(`drama-step-${step}`)).toHaveAttribute('aria-current', 'step');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      await expect(page.locator('.sd-bottom')).toBeInViewport();
    }
    expect(errors).toEqual([]);
  });
}
