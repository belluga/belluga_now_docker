const { test, expect } = require('@playwright/test');

const landlordUrl = process.env.NAV_LANDLORD_URL;
const tenantUrl = process.env.NAV_TENANT_URL;

if (!landlordUrl || !tenantUrl) {
  throw new Error('Missing NAV_LANDLORD_URL/NAV_TENANT_URL. Real navigation tests require live backend URLs.');
}

function installFailureCollectors(page) {
  const runtimeErrors = [];
  const failedRequests = [];
  const consoleErrors = [];

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

  return { runtimeErrors, failedRequests, consoleErrors };
}

async function assertAppBooted(page) {
  await expect(page.locator('body')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('script[src*="main.dart.js"]')).toHaveCount(1);
  await expect(page.locator('flt-glass-pane')).toHaveCount(1, { timeout: 90000 });
  await expect(page.locator('#splash-screen')).toHaveCount(0, { timeout: 90000 });
}

async function waitForLanding(page, allowedPrefixes) {
  await page.waitForFunction(
    (prefixes) => {
      const { pathname, hash } = window.location;
      const pathOk = prefixes.some((prefix) =>
        prefix === '/' ? pathname === '/' : pathname.startsWith(prefix)
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
    { timeout: 90000 }
  );
}

async function logLandingHref(page, lane) {
  const landingHref = await page.evaluate(() => window.location.href);
  console.log(`[nav][${lane}] landing href: ${landingHref}`);
}

async function probePath(page, baseUrl, path, allowedPrefixes, lane) {
  const targetUrl = new URL(path, baseUrl).toString();
  const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  expect(response, `Response should be available for ${targetUrl}`).not.toBeNull();
  expect(response.status(), `Response should be successful for ${targetUrl}`).toBeLessThan(400);

  await assertAppBooted(page);
  await waitForLanding(page, allowedPrefixes);
  await logLandingHref(page, `${lane}:${path}`);

  const reloadResponse = await page.reload({ waitUntil: 'domcontentloaded' });
  expect(
    reloadResponse,
    `Reload response should be available for ${targetUrl}`
  ).not.toBeNull();
  expect(
    reloadResponse.status(),
    `Reload response should be successful for ${targetUrl}`
  ).toBeLessThan(400);
  await assertAppBooted(page);
  await waitForLanding(page, allowedPrefixes);
  await logLandingHref(page, `${lane}:${path}:reload`);
}

async function assertEnvironmentType(page, baseUrl, expectedType) {
  const url = new URL('/api/v1/environment', baseUrl).toString();
  const response = await page.request.get(url);
  expect(response.status(), `Environment endpoint should succeed for ${url}`).toBeLessThan(400);

  const payload = await response.json();
  expect(payload?.type, `Environment payload type mismatch for ${url}`).toBe(expectedType);
}

test('landlord domain bootstraps as landlord and navigates', async ({ page }) => {
  const collectors = installFailureCollectors(page);

  const response = await page.goto(landlordUrl, { waitUntil: 'domcontentloaded' });
  expect(response, 'Landlord response should be available').not.toBeNull();
  expect(response.status(), 'Landlord response should be successful').toBeLessThan(400);

  await assertEnvironmentType(page, landlordUrl, 'landlord');

  await assertAppBooted(page);
  await waitForLanding(page, ['/', '/invites', '/convites', '/profile']);
  await logLandingHref(page, 'landlord');

  await probePath(
    page,
    landlordUrl,
    '/admin',
    ['/admin', '/auth/login'],
    'landlord'
  );
  await probePath(
    page,
    landlordUrl,
    '/home',
    ['/admin', '/auth/login'],
    'landlord'
  );
  await probePath(
    page,
    landlordUrl,
    '/landlord',
    ['/admin', '/auth/login'],
    'landlord'
  );

  expect(collectors.runtimeErrors, `Unexpected runtime errors:\n${collectors.runtimeErrors.join('\n')}`).toEqual([]);
  expect(collectors.failedRequests, `Failed requests:\n${collectors.failedRequests.join('\n')}`).toEqual([]);
  expect(collectors.consoleErrors, `Console errors:\n${collectors.consoleErrors.join('\n')}`).toEqual([]);
});

test('tenant domain bootstraps as tenant and navigates to tenant routes', async ({ page }) => {
  const collectors = installFailureCollectors(page);

  const response = await page.goto(tenantUrl, { waitUntil: 'domcontentloaded' });
  expect(response, 'Tenant response should be available').not.toBeNull();
  expect(response.status(), 'Tenant response should be successful').toBeLessThan(400);

  await assertEnvironmentType(page, tenantUrl, 'tenant');

  await assertAppBooted(page);
  await waitForLanding(page, ['/', '/invites', '/convites', '/profile']);
  await logLandingHref(page, 'tenant');

  await probePath(
    page,
    tenantUrl,
    '/admin',
    ['/admin', '/auth/login', '/'],
    'tenant'
  );
  await probePath(
    page,
    tenantUrl,
    '/home',
    ['/', '/auth/login'],
    'tenant'
  );
  await probePath(
    page,
    tenantUrl,
    '/landlord',
    ['/admin', '/landlord', '/', '/auth/login'],
    'tenant'
  );
  await probePath(
    page,
    tenantUrl,
    '/workspace',
    ['/workspace', '/auth/login', '/'],
    'tenant'
  );
  await probePath(
    page,
    tenantUrl,
    '/workspace/account-demo',
    ['/workspace/account-demo', '/workspace', '/auth/login'],
    'tenant'
  );

  expect(collectors.runtimeErrors, `Unexpected runtime errors:\n${collectors.runtimeErrors.join('\n')}`).toEqual([]);
  expect(collectors.failedRequests, `Failed requests:\n${collectors.failedRequests.join('\n')}`).toEqual([]);
  expect(collectors.consoleErrors, `Console errors:\n${collectors.consoleErrors.join('\n')}`).toEqual([]);
});
