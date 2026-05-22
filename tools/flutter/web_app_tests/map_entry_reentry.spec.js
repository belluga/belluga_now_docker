const { test, expect } = require('@playwright/test');

const tenantUrl = process.env.NAV_TENANT_URL;
const appBootTimeoutMs = 120000;

test.describe.configure({ timeout: 240000 });

function requireTenantUrl() {
  expect(
    tenantUrl,
    'Missing NAV_TENANT_URL. Map entry reentry readonly smoke requires a live tenant URL.',
  ).toBeTruthy();

  return tenantUrl;
}

function installFailureCollectors(page, appOrigin) {
  const runtimeErrors = [];
  const failedRequests = [];
  const consoleErrors = [];
  const mutatingApiRequests = [];

  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('requestfailed', (request) => {
    const failureText = request.failure()?.errorText || 'unknown';
    if (failureText === 'net::ERR_ABORTED') {
      return;
    }
    failedRequests.push(`${request.method()} ${request.url()} (${failureText})`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('request', (request) => {
    const method = (request.method() || '').toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return;
    }
    const url = request.url();
    if (!url.includes('/api/')) {
      return;
    }
    if (new URL(url).origin !== appOrigin) {
      return;
    }
    if (url.includes('/api/v1/anonymous/identities')) {
      return;
    }
    mutatingApiRequests.push(`${method} ${url}`);
  });

  return { runtimeErrors, failedRequests, consoleErrors, mutatingApiRequests };
}

async function assertAppBooted(page) {
  await expect(page.locator('flt-glass-pane')).toHaveCount(1, {
    timeout: appBootTimeoutMs,
  });
  await expect(page.locator('#splash-screen')).toHaveCount(0, {
    timeout: appBootTimeoutMs,
  });
}

async function enableAccessibilityIfNeeded(page) {
  const placeholder = page
    .locator('flt-semantics-placeholder[aria-label="Enable accessibility"]')
    .first();
  const a11yButton = page.getByRole('button', {
    name: /Enable accessibility/i,
  });

  for (let attempt = 0; attempt < 25; attempt += 1) {
    if ((await page.getByRole('tab').count()) >= 3) {
      return;
    }

    if ((await placeholder.count()) > 0) {
      await placeholder.focus();
      await page.keyboard.press('Enter');
    } else if ((await a11yButton.count()) > 0) {
      await a11yButton.first().click();
    }

    await page.waitForTimeout(300);
  }
}

async function waitForTenantPath(page, allowedPrefixes) {
  await page.waitForFunction(
    (prefixes) => {
      const { pathname, hash } = window.location;
      const pathOk = prefixes.some((prefix) =>
        prefix === '/' ? pathname === '/' : pathname.startsWith(prefix),
      );
      const hashOk = prefixes.some((prefix) => {
        if (prefix === '/') {
          return hash === '#' || hash === '#/';
        }
        return hash.startsWith(`#${prefix}`);
      });
      return pathOk || hashOk;
    },
    allowedPrefixes,
    { timeout: appBootTimeoutMs },
  );
}

test('@readonly MAP-NAV-REENTRY-01 tenant home can reopen map after returning from a warm permission-gated entry', async ({
  browser,
}) => {
  const baseUrl = requireTenantUrl();
  const appOrigin = new URL(baseUrl).origin;
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  const collectors = installFailureCollectors(page, appOrigin);
  const continueWithoutLocationButton = page.getByRole('button', {
    name: /Continuar sem localização/i,
  });

  const response = await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  expect(response, 'Tenant response should be available').not.toBeNull();
  expect(response.status(), 'Tenant response should be successful').toBeLessThan(400);

  await assertAppBooted(page);
  await enableAccessibilityIfNeeded(page);
  await waitForTenantPath(page, ['/']);

  await page.getByRole('tab', { name: /^Mapa$/i }).click();
  await expect(continueWithoutLocationButton).toBeVisible({
    timeout: appBootTimeoutMs,
  });
  await continueWithoutLocationButton.click();

  await waitForTenantPath(page, ['/mapa']);
  await expect(page.getByRole('tab', { name: /^Inicio$/i })).toBeVisible({
    timeout: appBootTimeoutMs,
  });

  await page.getByRole('tab', { name: /^Inicio$/i }).click();
  await waitForTenantPath(page, ['/']);

  await page.getByRole('tab', { name: /^Mapa$/i }).click();
  await expect(continueWithoutLocationButton).toBeVisible({
    timeout: appBootTimeoutMs,
  });
  await continueWithoutLocationButton.click();
  await waitForTenantPath(page, ['/mapa']);

  expect(
    collectors.runtimeErrors,
    `Unexpected runtime errors:\n${collectors.runtimeErrors.join('\n')}`,
  ).toEqual([]);
  expect(
    collectors.failedRequests,
    `Failed requests:\n${collectors.failedRequests.join('\n')}`,
  ).toEqual([]);
  const criticalConsoleErrors = collectors.consoleErrors.filter(
    (entry) => !entry.includes('status of 401'),
  );
  expect(
    criticalConsoleErrors,
    `Console errors:\n${criticalConsoleErrors.join('\n')}`,
  ).toEqual([]);
  expect(
    collectors.mutatingApiRequests,
    `Readonly map reentry flow must not issue mutating API requests:\n${collectors.mutatingApiRequests.join('\n')}`,
  ).toEqual([]);

  await context.close();
});
