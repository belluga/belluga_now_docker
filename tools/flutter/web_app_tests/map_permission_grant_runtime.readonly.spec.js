const { test, expect } = require('@playwright/test');
const { withFreshBrowserPage } = require('./support/fresh_browser_context');

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
  const anonymousIdentityResponses = [];
  const requestTimeline = [];
  const filterRequests = [];
  const filterResponses = [];
  const poiRequests = [];
  const poiResponses = [];
  const failedRequests = [];
  const consoleErrors = [];
  const pageErrors = [];
  const responseTimeline = [];
  const eventTimeline = [];
  let timelineSequence = 0;

  const classifyPath = (url) => {
    const pathname = new URL(url).pathname;
    if (pathname === '/api/v1/anonymous/identities') {
      return 'anonymous_identity';
    }
    if (pathname === '/api/v1/map/filters') {
      return 'map_filters';
    }
    if (pathname === '/api/v1/map/pois') {
      return 'map_pois';
    }
    return null;
  };

  page.on('request', (request) => {
    const kind = classifyPath(request.url());
    if (kind == null) {
      return;
    }

    const sequence = timelineSequence += 1;
    requestTimeline.push({
      seq: sequence,
      kind,
      url: request.url(),
    });
    eventTimeline.push({
      seq: sequence,
      phase: 'request',
      kind,
      url: request.url(),
    });

    if (kind === 'map_filters') {
      filterRequests.push(request.url());
    }
    if (kind === 'map_pois') {
      poiRequests.push(request.url());
    }
  });

  page.on('response', (response) => {
    const kind = classifyPath(response.url());
    if (kind == null) {
      return;
    }

    const sequence = timelineSequence += 1;
    responseTimeline.push({
      seq: sequence,
      kind,
      status: response.status(),
      url: response.url(),
    });
    eventTimeline.push({
      seq: sequence,
      phase: 'response',
      kind,
      status: response.status(),
      url: response.url(),
    });

    if (kind === 'anonymous_identity') {
      anonymousIdentityResponses.push(
        Promise.resolve({
          seq: sequence,
          status: response.status(),
          url: response.url(),
        }),
      );
      return;
    }

    const targetResponses =
      kind === 'map_filters'
        ? filterResponses
        : poiResponses;
    targetResponses.push(
      (async () => {
        let bodyText = '';
        let parseError = null;
        let stackCount = null;
        let itemCount = null;
        try {
          bodyText = await response.text();
          const parsed = JSON.parse(bodyText);
          if (kind === 'map_pois') {
            stackCount = Array.isArray(parsed?.stacks) ? parsed.stacks.length : null;
          }
          if (kind === 'map_filters') {
            const normalized = parsed?.data ?? parsed;
            if (Array.isArray(normalized)) {
              itemCount = normalized.length;
            } else if (Array.isArray(normalized?.items)) {
              itemCount = normalized.items.length;
            }
          }
        } catch (error) {
          parseError = String(error);
        }
        return {
          seq: sequence,
          kind,
          status: response.status(),
          url: response.url(),
          stackCount,
          itemCount,
          parseError,
          bodyPreview: bodyText.slice(0, 1000),
        };
      })(),
    );
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
      anonymousIdentityResponses: await Promise.all(anonymousIdentityResponses),
      requestTimeline: [...requestTimeline],
      filterRequests: [...filterRequests],
      filterResponses: await Promise.all(filterResponses),
      poiRequests: [...poiRequests],
      poiResponses: await Promise.all(poiResponses),
      failedRequests: [...failedRequests],
      consoleErrors: [...consoleErrors],
      pageErrors: [...pageErrors],
      responseTimeline: [...responseTimeline],
      eventTimeline: [...eventTimeline],
    }),
  };
}

function assertCanonicalBootstrapOrder(snapshot, contextLabel) {
  const successfulAnonymousBootstrap = snapshot.responseTimeline.find(
    (entry) =>
      entry.kind === 'anonymous_identity'
      && (entry.status === 200 || entry.status === 201),
  );
  const firstProtectedMapRequest = snapshot.requestTimeline.find(
    (entry) => entry.kind === 'map_filters' || entry.kind === 'map_pois',
  );
  const firstProtectedMapResponse = snapshot.responseTimeline.find(
    (entry) => entry.kind === 'map_filters' || entry.kind === 'map_pois',
  );

  expect(
    successfulAnonymousBootstrap,
    `${contextLabel} must record a successful anonymous bootstrap response before any protected map response.`,
  ).toBeTruthy();
  expect(
    firstProtectedMapRequest,
    `${contextLabel} must record a protected map request.`,
  ).toBeTruthy();
  expect(
    firstProtectedMapResponse,
    `${contextLabel} must record a protected map response.`,
  ).toBeTruthy();
  expect(
    snapshot.requestTimeline.filter(
      (entry) =>
        (entry.kind === 'map_filters' || entry.kind === 'map_pois')
        && entry.seq < successfulAnonymousBootstrap.seq,
    ),
    `${contextLabel} must not issue protected map requests before anonymous bootstrap succeeds. Event timeline:\n${JSON.stringify(snapshot.eventTimeline, null, 2)}`,
  ).toEqual([]);
  expect(
    firstProtectedMapResponse.status,
    `${contextLabel} first protected map response must be successful, not a failed warm-up hidden by retries. Event timeline:\n${JSON.stringify(snapshot.eventTimeline, null, 2)}`,
  ).toBeGreaterThanOrEqual(200);
  expect(firstProtectedMapResponse.status).toBeLessThan(400);
}

