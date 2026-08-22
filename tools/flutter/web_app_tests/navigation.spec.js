const crypto = require('crypto');
const { test, expect } = require('@playwright/test');
const {
  fixture,
  managedFixtureEnabled,
  matchesCanonicalManagedSlug,
  rowFingerprint,
  shouldContinuePagedFetch,
  withManagedFixtureRunKeyScope,
} = require('./support/public_taxonomy_validation_fixture_contract');
const {
  installFailureCollectors,
  summarizeCriticalBrowserFailures,
} = require('./support/browser_failure_collectors');

const landlordUrl = process.env.NAV_LANDLORD_URL;
const tenantUrl = process.env.NAV_TENANT_URL;
const appBootTimeoutMs = 90000;

// The stage smoke exercises multiple live tenant routes sequentially.
// Keep the file timeout above the per-route boot budget so slow-but-healthy
// hosts do not fail before the readonly sweep finishes.
test.describe.configure({ timeout: 300000 });

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

function applicationOrigins() {
  return [landlordUrl, tenantUrl]
    .filter(Boolean)
    .map((value) => new URL(value).origin);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function payloadRows(payload) {
  if (Array.isArray(payload?.data)) {
    return payload.data;
  }
  if (Array.isArray(payload?.items)) {
    return payload.items;
  }
  if (Array.isArray(payload?.data?.items)) {
    return payload.data.items;
  }
  if (Array.isArray(payload)) {
    return payload;
  }
  return [];
}

function anonymousAgendaFingerprintHash(baseUrl) {
  return crypto
    .createHash('sha256')
    .update(withManagedFixtureRunKeyScope(`navigation-agenda:${baseUrl}`))
    .digest('hex');
}

function isApplicationApiRequest(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (_) {
    return false;
  }

  return applicationOrigins().includes(parsed.origin) && parsed.pathname.startsWith('/api/');
}

function installReadonlyCollectors(page) {
  const collectors = installFailureCollectors(page);
  const mutatingApiRequests = [];

  page.on('request', (request) => {
    const method = (request.method() || '').toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return;
    }
    const url = request.url();
    if (!isApplicationApiRequest(url)) {
      return;
    }
    mutatingApiRequests.push(`${method} ${url}`);
  });

  return { ...collectors, mutatingApiRequests };
}

function browserFailureEntryUrl(entry) {
  const match = String(entry).match(/^\S+\s+(\S+)/);
  return match?.[1] || null;
}

function browserFailureEntriesForOrigin(entries, origin) {
  return entries.filter((entry) => {
    const entryUrl = browserFailureEntryUrl(entry);
    if (!entryUrl) {
      return true;
    }

    try {
      return new URL(entryUrl).origin === origin;
    } catch (_) {
      return true;
    }
  });
}

function hasExternalEnvironmentProbeFailure(entries, targetOrigin) {
  return entries.some((entry) => {
    const entryUrl = browserFailureEntryUrl(entry);
    if (!entryUrl) {
      return false;
    }

    try {
      const parsed = new URL(entryUrl);
      return (
        parsed.origin !== targetOrigin &&
        parsed.pathname === '/api/v1/environment'
      );
    } catch (_) {
      return false;
    }
  });
}

async function assertAppBooted(page) {
  await expect(page.locator('flt-glass-pane')).toHaveCount(1, {
    timeout: appBootTimeoutMs,
  });
  await expect(page.locator('#splash-screen')).toHaveCount(0, {
    timeout: appBootTimeoutMs,
  });
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
  const placeholder = page
    .locator('flt-semantics-placeholder[aria-label="Enable accessibility"]')
    .first();
  const a11yButton = page.getByRole('button', { name: /Enable accessibility/i });

  for (let attempt = 0; attempt < 25; attempt += 1) {
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

async function scrollPageUntilLocatorVisible(
  page,
  locator,
  {
    timeout = appBootTimeoutMs,
    step = 900,
    settleMs = 300,
  } = {},
) {
  const viewport =
    page.viewportSize() ||
    (await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    })));
  await page.mouse.move(viewport.width * 0.62, viewport.height * 0.72).catch(() => {});
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const candidate = locator.first();
    const count = await candidate.count().catch(() => 0);
    if (count > 0) {
      await candidate.scrollIntoViewIfNeeded({
        timeout: Math.min(2000, Math.max(deadline - Date.now(), 250)),
      }).catch(() => {});
      if (await candidate.isVisible().catch(() => false)) {
        return candidate;
      }
    }

    await page.mouse.wheel(0, step).catch(() => {});

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      break;
    }

    await page.waitForTimeout(Math.min(settleMs, remainingMs));
  }

  return null;
}

