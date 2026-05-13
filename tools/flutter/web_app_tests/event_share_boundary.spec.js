const { test, expect, request } = require('@playwright/test');
const { loginTenantAdmin } = require('./support/tenant_admin_auth');

const tenantUrl = process.env.NAV_TENANT_URL;
const appBootTimeoutMs = 90000;
const seedTitle = 'PW Event Share Boundary Store Release';

test.describe.configure({ timeout: 300000 });

function requireTenantUrl() {
  expect(
    tenantUrl,
    'Missing NAV_TENANT_URL. Event share boundary suite requires a live tenant URL.',
  ).toBeTruthy();
  return tenantUrl;
}

function buildUrl(baseUrl, pathName) {
  return new URL(pathName, baseUrl).toString();
}

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

async function createEventType(api, baseUrl, token, uniqueSuffix) {
  const slug = `pw-event-share-${uniqueSuffix}`;
  const response = await api.post(buildUrl(baseUrl, '/admin/api/v1/event_types'), {
    data: {
      name: `PW Event Share ${uniqueSuffix}`,
      slug,
      description: 'Playwright event share boundary type',
    },
    headers: authHeaders(token),
  });
  expect(response.status(), 'Event type seed must succeed.').toBe(201);
  const payload = await response.json();
  return payload?.data;
}

async function fetchPhysicalHostCandidates(api, baseUrl, token) {
  const url = new URL(
    buildUrl(baseUrl, '/admin/api/v1/events/account_profile_candidates'),
  );
  url.searchParams.set('type', 'physical_host');
  url.searchParams.set('page', '1');
  url.searchParams.set('page_size', '20');
  const response = await api.get(url.toString(), {
    headers: authHeaders(token),
  });
  expect(
    response.status(),
    'Tenant-admin physical host candidates must load for event share seed.',
  ).toBe(200);
  const payload = await response.json();
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return rows.filter((row) => row?.id?.toString().trim());
}

async function resolvePoiCapableProfileType(api, baseUrl, token) {
  const response = await api.get(
    buildUrl(baseUrl, '/admin/api/v1/account_profile_types'),
    {
      headers: authHeaders(token),
    },
  );
  expect(response.status(), 'Account profile types must load.').toBe(200);

  const payload = await response.json();
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const selected = rows.find(
    (row) =>
      row?.capabilities?.is_poi_enabled === true &&
      row?.capabilities?.is_reference_location_enabled === true,
  );
  if (selected?.type) {
    return selected.type;
  }

  const type = `pw-share-host-${Date.now()}`;
  const createResponse = await api.post(
    buildUrl(baseUrl, '/admin/api/v1/account_profile_types'),
    {
      data: {
        type,
        label: 'PW Share Host',
        labels: {
          singular: 'PW Share Host',
          plural: 'PW Share Hosts',
        },
        allowed_taxonomies: [],
        visual: {
          mode: 'icon',
          icon: 'store',
          color: '#0F766E',
          icon_color: '#FFFFFF',
        },
        capabilities: {
          is_favoritable: true,
          is_poi_enabled: true,
          is_reference_location_enabled: true,
          has_bio: false,
          has_content: false,
          has_taxonomies: false,
          has_avatar: false,
          has_cover: false,
          has_events: true,
        },
      },
      headers: authHeaders(token),
    },
  );
  expect(createResponse.status(), 'Fallback share host profile type must be created.')
    .toBe(201);
  return type;
}

async function createPhysicalHost(api, baseUrl, token, name) {
  const profileType = await resolvePoiCapableProfileType(api, baseUrl, token);
  const response = await api.post(
    buildUrl(baseUrl, '/admin/api/v1/account_onboardings'),
    {
      data: {
        name,
        ownership_state: 'tenant_owned',
        profile_type: profileType,
        location: {
          lat: -20.671339,
          lng: -40.495395,
        },
      },
      headers: authHeaders(token),
    },
  );
  expect(response.status(), 'Physical host seed must succeed.').toBe(201);

  const payload = await response.json();
  const profile = payload?.data?.account_profile || {};
  const profileId = profile?.id?.toString() || '';
  expect(profileId, 'Physical host seed must return account_profile id.').toBeTruthy();
  return {
    id: profileId,
    display_name: textValue(profile?.display_name, profile?.name, name),
  };
}

