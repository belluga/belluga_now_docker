const { defineConfig } = require('@playwright/test');
const {
  buildSuiteGrep,
  requirePlaywrightSuiteContract,
} = require('../web_app_tests/support/live_navigation_mutation_contract');

const ignoreHttpsErrors = process.env.PLAYWRIGHT_IGNORE_HTTPS_ERRORS === 'true';
const chromiumExecutablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;

const suiteType = requirePlaywrightSuiteContract();

module.exports = defineConfig({
  testDir: '../web_app_tests',
  timeout: 420000,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  outputDir: './test-results',
  grep: buildSuiteGrep(suiteType),
  use: {
    ignoreHTTPSErrors: ignoreHttpsErrors,
    launchOptions: chromiumExecutablePath
      ? {
          executablePath: chromiumExecutablePath,
        }
      : undefined,
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
