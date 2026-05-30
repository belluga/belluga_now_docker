const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const tenantUrl = process.env.NAV_TENANT_URL;
const appBootTimeoutMs = 90000;
const publicListPageSize = 50;
const publicListMaxPages = 5;
const screenshotDir =
  process.env.NAV_DIRECTIONS_BRAND_SCREENSHOT_DIR ||
  path.join(
    __dirname,
    '..',
    'web_app_smoke_runner',
    'test-results',
    'directions-brand',
  );

test.describe.configure({ timeout: 300000 });

function requireTenantUrl() {
  expect(
    tenantUrl,
    'Missing NAV_TENANT_URL. Directions brand visual suite requires a live tenant URL.',
  ).toBeTruthy();
  return tenantUrl;
}

function buildUrl(baseUrl, pathName, searchParams = {}) {
  const url = new URL(pathName, baseUrl);
  for (const [key, value] of Object.entries(searchParams)) {
    if (value != null && value !== '') {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
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

function anonymousFingerprintHash(baseUrl) {
  return crypto
    .createHash('sha256')
    .update(`directions-brand-visual:${baseUrl}`)
    .digest('hex');
}

let anonymousIdentityToken = null;

async function resolveAnonymousIdentityToken(page, baseUrl) {
  if (anonymousIdentityToken) {
    return anonymousIdentityToken;
  }

  const response = await page.request.post(
    buildUrl(baseUrl, '/api/v1/anonymous/identities'),
    {
      headers: { Accept: 'application/json' },
      data: {
        device_name: 'playwright-directions-brand-visual',
        fingerprint: {
          hash: anonymousFingerprintHash(baseUrl),
          user_agent: 'playwright-directions-brand-visual',
          locale: 'pt-BR',
        },
        metadata: {
          source: 'web_navigation_directions_brand_visual',
        },
      },
    },
  );
  expect(
    [200, 201],
    `Anonymous tenant identity bootstrap must succeed. Status ${response.status()}`,
  ).toContain(response.status());
  const payload = await response.json();
  anonymousIdentityToken = textValue(payload?.data?.token);
  expect(
    anonymousIdentityToken,
    'Anonymous tenant identity bootstrap must return data.token.',
  ).toBeTruthy();
  return anonymousIdentityToken;
}

async function publicAuthHeaders(page, baseUrl) {
  const token = await resolveAnonymousIdentityToken(page, baseUrl);
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

async function fetchJson(page, baseUrl, pathName, description, searchParams = {}) {
  const response = await page.request.get(buildUrl(baseUrl, pathName, searchParams), {
    headers: await publicAuthHeaders(page, baseUrl),
  });
  expect(
    response.status(),
    `${description} must return HTTP 2xx.`,
  ).toBeLessThan(300);
  return response.json();
}

async function fetchPagedRows(page, baseUrl, pathName, description) {
  const rows = [];
  for (let pageNumber = 1; pageNumber <= publicListMaxPages; pageNumber += 1) {
    const payload = await fetchJson(page, baseUrl, pathName, description, {
      page: pageNumber,
      per_page: publicListPageSize,
    });
    const pageRows = payloadRows(payload);
    rows.push(...pageRows);
    const lastPage = Number(payload?.last_page);
    if (Number.isFinite(lastPage) && pageNumber >= lastPage) {
      break;
    }
    if (payload?.next_page_url == null && pageRows.length === 0) {
      break;
    }
  }
  return rows;
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

function textValue(...values) {
  for (const value of values) {
    const text = value?.toString().trim();
    if (text) {
      return text;
    }
  }
  return '';
}

function locationPayload(row) {
  return row?.location || row?.poi || row?.map_poi || null;
}

function eventOccurrenceId(event) {
  return (
    textValue(event?.occurrence_id) ||
    textValue(
      (Array.isArray(event?.occurrences)
        ? event.occurrences.find((occurrence) => textValue(occurrence?.occurrence_id))
        : null
      )?.occurrence_id,
    )
  );
}

async function resolveAccountProfileCandidate(page, baseUrl) {
  const rows = await fetchPagedRows(
    page,
    baseUrl,
    '/api/v1/account_profiles',
    'Public account profiles list',
  );
  const selected = rows.find(
    (row) => textValue(row?.slug) && locationPayload(row) != null,
  );
  expect(
    selected,
    'Directions brand visual QA requires a public Account Profile with location.',
  ).toBeTruthy();
  return selected;
}

async function resolveEventCandidate(page, baseUrl) {
  const rows = await fetchPagedRows(
    page,
    baseUrl,
    '/api/v1/events',
    'Public events list',
  );
  const selected = rows.find(
    (row) =>
      textValue(row?.slug) &&
      eventOccurrenceId(row) &&
      locationPayload(row) != null &&
      row?.capabilities?.map_poi?.enabled !== false,
  );
  expect(
    selected,
    'Directions brand visual QA requires a public Event with map-capable location.',
  ).toBeTruthy();
  return selected;
}

async function assertBrandAssetsServed(page, baseUrl) {
  const googleMaps = await page.request.get(
    buildUrl(baseUrl, '/assets/assets/brands/directions/google_maps_icon_2020.svg'),
  );
  expect(
    googleMaps.status(),
    'Google Maps brand SVG asset must be served by the web bundle.',
  ).toBe(200);
  expect(
    googleMaps.headers()['content-type'] || '',
    'Google Maps brand asset must be served as image/svg+xml.',
  ).toContain('image/svg+xml');

  const waze = await page.request.get(
    buildUrl(baseUrl, '/assets/assets/brands/directions/waze_logo_2022.png'),
  );
  expect(waze.status(), 'Waze brand PNG asset must be served by the web bundle.')
    .toBe(200);
  expect(
    waze.headers()['content-type'] || '',
    'Waze brand asset must be served as image/png.',
  ).toContain('image/png');

  const uber = await page.request.get(
    buildUrl(baseUrl, '/assets/assets/brands/directions/uber_logotype.svg'),
  );
  expect(uber.status(), 'Uber brand SVG asset must be served by the web bundle.')
    .toBe(200);
  expect(
    uber.headers()['content-type'] || '',
    'Uber brand asset must be served as image/svg+xml.',
  ).toContain('image/svg+xml');

  const ninetyNine = await page.request.get(
    buildUrl(baseUrl, '/assets/assets/brands/directions/99_logo_2023.png'),
  );
  expect(ninetyNine.status(), '99 brand PNG asset must be served by the web bundle.')
    .toBe(200);
  expect(
    ninetyNine.headers()['content-type'] || '',
    '99 brand asset must be served as image/png.',
  ).toContain('image/png');
}

async function openAppPath(page, baseUrl, pathName) {
  const response = await page.goto(buildUrl(baseUrl, pathName), {
    waitUntil: 'domcontentloaded',
  });
  expect(response, `Response should be available for ${pathName}`).not.toBeNull();
  expect(response.status(), `Response should be successful for ${pathName}`)
    .toBeLessThan(400);
  await assertAppBooted(page);
  await enableAccessibilityIfNeeded(page);
}

function semanticLabelLocator(page, label) {
  const escapedLabel = String(label).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return page.locator(`[aria-label*="${escapedLabel}"]`).first();
}

async function visibleLabelLocator(page, label, contextLabel) {
  const roleLocator = page
    .getByRole('button', { name: new RegExp(`^${label}$`, 'i') })
    .first();
  const semanticLocator = semanticLabelLocator(page, label);

  await expect
    .poll(
      async () => {
        if ((await roleLocator.count()) > 0 && (await roleLocator.isVisible())) {
          return 'role';
        }
        if (
          (await semanticLocator.count()) > 0 &&
          (await semanticLocator.isVisible())
        ) {
          return 'semantic';
        }
        return '';
      },
      {
        message: `${contextLabel} must render visible ${label} control.`,
        timeout: appBootTimeoutMs,
      },
    )
    .not.toBe('');

  if ((await roleLocator.count()) > 0 && (await roleLocator.isVisible())) {
    return roleLocator;
  }
  return semanticLocator;
}

async function openDirectionsTab(page, contextLabel) {
  const tab = await visibleLabelLocator(page, 'Como Chegar', contextLabel);
  await tab.click();

  await visibleLabelLocator(page, 'Waze', `${contextLabel} directions`);
  await visibleLabelLocator(page, 'Uber', `${contextLabel} directions`);
  await visibleLabelLocator(page, 'Outros', `${contextLabel} directions`);
}

async function screenshot(page, filename) {
  fs.mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({
    path: path.join(screenshotDir, filename),
    fullPage: true,
  });
}

test('@readonly NAV-DIR-BRAND-01 Waze and Uber brand controls render on shared directions surfaces', async ({
  page,
}) => {
  const baseUrl = requireTenantUrl();
  await assertBrandAssetsServed(page, baseUrl);

  const accountProfile = await resolveAccountProfileCandidate(page, baseUrl);
  const event = await resolveEventCandidate(page, baseUrl);
  const eventPath = `/agenda/evento/${event.slug}?occurrence=${eventOccurrenceId(event)}`;

  await page.setViewportSize({ width: 390, height: 844 });
  await openAppPath(page, baseUrl, `/parceiro/${accountProfile.slug}`);
  await openDirectionsTab(page, 'Account Profile mobile');
  await screenshot(page, 'account-mobile-directions.png');

  const otherButton = await visibleLabelLocator(
    page,
    'Outros',
    'Account Profile mobile directions',
  );
  await otherButton.click();
  await visibleLabelLocator(page, 'Fechar', 'Directions chooser sheet');
  await page.waitForTimeout(1800);
  await screenshot(page, 'account-mobile-other-sheet.png');

  await page.setViewportSize({ width: 1440, height: 900 });
  await openAppPath(page, baseUrl, `/parceiro/${accountProfile.slug}`);
  await openDirectionsTab(page, 'Account Profile desktop');
  await screenshot(page, 'account-desktop-directions.png');

  await page.setViewportSize({ width: 390, height: 844 });
  await openAppPath(page, baseUrl, eventPath);
  await openDirectionsTab(page, 'Event mobile');
  await screenshot(page, 'event-mobile-directions.png');
});