async function createSeedEvent(api, baseUrl, token) {
  const uniqueSuffix = Date.now().toString();
  const eventType = await createEventType(api, baseUrl, token, uniqueSuffix);
  const hostCandidates = await fetchPhysicalHostCandidates(api, baseUrl, token);
  const physicalHost =
    hostCandidates[0] ||
    (await createPhysicalHost(
      api,
      baseUrl,
      token,
      `PW Event Share Host ${uniqueSuffix}`,
    ));
  const start = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  const response = await api.post(buildUrl(baseUrl, '/admin/api/v1/events'), {
    data: {
      title: seedTitle,
      content: '<p>Playwright event share boundary validation event.</p>',
      type: {
        id: eventType.id,
        name: eventType.name,
        slug: eventType.slug,
        description: eventType.description || 'Playwright event type',
      },
      location: {
        mode: 'physical',
      },
      place_ref: {
        type: 'account_profile',
        id: physicalHost.id,
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
    headers: authHeaders(token),
  });
  expect(response.status(), 'Event share seed event must be created.').toBe(201);
  const payload = await response.json();
  return payload?.data;
}

function firstOccurrenceId(event) {
  const occurrenceId = event?.occurrences?.[0]?.occurrence_id?.toString() || '';
  expect(occurrenceId, 'Seed event must expose first occurrence id.').toBeTruthy();
  return occurrenceId;
}

function recordShareCreateRequests(page) {
  const requests = [];
  page.on('request', (candidate) => {
    if (candidate.method().toUpperCase() !== 'POST') {
      return;
    }
    const pathname = new URL(candidate.url()).pathname;
    if (pathname === '/api/v1/invites/share') {
      requests.push(`${candidate.method()} ${candidate.url()}`);
    }
  });
  return requests;
}

test('@mutation T6-EVENT-SHARE anonymous web event detail share preserves promotion boundary', async ({
  browser,
}) => {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  const { token } = await loginTenantAdmin({
    api,
    baseUrl,
    deviceName: 'playwright-event-share-boundary',
  });
  const event = await createSeedEvent(api, baseUrl, token);
  const occurrenceId = firstOccurrenceId(event);
  const routeRef = textValue(event?.slug, event?.event_id);
  const eventPath = `/agenda/evento/${routeRef}?occurrence=${occurrenceId}`;
  expect(routeRef, 'Seed event must expose slug or event id route reference.')
    .toBeTruthy();

  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  const shareCreateRequests = recordShareCreateRequests(page);

  try {
    const response = await page.goto(buildUrl(baseUrl, eventPath), {
      waitUntil: 'domcontentloaded',
    });
    expect(response, 'Public event detail response should be available.').not.toBeNull();
    expect(response.status()).toBeLessThan(400);

    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);
    await expect(page.getByRole('button', { name: /Compartilhar/i })).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    await expect(page.getByText(new RegExp(escapeRegExp(seedTitle), 'i'))).toBeVisible({
      timeout: appBootTimeoutMs,
    });

    await page.getByRole('button', { name: /Compartilhar/i }).click();

    const expectedPromotionUrl = `**/baixe-o-app?redirect=${encodeURIComponent(eventPath)}`;
    const promotionOverlayTitle = page.getByText(/fica melhor no app/i).first();

    await Promise.race([
      page.waitForURL(expectedPromotionUrl, {
        timeout: appBootTimeoutMs,
      }),
      promotionOverlayTitle.waitFor({
        state: 'visible',
        timeout: appBootTimeoutMs,
      }),
    ]);

    const landedOnPromotionRoute = page.url().includes('/baixe-o-app?redirect=');
    if (!landedOnPromotionRoute) {
      await expect(
        promotionOverlayTitle,
        'Anonymous event share may stay on the event route only if the promotion guard/modal is visibly open.',
      ).toBeVisible({
        timeout: appBootTimeoutMs,
      });
    }

    expect(
      shareCreateRequests,
      'Anonymous web event-detail share must not create invite share codes on web.',
    ).toEqual([]);
  } finally {
    await context.close();
    await api.dispose();
  }
});
