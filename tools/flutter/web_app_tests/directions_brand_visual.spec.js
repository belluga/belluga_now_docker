const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect, request } = require('@playwright/test');
const { loginTenantAdmin } = require('./support/tenant_admin_auth');
const {
  cleanupOnboardedAccount,
  runCleanupPreservingPrimaryError,
} = require('./support/account_onboarding_cleanup');

const tenantUrl = process.env.NAV_TENANT_URL;
const appBootTimeoutMs = 90000;
const publicListPageSize = 50;
const publicListMaxPages = 5;
const screenshotDir =
  process.env.NAV_DIRECTIONS_BRAND_SCREENSHOT_DIR ||
  path.join(os.tmpdir(), 'belluga-web-navigation', 'directions-brand');

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

function authHeaders(token) {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

async function createApiContext(baseUrl) {
  return request.newContext({
    baseURL: baseUrl,
    extraHTTPHeaders: {
      Accept: 'application/json',
    },
    ignoreHTTPSErrors: true,
  });
}

async function loginTenantAdminToken(api, baseUrl) {
  const session = await loginTenantAdmin({
    api,
    baseUrl,
    buildUrl: (origin, pathName) => buildUrl(origin, pathName),
    deviceName: 'playwright-directions-brand-visual',
  });
  return session.token;
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
    (row) =>
      textValue(row?.slug) &&
      locationPayload(row) != null &&
      row?.capabilities?.is_poi_enabled === true &&
      row?.capabilities?.is_reference_location_enabled === true &&
      row?.capabilities?.is_publicly_discoverable !== false,
  );
  expect(
    selected,
    'Directions brand visual QA requires a public Account Profile with location and shared-directions capabilities.',
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

async function deleteEvent(api, baseUrl, token, eventId) {
  if (!eventId) {
    return;
  }
  const response = await api.delete(buildUrl(baseUrl, `/admin/api/v1/events/${eventId}`), {
    headers: authHeaders(token),
    failOnStatusCode: false,
  });
  expect(
    [404, 200, 204],
    `Directions event cleanup must delete ${eventId} or observe it already missing.`,
  ).toContain(response.status());
}

async function deleteEventType(api, baseUrl, token, eventTypeId) {
  if (!eventTypeId) {
    return;
  }
  const response = await api.delete(buildUrl(baseUrl, `/admin/api/v1/event_types/${eventTypeId}`), {
    headers: authHeaders(token),
    failOnStatusCode: false,
  });
  expect(
    [404, 200, 204],
    `Directions event type cleanup must delete ${eventTypeId} or observe it already missing.`,
  ).toContain(response.status());
}

async function deleteAccountProfileType(api, baseUrl, token, profileType) {
  if (!profileType) {
    return;
  }
  const response = await api.delete(
    buildUrl(
      baseUrl,
      `/admin/api/v1/account_profile_types/${encodeURIComponent(profileType)}`,
    ),
    {
      headers: authHeaders(token),
      failOnStatusCode: false,
    },
  );
  expect(
    [404, 200, 204],
    `Directions profile type cleanup must delete ${profileType} or observe it already missing.`,
  ).toContain(response.status());
}

async function createDirectionsProfileType(api, baseUrl, token) {
  const unique = Date.now();
  const type = `pw-directions-brand-${unique}`;
  const response = await api.post(
    buildUrl(baseUrl, '/admin/api/v1/account_profile_types'),
    {
      headers: authHeaders(token),
      data: {
        type,
        label: `PW Directions ${unique}`,
        labels: {
          singular: `PW Directions ${unique}`,
          plural: `PW Directions ${unique}s`,
        },
        allowed_taxonomies: [],
        capabilities: {
          is_queryable: true,
          is_publicly_navigable: true,
          is_favoritable: true,
          is_publicly_discoverable: true,
          is_poi_enabled: true,
          is_reference_location_enabled: true,
          has_taxonomies: false,
          has_bio: false,
          has_content: false,
          has_avatar: false,
          has_cover: false,
          has_events: true,
        },
        visual: {
          mode: 'icon',
          icon: 'place',
          color: '#0F766E',
          icon_color: '#FFFFFF',
        },
      },
    },
  );
  expect(response.status(), 'Directions profile type seed must succeed.').toBe(201);
  return type;
}

async function createDirectionsProfile(api, baseUrl, token, profileType) {
  const unique = Date.now();
  const response = await api.post(
    buildUrl(baseUrl, '/admin/api/v1/account_onboardings'),
    {
      headers: authHeaders(token),
      data: {
        name: `PW Directions Brand ${unique}`,
        ownership_state: 'unmanaged',
        profile_type: profileType,
        location: {
          lat: -20.671339,
          lng: -40.495395,
        },
      },
    },
  );
  expect(response.status(), 'Directions account onboarding must succeed.').toBe(201);
  const payload = await response.json();
  return {
    accountSlug: textValue(payload?.data?.account?.slug),
    profileId: textValue(payload?.data?.account_profile?.id),
    profileSlug: textValue(
      payload?.data?.account_profile?.slug,
      payload?.data?.account?.slug,
    ),
  };
}

async function createDirectionsEventType(api, baseUrl, token) {
  const unique = Date.now();
  const response = await api.post(
    buildUrl(baseUrl, '/admin/api/v1/event_types'),
    {
      headers: authHeaders(token),
      data: {
        name: `PW Directions Event ${unique}`,
        slug: `pw-directions-event-${unique}`,
        description: 'Directions brand visual event type',
        visual: {
          mode: 'icon',
          icon: 'event',
          color: '#7C3AED',
          icon_color: '#FFFFFF',
        },
      },
    },
  );
  expect(response.status(), 'Directions event type seed must succeed.').toBe(201);
  return (await response.json())?.data || {};
}

async function createDirectionsEvent(
  api,
  baseUrl,
  token,
  { eventType, physicalHostId },
) {
  const unique = Date.now();
  const start = new Date(Date.now() + 30 * 60 * 1000);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const response = await api.post(
    buildUrl(baseUrl, '/admin/api/v1/events'),
    {
      headers: authHeaders(token),
      data: {
        title: `PW Directions Brand Event ${unique}`,
        content: '<p>Directions brand visual event.</p>',
        type: {
          id: textValue(eventType?.id),
          name: textValue(eventType?.name),
          slug: textValue(eventType?.slug),
          description: textValue(eventType?.description),
        },
        location: {
          mode: 'physical',
        },
        place_ref: {
          type: 'account_profile',
          id: physicalHostId,
        },
        event_parties: [],
        occurrences: [
          {
            date_time_start: start.toISOString(),
            date_time_end: end.toISOString(),
          },
        ],
        publication: {
          status: 'published',
          publish_at: new Date(Date.now() - 60 * 1000).toISOString(),
        },
      },
    },
  );
  expect(response.status(), 'Directions event seed must succeed.').toBe(201);
  return (await response.json())?.data || {};
}

async function waitForPublicProfile(page, baseUrl, slug) {
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          buildUrl(baseUrl, `/api/v1/account_profiles/${slug}`),
          {
            headers: await publicAuthHeaders(page, baseUrl),
            failOnStatusCode: false,
          },
        );
        return response.status();
      },
      {
        timeout: appBootTimeoutMs,
        message: `Public account profile ${slug} must hydrate before directions proof.`,
      },
    )
    .toBe(200);
}

