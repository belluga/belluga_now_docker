const { test, expect } = require('@playwright/test');

const tenantUrl = process.env.NAV_TENANT_URL;
const expectedWebBuildSha = process.env.NAV_EXPECTED_WEB_BUILD_SHA;
const expectedLandlordHost = process.env.NAV_EXPECTED_LANDLORD_HOST;

const appBootTimeoutMs = 120000;
const wideViewport = { width: 1200, height: 900 };
const framedWidthPx = 430;

function requireTenantUrl() {
  expect(
    tenantUrl,
    'Missing NAV_TENANT_URL. Map full-width web spec requires a live tenant URL.',
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

async function openTenantPath(page, baseUrl, path) {
  const targetUrl = new URL(path, baseUrl).toString();
  const response = await page.goto(targetUrl, {
    waitUntil: 'domcontentloaded',
  });
  expect(response, `Response should be available for ${targetUrl}`).not.toBeNull();
  expect(response.status(), `Response should be successful for ${targetUrl}`)
    .toBeLessThan(400);

  await assertAppBooted(page);
  await enableAccessibilityIfNeeded(page);
  await expect(page.locator('flt-semantics[role="tablist"]').first())
    .toBeVisible({ timeout: appBootTimeoutMs });
}

async function bottomNavigationBounds(page) {
  const box = await page.locator('flt-semantics[role="tablist"]').first()
    .boundingBox();
  expect(box, 'Expected the public bottom navigation tablist to be measurable.')
    .not.toBeNull();
  return box;
}

test('@readonly MAP-WEB-WIDTH-01 tenant map route is full width while framed tenant routes remain constrained', async ({
  browser,
}) => {
  const baseUrl = requireTenantUrl();
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: wideViewport,
    geolocation: { latitude: -20.671339, longitude: -40.495395 },
    permissions: ['geolocation'],
  });
  const page = await context.newPage();

  await openTenantPath(page, baseUrl, '/');
  const homeBounds = await bottomNavigationBounds(page);
  expect(homeBounds.width, 'Tenant home must keep the public web frame width.')
    .toBeLessThanOrEqual(framedWidthPx + 2);
  expect(
    Math.abs(homeBounds.x - ((wideViewport.width - framedWidthPx) / 2)),
    'Tenant home frame must remain centered on wide web viewports.',
  ).toBeLessThanOrEqual(2);

  await openTenantPath(page, baseUrl, '/mapa');
  const mapBounds = await bottomNavigationBounds(page);
  expect(
    mapBounds.width,
    'Tenant map route must occupy the full browser viewport width.',
  ).toBeGreaterThanOrEqual(wideViewport.width - 2);
  expect(mapBounds.x, 'Tenant map route must start at the left viewport edge.')
    .toBeLessThanOrEqual(2);

  const runtimeProvenance = await page.evaluate(() => ({
    buildSha: window.__WEB_BUILD_SHA__ || null,
    landlordHost: window.__LANDLORD_HOST__ || null,
  }));
  console.log(
    `[map-width] runtime provenance: ${JSON.stringify(runtimeProvenance)}`,
  );

  if (expectedWebBuildSha) {
    expect(runtimeProvenance.buildSha).toBe(expectedWebBuildSha);
  }
  if (expectedLandlordHost) {
    expect(runtimeProvenance.landlordHost).toBe(expectedLandlordHost);
  }

  await context.close();
});
