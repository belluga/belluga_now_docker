const { test, expect } = require('@playwright/test');

const tenantUrl = process.env.NAV_TENANT_URL;
const appBootTimeoutMs = 120000;

test.describe.configure({ timeout: 300000 });

function requireTenantUrl() {
  expect(
    tenantUrl,
    'Missing NAV_TENANT_URL. Map permission grant readonly proof requires a live tenant URL.',
  ).toBeTruthy();
  return tenantUrl;
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

  for (let attempt = 0; attempt < 40; attempt += 1) {
    if ((await page.getByRole('button').count()) > 1) {
      return;
    }

    if ((await placeholder.count()) > 0) {
      await placeholder.focus();
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
      if ((await page.getByRole('button').count()) > 1) {
        return;
      }
    } else if ((await a11yButton.count()) > 0) {
      await a11yButton.first().click();
      await page.waitForTimeout(300);
      if ((await page.getByRole('button').count()) > 1) {
        return;
      }
    }

    await page.waitForTimeout(200);
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

function attachMapRequestCapture(page) {
  const poiRequests = [];
  const poiResponses = [];
  const failedRequests = [];
  const consoleErrors = [];
  const pageErrors = [];

  page.on('request', (request) => {
    if (request.url().includes('/api/v1/map/pois')) {
      poiRequests.push(request.url());
    }
  });

  page.on('response', (response) => {
    if (response.url().includes('/api/v1/map/pois')) {
      poiResponses.push(
        (async () => {
          let bodyText = '';
          let stackCount = null;
          let parseError = null;
          try {
            bodyText = await response.text();
            const parsed = JSON.parse(bodyText);
            stackCount = Array.isArray(parsed?.stacks) ? parsed.stacks.length : null;
          } catch (error) {
            parseError = String(error);
          }
          return {
            status: response.status(),
            url: response.url(),
            stackCount,
            parseError,
            bodyPreview: bodyText.slice(0, 1000),
          };
        })(),
      );
    }
  });

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

  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  return {
    snapshot: async () => ({
      poiRequests: [...poiRequests],
      poiResponses: await Promise.all(poiResponses),
      failedRequests: [...failedRequests],
      consoleErrors: [...consoleErrors],
      pageErrors: [...pageErrors],
    }),
  };
}

test('@readonly MAP-LOC-GRANT-01 first warm geolocation-granted map entry loads POIs from a resolved origin without public error state', async ({
  browser,
}) => {
  const baseUrl = requireTenantUrl();
  const origin = new URL(baseUrl).origin;
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
  });
  await context.grantPermissions(['geolocation'], { origin });
  const page = await context.newPage();
  const mapCapture = attachMapRequestCapture(page);

  await context.setGeolocation({
    latitude: -20.671339,
    longitude: -40.495395,
    accuracy: 25,
  });

  const response = await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  expect(response, 'Tenant response should be available').not.toBeNull();
  expect(response.status(), 'Tenant response should be successful').toBeLessThan(400);

  await assertAppBooted(page);
  await enableAccessibilityIfNeeded(page);
  await waitForTenantPath(page, ['/']);

  await page.getByRole('tab', { name: /^Mapa$/i }).click();
  await waitForTenantPath(page, ['/mapa']);

  await expect
    .poll(
      async () => (await mapCapture.snapshot()).poiResponses.length,
      {
        timeout: appBootTimeoutMs,
        message: 'Warm geolocation-granted map entry must issue at least one POI response.',
      },
    )
    .toBeGreaterThan(0);

  await page.waitForTimeout(2000);

  await expect(
    page.getByText(/Não foi possível carregar os pontos de interesse/i),
    'Warm geolocation-granted map entry must not show the public POI error banner.',
  ).toHaveCount(0);

  const snapshot = await mapCapture.snapshot();
  expect(
    snapshot.failedRequests,
    `Unexpected failed requests:\n${snapshot.failedRequests.join('\n')}`,
  ).toEqual([]);
  expect(
    snapshot.pageErrors,
    `Unexpected page errors:\n${snapshot.pageErrors.join('\n')}`,
  ).toEqual([]);
  expect(
    snapshot.consoleErrors.filter((entry) => !entry.includes('status of 401')),
    `Unexpected console errors:\n${snapshot.consoleErrors.join('\n')}`,
  ).toEqual([]);

  const successfulPoiResponse = snapshot.poiResponses.find(
    (entry) => entry.status >= 200 && entry.status < 300,
  );
  expect(
    successfulPoiResponse,
    `Warm geolocation-granted map entry must produce a successful POI response. Responses:\n${JSON.stringify(snapshot.poiResponses, null, 2)}`,
  ).toBeTruthy();

  const firstPoiRequest = snapshot.poiRequests[0];
  expect(
    firstPoiRequest,
    'Permission-granted map entry must issue a POI request.',
  ).toBeTruthy();

  const firstPoiRequestUrl = new URL(firstPoiRequest);
  const originLat = firstPoiRequestUrl.searchParams.get('origin_lat');
  const originLng = firstPoiRequestUrl.searchParams.get('origin_lng');
  expect(originLat, `First POI request must include origin_lat. URL: ${firstPoiRequest}`).toBeTruthy();
  expect(originLng, `First POI request must include origin_lng. URL: ${firstPoiRequest}`).toBeTruthy();

  expect(Number(originLat), 'First POI request origin_lat must be numeric.').not.toBeNaN();
  expect(Number(originLng), 'First POI request origin_lng must be numeric.').not.toBeNaN();

  await context.close();
});

