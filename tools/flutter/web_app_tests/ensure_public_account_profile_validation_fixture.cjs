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
  location: {
    lat: -20.671339,
    lng: -40.495395,
  },
};

function requireTenantUrl() {
  expect(
    tenantUrl,
    'Missing NAV_TENANT_URL. Public account-profile validation fixture requires a live tenant URL.',
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
    .update(`stage-validation-public-profile:${baseUrl}`)
    .digest('hex');
}

async function loginTenantAdminToken(api, baseUrl) {
  const session = await loginTenantAdmin({
    api,
    baseUrl,
    buildUrl,
    deviceName: 'stage-validation-public-profile-fixture',
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

async function listAdminAccountProfiles(api, baseUrl, token) {
  const url = new URL(buildUrl(baseUrl, '/admin/api/v1/account_profiles'));
  url.searchParams.set('page', '1');
  url.searchParams.set('page_size', '200');
  const response = await api.get(url.toString(), {
    headers: authHeaders(token),
  });
  return normalizeRows(await fetchJson(response, 'Admin account profile list'));
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
        applies_to: ['account_profile'],
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

async function resolveAnonymousIdentityToken(api, baseUrl) {
  const response = await api.post(
    buildUrl(baseUrl, '/api/v1/anonymous/identities'),
    {
      data: {
        device_name: 'stage-validation-public-profile',
        fingerprint: {
          hash: anonymousFingerprintHash(baseUrl),
          user_agent: 'stage-validation-public-profile',
          locale: 'pt-BR',
        },
        metadata: {
          source: 'stage_validation_public_profile_fixture',
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

async function resetOwnedFixtureArtifacts(api, baseUrl, token) {
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

async function verifyFixture(api, baseUrl, expectedSlug) {
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

async function main() {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);

  try {
    const token = await loginTenantAdminToken(api, baseUrl);
    await resetOwnedFixtureArtifacts(api, baseUrl, token);
    await createTaxonomy(api, baseUrl, token);
    await createAccountProfileType(api, baseUrl, token);
    const { profileSlug } = await createPublicAccountProfile(api, baseUrl, token);
    await verifyFixture(api, baseUrl, profileSlug);
    console.log(
      `INFO: ensured public account-profile validation fixture ${profileSlug} on ${baseUrl}.`,
    );
  } finally {
    await api.dispose();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
