const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './portal/e2e', testMatch: '**/*.spec.cjs', workers: 1,
  timeout: 30000, expect: { timeout: 10000 },
  outputDir: './output/creation-browser-results', reporter: [['list'], ['json', { outputFile: './output/creation-browser-report.json' }]],
  globalTeardown: './portal/e2e/teardown.cjs',
  use: { baseURL: 'http://127.0.0.1:7333', viewport: { width: 1440, height: 1000 }, headless: true,
    channel: process.platform === 'win32' ? 'chrome' : undefined, serviceWorkers: 'block', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: [
    { command: 'node scripts/creation-test-server.cjs', url: 'http://127.0.0.1:7333', reuseExistingServer: false, timeout: 30000 },
    { command: 'node scripts/creation-test-server.cjs --admin', url: 'http://127.0.0.1:7334', reuseExistingServer: false, timeout: 30000 },
  ],
});