test('@readonly MAP-LOC-GRANT-02 permission-gated grant keeps the first map entry warm and loads POIs without public error state', async ({
  browser,
}) => {
  const baseUrl = requireTenantUrl();
  const origin = new URL(baseUrl).origin;
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  const mapCapture = attachMapRequestCapture(page);

  const response = await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  expect(response, 'Tenant response should be available').not.toBeNull();
  expect(response.status(), 'Tenant response should be successful').toBeLessThan(400);

  await assertAppBooted(page);
  await enableAccessibilityIfNeeded(page);
  await waitForTenantPath(page, ['/']);

  await page.getByRole('tab', { name: /^Mapa$/i }).click();
  const allowLocationButton = page.getByRole('button', {
    name: /Permitir localização/i,
  });
  await expect(allowLocationButton).toBeVisible({
    timeout: appBootTimeoutMs,
  });

  await context.grantPermissions(['geolocation'], { origin });
  await context.setGeolocation({
    latitude: -20.671339,
    longitude: -40.495395,
    accuracy: 25,
  });

  await allowLocationButton.click();
  await waitForTenantPath(page, ['/mapa']);

  await expect
    .poll(
      async () => (await mapCapture.snapshot()).poiResponses.length,
      {
        timeout: appBootTimeoutMs,
        message:
          'Permission-gated grant must issue at least one POI response on the first map entry.',
      },
    )
    .toBeGreaterThan(0);

  await page.waitForTimeout(2000);

  await expect(
    page.getByText(/Não foi possível carregar os pontos de interesse/i),
    'Permission-gated grant must not show the public POI error banner on first entry.',
  ).toHaveCount(0);

  const snapshot = await mapCapture.snapshot();
  expect(
    snapshot.failedRequests,
    `Unexpected failed requests:\n${snapshot.failedRequests.join('\n')}`,
  ).toEqual([]);
  expect(
    snapshot.pageErrors,
    `Unexpected page errors:\n${snapshot.pageErrors.join('\n')}`,
  ).toEqual([]);
  expect(
    snapshot.consoleErrors.filter((entry) => !entry.includes('status of 401')),
    `Unexpected console errors:\n${snapshot.consoleErrors.join('\n')}`,
  ).toEqual([]);

  const successfulPoiResponse = snapshot.poiResponses.find(
    (entry) => entry.status >= 200 && entry.status < 300,
  );
  expect(
    successfulPoiResponse,
    `Permission-gated grant must produce a successful POI response. Responses:\n${JSON.stringify(snapshot.poiResponses, null, 2)}`,
  ).toBeTruthy();

  const firstPoiRequest = snapshot.poiRequests[0];
  expect(
    firstPoiRequest,
    'Permission-gated grant must issue a POI request.',
  ).toBeTruthy();

  const firstPoiRequestUrl = new URL(firstPoiRequest);
  const originLat = firstPoiRequestUrl.searchParams.get('origin_lat');
  const originLng = firstPoiRequestUrl.searchParams.get('origin_lng');
  expect(
    originLat,
    `First POI request must include origin_lat. URL: ${firstPoiRequest}`,
  ).toBeTruthy();
  expect(
    originLng,
    `First POI request must include origin_lng. URL: ${firstPoiRequest}`,
  ).toBeTruthy();

  expect(Number(originLat), 'First POI request origin_lat must be numeric.').not.toBeNaN();
  expect(Number(originLng), 'First POI request origin_lng must be numeric.').not.toBeNaN();

  const firstPoiResponse = snapshot.poiResponses[0];
  expect(
    firstPoiResponse,
    'Permission-gated grant must return a first POI response.',
  ).toBeTruthy();
  expect(
    firstPoiResponse.status,
    `First POI response must be successful. Responses:\n${JSON.stringify(snapshot.poiResponses, null, 2)}`,
  ).toBeGreaterThanOrEqual(200);
  expect(firstPoiResponse.status).toBeLessThan(300);
  expect(
    firstPoiResponse.parseError,
    `First POI response must stay JSON-decodable. Response:\n${JSON.stringify(firstPoiResponse, null, 2)}`,
  ).toBeNull();
  expect(
    firstPoiResponse.stackCount,
    `First POI response must already carry non-empty stacks. Response:\n${JSON.stringify(firstPoiResponse, null, 2)}`,
  ).toBeGreaterThan(0);

  await context.close();
});
