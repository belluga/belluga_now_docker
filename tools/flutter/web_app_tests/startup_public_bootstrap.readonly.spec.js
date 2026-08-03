const crypto = require('crypto');
const { test, expect, request } = require('@playwright/test');
const { withFreshBrowserPage } = require('./support/fresh_browser_context');
const {
  installFailureCollectors,
  summarizeCriticalConsoleErrors,
  summarizeCriticalHttpResponses,
} = require('./support/browser_failure_collectors');
const {
  fixture,
  managedFixtureEnabled,
  matchesCanonicalManagedSlug,
  rowFingerprint,
  shouldContinuePagedFetch,
  withManagedFixtureRunKeyScope,
} = require('./support/public_taxonomy_validation_fixture_contract');

const tenantUrl = process.env.NAV_TENANT_URL;
const appBootTimeoutMs = 120000;

test.describe.configure({ timeout: 300000 });

function requireTenantUrl() {
  expect(
    tenantUrl,
    'Missing NAV_TENANT_URL. Startup readonly proof requires a live tenant URL.',
  ).toBeTruthy();
  return tenantUrl;
}

function buildUrl(baseUrl, pathName) {
  return new URL(pathName, baseUrl).toString();
}

function buildApiRequestContext() {
  return request.newContext({
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: {
      Accept: 'application/json',
    },
  });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function semanticLabelLocator(page, label) {
  const escapedLabel = String(label)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
  return page.locator(`[aria-label*="${escapedLabel}"]`).first();
}

async function assertVisibleTextOrSemanticLabel(page, label, contextLabel) {
  const displayLabel = String(label || '').trim();
  expect(displayLabel, `${contextLabel} requires a non-empty label.`).toBeTruthy();

  const visibleText = page
    .getByText(new RegExp(escapeRegExp(displayLabel), 'i'))
    .first();
  const semanticLabel = semanticLabelLocator(page, displayLabel);

  await expect
    .poll(
      async () => {
        if ((await visibleText.count()) > 0 && (await visibleText.isVisible())) {
          return true;
        }
        return (await semanticLabel.count()) > 0 && (await semanticLabel.isVisible());
      },
      {
        timeout: appBootTimeoutMs,
        message: `${contextLabel} must render "${displayLabel}" as visible text or Flutter semantics.`,
      },
    )
    .toBe(true);
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
    await page.waitForTimeout(settleMs);
  }

  return null;
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

function exactPathMatcher(pathname, label = pathname) {
  return {
    label,
    matches(url) {
      const parsed = new URL(url);
      return parsed.pathname === pathname;
    },
  };
}

function eventDetailMatcher(eventRef, occurrenceId = null) {
  return {
    label: 'event_detail',
    matches(url) {
      const parsed = new URL(url);
      if (parsed.pathname !== `/api/v1/events/${eventRef}`) {
        return false;
      }
      return !occurrenceId || parsed.searchParams.get('occurrence') === occurrenceId;
    },
  };
}

function defaultProtectedReadMatchers() {
  return [
    exactPathMatcher('/api/v1/agenda', 'agenda'),
    // Home startup now warms the canonical agenda surface through the
    // home.events discovery-filter contract before the agenda feed request
    // itself becomes necessary, so readonly bootstrap must accept either path.
    exactPathMatcher('/api/v1/discovery-filters/home.events', 'agenda'),
    exactPathMatcher('/api/v1/map/filters', 'map_filters'),
    exactPathMatcher('/api/v1/map/pois', 'map_pois'),
    exactPathMatcher('/api/v1/invites/settings', 'invites_settings'),
    exactPathMatcher('/api/v1/invites', 'invites_feed'),
  ];
}

function attachStartupCapture(page, { protectedReadMatchers = defaultProtectedReadMatchers() } = {}) {
  const browserFailures = installFailureCollectors(page);
  const anonymousIdentityResponses = [];
  const requestTimeline = [];
  const protectedReadResponses = [];
  const protectedReadFailures = [];
  const openAppUrls = [];
  const popupUrls = [];
  const responseTimeline = [];
  const eventTimeline = [];
  let timelineSequence = 0;

  const matchedProtectedRead = (url) =>
    protectedReadMatchers.find((matcher) => matcher.matches(url));

  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/api/v1/anonymous/identities')) {
      const seq = timelineSequence += 1;
      const entry = {
        seq,
        kind: 'anonymous_identity',
        url,
      };
      requestTimeline.push(entry);
      eventTimeline.push({
        ...entry,
        phase: 'request',
      });
      return;
    }

    const protectedRead = matchedProtectedRead(url);
    if (!protectedRead) {
      return;
    }

    const seq = timelineSequence += 1;
    const entry = {
      seq,
      kind: 'protected_read',
      label: protectedRead.label,
      url,
    };
    requestTimeline.push(entry);
    eventTimeline.push({
      ...entry,
      phase: 'request',
    });
  });

  page.on('response', (response) => {
    const url = response.url();
    const seq = timelineSequence += 1;

    if (url.includes('/api/v1/anonymous/identities')) {
      const entry = {
        seq,
        status: response.status(),
        url,
      };
      anonymousIdentityResponses.push(entry);
      responseTimeline.push({
        ...entry,
        kind: 'anonymous_identity',
      });
      eventTimeline.push({
        ...entry,
        phase: 'response',
        kind: 'anonymous_identity',
      });
      return;
    }

    const matchedRead = matchedProtectedRead(url);
    if (matchedRead) {
      const entry = {
        seq,
        label: matchedRead.label,
        status: response.status(),
        url,
      };
      protectedReadResponses.push(entry);
      responseTimeline.push({
        ...entry,
        kind: 'protected_read',
      });
      eventTimeline.push({
        ...entry,
        phase: 'response',
        kind: 'protected_read',
      });
      if (response.status() >= 400) {
        protectedReadFailures.push(`${matchedRead.label}: ${response.status()} ${url}`);
      }
    }
  });

  page.on('request', (request) => {
    if (request.url().includes('/open-app')) {
      openAppUrls.push(request.url());
    }
  });

  page.on('popup', (popup) => {
    popupUrls.push(popup.url());
    popup.on('framenavigated', (frame) => {
      if (frame === popup.mainFrame()) {
        popupUrls.push(frame.url());
      }
    });
  });

  return {
    snapshot: () => ({
      anonymousIdentityResponses: [...anonymousIdentityResponses],
      requestTimeline: [...requestTimeline],
      protectedReadResponses: [...protectedReadResponses],
      protectedReadFailures: [...protectedReadFailures],
      openAppUrls: [...openAppUrls],
      popupUrls: [...popupUrls],
      consoleErrors: [...browserFailures.consoleErrors],
      consoleErrorUrls: [...browserFailures.consoleErrorUrls],
      ignoredFailedRequests: [...browserFailures.ignoredFailedRequests],
      mediaErrorResponses: [...browserFailures.mediaErrorResponses],
      httpErrorResponses: [...browserFailures.httpErrorResponses],
      pageErrors: [...browserFailures.runtimeErrors],
      responseTimeline: [...responseTimeline],
      eventTimeline: [...eventTimeline],
    }),
  };
}

