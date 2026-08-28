const crypto = require('crypto');
const { test, expect, request } = require('@playwright/test');
const {
  loginTenantAdmin: loginTenantAdminWithRequiredCredentials,
} = require('./support/tenant_admin_auth');
const {
  cleanupOnboardedAccount,
  runCleanupPreservingPrimaryError,
} = require('./support/account_onboarding_cleanup');
const {
  agendaOccurrences,
  buildFavoritableProfileTypes,
  buildMinimalEmptyStateExpectation,
  locationPayload,
  selectMinimalEmptyStateCandidate,
} = require('./support/account_profile_detail_empty_state_contract');
const {
  fixture: managedTaxonomyFixture,
  managedFixtureEnabled,
} = require('./support/public_taxonomy_validation_fixture_contract');
const {
  loadAccountProfileAgendaReadonlyFixture,
} = require('./support/account_profile_agenda_readonly_fixture_contract');

const tenantUrl = process.env.NAV_TENANT_URL;
const localRuntimeSeedEnabled =
  (process.env.NAV_DEPLOY_LANE || '').toString().trim().toLowerCase() === 'local';
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

function semanticLabelLocator(page, label) {
  const escapedLabel = String(label).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return page.locator(`[aria-label*="${escapedLabel}"]`).first();
}

async function assertVisibleTextOrSemanticLabel(page, label, contextLabel) {
  const displayLabel = textValue(label);
  expect(displayLabel, `${contextLabel} requires a non-empty label.`).toBeTruthy();

  const visibleText = page.getByText(labelPattern(displayLabel)).first();
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
        message: `${contextLabel} must render "${displayLabel}" as visible text or Flutter semantics.`,
        timeout: appBootTimeoutMs,
      },
    )
    .toBe(true);
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

function humanizedSlugLabel(rawSlug) {
  const normalized = textValue(rawSlug)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) {
    return '';
  }
  return normalized
    .split(' ')
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(' ');
}

function canonicalPublicVisibleName(row, { routeSlug = '', allowSentinel = false } = {}) {
  const displayName = textValue(row?.display_name);
  if (displayName.length >= 3) {
    return displayName;
  }

  const slugLabel = humanizedSlugLabel(row?.slug || routeSlug);
  if (slugLabel) {
    return slugLabel;
  }

  return allowSentinel ? 'Perfil indisponível' : '';
}

