const { chromium, request, expect } = require('@playwright/test');
const crypto = require('crypto');
const {
  loginTenantAdmin: loginTenantAdminWithRequiredCredentials,
} = require('./support/tenant_admin_auth');

const baseUrl = process.env.NAV_TENANT_URL;
const requestBaseUrl = process.env.NAV_REQUEST_BASE_URL || baseUrl;
const requestHostHeader = process.env.NAV_REQUEST_HOST_HEADER || '';
const browserHostMap = process.env.NAV_BROWSER_HOST_MAP || '';
const appBootTimeoutMs = 90000;
let anonymousIdentityToken = null;
const anonymousIdentitySeed = `runtime-discovery-followup:${Date.now()}`;

function requireTenantUrl() {
  expect(
    baseUrl,
    'Missing NAV_TENANT_URL. Runtime discovery follow-up requires a live tenant URL.',
  ).toBeTruthy();
  return baseUrl;
}

function requestOrigin() {
  return requestBaseUrl || requireTenantUrl();
}

function buildUrl(pathName, origin = requireTenantUrl()) {
  return new URL(pathName, origin).toString();
}

function requestHeaders(extraHeaders = {}) {
  return {
    ...(requestHostHeader ? { Host: requestHostHeader } : {}),
    ...extraHeaders,
  };
}

function browserLaunchArgs() {
  if (!browserHostMap.trim()) {
    return [];
  }
  return [`--host-resolver-rules=${browserHostMap}`];
}

function authHeaders(token) {
  return requestHeaders({
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  });
}

function storageSafeToken(raw) {
  const normalized = String(raw || '').trim().toLowerCase();
  return normalized ? normalized.replace(/[^a-z0-9._-]+/g, '_') : 'default';
}

function discoveryFilterSelectionStorageKey(surface) {
  const tenantKey = storageSafeToken(new URL(requireTenantUrl()).host);
  const surfaceKey = storageSafeToken(surface);
  return `discovery_filter_selection_${tenantKey}_${surfaceKey}`;
}

function discoveryFilterSelectionSnapshot({
  primaryKeys = [],
  taxonomyTerms = {},
}) {
  return JSON.stringify({
    primary_keys: primaryKeys.map(String),
    taxonomy_terms: Object.fromEntries(
      Object.entries(taxonomyTerms).map(([key, values]) => [
        String(key),
        Array.isArray(values) ? values.map(String) : [String(values)],
      ]),
    ),
  });
}

async function createApiContext() {
  return request.newContext({
    baseURL: requestOrigin(),
    extraHTTPHeaders: requestHeaders({ Accept: 'application/json' }),
    ignoreHTTPSErrors: true,
  });
}

