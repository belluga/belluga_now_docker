const { chromium } = require('@playwright/test');

async function withFreshBrowserContext(run, contextOptions = {}) {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  });

  try {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      ...contextOptions,
    });

    try {
      return await run({ browser, context });
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

async function withFreshBrowserPage(run, contextOptions = {}) {
  return withFreshBrowserContext(async ({ browser, context }) => {
    const page = await context.newPage();
    return run({ browser, context, page });
  }, contextOptions);
}

module.exports = {
  withFreshBrowserContext,
  withFreshBrowserPage,
};
