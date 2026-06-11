const crypto = require('crypto');
const { test, expect } = require('@playwright/test');

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

function attachStartupCapture(page) {
  const anonymousIdentityStatuses = [];
  const protectedReadFailures = [];
  const openAppUrls = [];
  const popupUrls = [];
  const consoleErrors = [];
  const pageErrors = [];

  const protectedReadPrefixes = [
    '/api/v1/agenda',
    '/api/v1/map/filters',
    '/api/v1/map/pois',
    '/api/v1/invites/settings',
    '/api/v1/invites',
  ];

  page.on('response', (response) => {
    const url = response.url();
    if (url.includes('/api/v1/anonymous/identities')) {
      anonymousIdentityStatuses.push(response.status());
      return;
    }

    const pathname = new URL(url).pathname;
    if (
      protectedReadPrefixes.includes(pathname) &&
      response.status() >= 400
    ) {
      protectedReadFailures.push(`${response.status()} ${url}`);
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
      anonymousIdentityStatuses: [...anonymousIdentityStatuses],
      protectedReadFailures: [...protectedReadFailures],
      openAppUrls: [...openAppUrls],
      popupUrls: [...popupUrls],
      consoleErrors: [...consoleErrors],
      pageErrors: [...pageErrors],
    }),
  };
}

let anonymousIdentityToken = null;

function anonymousFingerprintHash(baseUrl) {
  return crypto
    .createHash('sha256')
    .update(`startup-public-bootstrap:${baseUrl}`)
    .digest('hex');
}

async function resolveAnonymousIdentityToken(page) {
  if (anonymousIdentityToken) {
    return anonymousIdentityToken;
  }

  const baseUrl = requireTenantUrl();
  const response = await page.request.post(
    buildUrl(baseUrl, '/api/v1/anonymous/identities'),
    {
      headers: { Accept: 'application/json' },
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

async function fetchJson(page, pathName, label) {
  const baseUrl = requireTenantUrl();
  const token = await resolveAnonymousIdentityToken(page);
  const response = await page.request.get(buildUrl(baseUrl, pathName), {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
  expect(response.status(), `${label} must load from ${pathName}.`).toBeLessThan(400);
  return response.json();
}

async function fetchPublicAccountCandidate(page) {
  const payload = await fetchJson(
    page,
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

async function fetchPublicEventCandidate(page) {
  const payload = await fetchJson(
    page,
    '/api/v1/events?page=1&page_size=50',
    'Public events list',
  );
  const candidate = payloadRows(payload).find((row) => {
    const routeRef = row?.slug?.toString().trim() || row?.event_id?.toString().trim();
    const title = row?.title?.toString().trim();
    return routeRef && title;
  });
  expect(candidate, 'Readonly startup proof requires one public event route.').toBeTruthy();
  return candidate;
}

async function assertStartupSnapshotGreen(page, startupCapture, contextLabel) {
  await expect
    .poll(
      async () => startupCapture.snapshot().anonymousIdentityStatuses.length,
      {
        timeout: appBootTimeoutMs,
        message: `${contextLabel} must issue the canonical anonymous identity bootstrap.`,
      },
    )
    .toBeGreaterThan(0);

  await page.waitForTimeout(4000);

  const snapshot = startupCapture.snapshot();
  expect(
    snapshot.anonymousIdentityStatuses.every((status) => status === 200 || status === 201),
    `${contextLabel} must keep anonymous identity bootstrap idempotent-success. Observed: ${snapshot.anonymousIdentityStatuses.join(', ')}`,
  ).toBeTruthy();
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
  expect(
    snapshot.pageErrors,
    `Unexpected page errors during ${contextLabel}:\n${snapshot.pageErrors.join('\n')}`,
  ).toEqual([]);
  expect(
    snapshot.consoleErrors,
    `Unexpected console errors during ${contextLabel}:\n${snapshot.consoleErrors.join('\n')}`,
  ).toEqual([]);
}

async function assertDirectPublicStartup(page, path, visibleLabel, contextLabel) {
  const baseUrl = requireTenantUrl();
  const startupCapture = attachStartupCapture(page);
  const response = await page.goto(buildUrl(baseUrl, path), {
    waitUntil: 'domcontentloaded',
  });
  expect(response, `${contextLabel} response should be available.`).not.toBeNull();
  expect(response.status(), `${contextLabel} response should be successful.`).toBeLessThan(400);

  await assertAppBooted(page);
  await enableAccessibilityIfNeeded(page);
  await waitForTenantPath(page, [new URL(path, baseUrl).pathname]);
  await assertStartupSnapshotGreen(page, startupCapture, contextLabel);
  await assertVisibleTextOrSemanticLabel(
    page,
    visibleLabel,
    `${contextLabel} primary label`,
  );
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
      async () => startupCapture.snapshot().anonymousIdentityStatuses.length,
      {
        timeout: appBootTimeoutMs,
        message:
          'Anonymous tenant home startup must issue the canonical anonymous identity bootstrap.',
      },
    )
    .toBeGreaterThan(0);

  await page.waitForTimeout(4000);

  const snapshot = startupCapture.snapshot();
  expect(
    snapshot.anonymousIdentityStatuses.every((status) => status === 200 || status === 201),
    `Anonymous identity bootstrap must be idempotent-success (200/201). Observed: ${snapshot.anonymousIdentityStatuses.join(', ')}`,
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

  await expect(
    page.getByText(/fica melhor no app|continue no app|baixe para continuar|escolha sua loja|app em preparação/i),
    'Anonymous home startup must not auto-open the app-promotion surface.',
  ).toHaveCount(0);

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
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  const candidate = await fetchPublicAccountCandidate(page);
  const slug = candidate.slug.toString().trim();
  const visibleLabel = candidate.display_name?.toString().trim()
    || candidate.account_name?.toString().trim();

  await assertDirectPublicStartup(
    page,
    `/parceiro/${slug}`,
    visibleLabel,
    'Anonymous account-profile direct entry',
  );

  await context.close();
});

test('@readonly STARTUP-PUBLIC-BOOTSTRAP-03 anonymous event-detail direct entry keeps the public surface and completes anonymous bootstrap', async ({
  browser,
}) => {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  const candidate = await fetchPublicEventCandidate(page);
  const routeRef = candidate.slug?.toString().trim()
    || candidate.event_id?.toString().trim();
  const visibleLabel = candidate.title?.toString().trim();

  await assertDirectPublicStartup(
    page,
    `/agenda/evento/${routeRef}`,
    visibleLabel,
    'Anonymous event-detail direct entry',
  );

  await context.close();
});