async function resolveAnonymousIdentityToken(page) {
  if (anonymousIdentityToken) {
    return anonymousIdentityToken;
  }

  const response = await page.request.post(
    buildUrl('/api/v1/anonymous/identities', requestOrigin()),
    {
      headers: requestHeaders({ Accept: 'application/json' }),
      data: {
        device_name: 'runtime-discovery-followup-public',
        fingerprint: {
          hash: crypto
            .createHash('sha256')
            .update(`${requireTenantUrl()}:${anonymousIdentitySeed}`)
            .digest('hex'),
          user_agent: 'runtime-discovery-followup',
          locale: 'pt-BR',
        },
        metadata: {
          source: 'runtime_discovery_followup',
        },
      },
      failOnStatusCode: false,
    },
  );
  expect(
    [200, 201],
    `Anonymous tenant identity bootstrap must succeed. Status ${response.status()}`,
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
  expect(token, `${description} requires anonymous tenant bearer token.`).toBeTruthy();
  return requestHeaders({
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  });
}

async function fetchJson(page, pathName, description) {
  const response = await page.request.get(buildUrl(pathName, requestOrigin()), {
    headers: await tenantPublicAuthHeaders(page, description),
    failOnStatusCode: false,
  });
  expect(response.status(), `${description} must be readable: ${pathName}`).toBeLessThan(400);
  return response.json();
}

async function fetchDiscoveryCatalog(page, surface) {
  const catalog = await fetchJson(
    page,
    `/api/v1/discovery-filters/${encodeURIComponent(surface)}`,
    `Discovery catalog ${surface}`,
  );
  expect(Array.isArray(catalog?.filters), `Discovery catalog ${surface} must expose filters[]`).toBeTruthy();
  expect(catalog.filters.length, `Discovery catalog ${surface} must not be empty for runtime validation.`).toBeGreaterThan(0);
  return catalog;
}

async function loginTenantAdmin(api) {
  return loginTenantAdminWithRequiredCredentials({
    api,
    baseUrl: requestOrigin(),
    buildUrl: (origin, pathName) => buildUrl(pathName, origin),
    deviceName: 'runtime-discovery-followup',
  });
}

async function createTaxonomy(api, token, { slug, name, appliesTo, terms }) {
  const createResponse = await api.post(
    buildUrl('/admin/api/v1/taxonomies', requestOrigin()),
    {
      headers: authHeaders(token),
      data: {
        slug,
        name,
        applies_to: appliesTo,
        icon: 'category',
        color: '#AA5500',
      },
    },
  );
  expect(createResponse.status(), `Taxonomy ${slug} must be created.`).toBe(201);
  const createPayload = await createResponse.json();
  const taxonomyId = createPayload?.data?.id?.toString() || '';
  expect(taxonomyId, `Taxonomy ${slug} must return id.`).toBeTruthy();

  for (const term of terms) {
    const termResponse = await api.post(
      buildUrl(`/admin/api/v1/taxonomies/${taxonomyId}/terms`, requestOrigin()),
      {
        headers: authHeaders(token),
        data: term,
      },
    );
    expect(
      termResponse.status(),
      `Term ${term.slug} must be created for taxonomy ${slug}.`,
    ).toBe(201);
  }

  return { taxonomyId, slug, name, terms };
}

async function deleteTaxonomy(api, token, taxonomyId) {
  if (!taxonomyId) {
    return;
  }
  await api.delete(buildUrl(`/admin/api/v1/taxonomies/${taxonomyId}`, requestOrigin()), {
    headers: authHeaders(token),
    failOnStatusCode: false,
  });
}

async function createEventType(
  api,
  token,
  { name, slug, allowedTaxonomies, icon, color },
) {
  const response = await api.post(
    buildUrl('/admin/api/v1/event_types', requestOrigin()),
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
          icon_color: '#FFFFFF',
        },
      },
    },
  );
  expect(response.status(), `Event type ${slug} must be created.`).toBe(201);
  const payload = await response.json();
  return {
    id: payload?.data?.id?.toString() || '',
    slug,
    name,
  };
}

async function deleteEventType(api, token, eventTypeId) {
  if (!eventTypeId) {
    return;
  }
  await api.delete(buildUrl(`/admin/api/v1/event_types/${eventTypeId}`, requestOrigin()), {
    headers: authHeaders(token),
    failOnStatusCode: false,
  });
}

async function createAccountProfileType(
  api,
  token,
  { type, label, allowedTaxonomies, isFavoritable, icon, color },
) {
  const response = await api.post(
    buildUrl('/admin/api/v1/account_profile_types', requestOrigin()),
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
          is_favoritable: isFavoritable,
          has_taxonomies: allowedTaxonomies.length > 0,
        },
        poi_visual: {
          mode: 'icon',
          icon,
          color,
          icon_color: '#FFFFFF',
        },
      },
    },
  );
  expect(
    response.status(),
    `Account profile type ${type} must be created.`,
  ).toBe(201);
  return { type, label };
}

async function deleteAccountProfileType(api, token, type) {
  if (!type) {
    return;
  }
  await api.delete(
    buildUrl(
      `/admin/api/v1/account_profile_types/${encodeURIComponent(type)}`,
      requestOrigin(),
    ),
    {
      headers: authHeaders(token),
      failOnStatusCode: false,
    },
  );
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
    } else if ((await a11yButton.count()) > 0) {
      await a11yButton.first().click();
      await page.waitForTimeout(300);
    }

    await page.waitForTimeout(200);
  }
}

async function openTenantPath(page, pathName) {
  const response = await page.goto(buildUrl(pathName), {
    waitUntil: 'domcontentloaded',
  });
  expect(response, `Response should exist for ${pathName}.`).not.toBeNull();
  expect(response.status(), `Response should be successful for ${pathName}.`).toBeLessThan(400);
  await assertAppBooted(page);
  await enableAccessibilityIfNeeded(page);
}