function hasFiniteCoordinate(value) {
  if (value == null || value === '') {
    return false;
  }
  return Number.isFinite(Number(value));
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

async function fetchPublicEnvironment(api, baseUrl, token) {
  return normalizePayload(
    await fetchJson(
      api,
      baseUrl,
      '/api/v1/environment',
      token,
      'Public tenant environment',
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

function matchesPoiCapableProfileType(row, { requireEvents = false } = {}) {
  const capabilities = row?.capabilities || {};
  const isPubliclyDiscoverable =
    capabilities.is_publicly_discoverable !== false;
  return capabilities.is_queryable === true
    && capabilities.is_poi_enabled === true
    && capabilities.is_reference_location_enabled === true
    && capabilities.is_favoritable === true
    && isPubliclyDiscoverable
    && (!requireEvents || capabilities.has_events === true);
}

async function resolvePoiCapableProfileType(
  api,
  baseUrl,
  token,
  { requireEvents = false, preferDedicatedType = false } = {},
) {
  if (!preferDedicatedType) {
    const response = await api.get(
      buildUrl(baseUrl, '/admin/api/v1/account_profile_types'),
      {
        headers: await authHeaders(token),
      },
    );
    expect(response.status(), 'Account profile types must load.').toBe(200);

    const payload = await response.json();
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    const selected = rows.find((row) =>
      matchesPoiCapableProfileType(row, { requireEvents }),
    );
    if (selected) {
      return { profileType: selected.type, createdType: null };
    }
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
          is_queryable: true,
          is_publicly_navigable: true,
          is_favoritable: true,
          is_publicly_discoverable: true,
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
        ownership_state: 'unmanaged',
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
  const accountSlug = account?.slug?.toString() || '';
  expect(accountSlug, 'Created POI account must expose an account slug.').toBeTruthy();
  const publishResponse = await api.patch(
    buildUrl(baseUrl, `/admin/api/v1/accounts/${accountSlug}`),
    {
      data: {
        publication: {
          status: 'published',
        },
      },
      headers: await authHeaders(token),
    },
  );
  expect(publishResponse.status(), 'Created POI account must publish successfully.').toBe(200);
  return {
    accountSlug,
    profileId: profile?.id?.toString() || '',
    profileSlug: profile?.slug?.toString() || account?.slug?.toString() || '',
    displayName: profile?.display_name?.toString() || account?.name?.toString(),
  };
}

async function ensureLocalMapDefaultOrigin(api, baseUrl, token) {
  if (!localRuntimeSeedEnabled) {
    return;
  }

  const valuesResponse = await api.get(
    buildUrl(baseUrl, '/admin/api/v1/settings/values'),
    {
      headers: await authHeaders(token),
    },
  );
  expect(
    valuesResponse.status(),
    'Tenant-admin settings values must be readable before seeding local map defaults.',
  ).toBe(200);

  const valuesPayload = normalizePayload(await valuesResponse.json());
  const mapUi =
    valuesPayload?.map_ui && typeof valuesPayload.map_ui === 'object'
      ? valuesPayload.map_ui
      : {};
  const defaultOrigin =
    mapUi?.default_origin && typeof mapUi.default_origin === 'object'
      ? mapUi.default_origin
      : {};
  const hasLatitude = hasFiniteCoordinate(defaultOrigin?.lat);
  const hasLongitude = hasFiniteCoordinate(defaultOrigin?.lng);
  if (hasLatitude && hasLongitude) {
    return;
  }

  const patchResponse = await api.patch(
    buildUrl(baseUrl, '/admin/api/v1/settings/values/map_ui'),
    {
      headers: await authHeaders(token),
      data: {
        'default_origin.lat': -20.671339,
        'default_origin.lng': -40.495395,
        'default_origin.label': 'Praia do Morro',
      },
    },
  );
  expect(
    patchResponse.status(),
    'Local map default origin runtime seed must persist through Settings Kernel.',
  ).toBe(200);

  await expect
    .poll(
      async () => {
        const environment = await fetchPublicEnvironment(api, baseUrl, token);
        const publicDefaultOrigin =
          environment?.settings?.map_ui?.default_origin
          && typeof environment.settings.map_ui.default_origin === 'object'
            ? environment.settings.map_ui.default_origin
            : {};
        return hasFiniteCoordinate(publicDefaultOrigin?.lat)
          && hasFiniteCoordinate(publicDefaultOrigin?.lng);
      },
      {
        message:
          'Local map default origin runtime seed must become visible through the public environment payload.',
        timeout: appBootTimeoutMs,
      },
    )
    .toBe(true);
}

async function cleanupCreatedPoiAccountProfile(
  api,
  baseUrl,
  token,
  { accountSlug, profileId },
) {
  if (accountSlug) {
    await cleanupOnboardedAccount(api, baseUrl, token, accountSlug);
    return;
  }

  expect(
    profileId,
    'Seeded Account Profile cleanup requires either accountSlug or profileId.',
  ).toBeTruthy();
  await deleteAccountProfile(api, baseUrl, token, profileId);
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

async function gotoPublicProfileDetailAndWaitForHydration(
  page,
  baseUrl,
  slug,
  { readPayload = true } = {},
) {
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

  await assertAppBooted(page);
  await enableAccessibilityIfNeeded(page);

  const hydratedResponse = await responsePromise;
  expect(hydratedResponse.status(), 'Profile detail API must load.')
    .toBeLessThan(400);
  if (!readPayload) {
    return null;
  }
  let payload;
  try {
    payload = await hydratedResponse.json();
  } catch (error) {
    throw new Error(
      `Profile detail hydration returned a non-JSON payload for ${slug}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

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

function selectDeterministicTaxonomyProfileRow(rows) {
  return rows
    .filter((row) => canonicalPublicVisibleName(row))
    .filter((row) => taxonomySnapshot(row))
    .reduce((selected, row) => {
      if (!selected) {
        return row;
      }

      const selectedName = canonicalPublicVisibleName(selected);
      const rowName = canonicalPublicVisibleName(row);
      if (rowName.length !== selectedName.length) {
        return rowName.length > selectedName.length ? row : selected;
      }

      const selectedSlug = textValue(selected?.slug);
      const rowSlug = textValue(row?.slug);
      return rowSlug.localeCompare(selectedSlug) < 0 ? row : selected;
    }, null);
}

async function resolveReadonlyProofProfile({ rows, hydrate, contextLabel }) {
  if (managedFixtureEnabled) {
    const profile = await hydrate(managedTaxonomyFixture.profileSlug);
    expect(
      profile,
      `${contextLabel} requires the managed taxonomy proof profile when NAV_PUBLIC_TAXONOMY_MANAGED_FIXTURE=1.`,
    ).toBeTruthy();
    return profile;
  }

  const selectedRow = selectDeterministicTaxonomyProfileRow(rows);
  expect(
    selectedRow,
    `${contextLabel} requires at least one taxonomy-bearing public Account Profile when the managed fixture is disabled.`,
  ).toBeTruthy();
  return hydrate(selectedRow);
}

async function loadRuntimeProfiles(api, baseUrl) {
  if (!loadRuntimeProfiles.catalogCache) {
    loadRuntimeProfiles.catalogCache = new Map();
  }
  if (!loadRuntimeProfiles.detailCache) {
    loadRuntimeProfiles.detailCache = new Map();
  }

  if (!loadRuntimeProfiles.catalogCache.has(baseUrl)) {
    loadRuntimeProfiles.catalogCache.set(baseUrl, (async () => {
      const token = await resolveAnonymousIdentityToken(api, baseUrl);
      const rows = await fetchPublicProfiles(api, baseUrl, token);
      return { token, rows: rows.slice(0, 20) };
    })());
  }

  const catalog = await loadRuntimeProfiles.catalogCache.get(baseUrl);
  return {
    token: catalog.token,
    rows: catalog.rows,
    async hydrate(rowOrSlug) {
      const slug = typeof rowOrSlug === 'string'
        ? textValue(rowOrSlug)
        : textValue(rowOrSlug?.slug);
      expect(slug, 'Runtime Account Profile hydration requires a slug.').toBeTruthy();

      const cacheKey = `${baseUrl}:${slug}`;
      if (!loadRuntimeProfiles.detailCache.has(cacheKey)) {
        loadRuntimeProfiles.detailCache.set(
          cacheKey,
          fetchPublicProfileDetail(api, baseUrl, catalog.token, slug),
        );
      }
      return loadRuntimeProfiles.detailCache.get(cacheKey);
    },
  };
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
  const namedBackCount = await namedBack.count();
  if (namedBackCount > 0) {
    for (let index = 0; index < namedBackCount; index += 1) {
      const candidate = namedBack.nth(index);
      if (!(await candidate.isVisible().catch(() => false))) {
        continue;
      }
      await candidate.click();
      return;
    }
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

function isRetriableDiscoveryActionError(error) {
  const message =
    error instanceof Error ? error.message : String(error ?? '');
  return /detached from the DOM/i.test(message)
    || /element is not attached/i.test(message)
    || /element\(s\) not found/i.test(message)
    || /toBeVisible\(\) failed/i.test(message)
    || /waiting for element to be visible/i.test(message);
}

async function findVisibleDiscoveryProfileActions(page) {
  const deadline = Date.now() + appBootTimeoutMs;

  while (Date.now() < deadline) {
    const visibleActions = [];
    const seenLabels = new Set();

    const namedButtons = page.getByRole('button', {
      name: /^Abrir perfil\s+/i,
    });
    const count = await namedButtons.count();
    for (let index = count - 1; index >= 0; index -= 1) {
      const namedButton = namedButtons.nth(index);
      if (!(await namedButton.isVisible().catch(() => false))) {
        continue;
      }
      const semanticLabel =
        (await namedButton.getAttribute('aria-label').catch(() => null))
        || `visible-profile:${index}`;
      if (seenLabels.has(semanticLabel)) {
        continue;
      }
      seenLabels.add(semanticLabel);
      visibleActions.push(namedButton);
    }

    if (visibleActions.length > 0) {
      return visibleActions;
    }

    await page.waitForTimeout(300);
  }

  return [];
}

async function clickDiscoveryProfileCardAndWaitForDetail(page) {
  const deadline = Date.now() + appBootTimeoutMs;

  while (Date.now() < deadline) {
    const visibleProfileActions =
      await findVisibleDiscoveryProfileActions(page);
    for (const visibleProfileAction of visibleProfileActions) {
      try {
        await clickLocatorCenter(
          page,
          visibleProfileAction,
          'Discovery Account Profile card must be a real tappable target.',
        );
      } catch (error) {
        if (isRetriableDiscoveryActionError(error)) {
          continue;
        }
        throw error;
      }

      if (
        await page
          .waitForURL(/\/parceiro\//, { timeout: 5000 })
          .then(() => true)
          .catch(() => false)
      ) {
        return true;
      }
    }

    await page.waitForTimeout(200);
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
  if ((await continueButton.count()) === 0) {
    await enableAccessibilityIfNeeded(page);
  }
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

test.skip('@deferred @readonly NAV-APD-01 Discovery profile detail back stack does not reopen stale detail', async ({
  page,
}) => {
  const baseUrl = requireTenantUrl();

  await openTenantPath(page, baseUrl, '/');
  const procurarChip = page.getByRole('button', { name: /^Procurar$/i }).first();
  await expect(procurarChip, 'Home favorites strip must expose the Procurar chip.')
    .toBeVisible({ timeout: appBootTimeoutMs });
  await procurarChip.scrollIntoViewIfNeeded();
  await procurarChip.click();
  await expect(page).toHaveURL(/\/descobrir/, { timeout: appBootTimeoutMs });

  expect(
    await clickDiscoveryProfileCardAndWaitForDetail(page),
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

test.skip('@deferred @readonly NAV-APD-02..06 and NAV-APD-10 hero, taxonomy, tabs, social removal, and optional favorite empty state are visible', async ({
  page,
}) => {
  const baseUrl = requireTenantUrl();
  const { rows, hydrate, token } = await loadRuntimeProfiles(page.request, baseUrl);
  const environment = await fetchPublicEnvironment(page.request, baseUrl, token);
  const favoritableProfileTypes = buildFavoritableProfileTypes(
    environment?.profile_types,
  );
  const profile = await resolveReadonlyProofProfile({
    rows,
    hydrate,
    contextLabel: 'NAV-APD-02..06',
  });

  await openTenantPath(page, baseUrl, `/parceiro/${profile.slug}`);
  await assertVisibleTextOrSemanticLabel(
    page,
    canonicalPublicVisibleName(profile, {
      routeSlug: profile.slug,
      allowSentinel: true,
    }),
    'Account Profile detail hero',
  );

  await page.mouse.wheel(0, 900);
  await assertVisibleTextOrSemanticLabel(
    page,
    canonicalPublicVisibleName(profile, {
      routeSlug: profile.slug,
      allowSentinel: true,
    }),
    'Account Profile detail sticky/readable hero after scroll',
  );
  await expect(page.getByText(/seguidores|curtidas|87/i)).toHaveCount(0);

  const snapshot = taxonomySnapshot(profile);
  if (snapshot) {
    await assertVisibleTextOrSemanticLabel(
      page,
      snapshot.display,
      'Account Profile taxonomy display label',
    );
    await expect(page.getByText(new RegExp(`^${escapeRegExp(snapshot.value)}$`, 'i')))
      .toHaveCount(0);
  }

  const tabs = ['Sobre', 'Agenda', 'Como Chegar'];
  for (const tab of tabs) {
    const locator = page.getByRole('button', {
      name: new RegExp(`^${tab}$`, 'i'),
    });
    if ((await locator.count()) > 0) {
      await locator.first().click();
      await expect(locator.first()).toBeVisible();
    }
  }

  const minimalCandidate = await selectMinimalEmptyStateCandidate(
    rows,
    hydrate,
    favoritableProfileTypes,
  );

  if (minimalCandidate) {
    await openTenantPath(page, baseUrl, `/parceiro/${minimalCandidate.profile.slug}`);
    const expectation = buildMinimalEmptyStateExpectation(minimalCandidate);
    await assertVisibleTextOrSemanticLabel(
      page,
      expectation.visibleLabel,
      expectation.assertionLabel,
    );
    if (expectation.hiddenLabel) {
      await expect(page.getByText(expectation.hiddenLabel)).toHaveCount(0);
    }
  }
});

test.skip('@deferred @readonly NAV-APD-12 mobile breakpoint keeps title and taxonomy chips readable', async ({
  page,
}) => {
  const baseUrl = requireTenantUrl();
  await page.setViewportSize({ width: 390, height: 844 });
  const { rows, hydrate } = await loadRuntimeProfiles(page.request, baseUrl);
  const profile = await resolveReadonlyProofProfile({
    rows,
    hydrate,
    contextLabel: 'NAV-APD-12',
  });

  const profileName = canonicalPublicVisibleName(profile, {
    routeSlug: profile.slug,
    allowSentinel: true,
  });
  // NAV-APD-12 verifies mobile readability, not cold-route bootstrap.
  // Direct profile-route boot is already exercised by the other readonly detail tests.
  await openTenantPath(page, baseUrl, '/');
  await openTenantPath(page, baseUrl, `/parceiro/${profile.slug}`);
  await assertVisibleTextOrSemanticLabel(page, profileName, 'Mobile Account Profile hero');

  const snapshot = taxonomySnapshot(profile);
  if (snapshot) {
    await assertVisibleTextOrSemanticLabel(
      page,
      snapshot.display,
      'Mobile Account Profile taxonomy display label',
    );
    await expect(page.getByText(new RegExp(`^${escapeRegExp(snapshot.value)}$`, 'i')))
      .toHaveCount(0);
  }

  await page.mouse.wheel(0, 900);
  await assertVisibleTextOrSemanticLabel(
    page,
    profileName,
    'Mobile Account Profile hero after scroll',
  );
});

test('@mutation NAV-APD-07..08 agenda is occurrence-first and cards navigate to event detail', async ({
  page,
}) => {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  let sessionToken = null;
  let createdProfileId = null;
  let createdAccountSlug = null;
  let createdProfileType = null;
  let createdEventId = null;
  let createdEventTypeId = null;
  let primaryError = null;

  try {
    sessionToken = await loginTenantAdmin(api, baseUrl);
    await ensureLocalMapDefaultOrigin(api, baseUrl, sessionToken);
    const profileTypeSeed = await resolvePoiCapableProfileType(
      api,
      baseUrl,
      sessionToken,
      { requireEvents: true, preferDedicatedType: true },
    );
    createdProfileType = profileTypeSeed.createdType;
    const createdProfile = await createPoiAccountProfile(
      api,
      baseUrl,
      sessionToken,
      profileTypeSeed.profileType,
    );
    createdProfileId = createdProfile.profileId;
    createdAccountSlug = createdProfile.accountSlug;

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
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await runCleanupPreservingPrimaryError(primaryError, async () => {
      try {
        await deleteEvent(api, baseUrl, sessionToken, createdEventId);
        await deleteEventType(api, baseUrl, sessionToken, createdEventTypeId);
        await cleanupCreatedPoiAccountProfile(api, baseUrl, sessionToken, {
          accountSlug: createdAccountSlug,
          profileId: createdProfileId,
        });
        await deleteAccountProfileType(
          api,
          baseUrl,
          sessionToken,
          createdProfileType,
        );
      } finally {
        await api.dispose();
      }
    });
  }
});

test('@readonly-fixture NAV-APD-AGENDA Account Profile Agenda groups managed occurrences by local date', async ({
  page,
}) => {
  const fixture = loadAccountProfileAgendaReadonlyFixture();
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  try {
    const token = await resolveAnonymousIdentityToken(api, baseUrl);
    const detailPayload = await fetchPublicProfileDetail(
      api,
      baseUrl,
      token,
      fixture.profileSlug,
    );
    const occurrences = agendaOccurrences(detailPayload);
    const payloadOccurrenceIds = occurrences.map((occurrence) =>
      textValue(occurrence?.occurrence_id),
    );
    expect(
      payloadOccurrenceIds,
      'Managed Account Profile payload must contain every declared occurrence id.',
    ).toEqual(expect.arrayContaining(fixture.occurrenceIds));
    expect(
      new Set(payloadOccurrenceIds).size,
      'Managed Account Profile payload must preserve distinct occurrence ids.',
    ).toBe(payloadOccurrenceIds.length);

    await gotoPublicProfileDetailAndWaitForHydration(
      page,
      baseUrl,
      fixture.profileSlug,
    );
    const agendaTab = page.getByRole('button', { name: /^Agenda$/i }).first();
    if ((await agendaTab.count()) > 0) {
      await agendaTab.click();
    }

    for (const dateLabel of fixture.dateLabels) {
      await assertVisibleTextOrSemanticLabel(
        page,
        dateLabel,
        'Managed Account Profile Agenda local date section',
      );
    }

    const titleLocators = fixture.eventTitles.map((title) =>
      page.getByText(labelPattern(title)).first(),
    );
    for (const [index, titleLocator] of titleLocators.entries()) {
      await expect(
        titleLocator,
        `Managed Account Profile Agenda occurrence ${fixture.occurrenceIds[index]} must render its card title.`,
      ).toBeVisible({ timeout: appBootTimeoutMs });
    }

    for (let index = 0; index < titleLocators.length - 1; index += 1) {
      const currentBox = await titleLocators[index].boundingBox();
      const nextBox = await titleLocators[index + 1].boundingBox();
      expect(currentBox, `Card ${index} must have a measurable position.`).not.toBeNull();
      expect(nextBox, `Card ${index + 1} must have a measurable position.`).not.toBeNull();
      expect(currentBox.y, `Agenda card order must follow local start time at index ${index}.`)
        .toBeLessThanOrEqual(nextBox.y);
    }

    const navigationIndex = fixture.occurrenceIds.indexOf(
      fixture.navigationOccurrenceId,
    );
    await titleLocators[navigationIndex].click();
    await expect(page).toHaveURL(
      new RegExp(`/agenda/evento/${escapeRegExp(fixture.navigationEventSlug)}`),
      { timeout: appBootTimeoutMs },
    );
    expect(new URL(page.url()).searchParams.get('occurrence')).toBe(
      fixture.navigationOccurrenceId,
    );
  } finally {
    await api.dispose();
  }
});

// URL hydration and canonical public-detail routing stay browser-owned in readonly Playwright.
// These richer directions/reference-point interactions are already covered by Flutter
// widget/controller suites and are intentionally excluded from the broad v0.4.0
// browser mutation gate.
test.skip('@widget-owned NAV-APD-09 Como Chegar opens focused map and shared route chooser', async ({
  page,
}) => {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  let sessionToken = null;
  let createdProfileId = null;
  let createdAccountSlug = null;
  let createdProfileType = null;
  let primaryError = null;

  try {
    await page.context().grantPermissions(['geolocation'], { origin: baseUrl });
    await page
      .context()
      .setGeolocation({ latitude: -20.671339, longitude: -40.495395 });

    sessionToken = await loginTenantAdmin(api, baseUrl);
    await ensureLocalMapDefaultOrigin(api, baseUrl, sessionToken);
    const profileTypeSeed = await resolvePoiCapableProfileType(
      api,
      baseUrl,
      sessionToken,
      { preferDedicatedType: true },
    );
    createdProfileType = profileTypeSeed.createdType;
    const createdProfile = await createPoiAccountProfile(
      api,
      baseUrl,
      sessionToken,
      profileTypeSeed.profileType,
    );
    createdProfileId = createdProfile.profileId;
    createdAccountSlug = createdProfile.accountSlug;

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
      { readPayload: false },
    );
    const routeChooserCta = page.getByRole('button', { name: /^Outros$/i }).first();
    await clickLocatorCenter(
      page,
      routeChooserCta,
      'Account Profile detail must expose the shared directions chooser through the inline Outros action.',
    );
    await expect(page.getByText(/Google Maps|99|Waze|Uber/i).first())
      .toBeVisible({ timeout: appBootTimeoutMs });
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await runCleanupPreservingPrimaryError(primaryError, async () => {
      try {
        await cleanupCreatedPoiAccountProfile(api, baseUrl, sessionToken, {
          accountSlug: createdAccountSlug,
          profileId: createdProfileId,
        });
        await deleteAccountProfileType(
          api,
          baseUrl,
          sessionToken,
          createdProfileType,
        );
      } finally {
        await api.dispose();
      }
    });
  }
});

test.skip('@widget-owned NAV-APD-11 reference point action opens confirmation modal', async ({
  page,
}) => {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  let sessionToken = null;
  let createdAccountSlug = null;
  let createdProfileId = null;
  let createdProfileType = null;
  let primaryError = null;

  try {
    sessionToken = await loginTenantAdmin(api, baseUrl);
    await ensureLocalMapDefaultOrigin(api, baseUrl, sessionToken);
    const profileTypeSeed = await resolvePoiCapableProfileType(
      api,
      baseUrl,
      sessionToken,
      { preferDedicatedType: true },
    );
    createdProfileType = profileTypeSeed.createdType;
    const createdProfile = await createPoiAccountProfile(
      api,
      baseUrl,
      sessionToken,
      profileTypeSeed.profileType,
    );
    createdAccountSlug = createdProfile.accountSlug;
    createdProfileId = createdProfile.profileId;

    await gotoPublicProfileDetailAndWaitForHydration(
      page,
      baseUrl,
      createdProfile.profileSlug,
      { readPayload: false },
    );

    const referencePointButton = page.getByRole('button', {
      name: /Usar como ponto de referência/i,
    }).first();
    await clickLocatorCenter(
      page,
      referencePointButton,
      'Eligible Account Profile detail must expose the reference-point CTA.',
    );

    await expect(
      page.getByText(
        'Todas as distâncias serão calculadas a partir desse local:',
        { exact: true },
      ),
    ).toBeVisible({ timeout: appBootTimeoutMs });
    await expect(page.getByText(labelPattern(createdProfile.displayName)).first())
      .toBeVisible({ timeout: appBootTimeoutMs });
    await expect(
      page.getByRole('button', {
        name: /Usar como Ponto de Referência/i,
      }).first(),
    ).toBeVisible({ timeout: appBootTimeoutMs });
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await runCleanupPreservingPrimaryError(primaryError, async () => {
      try {
        await cleanupCreatedPoiAccountProfile(api, baseUrl, sessionToken, {
          accountSlug: createdAccountSlug,
          profileId: createdProfileId,
        });
        await deleteAccountProfileType(
          api,
          baseUrl,
          sessionToken,
          createdProfileType,
        );
      } finally {
        await api.dispose();
      }
    });
  }
});

test.skip('@widget-owned NAV-APD-13 map reference point action opens confirmation modal', async ({
  page,
}) => {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  let sessionToken = null;
  let createdAccountSlug = null;
  let createdProfileId = null;
  let createdProfileType = null;
  let primaryError = null;

  try {
    await page.context().grantPermissions(['geolocation'], { origin: baseUrl });
    await page
      .context()
      .setGeolocation({ latitude: -20.671339, longitude: -40.495395 });

    sessionToken = await loginTenantAdmin(api, baseUrl);
    await ensureLocalMapDefaultOrigin(api, baseUrl, sessionToken);
    const profileTypeSeed = await resolvePoiCapableProfileType(
      api,
      baseUrl,
      sessionToken,
      { preferDedicatedType: true },
    );
    createdProfileType = profileTypeSeed.createdType;
    const createdProfile = await createPoiAccountProfile(
      api,
      baseUrl,
      sessionToken,
      profileTypeSeed.profileType,
    );
    createdAccountSlug = createdProfile.accountSlug;
    createdProfileId = createdProfile.profileId;

    await gotoPublicProfileDetailAndWaitForHydration(
      page,
      baseUrl,
      createdProfile.profileSlug,
      { readPayload: false },
    );
    await expect(page.getByText(/Como Chegar/i).first()).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    await page.getByText(/Ver no mapa/i).first().click();
    await continueWithoutLocationIfPrompted(page);
    await expect(page).toHaveURL(/\/mapa.*poi=account_profile/i, {
      timeout: appBootTimeoutMs,
    });

    const referencePointButton = page.getByRole('button', {
      name: /Usar como ponto de referência/i,
    }).first();
    await clickLocatorCenter(
      page,
      referencePointButton,
      'Focused Account Profile map card must expose the reference-point CTA.',
    );
    await expect(
      page.getByText(
        'Todas as distâncias serão calculadas a partir desse local:',
        { exact: true },
      ),
    ).toBeVisible({ timeout: appBootTimeoutMs });
    await expect(page.getByText(labelPattern(createdProfile.displayName)).first())
      .toBeVisible({ timeout: appBootTimeoutMs });
    await expect(
      page.getByRole('button', {
        name: /Usar como Ponto de Referência/i,
      }).first(),
    ).toBeVisible({ timeout: appBootTimeoutMs });
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await runCleanupPreservingPrimaryError(primaryError, async () => {
      try {
        await cleanupCreatedPoiAccountProfile(api, baseUrl, sessionToken, {
          accountSlug: createdAccountSlug,
          profileId: createdProfileId,
        });
        await deleteAccountProfileType(
          api,
          baseUrl,
          sessionToken,
          createdProfileType,
        );
      } finally {
        await api.dispose();
      }
    });
  }
});

test.skip('@widget-owned NAV-APD-14 map route action reuses the shared route chooser after reference-point prompt', async ({
  page,
}) => {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  let sessionToken = null;
  let createdAccountSlug = null;
  let createdProfileId = null;
  let createdProfileType = null;
  let primaryError = null;

  try {
    await page.context().grantPermissions(['geolocation'], { origin: baseUrl });
    await page
      .context()
      .setGeolocation({ latitude: -20.671339, longitude: -40.495395 });

    sessionToken = await loginTenantAdmin(api, baseUrl);
    await ensureLocalMapDefaultOrigin(api, baseUrl, sessionToken);
    const profileTypeSeed = await resolvePoiCapableProfileType(
      api,
      baseUrl,
      sessionToken,
      { preferDedicatedType: true },
    );
    createdProfileType = profileTypeSeed.createdType;
    const createdProfile = await createPoiAccountProfile(
      api,
      baseUrl,
      sessionToken,
      profileTypeSeed.profileType,
    );
    createdAccountSlug = createdProfile.accountSlug;
    createdProfileId = createdProfile.profileId;

    await gotoPublicProfileDetailAndWaitForHydration(
      page,
      baseUrl,
      createdProfile.profileSlug,
      { readPayload: false },
    );
    await expect(page.getByText(/Como Chegar/i).first()).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    await page.getByText(/Ver no mapa/i).first().click();
    await continueWithoutLocationIfPrompted(page);
    await expect(page).toHaveURL(/\/mapa.*poi=account_profile/i, {
      timeout: appBootTimeoutMs,
    });

    const referencePointButton = page.getByRole('button', {
      name: /Usar como ponto de referência/i,
    }).first();
    await clickLocatorCenter(
      page,
      referencePointButton,
      'Focused Account Profile map card must expose the reference-point CTA before route selection.',
    );
    await page.getByRole('button', {
      name: /Usar como Ponto de Referência/i,
    }).first().click();
    await expect(
      page.getByRole('button', {
        name: /Ponto de referência/i,
      }).first(),
    ).toBeVisible({ timeout: appBootTimeoutMs });

    const routeButton = page.getByRole('button', {
      name: /^Traçar rota$/i,
    }).first();
    await clickLocatorCenter(
      page,
      routeButton,
      'Map card route CTA must open the canonical route-start prompt.',
    );

    await expect(
      page.getByText('Qual PONTO DE PARTIDA quer usar?', { exact: true }),
    ).toBeVisible({ timeout: appBootTimeoutMs });
    const referencePointOption = page.getByRole('radio', {
      name: new RegExp(
        `O ponto de referência selecionado\\s+${escapeRegExp(createdProfile.displayName)}`,
        'i',
      ),
    }).first();
    await expect(referencePointOption).toBeVisible({
      timeout: appBootTimeoutMs,
    });

    await referencePointOption.click();
    await page.getByRole('button', { name: /^Continuar$/i }).click();

    await expect(
      page.getByText(/Selecione seu aplicativo de preferência/i).first(),
    ).toBeVisible({ timeout: appBootTimeoutMs });
    await expect(page.getByText(/Google Maps|99|Waze|Uber/i).first())
      .toBeVisible({ timeout: appBootTimeoutMs });
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await runCleanupPreservingPrimaryError(primaryError, async () => {
      try {
        await cleanupCreatedPoiAccountProfile(api, baseUrl, sessionToken, {
          accountSlug: createdAccountSlug,
          profileId: createdProfileId,
        });
        await deleteAccountProfileType(
          api,
          baseUrl,
          sessionToken,
          createdProfileType,
        );
      } finally {
        await api.dispose();
      }
    });
  }
});
