#!/usr/bin/env node

const crypto = require('crypto');
const {
  fixture,
  filterOwnedEventRows,
  filterOwnedProfileRows,
  paginationLastPage,
  rowFingerprint,
  runKey,
  shouldContinuePagedFetch,
} = require('./support/public_taxonomy_validation_fixture_contract');
const {
  requireLiveMutationContract,
} = require('./support/live_navigation_mutation_contract');
const {
  buildAccountSlugIndexById,
  readCanonicalAccountSlugFromProfileDetail,
  resolveAccountSlugFromIndexByProfileRecord,
} = require('./support/public_taxonomy_cleanup_resolution');

requireLiveMutationContract({
  scriptLabel: 'Public taxonomy validation fixture bootstrap',
  allowedLanes: ['local', 'dev', 'stage'],
});

const tenantUrl = (process.env.NAV_TENANT_URL || '').trim();
const fixtureAction = (process.env.NAV_PUBLIC_TAXONOMY_FIXTURE_ACTION || 'ensure')
  .toString()
  .trim()
  .toLowerCase();
const stageValidationPrefixes = {
  taxonomySlug: 'stage_validation_profile_style_',
  profileType: 'stage_validation_public_profile_',
  profileSlug: 'stage-validation-public-profile-',
  relatedProfileSlug: 'stage-validation-related-profile-',
  eventTypeSlug: 'stage_validation_public_event_type_',
  eventSlug: 'stage-validation-public-event-',
  mapFilterKey: 'stage-validation-map-events-',
};
const managedPublicMapFilterKey = `${stageValidationPrefixes.mapFilterKey}${runKey}`;
const managedPublicDefaultOrigin = Object.freeze({
  lat: fixture.location.lat,
  lng: fixture.location.lng,
  label: 'Praia do Morro',
});
let anonymousIdentityTokenPromise = null;
let requestApi = null;
let expectApi = null;
let loginTenantAdmin = null;
let cleanupOnboardedAccount = null;
let cleanupOnboardedAccounts = null;

function ensurePlaywrightRuntime() {
  if (requestApi && expectApi) {
    return;
  }

  ({ request: requestApi, expect: expectApi } = require('@playwright/test'));
  ({ loginTenantAdmin } = require('./support/tenant_admin_auth'));
  ({
    cleanupOnboardedAccount,
    cleanupOnboardedAccounts,
  } = require('./support/account_onboarding_cleanup'));
}

function expect(...args) {
  ensurePlaywrightRuntime();
  return expectApi(...args);
}

function requireTenantUrl() {
  expect(
    tenantUrl,
    'Missing NAV_TENANT_URL. Public taxonomy validation fixture requires a live tenant URL.',
  ).toBeTruthy();
  return tenantUrl;
}

function buildUrl(baseUrl, pathName) {
  return new URL(pathName, baseUrl).toString();
}

