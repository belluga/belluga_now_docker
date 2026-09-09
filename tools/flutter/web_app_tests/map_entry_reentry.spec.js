const { test, expect } = require('@playwright/test');
const { withFreshBrowserPage } = require('./support/fresh_browser_context');
const {
  installFailureCollectors,
  summarizeCriticalBrowserFailures,
} = require('./support/browser_failure_collectors');

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

function captureReadonlyMutations(page, appOrigin) {
  const mutatingApiRequests = [];

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

  return mutatingApiRequests;
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

test('@deferred @readonly MAP-NAV-REENTRY-01 tenant home can reopen map after returning from a warm permission-gated entry', async () => {
  const baseUrl = requireTenantUrl();
  const appOrigin = new URL(baseUrl).origin;
  await withFreshBrowserPage(async ({ page }) => {
    const collectors = installFailureCollectors(page);
    const mutatingApiRequests = captureReadonlyMutations(page, appOrigin);
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

    const browserFailures = summarizeCriticalBrowserFailures(collectors);
    expect(
      browserFailures,
      `Unexpected browser failures:\n${JSON.stringify(browserFailures, null, 2)}`,
    ).toEqual({
      runtimeErrors: [],
      failedRequests: [],
      criticalHttpResponses: [],
      disallowedRateLimitedResponses: [],
      criticalConsoleErrors: [],
    });
    expect(
      mutatingApiRequests,
      `Readonly map reentry flow must not issue mutating API requests:\n${mutatingApiRequests.join('\n')}`,
    ).toEqual([]);
  });
});