async function waitForPublicEvent(page, baseUrl, routeRef) {
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          buildUrl(baseUrl, `/api/v1/events/${routeRef}`),
          {
            headers: await publicAuthHeaders(page, baseUrl),
            failOnStatusCode: false,
          },
        );
        return response.status();
      },
      {
        timeout: appBootTimeoutMs,
        message: `Public event ${routeRef} must hydrate before directions proof.`,
      },
    )
    .toBe(200);
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

async function expectBrandAssetUsedByRuntime(page, assetFileName, description) {
  await expect
    .poll(
      async () =>
        page.evaluate((expectedAssetFileName) => {
          return performance
            .getEntriesByType('resource')
            .some((entry) => entry.name.includes(expectedAssetFileName));
        }, assetFileName),
      {
        timeout: appBootTimeoutMs,
        message: `${description} must request the expected brand asset from the live runtime.`,
      },
    )
    .toBe(true);
}

async function expectBrandControlRendered(locator, assetFileName, description) {
  await expect(locator).toBeVisible({ timeout: appBootTimeoutMs });
  await expect
    .poll(
      async () =>
        locator.evaluate((node, expectedAssetFileName) => {
          if (!(node instanceof HTMLElement)) {
            return false;
          }
          const normalizedExpected = String(
            expectedAssetFileName || '',
          ).toLowerCase();
          const html = node.innerHTML.toLowerCase();
          if (normalizedExpected && html.includes(normalizedExpected)) {
            return true;
          }
          if (normalizedExpected.endsWith('.svg')) {
            return node.querySelector('svg, img') != null;
          }
          if (normalizedExpected.endsWith('.png')) {
            return node.querySelector('img') != null;
          }
          return false;
        }, assetFileName),
      {
        timeout: appBootTimeoutMs,
        message: `${description} must render the branded asset on the visible control, not only fetch it.`,
      },
    )
    .toBe(true);
  await expect
    .poll(
      async () =>
        locator.evaluate((node) => {
          if (!(node instanceof HTMLElement)) {
            return '';
          }
          return (node.innerText || '').trim();
        }),
      {
        timeout: appBootTimeoutMs,
        message: `${description} must not degrade into a text-only fallback.`,
      },
    )
    .toBe('');
}

