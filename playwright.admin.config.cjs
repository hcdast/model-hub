const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './dashboard/e2e', testMatch: '**/*.spec.cjs', fullyParallel: false, workers: 1,
  timeout: 45000, expect: { timeout: 10000 }, retries: 0,
  outputDir: './output/admin-browser-results',
  globalTeardown: './dashboard/e2e/teardown.cjs',
  reporter: [['list'], ['json', { outputFile: './output/admin-browser-report.json' }]],
  use: { baseURL: 'http://127.0.0.1:7332', viewport: { width: 1440, height: 1000 }, headless: true,
    channel: process.env.ADMIN_TEST_BROWSER || (process.platform === 'win32' ? 'chrome' : undefined),
    trace: 'retain-on-failure', screenshot: 'only-on-failure', serviceWorkers: 'block' },
  webServer: { command: 'node scripts/admin-test-server.cjs', url: 'http://127.0.0.1:7332', reuseExistingServer: false, timeout: 30000 },
});