function anonymousFingerprintHash(baseUrl) {
  return crypto
    .createHash('sha256')
    .update(withManagedFixtureRunKeyScope(`startup-public-bootstrap:${baseUrl}`))
    .digest('hex');
}

function payloadRows(payload) {
  if (Array.isArray(payload?.data)) {
    return payload.data;
  }
  if (Array.isArray(payload?.items)) {
    return payload.items;
  }
  if (Array.isArray(payload)) {
    return payload;
  }
  return [];
}

function buildPagedPath(pathName, params) {
  const url = new URL(pathName, 'https://navigation.invalid');
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') {
      url.searchParams.set(key, value.toString());
    }
  }

  const search = url.searchParams.toString();
  return search ? `${url.pathname}?${search}` : url.pathname;
}

async function createReadonlyPublicApiClient() {
  const baseUrl = requireTenantUrl();
  const api = await buildApiRequestContext();
  let anonymousIdentityToken = null;

  async function resolveAnonymousIdentityToken() {
    if (anonymousIdentityToken) {
      return anonymousIdentityToken;
    }

    const response = await api.post(
      buildUrl(baseUrl, '/api/v1/anonymous/identities'),
      {
        data: {
          device_name: 'playwright-startup-public-bootstrap',
          fingerprint: {
            hash: anonymousFingerprintHash(baseUrl),
            user_agent: 'playwright-startup-public-bootstrap',
            locale: 'pt-BR',
          },
          metadata: {
            source: 'web_navigation_startup_public_bootstrap',
          },
        },
      },
    );
    expect([200, 201]).toContain(response.status());
    const payload = await response.json();
    anonymousIdentityToken = payload?.data?.token?.toString().trim() || '';
    expect(anonymousIdentityToken).toBeTruthy();
    return anonymousIdentityToken;
  }

  return {
    async fetchJson(pathName, label) {
      const token = await resolveAnonymousIdentityToken();
      const response = await api.get(buildUrl(baseUrl, pathName), {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      expect(response.status(), `${label} must load from ${pathName}.`).toBeLessThan(400);
      return response.json();
    },
    async dispose() {
      await api.dispose();
    },
  };
}

async function fetchPublicCandidateFromPagedList(apiClient, {
  description,
  pathName,
  pageSize = 50,
  pageSizeParam,
  predicate,
}) {
  const pageSummaries = [];
  let previousFingerprint = null;

  for (let pageNumber = 1; pageNumber <= 100; pageNumber += 1) {
    const payload = await apiClient.fetchJson(
      buildPagedPath(pathName, {
        page: pageNumber,
        [pageSizeParam]: pageSize,
      }),
      `${description} page ${pageNumber}`,
    );
    const rows = payloadRows(payload);
    pageSummaries.push({
      page: pageNumber,
      count: rows.length,
      currentPage: payload?.current_page ?? null,
      lastPage: payload?.last_page ?? null,
      nextPageUrl: payload?.next_page_url ?? null,
    });

    const candidate = rows.find(predicate);
    if (candidate) {
      return { candidate, pageSummaries };
    }

    const fingerprint = JSON.stringify(rows.map(rowFingerprint));
    if (pageNumber > 1 && fingerprint === previousFingerprint) {
      throw new Error(`${description} repeated the same page payload without advancing pagination.`);
    }
    previousFingerprint = fingerprint;

    if (!shouldContinuePagedFetch({
      payload,
      pageRows: rows,
      pageNumber,
      pageSize,
    })) {
      break;
    }
  }

  return { candidate: null, pageSummaries };
}

async function fetchPublicAccountCandidate(apiClient) {
  const { candidate, pageSummaries } = await fetchPublicCandidateFromPagedList(
    apiClient,
    {
      description: 'Public account profiles list',
      pathName: '/api/v1/account_profiles',
      pageSize: 50,
      pageSizeParam: 'per_page',
      predicate: (row) => {
        const slug = row?.slug?.toString().trim();
        const label = row?.display_name?.toString().trim()
          || row?.account_name?.toString().trim();
        return slug && label;
      },
    },
  );
  expect(
    candidate,
    `Readonly startup proof requires one public account profile route. Pages scanned: ${JSON.stringify(pageSummaries)}`,
  ).toBeTruthy();
  return candidate;
}

async function fetchPublicEventCandidate(apiClient) {
  const { candidate: managedCandidate, pageSummaries } = await fetchPublicCandidateFromPagedList(
    apiClient,
    {
      description: 'Public agenda list',
      pathName: '/api/v1/agenda',
      pageSize: 50,
      pageSizeParam: 'page_size',
      predicate: (row) => {
        if (managedFixtureEnabled) {
          return matchesCanonicalManagedSlug(row?.slug, fixture.eventSlug);
        }

        const routeRef = row?.slug?.toString().trim() || row?.event_id?.toString().trim();
        const title = row?.title?.toString().trim();
        return routeRef && title;
      },
    },
  );

  if (managedFixtureEnabled) {
    expect(
      managedCandidate,
      `Managed public agenda fixture ${fixture.eventSlug} must be visible in /api/v1/agenda when NAV_PUBLIC_TAXONOMY_MANAGED_FIXTURE=1. Pages scanned: ${JSON.stringify(pageSummaries)}`,
    ).toBeTruthy();
    return managedCandidate;
  }

  expect(
    managedCandidate,
    `Readonly startup proof requires one public event route. Pages scanned: ${JSON.stringify(pageSummaries)}`,
  ).toBeTruthy();
  return managedCandidate;
}

async function assertNoPromotionUiVisible(page, contextLabel) {
  await expect(
    page.getByText(/fica melhor no app|continue no app|baixe para continuar|escolha sua loja|app em preparação/i),
    `${contextLabel} must not auto-open the app-promotion surface.`,
  ).toHaveCount(0);
}

function hasSuccessfulAnonymousBootstrap(snapshot) {
  return snapshot.anonymousIdentityResponses.some(
    (entry) => entry.status === 200 || entry.status === 201,
  );
}

function hasSuccessfulProtectedRead(snapshot, label) {
  return snapshot.protectedReadResponses.some(
    (entry) => entry.label === label && entry.status >= 200 && entry.status < 400,
  );
}

function assertBootstrapPrecedesProtectedReads(snapshot, contextLabel) {
  const firstSuccessfulAnonymousBootstrap = snapshot.anonymousIdentityResponses.find(
    (entry) => entry.status === 200 || entry.status === 201,
  );
  expect(
    firstSuccessfulAnonymousBootstrap,
    `${contextLabel} must issue the canonical anonymous identity bootstrap before protected reads.`,
  ).toBeTruthy();

  const protectedReadsBeforeBootstrap = snapshot.requestTimeline.filter(
    (entry) =>
      entry.kind === 'protected_read'
      && entry.seq < firstSuccessfulAnonymousBootstrap.seq,
  );
  expect(
    protectedReadsBeforeBootstrap,
    `${contextLabel} must not issue protected reads before anonymous bootstrap. Event timeline:\n${JSON.stringify(snapshot.eventTimeline, null, 2)}`,
  ).toEqual([]);
}

async function assertStartupSnapshotGreen(page, startupCapture, contextLabel, {
  requiredProtectedLabels = [],
} = {}) {
  await expect
    .poll(
      async () => {
        const snapshot = startupCapture.snapshot();
        return hasSuccessfulAnonymousBootstrap(snapshot)
          && requiredProtectedLabels.every((label) => hasSuccessfulProtectedRead(snapshot, label));
      },
      {
        timeout: appBootTimeoutMs,
        message: `${contextLabel} must complete anonymous bootstrap and required protected reads.`,
      },
    )
    .toBe(true);

  const snapshot = startupCapture.snapshot();
  assertBootstrapPrecedesProtectedReads(snapshot, contextLabel);
  expect(
    snapshot.anonymousIdentityResponses.every((entry) => entry.status === 200 || entry.status === 201),
    `${contextLabel} must keep anonymous identity bootstrap idempotent-success. Observed: ${snapshot.anonymousIdentityResponses.map((entry) => entry.status).join(', ')}`,
  ).toBeTruthy();
  for (const label of requiredProtectedLabels) {
    expect(
      hasSuccessfulProtectedRead(snapshot, label),
      `${contextLabel} must successfully load protected read "${label}". Reads:\n${JSON.stringify(snapshot.protectedReadResponses, null, 2)}`,
    ).toBeTruthy();
  }
  expect(
    snapshot.protectedReadFailures,
    `${contextLabel} must not fail protected reads during bootstrap:\n${snapshot.protectedReadFailures.join('\n')}`,
  ).toEqual([]);
  expect(
    currentPathIndicatesPromotion(page),
    `${contextLabel} must stay on the public surface. Current URL: ${page.url()}`,
  ).toBe(false);
  expect(snapshot.openAppUrls).toEqual([]);
  expect(snapshot.popupUrls).toEqual([]);
  await assertNoPromotionUiVisible(page, contextLabel);
  assertNoUnexpectedBrowserFailures(snapshot, contextLabel);
}

async function assertDirectPublicStartup(page, path, visibleLabel, contextLabel, {
  protectedReadMatchers = defaultProtectedReadMatchers(),
  requiredProtectedLabels = [],
} = {}) {
  const baseUrl = requireTenantUrl();
  const startupCapture = attachStartupCapture(page, { protectedReadMatchers });
  const response = await page.goto(buildUrl(baseUrl, path), {
    waitUntil: 'domcontentloaded',
  });
  expect(response, `${contextLabel} response should be available.`).not.toBeNull();
  expect(response.status(), `${contextLabel} response should be successful.`).toBeLessThan(400);

  await assertAppBooted(page);
  await enableAccessibilityIfNeeded(page);
  await waitForTenantPath(page, [new URL(path, baseUrl).pathname]);
  await assertStartupSnapshotGreen(page, startupCapture, contextLabel, {
    requiredProtectedLabels,
  });
  if (visibleLabel) {
    await assertVisibleTextOrSemanticLabel(
      page,
      visibleLabel,
      `${contextLabel} primary label`,
    );
  }
}

function currentPathIndicatesPromotion(page) {
  const currentUrl = page.url();
  return (
    currentUrl.includes('/open-app') ||
    currentUrl.includes('/baixe-o-app') ||
    currentUrl.includes('/auth/login')
  );
}

function assertNoUnexpectedBrowserFailures(snapshot, contextLabel) {
  const criticalHttpResponses = summarizeCriticalHttpResponses(snapshot);
  expect(
    snapshot.pageErrors,
    `Unexpected page errors during ${contextLabel}:\n${snapshot.pageErrors.join('\n')}`,
  ).toEqual([]);
  expect(
    criticalHttpResponses,
    `Unexpected HTTP error responses during ${contextLabel}:\n${criticalHttpResponses.join('\n')}`,
  ).toEqual([]);
  expect(
    summarizeCriticalConsoleErrors(snapshot),
    `Unexpected console errors during ${contextLabel}:\n${snapshot.consoleErrors.join('\n')}`,
  ).toEqual([]);
}

test('@readonly STARTUP-PUBLIC-BOOTSTRAP-01 anonymous tenant home cold start keeps the public surface and completes anonymous bootstrap', async () => {
  const baseUrl = requireTenantUrl();
  const apiClient = await createReadonlyPublicApiClient();
  let homeAgendaCandidate;
  try {
    homeAgendaCandidate = await fetchPublicEventCandidate(apiClient);
  } finally {
    await apiClient.dispose();
  }

  const visibleAgendaLabel = homeAgendaCandidate.title?.toString().trim()
    || homeAgendaCandidate.name?.toString().trim()
    || homeAgendaCandidate.slug?.toString().trim();

  await withFreshBrowserPage(async ({ page }) => {
    const startupCapture = attachStartupCapture(page);

    const response = await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    expect(response, 'Tenant response should be available').not.toBeNull();
    expect(response.status(), 'Tenant response should be successful').toBeLessThan(400);

    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);
    await waitForTenantPath(page, ['/']);
    await assertStartupSnapshotGreen(page, startupCapture, 'Anonymous home startup', {
      requiredProtectedLabels: ['agenda'],
    });

    const snapshot = startupCapture.snapshot();

    await expect(
      page.getByText(/^Agenda$/i).first(),
      'Anonymous home startup must remain on the tenant public home experience.',
    ).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    if (managedFixtureEnabled) {
      const managedFixtureTitle = page
        .getByText(new RegExp(escapeRegExp(visibleAgendaLabel), 'i'))
        .first();
      const visibleManagedFixtureTitle = await scrollPageUntilLocatorVisible(
        page,
        managedFixtureTitle,
      );
      expect(
        visibleManagedFixtureTitle,
        `Anonymous home startup must render managed agenda fixture ${visibleAgendaLabel} somewhere in the home feed.`,
      ).toBeTruthy();
      await expect(
        visibleManagedFixtureTitle,
        `Anonymous home startup must allow the managed agenda fixture ${visibleAgendaLabel} to become visible on the home feed.`,
      ).toBeVisible({
        timeout: appBootTimeoutMs,
      });
    } else {
      await assertVisibleTextOrSemanticLabel(
        page,
        visibleAgendaLabel,
        'Anonymous home startup first visible agenda event',
      );
    }

    assertNoUnexpectedBrowserFailures(snapshot, 'startup');
  });
});

test('@readonly STARTUP-PUBLIC-BOOTSTRAP-02 anonymous account-profile direct entry keeps the public surface and completes anonymous bootstrap', async () => {
  const apiClient = await createReadonlyPublicApiClient();
  let candidate;
  try {
    candidate = await fetchPublicAccountCandidate(apiClient);
  } finally {
    await apiClient.dispose();
  }

  const slug = candidate.slug.toString().trim();
  const visibleLabel = candidate.display_name?.toString().trim()
    || candidate.account_name?.toString().trim();

  await withFreshBrowserPage(async ({ page }) => {
    await assertDirectPublicStartup(
      page,
      `/parceiro/${slug}`,
      visibleLabel,
      'Anonymous account-profile direct entry',
      {
        protectedReadMatchers: [
          ...defaultProtectedReadMatchers(),
          exactPathMatcher(`/api/v1/account_profiles/${slug}`, 'account_detail'),
        ],
        requiredProtectedLabels: ['account_detail'],
      },
    );
  });
});

test('@readonly STARTUP-PUBLIC-BOOTSTRAP-03 anonymous event-detail direct entry keeps the public surface and completes anonymous bootstrap', async () => {
  const apiClient = await createReadonlyPublicApiClient();
  let candidate;
  try {
    candidate = await fetchPublicEventCandidate(apiClient);
  } finally {
    await apiClient.dispose();
  }

  const routeRef = candidate.slug?.toString().trim()
    || candidate.event_id?.toString().trim();
  const occurrenceId = candidate.occurrence_id?.toString().trim() || null;
  const visibleLabel = candidate.title?.toString().trim();
  const path = occurrenceId
    ? `/agenda/evento/${routeRef}?occurrence=${encodeURIComponent(occurrenceId)}`
    : `/agenda/evento/${routeRef}`;

  await withFreshBrowserPage(async ({ page }) => {
    await assertDirectPublicStartup(
      page,
      path,
      visibleLabel,
      'Anonymous event-detail direct entry',
      {
        protectedReadMatchers: [
          ...defaultProtectedReadMatchers(),
          eventDetailMatcher(routeRef, occurrenceId),
        ],
        requiredProtectedLabels: ['event_detail'],
      },
    );
  });
});
