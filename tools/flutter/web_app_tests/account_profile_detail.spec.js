const crypto = require('crypto');
const { test, expect, request } = require('@playwright/test');
const {
  loginTenantAdmin: loginTenantAdminWithRequiredCredentials,
} = require('./support/tenant_admin_auth');

const tenantUrl = process.env.NAV_TENANT_URL;
const appBootTimeoutMs = 90000;

test.describe.configure({ timeout: 300000 });

function requireTenantUrl() {
  expect(
    tenantUrl,
    'Missing NAV_TENANT_URL. APD web specs require a live tenant URL.',
  ).toBeTruthy();
  return tenantUrl;
}

function buildUrl(baseUrl, pathName) {
  return new URL(pathName, baseUrl).toString();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function labelPattern(label) {
  return new RegExp(escapeRegExp(String(label).trim()), 'i');
}

function normalizePayload(payload) {
  if (payload?.data && typeof payload.data === 'object') {
    return payload.data;
  }
  return payload;
}

function normalizeRows(payload) {
  const data = normalizePayload(payload);
  if (Array.isArray(data)) {
    return data;
  }
  if (Array.isArray(data?.data)) {
    return data.data;
  }
  if (Array.isArray(data?.items)) {
    return data.items;
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

async function createApiContext(baseUrl) {
  return request.newContext({
    baseURL: baseUrl,
    extraHTTPHeaders: {
      Accept: 'application/json',
    },
    ignoreHTTPSErrors: true,
  });
}

async function loginTenantAdmin(api, baseUrl) {
  const session = await loginTenantAdminWithRequiredCredentials({
    api,
    baseUrl,
    buildUrl,
    deviceName: 'playwright-account-profile-detail',
  });
  return session.token;
}

async function authHeaders(token) {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  };
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
    .update(`account-profile-detail:${baseUrl}`)
    .digest('hex');
}

async function resolveAnonymousIdentityToken(api, baseUrl) {
  const response = await api.post(
    buildUrl(baseUrl, '/api/v1/anonymous/identities'),
    {
      data: {
        device_name: 'playwright-account-profile-detail',
        fingerprint: {
          hash: anonymousFingerprintHash(baseUrl),
          user_agent: 'playwright-account-profile-detail',
          locale: 'pt-BR',
        },
        metadata: {
          source: 'web_navigation_account_profile_detail',
        },
      },
      headers: { Accept: 'application/json' },
    },
  );
  expect(
    [200, 201],
    `Anonymous tenant identity bootstrap must succeed. Status ${response.status()}`,
  ).toContain(response.status());
  const payload = await response.json();
  const token = payload?.data?.token?.toString() || '';
  expect(token, 'Anonymous tenant identity bootstrap must return data.token.')
    .toBeTruthy();
  return token;
}

async function fetchJson(api, baseUrl, pathName, token, label) {
  const response = await api.get(buildUrl(baseUrl, pathName), {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
  expect(response.status(), `${label} must load from ${pathName}.`)
    .toBeLessThan(400);
  return response.json();
}

async function fetchPublicProfiles(api, baseUrl, token) {
  const payload = await fetchJson(
    api,
    baseUrl,
    '/api/v1/account_profiles?per_page=50',
    token,
    'Public account profiles list',
  );
  return normalizeRows(payload).filter((row) => textValue(row?.slug));
}

async function fetchPublicProfileDetail(api, baseUrl, token, slug) {
  return normalizePayload(
    await fetchJson(
      api,
      baseUrl,
      `/api/v1/account_profiles/${slug}`,
      token,
      `Public account profile detail ${slug}`,
    ),
  );
}

async function deleteAccountProfile(api, baseUrl, token, profileId) {
  if (!profileId) {
    return;
  }

  await api.delete(buildUrl(baseUrl, `/admin/api/v1/account_profiles/${profileId}`), {
    headers: await authHeaders(token),
    failOnStatusCode: false,
  });
}

async function deleteAccountProfileType(api, baseUrl, token, profileType) {
  if (!profileType) {
    return;
  }

  await api.delete(
    buildUrl(
      baseUrl,
      `/admin/api/v1/account_profile_types/${encodeURIComponent(profileType)}`,
    ),
    {
      headers: await authHeaders(token),
      failOnStatusCode: false,
    },
  );
}

async function deleteEvent(api, baseUrl, token, eventId) {
  if (!eventId) {
    return;
  }

  await api.delete(buildUrl(baseUrl, `/admin/api/v1/events/${eventId}`), {
    headers: await authHeaders(token),
    failOnStatusCode: false,
  });
}

async function deleteEventType(api, baseUrl, token, eventTypeId) {
  if (!eventTypeId) {
    return;
  }

  await api.delete(buildUrl(baseUrl, `/admin/api/v1/event_types/${eventTypeId}`), {
    headers: await authHeaders(token),
    failOnStatusCode: false,
  });
}

async function resolvePoiCapableProfileType(api, baseUrl, token) {
  const response = await api.get(
    buildUrl(baseUrl, '/admin/api/v1/account_profile_types'),
    {
      headers: await authHeaders(token),
    },
  );
  expect(response.status(), 'Account profile types must load.').toBe(200);

  const payload = await response.json();
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const selected = rows.find((row) => row?.capabilities?.is_poi_enabled === true);
  if (selected) {
    return { profileType: selected.type, createdType: null };
  }

  const type = `playwright-apd-${Date.now()}`;
  const createResponse = await api.post(
    buildUrl(baseUrl, '/admin/api/v1/account_profile_types'),
    {
      data: {
        type,
        label: 'Playwright APD',
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
      headers: await authHeaders(token),
    },
  );
  expect(
    createResponse.status(),
    'Fallback APD profile type must be created when none exists.',
  ).toBe(201);

  return { profileType: type, createdType: type };
}

async function createPoiAccountProfile(api, baseUrl, token, profileType) {
  const uniqueSuffix = Date.now();
  const response = await api.post(
    buildUrl(baseUrl, '/admin/api/v1/account_onboardings'),
    {
      data: {
        name: `Playwright APD ${uniqueSuffix}`,
        ownership_state: 'tenant_owned',
        profile_type: profileType,
        location: {
          lat: -20.671339,
          lng: -40.495395,
        },
      },
      headers: await authHeaders(token),
    },
  );
  expect(response.status(), 'Account onboarding must succeed.').toBe(201);

  const payload = await response.json();
  const data = normalizePayload(payload);
  const profile = data?.account_profile || {};
  const account = data?.account || {};
  return {
    accountSlug: account?.slug?.toString() || '',
    profileId: profile?.id?.toString() || '',
    profileSlug: profile?.slug?.toString() || account?.slug?.toString() || '',
    displayName: profile?.display_name?.toString() || account?.name?.toString(),
  };
}

async function createDetailEvent(api, baseUrl, token, { eventType, physicalHost }) {
  const uniqueSuffix = Date.now();
  const start = new Date(Date.now() + 30 * 60 * 1000);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const response = await api.post(buildUrl(baseUrl, '/admin/api/v1/events'), {
    data: {
      title: `Playwright APD Event ${uniqueSuffix}`,
      content: '<p>Playwright APD detail event.</p>',
      type: {
        id: eventType.id,
        name: eventType.name,
        slug: eventType.slug,
        description: eventType.description || 'Playwright APD event type',
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
    headers: await authHeaders(token),
  });
  expect(response.status(), 'APD detail event seed must succeed.').toBe(201);

  const payload = await response.json();
  return payload?.data || {};
}

async function createDetailEventType(api, baseUrl, token) {
  const uniqueSuffix = Date.now();
  const response = await api.post(
    buildUrl(baseUrl, '/admin/api/v1/event_types'),
    {
      data: {
        name: `Playwright APD ${uniqueSuffix}`,
        slug: `playwright-apd-${uniqueSuffix}`,
        description: 'Playwright APD detail event type',
      },
      headers: await authHeaders(token),
    },
  );
  expect(response.status(), 'APD event type seed must succeed.').toBe(201);

  const payload = await response.json();
  return payload?.data || {};
}

async function gotoPublicProfileDetailAndWaitForHydration(page, baseUrl, slug) {
  const responsePromise = page.waitForResponse(
    (candidate) => {
      if (candidate.request().method().toUpperCase() !== 'GET') {
        return false;
      }
      const url = new URL(candidate.url());
      return url.pathname === `/api/v1/account_profiles/${slug}`;
    },
    { timeout: appBootTimeoutMs },
  );

  const response = await page.goto(buildUrl(baseUrl, `/parceiro/${slug}`), {
    waitUntil: 'domcontentloaded',
  });
  expect(response, 'Public account profile response should be available.')
    .not.toBeNull();
  expect(response.status(), 'Public account profile document must load.')
    .toBeLessThan(400);

  const hydratedResponse = await responsePromise;
  expect(hydratedResponse.status(), 'Profile detail API must load.')
    .toBeLessThan(400);
  await assertAppBooted(page);
  await enableAccessibilityIfNeeded(page);

  const payload = await hydratedResponse.json();
  return normalizePayload(payload);
}

function taxonomySnapshot(row) {
  const terms = Array.isArray(row?.taxonomy_terms) ? row.taxonomy_terms : [];
  return terms
    .map((term) => ({
      display: textValue(term?.name, term?.label),
      value: textValue(term?.value),
    }))
    .find((term) => term.display && term.value && term.display !== term.value);
}

function agendaOccurrences(row) {
  return Array.isArray(row?.agenda_occurrences) ? row.agenda_occurrences : [];
}

function locationPayload(row) {
  return row?.location || row?.poi || row?.map_poi || null;
}

function isMinimalNoSections(row) {
  const about = textValue(row?.bio, row?.content, row?.description);
  return !about && agendaOccurrences(row).length === 0;
}

async function loadRuntimeProfiles(api, baseUrl) {
  const token = await resolveAnonymousIdentityToken(api, baseUrl);
  const rows = await fetchPublicProfiles(api, baseUrl, token);
  const details = [];
  for (const row of rows.slice(0, 20)) {
    details.push(await fetchPublicProfileDetail(api, baseUrl, token, row.slug));
  }
  return { token, rows: details };
}

async function openTenantPath(page, baseUrl, pathName) {
  const response = await page.goto(buildUrl(baseUrl, pathName), {
    waitUntil: 'domcontentloaded',
  });
  expect(response, `Response should be available for ${pathName}`).not.toBeNull();
  expect(response.status(), `Response should be successful for ${pathName}`)
    .toBeLessThan(400);
  await assertAppBooted(page);
  await enableAccessibilityIfNeeded(page);
}

async function clickBackAffordance(page, label) {
  const namedBack = page.getByRole('button', { name: /voltar|back/i });
  if ((await namedBack.count()) > 0) {
    await namedBack.first().click();
    return;
  }
  const firstButton = page.getByRole('button').first();
  await expect(firstButton, `${label} must expose a back button`).toBeVisible({
    timeout: appBootTimeoutMs,
  });
  await firstButton.click();
}

async function clickLocatorCenter(page, locator, description) {
  await expect(locator, description).toBeVisible({ timeout: appBootTimeoutMs });
  await locator.click({ timeout: appBootTimeoutMs });
}

async function findVisibleDiscoveryProfileAction(page, rows) {
  for (const row of rows) {
    const name = textValue(row?.display_name, row?.name, row?.legal_name);
    if (!name) {
      continue;
    }
    const prefix = name.slice(0, Math.min(name.length, 18));
    const namedButton = page
      .getByRole('button', {
        name: new RegExp(`Abrir perfil\\s+${escapeRegExp(prefix)}`, 'i'),
      })
      .first();
    if (await namedButton.isVisible().catch(() => false)) {
      return namedButton;
    }
  }
  return null;
}

async function clickDiscoveryProfileCardAndWaitForDetail(page, rows) {
  const visibleProfileAction = await findVisibleDiscoveryProfileAction(page, rows);
  if (visibleProfileAction) {
    await clickLocatorCenter(
      page,
      visibleProfileAction,
      'Discovery Account Profile card must be a real tappable target.',
    );
    if (
      await page
        .waitForURL(/\/parceiro\//, { timeout: 5000 })
        .then(() => true)
        .catch(() => false)
    ) {
      return true;
    }
  }

  return /\/parceiro\//.test(page.url());
}

async function continueWithoutLocationIfPrompted(page) {
  if (!/\/location\/permission/.test(page.url())) {
    return;
  }
  const continueButton = page.getByRole('button', {
    name: /Continuar sem localizacao|Continuar sem localização/i,
  });
  if ((await continueButton.count()) > 0) {
    await continueButton.first().click();
  } else {
    await clickLocatorCenter(
      page,
      page.getByText(/Continuar sem localizacao|Continuar sem localização/i).first(),
      'Location permission fallback must expose Continuar sem localização.',
    );
  }
  expect(
    /\/location\/permission/.test(page.url()),
    'Location permission prompt must be dismissed through the visible semantic CTA.',
  ).toBe(false);
  await assertAppBooted(page);
  await enableAccessibilityIfNeeded(page);
}

test('@readonly NAV-APD-01 Discovery profile detail back stack does not reopen stale detail', async ({
  page,
}) => {
  const baseUrl = requireTenantUrl();
  const { rows } = await loadRuntimeProfiles(page.request, baseUrl);
  const candidate = rows.find((row) => textValue(row?.slug, row?.display_name));
  expect(candidate, 'Seed at least one public Account Profile for NAV-APD-01.')
    .toBeTruthy();

  await openTenantPath(page, baseUrl, '/');
  const procurarChip = page.getByRole('button', { name: /^Procurar$/i }).first();
  await expect(procurarChip, 'Home favorites strip must expose the Procurar chip.')
    .toBeVisible({ timeout: appBootTimeoutMs });
  await procurarChip.scrollIntoViewIfNeeded();
  await procurarChip.click();
  await expect(page).toHaveURL(/\/descobrir/, { timeout: appBootTimeoutMs });

  expect(
    await clickDiscoveryProfileCardAndWaitForDetail(page, rows),
    'Discovery must open a public Account Profile detail from a real visible card tap.',
  ).toBe(true);
  await expect(page).toHaveURL(/\/parceiro\//, {
    timeout: appBootTimeoutMs,
  });
  const openedDetailUrl = page.url();

  await clickBackAffordance(page, 'Account Profile detail');
  await expect(page).toHaveURL(/\/descobrir/, { timeout: appBootTimeoutMs });
  expect(page.url()).not.toBe(openedDetailUrl);

  await clickBackAffordance(page, 'Discovery');
  await expect(page).toHaveURL(/\/($|#\/?$|\?)/, { timeout: appBootTimeoutMs });
  expect(page.url()).not.toBe(openedDetailUrl);
});

test('@readonly NAV-APD-02..06 and NAV-APD-10 hero, taxonomy, tabs, social removal, and favorite empty state are visible', async ({
  page,
}) => {
  const baseUrl = requireTenantUrl();
  const { rows } = await loadRuntimeProfiles(page.request, baseUrl);
  const taxonomyCandidate = rows.find((row) => taxonomySnapshot(row));
  const minimalCandidate = rows.find(isMinimalNoSections);
  const profile = taxonomyCandidate || rows[0];
  expect(profile, 'Seed at least one public Account Profile for NAV-APD-02..06.')
    .toBeTruthy();

  await openTenantPath(page, baseUrl, `/parceiro/${profile.slug}`);
  await expect(page.getByText(labelPattern(textValue(profile.display_name, profile.name))).first())
    .toBeVisible({ timeout: appBootTimeoutMs });

  await page.mouse.wheel(0, 900);
  await expect(page.getByText(labelPattern(textValue(profile.display_name, profile.name))).first())
    .toBeVisible({ timeout: appBootTimeoutMs });
  await expect(page.getByText(/seguidores|curtidas|87/i)).toHaveCount(0);

  const snapshot = taxonomySnapshot(profile);
  if (snapshot) {
    await expect(page.getByText(labelPattern(snapshot.display)).first())
      .toBeVisible({ timeout: appBootTimeoutMs });
    await expect(page.getByText(new RegExp(`^${escapeRegExp(snapshot.value)}$`, 'i')))
      .toHaveCount(0);
  }

  const tabs = ['Sobre', 'Agenda', 'Como Chegar'];
  for (const tab of tabs) {
    const locator = page.getByText(new RegExp(`^${tab}$`, 'i'));
    if ((await locator.count()) > 0) {
      await locator.first().click();
      await expect(locator.first()).toBeVisible();
    }
  }

  if (minimalCandidate) {
    await openTenantPath(page, baseUrl, `/parceiro/${minimalCandidate.slug}`);
    const minimalName = textValue(minimalCandidate.display_name, minimalCandidate.name);
    await expect(
      page.getByText(
        labelPattern(`Favorite para ser avisado das novidades sobre ${minimalName}.`),
      ).first(),
    ).toBeVisible({ timeout: appBootTimeoutMs });
    await expect(page.getByText('Mais sobre este perfil')).toHaveCount(0);
  }
});

test('@readonly NAV-APD-12 mobile breakpoint keeps title and taxonomy chips readable', async ({
  page,
}) => {
  const baseUrl = requireTenantUrl();
  await page.setViewportSize({ width: 390, height: 844 });
  const { rows } = await loadRuntimeProfiles(page.request, baseUrl);
  const candidates = rows
    .filter((row) => textValue(row?.display_name, row?.name, row?.title))
    .sort((left, right) => (
      textValue(right?.display_name, right?.name, right?.title).length
      - textValue(left?.display_name, left?.name, left?.title).length
    ));
  const profile = candidates.find((row) => taxonomySnapshot(row)) || candidates[0];
  expect(profile, 'Seed at least one public Account Profile for NAV-APD-12.')
    .toBeTruthy();

  const profileName = textValue(profile.display_name, profile.name, profile.title);
  await openTenantPath(page, baseUrl, `/parceiro/${profile.slug}`);
  await expect(page.getByText(labelPattern(profileName)).first())
    .toBeVisible({ timeout: appBootTimeoutMs });
  await page.mouse.wheel(0, 900);
  await expect(page.getByText(labelPattern(profileName)).first())
    .toBeVisible({ timeout: appBootTimeoutMs });

  const snapshot = taxonomySnapshot(profile);
  if (snapshot) {
    await expect(page.getByText(labelPattern(snapshot.display)).first())
      .toBeVisible({ timeout: appBootTimeoutMs });
    await expect(page.getByText(new RegExp(`^${escapeRegExp(snapshot.value)}$`, 'i')))
      .toHaveCount(0);
  }
});

test('@mutation NAV-APD-07..08 agenda is occurrence-first and cards navigate to event detail', async ({
  page,
}) => {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  let sessionToken = null;
  let createdProfileId = null;
  let createdProfileType = null;
  let createdEventId = null;
  let createdEventTypeId = null;

  try {
    sessionToken = await loginTenantAdmin(api, baseUrl);
    const profileTypeSeed = await resolvePoiCapableProfileType(
      api,
      baseUrl,
      sessionToken,
    );
    createdProfileType = profileTypeSeed.createdType;
    const createdProfile = await createPoiAccountProfile(
      api,
      baseUrl,
      sessionToken,
      profileTypeSeed.profileType,
    );
    createdProfileId = createdProfile.profileId;

    const eventType = await createDetailEventType(api, baseUrl, sessionToken);
    createdEventTypeId = eventType?.id?.toString() || null;
    const seededEvent = await createDetailEvent(api, baseUrl, sessionToken, {
      eventType,
      physicalHost: {
        id: createdProfileId,
      },
    });
    createdEventId = seededEvent?.event_id?.toString() || null;
    const eventTitle = textValue(seededEvent?.title, seededEvent?.name);
    const eventSlug = textValue(seededEvent?.slug, createdEventId);
    expect(eventTitle, 'Seeded event must expose a visible title.').toBeTruthy();

    const broadEventRequests = [];
    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('/api/v1/events') && !url.includes('/api/v1/events/')) {
        broadEventRequests.push(url);
      }
    });

    const detailPayload = await gotoPublicProfileDetailAndWaitForHydration(
      page,
      baseUrl,
      createdProfile.profileSlug,
    );

    const occurrences = agendaOccurrences(detailPayload);
    expect(
      occurrences,
      'Account Profile detail must expose occurrence-first agenda_occurrences.',
    ).not.toHaveLength(0);
    expect(
      textValue(occurrences[0]?.title, occurrences[0]?.event_title),
      'The first agenda occurrence must carry the seeded event title.',
    ).toBe(eventTitle);

    await expect(page.getByText(labelPattern(eventTitle)).first()).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    expect(
      broadEventRequests,
      'Account Profile detail must not fetch a broad events catalog to render agenda_occurrences.',
    ).toEqual([]);

    await page.getByText(labelPattern(eventTitle)).first().click();
    await expect(page).toHaveURL(
      new RegExp(`/agenda/evento/${escapeRegExp(eventSlug)}`),
      {
        timeout: appBootTimeoutMs,
      },
    );
  } finally {
    await deleteEvent(api, baseUrl, sessionToken, createdEventId);
    await deleteEventType(api, baseUrl, sessionToken, createdEventTypeId);
    await deleteAccountProfile(api, baseUrl, sessionToken, createdProfileId);
    await deleteAccountProfileType(
      api,
      baseUrl,
      sessionToken,
      createdProfileType,
    );
    await api.dispose();
  }
});

test('@mutation NAV-APD-09 Como Chegar opens focused map and shared route chooser', async ({
  page,
}) => {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  let sessionToken = null;
  let createdProfileId = null;
  let createdProfileType = null;

  try {
    await page.context().grantPermissions(['geolocation'], { origin: baseUrl });
    await page
      .context()
      .setGeolocation({ latitude: -20.671339, longitude: -40.495395 });

    sessionToken = await loginTenantAdmin(api, baseUrl);
    const profileTypeSeed = await resolvePoiCapableProfileType(
      api,
      baseUrl,
      sessionToken,
    );
    createdProfileType = profileTypeSeed.createdType;
    const createdProfile = await createPoiAccountProfile(
      api,
      baseUrl,
      sessionToken,
      profileTypeSeed.profileType,
    );
    createdProfileId = createdProfile.profileId;

    const detailPayload = await gotoPublicProfileDetailAndWaitForHydration(
      page,
      baseUrl,
      createdProfile.profileSlug,
    );
    expect(
      locationPayload(detailPayload),
      'Seeded account profile must expose location/POI data for NAV-APD-09.',
    ).toBeTruthy();

    await expect(page.getByText(/Como Chegar/i).first()).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    await page.getByText(/Ver no mapa/i).first().click();
    await continueWithoutLocationIfPrompted(page);
    await expect(page).toHaveURL(/\/mapa.*poi=account_profile/i, {
      timeout: appBootTimeoutMs,
    });

    await gotoPublicProfileDetailAndWaitForHydration(
      page,
      baseUrl,
      createdProfile.profileSlug,
    );
    const routeChooserCta = page
      .getByRole('button', { name: /Traçar rota/i })
      .first();
    if (!(await routeChooserCta.isVisible().catch(() => false))) {
      await clickLocatorCenter(
        page,
        page.getByRole('button', { name: /^Como Chegar$/i }).first(),
        'Account Profile detail must expose the Como Chegar tab as a semantic button when route CTA is not already visible.',
      );
    }
    await clickLocatorCenter(
      page,
      routeChooserCta,
      'Account Profile detail must expose the shared route chooser CTA.',
    );
    await expect(page.getByText(/Google Maps|Apple Maps|Waze|Navegar/i).first())
      .toBeVisible({ timeout: appBootTimeoutMs });
  } finally {
    await deleteAccountProfile(api, baseUrl, sessionToken, createdProfileId);
    await deleteAccountProfileType(
      api,
      baseUrl,
      sessionToken,
      createdProfileType,
    );
    await api.dispose();
  }
});