async function resolveAnonymousIdentityToken(apiRequest, baseUrl) {
  const response = await apiRequest.post(
    new URL('/api/v1/anonymous/identities', baseUrl).toString(),
    {
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      data: {
        device_name: 'playwright-navigation-agenda',
        fingerprint: {
          hash: anonymousAgendaFingerprintHash(baseUrl),
          user_agent: 'playwright-navigation-agenda',
          locale: 'pt-BR',
        },
        metadata: {
          source: 'web_navigation_agenda',
        },
      },
    }
  );
  expect([200, 201]).toContain(response.status());
  const payload = await response.json();
  const token = payload?.data?.token?.toString().trim() || '';
  expect(token, 'Anonymous agenda API proof requires an identity token.').toBeTruthy();
  return token;
}

async function findManagedFixtureInPublicAgenda(apiRequest, baseUrl) {
  const token = await resolveAnonymousIdentityToken(apiRequest, baseUrl);
  const pageSummaries = [];
  let previousFingerprint = null;

  for (let pageNumber = 1; pageNumber <= 100; pageNumber += 1) {
    const url = new URL('/api/v1/agenda', baseUrl);
    url.searchParams.set('page', pageNumber.toString());
    url.searchParams.set('page_size', '50');

    const response = await apiRequest.get(url.toString(), {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });
    expect(
      response.status(),
      `Managed agenda proof page ${pageNumber} must load successfully.`,
    ).toBeLessThan(400);

    const payload = await response.json();
    const rows = payloadRows(payload);
    const candidate = rows.find((row) =>
      matchesCanonicalManagedSlug(row?.slug, fixture.eventSlug)
    );

    pageSummaries.push({
      page: pageNumber,
      count: rows.length,
      currentPage: payload?.current_page ?? null,
      lastPage: payload?.last_page ?? null,
      nextPageUrl: payload?.next_page_url ?? null,
      fixtureVisible: Boolean(candidate),
    });

    if (candidate) {
      return { candidate, pageSummaries };
    }

    const fingerprint = JSON.stringify(rows.map(rowFingerprint));
    if (pageNumber > 1 && fingerprint === previousFingerprint) {
      throw new Error(
        'Managed agenda proof repeated the same page payload without advancing pagination.',
      );
    }
    previousFingerprint = fingerprint;

    if (!shouldContinuePagedFetch({
      payload,
      pageRows: rows,
      pageNumber,
      pageSize: 50,
    })) {
      break;
    }
  }

  return {
    candidate: null,
    pageSummaries,
  };
}

test('@readonly landlord domain bootstraps as landlord and navigates', async ({ page }) => {
  const { landlordUrl } = requireNavigationUrls();
  const collectors = installReadonlyCollectors(page);

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
    ['/', '/admin', '/landlord', '/auth/login'],
    'landlord'
  );
  await probePath(
    page,
    landlordUrl,
    '/home',
    ['/admin', '/auth/login', '/'],
    'landlord'
  );
  await probePath(
    page,
    landlordUrl,
    '/landlord',
    ['/admin', '/auth/login', '/'],
    'landlord'
  );

  const landlordOrigin = new URL(landlordUrl).origin;
  const hasOptionalExternalEnvironmentProbeFailure =
    hasExternalEnvironmentProbeFailure(collectors.failedRequests, landlordOrigin);
  const summary = summarizeCriticalBrowserFailures(collectors, {
    allowedConsoleErrorSubstrings: hasOptionalExternalEnvironmentProbeFailure
      ? ['Failed to load resource: net::ERR_NAME_NOT_RESOLVED']
      : [],
  });
  expect(summary.runtimeErrors, `Unexpected runtime errors:\n${summary.runtimeErrors.join('\n')}`).toEqual([]);
  expect(
    browserFailureEntriesForOrigin(summary.failedRequests, landlordOrigin),
    `Failed landlord-origin requests:\n${summary.failedRequests.join('\n')}`,
  ).toEqual([]);
  expect(
    browserFailureEntriesForOrigin(summary.criticalHttpResponses, landlordOrigin),
    `Critical landlord-origin HTTP responses:\n${summary.criticalHttpResponses.join('\n')}`,
  ).toEqual([]);
  expect(
    summary.disallowedRateLimitedResponses,
    `Disallowed 429 responses:\n${summary.disallowedRateLimitedResponses.join('\n')}`,
  ).toEqual([]);
  expect(
    summary.criticalConsoleErrors,
    `Critical console errors:\n${summary.criticalConsoleErrors.join('\n')}`,
  ).toEqual([]);
  expect(
    collectors.mutatingApiRequests,
    `Readonly landlord flow must not issue mutating API requests:\n${collectors.mutatingApiRequests.join('\n')}`,
  ).toEqual([]);
});

