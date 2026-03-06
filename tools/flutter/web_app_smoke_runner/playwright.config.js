const { defineConfig } = require('@playwright/test');

const ignoreHttpsErrors = process.env.PLAYWRIGHT_IGNORE_HTTPS_ERRORS === 'true';

module.exports = defineConfig({
  testDir: '../web_app_tests',
  timeout: 300000,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  outputDir: './test-results',
  use: {
    ignoreHTTPSErrors: ignoreHttpsErrors,
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
