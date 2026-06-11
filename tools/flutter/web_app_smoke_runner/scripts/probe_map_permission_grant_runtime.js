#!/usr/bin/env node

const { chromium } = require('playwright');

const APP_BOOT_TIMEOUT_MS = 120000;
const GRANT_FLOW_TIMEOUT_MS = 30000;
const PROBE_WAIT_AFTER_POI_MS = 2000;

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function assertAppBooted(page) {
  const deadline = Date.now() + APP_BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const glassPaneCount = await page.locator('flt-glass-pane').count();
    const splashCount = await page.locator('#splash-screen').count();
    if (glassPaneCount === 1 && splashCount === 0) {
      return;
    }
    await page.waitForTimeout(300);
  }
  throw new Error('App did not finish booting before timeout.');
}

async function enableAccessibilityIfNeeded(page) {
  const placeholder = page
    .locator('flt-semantics-placeholder[aria-label="Enable accessibility"]')
    .first();
  const button = page.getByRole('button', {
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
    } else if ((await button.count()) > 0) {
      await button.first().click();
      await page.waitForTimeout(300);
      if ((await page.getByRole('button').count()) > 1) {
        return;
      }
    }

    await page.waitForTimeout(200);
  }

  throw new Error('Accessibility semantics did not become interactive.');
}

async function waitForTenantPath(page, allowedPrefixes) {
  const deadline = Date.now() + APP_BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const currentUrl = new URL(page.url());
    const { pathname, hash } = currentUrl;
    const pathMatches = allowedPrefixes.some((prefix) =>
      prefix === '/' ? pathname === '/' : pathname.startsWith(prefix),
    );
    const hashMatches = allowedPrefixes.some((prefix) =>
      prefix === '/'
        ? hash === '#' || hash === '#/'
        : hash.startsWith(`#${prefix}`),
    );
    if (pathMatches || hashMatches) {
      return;
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`Tenant path did not match ${allowedPrefixes.join(', ')}.`);
}