test('@readonly tenant domain bootstraps as tenant and navigates to tenant routes', async ({ page }) => {
  const { tenantUrl } = requireNavigationUrls();
  const collectors = installFailureCollectors(page);
  let anonymousIdentityStatus = null;

  page.on('response', (response) => {
    if (response.url().includes('/api/v1/anonymous/identities')) {
      anonymousIdentityStatus = response.status();
    }
  });

  const response = await page.goto(tenantUrl, { waitUntil: 'domcontentloaded' });
  expect(response, 'Tenant response should be available').not.toBeNull();
  expect(response.status(), 'Tenant response should be successful').toBeLessThan(400);

  await assertEnvironmentType(page, tenantUrl, 'tenant');

  await assertAppBooted(page);
  await waitForLanding(page, ['/', '/invites', '/convites', '/profile']);
  await logLandingHref(page, 'tenant');
  await page.waitForTimeout(1500);

  if (anonymousIdentityStatus != null) {
    expect(
      [200, 201],
      'Anonymous identity bootstrap, when present, must be successful.',
    ).toContain(anonymousIdentityStatus);
  }

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
    ['/workspace', '/baixe-o-app', '/auth/login', '/'],
    'tenant'
  );
  await probePath(
    page,
    tenantUrl,
    '/workspace/account-demo',
    ['/workspace/account-demo', '/workspace', '/baixe-o-app', '/auth/login'],
    'tenant'
  );

  const summary = summarizeCriticalBrowserFailures(collectors);
  expect(summary.runtimeErrors, `Unexpected runtime errors:\n${summary.runtimeErrors.join('\n')}`).toEqual([]);
  expect(summary.failedRequests, `Failed requests:\n${summary.failedRequests.join('\n')}`).toEqual([]);
  expect(
    summary.criticalHttpResponses,
    `Critical HTTP responses:\n${summary.criticalHttpResponses.join('\n')}`,
  ).toEqual([]);
  expect(
    summary.disallowedRateLimitedResponses,
    `Disallowed 429 responses:\n${summary.disallowedRateLimitedResponses.join('\n')}`,
  ).toEqual([]);
  expect(
    summary.criticalConsoleErrors,
    `Critical console errors:\n${summary.criticalConsoleErrors.join('\n')}`,
  ).toEqual([]);
});