function authHeaders(token) {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

async function createApiContext(baseUrl) {
  ensurePlaywrightRuntime();
  return requestApi.newContext({
    baseURL: baseUrl,
    extraHTTPHeaders: {
      Accept: 'application/json',
    },
    ignoreHTTPSErrors: true,
  });
}

function anonymousFingerprintHash(baseUrl) {
  return crypto
    .createHash('sha256')
    .update(`stage-validation-taxonomy-fixture:${baseUrl}:${runKey}`)
    .digest('hex');
}

async function loginTenantAdminToken(api, baseUrl) {
  const session = await loginTenantAdmin({
    api,
    baseUrl,
    buildUrl,
    deviceName: 'stage-validation-taxonomy-fixture',
  });
  return session.token;
}

function normalizeRows(payload, label) {
  if (Array.isArray(payload?.data)) {
    return payload.data;
  }
  if (Array.isArray(payload?.items)) {
    return payload.items;
  }
  if (Array.isArray(payload)) {
    return payload;
  }
  throw new Error(
    `${label} must return a supported top-level array envelope (data/items).`,
  );
}

async function fetchJson(response, label) {
  expect(
    response.status(),
    `${label} must succeed. Received HTTP ${response.status()}.`,
  ).toBeLessThan(400);
  return response.json();
}

async function fetchPagedRows(api, buildPageUrl, { headers, label, pageSize }) {
  const rows = [];
  let previousFingerprint = null;

  for (let pageNumber = 1; pageNumber <= 100; pageNumber += 1) {
    const response = await api.get(buildPageUrl(pageNumber, pageSize), { headers });
    const payload = await fetchJson(response, `${label} page ${pageNumber}`);
    const pageRows = normalizeRows(payload, `${label} page ${pageNumber}`);

    const fingerprint = JSON.stringify(pageRows.map(rowFingerprint));
    if (pageNumber > 1 && fingerprint === previousFingerprint) {
      throw new Error(`${label} repeated the same page payload without advancing pagination.`);
    }
    previousFingerprint = fingerprint;

    rows.push(...pageRows);

    if (!shouldContinuePagedFetch({ payload, pageRows, pageNumber, pageSize })) {
      return rows;
    }
  }

  throw new Error(`${label} exceeded deterministic pagination cap (100 pages).`);
}

async function listTaxonomies(api, baseUrl, token) {
  return fetchPagedRows(
    api,
    (pageNumber, pageSize) => {
      const url = new URL(buildUrl(baseUrl, '/admin/api/v1/taxonomies'));
      url.searchParams.set('page', pageNumber.toString());
      url.searchParams.set('page_size', pageSize.toString());
      return url.toString();
    },
    {
      headers: authHeaders(token),
      label: 'Taxonomy registry list',
      pageSize: 500,
    },
  );
}

async function listAccountProfileTypes(api, baseUrl, token) {
  return fetchPagedRows(
    api,
    (pageNumber, pageSize) => {
      const url = new URL(buildUrl(baseUrl, '/admin/api/v1/account_profile_types'));
      url.searchParams.set('page', pageNumber.toString());
      url.searchParams.set('page_size', pageSize.toString());
      return url.toString();
    },
    {
      headers: authHeaders(token),
      label: 'Account profile type registry list',
      pageSize: 500,
    },
  );
}

async function listEventTypes(api, baseUrl, token) {
  return fetchPagedRows(
    api,
    (pageNumber, pageSize) => {
      const url = new URL(buildUrl(baseUrl, '/admin/api/v1/event_types'));
      url.searchParams.set('page', pageNumber.toString());
      url.searchParams.set('page_size', pageSize.toString());
      return url.toString();
    },
    {
      headers: authHeaders(token),
      label: 'Event type registry list',
      pageSize: 500,
    },
  );
}

async function listAdminAccounts(api, baseUrl, token) {
  return fetchPagedRows(
    api,
    (pageNumber, pageSize) => {
      const url = new URL(buildUrl(baseUrl, '/admin/api/v1/accounts'));
      url.searchParams.set('page', pageNumber.toString());
      url.searchParams.set('page_size', pageSize.toString());
      return url.toString();
    },
    {
      headers: authHeaders(token),
      label: 'Admin accounts list',
      pageSize: 200,
    },
  );
}

async function listAdminAccountProfiles(api, baseUrl, token) {
  return fetchPagedRows(
    api,
    (pageNumber, pageSize) => {
      const url = new URL(buildUrl(baseUrl, '/admin/api/v1/account_profiles'));
      url.searchParams.set('page', pageNumber.toString());
      url.searchParams.set('page_size', pageSize.toString());
      return url.toString();
    },
    {
      headers: authHeaders(token),
      label: 'Admin account profile list',
      // Keep the fixture aligned with the protected admin endpoint contract.
      pageSize: 50,
    },
  );
}

async function listAdminEvents(api, baseUrl, token) {
  return fetchPagedRows(
    api,
    (pageNumber, pageSize) => {
      const url = new URL(buildUrl(baseUrl, '/admin/api/v1/events'));
      url.searchParams.set('page', pageNumber.toString());
      url.searchParams.set('page_size', pageSize.toString());
      // Cleanup must see all buckets, otherwise stale past fixtures can keep
      // event types referenced and block idempotent re-seeding.
      url.searchParams.set('temporal', 'past,now,future');
      return url.toString();
    },
    {
      headers: authHeaders(token),
      label: 'Admin events list',
      pageSize: 50,
    },
  );
}

async function readDiscoveryFiltersSettings(api, baseUrl, token) {
  const response = await api.get(
    buildUrl(baseUrl, '/admin/api/v1/settings/values'),
    {
      headers: authHeaders(token),
    },
  );
  const payload = await fetchJson(response, 'Read tenant settings values');
  return payload?.data?.discovery_filters || {};
}

async function readMapUiSettings(api, baseUrl, token) {
  const response = await api.get(
    buildUrl(baseUrl, '/admin/api/v1/settings/values'),
    {
      headers: authHeaders(token),
    },
  );
  const payload = await fetchJson(response, 'Read tenant settings values');
  return payload?.data?.map_ui || {};
}

function buildManagedPublicMapFilter() {
  return {
    key: managedPublicMapFilterKey,
    target: 'map_poi',
    label: 'Eventos',
    override_marker: false,
    query: {
      entities: ['event'],
    },
  };
}

function hasFiniteCoordinate(value) {
  return Number.isFinite(Number(value));
}

function isManagedPublicMapFilterKey(key) {
  return key.startsWith(stageValidationPrefixes.mapFilterKey);
}

function isManagedPublicDefaultOrigin(origin) {
  const lat = Number(origin?.lat);
  const lng = Number(origin?.lng);
  const label = origin?.label?.toString().trim() || '';
  return (
    hasFiniteCoordinate(lat) &&
    hasFiniteCoordinate(lng) &&
    lat === managedPublicDefaultOrigin.lat &&
    lng === managedPublicDefaultOrigin.lng &&
    label === managedPublicDefaultOrigin.label
  );
}

function readDefaultOrigin(payload) {
  if (payload?.default_origin && typeof payload.default_origin === 'object') {
    return payload.default_origin;
  }

  return {
    lat: payload?.['default_origin.lat'] ?? null,
    lng: payload?.['default_origin.lng'] ?? null,
    label: payload?.['default_origin.label'] ?? null,
  };
}

async function patchDiscoveryFiltersSettings(api, baseUrl, token, discoveryFilters) {
  const response = await api.patch(
    buildUrl(baseUrl, '/admin/api/v1/settings/values/discovery_filters'),
    {
      headers: authHeaders(token),
      data: discoveryFilters,
    },
  );
  await fetchJson(response, 'Patch discovery_filters settings');
}

async function ensureManagedPublicMapFilter(api, baseUrl, token) {
  const current = await readDiscoveryFiltersSettings(api, baseUrl, token);
  const surfaces = { ...(current?.surfaces || {}) };
  const publicMapSurface = {
    ...(surfaces['public_map.primary'] || {}),
  };
  const currentFilters = Array.isArray(publicMapSurface.filters)
    ? publicMapSurface.filters.filter((filter) => {
        const key = filter?.key?.toString().trim().toLowerCase() || '';
        return !isManagedPublicMapFilterKey(key);
      })
    : [];

  publicMapSurface.target = publicMapSurface.target || 'map_poi';
  publicMapSurface.primary_selection_mode =
    publicMapSurface.primary_selection_mode || 'single';
  publicMapSurface.filters = [
    ...currentFilters,
    buildManagedPublicMapFilter(),
  ];
  surfaces['public_map.primary'] = publicMapSurface;

  await patchDiscoveryFiltersSettings(api, baseUrl, token, {
    ...current,
    surfaces,
  });
}

async function ensureManagedPublicDefaultOrigin(api, baseUrl, token) {
  const current = await readMapUiSettings(api, baseUrl, token);
  const currentDefaultOrigin = readDefaultOrigin(current);
  if (
    hasFiniteCoordinate(currentDefaultOrigin?.lat) &&
    hasFiniteCoordinate(currentDefaultOrigin?.lng)
  ) {
    return;
  }

  const response = await api.patch(
    buildUrl(baseUrl, '/admin/api/v1/settings/values/map_ui'),
    {
      headers: authHeaders(token),
      data: {
        'default_origin.lat': managedPublicDefaultOrigin.lat,
        'default_origin.lng': managedPublicDefaultOrigin.lng,
        'default_origin.label': managedPublicDefaultOrigin.label,
      },
    },
  );
  const payload = await fetchJson(response, 'Patch map_ui default_origin settings');
  expect(
    readDefaultOrigin(payload?.data).lat,
    'Patched map_ui default_origin.lat must persist immediately.',
  ).toBe(managedPublicDefaultOrigin.lat);
  await expect
    .poll(async () => {
      const publicResponse = await api.get(buildUrl(baseUrl, '/api/v1/environment'));
      const publicPayload = await fetchJson(
        publicResponse,
        'Read public environment after map_ui default_origin seed',
      );
      const publicDefaultOrigin = readDefaultOrigin(
        publicPayload?.data?.settings?.map_ui || publicPayload?.settings?.map_ui || {},
      );
      return {
        lat: publicDefaultOrigin?.lat ?? null,
        lng: publicDefaultOrigin?.lng ?? null,
        label: publicDefaultOrigin?.label ?? null,
      };
    }, {
      timeout: 15000,
      intervals: [250, 500, 1000],
    })
    .toEqual(managedPublicDefaultOrigin);
}

async function removeManagedPublicMapFilter(api, baseUrl, token) {
  const current = await readDiscoveryFiltersSettings(api, baseUrl, token);
  const surfaces = { ...(current?.surfaces || {}) };
  const currentSurface = surfaces['public_map.primary'];
  if (!currentSurface || !Array.isArray(currentSurface.filters)) {
    return;
  }

  const remainingFilters = currentSurface.filters.filter((filter) => {
    const key = filter?.key?.toString().trim().toLowerCase() || '';
    return !isManagedPublicMapFilterKey(key);
  });

  surfaces['public_map.primary'] = {
    ...currentSurface,
    filters: remainingFilters,
  };

  await patchDiscoveryFiltersSettings(api, baseUrl, token, {
    ...current,
    surfaces,
  });
}

async function removeManagedPublicDefaultOrigin(api, baseUrl, token) {
  const current = await readMapUiSettings(api, baseUrl, token);
  const currentDefaultOrigin = readDefaultOrigin(current);
  if (!isManagedPublicDefaultOrigin(currentDefaultOrigin)) {
    return;
  }

  const response = await api.patch(
    buildUrl(baseUrl, '/admin/api/v1/settings/values/map_ui'),
    {
      headers: authHeaders(token),
      data: {
        'default_origin.lat': null,
        'default_origin.lng': null,
        'default_origin.label': null,
      },
    },
  );
  await fetchJson(response, 'Clear managed map_ui default_origin settings');
}

async function fetchAdminAccountProfileDetail(api, baseUrl, token, profileId) {
  const response = await api.get(
    buildUrl(baseUrl, `/admin/api/v1/account_profiles/${profileId}`),
    {
      headers: authHeaders(token),
      failOnStatusCode: false,
    },
  );
  expect(
    response.status(),
    `Admin account profile detail ${profileId} must be readable for deterministic fixture cleanup.`,
  ).toBe(200);
  const payload = await response.json();
  return payload?.data || payload;
}

async function resolveCanonicalAccountSlugForCleanup(
  api,
  baseUrl,
  token,
  row,
  accountSlugById = new Map(),
) {
  const directSlug =
    row?.account_slug?.toString().trim()
    || row?.account?.slug?.toString().trim()
    || '';
  if (directSlug) {
    return directSlug;
  }

  const rowAccountSlug = resolveAccountSlugFromIndexByProfileRecord(accountSlugById, row);
  if (rowAccountSlug) {
    return rowAccountSlug;
  }

  const profileId = row?.id?.toString().trim() || '';
  expect(
    profileId,
    `Owned taxonomy fixture cleanup row ${rowFingerprint(row)} must expose an id when account_slug is absent.`,
  ).toBeTruthy();

  const detail = await fetchAdminAccountProfileDetail(api, baseUrl, token, profileId);
  const resolvedSlug = readCanonicalAccountSlugFromProfileDetail(detail);
  if (resolvedSlug) {
    return resolvedSlug;
  }

  const resolvedSlugFromAccountId = resolveAccountSlugFromIndexByProfileRecord(
    accountSlugById,
    detail,
  );
  expect(
    resolvedSlugFromAccountId,
    `Owned taxonomy fixture profile ${profileId} must expose canonical account.slug or a resolvable account_id on admin readback for strict cleanup. Row: ${rowFingerprint(row)}`,
  ).toBeTruthy();
  return resolvedSlugFromAccountId;
}

async function deleteWithSuccessExpectation(response, label) {
  const status = response.status();
  expect(
    status === 404 || (status >= 200 && status < 300),
    `${label} must delete cleanly or already be absent. Status ${status}.`,
  ).toBeTruthy();
}

async function deleteEvent(api, baseUrl, token, eventId) {
  if (!eventId) {
    return;
  }

  const response = await api.delete(buildUrl(baseUrl, `/admin/api/v1/events/${eventId}`), {
    headers: authHeaders(token),
    failOnStatusCode: false,
  });
  await deleteWithSuccessExpectation(response, `Delete event ${eventId}`);
}

async function deleteAccountProfileType(api, baseUrl, token, profileType) {
  if (!profileType) {
    return;
  }

  const response = await api.delete(
    buildUrl(baseUrl, `/admin/api/v1/account_profile_types/${encodeURIComponent(profileType)}`),
    {
      headers: authHeaders(token),
      failOnStatusCode: false,
    },
  );
  await deleteWithSuccessExpectation(
    response,
    `Delete account profile type ${profileType}`,
  );
}

async function deleteEventType(api, baseUrl, token, eventTypeId) {
  if (!eventTypeId) {
    return;
  }

  const response = await api.delete(buildUrl(baseUrl, `/admin/api/v1/event_types/${eventTypeId}`), {
    headers: authHeaders(token),
    failOnStatusCode: false,
  });
  await deleteWithSuccessExpectation(response, `Delete event type ${eventTypeId}`);
}

async function deleteTaxonomy(api, baseUrl, token, taxonomyId) {
  if (!taxonomyId) {
    return;
  }

  const response = await api.delete(
    buildUrl(baseUrl, `/admin/api/v1/taxonomies/${taxonomyId}`),
    {
      headers: authHeaders(token),
      failOnStatusCode: false,
    },
  );
  await deleteWithSuccessExpectation(response, `Delete taxonomy ${taxonomyId}`);
}

async function createTaxonomy(api, baseUrl, token) {
  const taxonomyResponse = await api.post(
    buildUrl(baseUrl, '/admin/api/v1/taxonomies'),
    {
      headers: authHeaders(token),
      data: {
        slug: fixture.taxonomySlug,
        name: fixture.taxonomyName,
        applies_to: ['account_profile', 'event'],
        icon: 'category',
        color: '#0F766E',
      },
    },
  );
  const taxonomyPayload = await fetchJson(
    taxonomyResponse,
    `Create taxonomy ${fixture.taxonomySlug}`,
  );
  const taxonomyId = taxonomyPayload?.data?.id?.toString() || '';
  expect(taxonomyId, `Taxonomy ${fixture.taxonomySlug} must return an id.`).toBeTruthy();

  const termResponse = await api.post(
    buildUrl(baseUrl, `/admin/api/v1/taxonomies/${taxonomyId}/terms`),
    {
      headers: authHeaders(token),
      data: {
        slug: fixture.taxonomyTermSlug,
        name: fixture.taxonomyTermLabel,
      },
    },
  );
  await fetchJson(
    termResponse,
    `Create taxonomy term ${fixture.taxonomyTermSlug} for ${fixture.taxonomySlug}`,
  );

  return taxonomyId;
}

async function createAccountProfileType(api, baseUrl, token) {
  const response = await api.post(
    buildUrl(baseUrl, '/admin/api/v1/account_profile_types'),
    {
      headers: authHeaders(token),
      data: {
        type: fixture.profileType,
        label: fixture.profileTypeLabel,
        labels: {
          singular: fixture.profileTypeLabel,
          plural: `${fixture.profileTypeLabel}s`,
        },
        allowed_taxonomies: [fixture.taxonomySlug],
        capabilities: {
          is_favoritable: true,
          is_publicly_discoverable: true,
          is_poi_enabled: true,
          is_reference_location_enabled: true,
          has_taxonomies: true,
          has_bio: false,
          has_content: false,
          has_avatar: false,
          has_cover: false,
          has_events: false,
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
  await fetchJson(
    response,
    `Create account profile type ${fixture.profileType}`,
  );
}

async function createPublicAccountProfile(
  api,
  baseUrl,
  token,
  {
    name,
    expectedSlug,
  },
) {
  const response = await api.post(
    buildUrl(baseUrl, '/admin/api/v1/account_onboardings'),
    {
      headers: authHeaders(token),
      data: {
        name,
        ownership_state: 'unmanaged',
        profile_type: fixture.profileType,
        location: fixture.location,
        taxonomy_terms: [
          {
            type: fixture.taxonomySlug,
            value: fixture.taxonomyTermSlug,
          },
        ],
      },
    },
  );
  const payload = await fetchJson(
    response,
    `Create public account profile fixture ${expectedSlug}`,
  );
  const profileId = payload?.data?.account_profile?.id?.toString() || '';
  const accountSlug = payload?.data?.account?.slug?.toString() || '';
  const profileSlug =
    payload?.data?.account_profile?.slug?.toString()
    || payload?.data?.account?.slug?.toString()
    || '';

  expect(profileId, 'Fixture account profile must return an account_profile id.').toBeTruthy();
  expect(
    accountSlug,
    'Fixture account profile onboarding must return a canonical account slug for strict cleanup.',
  ).toBeTruthy();
  expect(
    profileSlug,
    'Fixture account profile must expose a public slug.',
  ).toBeTruthy();
  expect(
    accountSlug === expectedSlug,
    `Fixture account slug must stay anchored to canonical slug ${expectedSlug}. Received ${accountSlug}.`,
  ).toBeTruthy();
  expect(
    profileSlug === expectedSlug,
    `Fixture account profile slug must stay anchored to canonical slug ${expectedSlug}. Received ${profileSlug}.`,
  ).toBeTruthy();

  return { profileId, profileSlug, accountSlug };
}

async function createEventType(api, baseUrl, token) {
  const response = await api.post(
    buildUrl(baseUrl, '/admin/api/v1/event_types'),
    {
      headers: authHeaders(token),
      data: {
        name: fixture.eventTypeName,
        slug: fixture.eventTypeSlug,
        description: 'Stage validation public event type',
        allowed_taxonomies: [fixture.taxonomySlug],
        visual: {
          mode: 'icon',
          icon: 'event',
          color: '#7C3AED',
          icon_color: '#FFFFFF',
        },
      },
    },
  );
  const payload = await fetchJson(
    response,
    `Create event type ${fixture.eventTypeSlug}`,
  );

  const eventTypeId = payload?.data?.id?.toString() || '';
  expect(eventTypeId, `Event type ${fixture.eventTypeSlug} must return an id.`).toBeTruthy();

  return {
    id: eventTypeId,
    name: payload?.data?.name?.toString() || fixture.eventTypeName,
    slug: payload?.data?.slug?.toString() || fixture.eventTypeSlug,
    description:
      payload?.data?.description?.toString()
      || 'Stage validation public event type',
  };
}

async function createPublicEvent(
  api,
  baseUrl,
  token,
  {
    eventType,
    physicalHostId,
    relatedProfileId,
  },
) {
  const start = new Date(Date.now() - 5 * 60 * 1000);
  const end = new Date(Date.now() + 12 * 60 * 60 * 1000);
  const response = await api.post(buildUrl(baseUrl, '/admin/api/v1/events'), {
    headers: authHeaders(token),
    data: {
      title: fixture.eventTitle,
      content: '<p>Stage validation public event.</p>',
      type: {
        id: eventType.id,
        name: eventType.name,
        slug: eventType.slug,
        description: eventType.description,
      },
      taxonomy_terms: [
        {
          type: fixture.taxonomySlug,
          value: fixture.taxonomyTermSlug,
        },
      ],
      location: {
        mode: 'physical',
      },
      place_ref: {
        type: 'account_profile',
        id: physicalHostId,
      },
      event_parties: relatedProfileId
        ? [
            {
              party_ref_id: relatedProfileId,
            },
          ]
        : [],
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
  });
  const payload = await fetchJson(
    response,
    `Create public event fixture ${fixture.eventTitle}`,
  );

  const eventId = payload?.data?.event_id?.toString() || '';
  expect(eventId, 'Fixture event must return an event_id.').toBeTruthy();
  const eventSlug = payload?.data?.slug?.toString() || '';
  expect(
    eventSlug === fixture.eventSlug || eventSlug.startsWith(`${fixture.eventSlug}-`),
    `Fixture event slug must stay anchored to canonical slug ${fixture.eventSlug}. Received ${eventSlug}.`,
  ).toBeTruthy();

  return {
    eventId,
    eventSlug,
  };
}

async function fetchPublicAccountProfiles(api, baseUrl) {
  const anonymousToken = await resolveAnonymousIdentityToken(api, baseUrl);
  return fetchPagedRows(
    api,
    (pageNumber, pageSize) => {
      const url = new URL(buildUrl(baseUrl, '/api/v1/account_profiles'));
      url.searchParams.set('page', pageNumber.toString());
      url.searchParams.set('per_page', pageSize.toString());
      return url.toString();
    },
    {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${anonymousToken}`,
      },
      label: 'Public account profile list',
      pageSize: 50,
    },
  );
}

async function fetchPublicAccountProfileDetail(api, baseUrl, slug) {
  const anonymousToken = await resolveAnonymousIdentityToken(api, baseUrl);
  const response = await api.get(
    buildUrl(baseUrl, `/api/v1/account_profiles/${slug}`),
    {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${anonymousToken}`,
      },
    },
  );
  const payload = await fetchJson(response, `Public account profile detail ${slug}`);
  return payload?.data || payload;
}

async function fetchPublicEvents(api, baseUrl) {
  const anonymousToken = await resolveAnonymousIdentityToken(api, baseUrl);
  return fetchPagedRows(
    api,
    (pageNumber, pageSize) => {
      const url = new URL(buildUrl(baseUrl, '/api/v1/events'));
      url.searchParams.set('page', pageNumber.toString());
      url.searchParams.set('per_page', pageSize.toString());
      return url.toString();
    },
    {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${anonymousToken}`,
      },
      label: 'Public events list',
      pageSize: 50,
    },
  );
}

async function fetchPublicAgenda(api, baseUrl) {
  const anonymousToken = await resolveAnonymousIdentityToken(api, baseUrl);
  return fetchPagedRows(
    api,
    (pageNumber, pageSize) => {
      const url = new URL(buildUrl(baseUrl, '/api/v1/agenda'));
      url.searchParams.set('page', pageNumber.toString());
      url.searchParams.set('page_size', pageSize.toString());
      return url.toString();
    },
    {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${anonymousToken}`,
      },
      label: 'Public agenda list',
      pageSize: 50,
    },
  );
}

async function fetchPublicEventDetail(api, baseUrl, routeRef) {
  const anonymousToken = await resolveAnonymousIdentityToken(api, baseUrl);
  const response = await api.get(
    buildUrl(baseUrl, `/api/v1/events/${routeRef}`),
    {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${anonymousToken}`,
      },
    },
  );
  const payload = await fetchJson(response, `Public event detail ${routeRef}`);
  return payload?.data || payload;
}

async function resolveAnonymousIdentityToken(api, baseUrl) {
  if (!anonymousIdentityTokenPromise) {
    anonymousIdentityTokenPromise = (async () => {
      const response = await api.post(
        buildUrl(baseUrl, '/api/v1/anonymous/identities'),
        {
          data: {
            device_name: 'stage-validation-taxonomy-fixture',
            fingerprint: {
              hash: anonymousFingerprintHash(baseUrl),
              user_agent: 'stage-validation-taxonomy-fixture',
              locale: 'pt-BR',
            },
            metadata: {
              source: 'stage_validation_taxonomy_fixture',
            },
          },
          headers: { Accept: 'application/json' },
        },
      );
      const payload = await fetchJson(
        response,
        'Anonymous tenant identity bootstrap',
      );
      const token = payload?.data?.token?.toString() || '';
      expect(
        token,
        'Anonymous tenant identity bootstrap must return a bearer token.',
      ).toBeTruthy();
      return token;
    })().catch((error) => {
      anonymousIdentityTokenPromise = null;
      throw error;
    });
  }

  return anonymousIdentityTokenPromise;
}

function findDisplaySnapshot(terms) {
  const rows = Array.isArray(terms) ? terms : [];
  return rows.find((row) => {
    const value = row?.value?.toString().trim();
    const label = row?.label?.toString().trim();
    const name = row?.name?.toString().trim();
    const display = label || name;
    return value && display && value !== display;
  }) || null;
}

async function resetOwnedFixtureArtifacts(api, baseUrl, token) {
  await removeManagedPublicMapFilter(api, baseUrl, token);
  await removeManagedPublicDefaultOrigin(api, baseUrl, token);

  const adminEvents = await listAdminEvents(api, baseUrl, token);
  const ownedEvents = adminEvents.filter((row) => {
    const slug = row?.slug?.toString().trim() || '';
    return (
      filterOwnedEventRows([row]).length > 0 ||
      slug.startsWith(stageValidationPrefixes.eventSlug)
    );
  });

  for (const row of ownedEvents) {
    const eventId = row?.event_id?.toString().trim() || row?.id?.toString().trim() || '';
    await deleteEvent(api, baseUrl, token, eventId);
  }

  const adminProfiles = await listAdminAccountProfiles(api, baseUrl, token);
  const ownedProfiles = adminProfiles.filter((row) => {
    const slug = row?.slug?.toString().trim() || '';
    return (
      filterOwnedProfileRows([row]).length > 0 ||
      slug.startsWith(stageValidationPrefixes.profileSlug) ||
      slug.startsWith(stageValidationPrefixes.relatedProfileSlug)
    );
  });
  const adminAccounts = await listAdminAccounts(api, baseUrl, token);
  const accountSlugById = buildAccountSlugIndexById(adminAccounts);
  const ownedAccountSlugs = [];
  for (const row of ownedProfiles) {
    ownedAccountSlugs.push(
      await resolveCanonicalAccountSlugForCleanup(api, baseUrl, token, row, accountSlugById),
    );
  }
  ownedAccountSlugs.push(fixture.profileSlug, fixture.relatedProfileSlug);

  await cleanupOnboardedAccounts(
    api,
    baseUrl,
    token,
    [...new Set(ownedAccountSlugs)],
    {
      strict: true,
    },
  );

  const eventTypes = await listEventTypes(api, baseUrl, token);
  const fixtureEventTypes = eventTypes.filter(
    (row) => {
      const slug = row?.slug?.toString().trim() || '';
      return (
        slug === fixture.eventTypeSlug ||
        slug.startsWith(stageValidationPrefixes.eventTypeSlug)
      );
    },
  );
  for (const fixtureEventType of fixtureEventTypes) {
    await deleteEventType(api, baseUrl, token, fixtureEventType?.id?.toString() || '');
  }

  const profileTypes = await listAccountProfileTypes(api, baseUrl, token);
  const fixtureTypes = profileTypes.filter(
    (row) => {
      const type = row?.type?.toString().trim() || '';
      return (
        type === fixture.profileType ||
        type.startsWith(stageValidationPrefixes.profileType)
      );
    },
  );
  for (const fixtureType of fixtureTypes) {
    await deleteAccountProfileType(
      api,
      baseUrl,
      token,
      fixtureType?.type?.toString().trim() || '',
    );
  }

  const taxonomies = await listTaxonomies(api, baseUrl, token);
  const fixtureTaxonomies = taxonomies.filter(
    (row) => {
      const slug = row?.slug?.toString().trim() || '';
      return (
        slug === fixture.taxonomySlug ||
        slug.startsWith(stageValidationPrefixes.taxonomySlug)
      );
    },
  );
  for (const fixtureTaxonomy of fixtureTaxonomies) {
    await deleteTaxonomy(api, baseUrl, token, fixtureTaxonomy?.id?.toString() || '');
  }
}

async function verifyAccountProfileFixture(api, baseUrl, expectedSlug) {
  const rows = await fetchPublicAccountProfiles(api, baseUrl);
  const candidate = rows.find((row) => row?.slug === expectedSlug);
  expect(
    candidate,
    `Public account profile fixture ${expectedSlug} must be visible in /api/v1/account_profiles.`,
  ).toBeTruthy();

  const listSnapshot = findDisplaySnapshot(candidate?.taxonomy_terms);
  expect(
    listSnapshot,
    `Public account profile fixture ${expectedSlug} must expose a taxonomy snapshot with display label/name different from raw value in the public list payload.`,
  ).toBeTruthy();

  const detail = await fetchPublicAccountProfileDetail(api, baseUrl, expectedSlug);
  const detailSnapshot = findDisplaySnapshot(detail?.taxonomy_terms);
  expect(
    detailSnapshot,
    `Public account profile fixture ${expectedSlug} must expose a taxonomy snapshot with display label/name different from raw value in the public detail payload.`,
  ).toBeTruthy();

  expect(
    detailSnapshot.value,
    'Public account profile fixture detail snapshot must preserve the same raw taxonomy value.',
  ).toBe(listSnapshot.value);
  expect(
    detailSnapshot.label || detailSnapshot.name,
    'Public account profile fixture detail snapshot must preserve the same display label.',
  ).toBe(listSnapshot.label || listSnapshot.name);
}

async function verifyEventFixture(api, baseUrl, { eventId, eventSlug }) {
  const rows = await fetchPublicEvents(api, baseUrl);
  const candidate = rows.find((row) => {
    const rowEventId = row?.event_id?.toString().trim();
    const rowSlug = row?.slug?.toString().trim();
    return (
      rowEventId === eventId
      || rowSlug === eventSlug
    );
  });

  expect(
    candidate,
    `Public event fixture ${fixture.eventTitle} must be visible in /api/v1/events.`,
  ).toBeTruthy();

  const candidateSlug =
    candidate?.slug?.toString().trim()
    || eventSlug
    || '';
  expect(
    candidateSlug,
    `Public event fixture ${fixture.eventTitle} must expose a public slug.`,
  ).toBeTruthy();

  const listSnapshot = findDisplaySnapshot(candidate?.taxonomy_terms);
  expect(
    listSnapshot,
    `Public event fixture ${fixture.eventTitle} must expose an event-owned taxonomy snapshot with display label/name different from raw value in the public list payload.`,
  ).toBeTruthy();

  const detail = await fetchPublicEventDetail(api, baseUrl, candidateSlug);
  const detailSnapshot = findDisplaySnapshot(detail?.taxonomy_terms);
  expect(
    detailSnapshot,
    `Public event fixture ${fixture.eventTitle} must expose an event-owned taxonomy snapshot with display label/name different from raw value in the public detail payload.`,
  ).toBeTruthy();

  expect(
    detailSnapshot.value,
    'Public event fixture detail snapshot must preserve the same raw taxonomy value.',
  ).toBe(listSnapshot.value);
  expect(
    detailSnapshot.label || detailSnapshot.name,
    'Public event fixture detail snapshot must preserve the same display label.',
  ).toBe(listSnapshot.label || listSnapshot.name);
}

async function verifyAgendaFixture(api, baseUrl, { eventId, eventSlug }) {
  const rows = await fetchPublicAgenda(api, baseUrl);
  const candidate = rows.find((row) => {
    const rowEventId = row?.event_id?.toString().trim();
    const rowSlug = row?.slug?.toString().trim();
    return rowEventId === eventId || rowSlug === eventSlug;
  });

  expect(
    candidate,
    `Public agenda fixture ${fixture.eventTitle} must be visible in /api/v1/agenda.`,
  ).toBeTruthy();

  const routeRef =
    candidate?.slug?.toString().trim()
    || candidate?.event_id?.toString().trim()
    || '';
  expect(
    routeRef,
    `Public agenda fixture ${fixture.eventTitle} must expose a public route reference through slug or event_id.`,
  ).toBeTruthy();

  const title = candidate?.title?.toString().trim() || '';
  expect(
    title,
    `Public agenda fixture ${fixture.eventTitle} must expose a visible title in /api/v1/agenda.`,
  ).toBeTruthy();
}

async function main() {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);

  try {
    const token = await loginTenantAdminToken(api, baseUrl);
    if (fixtureAction === 'cleanup') {
      await resetOwnedFixtureArtifacts(api, baseUrl, token);
      console.log(
        `INFO: cleaned public taxonomy validation fixtures for run ${runKey} on ${baseUrl}.`,
      );
      return;
    }
    expect(
      fixtureAction,
      `Unsupported NAV_PUBLIC_TAXONOMY_FIXTURE_ACTION "${fixtureAction}". Expected ensure or cleanup.`,
    ).toBe('ensure');
    try {
      await resetOwnedFixtureArtifacts(api, baseUrl, token);
      await createTaxonomy(api, baseUrl, token);
      await createAccountProfileType(api, baseUrl, token);
      await ensureManagedPublicDefaultOrigin(api, baseUrl, token);
      await ensureManagedPublicMapFilter(api, baseUrl, token);
      const { profileId, profileSlug } = await createPublicAccountProfile(
        api,
        baseUrl,
        token,
        {
          name: fixture.profileName,
          expectedSlug: fixture.profileSlug,
        },
      );
      const { profileId: relatedProfileId, profileSlug: relatedProfileSlug } =
        await createPublicAccountProfile(
          api,
          baseUrl,
          token,
          {
            name: fixture.relatedProfileName,
            expectedSlug: fixture.relatedProfileSlug,
          },
        );
      const eventType = await createEventType(api, baseUrl, token);
      const event = await createPublicEvent(api, baseUrl, token, {
        eventType,
        physicalHostId: profileId,
        relatedProfileId,
      });
      await verifyAccountProfileFixture(api, baseUrl, profileSlug);
      await verifyAccountProfileFixture(api, baseUrl, relatedProfileSlug);
      await verifyEventFixture(api, baseUrl, event);
      await verifyAgendaFixture(api, baseUrl, event);
      await ensureManagedPublicDefaultOrigin(api, baseUrl, token);
      console.log(
        `INFO: ensured public taxonomy validation fixtures ${profileSlug} and ${fixture.eventTitle} on ${baseUrl}.`,
      );
    } catch (error) {
      await resetOwnedFixtureArtifacts(api, baseUrl, token).catch(() => {});
      throw error;
    }
  } finally {
    await api.dispose();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