function assertCanonicalMapSnapshot(snapshot, contextLabel) {
  expect(
    snapshot.failedRequests,
    `Unexpected failed requests during ${contextLabel}:\n${snapshot.failedRequests.join('\n')}`,
  ).toEqual([]);
  expect(
    snapshot.pageErrors,
    `Unexpected page errors during ${contextLabel}:\n${snapshot.pageErrors.join('\n')}`,
  ).toEqual([]);
  expect(
    snapshot.consoleErrors,
    `Unexpected console errors during ${contextLabel}:\n${snapshot.consoleErrors.join('\n')}`,
  ).toEqual([]);

  assertCanonicalBootstrapOrder(snapshot, contextLabel);

  const successfulFilterResponse = snapshot.filterResponses.find(
    (entry) => entry.status >= 200 && entry.status < 300,
  );
  expect(
    successfulFilterResponse,
    `${contextLabel} must produce a successful map filters response. Responses:\n${JSON.stringify(snapshot.filterResponses, null, 2)}`,
  ).toBeTruthy();
  expect(
    successfulFilterResponse.parseError,
    `${contextLabel} must keep the first successful map filters response JSON-decodable. Response:\n${JSON.stringify(successfulFilterResponse, null, 2)}`,
  ).toBeNull();

  const successfulPoiResponse = snapshot.poiResponses.find(
    (entry) => entry.status >= 200 && entry.status < 300,
  );
  expect(
    successfulPoiResponse,
    `${contextLabel} must produce a successful POI response. Responses:\n${JSON.stringify(snapshot.poiResponses, null, 2)}`,
  ).toBeTruthy();

  const firstPoiRequest = snapshot.poiRequests[0];
  expect(
    firstPoiRequest,
    `${contextLabel} must issue a POI request.`,
  ).toBeTruthy();

  const firstPoiRequestUrl = new URL(firstPoiRequest);
  const originLat = firstPoiRequestUrl.searchParams.get('origin_lat');
  const originLng = firstPoiRequestUrl.searchParams.get('origin_lng');
  expect(originLat, `First POI request must include origin_lat. URL: ${firstPoiRequest}`).toBeTruthy();
  expect(originLng, `First POI request must include origin_lng. URL: ${firstPoiRequest}`).toBeTruthy();
  expect(Number(originLat), 'First POI request origin_lat must be numeric.').not.toBeNaN();
  expect(Number(originLng), 'First POI request origin_lng must be numeric.').not.toBeNaN();
}

async function waitForCanonicalMapResponses(mapCapture, contextLabel) {
  await expect
    .poll(
      async () => {
        const snapshot = await mapCapture.snapshot();
        const hasSuccessfulFilters = snapshot.filterResponses.some(
          (entry) => entry.status >= 200 && entry.status < 300,
        );
        const hasSuccessfulPois = snapshot.poiResponses.some(
          (entry) => entry.status >= 200 && entry.status < 300,
        );
        return hasSuccessfulFilters && hasSuccessfulPois;
      },
      {
        timeout: appBootTimeoutMs,
        message: `${contextLabel} must observe successful map filters and POI responses before snapshotting.`,
      },
    )
    .toBe(true);
}

test('@readonly MAP-LOC-GRANT-01 first warm geolocation-granted map entry loads POIs from a resolved origin without public error state', async () => {
  const baseUrl = requireTenantUrl();
  const origin = new URL(baseUrl).origin;
  await withFreshBrowserPage(async ({ context, page }) => {
    await context.grantPermissions(['geolocation'], { origin });
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

    await waitForCanonicalMapResponses(
      mapCapture,
      'Warm geolocation-granted map entry',
    );

    await expect(
      page.getByText(/Não foi possível carregar os pontos de interesse/i),
      'Warm geolocation-granted map entry must not show the public POI error banner.',
    ).toHaveCount(0);

    const snapshot = await mapCapture.snapshot();
    assertCanonicalMapSnapshot(
      snapshot,
      'warm geolocation-granted map entry',
    );
  });
});

test('@readonly MAP-LOC-GRANT-02 location-permission CTA continuation loads canonical map data once browser geolocation is granted', async () => {
  const baseUrl = requireTenantUrl();
  const origin = new URL(baseUrl).origin;
  await withFreshBrowserPage(async ({ context, page }) => {
    const mapCapture = attachMapRequestCapture(page);

    const response = await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    expect(response, 'Tenant response should be available').not.toBeNull();
    expect(response.status(), 'Tenant response should be successful').toBeLessThan(400);

    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);
    await waitForTenantPath(page, ['/']);

    await page.getByRole('tab', { name: /^Mapa$/i }).click();
    const locationPrimaryActionButton = page.getByRole('button', {
      name: /^(Permitir localização|Tentar novamente)$/i,
    });
    await expect(locationPrimaryActionButton).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    const locationPrimaryActionLabel =
      (await locationPrimaryActionButton.textContent())?.trim() ?? '<missing>';
    console.info(
      `[map-loc-grant-02] initial location CTA before grant: ${locationPrimaryActionLabel}`,
    );

    await context.grantPermissions(['geolocation'], { origin });
    await context.setGeolocation({
      latitude: -20.671339,
      longitude: -40.495395,
      accuracy: 25,
    });

    await locationPrimaryActionButton.click();
    await waitForTenantPath(page, ['/mapa']);

    await waitForCanonicalMapResponses(
      mapCapture,
      'Permission-gated grant first entry',
    );

    await expect(
      page.getByText(/Não foi possível carregar os pontos de interesse/i),
      'Permission-gated grant must not show the public POI error banner on first entry.',
    ).toHaveCount(0);

    const snapshot = await mapCapture.snapshot();
    assertCanonicalMapSnapshot(
      snapshot,
      'permission-gated map grant first entry',
    );

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
  });
});
