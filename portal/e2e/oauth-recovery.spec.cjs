const { test, expect } = require('@playwright/test');

async function fixture(page, locale = 'zh') {
  const state = { oauthCalls: 0, passwordCalls: 0, errors: [] };
  await page.addInitScript(locale => localStorage.setItem('portal-language', locale), locale);
  page.on('pageerror', error => state.errors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== new URL(test.info().project.use.baseURL).origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/v1/auth/oauth/google') {
      state.oauthCalls++;
      const params = new URLSearchParams({ error: 'oauth_rate_limited', retryAfter: '3', returnTo: url.searchParams.get('returnTo') || '/' });
      return route.fulfill({ status: 303, headers: { location: `/login?${params}`, 'retry-after': '3' }, body: '' });
    }
    let data = {};
    if (url.pathname === '/api/v1/auth/providers') data = { google: true, github: true, email: true };
    else if (url.pathname === '/api/v1/auth/login') {
      state.passwordCalls++;
      data = { accessToken: 'isolated-test-token', user: { id: 'fixture-user', username: 'Fixture', email: 'fixture@example.com', role: 'user' } };
    } else if (url.pathname === '/api/v1/auth/me') data = { id: 'fixture-user', username: 'Fixture', email: 'fixture@example.com', role: 'user' };
    else if (url.pathname === '/api/v1/notifications/unread-count') data = { count: 0 };
    else data = { items: [], total: 0, groups: [] };
    return route.fulfill({ json: { code: 0, message: 'Success', data } });
  });
  return state;
}

test('a throttled Google navigation returns to a localized login with a cooldown instead of raw JSON', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/login?returnTo=%2Fworks%3Ftype%3Dimage%23recent');
  await page.getByRole('button', { name: /Google$/ }).click();
  await expect(page).toHaveURL(/\/login\?error=oauth_rate_limited/);
  const alert = page.getByRole('alert').filter({ hasText: '第三方登录请求过于频繁' });
  await expect(alert).toContainText('秒后重试');
  await expect(page.getByRole('button', { name: /Google$/ })).toBeDisabled();
  await expect(page.locator('#login-email')).toBeEnabled();
  await expect(page.locator('#login-password')).toBeEnabled();
  await page.screenshot({ path: 'output/oauth-login-recovery.png', fullPage: true });
  await expect(page.getByRole('button', { name: /Google$/ })).toBeEnabled({ timeout: 7000 });
  await expect(alert).toContainText('现在可以重试第三方登录');
  expect(state.oauthCalls).toBe(1);
  expect(state.errors).toEqual([]);
});

test('email sign-in remains available during the OAuth wait and preserves the original destination', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/login?error=oauth_rate_limited&retryAfter=900&returnTo=%2Fworks%3Ftype%3Dimage%23recent');
  await expect(page.getByRole('alert')).toContainText('第三方登录请求过于频繁');
  await page.locator('#login-email').fill('fixture@example.com');
  await page.locator('#login-password').fill('fixture-password');
  await page.locator('button[type=submit]').click();
  await expect(page).toHaveURL(/\/works\?type=image#recent$/);
  expect(state.passwordCalls).toBe(1);
  expect(state.oauthCalls).toBe(0);
  expect(state.errors).toEqual([]);
});

test('unavailable OAuth displays a translated message and keeps an email sign-in form', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/login?error=oauth_unavailable&returnTo=%2Fworks');
  await expect(page.getByRole('alert')).toContainText('第三方登录暂时不可用');
  await expect(page.locator('#login-email')).toBeEnabled();
  await expect(page.getByRole('link', { name: '继续浏览', exact: true })).toHaveAttribute('href', '/');
  expect(state.errors).toEqual([]);
});

test('retry query values are bounded and external return destinations are ignored', async ({ page }) => {
  await fixture(page, 'en');
  await page.goto('/login?error=oauth_rate_limited&retryAfter=9999999&returnTo=https%3A%2Fattacker.example');
  await expect(page.getByRole('alert')).toContainText('900 seconds');
  await page.locator('#login-email').fill('fixture@example.com');
  await page.locator('#login-password').fill('fixture-password');
  await page.locator('button[type=submit]').click();
  await expect(page).toHaveURL(new URL('/', test.info().project.use.baseURL).href);
});
