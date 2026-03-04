const { test, expect } = require('@playwright/test');

const landlordUrl = process.env.NAV_LANDLORD_URL;
const tenantUrl = process.env.NAV_TENANT_URL;

function requireNavigationUrls() {
  expect(
    landlordUrl,
    'Missing NAV_LANDLORD_URL. Readonly web navigation suite requires live landlord URL.',
  ).toBeTruthy();
  expect(
    tenantUrl,
    'Missing NAV_TENANT_URL. Readonly web navigation suite requires live tenant URL.',
  ).toBeTruthy();

  return { landlordUrl, tenantUrl };
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
  return payload;
}

function resolveDefaultOrigin(environmentPayload) {
  const mapUi = environmentPayload?.settings?.map_ui;
  if (!mapUi || typeof mapUi !== 'object') {
    return null;
  }

  if (mapUi.default_origin && typeof mapUi.default_origin === 'object') {
    return mapUi.default_origin;
  }

  const lat = mapUi['default_origin.lat'];
  const lng = mapUi['default_origin.lng'];
  if (lat == null || lng == null) {
    return null;
  }

  return {
    lat,
    lng,
    label: mapUi['default_origin.label'] ?? null,
  };
}

async function enableAccessibilityIfNeeded(page) {
  const a11yButton = page.getByRole('button', { name: /Enable accessibility/i });
  if ((await a11yButton.count()) > 0) {
    const placeholder = page
      .locator('flt-semantics-placeholder[aria-label="Enable accessibility"]')
      .first();
    await placeholder.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
  }
}

test('@readonly landlord domain bootstraps as landlord and navigates', async ({ page }) => {
  const { landlordUrl } = requireNavigationUrls();
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

test('@readonly tenant domain bootstraps as tenant and navigates to tenant routes', async ({ page }) => {
  const { tenantUrl } = requireNavigationUrls();
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

test('@readonly tenant agenda UI state matches tenant agenda API payload', async ({ browser }) => {
  const { tenantUrl } = requireNavigationUrls();
  const tenantOrigin = new URL(tenantUrl).origin;
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    geolocation: { latitude: -20.671339, longitude: -40.495395 },
    permissions: ['geolocation'],
  });
  const page = await context.newPage();
  const collectors = installFailureCollectors(page);
  const agendaSamples = [];
  let anonymousIdentityStatus = null;

  const tenantEnvironment = await assertEnvironmentType(page, tenantUrl, 'tenant');
  const defaultOrigin = resolveDefaultOrigin(tenantEnvironment);
  expect(defaultOrigin, 'Environment payload must expose settings.map_ui.default_origin.').toBeTruthy();
  expect(
    Number.isFinite(Number(defaultOrigin?.lat)),
    'default_origin.lat must be numeric.',
  ).toBeTruthy();
  expect(
    Number.isFinite(Number(defaultOrigin?.lng)),
    'default_origin.lng must be numeric.',
  ).toBeTruthy();

  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('/api/v1/anonymous/identities')) {
      anonymousIdentityStatus = response.status();
      return;
    }
    if (!url.includes('/api/v1/agenda')) {
      return;
    }
    if (response.status() >= 400) {
      return;
    }
    try {
      const requestUrl = new URL(url);
      const body = await response.json();
      const items = Array.isArray(body?.items)
        ? body.items
        : Array.isArray(body?.data?.items)
          ? body.data.items
          : [];
      const pageParam = requestUrl.searchParams.get('page') ?? '1';
      agendaSamples.push({
        page: pageParam,
        count: items.length,
        originLat: requestUrl.searchParams.get('origin_lat'),
        originLng: requestUrl.searchParams.get('origin_lng'),
        url,
      });
    } catch (_) {
      // Ignore non-JSON payloads; assertion below will fail if no valid agenda sample exists.
    }
  });

  const response = await page.goto(tenantUrl, { waitUntil: 'domcontentloaded' });
  expect(response, 'Tenant response should be available').not.toBeNull();
  expect(response.status(), 'Tenant response should be successful').toBeLessThan(400);
  await assertAppBooted(page);
  await enableAccessibilityIfNeeded(page);
  await page.waitForTimeout(12000);

  expect(
    anonymousIdentityStatus,
    'Expected anonymous identity bootstrap call on tenant public startup.',
  ).toBe(201);
  expect(
    agendaSamples.length,
    'Expected at least one successful /api/v1/agenda JSON payload.',
  ).toBeGreaterThan(0);

  const firstPageSamples = agendaSamples.filter((sample) => sample.page === '1');
  const inspectedSamples = firstPageSamples.length > 0 ? firstPageSamples : agendaSamples;
  const samplesMissingOrigin = inspectedSamples.filter(
    (sample) => !sample.originLat || !sample.originLng,
  );
  expect(
    samplesMissingOrigin,
    `All inspected agenda requests must include origin_lat/origin_lng:\n${samplesMissingOrigin
      .map((sample) => sample.url)
      .join('\n')}`,
  ).toEqual([]);

  const samplesWithInvalidOrigin = inspectedSamples.filter(
    (sample) =>
      !Number.isFinite(Number(sample.originLat)) ||
      !Number.isFinite(Number(sample.originLng)),
  );
  expect(
    samplesWithInvalidOrigin,
    `All inspected agenda requests must include numeric origin_lat/origin_lng:\n${samplesWithInvalidOrigin
      .map((sample) => `${sample.url} [lat=${sample.originLat}, lng=${sample.originLng}]`)
      .join('\n')}`,
  ).toEqual([]);

  const maxAgendaCount = inspectedSamples.reduce(
    (currentMax, sample) => (sample.count > currentMax ? sample.count : currentMax),
    0,
  );

  const emptyStateText = page.getByText('Nenhum evento disponível no momento');
  if (maxAgendaCount > 0) {
    await expect(
      emptyStateText,
      'Agenda API returned items, but UI still shows empty state.',
    ).toHaveCount(0);
  } else {
    await expect(emptyStateText).toHaveCount(1);
  }

  const criticalFailedRequests = collectors.failedRequests.filter((entry) =>
    entry.includes(tenantOrigin) && entry.includes('/api/'),
  );
  const criticalConsoleErrors = collectors.consoleErrors.filter((entry) =>
    entry.includes('/api/v1/') ||
    entry.includes('FormatException') ||
    entry.includes('Landlord login failed'),
  );

  expect(
    collectors.runtimeErrors,
    `Unexpected runtime errors:\n${collectors.runtimeErrors.join('\n')}`,
  ).toEqual([]);
  expect(
    criticalFailedRequests,
    `Critical failed API requests:\n${criticalFailedRequests.join('\n')}`,
  ).toEqual([]);
  expect(
    criticalConsoleErrors,
    `Critical console errors:\n${criticalConsoleErrors.join('\n')}`,
  ).toEqual([]);

  await context.close();
});