async function writeFlutterSecureStorageEntries(page, entries) {
  await page.evaluate(
    async ({ entries }) => {
      if (!['http:', 'https:'].includes(window.location.protocol)) {
        return;
      }

      const publicKey = 'FlutterSecureStorage';
      const storage = window.localStorage;
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
    { entries },
  );
}

async function openFilterPanel(page, pattern) {
  const filterAction = page.getByRole('button', {
    name: pattern,
  });
  await expect(filterAction).toBeVisible({ timeout: appBootTimeoutMs });
  await filterAction.click();
  return filterAction;
}

async function waitForPanelTextState(
  panel,
  { includes = [], excludes = [], description = 'filter panel' },
) {
  await expect
    .poll(
      async () => {
        const text = (await panel.textContent()) || '';
        return (
          includes.every((value) => text.includes(value)) &&
          excludes.every((value) => !text.includes(value))
        );
      },
      {
        message: `${description} did not reach the expected text state.`,
        timeout: appBootTimeoutMs,
      },
    )
    .toBe(true);

  return (await panel.textContent()) || '';
}

async function validateHomeEventTypeCompatibility(page, api, session) {
  const unique = Date.now();
  let taxonomyA = null;
  let taxonomyB = null;
  let typeA = null;
  let typeB = null;
  let typeC = null;

  try {
    taxonomyA = await createTaxonomy(api, session.token, {
      slug: `rt-home-music-${unique}`,
      name: `Genero Musical ${unique}`,
      appliesTo: ['event'],
      terms: [{ slug: `rock-${unique}`, name: `Rock ${unique}` }],
    });
    taxonomyB = await createTaxonomy(api, session.token, {
      slug: `rt-home-cuisine-${unique}`,
      name: `Cozinha ${unique}`,
      appliesTo: ['event'],
      terms: [{ slug: `chef-${unique}`, name: `Chef ${unique}` }],
    });
    typeA = await createEventType(api, session.token, {
      name: `RT Home Show ${unique}`,
      slug: `rt-home-show-${unique}`,
      allowedTaxonomies: [taxonomyA.slug],
      icon: 'music_note',
      color: '#D71920',
    });
    typeB = await createEventType(api, session.token, {
      name: `RT Home Talk ${unique}`,
      slug: `rt-home-talk-${unique}`,
      allowedTaxonomies: [taxonomyB.slug],
      icon: 'record_voice_over',
      color: '#225588',
    });
    typeC = await createEventType(api, session.token, {
      name: `RT Home Empty ${unique}`,
      slug: `rt-home-empty-${unique}`,
      allowedTaxonomies: [],
      icon: 'forum',
      color: '#555555',
    });

    const selectionKey = discoveryFilterSelectionStorageKey('home.events');

    await openTenantPath(page, '/');
    await writeFlutterSecureStorageEntries(page, {
      [selectionKey]: discoveryFilterSelectionSnapshot({
        primaryKeys: [typeA.slug],
      }),
    });
    await openTenantPath(page, '/');
    await openFilterPanel(page, /(Filtrar eventos|Filtros ativos)/i);
    const panel = page.getByLabel(/Painel de filtros de eventos/i);
    await expect(panel).toBeVisible({ timeout: appBootTimeoutMs });
    const panelTextA = await waitForPanelTextState(panel, {
      description: 'Home filters panel for selected type A',
      includes: [taxonomyA.terms[0].name],
      excludes: [taxonomyB.name, taxonomyB.terms[0].name],
    });
    expect(panelTextA).toContain(taxonomyA.terms[0].name);
    expect(panelTextA).not.toContain(taxonomyB.name);
    expect(panelTextA).not.toContain(taxonomyB.terms[0].name);

    await writeFlutterSecureStorageEntries(page, {
      [selectionKey]: discoveryFilterSelectionSnapshot({
        primaryKeys: [typeB.slug],
      }),
    });
    await openTenantPath(page, '/');
    await openFilterPanel(page, /(Filtrar eventos|Filtros ativos)/i);
    const panelTextB = await waitForPanelTextState(panel, {
      description: 'Home filters panel for selected type B',
      includes: [taxonomyB.terms[0].name],
      excludes: [taxonomyA.name, taxonomyA.terms[0].name],
    });
    expect(panelTextB).toContain(taxonomyB.terms[0].name);
    expect(panelTextB).not.toContain(taxonomyA.name);
    expect(panelTextB).not.toContain(taxonomyA.terms[0].name);

    await writeFlutterSecureStorageEntries(page, {
      [selectionKey]: discoveryFilterSelectionSnapshot({
        primaryKeys: [typeC.slug],
      }),
    });
    await openTenantPath(page, '/');
    await openFilterPanel(page, /(Filtrar eventos|Filtros ativos)/i);
    const panelTextC = await waitForPanelTextState(panel, {
      description: 'Home filters panel for selected type without taxonomy',
      excludes: [
        taxonomyA.name,
        taxonomyA.terms[0].name,
        taxonomyB.name,
        taxonomyB.terms[0].name,
      ],
    });
    expect(panelTextC).not.toContain(taxonomyA.name);
    expect(panelTextC).not.toContain(taxonomyA.terms[0].name);
    expect(panelTextC).not.toContain(taxonomyB.name);
    expect(panelTextC).not.toContain(taxonomyB.terms[0].name);

    console.log('PASS home.events seeded selection honors Event Type taxonomy compatibility');
  } finally {
    await deleteEventType(api, session.token, typeC?.id);
    await deleteEventType(api, session.token, typeB?.id);
    await deleteEventType(api, session.token, typeA?.id);
    await deleteTaxonomy(api, session.token, taxonomyB?.taxonomyId);
    await deleteTaxonomy(api, session.token, taxonomyA?.taxonomyId);
  }
}

async function validateDiscoveryFavoritableFiltering(page, api, session) {
  const unique = Date.now();
  let taxonomy = null;
  let visibleType = null;
  let hiddenType = null;

  try {
    taxonomy = await createTaxonomy(api, session.token, {
      slug: `rt-discovery-cuisine-${unique}`,
      name: `Cozinha ${unique}`,
      appliesTo: ['account_profile'],
      terms: [{ slug: `japanese-${unique}`, name: `Japonesa ${unique}` }],
    });

    visibleType = await createAccountProfileType(api, session.token, {
      type: `rt-visible-${unique}`,
      label: `RT Visivel ${unique}`,
      allowedTaxonomies: [taxonomy.slug],
      isFavoritable: true,
      icon: 'restaurant',
      color: '#A94A00',
    });
    hiddenType = await createAccountProfileType(api, session.token, {
      type: `rt-hidden-${unique}`,
      label: `RT Oculto ${unique}`,
      allowedTaxonomies: [taxonomy.slug],
      isFavoritable: false,
      icon: 'lock',
      color: '#555555',
    });

    const catalog = await fetchDiscoveryCatalog(
      page,
      'discovery.account_profiles',
    );
    const filters = Array.isArray(catalog?.filters) ? catalog.filters : [];
    expect(filters.map((filter) => filter?.key)).toContain(visibleType.type);
    expect(filters.map((filter) => filter?.key)).not.toContain(hiddenType.type);
    const typeOptions = Array.isArray(catalog?.type_options?.account_profile)
      ? catalog.type_options.account_profile
      : [];
    expect(typeOptions.map((option) => option?.value)).toContain(visibleType.type);
    expect(typeOptions.map((option) => option?.value)).not.toContain(hiddenType.type);

    const selectionKey = discoveryFilterSelectionStorageKey(
      'discovery.account_profiles',
    );

    await openTenantPath(page, '/');
    await writeFlutterSecureStorageEntries(page, {
      [selectionKey]: discoveryFilterSelectionSnapshot({
        primaryKeys: [visibleType.type],
      }),
    });
    await openTenantPath(page, '/descobrir');
    await openFilterPanel(page, /(Filtrar perfis|Filtros ativos)/i);
    const panel = page.getByLabel(/Painel de filtros de perfis/i);
    await expect(panel).toBeVisible({ timeout: appBootTimeoutMs });
    const panelText = await waitForPanelTextState(panel, {
      description: 'Discovery filters panel after restored selection',
      includes: [taxonomy.terms[0].name],
      excludes: [hiddenType.label],
    });
    expect(panelText).toContain(taxonomy.terms[0].name);
    expect(panelText).not.toContain(hiddenType.label);

    console.log('PASS discovery.account_profiles hides non-favoritable types and keeps taxonomy visibility coherent');
  } finally {
    await deleteAccountProfileType(api, session.token, hiddenType?.type);
    await deleteAccountProfileType(api, session.token, visibleType?.type);
    await deleteTaxonomy(api, session.token, taxonomy?.taxonomyId);
  }
}

async function main() {
  requireTenantUrl();
  const api = await createApiContext();
  const session = await loginTenantAdmin(api);
  const browser = await chromium.launch({
    headless: true,
    args: browserLaunchArgs(),
  });
  const page = await browser.newPage({ ignoreHTTPSErrors: true });

  try {
    await validateHomeEventTypeCompatibility(page, api, session);
    await validateDiscoveryFavoritableFiltering(page, api, session);
  } finally {
    await browser.close();
    await api.dispose();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
