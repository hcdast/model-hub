const { test, expect } = require('@playwright/test');

async function fixture(page) {
  const errors = [];
  let project = { id: 'layout-fixture', revision: 1, candidates: [], pendingRequests: [], history: [], budget: { limit: 100, used: 0, reserved: 0, remaining: 100 },
    plan: { title: '未命名短剧', story: '', inputMode: 'idea', style: '绘本漫剧', duration: 60, step: 0,
      characters: [], scenes: [], shots: [], production: { provider: 'akool-maas', models: {} },
      settings: { subtitles: true, subtitleStyle: 'white', musicVolume: 18, resolution: '720p' }, frame: { ratio: '9:16', fit: 'contain', voiceVolume: 100 } } };
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('portal-language', 'zh'));
  await page.context().addCookies([{ name: 'portal_csrf_token', value: 'isolated-layout-test', url: test.info().project.use.baseURL }]);
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== new URL(test.info().project.use.baseURL).origin) return route.abort();
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
