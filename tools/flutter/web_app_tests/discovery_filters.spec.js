const crypto = require('crypto');
const zlib = require('zlib');
const { test, expect, request } = require('@playwright/test');
const {
  loginTenantAdmin: loginTenantAdminWithRequiredCredentials,
} = require('./support/tenant_admin_auth');
const {
  cleanupOnboardedAccounts,
  runCleanupPreservingPrimaryError,
} = require('./support/account_onboarding_cleanup');
const {
  installFailureCollectors,
  summarizeCriticalBrowserFailures,
} = require('./support/browser_failure_collectors');

const tenantUrl = process.env.NAV_TENANT_URL;
const appBootTimeoutMs = 90000;
const apiRequestTimeoutMs = 30000;
const agendaReadinessRequestTimeoutMs = 5000;
const localRuntimeSeedEnabled =
  (process.env.NAV_DEPLOY_LANE || '').toString().trim().toLowerCase() === 'local';
const navigationGeolocation = {
  latitude: -20.671339,
  longitude: -40.495395,
};
const navigationRunId =
  process.env.NAV_TEST_RUN_ID || crypto.randomUUID();
let anonymousIdentityToken = null;

test.describe.configure({ timeout: 300000 });

function requireTenantUrl() {
  expect(
    tenantUrl,
    'Missing NAV_TENANT_URL. Discovery filter web specs require a live tenant URL.',
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
  return new RegExp(escapeRegExp(label.trim()), 'i');
}

function accessibleTextPattern(text) {
  return new RegExp(`(^|\\s)${escapeRegExp(text.trim())}(\\s|$)`, 'i');
}

function surfaceButtonPattern(title, description) {
  return new RegExp(
    `${escapeRegExp(title)}[\\s\\S]*${escapeRegExp(description)}`,
    'i',
  );
}

function surfaceTitlePattern(title) {
  return new RegExp(`^${escapeRegExp(title)}\\b`, 'i');
}

function surfaceDetailPattern(title, description) {
  return new RegExp(
    `${escapeRegExp(title)}[\\s\\S]*${escapeRegExp(description)}`,
    'i',
  );
}

function normalizePayload(payload) {
  if (payload?.data && typeof payload.data === 'object') {
    return payload.data;
  }
  return payload;
}

function normalizeList(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeQuery(value) {
  if (!value || typeof value !== 'object') {
    return {};
  }
  return value;
}

function valuesFor(value) {
  if (value == null) {
    return [];
  }
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

function hasFiniteCoordinate(value) {
  if (value == null || value === '') {
    return false;
  }
  return Number.isFinite(Number(value));
}

function firstQueryExpectation(filter) {
  const query = normalizeQuery(filter.query);
  const entities = valuesFor(query.entities);
  const typesByEntity = normalizeQuery(query.types_by_entity);
  const flatTypes = valuesFor(query.types);
  const taxonomy = normalizeQuery(query.taxonomy);

  const typeEntity = Object.keys(typesByEntity)[0];
  if (typeEntity) {
    const values = valuesFor(typesByEntity[typeEntity]);
    if (values.length > 0) {
      return { name: 'type', value: values[0] };
    }
  }

  if (flatTypes.length > 0) {
    return { name: 'type', value: flatTypes[0] };
  }

  const taxonomyGroup = Object.keys(taxonomy)[0];
  if (taxonomyGroup) {
    const values = valuesFor(taxonomy[taxonomyGroup]);
    if (values.length > 0) {
      return { name: 'taxonomy', value: values[0] };
    }
  }

  if (entities.length > 0) {
    return { name: 'entity', value: entities[0] };
  }

  return { name: 'filter', value: filter.key };
}

function canonicalQueryParamKeys(expectedName) {
  switch (String(expectedName || '').toLowerCase()) {
    case 'entity':
      return ['entities', 'entities[]'];
    case 'type':
      return ['types', 'types[]'];
    case 'taxonomy':
      return ['taxonomy', 'taxonomy[]'];
    case 'category':
      return ['categories', 'categories[]'];
    case 'source':
      return ['source'];
    default:
      return [];
  }
}

function requestContainsFilterValue(rawUrl, expected) {
  const url = new URL(rawUrl);
  const params = url.searchParams;
  const expectedValue = expected.value.toLowerCase();
  const allEntries = [...params.entries()];
  const candidateKeys = canonicalQueryParamKeys(expected.name)
    .map((value) => value.toLowerCase());
  const scopedEntries = candidateKeys.length > 0
    ? allEntries.filter(([key]) => candidateKeys.includes(String(key).toLowerCase()))
    : [];
  const entriesToCheck = scopedEntries.length > 0 ? scopedEntries : allEntries;
  for (const [, value] of entriesToCheck) {
    const rawValue = String(value).toLowerCase();
    const tokens = rawValue
      .split(',')
      .map((token) => token.trim())
      .filter(Boolean);
    if (rawValue === expectedValue || tokens.includes(expectedValue)) {
      return true;
    }
  }
  return false;
}

function trackFilteredRequests(page, pathFragment, expected) {
  const urls = [];
  const listener = (request) => {
    if (!request.url().includes(pathFragment)) {
      return;
    }
    if (requestContainsFilterValue(request.url(), expected)) {
      urls.push(request.url());
    }
  };
  page.on('request', listener);

  return {
    urls,
    dispose: () => page.off('request', listener),
  };
}

async function waitForTrackedFilteredRequest(
  tracker,
  message,
  previousCount = 0,
  timeoutMs = appBootTimeoutMs,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (tracker.urls.length > previousCount) {
      return tracker.urls[tracker.urls.length - 1];
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${message}. Captured filtered requests: ${tracker.urls.join('\n')}`);
}

async function clickUntilFilteredRequest({
  locator,
  tracker,
  message,
  attempts = 3,
}) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const previousCount = tracker.urls.length;
    await activateSemanticToggle(locator.first());
    try {
      return await waitForTrackedFilteredRequest(
        tracker,
        message,
        previousCount,
        12000,
      );
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error(message);
}

async function expectVisibleRuntimeTitle(page, title) {
  await expect(
    page.getByText(new RegExp(escapeRegExp(title), 'i')).first(),
  ).toBeVisible({ timeout: appBootTimeoutMs });
}

async function expectAbsentRuntimeTitle(page, title) {
  await expect(
    page.getByText(new RegExp(escapeRegExp(title), 'i')),
  ).toHaveCount(0, { timeout: appBootTimeoutMs });
}

async function activateSemanticToggle(locator) {
  await expect(locator).toBeVisible({ timeout: appBootTimeoutMs });
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  try {
    await locator.dispatchEvent('click');
  } catch (_) {
    await locator.focus();
    await locator.press('Space');
  }
}

async function assertNoCriticalBrowserFailures(collectors) {
  const summary = summarizeCriticalBrowserFailures(collectors);
  expect(
    summary.runtimeErrors,
    `Unexpected runtime errors:\n${summary.runtimeErrors.join('\n')}`,
  ).toEqual([]);
  expect(
    summary.failedRequests,
    `Unexpected failed requests:\n${summary.failedRequests.join('\n')}`,
  ).toEqual([]);
  expect(
    summary.criticalHttpResponses,
    `Critical HTTP responses:\n${summary.criticalHttpResponses.join('\n')}`,
  ).toEqual([]);
  expect(
    summary.disallowedRateLimitedResponses,
    `Disallowed 429 responses:\n${summary.disallowedRateLimitedResponses.join('\n')}`,
  ).toEqual([]);
  expect(
    summary.criticalConsoleErrors,
    `Critical console errors:\n${summary.criticalConsoleErrors.join('\n')}`,
  ).toEqual([]);
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

async function grantNavigationGeolocation(page, baseUrl) {
  await page.context().grantPermissions(['geolocation'], { origin: baseUrl });
  await page.context().setGeolocation(navigationGeolocation);
}

async function continueWithoutLocationIfPrompted(page) {
  const permissionRoutePattern = /\/location\/permission/;
  const continueButton = page.getByRole('button', {
    name: /Continuar sem localizacao|Continuar sem localização/i,
  });
  const continueText = page.getByText(/Continuar sem localizacao|Continuar sem localização/i)
    .first();

  await enableAccessibilityIfNeeded(page);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (permissionRoutePattern.test(page.url()) || (await continueButton.count()) > 0) {
      break;
    }
    await page.waitForTimeout(250);
    await enableAccessibilityIfNeeded(page);
  }

  if (!permissionRoutePattern.test(page.url()) && (await continueButton.count()) === 0) {
    return;
  }

  await continueButton
    .first()
    .waitFor({
      state: 'visible',
      timeout: 45000,
    })
    .catch(() => null);

  if (permissionRoutePattern.test(page.url()) && (await continueButton.count()) === 0) {
    await enableAccessibilityIfNeeded(page);
    await continueButton
      .first()
      .waitFor({
        state: 'visible',
        timeout: 15000,
      })
      .catch(() => null);
  }

  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (!permissionRoutePattern.test(page.url())) {
      break;
    }
    if ((await continueButton.count()) > 0) {
      await continueButton.first().click();
    } else if (await continueText.isVisible().catch(() => false)) {
      await continueText.click();
    } else {
      break;
    }
    await page.waitForTimeout(400);
  }
  await expect(page).not.toHaveURL(permissionRoutePattern, {
    timeout: appBootTimeoutMs,
  });
  await assertAppBooted(page);
  await enableAccessibilityIfNeeded(page);
}

function anonymousFingerprintHash(baseUrl) {
  return crypto
    .createHash('sha256')
    .update(`discovery-filters:${baseUrl}:${navigationRunId}`)
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
        device_name: 'playwright-discovery-filters',
        fingerprint: {
          hash: anonymousFingerprintHash(baseUrl),
          user_agent: 'playwright-discovery-filters',
          locale: 'pt-BR',
        },
        metadata: {
          source: 'web_navigation_discovery_filters',
        },
      },
    },
  );
  expect(
    [200, 201],
    `Anonymous tenant identity bootstrap must succeed before public filter API proof. Status ${response.status()}`,
  ).toContain(response.status());

  const payload = await response.json();
  anonymousIdentityToken = (payload?.data?.token || '').toString().trim();
  expect(
    anonymousIdentityToken,
    'Anonymous tenant identity bootstrap must return data.token.',
  ).toBeTruthy();
  return anonymousIdentityToken;
}

async function tenantPublicAuthHeaders(page, description) {
  const token = await resolveAnonymousIdentityToken(page);
  expect(token, `${description} requires anonymous tenant bearer token.`)
    .toBeTruthy();
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

async function fetchJson(page, baseUrl, pathName, description) {
  const response = await page.request.get(buildUrl(baseUrl, pathName), {
    headers: await tenantPublicAuthHeaders(page, description),
    failOnStatusCode: false,
  });
  expect(response.status(), `${description} must be readable: ${pathName}`)
    .toBeLessThan(400);
  return normalizePayload(await response.json());
}

async function fetchDiscoveryCatalog(page, baseUrl, surface) {
  const catalog = await fetchJson(
    page,
    baseUrl,
    `/api/v1/discovery-filters/${encodeURIComponent(surface)}`,
    `Discovery catalog ${surface}`,
  );
  expect(
    Array.isArray(catalog?.filters),
    `Discovery catalog ${surface} must expose filters[]`,
  ).toBeTruthy();
  expect(
    catalog.filters.length,
    `Discovery catalog ${surface} must not be empty for runtime validation.`,
  ).toBeGreaterThan(0);
  return catalog;
}

async function waitForPublicAgendaEvents(page, baseUrl, eventIds) {
  const expectedEventIds = new Set(
    eventIds.map((eventId) => String(eventId || '').trim()).filter(Boolean),
  );
  const readinessDeadline = Date.now() + appBootTimeoutMs;

  expect(expectedEventIds.size, 'Public agenda readiness requires seeded event ids.')
    .toBeGreaterThan(0);

  await expect
    .poll(
      async () => {
        const foundEventIds = new Set();
        const headers = await tenantPublicAuthHeaders(
          page,
          'Public agenda readiness',
        );

        for (let pageNumber = 1; ; pageNumber += 1) {
          const remainingTimeoutMs = readinessDeadline - Date.now();
          if (remainingTimeoutMs <= 0) {
            return false;
          }

          const url = new URL(buildUrl(baseUrl, '/api/v1/agenda'));
          url.searchParams.set('page', pageNumber.toString());
          url.searchParams.set('page_size', '50');
          url.searchParams.set(
            'origin_lat',
            navigationGeolocation.latitude.toString(),
          );
          url.searchParams.set(
            'origin_lng',
            navigationGeolocation.longitude.toString(),
          );
          let response;
          try {
            response = await page.request.get(url.toString(), {
              headers,
              failOnStatusCode: false,
              timeout: Math.min(
                agendaReadinessRequestTimeoutMs,
                remainingTimeoutMs,
              ),
            });
          } catch {
            return false;
          }
          if (response.status() !== 200) {
            return false;
          }

          const payload = await response.json();
          const rows = normalizeList(payload?.items);
          for (const row of rows) {
            const eventId = String(row?.event_id || '').trim();
            if (eventId) {
              foundEventIds.add(eventId);
            }
          }
          if ([...expectedEventIds].every((id) => foundEventIds.has(id))) {
            return true;
          }
          if (payload?.has_more !== true) {
            return false;
          }
        }
      },
      {
        timeout: appBootTimeoutMs,
        message: `Seeded Home taxonomy events must be visible in the public agenda before Home UI assertions: ${[...expectedEventIds].join(', ')}`,
      },
    )
    .toBe(true);
}

async function waitForPublicAccountProfileListHit(
  page,
  baseUrl,
  { slug, displayName },
) {
  await expect
    .poll(
      async () => {
        const searchValue = encodeURIComponent(displayName || slug || '');
        const payload = await fetchJson(
          page,
          baseUrl,
          `/api/v1/account_profiles?search=${searchValue}`,
          `Public account profile search ${displayName || slug}`,
        );
        const rows = normalizeList(payload?.data ?? payload?.items ?? payload);
        return rows.some((row) => {
          const rowSlug = String(row?.slug || '').trim();
          const rowDisplayName = String(
            row?.display_name ?? row?.name ?? '',
          ).trim();
          return rowSlug === slug || rowDisplayName === displayName;
        });
      },
      {
        timeout: appBootTimeoutMs,
        message: `Public account profile ${displayName || slug} must hydrate before discovery runtime validation.`,
      },
    )
    .toBe(true);
}

async function waitForPublicEnvironmentProfileType(
  page,
  baseUrl,
  { type, label, isPubliclyDiscoverable = null },
) {
  const deadline = Date.now() + appBootTimeoutMs;
  let lastSeenTypes = [];

  while (Date.now() < deadline) {
    const payload = await fetchJson(
      page,
      baseUrl,
      '/api/v1/environment',
      'Public tenant environment',
    );
    const profileTypes = normalizeList(payload?.profile_types);
    lastSeenTypes = profileTypes.map((entry) => ({
      type: String(entry?.type ?? '').trim(),
      label: String(entry?.label ?? '').trim(),
      isPubliclyDiscoverable: Boolean(
        entry?.capabilities?.is_publicly_discoverable ?? true,
      ),
    }));

    const match = profileTypes.find(
      (entry) => String(entry?.type ?? '').trim() === type,
    );
    if (match) {
      const labelMatches =
        !label || String(match?.label ?? '').trim() === label;
      const capabilityMatches =
        isPubliclyDiscoverable == null
        || Boolean(match?.capabilities?.is_publicly_discoverable ?? true)
          === isPubliclyDiscoverable;
      if (labelMatches && capabilityMatches) {
        return match;
      }
    }

    await page.waitForTimeout(500);
  }

  throw new Error(
    `Public environment profile type ${type} did not hydrate in time. Last seen profile types: ${JSON.stringify(lastSeenTypes)}`,
  );
}

async function fetchMapFilters(page, baseUrl) {
  const payload = await fetchJson(
    page,
    baseUrl,
    '/api/v1/map/filters?ne_lat=-19&ne_lng=-39&sw_lat=-21&sw_lng=-41',
    'Map filter catalog',
  );
  expect(Array.isArray(payload?.categories), 'Map filters must expose categories[]')
    .toBeTruthy();
  expect(payload.categories.length, 'Map filters must not be empty')
    .toBeGreaterThan(0);
  return payload.categories;
}

function chooseFilter(filters, predicate = () => true) {
  const selected = normalizeList(filters).find(
    (filter) => filter?.label && filter?.key && predicate(filter),
  );
  expect(selected, 'Expected a runtime discovery filter matching predicate')
    .toBeTruthy();
  return selected;
}

function chooseMapCategory(categories) {
  const selected =
    normalizeList(categories).find(
      (category) => category?.query?.source === 'event',
    ) ??
    normalizeList(categories).find((category) => category?.label && category?.key);
  expect(selected, 'Expected a runtime map filter category').toBeTruthy();
  return selected;
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

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
}

async function loginTenantAdmin(api, baseUrl) {
  return loginTenantAdminWithRequiredCredentials({
    api,
    baseUrl,
    buildUrl,
    deviceName: 'playwright-discovery-filters',
  });
}

async function ensureRuntimeDiscoveryFilters(baseUrl) {
  if (!localRuntimeSeedEnabled) {
    return;
  }

  const api = await createApiContext(baseUrl);
  const session = await loginTenantAdmin(api, baseUrl);
  const valuesResponse = await api.get(buildUrl(baseUrl, '/admin/api/v1/settings/values'), {
    headers: authHeaders(session.token),
  });
  expect(valuesResponse.status(), 'Tenant-admin settings values must be readable')
    .toBe(200);
  const valuesPayload = await valuesResponse.json();
  const discoveryFilters =
    normalizePayload(valuesPayload)?.discovery_filters &&
    typeof normalizePayload(valuesPayload).discovery_filters === 'object'
      ? normalizePayload(valuesPayload).discovery_filters
      : {};
  const surfaces =
    discoveryFilters.surfaces && typeof discoveryFilters.surfaces === 'object'
      ? { ...discoveryFilters.surfaces }
      : {};
  const mapUi =
    normalizePayload(valuesPayload)?.map_ui &&
    typeof normalizePayload(valuesPayload).map_ui === 'object'
      ? normalizePayload(valuesPayload).map_ui
      : {};
  const defaultOrigin =
    mapUi.default_origin && typeof mapUi.default_origin === 'object'
      ? mapUi.default_origin
      : {};

  let needsPatch = false;
  let needsMapUiPatch = false;
  if (
    !hasFiniteCoordinate(defaultOrigin?.lat)
    || !hasFiniteCoordinate(defaultOrigin?.lng)
  ) {
    needsMapUiPatch = true;
  }
  if (normalizeList(surfaces['home.events']?.filters).length === 0) {
    surfaces['home.events'] = {
      ...(surfaces['home.events'] || {}),
      target: 'event_occurrence',
      primary_selection_mode: 'single',
      filters: [
        {
          key: 'sr_b_web_home_events',
          target: 'event_occurrence',
          label: 'Eventos SR-B',
          query: {
            entities: ['event'],
            types_by_entity: {
              event: ['musica-ao-vivo'],
            },
          },
        },
      ],
    };
    needsPatch = true;
  }

  if (normalizeList(surfaces['discovery.account_profiles']?.filters).length === 0) {
    surfaces['discovery.account_profiles'] = {
      ...(surfaces['discovery.account_profiles'] || {}),
      target: 'account_profile',
      primary_selection_mode: 'single',
      filters: [
        {
          key: 'sr_b_web_profile_discovery',
          target: 'account_profile',
          label: 'Perfis SR-B',
          query: {
            entities: ['account_profile'],
            types_by_entity: {
              account_profile: ['artist'],
            },
          },
        },
      ],
    };
    needsPatch = true;
  }

  if (normalizeList(surfaces['public_map.primary']?.filters).length === 0) {
    surfaces['public_map.primary'] = {
      ...(surfaces['public_map.primary'] || {}),
      target: 'map_poi',
      primary_selection_mode: 'single',
      filters: [
        {
          key: 'sr_b_web_public_map',
          target: 'map_poi',
          label: 'Mapa SR-B',
          query: {
            entities: ['event'],
            types_by_entity: {
              event: ['musica-ao-vivo'],
            },
          },
        },
      ],
    };
    needsPatch = true;
  }

  if (needsMapUiPatch) {
    const mapUiPatchResponse = await api.patch(
      buildUrl(baseUrl, '/admin/api/v1/settings/values/map_ui'),
      {
        headers: authHeaders(session.token),
        data: {
          'default_origin.lat': navigationGeolocation.latitude,
          'default_origin.lng': navigationGeolocation.longitude,
          'default_origin.label': 'Praia do Morro',
        },
      },
    );
    expect(
      mapUiPatchResponse.status(),
      'Tenant-admin map default origin runtime seed must persist through Settings Kernel.',
    ).toBe(200);
  }

  if (!needsPatch) {
    await api.dispose();
    return;
  }

  const patchResponse = await api.patch(
    buildUrl(baseUrl, '/admin/api/v1/settings/values/discovery_filters'),
    {
      headers: authHeaders(session.token),
      data: { surfaces },
    },
  );
  expect(
    patchResponse.status(),
    'Tenant-admin discovery filter runtime seed must persist through Settings Kernel.',
  ).toBe(200);
  await api.dispose();
}

async function seedFlutterSecureStorage(context, session) {
  await context.addInitScript(
    async ({ entries }) => {
      if (!['http:', 'https:'].includes(window.location.protocol)) {
        return;
      }

      const publicKey = 'FlutterSecureStorage';
      let storage;
      try {
        storage = window.localStorage;
      } catch (_) {
        return;
      }
      const algorithm = { name: 'AES-GCM', length: 256 };

      const bytesToBase64 = (bytes) => {
        let binary = '';
        const chunkSize = 0x8000;
        for (let index = 0; index < bytes.length; index += chunkSize) {
          binary += String.fromCharCode(
            ...bytes.subarray(index, index + chunkSize),
          );
        }
        return window.btoa(binary);
      };

      const base64ToBytes = (value) => {
        const binary = window.atob(value);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index);
        }
        return bytes;
      };

      const getEncryptionKey = async () => {
        const stored = storage.getItem(publicKey);
        if (stored) {
          return window.crypto.subtle.importKey(
            'raw',
            base64ToBytes(stored),
            algorithm,
            false,
            ['encrypt', 'decrypt'],
          );
        }

        const generated = await window.crypto.subtle.generateKey(
          algorithm,
          true,
          ['encrypt', 'decrypt'],
        );
        const exported = new Uint8Array(
          await window.crypto.subtle.exportKey('raw', generated),
        );
        storage.setItem(publicKey, bytesToBase64(exported));
        return generated;
      };

      const encryptionKey = await getEncryptionKey();
      const encoder = new TextEncoder();

      for (const [key, value] of Object.entries(entries)) {
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const encrypted = new Uint8Array(
          await window.crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            encryptionKey,
            encoder.encode(value),
          ),
        );
        storage.setItem(
          `${publicKey}.${key}`,
          `${bytesToBase64(iv)}.${bytesToBase64(encrypted)}`,
        );
      }
    },
    {
      entries: {
        landlord_token: session.token,
        landlord_user_id: session.userId,
        active_mode: 'landlord',
      },
    },
  );
}

function firstTaxonomyTerm(catalog, filter = null) {
  const allowedKeys = new Set();
  for (const key of normalizeList(filter?.taxonomy_keys)) {
    if (key) {
      allowedKeys.add(String(key).toLowerCase());
    }
  }
  for (const key of Object.keys(filter?.query?.taxonomy || {})) {
    if (key) {
      allowedKeys.add(String(key).toLowerCase());
    }
  }
  for (const entity of normalizeList(filter?.query?.entities)) {
    const entityKey = String(entity || '').toLowerCase();
    if (!entityKey) {
      continue;
    }
    const selectedTypes = new Set(
      normalizeList(filter?.query?.types_by_entity?.[entityKey])
        .map((value) => String(value || '').toLowerCase())
        .filter(Boolean),
    );
    for (const option of normalizeList(catalog?.type_options?.[entityKey])) {
      const value = String(option?.value || '').toLowerCase();
      if (selectedTypes.size > 0 && !selectedTypes.has(value)) {
        continue;
      }
      for (const key of normalizeList(option?.allowed_taxonomies)) {
        if (key) {
          allowedKeys.add(String(key).toLowerCase());
        }
      }
    }
  }
  const entries = Object.entries(catalog?.taxonomy_options || {});
  for (const [key, group] of entries) {
    if (allowedKeys.size > 0 && !allowedKeys.has(String(key).toLowerCase())) {
      continue;
    }
    const terms = normalizeList(group?.terms);
    const term = terms.find((candidate) => candidate?.value && candidate?.label);
    if (term) {
      return {
        groupKey: key,
        groupLabel: group?.label || key,
        term,
      };
    }
  }
  return null;
}

async function assertFilterPanelStaysVisibleOnScroll(
  page,
  panel,
  legacyButtonLabel = null,
) {
  await page.mouse.wheel(0, 900);
  await expect(panel).toBeVisible({ timeout: appBootTimeoutMs });
  if (legacyButtonLabel) {
    await expect(
      page.getByRole('button', { name: legacyButtonLabel }),
    ).toHaveCount(0, { timeout: appBootTimeoutMs });
  }
}

function filterPanel(page, label) {
  return page.getByLabel(label);
}

function filterOption(panel, label) {
  const pattern = labelPattern(label);
  return panel
    .getByRole('button', { name: pattern })
    .or(panel.getByRole('switch', { name: pattern }));
}

async function revealFilterOption(page, panel, label) {
  const locator = filterOption(panel, label);
  const deltas = [
    0,
    ...Array.from({ length: 16 }, () => 280),
    ...Array.from({ length: 8 }, () => -280),
  ];

  for (const deltaX of deltas) {
    if ((await locator.count()) > 0) {
      await locator.first().scrollIntoViewIfNeeded().catch(() => {});
      if (await locator.first().isVisible().catch(() => false)) {
        for (let settleAttempt = 0; settleAttempt < 6; settleAttempt += 1) {
          const adjustment = await requiredHorizontalViewportAdjustment(
            locator.first(),
            panel,
          );
          if (adjustment === 0) {
            return locator;
          }
          await dragPrimaryFilterRow(page, panel, adjustment);
        }
        return locator;
      }
    }

    if (deltaX == 0) {
      await page.waitForTimeout(200);
      continue;
    }

    await dragPrimaryFilterRow(page, panel, deltaX);
  }

  return locator;
}

async function dragPrimaryFilterRow(page, panel, deltaX) {
  const panelBounds = await panel.boundingBox().catch(() => null);
  if (!panelBounds) {
    return;
  }

  const travel = Math.max(
    120,
    Math.min(Math.abs(deltaX), Math.max(120, panelBounds.width - 48)),
  );
  const centerY = panelBounds.y + Math.min(28, panelBounds.height * 0.18);
  const leftEdge = panelBounds.x + 24;
  const rightEdge = panelBounds.x + panelBounds.width - 24;
  const dragLeft = deltaX > 0;
  const finalStartX = dragLeft ? rightEdge : leftEdge;
  const finalEndX = dragLeft
    ? Math.max(leftEdge, finalStartX - travel)
    : Math.min(rightEdge, finalStartX + travel);

  await page.mouse.move(finalStartX, centerY);
  await page.mouse.down();
  await page.mouse.move(finalEndX, centerY, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(220);
}

async function requiredHorizontalViewportAdjustment(locator, panel) {
  const [targetBounds, panelBounds] = await Promise.all([
    locator.boundingBox().catch(() => null),
    panel.boundingBox().catch(() => null),
  ]);
  if (!targetBounds || !panelBounds) {
    return 0;
  }

  const leftPadding = panelBounds.x + 16;
  const rightPadding = panelBounds.x + panelBounds.width - 16;
  const targetLeft = targetBounds.x;
  const targetRight = targetBounds.x + targetBounds.width;

  if (targetLeft < leftPadding) {
    return -Math.max(120, Math.ceil(leftPadding - targetLeft + 24));
  }
  if (targetRight > rightPadding) {
    return Math.max(120, Math.ceil(targetRight - rightPadding + 24));
  }
  return 0;
}

async function expectFilterChipShowsVisibleLabel(locator, minWidth = 96) {
  await expect(locator).toBeVisible({ timeout: appBootTimeoutMs });
  await expect
    .poll(
      async () => {
        const bounds = await locator.boundingBox().catch(() => null);
        return Math.round(bounds?.width || 0);
      },
      {
        timeout: appBootTimeoutMs,
        message: `Expected filter chip to keep its visible label width (>= ${minWidth}px).`,
      },
    )
    .toBeGreaterThanOrEqual(minWidth);
}

async function expectAccessibleButtonByName(page, namePattern) {
  await expect
    .poll(
      async () => {
        await enableAccessibilityIfNeeded(page);
        try {
          const buttonNames = await page.getByRole('button').evaluateAll(
            (nodes) =>
              nodes
                .map((node) => node.getAttribute('aria-label') || node.textContent || '')
                .map((value) => value.trim())
                .filter(Boolean),
          );
          return buttonNames.some((name) => namePattern.test(name));
        } catch (_) {
          return false;
        }
      },
      {
        timeout: appBootTimeoutMs,
        message: `Expected an accessible button matching ${namePattern} to become available.`,
      },
    )
    .toBe(true);

  await expect(page.getByRole('button', { name: namePattern }).first())
    .toBeVisible({ timeout: appBootTimeoutMs });
}

async function expectAccessibleGroupContains(locator, text) {
  await expect(locator).toHaveAccessibleName(
    accessibleTextPattern(text),
    { timeout: appBootTimeoutMs },
  );
}

async function expectAccessibleGroupNotContains(locator, text, timeoutMs = 5000) {
  await expect(locator).not.toHaveAccessibleName(
    accessibleTextPattern(text),
    { timeout: timeoutMs },
  );
}

async function createTaxonomy(
  api,
  baseUrl,
  token,
  {
    slug,
    name,
    appliesTo,
    terms,
    icon = 'category',
    color = '#AA5500',
  },
) {
  const createResponse = await api.post(
    buildUrl(baseUrl, '/admin/api/v1/taxonomies'),
    {
      headers: authHeaders(token),
      data: {
        slug,
        name,
        applies_to: appliesTo,
        icon,
        color,
      },
    },
  );
  expect(createResponse.status(), `Taxonomy ${slug} must be created.`).toBe(201);
  const createPayload = await createResponse.json();
  const taxonomyId = createPayload?.data?.id?.toString() || '';
  expect(taxonomyId, `Taxonomy ${slug} must return an id.`).toBeTruthy();

  for (const term of terms) {
    const termResponse = await api.post(
      buildUrl(baseUrl, `/admin/api/v1/taxonomies/${taxonomyId}/terms`),
      {
        headers: authHeaders(token),
        data: term,
      },
    );
    expect(
      termResponse.status(),
      `Taxonomy term ${term.slug} must be created for ${slug}.`,
    ).toBe(201);
  }

  return { taxonomyId, slug, name, terms };
}

async function deleteTaxonomy(api, baseUrl, token, taxonomyId) {
  if (!taxonomyId) {
    return;
  }

  await api.delete(
    buildUrl(baseUrl, `/admin/api/v1/taxonomies/${taxonomyId}`),
    {
      headers: authHeaders(token),
      failOnStatusCode: false,
      timeout: apiRequestTimeoutMs,
    },
  );
}

async function createEventType(
  api,
  baseUrl,
  token,
  {
    name,
    slug,
    allowedTaxonomies,
    icon,
    color,
    iconColor = '#FFFFFF',
  },
) {
  const response = await api.post(
    buildUrl(baseUrl, '/admin/api/v1/event_types'),
    {
      headers: authHeaders(token),
      data: {
        name,
        slug,
        allowed_taxonomies: allowedTaxonomies,
        visual: {
          mode: 'icon',
          icon,
          color,
          icon_color: iconColor,
        },
      },
    },
  );
  expect(response.status(), `Event type ${slug} must be created.`).toBe(201);
  return response.json();
}

async function deleteEventType(api, baseUrl, token, eventTypeId) {
  if (!eventTypeId) {
    return;
  }

  await api.delete(
    buildUrl(baseUrl, `/admin/api/v1/event_types/${eventTypeId}`),
    {
      headers: authHeaders(token),
      failOnStatusCode: false,
      timeout: apiRequestTimeoutMs,
    },
  );
}

async function createNearbyAccountProfile(
  api,
  baseUrl,
  token,
  profileType,
  name,
) {
  const response = await api.post(
    buildUrl(baseUrl, '/admin/api/v1/account_onboardings'),
    {
      headers: authHeaders(token),
      data: {
        name,
        ownership_state: 'unmanaged',
        profile_type: profileType,
        location: {
          lat: navigationGeolocation.latitude,
          lng: navigationGeolocation.longitude,
        },
      },
    },
  );
  expect(response.status(), `Account profile ${name} must be created.`).toBe(201);

  const payload = await response.json();
  const data = payload?.data || {};
  const account = data?.account || {};
  const profile = data?.account_profile || {};
  const id = profile?.id?.toString() || '';
  expect(id, `Account profile ${name} must return id.`).toBeTruthy();
  return {
    id,
    accountSlug: account?.slug?.toString() || '',
    displayName: profile?.display_name?.toString() || name,
    slug: profile?.slug?.toString() || '',
    profileType,
  };
}

async function updateAccountProfileTaxonomyTerms(
  api,
  baseUrl,
  token,
  profile,
  taxonomyTerms,
) {
  const response = await api.patch(
    buildUrl(baseUrl, `/admin/api/v1/account_profiles/${profile.id}`),
    {
      headers: authHeaders(token),
      data: {
        profile_type: profile.profileType,
        display_name: profile.displayName,
        taxonomy_terms: taxonomyTerms,
      },
    },
  );
  expect(
    response.status(),
    `Account profile ${profile.displayName} taxonomy update must succeed.`,
  ).toBeLessThan(400);
}

function futureWindow(daysFromNow) {
  const start = new Date();
  start.setDate(start.getDate() + daysFromNow);
  start.setHours(20, 0, 0, 0);

  const end = new Date(start);
  end.setHours(end.getHours() + 2);

  return {
    date_time_start: start.toISOString(),
    date_time_end: end.toISOString(),
  };
}

async function createDiagnosticEvent(
  api,
  baseUrl,
  token,
  {
    title,
    eventType,
    host,
    taxonomyTerms = [],
    daysFromNow = 1,
  },
) {
  const response = await api.post(
    buildUrl(baseUrl, '/admin/api/v1/events'),
    {
      headers: authHeaders(token),
      data: {
        title,
        content: `<p>${title} validates discovery filter runtime facets.</p>`,
        type: {
          id: eventType.id,
          name: eventType.name,
          slug: eventType.slug,
          description: eventType.description || 'Discovery filters diagnostic event type',
        },
        location: {
          mode: 'physical',
        },
        place_ref: {
          type: 'account_profile',
          id: host.id,
        },
        taxonomy_terms: taxonomyTerms,
        occurrences: [futureWindow(daysFromNow)],
        publication: {
          status: 'published',
          publish_at: new Date(Date.now() - 60 * 1000).toISOString(),
        },
      },
    },
  );
  const responseBody = await response.json().catch(async () => ({
    raw: await response.text().catch(() => ''),
  }));
  expect(
    response.status(),
    `Diagnostic event ${title} must be created. Response: ${JSON.stringify(responseBody)}`,
  ).toBe(201);
  return responseBody?.data || {};
}

async function deleteEvent(api, baseUrl, token, eventId) {
  if (!eventId) {
    return;
  }

  await api.delete(
    buildUrl(baseUrl, `/admin/api/v1/events/${eventId}`),
    {
      headers: authHeaders(token),
      failOnStatusCode: false,
      timeout: apiRequestTimeoutMs,
    },
  );
}

async function listTenantAdminEventTypes(api, baseUrl, token) {
  const response = await api.get(
    buildUrl(baseUrl, '/admin/api/v1/event_types'),
    {
      headers: authHeaders(token),
    },
  );
  expect(
    response.status(),
    'Tenant-admin event type registry must load for diagnostic cleanup.',
  ).toBe(200);
  const payload = await response.json();
  return normalizeList(payload?.data);
}

async function listTenantAdminTaxonomies(api, baseUrl, token) {
  const response = await api.get(
    buildUrl(baseUrl, '/admin/api/v1/taxonomies'),
    {
      headers: authHeaders(token),
    },
  );
  expect(
    response.status(),
    'Tenant-admin taxonomy registry must load for diagnostic cleanup.',
  ).toBe(200);
  const payload = await response.json();
  return normalizeList(payload?.data);
}

async function listTenantAdminEvents(api, baseUrl, token) {
  const rows = [];
  for (let page = 1; page <= 10; page += 1) {
    const url = new URL(buildUrl(baseUrl, '/admin/api/v1/events'));
    url.searchParams.set('page', page.toString());
    url.searchParams.set('page_size', '100');
    url.searchParams.set('temporal', 'now,future');
    const response = await api.get(url.toString(), {
      headers: authHeaders(token),
    });
    expect(
      response.status(),
      `Tenant-admin event page ${page} must load for diagnostic cleanup.`,
    ).toBe(200);
    const payload = await response.json();
    const pageRows = normalizeList(payload?.data);
    rows.push(...pageRows);
    if (pageRows.length === 0 || pageRows.length < 100) {
      break;
    }
  }
  return rows;
}

async function createAccountProfileType(
  api,
  baseUrl,
  token,
  {
    type,
    label,
    allowedTaxonomies,
    isFavoritable,
    isQueryable = true,
    isPubliclyNavigable = true,
    isPubliclyDiscoverable = true,
    icon,
    color,
    iconColor = '#FFFFFF',
  },
) {
  const response = await api.post(
    buildUrl(baseUrl, '/admin/api/v1/account_profile_types'),
    {
      headers: authHeaders(token),
      data: {
        type,
        label,
        labels: {
          singular: label,
          plural: `${label}s`,
        },
        allowed_taxonomies: allowedTaxonomies,
        capabilities: {
          is_queryable: isQueryable,
          is_publicly_navigable: isPubliclyNavigable,
          is_favoritable: isFavoritable,
          is_publicly_discoverable: isPubliclyDiscoverable,
          has_taxonomies: allowedTaxonomies.length > 0,
        },
        visual: {
          mode: 'icon',
          icon,
          color,
          icon_color: iconColor,
        },
      },
    },
  );
  expect(response.status(), `Account profile type ${type} must be created.`).toBe(
    201,
  );
  return response.json();
}

async function deleteAccountProfileType(api, baseUrl, token, type) {
  if (!type) {
    return;
  }

  await api.delete(
    buildUrl(baseUrl, `/admin/api/v1/account_profile_types/${encodeURIComponent(type)}`),
    {
      headers: authHeaders(token),
      failOnStatusCode: false,
      timeout: apiRequestTimeoutMs,
    },
  );
}

function decodePng(buffer) {
  const signature = '89504e470d0a1a0a';
  expect(buffer.subarray(0, 8).toString('hex')).toBe(signature);

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    offset += 4;
    const type = buffer.subarray(offset, offset + 4).toString('ascii');
    offset += 4;
    const data = buffer.subarray(offset, offset + length);
    offset += length;
    offset += 4;

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  expect(width, 'PNG width must be available.').toBeGreaterThan(0);
  expect(height, 'PNG height must be available.').toBeGreaterThan(0);
  expect(bitDepth, 'PNG screenshots must be 8-bit.').toBe(8);
  expect(
    [2, 6],
    `Unsupported PNG color type ${colorType} in locator screenshot.`,
  ).toContain(colorType);

  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const stride = width * bytesPerPixel;
  const inflated = zlib.inflateSync(Buffer.concat(idatChunks));
  const reconstructed = Buffer.alloc(height * stride);

  let sourceOffset = 0;
  for (let row = 0; row < height; row += 1) {
    const filterType = inflated[sourceOffset];
    sourceOffset += 1;
    const rowStart = row * stride;

    for (let column = 0; column < stride; column += 1) {
      const raw = inflated[sourceOffset + column];
      const left = column >= bytesPerPixel
        ? reconstructed[rowStart + column - bytesPerPixel]
        : 0;
      const up = row > 0 ? reconstructed[rowStart - stride + column] : 0;
      const upLeft =
        row > 0 && column >= bytesPerPixel
          ? reconstructed[rowStart - stride + column - bytesPerPixel]
          : 0;

      let value = raw;
      if (filterType === 1) {
        value = (raw + left) & 0xff;
      } else if (filterType === 2) {
        value = (raw + up) & 0xff;
      } else if (filterType === 3) {
        value = (raw + Math.floor((left + up) / 2)) & 0xff;
      } else if (filterType === 4) {
        const predictor = paethPredictor(left, up, upLeft);
        value = (raw + predictor) & 0xff;
      } else {
        expect(filterType, 'PNG filter type must be 0-4.').toBe(0);
      }

      reconstructed[rowStart + column] = value;
    }

    sourceOffset += stride;
  }

  const rgba = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const sourceIndex = index * bytesPerPixel;
    const targetIndex = index * 4;
    rgba[targetIndex] = reconstructed[sourceIndex];
    rgba[targetIndex + 1] = reconstructed[sourceIndex + 1];
    rgba[targetIndex + 2] = reconstructed[sourceIndex + 2];
    rgba[targetIndex + 3] = bytesPerPixel === 4 ? reconstructed[sourceIndex + 3] : 255;
  }

  return { width, height, rgba };
}

function paethPredictor(left, up, upLeft) {
  const base = left + up - upLeft;
  const leftDistance = Math.abs(base - left);
  const upDistance = Math.abs(base - up);
  const upLeftDistance = Math.abs(base - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) {
    return left;
  }
  if (upDistance <= upLeftDistance) {
    return up;
  }
  return upLeft;
}

function colorDistance(a, b) {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

function quantizeColor(pixel) {
  return {
    r: Math.round(pixel.r / 16) * 16,
    g: Math.round(pixel.g / 16) * 16,
    b: Math.round(pixel.b / 16) * 16,
  };
}

function dominantForegroundColor(png, bounds) {
  const background = readPixel(png, 1, 1);
  const counts = new Map();

  for (let y = bounds.yStart; y < bounds.yEnd; y += 1) {
    for (let x = bounds.xStart; x < bounds.xEnd; x += 1) {
      const pixel = readPixel(png, x, y);
      if (pixel.a < 200) {
        continue;
      }
      if (colorDistance(pixel, background) < 48) {
        continue;
      }
      const quantized = quantizeColor(pixel);
      const key = `${quantized.r},${quantized.g},${quantized.b}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  const winner = [...counts.entries()].sort((left, right) => right[1] - left[1])[0];
  expect(winner, 'Expected a visible non-background foreground color.').toBeTruthy();
  const [r, g, b] = winner[0].split(',').map(Number);
  return { r, g, b };
}

function readPixel(png, x, y) {
  const clampedX = Math.max(0, Math.min(png.width - 1, x));
  const clampedY = Math.max(0, Math.min(png.height - 1, y));
  const index = (clampedY * png.width + clampedX) * 4;
  return {
    r: png.rgba[index],
    g: png.rgba[index + 1],
    b: png.rgba[index + 2],
    a: png.rgba[index + 3],
  };
}

async function expectSelectedChipIconAndLabelForegroundParity(locator) {
  let image = null;
  let lastError = null;
  let lastStableBox = null;
  let stableBoxSamples = 0;
  const deadline = Date.now() + appBootTimeoutMs;

  while (Date.now() < deadline) {
    try {
      await expect(locator).toBeVisible({
        timeout: Math.min(appBootTimeoutMs, Math.max(deadline - Date.now(), 250)),
      });
      const box = await locator.boundingBox();
      if (box == null || box.width <= 0 || box.height <= 0) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        continue;
      }

      const normalizedBox = {
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height),
      };
      if (
        lastStableBox != null &&
        Math.abs(lastStableBox.x - normalizedBox.x) <= 1 &&
        Math.abs(lastStableBox.y - normalizedBox.y) <= 1 &&
        Math.abs(lastStableBox.width - normalizedBox.width) <= 1 &&
        Math.abs(lastStableBox.height - normalizedBox.height) <= 1
      ) {
        stableBoxSamples += 1;
      } else {
        stableBoxSamples = 1;
      }
      lastStableBox = normalizedBox;
      if (stableBoxSamples < 2) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        continue;
      }

      image = decodePng(await locator.screenshot({
        animations: 'disabled',
        timeout: Math.min(15000, Math.max(deadline - Date.now(), 250)),
      }));
      break;
    } catch (error) {
      lastError = error;
      if (Date.now() >= deadline) {
        throw lastError;
      }
      stableBoxSamples = 0;
      lastStableBox = null;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  expect(image, `Expected a stable selected chip screenshot. Last error=${lastError}`).toBeTruthy();
  const iconColor = dominantForegroundColor(image, {
    xStart: Math.floor(image.width * 0.04),
    xEnd: Math.max(1, Math.floor(image.width * 0.24)),
    yStart: Math.floor(image.height * 0.18),
    yEnd: Math.max(1, Math.floor(image.height * 0.82)),
  });
  const labelColor = dominantForegroundColor(image, {
    xStart: Math.floor(image.width * 0.24),
    xEnd: Math.max(1, Math.floor(image.width * 0.74)),
    yStart: Math.floor(image.height * 0.18),
    yEnd: Math.max(1, Math.floor(image.height * 0.82)),
  });

  expect(
    colorDistance(iconColor, labelColor),
    `Selected chip icon and label foreground must match. Icon=${JSON.stringify(
      iconColor,
    )} Label=${JSON.stringify(labelColor)}`,
  ).toBeLessThanOrEqual(32);
}

test('@mutation tenant-admin keeps public Map filter config in the canonical filters editor', async ({
  browser,
}) => {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  let context;

  try {
    const session = await loginTenantAdmin(api, baseUrl);
    context = await browser.newContext({ ignoreHTTPSErrors: true });
    await seedFlutterSecureStorage(context, session);
    const page = await context.newPage();
    const collectors = installFailureCollectors(page);

    await openTenantPath(page, baseUrl, '/admin');
    await expect(
      page.getByRole('button', {
        name: /Configure filtros de Mapa, Home e Descoberta/i,
      }),
    ).toHaveCount(0, { timeout: appBootTimeoutMs });

    await openTenantPath(page, baseUrl, '/admin/settings');
    const settingsFiltersEntry = page.getByRole('button', {
      name: /^Filtros[\s\S]*Mapa público e superfícies configuráveis/i,
    });
    await expect(settingsFiltersEntry)
      .toBeVisible({ timeout: appBootTimeoutMs });
    await settingsFiltersEntry.click();
    await expect(page).toHaveURL(/\/admin\/filters(?:\?|$)/, {
      timeout: appBootTimeoutMs,
    });
    await expect(page.getByRole('button', { name: /^Mapa/i }))
      .toBeVisible({ timeout: appBootTimeoutMs });
    await expect(page.getByRole('button', { name: /Eventos na Tela Principal/i }))
      .toHaveCount(0, { timeout: appBootTimeoutMs });
    await expect(page.getByRole('button', { name: /Descoberta de Perfis/i }))
      .toHaveCount(0, { timeout: appBootTimeoutMs });

    await openTenantPath(
      page,
      baseUrl,
      '/admin/filters/surface?surface=public_map.primary',
    );
    const mapEditor = page.getByRole('group', {
      name: /Mapa[\s\S]*Filtros primários exibidos sobre o mapa público/i,
    }).first();
    await expect(mapEditor).toBeVisible({ timeout: appBootTimeoutMs });
    await expectAccessibleGroupContains(
      mapEditor,
      'Filtros primários exibidos sobre o mapa público.',
    );
    await expectAccessibleGroupContains(mapEditor, 'Filtros configurados');
    await expect(mapEditor.getByRole('button', { name: /^Adicionar$/i }))
      .toBeVisible({ timeout: appBootTimeoutMs });
    await expect(page.getByText('Filtros públicos', { exact: true }))
      .toHaveCount(0, { timeout: appBootTimeoutMs });
    await expect(page.getByText('Eventos na Tela Principal', { exact: true }))
      .toHaveCount(0, { timeout: appBootTimeoutMs });
    await expect(page.getByText('Descoberta de Perfis', { exact: true }))
      .toHaveCount(0, { timeout: appBootTimeoutMs });

    await assertNoCriticalBrowserFailures(collectors);
  } finally {
    await context?.close().catch(() => {});
    await api.dispose();
  }
});

test('@mutation public Map keeps baseline primary filters without taxonomy subfilters and uses backend filtering', async ({
  page,
}) => {
  const baseUrl = requireTenantUrl();
  await ensureRuntimeDiscoveryFilters(baseUrl);
  const collectors = installFailureCollectors(page);
  const categories = await fetchMapFilters(page, baseUrl);
  expect(
    categories.map((category) => String(category.key || '').toLowerCase()),
    'Map API must not expose unconfigured brasilidades from Home/Discovery taxonomy facets.',
  ).not.toContain('brasilidades');
  const selectedCategory = chooseMapCategory(categories);
  const siblingCategory = normalizeList(categories).find(
    (category) => category.key !== selectedCategory.key && category.label,
  );
  const expected = selectedCategory.query?.source
    ? { name: 'source', value: selectedCategory.query.source }
    : { name: 'category', value: selectedCategory.key };

  await openTenantPath(page, baseUrl, '/mapa');
  await continueWithoutLocationIfPrompted(page);
  await expectAccessibleButtonByName(page, labelPattern(selectedCategory.label));

  const filteredRequest = page.waitForRequest((request) => {
    if (!request.url().includes('/api/v1/map/pois')) {
      return false;
    }
    return requestContainsFilterValue(request.url(), expected);
  }, { timeout: appBootTimeoutMs });
  await page.getByRole('button', { name: labelPattern(selectedCategory.label) })
    .first()
    .click();
  const requestSample = await filteredRequest;

  await expect(page.getByText(selectedCategory.label, { exact: true }))
    .toBeVisible({ timeout: appBootTimeoutMs });
  await expect(page.getByRole('button', { name: /Remover filtro/i }))
    .toBeVisible({ timeout: appBootTimeoutMs });
  if (siblingCategory) {
    await expectAccessibleButtonByName(page, labelPattern(siblingCategory.label));
  }

  const homeCatalog = await fetchDiscoveryCatalog(page, baseUrl, 'home.events')
    .catch(() => null);
  const taxonomy = firstTaxonomyTerm(homeCatalog);
  if (taxonomy) {
    await expect(page.getByRole('button', {
      name: labelPattern(taxonomy.term.label),
    })).toHaveCount(0, { timeout: appBootTimeoutMs });
  }
  expect(
    requestContainsFilterValue(requestSample.url(), expected),
    `Map filter request must carry backend query value ${expected.name}=${expected.value}: ${requestSample.url()}`,
  ).toBeTruthy();

  await assertNoCriticalBrowserFailures(collectors);
});

test('@mutation public Map navigates configured canonical filters with and without marker override visuals', async ({
  page,
}) => {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  const collectors = installFailureCollectors(page);
  let originalDiscoveryFilters = null;
  const unique = Date.now();
  const overrideKey = `pw_override_${unique}`;
  const buttonOnlyKey = `pw_button_${unique}`;
  const overrideType = `pw-override-type-${unique}`;
  const buttonOnlyType = `pw-button-type-${unique}`;
  const overrideLabel = `PW Override ${unique}`;
  const buttonOnlyLabel = `PW Botao ${unique}`;
  let session = null;
  let primaryError = null;

  try {
    session = await loginTenantAdmin(api, baseUrl);
    const valuesResponse = await api.get(buildUrl(baseUrl, '/admin/api/v1/settings/values'), {
      headers: authHeaders(session.token),
    });
    expect(valuesResponse.status(), 'Tenant-admin settings values must be readable')
      .toBe(200);
    const valuesPayload = normalizePayload(await valuesResponse.json());
    originalDiscoveryFilters =
      valuesPayload?.discovery_filters && typeof valuesPayload.discovery_filters === 'object'
        ? valuesPayload.discovery_filters
        : {};
    const originalSurfaces =
      originalDiscoveryFilters.surfaces && typeof originalDiscoveryFilters.surfaces === 'object'
        ? originalDiscoveryFilters.surfaces
        : {};
    const nextDiscoveryFilters = {
      ...originalDiscoveryFilters,
      surfaces: {
        ...originalSurfaces,
        'public_map.primary': {
          ...(originalSurfaces['public_map.primary'] || {}),
          target: 'map_poi',
          primary_selection_mode: 'single',
          filters: [
            {
              key: overrideKey,
              target: 'map_poi',
              label: overrideLabel,
              override_marker: true,
              marker_override: {
                mode: 'icon',
                icon: 'music_note',
                color: '#0055AA',
                icon_color: '#F3F7FF',
              },
              query: {
                entities: ['event'],
                types_by_entity: {
                  event: [overrideType],
                },
              },
            },
            {
              key: buttonOnlyKey,
              target: 'map_poi',
              label: buttonOnlyLabel,
              override_marker: false,
              marker_override: {
                mode: 'icon',
                icon: 'storefront',
                color: '#0F766E',
                icon_color: '#FFFFFF',
              },
              query: {
                entities: ['account_profile'],
                types_by_entity: {
                  account_profile: [buttonOnlyType],
                },
              },
            },
          ],
        },
      },
    };

    const patchResponse = await api.patch(
      buildUrl(baseUrl, '/admin/api/v1/settings/values/discovery_filters'),
      {
        headers: authHeaders(session.token),
        data: nextDiscoveryFilters,
      },
    );
    expect(patchResponse.status(), 'Canonical map filter fixtures must persist.')
      .toBe(200);

    const categories = await fetchMapFilters(page, baseUrl);
    const overrideCategory = categories.find((category) => category.key === overrideKey);
    const buttonOnlyCategory = categories.find((category) => category.key === buttonOnlyKey);
    expect(overrideCategory, `Map API must expose ${overrideKey}.`).toBeTruthy();
    expect(buttonOnlyCategory, `Map API must expose ${buttonOnlyKey}.`).toBeTruthy();
    expect(overrideCategory.label).toBe(overrideLabel);
    expect(overrideCategory.override_marker).toBe(true);
    expect(overrideCategory.marker_override?.color).toBe('#0055AA');
    expect(buttonOnlyCategory.label).toBe(buttonOnlyLabel);
    expect(buttonOnlyCategory.override_marker).toBe(false);
    expect(buttonOnlyCategory.marker_override?.color).toBe('#0F766E');

    await openTenantPath(page, baseUrl, '/mapa');
    await continueWithoutLocationIfPrompted(page);
    await expectAccessibleButtonByName(page, labelPattern(overrideLabel));
    await expectAccessibleButtonByName(page, labelPattern(buttonOnlyLabel));
    const overrideButton = page.getByRole('button', { name: labelPattern(overrideLabel) }).first();
    const removeFilterButton = page.getByRole('button', { name: /Remover filtro/i }).first();
    if (!(await removeFilterButton.isVisible().catch(() => false))) {
      await overrideButton.click();
      await expect(removeFilterButton).toBeVisible({ timeout: appBootTimeoutMs });
    }
    await expect(page.getByText(overrideLabel, { exact: true }))
      .toBeVisible({ timeout: appBootTimeoutMs });
    await expectSelectedChipIconAndLabelForegroundParity(overrideButton);
    await removeFilterButton.click();

    const buttonOnlyButton = page.getByRole('button', { name: labelPattern(buttonOnlyLabel) }).first();
    await buttonOnlyButton.click();
    await expect(removeFilterButton).toBeVisible({ timeout: appBootTimeoutMs });
    await expect(page.getByText(buttonOnlyLabel, { exact: true }))
      .toBeVisible({ timeout: appBootTimeoutMs });
    await expectSelectedChipIconAndLabelForegroundParity(buttonOnlyButton);

    await assertNoCriticalBrowserFailures(collectors);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await runCleanupPreservingPrimaryError(primaryError, async () => {
      try {
        if (originalDiscoveryFilters !== null) {
          const restoreResponse = await api.patch(
            buildUrl(baseUrl, '/admin/api/v1/settings/values/discovery_filters'),
            {
              headers: authHeaders(session?.token ?? ''),
              data: originalDiscoveryFilters,
            },
          );
          expect(
            restoreResponse.status(),
            'Canonical map filter fixtures must restore the original discovery filter settings during cleanup.',
          ).toBe(200);
        }
      } finally {
        await api.dispose();
      }
    });
  }
});

test('@mutation Home filters honor Event Type taxonomy compatibility, hide zero-taxonomy rows, and keep selected icon foreground aligned with the label', async ({
  page,
}) => {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  const collectors = installFailureCollectors(page);
  let session = null;
  let physicalHost = null;
  let typeAId = null;
  let typeBId = null;
  let typeCId = null;
  let typeDId = null;
  let taxonomyAId = null;
  let taxonomyBId = null;
  const createdEventIds = [];
  let primaryError = null;

  try {
    session = await loginTenantAdmin(api, baseUrl);
    const unique = Date.now();
    const typeALabel = `AAA HD10 Show ${unique}`;
    const typeBLabel = `AAB HD10 Talk ${unique}`;
    const typeCLabel = `AAC HD10 Empty ${unique}`;
    const typeDLabel = `AAD HD10 No Results ${unique}`;
    const taxonomyA = await createTaxonomy(api, baseUrl, session.token, {
      slug: `hd10-music-${unique}`,
      name: `Genero Musical ${unique}`,
      appliesTo: ['event'],
      terms: [
        { slug: `rock-${unique}`, name: `Rock ${unique}` },
        { slug: `blues-${unique}`, name: `Blues ${unique}` },
      ],
    });
    taxonomyAId = taxonomyA.taxonomyId;
    const taxonomyB = await createTaxonomy(api, baseUrl, session.token, {
      slug: `hd10-cuisine-${unique}`,
      name: `Cozinha ${unique}`,
      appliesTo: ['event'],
      terms: [
        { slug: `chef-${unique}`, name: `Chef ${unique}` },
      ],
    });
    taxonomyBId = taxonomyB.taxonomyId;

    const typeA = await createEventType(api, baseUrl, session.token, {
      name: typeALabel,
      slug: `hd10-show-${unique}`,
      allowedTaxonomies: [taxonomyA.slug],
      icon: 'music_note',
      color: '#D71920',
    });
    typeAId = typeA?.data?.id?.toString() || null;
    const typeB = await createEventType(api, baseUrl, session.token, {
      name: typeBLabel,
      slug: `hd10-talk-${unique}`,
      allowedTaxonomies: [taxonomyB.slug],
      icon: 'record_voice_over',
      color: '#225588',
    });
    typeBId = typeB?.data?.id?.toString() || null;
    const typeC = await createEventType(api, baseUrl, session.token, {
      name: typeCLabel,
      slug: `hd10-empty-${unique}`,
      allowedTaxonomies: [],
      icon: 'forum',
      color: '#555555',
    });
    typeCId = typeC?.data?.id?.toString() || null;
    const typeD = await createEventType(api, baseUrl, session.token, {
      name: typeDLabel,
      slug: `hd10-no-results-${unique}`,
      allowedTaxonomies: [taxonomyA.slug],
      icon: 'hide_source',
      color: '#4A4A4A',
    });
    typeDId = typeD?.data?.id?.toString() || null;

    const catalog = await fetchDiscoveryCatalog(page, baseUrl, 'home.events');
    const filterKeys = normalizeList(catalog.filters).map((filter) => filter.key);
    expect(filterKeys).toEqual(expect.arrayContaining([
      `hd10-show-${unique}`,
      `hd10-talk-${unique}`,
      `hd10-empty-${unique}`,
      `hd10-no-results-${unique}`,
    ]));

    physicalHost = await createNearbyAccountProfile(
      api,
      baseUrl,
      session.token,
      'venue',
      `HD10 Venue ${unique}`,
    );

    const eventA = await createDiagnosticEvent(api, baseUrl, session.token, {
      title: `HD10 Event A ${unique}`,
      eventType: typeA.data,
      host: physicalHost,
      taxonomyTerms: [
        {
          type: taxonomyA.slug,
          value: `rock-${unique}`,
        },
      ],
      daysFromNow: 1,
    });
    createdEventIds.push(eventA.event_id?.toString() || '');

    const eventB = await createDiagnosticEvent(api, baseUrl, session.token, {
      title: `HD10 Event B ${unique}`,
      eventType: typeB.data,
      host: physicalHost,
      taxonomyTerms: [
        {
          type: taxonomyB.slug,
          value: `chef-${unique}`,
        },
      ],
      daysFromNow: 2,
    });
    createdEventIds.push(eventB.event_id?.toString() || '');

    const eventC = await createDiagnosticEvent(api, baseUrl, session.token, {
      title: `HD10 Event C ${unique}`,
      eventType: typeC.data,
      host: physicalHost,
      daysFromNow: 3,
    });
    createdEventIds.push(eventC.event_id?.toString() || '');

    await waitForPublicAgendaEvents(page, baseUrl, createdEventIds);

    await grantNavigationGeolocation(page, baseUrl);
    await openTenantPath(page, baseUrl, '/');
    const panel = filterPanel(page, /Painel de filtros de eventos/i);
    await expect(panel).toBeVisible({ timeout: appBootTimeoutMs });
    await expect(
      page.getByRole('button', { name: /Filtrar eventos/i }),
      'Home must expose the always-visible event filter panel without the legacy toggle button.',
    ).toHaveCount(0, { timeout: appBootTimeoutMs });
    await assertFilterPanelStaysVisibleOnScroll(
      page,
      panel,
      /Filtrar eventos/i,
    );
    const typeAOption = await revealFilterOption(page, panel, typeALabel);
    await expectFilterChipShowsVisibleLabel(typeAOption);
    const typeBOption = await revealFilterOption(page, panel, typeBLabel);
    await expectFilterChipShowsVisibleLabel(typeBOption);
    const typeCOption = await revealFilterOption(page, panel, typeCLabel);
    await expectFilterChipShowsVisibleLabel(typeCOption);
    await expect(
      filterOption(panel, typeDLabel),
      'Home runtime facets must hide event types with zero eligible events in the current universe.',
    ).toHaveCount(0, { timeout: appBootTimeoutMs });
    await expectAccessibleGroupNotContains(panel, taxonomyA.name);
    await expectAccessibleGroupNotContains(panel, taxonomyB.name);
    await expect(filterOption(panel, `Rock ${unique}`))
      .toHaveCount(0, { timeout: 5000 });
    await expect(filterOption(panel, `Blues ${unique}`))
      .toHaveCount(0, { timeout: 5000 });
    await expect(filterOption(panel, `Chef ${unique}`))
      .toHaveCount(0, { timeout: 5000 });

    const homeShowTracker = trackFilteredRequests(page, '/api/v1/agenda', {
      name: 'type',
      value: `hd10-show-${unique}`,
    });
    const typeASelectionOption = await revealFilterOption(page, panel, typeALabel);
    await clickUntilFilteredRequest({
      locator: typeASelectionOption,
      tracker: homeShowTracker,
      message: 'Home primary filter click must trigger agenda request for selected Event Type',
    });
    homeShowTracker.dispose();
    await expectSelectedChipIconAndLabelForegroundParity(
      typeASelectionOption.first(),
    );
    await expect(panel).toBeVisible({ timeout: appBootTimeoutMs });
    await expectAccessibleGroupContains(panel, taxonomyA.name);
    await expect(filterOption(panel, `Rock ${unique}`))
      .toBeVisible({ timeout: appBootTimeoutMs });
    await expect(
      filterOption(panel, `Blues ${unique}`),
      'Home runtime taxonomy facets must hide terms with zero eligible events under the selected type universe.',
    ).toHaveCount(0, { timeout: appBootTimeoutMs });
    await expectAccessibleGroupNotContains(panel, taxonomyB.name, appBootTimeoutMs);
    await expectVisibleRuntimeTitle(page, eventA.title);
    await expectAbsentRuntimeTitle(page, eventB.title);
    await expectAbsentRuntimeTitle(page, eventC.title);

    const homeTalkTracker = trackFilteredRequests(page, '/api/v1/agenda', {
      name: 'type',
      value: `hd10-talk-${unique}`,
    });
    const typeBSelectionOption = await revealFilterOption(page, panel, typeBLabel);
    await clickUntilFilteredRequest({
      locator: typeBSelectionOption,
      tracker: homeTalkTracker,
      message: 'Home primary filter switch must trigger agenda request for the next Event Type',
    });
    homeTalkTracker.dispose();
    await expectSelectedChipIconAndLabelForegroundParity(
      typeBSelectionOption.first(),
    );
    await expect(panel).toBeVisible({ timeout: appBootTimeoutMs });
    await expectAccessibleGroupContains(panel, taxonomyB.name);
    await expect(filterOption(panel, `Chef ${unique}`))
      .toBeVisible({ timeout: appBootTimeoutMs });
    await expectAccessibleGroupNotContains(panel, taxonomyA.name, appBootTimeoutMs);
    await expectVisibleRuntimeTitle(page, eventB.title);
    await expectAbsentRuntimeTitle(page, eventA.title);
    await expectAbsentRuntimeTitle(page, eventC.title);

    const homeEmptyTracker = trackFilteredRequests(page, '/api/v1/agenda', {
      name: 'type',
      value: `hd10-empty-${unique}`,
    });
    const typeCSelectionOption = await revealFilterOption(page, panel, typeCLabel);
    await clickUntilFilteredRequest({
      locator: typeCSelectionOption,
      tracker: homeEmptyTracker,
      message: 'Home zero-taxonomy primary click must still trigger agenda request',
    });
    homeEmptyTracker.dispose();
    await expectSelectedChipIconAndLabelForegroundParity(
      typeCSelectionOption.first(),
    );
    await expect(panel).toBeVisible({ timeout: appBootTimeoutMs });
    await expectAccessibleGroupNotContains(panel, taxonomyA.name, appBootTimeoutMs);
    await expectAccessibleGroupNotContains(panel, taxonomyB.name, appBootTimeoutMs);
    await expect(filterOption(panel, `Rock ${unique}`))
      .toHaveCount(0, { timeout: appBootTimeoutMs });
    await expect(filterOption(panel, `Blues ${unique}`))
      .toHaveCount(0, { timeout: appBootTimeoutMs });
    await expect(filterOption(panel, `Chef ${unique}`))
      .toHaveCount(0, { timeout: appBootTimeoutMs });
    await expectVisibleRuntimeTitle(page, eventC.title);
    await expectAbsentRuntimeTitle(page, eventA.title);
    await expectAbsentRuntimeTitle(page, eventB.title);

    await assertNoCriticalBrowserFailures(collectors);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await runCleanupPreservingPrimaryError(primaryError, async () => {
      try {
        for (const eventId of createdEventIds.reverse()) {
          await deleteEvent(api, baseUrl, session?.token, eventId);
        }
        await cleanupOnboardedAccounts(
          api,
          baseUrl,
          session?.token,
          [physicalHost?.accountSlug].filter(Boolean),
        );
        await deleteEventType(api, baseUrl, session?.token, typeCId);
        await deleteEventType(api, baseUrl, session?.token, typeBId);
        await deleteEventType(api, baseUrl, session?.token, typeAId);
        await deleteEventType(api, baseUrl, session?.token, typeDId);
        await deleteTaxonomy(api, baseUrl, session?.token, taxonomyBId);
        await deleteTaxonomy(api, baseUrl, session?.token, taxonomyAId);
      } finally {
        await api.dispose();
      }
    });
  }
});

test('@mutation Profile Discovery hides non-publicly-discoverable types and keeps selected icon foreground aligned with the label', async ({
  page,
}) => {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  const collectors = installFailureCollectors(page);
  let session = null;
  let visibleType = null;
  let visibleEmptyType = null;
  let hiddenType = null;
  let taxonomyId = null;
  let visibleProfile = null;
  let hiddenProfile = null;
  let primaryError = null;

  try {
    session = await loginTenantAdmin(api, baseUrl);
    const unique = Date.now();
    const visibleTypeLabel = `AAA HD12 Visivel ${unique}`;
    const visibleEmptyTypeLabel = `AAB HD12 Sem Perfis ${unique}`;
    const hiddenTypeLabel = `ZZZ HD12 Oculto ${unique}`;
    const taxonomy = await createTaxonomy(api, baseUrl, session.token, {
      slug: `hd12-cuisine-${unique}`,
      name: `Cozinha ${unique}`,
      appliesTo: ['account_profile'],
      terms: [
        { slug: `japanese-${unique}`, name: `Japonesa ${unique}` },
        { slug: `thai-${unique}`, name: `Tailandesa ${unique}` },
      ],
    });
    taxonomyId = taxonomy.taxonomyId;

    visibleType = await createAccountProfileType(api, baseUrl, session.token, {
      type: `hd12-visible-${unique}`,
      label: visibleTypeLabel,
      allowedTaxonomies: [taxonomy.slug],
      isFavoritable: false,
      icon: 'restaurant',
      color: '#A94A00',
    });
    visibleEmptyType = await createAccountProfileType(
      api,
      baseUrl,
      session.token,
      {
        type: `hd12-empty-${unique}`,
        label: visibleEmptyTypeLabel,
        allowedTaxonomies: [taxonomy.slug],
        isFavoritable: false,
        icon: 'storefront',
        color: '#6A4C93',
      },
    );
    hiddenType = await createAccountProfileType(api, baseUrl, session.token, {
      type: `hd12-hidden-${unique}`,
      label: hiddenTypeLabel,
      allowedTaxonomies: [taxonomy.slug],
      isFavoritable: true,
      isPubliclyDiscoverable: false,
      icon: 'lock',
      color: '#555555',
    });

    const catalog = await fetchDiscoveryCatalog(
      page,
      baseUrl,
      'discovery.account_profiles',
    );
    const filters = normalizeList(catalog.filters);
    expect(filters.map((filter) => filter.key)).toContain(`hd12-visible-${unique}`);
    expect(filters.map((filter) => filter.key)).toContain(`hd12-empty-${unique}`);
    expect(filters.map((filter) => filter.key)).not.toContain(`hd12-hidden-${unique}`);
    const typeOptions = normalizeList(catalog?.type_options?.account_profile);
    expect(typeOptions.map((option) => option.value)).toContain(`hd12-visible-${unique}`);
    expect(typeOptions.map((option) => option.value)).toContain(`hd12-empty-${unique}`);
    expect(typeOptions.map((option) => option.value)).not.toContain(`hd12-hidden-${unique}`);
    await waitForPublicEnvironmentProfileType(page, baseUrl, {
      type: `hd12-visible-${unique}`,
      label: visibleTypeLabel,
      isPubliclyDiscoverable: true,
    });

    visibleProfile = await createNearbyAccountProfile(
      api,
      baseUrl,
      session.token,
      `hd12-visible-${unique}`,
      `HD12 Visivel ${unique}`,
    );
    await updateAccountProfileTaxonomyTerms(
      api,
      baseUrl,
      session.token,
      visibleProfile,
      [
        {
          type: taxonomy.slug,
          value: `japanese-${unique}`,
        },
      ],
    );
    await waitForPublicAccountProfileListHit(page, baseUrl, {
      slug: visibleProfile.slug,
      displayName: visibleProfile.displayName,
    });

    hiddenProfile = await createNearbyAccountProfile(
      api,
      baseUrl,
      session.token,
      `hd12-hidden-${unique}`,
      `HD12 Oculto ${unique}`,
    );
    await updateAccountProfileTaxonomyTerms(
      api,
      baseUrl,
      session.token,
      hiddenProfile,
      [
        {
          type: taxonomy.slug,
          value: `japanese-${unique}`,
        },
      ],
    );

    await openTenantPath(page, baseUrl, '/descobrir');
    await expect(page.getByText('Descubra', { exact: true }))
      .toBeVisible({ timeout: appBootTimeoutMs });

    const panel = filterPanel(page, /Painel de filtros de perfis/i);
    await expect(panel).toBeVisible({ timeout: appBootTimeoutMs });
    await expect(
      page.getByRole('button', { name: /Filtrar perfis/i }),
      'Discovery must expose the always-visible profile filter panel without the legacy toggle button.',
    ).toHaveCount(0, { timeout: appBootTimeoutMs });
    await assertFilterPanelStaysVisibleOnScroll(
      page,
      panel,
      /Filtrar perfis/i,
    );
    await expectFilterChipShowsVisibleLabel(filterOption(panel, visibleTypeLabel));
    await expect(filterOption(panel, visibleTypeLabel))
      .toBeVisible({ timeout: appBootTimeoutMs });
    await expect(
      filterOption(panel, visibleEmptyTypeLabel),
      'Discovery runtime facets must hide publicly discoverable types with zero eligible public profiles.',
    ).toHaveCount(0, { timeout: 5000 });
    await expect(filterOption(panel, hiddenTypeLabel))
      .toHaveCount(0, { timeout: 5000 });
    await expectAccessibleGroupNotContains(panel, taxonomy.name);
    await expect(filterOption(panel, `Japonesa ${unique}`))
      .toHaveCount(0, { timeout: 5000 });
    await expect(filterOption(panel, `Tailandesa ${unique}`))
      .toHaveCount(0, { timeout: 5000 });

    const discoveryTracker = trackFilteredRequests(
      page,
      '/api/v1/account_profiles',
      {
        name: 'profile_type',
        value: `hd12-visible-${unique}`,
      },
    );
    await clickUntilFilteredRequest({
      locator: filterOption(panel, visibleTypeLabel),
      tracker: discoveryTracker,
      message: 'Discovery primary filter click must trigger account profile request for selected type',
    });
    discoveryTracker.dispose();
    await expectSelectedChipIconAndLabelForegroundParity(
      filterOption(panel, visibleTypeLabel).first(),
    );
    await expect(panel).toBeVisible({ timeout: appBootTimeoutMs });
    await expectAccessibleGroupContains(panel, taxonomy.name);
    await expect(filterOption(panel, `Japonesa ${unique}`))
      .toBeVisible({ timeout: appBootTimeoutMs });
    await expect(
      filterOption(panel, `Tailandesa ${unique}`),
      'Discovery runtime taxonomy facets must hide terms with zero eligible public profiles.',
    ).toHaveCount(0, { timeout: 5000 });
    await expect(filterOption(panel, hiddenTypeLabel))
      .toHaveCount(0, { timeout: 5000 });
    await expectVisibleRuntimeTitle(page, visibleProfile.displayName);
    await expectAbsentRuntimeTitle(page, hiddenProfile.displayName);
    await page.getByRole('button', { name: /Buscar perfis/i }).click();
    await expect(page.getByLabel('Buscar artistas, locais...'))
      .toBeVisible({ timeout: appBootTimeoutMs });
    await expect(page.getByText('Descubra', { exact: true }))
      .toHaveCount(0, { timeout: appBootTimeoutMs });
    await expect(panel).toHaveCount(0, { timeout: appBootTimeoutMs });
    await page.getByRole('button', { name: /Fechar busca/i }).click();
    await expect(page.getByText('Descubra', { exact: true }))
      .toBeVisible({ timeout: appBootTimeoutMs });
    await expect(panel).toBeVisible({ timeout: appBootTimeoutMs });

    await assertNoCriticalBrowserFailures(collectors);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await runCleanupPreservingPrimaryError(primaryError, async () => {
      try {
        await cleanupOnboardedAccounts(
          api,
          baseUrl,
          session?.token,
          [
            visibleProfile?.accountSlug,
            hiddenProfile?.accountSlug,
          ].filter(Boolean),
        );
        await deleteAccountProfileType(
          api,
          baseUrl,
          session?.token,
          hiddenType?.data?.type?.toString() || '',
        );
        await deleteAccountProfileType(
          api,
          baseUrl,
          session?.token,
          visibleEmptyType?.data?.type?.toString() || '',
        );
        await deleteAccountProfileType(
          api,
          baseUrl,
          session?.token,
          visibleType?.data?.type?.toString() || '',
        );
        await deleteTaxonomy(api, baseUrl, session?.token, taxonomyId);
      } finally {
        await api.dispose();
      }
    });
  }
});
