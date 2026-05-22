#!/usr/bin/env node

const crypto = require('crypto');
const { request, expect } = require('@playwright/test');
const { loginTenantAdmin } = require('./support/tenant_admin_auth');

const tenantUrl = (process.env.NAV_TENANT_URL || '').trim();
const fixture = {
  taxonomySlug: 'stage_validation_profile_style',
  taxonomyName: 'Stage Validation Profile Style',
  taxonomyTermSlug: 'golden_hour',
  taxonomyTermLabel: 'Golden Hour',
  profileType: 'stage_validation_public_profile',
  profileTypeLabel: 'Stage Validation Public Profile',
  profileName: 'Stage Validation Public Profile',
  profileSlug: 'stage-validation-public-profile',
  eventTypeSlug: 'stage_validation_public_event_type',
  eventTypeName: 'Stage Validation Public Event Type',
  eventTitle: 'Stage Validation Public Event',
  mapFilterKey: 'stage_validation_profiles',
  mapFilterLabel: 'Stage Validation Profiles',
  location: {
    lat: -20.671339,
    lng: -40.495395,
  },
  defaultOriginLabel: 'Stage Validation Default Origin',
};

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
  return request.newContext({
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
    .update(`stage-validation-taxonomy-fixture:${baseUrl}`)
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

function normalizeRows(payload) {
  if (Array.isArray(payload?.data)) {
    return payload.data;
  }
  if (Array.isArray(payload?.data?.data)) {
    return payload.data.data;
  }
  if (Array.isArray(payload?.items)) {
    return payload.items;
  }
  return [];
}

async function fetchJson(response, label) {
  expect(
    response.status(),
    `${label} must succeed. Received HTTP ${response.status()}.`,
  ).toBeLessThan(400);
  return response.json();
}

async function listTaxonomies(api, baseUrl, token) {
  const response = await api.get(
    buildUrl(baseUrl, '/admin/api/v1/taxonomies'),
    { headers: authHeaders(token) },
  );
  return normalizeRows(await fetchJson(response, 'Taxonomy registry list'));
}

async function listAccountProfileTypes(api, baseUrl, token) {
  const response = await api.get(
    buildUrl(baseUrl, '/admin/api/v1/account_profile_types'),
    { headers: authHeaders(token) },
  );
  return normalizeRows(await fetchJson(response, 'Account profile type registry list'));
}

async function listEventTypes(api, baseUrl, token) {
  const response = await api.get(
    buildUrl(baseUrl, '/admin/api/v1/event_types'),
    { headers: authHeaders(token) },
  );
  return normalizeRows(await fetchJson(response, 'Event type registry list'));
}

async function listAdminAccountProfiles(api, baseUrl, token) {
  const url = new URL(buildUrl(baseUrl, '/admin/api/v1/account_profiles'));
  url.searchParams.set('page', '1');
  url.searchParams.set('page_size', '200');
  const response = await api.get(url.toString(), {
    headers: authHeaders(token),
  });
  return normalizeRows(await fetchJson(response, 'Admin account profile list'));
}

async function listAdminEvents(api, baseUrl, token) {
  const rows = [];
  for (let page = 1; page <= 8; page += 1) {
    const url = new URL(buildUrl(baseUrl, '/admin/api/v1/events'));
    url.searchParams.set('page', page.toString());
    url.searchParams.set('page_size', '50');
    // Cleanup must see all buckets, otherwise stale past fixtures can keep
    // event types referenced and block idempotent re-seeding.
    url.searchParams.set('temporal', 'past,now,future');
    const response = await api.get(url.toString(), {
      headers: authHeaders(token),
    });
    const pageRows = normalizeRows(await fetchJson(response, `Admin events page ${page}`));
    rows.push(...pageRows);
    if (pageRows.length === 0) {
      break;
    }
  }
  return rows;
}

async function deleteAccountProfile(api, baseUrl, token, profileId) {
  if (!profileId) {
    return;
  }

  await api.delete(buildUrl(baseUrl, `/admin/api/v1/account_profiles/${profileId}`), {
    headers: authHeaders(token),
    failOnStatusCode: false,
  });
}

async function deleteEvent(api, baseUrl, token, eventId) {
  if (!eventId) {
    return;
  }

  await api.delete(buildUrl(baseUrl, `/admin/api/v1/events/${eventId}`), {
    headers: authHeaders(token),
    failOnStatusCode: false,
  });
}

async function deleteAccountProfileType(api, baseUrl, token, profileType) {
  if (!profileType) {
    return;
  }

  await api.delete(
    buildUrl(baseUrl, `/admin/api/v1/account_profile_types/${encodeURIComponent(profileType)}`),
    {
      headers: authHeaders(token),
      failOnStatusCode: false,
    },
  );
}

async function deleteEventType(api, baseUrl, token, eventTypeId) {
  if (!eventTypeId) {
    return;
  }

  await api.delete(buildUrl(baseUrl, `/admin/api/v1/event_types/${eventTypeId}`), {
    headers: authHeaders(token),
    failOnStatusCode: false,
  });
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
    },
  );
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
        poi_visual: {
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

async function createPublicAccountProfile(api, baseUrl, token) {
  const response = await api.post(
    buildUrl(baseUrl, '/admin/api/v1/account_onboardings'),
    {
      headers: authHeaders(token),
      data: {
        name: fixture.profileName,
        ownership_state: 'tenant_owned',
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
    `Create public account profile fixture ${fixture.profileSlug}`,
  );
  const profileId = payload?.data?.account_profile?.id?.toString() || '';
  const profileSlug =
    payload?.data?.account_profile?.slug?.toString()
    || payload?.data?.account?.slug?.toString()
    || '';

  expect(profileId, 'Fixture account profile must return an account_profile id.').toBeTruthy();
  expect(
    profileSlug,
    'Fixture account profile must expose a public slug.',
  ).toBeTruthy();

  return { profileId, profileSlug };
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

async function createPublicEvent(api, baseUrl, token, { eventType, physicalHostId }) {
  const start = new Date(Date.now() + 30 * 60 * 1000);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
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
  });
  const payload = await fetchJson(
    response,
    `Create public event fixture ${fixture.eventTitle}`,
  );

  const eventId = payload?.data?.event_id?.toString() || '';
  expect(eventId, 'Fixture event must return an event_id.').toBeTruthy();

  return {
    eventId,
    eventSlug: payload?.data?.slug?.toString() || '',
  };
}

async function fetchPublicAccountProfiles(api, baseUrl) {
  const url = new URL(buildUrl(baseUrl, '/api/v1/account_profiles'));
  url.searchParams.set('per_page', '50');
  const anonymousToken = await resolveAnonymousIdentityToken(api, baseUrl);
  const response = await api.get(url.toString(), {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${anonymousToken}`,
    },
  });
  return normalizeRows(await fetchJson(response, 'Public account profile list'));
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
  const rows = [];
  const anonymousToken = await resolveAnonymousIdentityToken(api, baseUrl);

  for (let page = 1; page <= 8; page += 1) {
    const url = new URL(buildUrl(baseUrl, '/api/v1/events'));
    url.searchParams.set('page', page.toString());
    url.searchParams.set('per_page', '50');
    const response = await api.get(url.toString(), {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${anonymousToken}`,
      },
    });
    const pageRows = normalizeRows(await fetchJson(response, `Public events page ${page}`));
    rows.push(...pageRows);
    if (pageRows.length === 0) {
      break;
    }
  }

  return rows;
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

async function fetchTenantSettingsValues(api, baseUrl, token) {
  const response = await api.get(
    buildUrl(baseUrl, '/admin/api/v1/settings/values'),
    {
      headers: authHeaders(token),
    },
  );
  return fetchJson(response, 'Tenant-admin settings values');
}

async function patchDiscoveryFilters(api, baseUrl, token, surfaces) {
  const response = await api.patch(
    buildUrl(baseUrl, '/admin/api/v1/settings/values/discovery_filters'),
    {
      headers: authHeaders(token),
      data: { surfaces },
    },
  );
  await fetchJson(
    response,
    'Persist tenant-admin discovery filters through Settings Kernel',
  );
}

async function patchMapUiDefaultOrigin(api, baseUrl, token) {
  const response = await api.patch(
    buildUrl(baseUrl, '/admin/api/v1/settings/values/map_ui'),
    {
      headers: authHeaders(token),
      data: {
        'default_origin.lat': fixture.location.lat,
        'default_origin.lng': fixture.location.lng,
        'default_origin.label': fixture.defaultOriginLabel,
      },
    },
  );
  await fetchJson(
    response,
    'Persist tenant-admin map_ui default_origin through Settings Kernel',
  );
}

async function resolveAnonymousIdentityToken(api, baseUrl) {
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

function normalizePayload(payload) {
  if (payload && typeof payload === 'object' && payload.data && typeof payload.data === 'object') {
    return payload.data;
  }
  return payload;
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && typeof value === 'object') {
    return Object.values(value);
  }
  return [];
}

function buildStageValidationMapFilter() {
  return {
    key: fixture.mapFilterKey,
    target: 'map_poi',
    label: fixture.mapFilterLabel,
    query: {
      entities: ['account_profile'],
      types_by_entity: {
        account_profile: [fixture.profileType],
      },
    },
  };
}

async function ensureRuntimeMapFilterSurface(api, baseUrl, token) {
  const valuesPayload = normalizePayload(await fetchTenantSettingsValues(api, baseUrl, token));
  const discoveryFilters =
    valuesPayload?.discovery_filters && typeof valuesPayload.discovery_filters === 'object'
      ? valuesPayload.discovery_filters
      : {};
  const surfaces =
    discoveryFilters.surfaces && typeof discoveryFilters.surfaces === 'object'
      ? { ...discoveryFilters.surfaces }
      : {};
  const existingSurface =
    surfaces['public_map.primary'] && typeof surfaces['public_map.primary'] === 'object'
      ? { ...surfaces['public_map.primary'] }
      : {};
  const existingFilters = normalizeList(existingSurface.filters);

  const hasFixtureFilter = existingFilters.some((filter) => filter?.key === fixture.mapFilterKey);
  if (hasFixtureFilter) {
    return;
  }

  surfaces['public_map.primary'] = {
    ...existingSurface,
    target: existingSurface.target || 'map_poi',
    primary_selection_mode: existingSurface.primary_selection_mode || 'single',
    filters: [...existingFilters, buildStageValidationMapFilter()],
  };

  await patchDiscoveryFilters(api, baseUrl, token, surfaces);
}

async function ensureRuntimeDefaultOrigin(api, baseUrl, token) {
  const valuesPayload = normalizePayload(await fetchTenantSettingsValues(api, baseUrl, token));
  const mapUi =
    valuesPayload?.map_ui && typeof valuesPayload.map_ui === 'object'
      ? valuesPayload.map_ui
      : {};
  const defaultOrigin =
    mapUi.default_origin && typeof mapUi.default_origin === 'object'
      ? mapUi.default_origin
      : {};
  const currentLat = Number(defaultOrigin.lat);
  const currentLng = Number(defaultOrigin.lng);
  const currentLabel = defaultOrigin.label?.toString().trim() || '';
  const hasExpectedOrigin =
    Number.isFinite(currentLat) &&
    Number.isFinite(currentLng) &&
    currentLat === fixture.location.lat &&
    currentLng === fixture.location.lng &&
    currentLabel === fixture.defaultOriginLabel;
  if (hasExpectedOrigin) {
    return;
  }

  await patchMapUiDefaultOrigin(api, baseUrl, token);
}

async function resetOwnedFixtureArtifacts(api, baseUrl, token) {
  const adminEvents = await listAdminEvents(api, baseUrl, token);
  const ownedEvents = adminEvents.filter((row) => {
    const title = row?.title?.toString().trim();
    const typeSlug = row?.type?.slug?.toString().trim();
    return title === fixture.eventTitle || typeSlug === fixture.eventTypeSlug;
  });

  for (const row of ownedEvents) {
    const eventId = row?.event_id?.toString().trim() || row?.id?.toString().trim() || '';
    await deleteEvent(api, baseUrl, token, eventId);
  }

  const adminProfiles = await listAdminAccountProfiles(api, baseUrl, token);
  const ownedProfiles = adminProfiles.filter((row) => {
    const slug = row?.slug?.toString().trim();
    const displayName = row?.display_name?.toString().trim();
    const profileType = row?.profile_type?.toString().trim();
    return (
      slug === fixture.profileSlug
      || displayName === fixture.profileName
      || profileType === fixture.profileType
    );
  });

  for (const row of ownedProfiles) {
    await deleteAccountProfile(api, baseUrl, token, row?.id?.toString() || '');
  }

  const eventTypes = await listEventTypes(api, baseUrl, token);
  const fixtureEventType = eventTypes.find((row) => row?.slug === fixture.eventTypeSlug);
  if (fixtureEventType) {
    await deleteEventType(api, baseUrl, token, fixtureEventType?.id?.toString() || '');
  }

  const profileTypes = await listAccountProfileTypes(api, baseUrl, token);
  const fixtureType = profileTypes.find((row) => row?.type === fixture.profileType);
  if (fixtureType) {
    await deleteAccountProfileType(api, baseUrl, token, fixture.profileType);
  }

  const taxonomies = await listTaxonomies(api, baseUrl, token);
  const fixtureTaxonomy = taxonomies.find((row) => row?.slug === fixture.taxonomySlug);
  if (fixtureTaxonomy) {
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
    const rowTitle = row?.title?.toString().trim();
    return (
      rowEventId === eventId
      || rowSlug === eventSlug
      || rowTitle === fixture.eventTitle
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

async function verifyMapFilterCatalog(api, baseUrl) {
  const anonymousToken = await resolveAnonymousIdentityToken(api, baseUrl);
  const url = new URL(buildUrl(baseUrl, '/api/v1/map/filters'));
  url.searchParams.set('ne_lat', '-19.0');
  url.searchParams.set('ne_lng', '-39.0');
  url.searchParams.set('sw_lat', '-21.0');
  url.searchParams.set('sw_lng', '-41.0');

  const response = await api.get(url.toString(), {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${anonymousToken}`,
    },
  });
  const payload = await fetchJson(response, 'Public map filter catalog');
  const categories = Array.isArray(payload?.categories) ? payload.categories : [];

  expect(
    categories.length,
    'Public map filter catalog must expose at least one primary category.',
  ).toBeGreaterThan(0);

  const category = categories.find((row) => row?.key === fixture.mapFilterKey);
  expect(
    category,
    `Public map filter catalog must expose the fixture category ${fixture.mapFilterKey}.`,
  ).toBeTruthy();
  expect(
    category?.label,
    `Public map filter category ${fixture.mapFilterKey} must preserve the configured display label.`,
  ).toBe(fixture.mapFilterLabel);
  expect(
    category?.query?.source,
    `Public map filter category ${fixture.mapFilterKey} must target account-profile source filtering.`,
  ).toBe('account_profile');
  expect(
    Array.isArray(category?.query?.types) ? category.query.types : [],
    `Public map filter category ${fixture.mapFilterKey} must carry the seeded profile type in the public query contract.`,
  ).toContain(fixture.profileType);
}

async function verifyEnvironmentDefaultOrigin(api, baseUrl) {
  const response = await api.get(buildUrl(baseUrl, '/api/v1/environment'), {
    headers: {
      Accept: 'application/json',
    },
  });
  const payload = normalizePayload(await fetchJson(response, 'Tenant environment payload'));
  const defaultOrigin =
    payload?.settings?.map_ui?.default_origin &&
    typeof payload.settings.map_ui.default_origin === 'object'
      ? payload.settings.map_ui.default_origin
      : null;
  expect(
    defaultOrigin,
    'Tenant environment payload must expose map_ui.default_origin after fixture bootstrap.',
  ).toBeTruthy();
  expect(
    Number(defaultOrigin?.lat),
    'Tenant environment payload must expose the seeded map_ui.default_origin.lat.',
  ).toBe(fixture.location.lat);
  expect(
    Number(defaultOrigin?.lng),
    'Tenant environment payload must expose the seeded map_ui.default_origin.lng.',
  ).toBe(fixture.location.lng);
  expect(
    defaultOrigin?.label,
    'Tenant environment payload must expose the seeded map_ui.default_origin.label.',
  ).toBe(fixture.defaultOriginLabel);
}

async function main() {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);

  try {
    const token = await loginTenantAdminToken(api, baseUrl);
    await resetOwnedFixtureArtifacts(api, baseUrl, token);
    await createTaxonomy(api, baseUrl, token);
    await createAccountProfileType(api, baseUrl, token);
    const { profileId, profileSlug } = await createPublicAccountProfile(api, baseUrl, token);
    const eventType = await createEventType(api, baseUrl, token);
    const event = await createPublicEvent(api, baseUrl, token, {
      eventType,
      physicalHostId: profileId,
    });
    await ensureRuntimeDefaultOrigin(api, baseUrl, token);
    await ensureRuntimeMapFilterSurface(api, baseUrl, token);
    await verifyAccountProfileFixture(api, baseUrl, profileSlug);
    await verifyEventFixture(api, baseUrl, event);
    await verifyEnvironmentDefaultOrigin(api, baseUrl);
    await verifyMapFilterCatalog(api, baseUrl);
    console.log(
      `INFO: ensured public taxonomy validation fixtures ${profileSlug} and ${fixture.eventTitle} on ${baseUrl}.`,
    );
  } finally {
    await api.dispose();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