async function screenshot(page, filename) {
  fs.mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({
    path: path.join(screenshotDir, filename),
    fullPage: true,
  });
}

test('@mutation NAV-DIR-BRAND-01 Waze and Uber brand controls render on shared directions surfaces', async ({
  page,
}) => {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  let token = '';
  let profileType = '';
  let accountSlug = '';
  let profileSlug = '';
  let profileId = '';
  let eventTypeId = '';
  let eventSlug = '';
  let eventId = '';
  let occurrenceId = '';
  let primaryError = null;

  try {
    token = await loginTenantAdminToken(api, baseUrl);
    profileType = await createDirectionsProfileType(api, baseUrl, token);
    const profile = await createDirectionsProfile(api, baseUrl, token, profileType);
    accountSlug = profile.accountSlug;
    profileSlug = profile.profileSlug;
    profileId = profile.profileId;

    const eventType = await createDirectionsEventType(api, baseUrl, token);
    eventTypeId = textValue(eventType?.id);
    const event = await createDirectionsEvent(api, baseUrl, token, {
      eventType,
      physicalHostId: profileId,
    });
    eventSlug = textValue(event?.slug);
    eventId = textValue(event?.event_id, event?.id);
    occurrenceId = eventOccurrenceId(event);

    expect(profileSlug, 'Directions account fixture must expose a public slug.').toBeTruthy();
    expect(occurrenceId, 'Directions event fixture must expose an occurrence id.').toBeTruthy();
    await waitForPublicProfile(page, baseUrl, profileSlug);
    await waitForPublicEvent(page, baseUrl, eventSlug);
    await assertBrandAssetsServed(page, baseUrl);
    const eventPath = `/agenda/evento/${eventSlug}?occurrence=${occurrenceId}`;

    await page.setViewportSize({ width: 390, height: 844 });
    await openAppPath(page, baseUrl, `/parceiro/${profileSlug}`);
    await openDirectionsTab(page, 'Account Profile mobile');
    const accountMobileWazeButton = await visibleLabelLocator(
      page,
      'Waze',
      'Account Profile mobile directions',
    );
    const accountMobileUberButton = await visibleLabelLocator(
      page,
      'Uber',
      'Account Profile mobile directions',
    );
    await expectBrandAssetUsedByRuntime(
      page,
      'waze_logo_2022.png',
      'Account Profile mobile Waze control',
    );
    await expectBrandControlRendered(
      accountMobileWazeButton,
      'waze_logo_2022.png',
      'Account Profile mobile Waze control',
    );
    await expectBrandAssetUsedByRuntime(
      page,
      'uber_logotype.svg',
      'Account Profile mobile Uber control',
    );
    await expectBrandControlRendered(
      accountMobileUberButton,
      'uber_logotype.svg',
      'Account Profile mobile Uber control',
    );
    await screenshot(page, 'account-mobile-directions.png');

    const otherButton = await visibleLabelLocator(
      page,
      'Outros',
      'Account Profile mobile directions',
    );
    await otherButton.click();
    await visibleLabelLocator(page, 'Fechar', 'Directions chooser sheet');
    const googleMapsButton = await visibleLabelLocator(
      page,
      'Google Maps',
      'Directions chooser sheet',
    );
    const ninetyNineButton = await visibleLabelLocator(
      page,
      '99',
      'Directions chooser sheet',
    );
    await expectBrandAssetUsedByRuntime(
      page,
      'google_maps_icon_2020.svg',
      'Directions chooser Google Maps control',
    );
    await expectBrandControlRendered(
      googleMapsButton,
      'google_maps_icon_2020.svg',
      'Directions chooser Google Maps control',
    );
    await expectBrandAssetUsedByRuntime(
      page,
      '99_logo_2023.png',
      'Directions chooser 99 control',
    );
    await expectBrandControlRendered(
      ninetyNineButton,
      '99_logo_2023.png',
      'Directions chooser 99 control',
    );
    await page.waitForTimeout(1800);
    await screenshot(page, 'account-mobile-other-sheet.png');

    await page.setViewportSize({ width: 1440, height: 900 });
    await openAppPath(page, baseUrl, `/parceiro/${profileSlug}`);
    await openDirectionsTab(page, 'Account Profile desktop');
    const accountDesktopWazeButton = await visibleLabelLocator(
      page,
      'Waze',
      'Account Profile desktop directions',
    );
    const accountDesktopUberButton = await visibleLabelLocator(
      page,
      'Uber',
      'Account Profile desktop directions',
    );
    await expectBrandAssetUsedByRuntime(
      page,
      'waze_logo_2022.png',
      'Account Profile desktop Waze control',
    );
    await expectBrandControlRendered(
      accountDesktopWazeButton,
      'waze_logo_2022.png',
      'Account Profile desktop Waze control',
    );
    await expectBrandAssetUsedByRuntime(
      page,
      'uber_logotype.svg',
      'Account Profile desktop Uber control',
    );
    await expectBrandControlRendered(
      accountDesktopUberButton,
      'uber_logotype.svg',
      'Account Profile desktop Uber control',
    );
    await screenshot(page, 'account-desktop-directions.png');

    await page.setViewportSize({ width: 390, height: 844 });
    await openAppPath(page, baseUrl, eventPath);
    await openDirectionsTab(page, 'Event mobile');
    const eventMobileWazeButton = await visibleLabelLocator(
      page,
      'Waze',
      'Event mobile directions',
    );
    const eventMobileUberButton = await visibleLabelLocator(
      page,
      'Uber',
      'Event mobile directions',
    );
    await expectBrandAssetUsedByRuntime(
      page,
      'waze_logo_2022.png',
      'Event mobile Waze control',
    );
    await expectBrandControlRendered(
      eventMobileWazeButton,
      'waze_logo_2022.png',
      'Event mobile Waze control',
    );
    await expectBrandAssetUsedByRuntime(
      page,
      'uber_logotype.svg',
      'Event mobile Uber control',
    );
    await expectBrandControlRendered(
      eventMobileUberButton,
      'uber_logotype.svg',
      'Event mobile Uber control',
    );
    await screenshot(page, 'event-mobile-directions.png');
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await runCleanupPreservingPrimaryError(primaryError, async () => {
      await deleteEvent(api, baseUrl, token, eventId);
      if (accountSlug) {
        await cleanupOnboardedAccount(api, baseUrl, token, accountSlug);
      }
      await deleteEventType(api, baseUrl, token, eventTypeId);
      await deleteAccountProfileType(api, baseUrl, token, profileType);
    });
    await api.dispose();
  }
});
