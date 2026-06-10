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
