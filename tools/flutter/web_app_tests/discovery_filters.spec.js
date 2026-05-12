const crypto = require('crypto');
const zlib = require('zlib');
const { test, expect, request } = require('@playwright/test');
const {
  loginTenantAdmin: loginTenantAdminWithRequiredCredentials,
} = require('./support/tenant_admin_auth');

const tenantUrl = process.env.NAV_TENANT_URL;
const appBootTimeoutMs = 90000;
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

function firstQueryExpectation(filter) {
  const query = normalizeQuery(filter.query);
  const entities = valuesFor(query.entities ?? query.entity);
  const typesByEntity = normalizeQuery(query.types_by_entity);
  const flatTypes = valuesFor(query.types ?? query.type);
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

function requestContainsFilterValue(rawUrl, expected) {
  const url = new URL(rawUrl);
  const params = url.searchParams;
  const expectedValue = expected.value.toLowerCase();
  for (const [, value] of params.entries()) {
    if (String(value).toLowerCase().includes(expectedValue)) {
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
  timeoutMs = appBootTimeoutMs,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (tracker.urls.length > 0) {
      return tracker.urls[0];
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
    await activateSemanticToggle(locator.first());
    try {
      return await waitForTrackedFilteredRequest(tracker, message, 12000);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error(message);
}

async function activateSemanticToggle(locator) {
  await expect(locator).toBeVisible({ timeout: appBootTimeoutMs });
  await locator.click();
}

function installFailureCollectors(page) {
  const runtimeErrors = [];
  const failedRequests = [];
  const consoleErrors = [];

  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('requestfailed', (request) => {
    const failureText = request.failure()?.errorText || 'unknown';
    if (failureText === 'net::ERR_ABORTED') {
      return;
    }
    failedRequests.push(`${request.method()} ${request.url()} (${failureText})`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  return { runtimeErrors, failedRequests, consoleErrors };
}

async function assertNoCriticalBrowserFailures(collectors) {
  expect(
    collectors.runtimeErrors,
    `Unexpected runtime errors:\n${collectors.runtimeErrors.join('\n')}`,
  ).toEqual([]);
  expect(
    collectors.failedRequests,
    `Unexpected failed requests:\n${collectors.failedRequests.join('\n')}`,
  ).toEqual([]);

  const criticalConsoleErrors = collectors.consoleErrors.filter(
    (entry) =>
      !entry.includes('status of 401') &&
      !entry.includes('ResizeObserver loop limit exceeded'),
  );
  expect(
    criticalConsoleErrors,
    `Critical console errors:\n${criticalConsoleErrors.join('\n')}`,
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

async function continueWithoutLocationIfPrompted(page) {
  const continueButton = page.getByRole('button', {
    name: /Continuar sem localizacao|Continuar sem localização/i,
  });

  await continueButton
    .first()
    .waitFor({
      state: 'visible',
      timeout: 15000,
    })
    .catch(() => null);

  if ((await continueButton.count()) === 0) {
    return;
  }
  await continueButton.first().click();
  await expect(continueButton).toHaveCount(0, { timeout: appBootTimeoutMs });
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

  let needsPatch = false;
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

async function assertFilterPanelHidesOnScroll(page, visibleButtonLabel) {
  await page.mouse.wheel(0, 900);
  await expect(
    page.getByRole('button', { name: visibleButtonLabel }),
  ).toHaveCount(0, { timeout: appBootTimeoutMs });
  await expect(page.getByRole('button', { name: /Filtros ativos/i }))
    .toBeVisible({ timeout: appBootTimeoutMs });
}

function filterPanel(page, label) {
  return page.getByLabel(label);
}

function filterActionPattern(baseLabel) {
  return new RegExp(`(${baseLabel}|Filtros ativos)`, 'i');
}

function filterOption(panel, label) {
  const pattern = labelPattern(label);
  return panel
    .getByRole('button', { name: pattern })
    .or(panel.getByRole('switch', { name: pattern }));
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
    },
  );
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
          is_favoritable: isFavoritable,
          has_taxonomies: allowedTaxonomies.length > 0,
        },
        poi_visual: {
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
  const image = decodePng(await locator.screenshot());
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
  const session = await loginTenantAdmin(api, baseUrl);
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await seedFlutterSecureStorage(context, session);
  const page = await context.newPage();
  const collectors = installFailureCollectors(page);

  await openTenantPath(page, baseUrl, '/admin');
  await expect(
    page.getByRole('button', {
      name: /Configure filtros de Mapa, Home e Descoberta/i,
    }),
  ).toHaveCount(0, { timeout: appBootTimeoutMs });

  await openTenantPath(page, baseUrl, '/admin/filters');
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
});

test('@mutation public Map keeps baseline primary filters without taxonomy subfilters and uses backend filtering', async ({
  page,
}) => {
  const baseUrl = requireTenantUrl();
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
  await expect(page.getByRole('button', { name: labelPattern(selectedCategory.label) }))
    .toBeVisible({ timeout: appBootTimeoutMs });

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
    await expect(page.getByRole('button', { name: labelPattern(siblingCategory.label) }))
      .toBeVisible({ timeout: appBootTimeoutMs });
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

test('@mutation Home filters honor Event Type taxonomy compatibility, hide zero-taxonomy rows, and keep selected icon foreground aligned with the label', async ({
  page,
}) => {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  const collectors = installFailureCollectors(page);
  let session = null;
  let typeAId = null;
  let typeBId = null;
  let typeCId = null;
  let taxonomyAId = null;
  let taxonomyBId = null;

  try {
    session = await loginTenantAdmin(api, baseUrl);
    const unique = Date.now();
    const typeALabel = `AAA HD10 Show ${unique}`;
    const typeBLabel = `AAB HD10 Talk ${unique}`;
    const typeCLabel = `AAC HD10 Empty ${unique}`;
    const taxonomyA = await createTaxonomy(api, baseUrl, session.token, {
      slug: `hd10-music-${unique}`,
      name: `Genero Musical ${unique}`,
      appliesTo: ['event'],
      terms: [
        { slug: `rock-${unique}`, name: `Rock ${unique}` },
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

    const catalog = await fetchDiscoveryCatalog(page, baseUrl, 'home.events');
    const filterKeys = normalizeList(catalog.filters).map((filter) => filter.key);
    expect(filterKeys).toEqual(expect.arrayContaining([
      `hd10-show-${unique}`,
      `hd10-talk-${unique}`,
      `hd10-empty-${unique}`,
    ]));

    await openTenantPath(page, baseUrl, '/');
    const filterAction = page.getByRole('button', {
      name: filterActionPattern('Filtrar eventos'),
    });
    await expect(filterAction).toBeVisible({ timeout: appBootTimeoutMs });
    await filterAction.click();

    const panel = filterPanel(page, /Painel de filtros de eventos/i);
    await expect(panel).toBeVisible({ timeout: appBootTimeoutMs });
    await expect(filterOption(panel, typeALabel))
      .toBeVisible({ timeout: appBootTimeoutMs });
    await expect(filterOption(panel, typeBLabel))
      .toBeVisible({ timeout: appBootTimeoutMs });
    await expect(filterOption(panel, typeCLabel))
      .toBeVisible({ timeout: appBootTimeoutMs });
    await expectAccessibleGroupNotContains(panel, taxonomyA.name);
    await expectAccessibleGroupNotContains(panel, taxonomyB.name);
    await expect(filterOption(panel, `Rock ${unique}`))
      .toHaveCount(0, { timeout: 5000 });
    await expect(filterOption(panel, `Chef ${unique}`))
      .toHaveCount(0, { timeout: 5000 });

    const homeShowTracker = trackFilteredRequests(page, '/api/v1/agenda', {
      name: 'type',
      value: `hd10-show-${unique}`,
    });
    await clickUntilFilteredRequest({
      locator: filterOption(panel, typeALabel),
      tracker: homeShowTracker,
      message: 'Home primary filter click must trigger agenda request for selected Event Type',
    });
    homeShowTracker.dispose();
    await expect(page.getByRole('button', { name: /Filtros ativos/i })).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    await expect(panel).toBeVisible({ timeout: appBootTimeoutMs });
    await expectAccessibleGroupContains(panel, taxonomyA.name);
    await expect(filterOption(panel, `Rock ${unique}`))
      .toBeVisible({ timeout: appBootTimeoutMs });
    await expectAccessibleGroupNotContains(panel, taxonomyB.name, appBootTimeoutMs);

    const homeTalkTracker = trackFilteredRequests(page, '/api/v1/agenda', {
      name: 'type',
      value: `hd10-talk-${unique}`,
    });
    await clickUntilFilteredRequest({
      locator: filterOption(panel, typeBLabel),
      tracker: homeTalkTracker,
      message: 'Home primary filter switch must trigger agenda request for the next Event Type',
    });
    homeTalkTracker.dispose();
    await expect(panel).toBeVisible({ timeout: appBootTimeoutMs });
    await expectAccessibleGroupContains(panel, taxonomyB.name);
    await expect(filterOption(panel, `Chef ${unique}`))
      .toBeVisible({ timeout: appBootTimeoutMs });
    await expectAccessibleGroupNotContains(panel, taxonomyA.name, appBootTimeoutMs);

    const homeEmptyTracker = trackFilteredRequests(page, '/api/v1/agenda', {
      name: 'type',
      value: `hd10-empty-${unique}`,
    });
    await clickUntilFilteredRequest({
      locator: filterOption(panel, typeCLabel),
      tracker: homeEmptyTracker,
      message: 'Home zero-taxonomy primary click must still trigger agenda request',
    });
    homeEmptyTracker.dispose();
    await expect(panel).toBeVisible({ timeout: appBootTimeoutMs });
    await expectAccessibleGroupNotContains(panel, taxonomyA.name, appBootTimeoutMs);
    await expectAccessibleGroupNotContains(panel, taxonomyB.name, appBootTimeoutMs);
    await expect(filterOption(panel, `Rock ${unique}`))
      .toHaveCount(0, { timeout: appBootTimeoutMs });
    await expect(filterOption(panel, `Chef ${unique}`))
      .toHaveCount(0, { timeout: appBootTimeoutMs });

    await assertNoCriticalBrowserFailures(collectors);
  } finally {
    await deleteEventType(api, baseUrl, session?.token, typeCId);
    await deleteEventType(api, baseUrl, session?.token, typeBId);
    await deleteEventType(api, baseUrl, session?.token, typeAId);
    await deleteTaxonomy(api, baseUrl, session?.token, taxonomyBId);
    await deleteTaxonomy(api, baseUrl, session?.token, taxonomyAId);
    await api.dispose();
  }
});

test('@mutation Profile Discovery excludes non-favoritable types and keeps selected icon foreground aligned with the label', async ({
  page,
}) => {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  const collectors = installFailureCollectors(page);
  let session = null;
  let visibleType = null;
  let hiddenType = null;
  let taxonomyId = null;

  try {
    session = await loginTenantAdmin(api, baseUrl);
    const unique = Date.now();
    const visibleTypeLabel = `AAA HD12 Visivel ${unique}`;
    const hiddenTypeLabel = `ZZZ HD12 Oculto ${unique}`;
    const taxonomy = await createTaxonomy(api, baseUrl, session.token, {
      slug: `hd12-cuisine-${unique}`,
      name: `Cozinha ${unique}`,
      appliesTo: ['account_profile'],
      terms: [
        { slug: `japanese-${unique}`, name: `Japonesa ${unique}` },
      ],
    });
    taxonomyId = taxonomy.taxonomyId;

    visibleType = await createAccountProfileType(api, baseUrl, session.token, {
      type: `hd12-visible-${unique}`,
      label: visibleTypeLabel,
      allowedTaxonomies: [taxonomy.slug],
      isFavoritable: true,
      icon: 'restaurant',
      color: '#A94A00',
    });
    hiddenType = await createAccountProfileType(api, baseUrl, session.token, {
      type: `hd12-hidden-${unique}`,
      label: hiddenTypeLabel,
      allowedTaxonomies: [taxonomy.slug],
      isFavoritable: false,
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
    expect(filters.map((filter) => filter.key)).not.toContain(`hd12-hidden-${unique}`);
    const typeOptions = normalizeList(catalog?.type_options?.account_profile);
    expect(typeOptions.map((option) => option.value)).toContain(`hd12-visible-${unique}`);
    expect(typeOptions.map((option) => option.value)).not.toContain(`hd12-hidden-${unique}`);

    await openTenantPath(page, baseUrl, '/descobrir');
    await expect(page.getByText('Descubra', { exact: true }))
      .toBeVisible({ timeout: appBootTimeoutMs });

    const filterAction = page.getByRole('button', {
      name: filterActionPattern('Filtrar perfis'),
    });
    await expect(filterAction).toBeVisible({ timeout: appBootTimeoutMs });
    await filterAction.click();

    const panel = filterPanel(page, /Painel de filtros de perfis/i);
    await expect(panel).toBeVisible({ timeout: appBootTimeoutMs });
    await expect(filterOption(panel, visibleTypeLabel))
      .toBeVisible({ timeout: appBootTimeoutMs });
    await expect(filterOption(panel, hiddenTypeLabel))
      .toHaveCount(0, { timeout: 5000 });
    await expectAccessibleGroupNotContains(panel, taxonomy.name);
    await expect(filterOption(panel, `Japonesa ${unique}`))
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
    await expect(panel).toBeVisible({ timeout: appBootTimeoutMs });
    await expectAccessibleGroupContains(panel, taxonomy.name);
    await expect(filterOption(panel, `Japonesa ${unique}`))
      .toBeVisible({ timeout: appBootTimeoutMs });
    await expect(filterOption(panel, hiddenTypeLabel))
      .toHaveCount(0, { timeout: 5000 });

    await assertNoCriticalBrowserFailures(collectors);
  } finally {
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
      visibleType?.data?.type?.toString() || '',
    );
    await deleteTaxonomy(api, baseUrl, session?.token, taxonomyId);
    await api.dispose();
  }
});