async function run() {
  const baseUrl = requireEnv('NAV_TENANT_URL');
  const origin = new URL(baseUrl).origin;
  const executablePath =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/google-chrome';

  const browser = await chromium.launch({
    headless: true,
    executablePath,
  });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  const anonymousIdentityResponses = [];
  const filterRequests = [];
  const filterResponses = [];
  const poiRequests = [];
  const poiResponses = [];
  const failedRequests = [];
  const pageErrors = [];
  const consoleErrors = [];
  const responseTimeline = [];
  let responseSequence = 0;

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

    const sequence = responseSequence += 1;
    responseTimeline.push({
      seq: sequence,
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

    const targetResponses = kind === 'map_filters'
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
          bodyPreview: bodyText.slice(0, 800),
        };
      })(),
    );
  });

  page.on('requestfailed', (request) => {
    const failureText = request.failure()?.errorText || 'unknown';
    if (failureText !== 'net::ERR_ABORTED') {
      failedRequests.push(
        `${request.method()} ${request.url()} (${failureText})`,
      );
    }
  });

  page.on('pageerror', (error) => {
    pageErrors.push(String(error));
  });

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  try {
    const response = await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    if (!response || response.status() >= 400) {
      throw new Error(
        `Tenant bootstrap failed: ${response ? response.status() : 'no response'}`,
      );
    }

    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);
    await waitForTenantPath(page, ['/']);

    const buildSha = await page.evaluate(() => window.__WEB_BUILD_SHA__ ?? null);
    const mainScriptSrc = await page.evaluate(() => {
      const script = [...document.scripts].find((entry) =>
        entry.src.includes('main.dart.js'),
      );
      return script?.src ?? null;
    });
    const bootstrapScriptSrc = await page.evaluate(() => {
      const script = [...document.scripts].find((entry) =>
        entry.src.includes('flutter_bootstrap.js'),
      );
      return script?.src ?? null;
    });

    await page.getByRole('tab', { name: /^Mapa$/i }).click();
    const allowButton = page.getByRole('button', {
      name: /Permitir localização/i,
    });
    await allowButton.waitFor({
      state: 'visible',
      timeout: GRANT_FLOW_TIMEOUT_MS,
    });

    await context.grantPermissions(['geolocation'], { origin });
    await context.setGeolocation({
      latitude: -20.671339,
      longitude: -40.495395,
      accuracy: 25,
    });

    await allowButton.click();
    await page.waitForURL(
      (url) => new URL(url).pathname === '/mapa',
      { timeout: GRANT_FLOW_TIMEOUT_MS },
    );
    await waitForTenantPath(page, ['/mapa']);

    const requestDeadline = Date.now() + GRANT_FLOW_TIMEOUT_MS;
    while ((poiResponses.length === 0 || filterResponses.length === 0) && Date.now() < requestDeadline) {
      await page.waitForTimeout(250);
    }

    await page.waitForTimeout(PROBE_WAIT_AFTER_POI_MS);

    const resolvedAnonymousIdentityResponses = await Promise.all(anonymousIdentityResponses);
    const resolvedFilterResponses = await Promise.all(filterResponses);
    const resolvedPoiResponses = await Promise.all(poiResponses);
    const errorBannerCount = await page
      .getByText(/Não foi possível carregar os pontos de interesse/i)
      .count();
    const firstPoiRequest = poiRequests[0] ? new URL(poiRequests[0]) : null;
    const firstPoiResponse = resolvedPoiResponses[0] || null;
    const successfulAnonymousBootstrap = resolvedAnonymousIdentityResponses.find(
      (entry) => entry.status === 200 || entry.status === 201,
    );
    const firstProtectedMapResponse = responseTimeline.find(
      (entry) =>
        (entry.kind === 'map_filters' || entry.kind === 'map_pois')
        && entry.status < 400,
    );
    const successfulPoiResponse = resolvedPoiResponses.find(
      (entry) => entry.status >= 200 && entry.status < 300,
    );
    const successfulFilterResponse = resolvedFilterResponses.find(
      (entry) => entry.status >= 200 && entry.status < 300,
    );

    const result = {
      finalUrl: page.url(),
      buildSha,
      mainScriptSrc,
      bootstrapScriptSrc,
      anonymousIdentityResponses: resolvedAnonymousIdentityResponses,
      filterRequests: [...filterRequests],
      filterResponses: resolvedFilterResponses,
      poiRequests: [...poiRequests],
      poiResponses: resolvedPoiResponses,
      failedRequests: [...failedRequests],
      pageErrors: [...pageErrors],
      consoleErrors: [...consoleErrors],
      responseTimeline: [...responseTimeline],
      errorBannerCount,
      firstPoiOriginLat: firstPoiRequest?.searchParams.get('origin_lat') ?? null,
      firstPoiOriginLng: firstPoiRequest?.searchParams.get('origin_lng') ?? null,
    };

    console.log(JSON.stringify(result, null, 2));

    const isGreen =
      result.finalUrl.includes('/mapa') &&
      result.errorBannerCount === 0 &&
      result.failedRequests.length === 0 &&
      result.pageErrors.length === 0 &&
      result.consoleErrors.length === 0 &&
      successfulAnonymousBootstrap &&
      firstProtectedMapResponse &&
      successfulAnonymousBootstrap.seq < firstProtectedMapResponse.seq &&
      successfulFilterResponse &&
      successfulFilterResponse.parseError == null &&
      firstPoiRequest &&
      result.firstPoiOriginLat &&
      result.firstPoiOriginLng &&
      firstPoiResponse &&
      firstPoiResponse.status >= 200 &&
      firstPoiResponse.status < 300 &&
      firstPoiResponse.parseError == null &&
      (firstPoiResponse.stackCount ?? 0) > 0 &&
      Boolean(successfulPoiResponse);

    if (!isGreen) {
      process.exitCode = 1;
    }
  } finally {
    await context.close();
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