test('@mutation tenant agenda UI state matches tenant agenda API payload', async ({ browser, request }) => {
  const { tenantUrl } = requireNavigationUrls();
  const tenantOrigin = new URL(tenantUrl).origin;
  const isHomeAgendaRequest = (sample) =>
    (sample.pastOnly == null || sample.pastOnly === '0') &&
    (sample.confirmedOnly == null || sample.confirmedOnly === '0') &&
    (sample.searchQuery == null || sample.searchQuery.trim() === '');

  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    geolocation: { latitude: -20.671339, longitude: -40.495395 },
    permissions: ['geolocation'],
  });
  const page = await context.newPage();
  const collectors = installFailureCollectors(page);
  const agendaResponses = [];
  const homeAgendaResponses = [];
  const agendaErrorResponses = [];
  const agendaSamples = [];
  const homeAgendaSamples = [];
  const homeAgendaParseErrors = [];
  let anonymousIdentityStatus = null;

  const tenantEnvironment = await assertEnvironmentType(page, tenantUrl, 'tenant');
  const defaultOrigin = resolveDefaultOrigin(tenantEnvironment);
  if (defaultOrigin != null) {
    expect(
      Number.isFinite(Number(defaultOrigin.lat)),
      'default_origin.lat must be numeric when default_origin is exposed.',
    ).toBeTruthy();
    expect(
      Number.isFinite(Number(defaultOrigin.lng)),
      'default_origin.lng must be numeric when default_origin is exposed.',
    ).toBeTruthy();
  }

  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('/api/v1/anonymous/identities')) {
      anonymousIdentityStatus = response.status();
      return;
    }
    if (!url.includes('/api/v1/agenda')) {
      return;
    }
    const requestUrl = new URL(url);
    const sampleBase = {
      page: requestUrl.searchParams.get('page') ?? '1',
      pageSize: requestUrl.searchParams.get('page_size'),
      pastOnly: requestUrl.searchParams.get('past_only'),
      confirmedOnly: requestUrl.searchParams.get('confirmed_only'),
      searchQuery: requestUrl.searchParams.get('search'),
      originLat: requestUrl.searchParams.get('origin_lat'),
      originLng: requestUrl.searchParams.get('origin_lng'),
      url,
      status: response.status(),
    };
    if (response.status() >= 400) {
      agendaErrorResponses.push(sampleBase);
      return;
    }
    agendaResponses.push(sampleBase);
    const isHomeRequest = isHomeAgendaRequest(sampleBase);
    if (isHomeRequest) {
      homeAgendaResponses.push(sampleBase);
    }
    try {
      const body = await response.json();
      const hasCanonicalItemsArray =
        Array.isArray(body?.items) || Array.isArray(body?.data?.items);
      if (!hasCanonicalItemsArray) {
        if (isHomeRequest) {
          homeAgendaParseErrors.push(
            `Canonical home agenda payload missing items array: ${sampleBase.status} ${sampleBase.url}`,
          );
        }
        return;
      }
      const items = Array.isArray(body?.items) ? body.items : body.data.items;
      agendaSamples.push({
        page: sampleBase.page,
        count: items.length,
        originLat: sampleBase.originLat,
        originLng: sampleBase.originLng,
        url: sampleBase.url,
        status: sampleBase.status,
      });
      if (isHomeRequest) {
        homeAgendaSamples.push({
          page: sampleBase.page,
          count: items.length,
          originLat: sampleBase.originLat,
          originLng: sampleBase.originLng,
          url: sampleBase.url,
          status: sampleBase.status,
          fixtureVisible: items.some((row) =>
            matchesCanonicalManagedSlug(row?.slug, fixture.eventSlug),
          ),
        });
      }
    } catch (_) {
      if (isHomeRequest) {
        homeAgendaParseErrors.push(
          `Canonical home agenda payload is not valid JSON: ${sampleBase.status} ${sampleBase.url}`,
        );
      }
    }
  });

  const response = await page.goto(tenantUrl, { waitUntil: 'domcontentloaded' });
  expect(response, 'Tenant response should be available').not.toBeNull();
  expect(response.status(), 'Tenant response should be successful').toBeLessThan(400);
  await assertAppBooted(page);
  await enableAccessibilityIfNeeded(page);
  const defaultEmptyStateText = page.getByText('Nenhum evento disponível no momento');
  const filteredEmptyStateText = page.getByText('Nenhum resultado encontrado');

  await expect
    .poll(
      () => [200, 201].includes(anonymousIdentityStatus),
      {
        timeout: appBootTimeoutMs,
        message: 'Expected anonymous identity bootstrap call on tenant public startup.',
      },
    )
    .toBe(true);

  await expect
    .poll(
      async () =>
        homeAgendaResponses.length > 0 ||
        agendaErrorResponses.length > 0 ||
        (await defaultEmptyStateText.count()) > 0 ||
        (await filteredEmptyStateText.count()) > 0,
      {
        timeout: appBootTimeoutMs,
        message:
          'Expected canonical home agenda response or explicit empty-state UI on tenant startup.',
      },
    )
    .toBe(true);

  expect(
    anonymousIdentityStatus,
    'Expected anonymous identity bootstrap call on tenant public startup.',
  ).not.toBeNull();
  expect(
    [200, 201],
    'Anonymous identity bootstrap must be idempotent-success (200/201).',
  ).toContain(anonymousIdentityStatus);
  expect(
    agendaErrorResponses,
    `Agenda API returned HTTP >= 400:\n${agendaErrorResponses
      .map((sample) => `${sample.status} ${sample.url}`)
      .join('\n')}`,
  ).toEqual([]);

  const samplesWithClientPageSize = agendaResponses.filter(
    (sample) => sample.pageSize != null,
  );
  expect(
    samplesWithClientPageSize,
    `Agenda requests must rely on the API default page size and omit client-sent page_size:\n${samplesWithClientPageSize
      .map((sample) => sample.url)
      .join('\n')}`,
  ).toEqual([]);

  const hasVisibleEmptyState =
    (await defaultEmptyStateText.count()) > 0 ||
    (await filteredEmptyStateText.count()) > 0;
  const hasHomeAgendaResponses = homeAgendaResponses.length > 0;
  if (!hasHomeAgendaResponses) {
    expect(
      hasVisibleEmptyState,
      `Expected canonical home /api/v1/agenda request ` +
        `(past_only=0, confirmed_only=0, no search, API-default page size) ` +
        `or explicit empty-state UI when home agenda is unavailable.\n` +
        `Observed agenda requests:\n${agendaResponses.map((sample) => sample.url).join('\n')}`,
    ).toBeTruthy();
  }

  expect(
    homeAgendaParseErrors,
    `Canonical home agenda payload parse/contract failures:\n${homeAgendaParseErrors.join('\n')}`,
  ).toEqual([]);

  const firstPageHomeSamples = homeAgendaResponses.filter((sample) => sample.page === '1');
  const originSamples = firstPageHomeSamples.length > 0 ? firstPageHomeSamples : homeAgendaResponses;
  const samplesMissingOrigin = originSamples.filter(
    (sample) => !sample.originLat || !sample.originLng,
  );
  expect(
    samplesMissingOrigin,
    `All inspected agenda requests must include origin_lat/origin_lng:\n${samplesMissingOrigin
      .map((sample) => sample.url)
      .join('\n')}`,
  ).toEqual([]);

  const samplesWithInvalidOrigin = originSamples.filter(
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

  const firstPageHomePayloadSamples = homeAgendaSamples.filter((sample) => sample.page === '1');
  const payloadSamples = firstPageHomePayloadSamples.length > 0
    ? firstPageHomePayloadSamples
    : homeAgendaSamples;
  const maxAgendaCount = payloadSamples.reduce(
    (currentMax, sample) => (sample.count > currentMax ? sample.count : currentMax),
    0,
  );

  if (maxAgendaCount > 0) {
    await expect(
      defaultEmptyStateText,
      'Agenda API returned items, but UI still shows empty state.',
    ).toHaveCount(0);
    await expect(
      filteredEmptyStateText,
      'Agenda API returned items, but UI still shows filtered-empty state.',
    ).toHaveCount(0);
  }

  if (managedFixtureEnabled) {
    const { candidate: managedFixtureCandidate, pageSummaries } =
      await findManagedFixtureInPublicAgenda(request, tenantUrl);
    expect(
      managedFixtureCandidate,
      `Managed home agenda fixture ${fixture.eventSlug} must be visible somewhere in the canonical public /api/v1/agenda pagination when NAV_PUBLIC_TAXONOMY_MANAGED_FIXTURE=1.\n` +
        `Observed agenda page summaries:\n${JSON.stringify(pageSummaries, null, 2)}`,
    ).toBeTruthy();

    const managedFixtureVisibleOnInitialHomePayload = payloadSamples.some(
      (sample) => sample.fixtureVisible,
    );
    const managedFixtureLabel =
      managedFixtureCandidate?.title?.toString().trim() || fixture.eventTitle;
    const managedFixtureTitle = page
      .getByText(new RegExp(escapeRegExp(managedFixtureLabel), 'i'))
      .first();
    const visibleManagedFixtureTitle = await scrollPageUntilLocatorVisible(
      page,
      managedFixtureTitle,
      {
        timeout: appBootTimeoutMs,
      },
    );
    const renderExpectationQualifier = managedFixtureVisibleOnInitialHomePayload
      ? 'it is already present in the initial home agenda payload'
      : 'the home feed paginates into the later agenda page that contains it';
    expect(
      visibleManagedFixtureTitle,
      `Managed home agenda fixture ${managedFixtureLabel} must render on the tenant home surface when ${renderExpectationQualifier}.`,
    ).toBeTruthy();
    await expect(
      visibleManagedFixtureTitle,
      `Managed home agenda fixture ${managedFixtureLabel} must render on the tenant home surface when ${renderExpectationQualifier}.`,
    ).toBeVisible({
      timeout: appBootTimeoutMs,
    });
  }

  const summary = summarizeCriticalBrowserFailures(collectors);
  const criticalFailedRequests = summary.failedRequests.filter((entry) =>
    entry.includes(tenantOrigin) && entry.includes('/api/'),
  );

  expect(
    summary.runtimeErrors,
    `Unexpected runtime errors:\n${summary.runtimeErrors.join('\n')}`,
  ).toEqual([]);
  expect(
    criticalFailedRequests,
    `Critical failed API requests:\n${criticalFailedRequests.join('\n')}`,
  ).toEqual([]);
  expect(
    summary.criticalConsoleErrors,
    `Critical console errors:\n${summary.criticalConsoleErrors.join('\n')}`,
  ).toEqual([]);

  await context.close();
});
