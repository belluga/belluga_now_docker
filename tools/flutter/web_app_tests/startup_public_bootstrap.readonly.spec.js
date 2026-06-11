const crypto = require('crypto');
const { test, expect, request } = require('@playwright/test');

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
    exactPathMatcher('/api/v1/map/filters', 'map_filters'),
    exactPathMatcher('/api/v1/map/pois', 'map_pois'),
    exactPathMatcher('/api/v1/invites/settings', 'invites_settings'),
    exactPathMatcher('/api/v1/invites', 'invites_feed'),
  ];
}

function attachStartupCapture(page, { protectedReadMatchers = defaultProtectedReadMatchers() } = {}) {
  const anonymousIdentityResponses = [];
  const protectedReadResponses = [];
  const protectedReadFailures = [];
  const openAppUrls = [];
  const popupUrls = [];
  const consoleErrors = [];
  const pageErrors = [];
  const responseTimeline = [];
  let responseSequence = 0;

  page.on('response', (response) => {
    const url = response.url();
    const seq = responseSequence += 1;

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
      return;
    }

    const matchedRead = protectedReadMatchers.find((matcher) => matcher.matches(url));
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

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  return {
    snapshot: () => ({
      anonymousIdentityResponses: [...anonymousIdentityResponses],
      protectedReadResponses: [...protectedReadResponses],
      protectedReadFailures: [...protectedReadFailures],
      openAppUrls: [...openAppUrls],
      popupUrls: [...popupUrls],
      consoleErrors: [...consoleErrors],
      pageErrors: [...pageErrors],
      responseTimeline: [...responseTimeline],
    }),
  };
}

function anonymousFingerprintHash(baseUrl) {
  return crypto
    .createHash('sha256')
    .update(`startup-public-bootstrap:${baseUrl}`)
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

async function fetchPublicAccountCandidate(apiClient) {
  const payload = await apiClient.fetchJson(
    '/api/v1/account_profiles?per_page=50',
    'Public account profiles list',
  );
  const candidate = payloadRows(payload).find((row) => {
    const slug = row?.slug?.toString().trim();
    const label = row?.display_name?.toString().trim()
      || row?.account_name?.toString().trim();
    return slug && label;
  });
  expect(candidate, 'Readonly startup proof requires one public account profile route.').toBeTruthy();
  return candidate;
}

async function fetchPublicEventCandidate(apiClient) {
  const payload = await apiClient.fetchJson(
    '/api/v1/agenda?page=1&page_size=50',
    'Public agenda list',
  );
  const candidate = payloadRows(payload).find((row) => {
    const routeRef = row?.slug?.toString().trim() || row?.event_id?.toString().trim();
    const title = row?.title?.toString().trim();
    return routeRef && title;
  });
  expect(candidate, 'Readonly startup proof requires one public event route.').toBeTruthy();
  return candidate;
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

  const protectedReadsBeforeBootstrap = snapshot.protectedReadResponses.filter(
    (entry) => entry.seq < firstSuccessfulAnonymousBootstrap.seq,
  );
  expect(
    protectedReadsBeforeBootstrap,
    `${contextLabel} must not issue protected reads before anonymous bootstrap. Timeline:\n${JSON.stringify(snapshot.responseTimeline, null, 2)}`,
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
  expect(
    snapshot.pageErrors,
    `Unexpected page errors during ${contextLabel}:\n${snapshot.pageErrors.join('\n')}`,
  ).toEqual([]);
  expect(
    snapshot.consoleErrors,
    `Unexpected console errors during ${contextLabel}:\n${snapshot.consoleErrors.join('\n')}`,
  ).toEqual([]);
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

test('@readonly STARTUP-PUBLIC-BOOTSTRAP-01 anonymous tenant home cold start keeps the public surface and completes anonymous bootstrap', async ({
  browser,
}) => {
  const baseUrl = requireTenantUrl();
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  const startupCapture = attachStartupCapture(page);

  const response = await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  expect(response, 'Tenant response should be available').not.toBeNull();
  expect(response.status(), 'Tenant response should be successful').toBeLessThan(400);

  await assertAppBooted(page);
  await enableAccessibilityIfNeeded(page);
  await waitForTenantPath(page, ['/']);

  await expect
    .poll(
      async () => hasSuccessfulAnonymousBootstrap(startupCapture.snapshot()),
      {
        timeout: appBootTimeoutMs,
        message:
          'Anonymous tenant home startup must issue the canonical anonymous identity bootstrap.',
      },
    )
    .toBe(true);

  const snapshot = startupCapture.snapshot();
  assertBootstrapPrecedesProtectedReads(snapshot, 'Anonymous home startup');
  expect(
    snapshot.anonymousIdentityResponses.every((entry) => entry.status === 200 || entry.status === 201),
    `Anonymous identity bootstrap must be idempotent-success (200/201). Observed: ${snapshot.anonymousIdentityResponses.map((entry) => entry.status).join(', ')}`,
  ).toBeTruthy();

  expect(
    snapshot.protectedReadFailures,
    `Startup protected reads must not fail during anonymous home bootstrap:\n${snapshot.protectedReadFailures.join('\n')}`,
  ).toEqual([]);

  expect(
    currentPathIndicatesPromotion(page),
    `Anonymous home startup must stay on the public surface. Current URL: ${page.url()}`,
  ).toBe(false);

  expect(
    snapshot.openAppUrls,
    `Anonymous home startup must not request /open-app automatically:\n${snapshot.openAppUrls.join('\n')}`,
  ).toEqual([]);
  expect(
    snapshot.popupUrls,
    `Anonymous home startup must not open promotion popups automatically:\n${snapshot.popupUrls.join('\n')}`,
  ).toEqual([]);

  await assertNoPromotionUiVisible(page, 'Anonymous home startup');

  await expect(
    page.getByText(/^Agenda$/i).first(),
    'Anonymous home startup must remain on the tenant public home experience.',
  ).toBeVisible({
    timeout: appBootTimeoutMs,
  });

  expect(
    snapshot.pageErrors,
    `Unexpected page errors during startup:\n${snapshot.pageErrors.join('\n')}`,
  ).toEqual([]);
  expect(
    snapshot.consoleErrors.filter((entry) => !entry.includes('status of 401')),
    `Unexpected console errors during startup:\n${snapshot.consoleErrors.join('\n')}`,
  ).toEqual([]);

  await context.close();
});

test('@readonly STARTUP-PUBLIC-BOOTSTRAP-02 anonymous account-profile direct entry keeps the public surface and completes anonymous bootstrap', async ({
  browser,
}) => {
  const apiClient = await createReadonlyPublicApiClient();
  let candidate;
  try {
    candidate = await fetchPublicAccountCandidate(apiClient);
  } finally {
    await apiClient.dispose();
  }

  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  const slug = candidate.slug.toString().trim();
  const visibleLabel = candidate.display_name?.toString().trim()
    || candidate.account_name?.toString().trim();

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

  await context.close();
});

test('@readonly STARTUP-PUBLIC-BOOTSTRAP-03 anonymous event-detail direct entry keeps the public surface and completes anonymous bootstrap', async ({
  browser,
}) => {
  const apiClient = await createReadonlyPublicApiClient();
  let candidate;
  try {
    candidate = await fetchPublicEventCandidate(apiClient);
  } finally {
    await apiClient.dispose();
  }

  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  const routeRef = candidate.slug?.toString().trim()
    || candidate.event_id?.toString().trim();
  const occurrenceId = candidate.occurrence_id?.toString().trim() || null;
  const visibleLabel = candidate.title?.toString().trim();
  const path = occurrenceId
    ? `/agenda/evento/${routeRef}?occurrence=${encodeURIComponent(occurrenceId)}`
    : `/agenda/evento/${routeRef}`;

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

  await context.close();
});
