const { test, expect, request } = require('@playwright/test');
const crypto = require('crypto');
const zlib = require('zlib');
const {
  loginTenantAdmin: loginTenantAdminWithRequiredCredentials,
} = require('./support/tenant_admin_auth');
const { selectDropdownOption } = require('./support/semantic_dropdown');
const {
  installFailureCollectors,
  summarizeCriticalBrowserFailures,
} = require('./support/browser_failure_collectors');
const {
  cleanupOnboardedAccount,
  cleanupOnboardedAccounts,
} = require('./support/account_onboarding_cleanup');
const {
  createFreshAuthenticatedTenantAdminPage,
} = require('./support/tenant_admin_seeded_session');

const tenantUrl = process.env.NAV_TENANT_URL;
const appBootTimeoutMs = 90000;
const apiRequestTimeoutMs = 30000;
const navigationRunId = (process.env.NAV_TEST_RUN_ID || 'local').trim();
const publicAgendaUiPageSize = 10;
const fallbackFixtureImageBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAADIElEQVR4nO3UIQEAIBDAwI9AZWKRDmIgduL81GadfYGm+R0A/GMAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEPYAluQiSDn9lCoAAAAASUVORK5CYII=';
let generatedFixtureImageBuffer = null;
let anonymousIdentityToken = null;

test.describe.configure({ timeout: 300000 });

function requireTenantUrl() {
  expect(
    tenantUrl,
    'Missing NAV_TENANT_URL. Event occurrence mutation suite requires a live tenant URL.',
  ).toBeTruthy();
  return tenantUrl;
}

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
}

function buildApiUrl(baseUrl, pathName) {
  return new URL(pathName, baseUrl).toString();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function createFixturePngBuffer() {
  const width = 1024;
  const height = 768;
  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel + 1;
  const raw = Buffer.alloc(stride * height);

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * stride;
    raw[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = rowOffset + 1 + x * bytesPerPixel;
      raw[offset] = 32 + Math.floor((x / width) * 160);
      raw[offset + 1] = 96 + Math.floor((y / height) * 96);
      raw[offset + 2] =
        180 - Math.floor(((x + y) / (width + height)) * 80);
      raw[offset + 3] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND'),
  ]);
}

function generatedFixtureImage() {
  if (!generatedFixtureImageBuffer) {
    generatedFixtureImageBuffer = createFixturePngBuffer();
  }
  return generatedFixtureImageBuffer;
}

function fixtureImagePayload() {
  return {
    name: 'belluga-navigation-fixture.png',
    mimeType: 'image/png',
    buffer: generatedFixtureImage(),
  };
}

function formatOccurrenceDateLabel(value) {
  const date = new Date(value);
  expect(Number.isNaN(date.getTime()), `Invalid occurrence date ${value}`).toBe(
    false,
  );
  return `${String(date.getUTCDate()).padStart(2, '0')}/${String(
    date.getUTCMonth() + 1,
  ).padStart(2, '0')}`;
}

function formatOccurrenceTimeLabel(value) {
  const date = new Date(value);
  expect(Number.isNaN(date.getTime()), `Invalid occurrence time ${value}`).toBe(
    false,
  );
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(
    date.getUTCMinutes(),
  ).padStart(2, '0')}`;
}

function formatOccurrenceWeekdayLabel(value) {
  const date = new Date(value);
  expect(
    Number.isNaN(date.getTime()),
    `Invalid occurrence weekday date ${value}`,
  ).toBe(false);
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'short',
    timeZone: 'UTC',
  }).format(date);
}

function formatAgendaOccurrenceMetaLabel(occurrence) {
  const startValue = occurrence?.date_time_start || occurrence?.dateTimeStart;
  const endValue = occurrence?.date_time_end || occurrence?.dateTimeEnd;
  const weekday = formatOccurrenceWeekdayLabel(startValue);
  const day = formatOccurrenceDateLabel(startValue).split('/')[0];
  const startTime = formatOccurrenceTimeLabel(startValue);
  if (!endValue) {
    return `${weekday}, ${day} • ${startTime}`.toUpperCase();
  }

  const start = new Date(startValue);
  const end = new Date(endValue);
  expect(Number.isNaN(start.getTime()), `Invalid occurrence start ${startValue}`).toBe(
    false,
  );
  expect(Number.isNaN(end.getTime()), `Invalid occurrence end ${endValue}`).toBe(
    false,
  );

  const sameDay =
    start.getUTCFullYear() === end.getUTCFullYear() &&
    start.getUTCMonth() === end.getUTCMonth() &&
    start.getUTCDate() === end.getUTCDate();
  const endTime = formatOccurrenceTimeLabel(endValue);
  if (sameDay) {
    return `${weekday}, ${day} • ${startTime} - ${endTime}`.toUpperCase();
  }

  const endWeekday = formatOccurrenceWeekdayLabel(endValue);
  const endDay = formatOccurrenceDateLabel(endValue).split('/')[0];
  return `${weekday}, ${day} • ${startTime} - ${endWeekday}, ${endDay} • ${endTime}`.toUpperCase();
}

function formatAdminOccurrenceDateTimeLabel(value) {
  const date = new Date(value);
  expect(
    Number.isNaN(date.getTime()),
    `Invalid admin occurrence datetime ${value}`,
  ).toBe(false);
  return `${String(date.getDate()).padStart(2, '0')}/${String(
    date.getMonth() + 1,
  ).padStart(2, '0')}/${date.getFullYear()} ${String(
    date.getHours(),
  ).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function anonymousFingerprintHash(baseUrl) {
  return crypto
    .createHash('sha256')
    .update(`event-occurrences:${baseUrl}:${navigationRunId}`)
    .digest('hex');
}

async function assertNoBrowserFailures(
  collectors,
  {
    allowedConsoleErrorSubstrings = [],
    allowedResponseStatuses,
  } = {},
) {
  const summary = summarizeCriticalBrowserFailures(collectors, {
    allowedConsoleErrorSubstrings,
    allowedResponseStatuses,
    allowedRateLimitedResponseSubstrings: [
      '/api/v1/media/',
      'ingest.sentry.io',
      '/envelope/',
    ],
  });
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

function logStep(flow, message) {
  console.log(`[event-occurrences][${flow}] ${message}`);
}

const adminEventEditRoutePattern = /\/admin\/events\/[^/]+\/edit(?:\?.*)?$/;

async function logAdminEventsListResponse(flow, response, note = '') {
  try {
    const payload = await response.json();
    const titles = Array.isArray(payload?.data)
      ? payload.data
          .slice(0, 5)
          .map((row) => row?.title?.toString() || '<sem-titulo>')
      : [];
    logStep(
      flow,
      `admin list response${note ? ` (${note})` : ''}: ${titles.join(' | ') || '<empty>'}`,
    );
  } catch (error) {
    logStep(
      flow,
      `admin list response${note ? ` (${note})` : ''} failed to parse: ${String(error)}`,
    );
  }
}

const multiOccurrenceNavigationMatrix = [
  {
    id: 'NAV-01',
    title: 'Agenda card opens selected occurrence URL',
    proof:
      'Public agenda card navigation must include the selected occurrence query parameter.',
  },
  {
    id: 'NAV-02',
    title: 'Programação date selector switches selected occurrence',
    proof:
      'Tapping another date inside Programação must update the occurrence query, keep the current date-only selector contract, and swap selected-date content or empty state without the old Atual badge.',
  },
  {
    id: 'NAV-03',
    title: 'No-programming event falls back to Sobre',
    proof:
      'An event with no programming anywhere must not expose Programação and a direct tab=programming request must land on Sobre.',
  },
  {
    id: 'NAV-04',
    title: 'Public Datas tab is absent',
    proof:
      'The old public Datas tab/section must not render; multi-date navigation belongs inside Programação when applicable.',
  },
  {
    id: 'NAV-05',
    title: 'Programação card renders participants',
    proof:
      'Programação cards must show time plus resolved Account Profile participant chips, and participant-only items must not fabricate fallback title text.',
  },
  {
    id: 'NAV-06',
    title: 'Programação location opens Map POI',
    proof:
      'A programação item location must render from an Account Profile/Map POI reference and navigate to the corresponding map POI.',
  },
  {
    id: 'NAV-07',
    title: 'Programação item without location has no map affordance',
    proof:
      'A programação card without a valid location must still render content without an empty location row or dead map CTA.',
  },
  {
    id: 'NAV-08',
    title: 'Como Chegar renders default event location only',
    proof:
      'Como Chegar must preserve the default event location and avoid empty programação-location rows when no item location exists.',
  },
  {
    id: 'NAV-09',
    title: 'Como Chegar includes programação item locations',
    proof:
      'Como Chegar must list default event location plus programação item Account Profile/POI locations.',
  },
  {
    id: 'NAV-10',
    title: 'Como Chegar de-duplicates repeated locations',
    proof:
      'Repeated programação items using the same Account Profile/POI must render one destination row.',
  },
  {
    id: 'NAV-11',
    title: 'Direct Programação tab opens selected programmed occurrence',
    proof:
      'A direct occurrence URL with tab=programming must open Programação for that occurrence, with fallback to Sobre when no programming exists anywhere.',
  },
  {
    id: 'NAV-12',
    title: 'Selected no-programming occurrence shows empty Programação state',
    proof:
      'When another occurrence has programming, a selected occurrence without items must stay selected and show the empty state instead of sibling content.',
  },
  {
    id: 'NAV-13',
    title: 'Tenant-admin Events list is occurrence-first',
    proof:
      'An event whose first occurrence ended but later occurrence is future must remain visible in the real admin Events list and open the Event edit context.',
  },
  {
    id: 'NAV-14',
    title: 'Occurrence cards exclude sibling occurrence profiles',
    proof:
      'Public occurrence-first cards may include event-level profiles but must not leak profiles from sibling occurrences.',
  },
  {
    id: 'NAV-15',
    title: 'Programação items use occurrence-owned profile references',
    proof:
      'Programação item payload and rendering must use profiles linked to the selected occurrence.',
  },
  {
    id: 'NAV-16',
    title: 'Root Programação remains scoped to first occurrence after second date',
    proof:
      'Programação authored while the event had one occurrence must move into the first occurrence only after adding another date.',
  },
  {
    id: 'NAV-17',
    title: 'Cleared Programação location remains cleared after save',
    proof:
      'A Programação item location cleared in the editor must remain absent after saving and reopening the event.',
  },
  {
    id: 'NAV-18',
    title: 'Shared participant chips keep avatar/icon and no overflow',
    proof:
      'Long participant chips must keep the visual affordance intact without leaking outside pill bounds.',
  },
  {
    id: 'NAV-19',
    title: 'Programação date selector follows the approved compact contract',
    proof:
      'Date selector must keep the date+weekday compact contract with horizontal behavior when needed and no legacy Atual/time affordances.',
  },
  {
    id: 'NAV-20',
    title: 'Programação cards handle optional content combinations',
    proof:
      'Profiles-only, title-only, title+profiles, and location combinations must render without fallback-title or placeholder regressions.',
  },
  {
    id: 'NAV-21',
    title: 'Como Chegar uses primary plus complementary related locations',
    proof:
      'Default location stays primary, additional distinct programação locations become complementary cards, and the complementary heading is conditional.',
  },
  {
    id: 'NAV-22',
    title: 'Single-occurrence public events still expose Programação',
    proof:
      'A single-occurrence event with programação must keep the Programação tab/content without inventing a date selector.',
  },
  {
    id: 'NAV-23',
    title: 'Single-occurrence admin programação is absorbed after second date',
    proof:
      'While the event has one occurrence the root form edits programação directly, and after a second date is added the preserved programação moves into the first occurrence editor only.',
  },
];

const multiOccurrenceNavigationMatrixById = new Map(
  multiOccurrenceNavigationMatrix.map((item) => [item.id, item]),
);
const executedMultiOccurrenceNavigationIds = new Set();

function resetMultiOccurrenceNavigationEvidence() {
  executedMultiOccurrenceNavigationIds.clear();
}

function annotateMultiOccurrenceNavigationMatrix() {
  const info = test.info();
  for (const item of multiOccurrenceNavigationMatrix) {
    info.annotations.push({
      type: item.id,
      description: `${item.title}: ${item.proof}`,
    });
  }
}

async function navStep(id, callback) {
  const item = multiOccurrenceNavigationMatrixById.get(id);
  expect(item, `Unknown multi-occurrence navigation matrix id ${id}`).toBeTruthy();
  return test.step(`${id} ${item.title}`, async () => {
    executedMultiOccurrenceNavigationIds.add(id);
    return callback();
  });
}

async function assertAllMultiOccurrenceNavigationStepsExecuted() {
  await test.step('NAV matrix execution coverage', async () => {
    const missingIds = multiOccurrenceNavigationMatrix
      .map((item) => item.id)
      .filter((id) => !executedMultiOccurrenceNavigationIds.has(id));
    expect(
      missingIds,
      'Every declared NAV matrix item must be backed by an executed navigation assertion.',
    ).toEqual([]);
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
  const a11yButton = page.getByRole('button', { name: /Enable accessibility/i });
  const placeholder = page
    .locator('flt-semantics-placeholder[aria-label="Enable accessibility"]')
    .first();

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

async function createApiContext(baseUrl) {
  return request.newContext({
    baseURL: baseUrl,
    extraHTTPHeaders: {
      Accept: 'application/json',
    },
    ignoreHTTPSErrors: true,
  });
}

async function resolveAnonymousIdentityToken(api, baseUrl) {
  if (anonymousIdentityToken) {
    return anonymousIdentityToken;
  }

  const response = await api.post(
    buildApiUrl(baseUrl, '/api/v1/anonymous/identities'),
    {
      headers: { Accept: 'application/json' },
      data: {
        device_name: 'playwright-event-occurrence-mutation',
        fingerprint: {
          hash: anonymousFingerprintHash(baseUrl),
          user_agent: 'playwright-event-occurrence-mutation',
          locale: 'pt-BR',
        },
        metadata: {
          source: 'web_navigation_event_occurrences',
        },
      },
    },
  );
  expect(
    [200, 201],
    `Anonymous tenant identity bootstrap must succeed before public event API proof. Status ${response.status()}`,
  ).toContain(response.status());
  const payload = await response.json();
  anonymousIdentityToken = payload?.data?.token?.toString().trim() || '';
  expect(
    anonymousIdentityToken,
    'Anonymous tenant identity bootstrap must return data.token.',
  ).toBeTruthy();
  return anonymousIdentityToken;
}

async function tenantPublicAuthHeaders(api, baseUrl, description) {
  const token = await resolveAnonymousIdentityToken(api, baseUrl);
  expect(token, `${description} requires anonymous tenant bearer token.`).toBeTruthy();
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

async function loginTenantAdmin(api, baseUrl) {
  return loginTenantAdminWithRequiredCredentials({
    api,
    baseUrl,
    buildUrl: buildApiUrl,
    deviceName: 'playwright-event-occurrence-mutation',
  });
}

async function seedFlutterSecureStorageEntries(context, entries) {
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
    { entries },
  );
}

async function seedFlutterSecureStorage(context, session) {
  await seedFlutterSecureStorageEntries(context, {
    landlord_token: session.token,
    landlord_user_id: session.userId,
    active_mode: 'landlord',
  });
}

async function createAuthenticatedTenantAdminPage(browser, session) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
  });
  await seedFlutterSecureStorage(context, session);
  const page = await context.newPage();
  return { context, page };
}

async function createEventType(api, baseUrl, token, uniqueSuffix) {
  const slug = `pw-srd-occ-${uniqueSuffix}`;
  const response = await api.post(
    buildApiUrl(baseUrl, '/admin/api/v1/event_types'),
    {
      data: {
        name: `PW SR-D ${uniqueSuffix}`,
        slug,
        description: 'Playwright SR-D occurrence type',
      },
      headers: authHeaders(token),
    },
  );
  expect(response.status(), 'Event type seed must succeed.').toBe(201);
  const payload = await response.json();
  return payload?.data;
}

async function deleteEventType(api, baseUrl, token, eventTypeId) {
  if (!eventTypeId) {
    return;
  }

  await api.delete(
    buildApiUrl(baseUrl, `/admin/api/v1/event_types/${eventTypeId}`),
    {
      headers: authHeaders(token),
      failOnStatusCode: false,
      timeout: apiRequestTimeoutMs,
    },
  );
}

function candidateId(row) {
  return row?.id?.toString().trim() || '';
}

function dedupeCandidates(rows) {
  const seen = new Set();
  const unique = [];
  for (const row of rows) {
    const id = candidateId(row);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    unique.push(row);
  }
  return unique;
}

async function listAccountProfileCandidates(api, baseUrl, token, type) {
  const url = new URL(
    buildApiUrl(baseUrl, '/admin/api/v1/events/account_profile_candidates'),
  );
  url.searchParams.set('type', type);
  url.searchParams.set('page', '1');
  url.searchParams.set('page_size', '20');
  const response = await api.get(url.toString(), {
    headers: authHeaders(token),
  });
  expect(response.status(), `Tenant-admin ${type} candidates must load.`).toBe(200);
  const payload = await response.json();
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return dedupeCandidates(rows.filter((row) => candidateId(row)));
}

function matchesPoiCapableProfileType(row, { requireEvents = false } = {}) {
  return row?.capabilities?.is_queryable === true
    && row?.capabilities?.is_poi_enabled === true
    && row?.capabilities?.is_reference_location_enabled === true
    && (!requireEvents || row?.capabilities?.has_events === true);
}

async function resolvePoiCapableProfileType(
  api,
  baseUrl,
  token,
  { requireEvents = false } = {},
) {
  const type = `pw-srd-host-${Date.now()}`;
  const createResponse = await api.post(
    buildApiUrl(baseUrl, '/admin/api/v1/account_profile_types'),
    {
      data: {
        type,
        label: 'PW SR-D Host',
        labels: {
          singular: 'PW SR-D Host',
          plural: 'PW SR-D Hosts',
        },
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
  expect(createResponse.status(), 'Fallback SR-D host profile type must be created.')
    .toBe(201);

  return { profileType: type, createdType: type };
}

async function createDedicatedRelatedProfiles(
  api,
  baseUrl,
  token,
  uniqueSuffix,
) {
  const type = `pw-srd-related-${uniqueSuffix}`;
  const createResponse = await api.post(
    buildApiUrl(baseUrl, '/admin/api/v1/account_profile_types'),
    {
      data: {
        type,
        label: `PW SR-D Related ${uniqueSuffix}`,
        labels: {
          singular: `PW SR-D Related ${uniqueSuffix}`,
          plural: `PW SR-D Related ${uniqueSuffix}`,
        },
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
          is_publicly_discoverable: true,
          is_favoritable: true,
          is_poi_enabled: true,
          is_reference_location_enabled: true,
          has_bio: false,
          has_content: false,
          has_taxonomies: false,
          has_avatar: true,
          has_cover: true,
          has_events: true,
          has_nested_profile_groups: false,
        },
      },
      headers: authHeaders(token),
    },
  );
  const createPayload = await createResponse.json().catch(async () => ({
    raw: await createResponse.text().catch(() => ''),
  }));
  expect(
    createResponse.status(),
    `Dedicated related profile type ${type} must be created. Response: ${JSON.stringify(createPayload)}`,
  ).toBe(201);

  const createdAccountSlugs = [];
  const createdProfileIds = [];
  const names = [
    `PW SR-D Banda Alpha ${uniqueSuffix}`,
    `PW SR-D Banda Beta ${uniqueSuffix}`,
    `PW SR-D Expo Gamma ${uniqueSuffix}`,
    `PW SR-D Expo Delta ${uniqueSuffix}`,
  ];
  const candidates = [];

  for (const name of names) {
    const createdProfile = await createNearbyPhysicalHost(
      api,
      baseUrl,
      token,
      type,
      name,
    );
    createdAccountSlugs.push(createdProfile.accountSlug);
    createdProfileIds.push(createdProfile.id);
    candidates.push(createdProfile);
  }

  return {
    candidates,
    createdAccountSlugs,
    createdProfileIds,
    createdType: type,
  };
}

async function ensurePhysicalHostCandidates(api, baseUrl, token, minimum = 1) {
  const createdProfileIds = [];
  const createdAccountSlugs = [];
  const normalizedMinimum = Math.max(minimum, 1);

  const profileTypeSeed = await resolvePoiCapableProfileType(
    api,
    baseUrl,
    token,
  );
  const seededCandidates = [];

  for (let index = 0; index < normalizedMinimum; index += 1) {
    const createdHost = await createNearbyPhysicalHost(
      api,
      baseUrl,
      token,
      profileTypeSeed.profileType,
      `PW SR-D Auto Host ${Date.now()}-${index + 1}`,
    );
    createdProfileIds.push(createdHost.id);
    createdAccountSlugs.push(createdHost.accountSlug);
    seededCandidates.push(createdHost);
  }

  expect(
    seededCandidates.length,
    `Event occurrence mutation seed requires at least ${normalizedMinimum} physical host candidate(s).`,
  ).toBeGreaterThanOrEqual(normalizedMinimum);

  return {
    candidates: seededCandidates,
    createdProfileIds,
    createdAccountSlugs,
    createdType: profileTypeSeed.createdType,
  };
}

async function createNearbyPhysicalHost(api, baseUrl, token, profileType, name) {
  const response = await api.post(
    buildApiUrl(baseUrl, '/admin/api/v1/account_onboardings'),
    {
      data: {
        name,
        ownership_state: 'unmanaged',
        profile_type: profileType,
        location: {
          lat: -20.671339,
          lng: -40.495395,
        },
      },
      headers: authHeaders(token),
    },
  );
  expect(response.status(), 'Nearby physical host onboarding must succeed.')
    .toBe(201);

  const payload = await response.json();
  const data = payload?.data || {};
  const account = data?.account || {};
  const profile = data?.account_profile || {};
  const profileId = profile?.id?.toString() || '';
  expect(profileId, 'Nearby physical host seed must return a profile id.')
    .toBeTruthy();
  return {
    id: profileId,
    accountSlug: account?.slug?.toString() || '',
    display_name: profile?.display_name?.toString() || name,
  };
}

async function deleteAccountProfileType(api, baseUrl, token, profileType) {
  if (!profileType) {
    return;
  }

  await api.delete(
    buildApiUrl(
      baseUrl,
      `/admin/api/v1/account_profile_types/${encodeURIComponent(profileType)}`,
    ),
    {
      headers: authHeaders(token),
      failOnStatusCode: false,
      timeout: apiRequestTimeoutMs,
    },
  );
}

async function uploadAccountProfileFixtureMedia(api, baseUrl, token, profileId) {
  const response = await api.post(
    buildApiUrl(baseUrl, `/admin/api/v1/account_profiles/${profileId}`),
    {
      headers: authHeaders(token),
      multipart: {
        _method: 'PATCH',
        avatar: {
          name: fixtureImagePayload().name,
          mimeType: fixtureImagePayload().mimeType,
          buffer: fixtureImagePayload().buffer,
        },
        cover: {
          name: fixtureImagePayload().name,
          mimeType: fixtureImagePayload().mimeType,
          buffer: fixtureImagePayload().buffer,
        },
      },
    },
  );
  const payload = await response.json().catch(async () => ({
    raw: await response.text().catch(() => ''),
  }));
  expect(
    response.status(),
    `Fixture media upload must succeed for account profile ${profileId}. Response: ${JSON.stringify(payload)}`,
  ).toBe(200);
  return payload?.data || {};
}

async function fetchRelatedAccountProfileCandidates(
  api,
  baseUrl,
  token,
  { minimum = 2, excludeIds = [] } = {},
) {
  const createdProfileIds = [];
  const createdAccountSlugs = [];
  const excluded = new Set(excludeIds.filter(Boolean));
  const normalizedMinimum = Math.max(minimum, 1);

  const profileTypeSeed = await resolvePoiCapableProfileType(
    api,
    baseUrl,
    token,
    { requireEvents: true },
  );
  const seededCandidates = [];

  for (let index = 0; seededCandidates.length < normalizedMinimum; index += 1) {
    const createdProfile = await createNearbyPhysicalHost(
      api,
      baseUrl,
      token,
      profileTypeSeed.profileType,
      `PW SR-D Related Profile ${Date.now()}-${index + 1}`,
    );
    createdProfileIds.push(createdProfile.id);
    createdAccountSlugs.push(createdProfile.accountSlug);
    if (!excluded.has(createdProfile.id)) {
      seededCandidates.push(createdProfile);
    }
  }

  expect(
    seededCandidates.length,
    'Event occurrence runtime proof requires at least two related profile candidates.',
  ).toBeGreaterThanOrEqual(normalizedMinimum);

  return {
    candidates: seededCandidates,
    createdProfileIds,
    createdAccountSlugs,
    createdType: profileTypeSeed.createdType,
  };
}

async function createSingleOccurrenceEvent(
  api,
  baseUrl,
  token,
  { eventType, physicalHost, uniqueSuffix },
) {
  const firstStart = new Date(Date.now() + 45 * 60 * 1000);
  const firstEnd = new Date(firstStart.getTime() + 2 * 60 * 60 * 1000);
  const response = await api.post(
    buildApiUrl(baseUrl, '/admin/api/v1/events'),
    {
      data: {
        title: `PW SR-D Occurrence ${uniqueSuffix}`,
        content: '<p>Playwright SR-D multi-occurrence detail.</p>',
        type: {
          id: eventType.id,
          name: eventType.name,
          slug: eventType.slug,
          description: eventType.description || 'Playwright SR-D type',
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
            date_time_start: firstStart.toISOString(),
            date_time_end: firstEnd.toISOString(),
          },
        ],
        publication: {
          status: 'published',
          publish_at: new Date(Date.now() - 60 * 1000).toISOString(),
        },
      },
      headers: authHeaders(token),
    },
  );
  const payload = await response.json().catch(async () => ({
    raw: await response.text().catch(() => ''),
  }));
  expect(
    response.status(),
    `Single-occurrence event seed must succeed. Response: ${JSON.stringify(payload)}`,
  ).toBe(201);
  return payload?.data;
}

async function createOccurrenceProfileGroup(
  api,
  baseUrl,
  token,
  { eventId, occurrenceId, label, assertionLabel },
) {
  const response = await api.post(
    buildApiUrl(
      baseUrl,
      `/admin/api/v1/events/${eventId}/occurrences/${occurrenceId}/profile_groups`,
    ),
    {
      data: {
        label,
      },
      headers: authHeaders(token),
    },
  );
  const payload = await response.json().catch(async () => ({
    raw: await response.text().catch(() => ''),
  }));
  expect(
    response.status(),
    `${assertionLabel} must succeed. Response: ${JSON.stringify(payload)}`,
  ).toBe(201);
  const groups = Array.isArray(payload?.data?.profile_groups)
    ? payload.data.profile_groups
    : [];
  const createdGroup =
    groups.find((group) => group?.label === label) || groups.at(-1) || null;
  const groupId = createdGroup?.id?.toString() || '';
  expect(
    groupId,
    `${assertionLabel} must return a canonical group id.`,
  ).toBeTruthy();
  return {
    data: payload?.data || null,
    groupId,
  };
}

function occurrenceUpdatePayload(occurrence, overrides = {}) {
  const payload = {
    occurrence_id: occurrence?.occurrence_id?.toString() || '',
    date_time_start:
      occurrence?.date_time_start ||
      occurrence?.dateTimeStart ||
      occurrence?.start_at ||
      occurrence?.starts_at ||
      null,
    date_time_end:
      occurrence?.date_time_end ||
      occurrence?.dateTimeEnd ||
      occurrence?.end_at ||
      occurrence?.ends_at ||
      null,
    ...overrides,
  };
  const occurrenceSlug = occurrence?.occurrence_slug?.toString() || '';
  if (occurrenceSlug) {
    payload.occurrence_slug = occurrenceSlug;
  }
  return payload;
}

async function patchEventOccurrences(
  api,
  baseUrl,
  token,
  eventId,
  occurrences,
  assertionLabel,
) {
  const response = await api.patch(
    buildApiUrl(baseUrl, `/admin/api/v1/events/${eventId}`),
    {
      data: {
        occurrences,
      },
      headers: authHeaders(token),
    },
  );
  const payload = await response.json().catch(async () => ({
    raw: await response.text().catch(() => ''),
  }));
  expect(
    response.status(),
    `${assertionLabel} must succeed. Response: ${JSON.stringify(payload)}`,
  ).toBeLessThan(400);
  return payload?.data;
}

async function createSingleOccurrenceProgrammedEvent(
  api,
  baseUrl,
  token,
  {
    eventType,
    physicalHost,
    relatedProfiles,
    uniqueSuffix,
    onCreatedEventId = null,
  },
) {
  const occurrenceParty = relatedProfiles[1] || relatedProfiles[0];
  expect(
    occurrenceParty?.id,
    'Single-occurrence programmed seed requires one related profile candidate.',
  ).toBeTruthy();

  const firstStart = new Date(Date.now() + 50 * 60 * 1000);
  const firstEnd = new Date(firstStart.getTime() + 75 * 60 * 1000);
  const response = await api.post(
    buildApiUrl(baseUrl, '/admin/api/v1/events'),
    {
      data: {
        title: `PW SR-D Programacao Single ${uniqueSuffix}`,
        content: '<p>Playwright SR-D single-occurrence programacao detail.</p>',
        type: {
          id: eventType.id,
          name: eventType.name,
          slug: eventType.slug,
          description: eventType.description || 'Playwright SR-D type',
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
            date_time_start: firstStart.toISOString(),
            date_time_end: firstEnd.toISOString(),
          },
        ],
        publication: {
          status: 'published',
          publish_at: new Date(Date.now() - 60 * 1000).toISOString(),
        },
      },
      headers: authHeaders(token),
    },
  );
  const responseBody = await response.json().catch(async () => ({
    raw: await response.text().catch(() => ''),
  }));
  expect(
    response.status(),
    `Single-occurrence programmed event seed must succeed. Response: ${JSON.stringify(responseBody)}`,
  ).toBe(201);
  const data = responseBody?.data;
  expect(
    data?.occurrences || [],
    'Single-occurrence programmed event must return one occurrence.',
  ).toHaveLength(1);
  const eventId = data?.event_id?.toString() || '';
  const occurrenceId = data?.occurrences?.[0]?.occurrence_id?.toString() || '';
  expect(eventId, 'Single-occurrence programmed event must return event_id.').toBeTruthy();
  expect(
    occurrenceId,
    'Single-occurrence programmed event must return occurrence_id for canonical member patching.',
  ).toBeTruthy();
  if (typeof onCreatedEventId === 'function') {
    onCreatedEventId(eventId);
  }
  const createdGroup = await createOccurrenceProfileGroup(api, baseUrl, token, {
    eventId,
    occurrenceId,
    label: 'Participantes',
    assertionLabel:
      'Single-occurrence programmed event must create the canonical occurrence group head through the dedicated endpoint',
  });
  const groupMembersResponse = await api.patch(
    buildApiUrl(
      baseUrl,
      `/admin/api/v1/events/${eventId}/occurrences/${occurrenceId}/profile_groups/${createdGroup.groupId}/members`,
    ),
    {
      data: {
        add_ids: [occurrenceParty.id],
      },
      headers: authHeaders(token),
    },
  );
  expect(
    groupMembersResponse.status(),
    'Single-occurrence programmed event must patch canonical group members.',
  ).toBeLessThan(400);
  const updatedData = await patchEventOccurrences(
    api,
    baseUrl,
    token,
    eventId,
    [
      occurrenceUpdatePayload(data?.occurrences?.[0], {
        programming_items: [
          {
            time: '17:00',
            title: null,
            account_profile_ids: [occurrenceParty.id],
          },
        ],
      }),
    ],
    'Single-occurrence programmed event must persist programming items after the dedicated occurrence-group cutover',
  );
  return {
    data: updatedData || data,
    occurrenceParty,
  };
}

async function createProgrammedMultiOccurrenceEvent(
  api,
  baseUrl,
  token,
  {
    eventType,
    physicalHost,
    programmingHost,
    relatedProfiles,
    uniqueSuffix,
    onCreatedEventId = null,
  },
) {
  const eventParty = relatedProfiles[0];
  const occurrenceParty = relatedProfiles[1];
  const firstStart = new Date(Date.now() + 55 * 60 * 1000);
  const firstEnd = new Date(firstStart.getTime() + 60 * 60 * 1000);
  const secondStart = new Date(firstStart.getTime() + 24 * 60 * 60 * 1000);
  const secondEnd = new Date(secondStart.getTime() + 90 * 60 * 1000);
  const response = await api.post(
    buildApiUrl(baseUrl, '/admin/api/v1/events'),
    {
      data: {
        title: `PW SR-D Programacao ${uniqueSuffix}`,
        content: '<p>Playwright SR-D programacao detail.</p>',
        type: {
          id: eventType.id,
          name: eventType.name,
          slug: eventType.slug,
          description: eventType.description || 'Playwright SR-D type',
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
            date_time_start: firstStart.toISOString(),
            date_time_end: firstEnd.toISOString(),
          },
          {
            date_time_start: secondStart.toISOString(),
            date_time_end: secondEnd.toISOString(),
          },
        ],
        publication: {
          status: 'published',
          publish_at: new Date(Date.now() - 60 * 1000).toISOString(),
        },
      },
      headers: authHeaders(token),
    },
  );
  const responseBody = await response.json().catch(async () => ({
    raw: await response.text().catch(() => ''),
  }));
  expect(
    response.status(),
    `Programmed multi-occurrence event seed must succeed. Response: ${JSON.stringify(responseBody)}`,
  )
    .toBe(201);
  const data = responseBody?.data;
  expect(data?.event_id?.toString(), 'Programmed event must return event_id.')
    .toBeTruthy();
  expect(data?.occurrences || [], 'Programmed event must return two occurrences.')
    .toHaveLength(2);
  const eventId = data?.event_id?.toString() || '';
  const firstOccurrenceId = data?.occurrences?.[0]?.occurrence_id?.toString() || '';
  const secondOccurrenceId = data?.occurrences?.[1]?.occurrence_id?.toString() || '';
  expect(
    firstOccurrenceId,
    'Programmed event first occurrence must return occurrence_id for canonical member patching.',
  ).toBeTruthy();
  expect(
    secondOccurrenceId,
    'Programmed event second occurrence must return occurrence_id for canonical member patching.',
  ).toBeTruthy();
  if (typeof onCreatedEventId === 'function') {
    onCreatedEventId(eventId);
  }
  const firstCreatedGroup = await createOccurrenceProfileGroup(
    api,
    baseUrl,
    token,
    {
      eventId,
      occurrenceId: firstOccurrenceId,
      label: 'Participantes',
      assertionLabel:
        'Programmed event first occurrence must create the canonical group head through the dedicated endpoint',
    },
  );
  const secondCreatedGroup = await createOccurrenceProfileGroup(
    api,
    baseUrl,
    token,
    {
      eventId,
      occurrenceId: secondOccurrenceId,
      label: 'Participantes',
      assertionLabel:
        'Programmed event second occurrence must create the canonical group head through the dedicated endpoint',
    },
  );
  const firstGroupResponse = await api.patch(
    buildApiUrl(
      baseUrl,
      `/admin/api/v1/events/${eventId}/occurrences/${firstOccurrenceId}/profile_groups/${firstCreatedGroup.groupId}/members`,
    ),
    {
      data: {
        add_ids: [eventParty.id],
      },
      headers: authHeaders(token),
    },
  );
  expect(
    firstGroupResponse.status(),
    'Programmed event first occurrence must patch canonical group members.',
  ).toBeLessThan(400);
  const secondGroupResponse = await api.patch(
    buildApiUrl(
      baseUrl,
      `/admin/api/v1/events/${eventId}/occurrences/${secondOccurrenceId}/profile_groups/${secondCreatedGroup.groupId}/members`,
    ),
    {
      data: {
        add_ids: [eventParty.id, occurrenceParty.id],
      },
      headers: authHeaders(token),
    },
  );
  expect(
    secondGroupResponse.status(),
    'Programmed event second occurrence must patch canonical group members.',
  ).toBeLessThan(400);
  const updatedData = await patchEventOccurrences(
    api,
    baseUrl,
    token,
    eventId,
    [
      occurrenceUpdatePayload(data?.occurrences?.[0]),
      occurrenceUpdatePayload(data?.occurrences?.[1], {
        programming_items: [
          {
            time: '13:00',
            title: 'Atividade sem local',
            account_profile_ids: [],
          },
          {
            time: '17:00',
            title: null,
            account_profile_ids: [occurrenceParty.id],
            place_ref: {
              type: 'account_profile',
              id: programmingHost.id,
            },
          },
          {
            time: '18:00',
            title: 'Ensaio no mesmo palco',
            account_profile_ids: [occurrenceParty.id],
            place_ref: {
              type: 'account_profile',
              id: programmingHost.id,
            },
          },
        ],
      }),
    ],
    'Programmed multi-occurrence event must persist programming items after the dedicated occurrence-group cutover',
  );
  return {
    data: updatedData || data,
    eventParty,
    occurrenceParty,
    programmingHost,
  };
}

async function createPastFirstFutureLaterOccurrenceEvent(
  api,
  baseUrl,
  token,
  { eventType, physicalHost, uniqueSuffix },
) {
  const firstStart = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const firstEnd = new Date(firstStart.getTime() + 2 * 60 * 60 * 1000);
  const secondStart = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  const secondEnd = new Date(secondStart.getTime() + 2 * 60 * 60 * 1000);
  const response = await api.post(
    buildApiUrl(baseUrl, '/admin/api/v1/events'),
    {
      data: {
        title: `PW SR-D Future Later ${uniqueSuffix}`,
        content: '<p>Playwright SR-D occurrence-first admin list.</p>',
        type: {
          id: eventType.id,
          name: eventType.name,
          slug: eventType.slug,
          description: eventType.description || 'Playwright SR-D type',
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
            date_time_start: firstStart.toISOString(),
            date_time_end: firstEnd.toISOString(),
          },
          {
            date_time_start: secondStart.toISOString(),
            date_time_end: secondEnd.toISOString(),
          },
        ],
        publication: {
          status: 'published',
          publish_at: new Date(Date.now() - 60 * 1000).toISOString(),
        },
      },
      headers: authHeaders(token),
    },
  );
  expect(response.status(), 'Future-later occurrence event seed must succeed.')
    .toBe(201);
  const payload = await response.json();
  return payload?.data;
}

async function fetchAdminEventsPage(api, baseUrl, token, page) {
  const url = new URL(buildApiUrl(baseUrl, '/admin/api/v1/events'));
  url.searchParams.set('page', page.toString());
  url.searchParams.set('page_size', '20');
  url.searchParams.set('temporal', 'now,future');
  const response = await api.get(url.toString(), {
    headers: authHeaders(token),
  });
  expect(response.status(), `Tenant-admin events page ${page} must load.`).toBe(
    200,
  );
  return response.json();
}

async function locateAdminEventListPage(api, baseUrl, token, eventId) {
  for (let page = 1; page <= 10; page += 1) {
    const payload = await fetchAdminEventsPage(api, baseUrl, token, page);
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    if (rows.some((row) => row?.event_id?.toString() === eventId)) {
      return { page, rowsOnPage: rows.length };
    }
    if (rows.length === 0) {
      break;
    }
  }

  throw new Error(
    `Seeded event ${eventId} was created but was not returned by the tenant-admin events list API.`,
  );
}

async function fetchAdminEvent(api, baseUrl, token, eventId) {
  const response = await api.get(
    buildApiUrl(baseUrl, `/admin/api/v1/events/${eventId}`),
    {
      headers: authHeaders(token),
    },
  );
  expect(response.status(), 'Tenant-admin event readback must succeed.').toBe(
    200,
  );
  const payload = await response.json();
  return payload?.data;
}

async function fetchPublicEvent(api, baseUrl, eventRef, occurrenceId = null) {
  const url = new URL(buildApiUrl(baseUrl, `/api/v1/events/${eventRef}`));
  if (occurrenceId) {
    url.searchParams.set('occurrence', occurrenceId);
  }
  const response = await api.get(url.toString(), {
    headers: await tenantPublicAuthHeaders(
      api,
      baseUrl,
      'Public event detail readback',
    ),
  });
  expect(response.status(), 'Public event detail readback must succeed.').toBe(
    200,
  );
  const payload = await response.json();
  return payload?.data;
}

async function fetchAgendaMatchesForTitle(api, baseUrl, title) {
  const normalizedTitle = title?.toString().trim();
  expect(normalizedTitle, 'Agenda occurrence lookup requires a title.').toBeTruthy();

  const matches = [];
  for (let page = 1; page <= 10; page += 1) {
    const url = new URL(buildApiUrl(baseUrl, '/api/v1/agenda'));
    url.searchParams.set('page', page.toString());
    url.searchParams.set('page_size', publicAgendaUiPageSize.toString());
    const response = await api.get(url.toString(), {
      headers: await tenantPublicAuthHeaders(
        api,
        baseUrl,
        'Public agenda occurrence lookup',
      ),
    });
    expect(response.status(), 'Public agenda occurrence lookup must succeed.').toBe(200);
    const payload = await response.json();
    const rows = Array.isArray(payload?.items)
      ? payload.items
      : Array.isArray(payload?.data)
        ? payload.data
        : [];
    for (const row of rows) {
      if (row?.title?.toString().trim() !== normalizedTitle) {
        continue;
      }
      const occurrenceId = row?.occurrence_id?.toString().trim() || '';
      if (occurrenceId) {
        matches.push({
          occurrenceId,
          row,
          page,
        });
      }
    }
    if (rows.length === 0) {
      break;
    }
  }

  return matches;
}

async function fetchAgendaOccurrenceIdsForTitle(api, baseUrl, title) {
  const matches = await fetchAgendaMatchesForTitle(api, baseUrl, title);
  const occurrenceIds = matches.map((match) => match.occurrenceId);
  return occurrenceIds;
}

async function fetchAgendaOccurrenceIdForTitle(api, baseUrl, title) {
  const matches = await fetchAgendaMatchesForTitle(api, baseUrl, title);
  return matches[0]?.occurrenceId || '';
}

async function fetchAgendaRowsForTitle(api, baseUrl, title) {
  const rowsByOccurrenceId = new Map();
  const matches = await fetchAgendaMatchesForTitle(api, baseUrl, title);
  for (const match of matches) {
    rowsByOccurrenceId.set(match.occurrenceId, match.row);
  }

  return Array.from(rowsByOccurrenceId.values());
}

function stableEventDetailSnapshot(detail) {
  return {
    event_id: detail?.event_id?.toString() || '',
    occurrence_id: detail?.occurrence_id?.toString() || '',
    linked_profile_ids: (detail?.linked_account_profiles || [])
      .map((profile) => profile?.id?.toString() || '')
      .filter(Boolean),
    linked_profiles: (detail?.linked_account_profiles || []).map((profile) => ({
      id: profile?.id?.toString() || '',
      avatar_url: profile?.avatar_url?.toString() || '',
      cover_url: profile?.cover_url?.toString() || '',
    })),
    profile_groups: (detail?.profile_groups || []).map((group) => ({
      id: group?.id?.toString() || '',
      profile_ids: (group?.profiles || [])
        .map((profile) => profile?.id?.toString() || '')
        .filter(Boolean),
      profiles: (group?.profiles || []).map((profile) => ({
        id: profile?.id?.toString() || '',
        avatar_url: profile?.avatar_url?.toString() || '',
        cover_url: profile?.cover_url?.toString() || '',
      })),
    })),
    programming_items: (detail?.programming_items || []).map((item) => ({
      time: item?.time?.toString() || '',
      title: item?.title?.toString() || '',
      linked_profile_ids: (item?.linked_account_profiles || [])
        .map((profile) => profile?.id?.toString() || '')
        .filter(Boolean),
      linked_profiles: (item?.linked_account_profiles || []).map((profile) => ({
        id: profile?.id?.toString() || '',
        avatar_url: profile?.avatar_url?.toString() || '',
        cover_url: profile?.cover_url?.toString() || '',
      })),
      location_profile_id: item?.location_profile?.id?.toString() || '',
      location_profile_avatar_url:
        item?.location_profile?.avatar_url?.toString() || '',
      location_profile_cover_url:
        item?.location_profile?.cover_url?.toString() || '',
    })),
  };
}

function matchesPublicEventDetailResponse(
  candidate,
  baseUrl,
  eventRef,
  occurrenceId = null,
) {
  const method = candidate.request().method().toUpperCase();
  if (method !== 'GET') {
    return false;
  }

  const actual = new URL(candidate.url());
  const expected = new URL(buildApiUrl(baseUrl, `/api/v1/events/${eventRef}`));
  if (actual.origin !== expected.origin || actual.pathname !== expected.pathname) {
    return false;
  }

  return !occurrenceId || actual.searchParams.get('occurrence') === occurrenceId;
}

async function gotoPublicEventDetailAndWaitForHydration(
  page,
  baseUrl,
  pathName,
  {
    eventRef,
    occurrenceId = null,
    title,
    description = 'Public event detail',
  },
) {
  const detailResponsePromise = page.waitForResponse(
    (candidate) =>
      matchesPublicEventDetailResponse(candidate, baseUrl, eventRef, occurrenceId),
    { timeout: appBootTimeoutMs },
  );
  const documentResponse = await page.goto(buildApiUrl(baseUrl, pathName), {
    waitUntil: 'domcontentloaded',
  });
  expect(documentResponse, `${description} document response should be available.`)
    .not.toBeNull();
  expect(documentResponse.status(), `${description} document must load.`)
    .toBeLessThan(400);

  const detailResponse = await detailResponsePromise;
  expect(
    detailResponse.status(),
    `${description} API response must finish before UI assertions and cleanup.`,
  ).toBeGreaterThanOrEqual(200);
  expect(
    detailResponse.status(),
    `${description} API response must finish before UI assertions and cleanup.`,
  ).toBeLessThan(300);

  await assertAppBooted(page);
  await enableAccessibilityIfNeeded(page);
  await expect(page.getByText(new RegExp(escapeRegExp(title))).first())
    .toBeVisible({ timeout: appBootTimeoutMs });
}

async function deleteEvent(api, baseUrl, token, eventId) {
  if (!eventId) {
    return;
  }

  await api.delete(buildApiUrl(baseUrl, `/admin/api/v1/events/${eventId}`), {
    headers: authHeaders(token),
    failOnStatusCode: false,
    timeout: apiRequestTimeoutMs,
  });
}

async function deleteStaleOccurrenceSeedEvents(api, baseUrl, token) {
  for (let pass = 0; pass < 5; pass += 1) {
    const staleEventIds = new Set();
    for (let page = 1; page <= 10; page += 1) {
      const payload = await fetchAdminEventsPage(api, baseUrl, token, page);
      const rows = Array.isArray(payload?.data) ? payload.data : [];
      for (const row of rows) {
        const title = row?.title?.toString().trim() || '';
        const eventId = row?.event_id?.toString().trim() || '';
        if (title.startsWith('PW SR-D ') && eventId) {
          staleEventIds.add(eventId);
        }
      }
      if (rows.length === 0) {
        break;
      }
    }

    if (staleEventIds.size === 0) {
      return;
    }

    for (const eventId of staleEventIds) {
      await deleteEvent(api, baseUrl, token, eventId);
    }
  }
}

async function waitForPersistedOccurrenceId(api, baseUrl, token, eventId) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const detail = await fetchAdminEvent(api, baseUrl, token, eventId);
    const occurrenceId = detail?.occurrences?.[0]?.occurrence_id?.toString() || '';
    if (occurrenceId) {
      return {
        detail,
        occurrenceId,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return {
    detail: null,
    occurrenceId: '',
  };
}

async function scrollToSeededEventTitle(page, uniqueTitle, expectedApiPage) {
  const titlePattern = new RegExp(escapeRegExp(uniqueTitle));
  const candidates = [
    page.getByRole('group', { name: titlePattern }).first(),
    page.getByLabel(titlePattern).first(),
    page.getByText(titlePattern).first(),
  ];
  const listAnchors = page.getByRole('button', { name: /^Editar evento / });
  const maxAttempts = Math.max(24, expectedApiPage * 18);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    for (const candidate of candidates) {
      if (await candidate.isVisible().catch(() => false)) {
        return candidate;
      }
    }

    const anchorCount = await listAnchors.count().catch(() => 0);
    if (anchorCount > 0) {
      const anchor = listAnchors.nth(Math.max(anchorCount - 1, 0));
      await anchor.hover().catch(() => {});
    }
    await page.mouse.wheel(0, 280);
    await page.waitForTimeout(450);
  }

  return null;
}

async function scrollUntilVisible(page, locator, description) {
  const viewport =
    page.viewportSize() ||
    (await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    })));
  await page.mouse.move(viewport.width * 0.62, viewport.height * 0.72);

  for (let attempt = 0; attempt < 24; attempt += 1) {
    if (await locator.isVisible().catch(() => false)) {
      return;
    }
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(250);
  }

  await expect(locator, description).toBeVisible({
    timeout: appBootTimeoutMs,
  });
}

async function waitForLocatorAttached(locator, description) {
  await expect
    .poll(
      async () => (await locator.count().catch(() => 0)) > 0,
      {
        timeout: appBootTimeoutMs,
        message: description,
      },
    )
    .toBe(true);
}

async function programmingLocationTriggerLocator(page) {
  const candidates = [
    page
      .locator(
        'xpath=//*[@flt-semantics-identifier="tenant_admin_programming_location_trigger"]',
      )
      .last(),
    page
      .locator(
        'xpath=//flt-semantics[@flt-semantics-identifier="tenant_admin_programming_location_trigger"]//flt-semantics[@flt-tappable]',
      )
      .last(),
    page
      .locator(
        'xpath=//flt-semantics[contains(@aria-label,"Local da programação")]//flt-semantics[@flt-tappable]',
      )
      .last(),
    page
      .locator('flt-semantics[role="button"]')
      .filter({ hasText: 'Sem local específico' })
      .last(),
    page
      .getByRole('button', { name: 'Salvar item' })
      .locator('xpath=preceding::button[2]')
      .last(),
    page.locator('[aria-label*="Local da programação"]').last(),
    page.locator('[aria-label*="Sem local específico"]').last(),
    page.getByRole('button', { name: /Local da programação/i }).last(),
    page.getByRole('button', { name: /Sem local específico/i }).last(),
    page.getByText('Sem local específico', { exact: true }).last(),
    page
      .getByText('Local da programação (opcional)', { exact: true })
      .locator(
        'xpath=following::*[@role="button" or self::button or self::flt-semantics[@flt-tappable]][1]',
      )
      .last(),
  ];

  const viewport =
    page.viewportSize() ||
    (await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    })));
  await page.mouse.move(viewport.width * 0.62, viewport.height * 0.72).catch(() => {});

  for (let attempt = 0; attempt < 12; attempt += 1) {
    for (const candidate of candidates) {
      if (await candidate.isVisible().catch(() => false)) {
        return candidate;
      }
    }
    await page.mouse.wheel(0, 540).catch(() => {});
    await page.waitForTimeout(150);
  }

  for (const candidate of candidates) {
    if (await candidate.isVisible().catch(() => false)) {
      return candidate;
    }
  }

  for (const candidate of candidates) {
    const count = await candidate.count().catch(() => 0);
    if (count > 0) {
      return candidate;
    }
  }

  return candidates[0];
}

async function revealProgrammingItemActionArea(page) {
  const viewport =
    page.viewportSize() ||
    (await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    })));
  const pointerX = Math.max(420, Math.floor(viewport.width * 0.62));
  const pointerY = Math.max(220, Math.floor(viewport.height * 0.72));

  const triggerSelector =
    'xpath=//*[@flt-semantics-identifier="tenant_admin_programming_location_trigger"]';
  const saveSelector =
    'xpath=//*[@flt-semantics-identifier="tenant_admin_programming_save_button"]';

  await page.mouse.move(pointerX, pointerY).catch(() => {});
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const triggerCount = await page.locator(triggerSelector).count().catch(() => 0);
    const saveCount = await page.locator(saveSelector).count().catch(() => 0);
    if (triggerCount > 0 || saveCount > 0) {
      return;
    }
    await page.mouse.wheel(0, 720).catch(() => {});
    await page.waitForTimeout(150);
  }
}

async function fillProgrammingTitleEditor(page, value) {
  const field = await fillFlutterRichTextField(
    page,
    'Título / copy do item',
    value,
  );
  await page.keyboard.press('Tab').catch(() => {});
  await page.waitForTimeout(150);
  return field;
}

async function fillFlutterTextField(page, label, value) {
  if (label === 'Título / copy do item') {
    return fillProgrammingTitleEditor(page, value);
  }

  let field = page.getByLabel(label).first();
  if ((await field.count().catch(() => 0)) === 0) {
    const labelLocator = page.getByText(label, { exact: true }).first();
    const fallbackCandidates = [
      labelLocator.locator('xpath=following::input[1]'),
      labelLocator.locator('xpath=following::textarea[1]'),
      labelLocator.locator('xpath=following::*[@role="textbox"][1]'),
      page.locator('input').last(),
      page.locator('textarea').last(),
      page.getByRole('textbox').last(),
    ];

    for (const candidate of fallbackCandidates) {
      const count = await candidate.count().catch(() => 0);
      if (count === 0) {
        continue;
      }
      for (let index = count - 1; index >= 0; index -= 1) {
        const entry = candidate.nth(index);
        if (await entry.isVisible().catch(() => false)) {
          field = entry;
          break;
        }
      }
      if (await field.isVisible().catch(() => false)) {
        break;
      }
    }
  }

  const resolvedCount = await field.count().catch(() => 0);
  const resolvedEditable = resolvedCount > 0
    ? await field.isEditable().catch(() => false)
    : false;

  if (resolvedCount === 0 || !resolvedEditable) {
    return fillFlutterRichTextField(page, label, value);
  }

  await field.scrollIntoViewIfNeeded();
  await expect(field).toBeVisible({ timeout: appBootTimeoutMs });

  let lastValue = '';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await field.click();
    const selectAll = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
    await page.keyboard.press(selectAll);
    await page.keyboard.press('Backspace');
    await page.keyboard.type(value, { delay: 5 });

    try {
      await expect
        .poll(
          async () => {
            try {
              return await field.inputValue();
            } catch (_) {
              return '';
            }
          },
          {
            timeout: 3000,
            message: `Expected Flutter text field "${label}" to retain input.`,
          },
        )
        .toBe(value);
      return field;
    } catch (_) {
      try {
        lastValue = await field.inputValue();
      } catch (_) {
        lastValue = '<unreadable>';
      }
      await page.waitForTimeout(150);
    }
  }

  throw new Error(
    `Flutter text field "${label}" did not retain "${value}" before submit; last value was "${lastValue}".`,
  );
}

async function fillFlutterRichTextField(page, label, value) {
  const candidates = [
    page.getByLabel(label).last(),
    page.getByRole('textbox', { name: label }).last(),
    page.locator('.ql-editor[contenteditable="true"]').last(),
    page.locator('.ql-editor').last(),
    page.getByRole('group').last(),
  ];

  let editorBody = candidates[candidates.length - 1];
  for (const candidate of candidates) {
    const count = await candidate.count().catch(() => 0);
    if (count === 0) {
      continue;
    }
    for (let index = count - 1; index >= 0; index -= 1) {
      const entry = candidate.nth(index);
      if (await entry.isVisible().catch(() => false)) {
        editorBody = entry;
        break;
      }
    }
    if (await editorBody.isVisible().catch(() => false)) {
      break;
    }
  }
  await editorBody.scrollIntoViewIfNeeded();
  await expect(editorBody).toBeVisible({ timeout: appBootTimeoutMs });
  const visualEditor = page
    .locator('.ql-editor[contenteditable="true"]')
    .last();
  const editableKind = await editorBody
    .evaluate((node) => {
      if (node instanceof HTMLTextAreaElement) {
        return 'textarea';
      }
      if (node instanceof HTMLInputElement) {
        return 'input';
      }
      if (node instanceof HTMLElement && node.isContentEditable) {
        return 'contenteditable';
      }
      return 'other';
    })
    .catch(() => 'other');

  if (editableKind === 'textarea' || editableKind === 'input') {
    await editorBody.evaluate((node, text) => {
      if (
        !(node instanceof HTMLTextAreaElement) &&
        !(node instanceof HTMLInputElement)
      ) {
        return;
      }
      node.disabled = false;
      node.readOnly = false;
      node.focus();
      node.value = text;
      node.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          data: text,
          inputType: 'insertReplacementText',
        }),
      );
      node.dispatchEvent(new Event('change', { bubbles: true }));
      node.dispatchEvent(new Event('blur', { bubbles: true }));
    }, value);

    await expect
      .poll(
        async () => {
          try {
            return await editorBody.inputValue();
          } catch (_) {
            return '';
          }
        },
        {
          timeout: 3000,
          message: `Expected Flutter rich text field "${label}" semantic textarea to retain input.`,
        },
      )
      .toBe(value);

    const semanticInputReachedEditor = await expect
      .poll(
        async () => {
          const editorText = await visualEditor
            .evaluate((node) => {
              if (!(node instanceof HTMLElement)) {
                return '';
              }
              return node.innerText || node.textContent || '';
            })
            .catch(() => '');
          return editorText.includes(value);
        },
        {
          timeout: 3000,
          message: `Expected Flutter rich text field "${label}" semantic textarea input to update the visible editor.`,
        },
      )
      .toBe(true)
      .then(() => true)
      .catch(() => false);

    if (semanticInputReachedEditor) {
      return visualEditor;
    }

    editorBody = visualEditor;
    await editorBody.scrollIntoViewIfNeeded();
    await expect(editorBody).toBeVisible({ timeout: appBootTimeoutMs });
  }

  await editorBody.focus().catch(() => {});
  await editorBody.click();

  const selectAll = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
  await page.keyboard.press(selectAll).catch(() => {});
  await page.keyboard.press('Backspace').catch(() => {});
  await page.keyboard.type(value, { delay: 5 });

  let retainedTypedValue = false;
  try {
    await expect
      .poll(
        async () => {
          const editorText = await editorBody
            .evaluate((node) => {
              if (!(node instanceof HTMLElement)) {
                return '';
              }
              return node.innerText || node.textContent || '';
            })
            .catch(() => '');
          return editorText.includes(value);
        },
        {
          timeout: 3000,
          message: `Expected Flutter rich text field "${label}" to retain input.`,
        },
      )
      .toBe(true);
    retainedTypedValue = true;
  } catch (_) {
    retainedTypedValue = false;
  }

  if (!retainedTypedValue) {
    await editorBody.evaluate((node, text) => {
      if (!(node instanceof HTMLElement)) {
        return;
      }
      node.focus();
      node.innerHTML = '';
      const paragraph = document.createElement('p');
      paragraph.textContent = text;
      node.appendChild(paragraph);
      node.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        data: text,
        inputType: 'insertText',
      }));
      node.dispatchEvent(new Event('change', { bubbles: true }));
      node.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Unidentified' }));
      node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Unidentified' }));
    }, value);

    await expect
      .poll(
        async () => {
          const editorText = await editorBody
            .evaluate((node) => {
              if (!(node instanceof HTMLElement)) {
                return '';
              }
              return node.innerText || node.textContent || '';
            })
            .catch(() => '');
          return editorText.includes(value);
        },
        {
          timeout: 3000,
          message: `Expected Flutter rich text field "${label}" to retain input after DOM fallback.`,
        },
      )
      .toBe(true);
  }

  return editorBody;
}

async function listVisibleLocatorEntries(locator) {
  const count = await locator.count().catch(() => 0);
  const visibleEntries = [];

  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    const isVisible = await candidate.isVisible().catch(() => false);
    if (!isVisible) {
      continue;
    }

    const box = await candidate.boundingBox().catch(() => null);
    if (!box) {
      continue;
    }

    visibleEntries.push({ index, box });
  }

  return visibleEntries;
}

async function waitForActiveLocationPickerSearchField(
  page,
  previouslyVisibleIndices,
  message,
  timeout,
) {
  const searchFields = page.getByRole('textbox', {
    name: /Buscar local/i,
  });
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const visibleEntries = await listVisibleLocatorEntries(searchFields);
    const newlyVisibleEntries = visibleEntries.filter(
      ({ index }) => !previouslyVisibleIndices.has(index),
    );
    const activeEntry =
      newlyVisibleEntries[newlyVisibleEntries.length - 1] ||
      visibleEntries[visibleEntries.length - 1] ||
      null;

    if (activeEntry) {
      return searchFields.nth(activeEntry.index);
    }

    await page.waitForTimeout(150);
  }

  throw new Error(message);
}

async function waitForLocationPickerOptionNearField(
  page,
  activeSearchField,
  optionText,
  timeout = appBootTimeoutMs,
) {
  const optionCandidates = page.getByRole('button', {
    name: new RegExp(escapeRegExp(optionText), 'i'),
  });
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const searchFieldBox =
      await activeSearchField.boundingBox().catch(() => null);
    if (searchFieldBox != null) {
      const visibleOptions = await listVisibleLocatorEntries(optionCandidates);
      const scopedOptions = visibleOptions
        .filter(({ box }) => {
          const overlapsHorizontally =
            box.x <= searchFieldBox.x + searchFieldBox.width &&
            box.x + box.width >= searchFieldBox.x;
          const isBelowSearchField =
            box.y + box.height >= searchFieldBox.y - 12;
          return overlapsHorizontally && isBelowSearchField;
        })
        .sort((left, right) => {
          const verticalDistance =
            Math.abs(left.box.y - searchFieldBox.y) -
            Math.abs(right.box.y - searchFieldBox.y);
          if (verticalDistance !== 0) {
            return verticalDistance;
          }
          return left.box.x - right.box.x;
        });

      const chosenEntry = scopedOptions[0] || visibleOptions[0] || null;
      if (chosenEntry) {
        return optionCandidates.nth(chosenEntry.index);
      }
    }

    await page.waitForTimeout(150);
  }

  throw new Error(
    `Picker option "${optionText}" must become visible near the active location search field.`,
  );
}

async function openLocationPickerFromModalKeyboard(page) {
  await revealProgrammingItemActionArea(page);
  const debugCounts = async () => {
    const selectors = [
      'xpath=//*[@flt-semantics-identifier="tenant_admin_programming_location_trigger"]',
      'xpath=//*[@flt-semantics-identifier="tenant_admin_programming_save_button"]',
      'xpath=//*[@flt-semantics-identifier="tenant_admin_programming_cancel_button"]',
      'xpath=//*[contains(@aria-label,"Local da programação")]',
      'xpath=//*[normalize-space(.)="Salvar item"]',
      'xpath=//*[normalize-space(.)="Cancelar item"]',
      'xpath=//*[normalize-space(.)="Sem local específico"]',
    ];
    const counts = {};
    for (const selector of selectors) {
      counts[selector] = await page.locator(selector).count().catch(() => -1);
    }
    const activeElement = await page
      .evaluate(() => {
        const active = document.activeElement;
        if (!active) {
          return null;
        }
        return {
          tag: active.tagName,
          ariaLabel: active.getAttribute('aria-label'),
          text: active.textContent,
          outerHtml: active.outerHTML?.slice(0, 400) || null,
        };
      })
      .catch(() => null);
    return { counts, activeElement };
  };
  const searchFieldVisible = async () => {
    const candidates = [
      page.getByLabel('Buscar local').last(),
      page.getByPlaceholder('Buscar local').last(),
      page.getByRole('textbox', { name: /Buscar local/i }).last(),
    ];
    for (const candidate of candidates) {
      if (await candidate.isVisible().catch(() => false)) {
        return true;
      }
    }
    return false;
  };

  const focusAnchors = [
    page.getByLabel('Horário de fim (opcional)').last(),
    page.getByLabel('Horário inicial').last(),
    page.getByRole('textbox').first(),
  ];

  for (const anchor of focusAnchors) {
    if ((await anchor.count().catch(() => 0)) === 0) {
      continue;
    }
    try {
      await anchor.focus();
      break;
    } catch (_) {
      // Try the next focusable editor anchor.
    }
  }

  for (let step = 0; step < 18; step += 1) {
    if (await searchFieldVisible()) {
      return;
    }
    await page.keyboard.press('Tab');
    await page.waitForTimeout(75);
    await page.keyboard.press('Space').catch(() => {});
    await page.waitForTimeout(150);
    if (await searchFieldVisible()) {
      return;
    }
    await page.keyboard.press('Enter').catch(() => {});
    await page.waitForTimeout(150);
    if (await searchFieldVisible()) {
      return;
    }
  }

  const debug = await debugCounts();
  console.log(
    `[event-occurrences][evg-admin] modal keyboard fallback debug ${JSON.stringify(debug)}`,
  );

  throw new Error(
    'Location picker search field must become visible during modal keyboard traversal fallback.',
  );
}

async function selectLocationPickerSheetOption(
  page,
  {
    trigger,
    optionText,
    flow = null,
    logStep = null,
  },
) {
  const record = (message) => {
    if (typeof logStep === 'function') {
      logStep(flow, message);
    }
  };
  const visibleSearchFieldIndicesBefore = new Set(
    (
      await listVisibleLocatorEntries(
        page.getByRole('textbox', {
          name: /Buscar local/i,
        }),
      )
    ).map(({ index }) => index),
  );
  let activeSearchField = null;
  const waitForSearchFieldVisible = async (message, timeout) => {
    activeSearchField = await waitForActiveLocationPickerSearchField(
      page,
      visibleSearchFieldIndicesBefore,
      message,
      timeout,
    );
  };

  record(`open picker for ${optionText}`);
  await revealProgrammingItemActionArea(page);
  let triggerCount = 0;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    triggerCount = await trigger.count().catch(() => 0);
    if (triggerCount > 0) {
      break;
    }
    await revealProgrammingItemActionArea(page);
    await page.waitForTimeout(300);
  }
  if (triggerCount == 0) {
    trigger = await programmingLocationTriggerLocator(page);
    triggerCount = await trigger.count().catch(() => 0);
  }
  if (triggerCount == 0) {
    record(
      `picker trigger not directly attached for ${optionText}; using modal keyboard traversal immediately`,
    );
    await openLocationPickerFromModalKeyboard(page);
    await waitForSearchFieldVisible(
      'Location picker search field must become visible after modal keyboard traversal.',
      5000,
    );
    const option = await waitForLocationPickerOptionNearField(
      page,
      activeSearchField,
      optionText,
    );
    record(`select picker option ${optionText}`);
    await option.click();
    return;
  }

  if (triggerCount > 0) {
    await trigger.scrollIntoViewIfNeeded().catch(() => {});
  }
  try {
    if (triggerCount == 0) {
      throw new Error('Programming location trigger is not directly attached.');
    }
    await trigger.click();
    await waitForSearchFieldVisible(
      'Location picker search field must become visible after opening the picker.',
      2000,
    );
  } catch (_clickError) {
    record(
      `picker click did not expose search field for ${optionText}; retrying with Enter`,
    );
    await trigger.focus().catch(() => {});
    try {
      await trigger.press('Enter');
      await waitForSearchFieldVisible(
        'Location picker search field must become visible after retrying the picker with Enter.',
        2000,
      );
    } catch (_enterError) {
      record(
        `picker Enter retry did not expose search field for ${optionText}; retrying with Space`,
      );
      if (triggerCount > 0) {
        await trigger.focus().catch(() => {});
      }
      try {
        if (triggerCount == 0) {
          throw new Error('Programming location trigger is not directly attached.');
        }
        await trigger.press('Space');
        await waitForSearchFieldVisible(
          'Location picker search field must become visible after retrying the picker with Space.',
          5000,
        );
      } catch (_spaceError) {
        record(
          `picker semantic trigger unavailable for ${optionText}; retrying with modal keyboard traversal`,
        );
        await openLocationPickerFromModalKeyboard(page);
        await waitForSearchFieldVisible(
          'Location picker search field must become visible after modal keyboard traversal.',
          5000,
        );
      }
    }
  }

  const trySelectVisibleOptionWithoutSearch = async () => {
    const option = await waitForLocationPickerOptionNearField(
      page,
      activeSearchField,
      optionText,
      1000,
    ).catch(() => null);
    if (!option) {
      return false;
    }

    record(`select picker option ${optionText} directly from the visible list`);
    await option.click();
    return true;
  };

  if (await trySelectVisibleOptionWithoutSearch()) {
    return;
  }

  record(`filter picker options with search ${optionText}`);
  const selectAll = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
  await activeSearchField.click();
  await activeSearchField.press(selectAll).catch(async () => {
    await page.keyboard.press(selectAll);
  });
  await activeSearchField.press('Backspace').catch(async () => {
    await page.keyboard.press('Backspace');
  });
  await activeSearchField.pressSequentially(optionText, { delay: 5 }).catch(
    async () => {
      await page.keyboard.type(optionText, { delay: 5 });
    },
  );

  const option = await waitForLocationPickerOptionNearField(
    page,
    activeSearchField,
    optionText,
  );

  record(`select picker option ${optionText}`);
  await option.click();
}

async function fillFlutterTextFieldByLocator(page, field, value, label) {
  await field.scrollIntoViewIfNeeded().catch(() => {});
  await expect(field).toBeVisible({ timeout: appBootTimeoutMs });

  let lastValue = '';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await field.click();
    await field.focus().catch(() => {});
    const selectAll = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
    await field.press(selectAll).catch(async () => {
      await page.keyboard.press(selectAll);
    });
    await field.press('Backspace').catch(async () => {
      await page.keyboard.press('Backspace');
    });

    try {
      await expect
        .poll(
          async () => {
            try {
              return await field.inputValue();
            } catch (_) {
              return '';
            }
          },
          {
            timeout: 3000,
            message: `Expected Flutter text field "${label}" to clear before typing.`,
          },
        )
        .toBe('');
    } catch (_) {
      await field.click({ clickCount: 3 }).catch(() => {});
      await field.press('Backspace').catch(async () => {
        await page.keyboard.press('Backspace');
      });
    }

    await field.pressSequentially(value, { delay: 5 }).catch(async () => {
      await page.keyboard.type(value, { delay: 5 });
    });

    try {
      await expect
        .poll(
          async () => {
            try {
              return await field.inputValue();
            } catch (_) {
              return '';
            }
          },
          {
            timeout: 3000,
            message: `Expected Flutter text field "${label}" to retain input.`,
          },
        )
        .toBe(value);
      return field;
    } catch (_) {
      try {
        lastValue = await field.inputValue();
      } catch (_) {
        lastValue = '<unreadable>';
      }
      await page.waitForTimeout(150);
    }
  }

  throw new Error(
    `Flutter text field "${label}" did not retain "${value}" before submit; last value was "${lastValue}".`,
  );
}

function relatedProfileDisplayName(profile) {
  return (
    profile?.display_name?.toString?.() ||
    profile?.displayName?.toString?.() ||
    ''
  ).trim();
}

async function addOccurrenceProfileGroup(page, { groupLabel }) {
  logStep(
    'evg-helper',
    `addOccurrenceProfileGroup start label="${groupLabel}"`,
  );
  await page.getByRole('button', { name: 'Adicionar grupo' }).click();
  const groupDialog = page.getByRole('alertdialog').last();
  await expect(groupDialog.getByText(/Novo grupo da ocorrência/i)).toBeVisible({
    timeout: appBootTimeoutMs,
  });
  await fillFlutterTextFieldByLocator(
    page,
    groupDialog.getByRole('textbox', { name: /Nome do grupo/i }).first(),
    groupLabel,
    'Nome do grupo',
  );
  logStep('evg-helper', `group label filled "${groupLabel}"`);
  await groupDialog.getByRole('button', { name: 'Criar grupo' }).click();
  await expect(page.getByText(groupLabel, { exact: true })).toBeVisible({
    timeout: appBootTimeoutMs,
  });
}

async function enableProgrammingItemTimedMode(page) {
  const startTimeField = page.getByLabel('Horário inicial').last();
  if (await startTimeField.isVisible().catch(() => false)) {
    return;
  }

  const toggleCandidates = [
    page.getByRole('switch', { name: /Item com horário/i }).last(),
    page.getByRole('checkbox', { name: /Item com horário/i }).last(),
    page.locator('[aria-label*="Item com horário"]').last(),
    page.getByText('Item com horário', { exact: true }).last(),
  ];

  for (const candidate of toggleCandidates) {
    if (!(await candidate.isVisible().catch(() => false))) {
      continue;
    }
    await candidate.click();
    await expect(startTimeField).toBeVisible({ timeout: appBootTimeoutMs });
    return;
  }

  await expect(
    startTimeField,
    'Programming item timed fields must become visible after enabling "Item com horário".',
  ).toBeVisible({ timeout: appBootTimeoutMs });
}

async function addOccurrenceProfilesViaProgramming(page, {
  groupLabel,
  programmingTitle,
  time,
  profileNames,
}) {
  logStep(
    'evg-helper',
    `addOccurrenceProfilesViaProgramming start group="${groupLabel}" title="${programmingTitle}" profiles=${profileNames.join(' | ')}`,
  );
  await page.getByRole('button', { name: 'Adicionar item de programação' }).click();
  await expect(page.getByText('Adicionar item de programação')).toBeVisible({
    timeout: appBootTimeoutMs,
  });
  await enableProgrammingItemTimedMode(page);
  await fillFlutterTextField(page, 'Horário inicial', time);
  await fillFlutterTextField(page, 'Título / copy do item', programmingTitle);
  logStep('evg-helper', `programming item draft ready "${programmingTitle}"`);

  for (const profileName of profileNames) {
    await page.getByRole('button', { name: new RegExp(`^${escapeRegExp(groupLabel)}$`) }).click();
    await expect(page.getByLabel('Buscar perfil relacionado')).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    await fillFlutterTextField(page, 'Buscar perfil relacionado', profileName);
    await page.getByText(profileName, { exact: true }).click();
    logStep('evg-helper', `programming flow added occurrence profile "${profileName}"`);
  }

  await page.getByRole('button', { name: 'Salvar item' }).click();
  logStep('evg-helper', `programming item saved "${programmingTitle}"`);
}

async function openOccurrenceEditorForStart(
  page,
  startValue,
  description = 'Occurrence card must open the occurrence editor.',
) {
  const label = formatAdminOccurrenceDateTimeLabel(startValue);
  const occurrenceCard = page
    .getByRole('group', {
      name: new RegExp(`^${escapeRegExp(label)}\\b`),
    })
    .last();
  const occurrenceEditorDialog = page
    .locator('[aria-label="Caixa de diálogo"]')
    .filter({
      hasText: /Adicionar data|Editar data|Editar ocorrência principal/i,
    })
    .first();
  logStep('evg-helper', `openOccurrenceEditorForStart seeking "${label}"`);
  await occurrenceCard.scrollIntoViewIfNeeded().catch(() => {});
  await expect(
    occurrenceCard,
    `${description} Occurrence card group must become visible before activation. Start label: ${label}`,
  ).toBeVisible({ timeout: appBootTimeoutMs });
  await expect(occurrenceEditorDialog).toHaveCount(0, {
    timeout: appBootTimeoutMs,
  });

  let dialogVisible = false;
  for (let attempt = 0; attempt < 3 && !dialogVisible; attempt += 1) {
    await occurrenceCard.click({ timeout: appBootTimeoutMs });
    try {
      await expectAnyVisibleMatch(
        occurrenceEditorDialog,
        `${description} Clicking the occurrence card must reopen the editor. Start label: ${label}`,
      );
      dialogVisible = true;
      break;
    } catch (_clickError) {
      if (attempt === 2) {
        throw _clickError;
      }
      await occurrenceCard.focus().catch(() => {});
      await occurrenceCard.press('Enter').catch(() => {});
      await page.waitForTimeout(400);
      dialogVisible =
        (await countVisibleMatches(occurrenceEditorDialog).catch(() => 0)) > 0;
    }
  }
  logStep('evg-helper', `openOccurrenceEditorForStart opened "${label}"`);
}

async function assertTextDoesNotAppearBetween(
  page,
  text,
  startLocator,
  endLocator,
  description,
) {
  const startBox = await startLocator.boundingBox();
  const endBox = await endLocator.boundingBox();
  expect(startBox, `${description} start anchor must have bounds.`).toBeTruthy();
  expect(endBox, `${description} end anchor must have bounds.`).toBeTruthy();
  const top = Math.min(startBox.y, endBox.y);
  const bottom = Math.max(
    startBox.y + startBox.height,
    endBox.y + endBox.height,
  );
  const locator = page.getByText(text);
  const count = await locator.count();
  let matchesInsideRange = 0;
  for (let index = 0; index < count; index += 1) {
    const box = await locator.nth(index).boundingBox().catch(() => null);
    if (!box) {
      continue;
    }
    const centerY = box.y + box.height / 2;
    if (centerY >= top && centerY <= bottom) {
      matchesInsideRange += 1;
    }
  }
  expect(matchesInsideRange, description).toBe(0);
}

function occurrenceDateChipLocator(page, occurrence, { selected = false } = {}) {
  const dateLabel = formatOccurrenceDateLabel(occurrence?.date_time_start);
  const namePattern = new RegExp(escapeRegExp(dateLabel));
  return page.getByRole('button', { name: namePattern }).first();
}

function legacyOccurrenceDateChipLocator(
  page,
  occurrence,
  { selected = false } = {},
) {
  const dateLabel = formatOccurrenceDateLabel(occurrence?.date_time_start);
  const timeLabel = formatOccurrenceTimeLabel(occurrence?.date_time_start);
  const namePattern = selected
    ? new RegExp(
        `${escapeRegExp(dateLabel)}\\s*${escapeRegExp(timeLabel)}\\s*Atual`,
      )
    : new RegExp(`${escapeRegExp(dateLabel)}\\s*${escapeRegExp(timeLabel)}`);
  return page.getByRole('button', { name: namePattern }).first();
}

async function clickOccurrenceDateChip(page, occurrence, description) {
  const chip = occurrenceDateChipLocator(page, occurrence);
  await expect(chip, description).toBeVisible({
    timeout: appBootTimeoutMs,
  });
  await chip.click();
}

async function clickImmersiveTab(
  page,
  title,
  { confirmationTextInViewport = null, confirmationLocator = null } = {},
) {
  const target = page
    .getByRole('button', { name: new RegExp(`^${escapeRegExp(title)}$`) })
    .first();
  await expect(
    target,
    `Immersive tab "${title}" must expose a semantic button target.`,
  ).toBeVisible({ timeout: appBootTimeoutMs });
  await target.click({ timeout: appBootTimeoutMs });
  await expect
    .poll(() => isImmersiveTabSelected(page, title), {
      timeout: appBootTimeoutMs,
      message: `Immersive tab "${title}" must expose selected semantics after activation.`,
    })
    .toBe(true);
  if (confirmationLocator) {
    await expect(
      confirmationLocator,
      `Immersive tab "${title}" must activate visibly.`,
    ).toBeVisible({ timeout: appBootTimeoutMs });
  } else if (confirmationTextInViewport) {
    await waitForTextInViewport(
      page,
      confirmationTextInViewport,
      `Immersive tab "${title}" must activate visibly.`,
    );
  }
}

async function isImmersiveTabSelected(page, title) {
  return page
    .getByRole('button', { name: new RegExp(`^${escapeRegExp(title)}$`) })
    .first()
    .evaluate((element) => {
      let current = element;
      for (let depth = 0; depth < 8 && current; depth += 1) {
        const selected =
          current.getAttribute('aria-selected') ||
          current.getAttribute('data-selected') ||
          '';
        const currentState = current.getAttribute('aria-current') || '';
        if (
          selected === 'true' ||
          (currentState && currentState !== 'false')
        ) {
          return true;
        }
        current = current.parentElement;
      }
      return false;
    })
    .catch(() => false);
}

async function clickLocatorCenter(page, locator, description) {
  await expect(locator, description).toBeVisible({ timeout: appBootTimeoutMs });
  await locator.click({ timeout: appBootTimeoutMs });
}

async function waitForTextInViewport(page, text, description) {
  await expect
    .poll(() => countTextInViewport(page, text), {
      timeout: appBootTimeoutMs,
    })
    .toBeGreaterThan(0, description);
}

async function scrollScrollableViewport(page, deltaY) {
  const viewport =
    page.viewportSize() ||
    (await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    })));
  await page.mouse.move(viewport.width * 0.62, viewport.height * 0.72);
  await page.mouse.wheel(0, deltaY).catch(() => {});
  await page.evaluate(
    ({ xRatio, yRatio, delta }) => {
      const x = window.innerWidth * xRatio;
      const y = window.innerHeight * yRatio;
      let current = document.elementFromPoint(x, y);
      while (current) {
        if (
          current instanceof HTMLElement &&
          current.scrollHeight > current.clientHeight + 1
        ) {
          current.scrollBy(0, delta);
          return true;
        }
        current = current.parentElement;
      }
      window.scrollBy(0, delta);
      return false;
    },
    {
      xRatio: 0.62,
      yRatio: 0.72,
      delta: deltaY,
    },
  ).catch(() => false);
}

async function scrollUntilTextInViewport(page, text, description) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await scrollScrollableViewport(page, -900);
    await page.waitForTimeout(100);
  }

  for (let attempt = 0; attempt < 24; attempt += 1) {
    if ((await countTextInViewport(page, text)) > 0) {
      return;
    }
    await scrollScrollableViewport(page, 900);
    await page.waitForTimeout(250);
  }

  for (let attempt = 0; attempt < 24; attempt += 1) {
    if ((await countTextInViewport(page, text)) > 0) {
      return;
    }
    await scrollScrollableViewport(page, -700);
    await page.waitForTimeout(250);
  }

  await waitForTextInViewport(page, text, description);
}

async function scrollDownUntilTextInViewport(page, text, description) {
  if ((await countTextInViewport(page, text)) > 0) {
    return;
  }

  for (let attempt = 0; attempt < 24; attempt += 1) {
    await scrollScrollableViewport(page, 900);
    await page.waitForTimeout(250);
    if ((await countTextInViewport(page, text)) > 0) {
      return;
    }
  }

  await waitForTextInViewport(page, text, description);
}

async function countTextInViewport(page, text) {
  const viewport =
    page.viewportSize() ||
    (await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    })));
  // Use exact text matching so semantic assertions do not overcount ancestor
  // containers that happen to include the same visible label.
  const locator = page.getByText(text, { exact: true });
  const count = await locator.count();
  let visibleInViewport = 0;
  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);
    if (!(await item.isVisible().catch(() => false))) {
      continue;
    }
    const box = await item.boundingBox().catch(() => null);
    if (!box) {
      continue;
    }
    const intersectsViewport =
      box.x < viewport.width &&
      box.x + box.width > 0 &&
      box.y < viewport.height &&
      box.y + box.height > 0;
    if (intersectsViewport) {
      visibleInViewport += 1;
    }
  }
  return visibleInViewport;
}

async function countTextInVerticalBand(page, text, top, bottom) {
  const locator = page.getByText(text, { exact: true });
  const count = await locator.count();
  let visibleInBand = 0;
  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);
    if (!(await item.isVisible().catch(() => false))) {
      continue;
    }
    const box = await item.boundingBox().catch(() => null);
    if (!box) {
      continue;
    }
    const centerY = box.y + box.height / 2;
    if (centerY >= top && centerY <= bottom) {
      visibleInBand += 1;
    }
  }
  return visibleInBand;
}

function programmingItemSemanticLabel(title, extraPattern = '') {
  const suffix = extraPattern ? `[\\s\\S]*${extraPattern}` : '';
  return new RegExp(`${escapeRegExp(title)}${suffix}`);
}

function matchesAdminEventsListResponse(candidate, baseUrl) {
  const method = candidate.request().method().toUpperCase();
  if (method !== 'GET') {
    return false;
  }

  const actual = new URL(candidate.url());
  const expected = new URL(buildApiUrl(baseUrl, '/admin/api/v1/events'));
  return actual.origin === expected.origin && actual.pathname === expected.pathname;
}

async function waitForAdminEventsListUiReady(page) {
  const firstEditButton = page
    .getByRole('button', { name: /^Editar evento / })
    .first();
  const emptyState = page.getByText('Nenhum evento cadastrado').first();
  await expect
    .poll(
      async () => {
        if (await firstEditButton.isVisible().catch(() => false)) {
          return 'rows';
        }
        if (await emptyState.isVisible().catch(() => false)) {
          return 'empty';
        }
        return 'loading';
      },
      {
        timeout: appBootTimeoutMs,
        message:
          'Tenant-admin events list must finish hydrating before admin navigation scans it.',
      },
    )
    .not.toBe('loading');
}

async function openSeededEventFromAdminList(
  page,
  baseUrl,
  uniqueTitle,
  expectedApiPage = 1,
  flow = 'admin',
) {
  async function openList() {
    let listResponse = null;
    const captureListResponse = (candidate) => {
      if (!listResponse && matchesAdminEventsListResponse(candidate, baseUrl)) {
        listResponse = candidate;
      }
    };
    page.on('response', captureListResponse);
    const response = await page.goto(buildApiUrl(baseUrl, '/admin/events'), {
      waitUntil: 'domcontentloaded',
    });
    expect(response, 'Events list response should be available.').not.toBeNull();
    expect(response.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);
    try {
      await waitForAdminEventsListUiReady(page);
      await page.waitForTimeout(300);
    } finally {
      page.off('response', captureListResponse);
    }

    if (listResponse) {
      expect(
        listResponse.status(),
        'Tenant-admin events list response must succeed before UI assertions.',
      ).toBeGreaterThanOrEqual(200);
      expect(
        listResponse.status(),
        'Tenant-admin events list response must succeed before UI assertions.',
      ).toBeLessThan(300);
      await logAdminEventsListResponse(flow, listResponse, 'initial');
      return;
    }

    console.log(
      `[event-occurrences][${flow}] admin events list reached ready UI state without observing a fresh list response; proceeding with visible state.`,
    );
  }

  await openList();
  const titlePattern = new RegExp(`Editar evento ${escapeRegExp(uniqueTitle)}`);
  const accessibleEditButton = page.getByRole('button', {
    name: titlePattern,
  });

  async function resolveTitleCandidate() {
    const hasAccessibleEditButton =
      (await accessibleEditButton.count().catch(() => 0)) > 0;
    if (hasAccessibleEditButton) {
      return {
        locator: accessibleEditButton.first(),
        isAccessibleEditButton: true,
      };
    }
    const visibleTitle = await scrollToSeededEventTitle(
      page,
      uniqueTitle,
      expectedApiPage,
    );
    return {
      locator: visibleTitle,
      isAccessibleEditButton: false,
    };
  }

  let titleCandidate = await resolveTitleCandidate();
  if (!titleCandidate.locator) {
    const reloadListResponsePromise = page.waitForResponse(
      (candidate) => matchesAdminEventsListResponse(candidate, baseUrl),
      { timeout: appBootTimeoutMs },
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);
    const listResponse = await reloadListResponsePromise;
    expect(
      listResponse.status(),
      'Tenant-admin events list reload response must succeed before UI assertions.',
    ).toBeGreaterThanOrEqual(200);
    expect(
      listResponse.status(),
      'Tenant-admin events list reload response must succeed before UI assertions.',
    ).toBeLessThan(300);
    await logAdminEventsListResponse(flow, listResponse, 'reload');
    await waitForAdminEventsListUiReady(page);
    titleCandidate = await resolveTitleCandidate();
  }
  if (!titleCandidate.locator) {
    await nudgeAdminEventListRefresh(page);
    await waitForAdminEventsListUiReady(page);
    titleCandidate = await resolveTitleCandidate();
  }
  expect(
    titleCandidate.locator,
    `Seeded admin event card "${uniqueTitle}" must be reachable before editing.`,
  ).toBeTruthy();
  const title = titleCandidate.locator;
  await title.scrollIntoViewIfNeeded({ timeout: appBootTimeoutMs }).catch(() => {});
  if (titleCandidate.isAccessibleEditButton) {
    await title.click({ timeout: appBootTimeoutMs });
    await expect(
      page,
      `Accessible admin event card activation must open "${uniqueTitle}" edit route.`,
    ).toHaveURL(adminEventEditRoutePattern, {
      timeout: appBootTimeoutMs,
    });
    return;
  }
  logStep(
    flow,
    `accessible edit button unavailable for "${uniqueTitle}"; using the resolved title locator without coordinate fallback`,
  );
  await title.click({ timeout: appBootTimeoutMs });
  await expect(page).toHaveURL(adminEventEditRoutePattern, {
    timeout: appBootTimeoutMs,
  });
}

async function openAdminEventEditRoute(page, baseUrl, eventId, description) {
  const editUrl = buildApiUrl(
    baseUrl,
    `/admin/events/${encodeURIComponent(eventId)}/edit`,
  );
  const response = await page.goto(editUrl, {
    waitUntil: 'domcontentloaded',
  });
  expect(response, `${description} response should be available.`).not.toBeNull();
  expect(response.status(), `${description} must load.`).toBeLessThan(400);
  await assertAppBooted(page);
  await enableAccessibilityIfNeeded(page);
  await expect(page).toHaveURL(adminEventEditRoutePattern, {
    timeout: appBootTimeoutMs,
  });
}

async function nudgeAdminEventListRefresh(page) {
  const futureChip = page.getByRole('button', { name: /^Futuros$/ }).first();
  if (!(await futureChip.isVisible().catch(() => false))) {
    return;
  }
  await futureChip.click({ timeout: appBootTimeoutMs });
  await page.waitForTimeout(700);
  await futureChip.click({ timeout: appBootTimeoutMs });
  await page.waitForTimeout(900);
}

async function clickVisibleAddOccurrenceAffordance(page) {
  const candidates = page.getByRole('button', { name: /^Adicionar data$/ });
  await expect(candidates.first()).toBeVisible({ timeout: appBootTimeoutMs });
  const count = await candidates.count();
  let addOccurrence = candidates.first();
  let rightmostX = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index);
    const box = await candidate.boundingBox();
    if (!box || box.x <= rightmostX) {
      continue;
    }
    rightmostX = box.x;
    addOccurrence = candidate;
  }

  await expect(addOccurrence).toBeVisible({ timeout: appBootTimeoutMs });
  const floatingBox = await addOccurrence.boundingBox();
  const viewport =
    page.viewportSize() ||
    (await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    })));
  expect(floatingBox, 'Add occurrence affordance must have a visible box.').not.toBeNull();
  expect(
    floatingBox.x + floatingBox.width / 2,
    'Add occurrence affordance must be positioned like the form FAB, not only as an inline card button.',
  ).toBeGreaterThan(viewport.width * 0.6);
  expect(
    floatingBox.y + floatingBox.height / 2,
    'Add occurrence affordance must be positioned like the form FAB, not only as an inline card button.',
  ).toBeGreaterThan(viewport.height * 0.55);
  await addOccurrence.click();
  await expect(page.getByText('Adicionar data').last()).toBeVisible({
    timeout: appBootTimeoutMs,
  });
}

async function closeOccurrenceEditorSheet(page) {
  logStep('evg-helper', 'closeOccurrenceEditorSheet start');
  const occurrenceEditorDialog = page
    .locator('[aria-label="Caixa de diálogo"]')
    .filter({
      hasText: /Adicionar data|Editar data|Editar ocorrência principal/i,
    })
    .first();
  const waitForOccurrenceEditorDismissed = async (message, timeout = appBootTimeoutMs) => {
    await expect
      .poll(
        async () => countVisibleMatches(occurrenceEditorDialog),
        {
          timeout,
          message,
        },
      )
      .toBe(0);
  };
  await expect(
    page.getByRole('button', { name: 'Salvar data' }),
    'Occurrence editor must not expose the superseded per-occurrence save boundary.',
  ).toHaveCount(0);
  await expectAnyVisibleMatch(
    occurrenceEditorDialog,
    'Occurrence editor dialog must be visible before the helper tries to dismiss it.',
  );
  const headerCloseButton = occurrenceEditorDialog.getByRole('button', {
    name: 'Fechar',
  }).first();
  await expect(
    headerCloseButton,
    'Occurrence editor dialog must expose a sheet-local Fechar action.',
  ).toBeVisible({ timeout: appBootTimeoutMs });
  try {
    await headerCloseButton.click();
    await waitForOccurrenceEditorDismissed(
      'Closing the occurrence editor via the dialog close action must dismiss the dialog container.',
      3000,
    );
    logStep('evg-helper', 'closeOccurrenceEditorSheet dialog close dismissed');
    return;
  } catch (_clickError) {
    logStep(
      'evg-helper',
      'closeOccurrenceEditorSheet dialog click did not dismiss the container, retrying with Enter',
    );
  }

  try {
    await headerCloseButton.focus().catch(() => {});
    await headerCloseButton.press('Enter');
    await waitForOccurrenceEditorDismissed(
      'Pressing Enter on the occurrence editor close action must dismiss the dialog container.',
      3000,
    );
    logStep('evg-helper', 'closeOccurrenceEditorSheet enter retry dismissed');
    return;
  } catch (_enterError) {
    logStep(
      'evg-helper',
      'closeOccurrenceEditorSheet enter retry did not dismiss the container, retrying with Escape',
    );
  }

  await page.keyboard.press('Escape');
  await waitForOccurrenceEditorDismissed(
    'Escaping the occurrence editor must dismiss the dialog container.',
    3000,
  );
  logStep('evg-helper', 'closeOccurrenceEditorSheet escape fallback dismissed');
}

async function countVisibleMatches(locator) {
  return locator
    .evaluateAll((elements) =>
      elements.filter((element) => {
        if (!(element instanceof HTMLElement)) {
          return false;
        }
        const style = window.getComputedStyle(element);
        const hiddenByStyle =
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          style.opacity === '0';
        return !hiddenByStyle && element.getClientRects().length > 0;
      }).length,
    )
    .catch(() => 0);
}

async function expectAnyVisibleMatch(locator, message) {
  await expect
    .poll(async () => countVisibleMatches(locator), {
      timeout: appBootTimeoutMs,
      message,
    })
    .toBeGreaterThan(0);
}

function matchesAgendaPageResponse(candidate, baseUrl, expectedPage) {
  const method = candidate.request().method().toUpperCase();
  if (method !== 'GET') {
    return false;
  }

  const actual = new URL(candidate.url());
  const expected = new URL(buildApiUrl(baseUrl, '/api/v1/agenda'));
  return (
    actual.origin === expected.origin &&
    actual.pathname === expected.pathname &&
    (actual.searchParams.get('page') || '1') === expectedPage.toString()
  );
}

async function revealPublicAgendaCard(page, baseUrl, titlePattern) {
  if ((await countTextInViewport(page, titlePattern)) > 0) {
    return;
  }

  let nextPage = 2;
  let hasMore = true;
  while (hasMore && nextPage <= 10) {
    const nextPageResponsePromise = page
      .waitForResponse(
        (candidate) => matchesAgendaPageResponse(candidate, baseUrl, nextPage),
        { timeout: 8000 },
      )
      .catch(() => null);

    for (let attempt = 0; attempt < 14; attempt += 1) {
      if ((await countTextInViewport(page, titlePattern)) > 0) {
        return;
      }
      await scrollScrollableViewport(page, 1200);
      await page.waitForTimeout(200);
    }

    const nextPageResponse = await nextPageResponsePromise;
    if (!nextPageResponse) {
      break;
    }

    expect(
      nextPageResponse.status(),
      `Public agenda pagination page ${nextPage} must succeed before agenda-card navigation assertions.`,
    ).toBe(200);
    const payload = await nextPageResponse.json().catch(() => ({}));
    hasMore =
      payload?.has_more === true ||
      payload?.data?.has_more === true ||
      payload?.items?.length === publicAgendaUiPageSize ||
      payload?.data?.items?.length === publicAgendaUiPageSize;
    if ((await countTextInViewport(page, titlePattern)) > 0) {
      return;
    }
    nextPage += 1;
  }
}

async function openPublicAgendaCardAndReturn(
  page,
  baseUrl,
  uniqueTitle,
  expectedOccurrenceIds,
) {
  const response = await page.goto(buildApiUrl(baseUrl, '/agenda'), {
    waitUntil: 'domcontentloaded',
  });
  expect(response, 'Public agenda response should be available.').not.toBeNull();
  expect(response.status()).toBeLessThan(400);
  await assertAppBooted(page);
  await enableAccessibilityIfNeeded(page);

  const titlePattern = new RegExp(escapeRegExp(uniqueTitle));
  const title = page.getByText(titlePattern).first();
  await revealPublicAgendaCard(page, baseUrl, titlePattern);
  await scrollUntilTextInViewport(
    page,
    titlePattern,
    'Seeded occurrence card must be visible in the public agenda list.',
  );
  await expect(
    page.getByText('Datas do evento'),
    'Occurrence list cards must remain card-only; sibling dates belong to detail.',
  ).toHaveCount(0);

  expect(
    expectedOccurrenceIds,
    'Visible public agenda card must map to concrete occurrence ids before navigation.',
  ).toBeTruthy();
  const normalizedOccurrenceIds = (expectedOccurrenceIds || [])
    .map((value) => value?.toString().trim())
    .filter(Boolean);
  expect(
    normalizedOccurrenceIds.length,
    'Visible public agenda card must map to at least one concrete occurrence id before navigation.',
  ).toBeGreaterThan(0);

  const openedFromTitle = await clickPublicAgendaCardAndWaitForDetail(
    page,
    titlePattern,
  );
  expect(
    openedFromTitle,
    'Seeded occurrence card must navigate to the public event detail from the real agenda list.',
  ).toBe(true);
  await expect(page).toHaveURL(/\/agenda\/evento\//, {
    timeout: appBootTimeoutMs,
  });
  const openedOccurrenceId = new URL(page.url()).searchParams.get('occurrence') || '';
  expect(
    normalizedOccurrenceIds,
    'Agenda navigation must preserve an occurrence query parameter that belongs to the tapped event.',
  ).toContain(openedOccurrenceId);
  await expect(page.getByText(new RegExp(escapeRegExp(uniqueTitle))).first())
    .toBeVisible({ timeout: appBootTimeoutMs });

  await page.goBack({ waitUntil: 'domcontentloaded' });
  await assertAppBooted(page);
  await expect(page).toHaveURL(/(?:\/agenda(?:\?|$)|\/(?:\?|$))/, {
    timeout: appBootTimeoutMs,
  });
  await expect(title).toBeVisible({ timeout: appBootTimeoutMs });
}

async function clickPublicAgendaCardAndWaitForDetail(page, titlePattern) {
  const title = page.getByText(titlePattern).first();
  const semanticTargets = [
    page.getByRole('button', { name: titlePattern }).first(),
    page.getByRole('group', { name: titlePattern }).first(),
    title,
  ];

  for (const target of semanticTargets) {
    if (!(await target.isVisible().catch(() => false))) {
      continue;
    }

    await target.click({ timeout: appBootTimeoutMs }).catch(() => {});
    const opened = await page
      .waitForURL(/\/agenda\/evento\//, { timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (opened) {
      return true;
    }
  }

  return /\/agenda\/evento\//.test(page.url());
}

test('@metadata NAV-01..NAV-23 multi-occurrence navigation matrix is declared', async () => {
  const expectedIds = Array.from({ length: 23 }, (_, index) =>
    `NAV-${String(index + 1).padStart(2, '0')}`,
  );
  const actualIds = multiOccurrenceNavigationMatrix.map((item) => item.id);
  expect(actualIds).toEqual(expectedIds);
  expect(new Set(actualIds).size).toBe(expectedIds.length);
  for (const item of multiOccurrenceNavigationMatrix) {
    expect(item.title.trim(), `${item.id} must have a title`).toBeTruthy();
    expect(item.proof.trim(), `${item.id} must have proof text`).toBeTruthy();
  }
});

test.skip('@deferred NAV-ADM-LOC-01..08 admin occurrence programming and event-level location ownership matrix holds', async ({
  browser,
}) => {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  const uniqueSuffix = Date.now().toString();
  let browserContext;
  let session = null;
  let eventTypeId = null;
  let eventId = null;
  const createdSeedProfileIds = [];
  const createdSeedAccountSlugs = [];
  const createdSeedProfileTypes = new Set();

  try {
    session = await loginTenantAdmin(api, baseUrl);
    await deleteStaleOccurrenceSeedEvents(api, baseUrl, session.token);

    const eventType = await createEventType(
      api,
      baseUrl,
      session.token,
      uniqueSuffix,
    );
    eventTypeId = eventType?.id?.toString() || null;
    expect(eventTypeId, 'Seeded event type must return an id.').toBeTruthy();

    const physicalHostSeed = await ensurePhysicalHostCandidates(
      api,
      baseUrl,
      session.token,
      2,
    );
    createdSeedProfileIds.push(...physicalHostSeed.createdProfileIds);
    createdSeedAccountSlugs.push(...physicalHostSeed.createdAccountSlugs);
    if (physicalHostSeed.createdType) {
      createdSeedProfileTypes.add(physicalHostSeed.createdType);
    }
    const physicalHost = physicalHostSeed.candidates[0];
    const programmingHost = physicalHostSeed.candidates[1];

    const seededEvent = await createSingleOccurrenceEvent(
      api,
      baseUrl,
      session.token,
      { eventType, physicalHost, uniqueSuffix },
    );
    eventId = seededEvent?.event_id?.toString() || null;
    const uniqueTitle = seededEvent?.title?.toString();
    expect(eventId, 'Seeded event must return event_id.').toBeTruthy();
    expect(uniqueTitle, 'Seeded event must return title.').toBeTruthy();

    const seededListLocation = await locateAdminEventListPage(
      api,
      baseUrl,
      session.token,
      eventId,
    );

    const primaryPageBundle = await createAuthenticatedTenantAdminPage(
      browser,
      session,
    );
    browserContext = primaryPageBundle.context;
    const page = primaryPageBundle.page;
    const collectors = installFailureCollectors(page);

    await openSeededEventFromAdminList(
      page,
      baseUrl,
      uniqueTitle,
      seededListLocation.page,
    );

    await test.step('NAV-ADM-LOC-07 event-level host picker updates the selected physical host summary', async () => {
      const hostTrigger = page.getByRole('button', {
        name: new RegExp(
          `Host físico[\\s\\S]*${escapeRegExp(physicalHost.display_name)}`,
          'i',
        ),
      }).first();
      await hostTrigger.scrollIntoViewIfNeeded().catch(() => {});
      await expect(
        hostTrigger,
        'Event-level host picker trigger must be visible before selecting a new physical host.',
      ).toBeVisible({ timeout: appBootTimeoutMs });
      await selectLocationPickerSheetOption(page, {
        trigger: hostTrigger,
        optionText: programmingHost.display_name,
        flow: 'evg-admin',
        logStep,
      });
      await expect(
        page.getByRole('button', {
          name: new RegExp(
            `Host físico[\\s\\S]*${escapeRegExp(programmingHost.display_name)}`,
            'i',
          ),
        }).first(),
        'Event-level physical host button must reflect the newly selected host.',
      ).toBeVisible({ timeout: appBootTimeoutMs });
    });

    await clickVisibleAddOccurrenceAffordance(page);

    const adminProgrammingTitle = `Programação local ${uniqueSuffix}`;
    const adminProgrammingLocationLabelPattern = escapeRegExp('Local:');
    const adminProgrammingLocationNamePattern = escapeRegExp(
      programmingHost.display_name,
    );
    const adminProgrammingItemButton = page.getByRole('button', {
      name: programmingItemSemanticLabel(adminProgrammingTitle),
    });

    await test.step('NAV-ADM-LOC-01 absence: occurrence editor must not expose occurrence-level location UI', async () => {
      await expect(
        page.getByText('Local sobrescrito'),
        'Occurrence-level location summary must stay absent in the occurrence editor.',
      ).toHaveCount(0);
    });

    await test.step('NAV-ADM-LOC-02 presence: adding a programação item with location shows the selected location summary', async () => {
      await scrollUntilVisible(
        page,
        page.getByRole('button', { name: 'Adicionar item de programação' }),
        'Programming add button must be visible in the occurrence editor.',
      );
      await page.getByRole('button', { name: 'Adicionar item de programação' }).click();
      await expect(page.getByText('Adicionar item de programação')).toBeVisible({
        timeout: appBootTimeoutMs,
      });

      await enableProgrammingItemTimedMode(page);
      await fillFlutterTextField(page, 'Horário inicial', '13:00');
      await fillFlutterTextField(page, 'Título / copy do item', adminProgrammingTitle);
      const programmingLocationTrigger = await programmingLocationTriggerLocator(page);
      await selectLocationPickerSheetOption(page, {
        trigger: programmingLocationTrigger,
        optionText: programmingHost.display_name,
        flow: 'evg-admin',
        logStep,
      });
      await page.getByRole('button', { name: 'Salvar item' }).click();

      await expect(
        page
          .getByRole('button', {
            name: programmingItemSemanticLabel(
              adminProgrammingTitle,
              `${adminProgrammingLocationLabelPattern}[\\s\\S]*${adminProgrammingLocationNamePattern}`,
            ),
          })
          .first(),
        'Programação item must expose the selected location summary after save.',
      ).toBeVisible({ timeout: appBootTimeoutMs });
    });

    await test.step('NAV-ADM-LOC-03 edit: reopening the programação item preserves the selected location', async () => {
      await adminProgrammingItemButton.first().click();
      await expect(page.getByText('Editar item de programação')).toBeVisible({
        timeout: appBootTimeoutMs,
      });
      await page.getByRole('button', { name: 'Salvar item' }).click();
      await expect(
        page
          .getByRole('button', {
            name: programmingItemSemanticLabel(
              adminProgrammingTitle,
              `${adminProgrammingLocationLabelPattern}[\\s\\S]*${adminProgrammingLocationNamePattern}`,
            ),
          })
          .first(),
        'Saving the existing programação item without edits must preserve the selected location summary.',
      ).toBeVisible({ timeout: appBootTimeoutMs });
    });

    await test.step('NAV-ADM-LOC-04 removal: clearing the programação location removes the summary and keeps occurrence-level location absent', async () => {
      await adminProgrammingItemButton.first().click();
      await expect(page.getByText('Editar item de programação')).toBeVisible({
        timeout: appBootTimeoutMs,
      });
      const programmingLocationTrigger = await programmingLocationTriggerLocator(page);
      await scrollUntilVisible(
        page,
        programmingLocationTrigger,
        'Programming location selector must be visible before clearing the selected location.',
      );
      await selectLocationPickerSheetOption(page, {
        trigger: programmingLocationTrigger,
        optionText: 'Sem local específico',
        flow: 'evg-admin',
        logStep,
      });
      await page.getByRole('button', { name: 'Salvar item' }).click();

      await expect(
        page
          .getByRole('button', {
            name: programmingItemSemanticLabel(
              adminProgrammingTitle,
              adminProgrammingLocationLabelPattern,
            ),
          })
          .first(),
        'Programação location label must disappear after clearing the item location.',
      ).toHaveCount(0);
      await expect(
        page
          .getByRole('button', {
            name: programmingItemSemanticLabel(
              adminProgrammingTitle,
              adminProgrammingLocationNamePattern,
            ),
          })
          .first(),
        'Programação location name must disappear after clearing the item location.',
      ).toHaveCount(0);
      await expect(
        page.getByText('Local sobrescrito'),
        'Clearing the programação item location must not resurrect occurrence-level location UI.',
      ).toHaveCount(0);
    });

    await closeOccurrenceEditorSheet(page);
    await expect(page.getByText('Datas').first()).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    await expect(page.getByRole('button', { name: 'Remover data' })).toHaveCount(
      2,
      { timeout: appBootTimeoutMs },
    );

    const updateResponsePromise = page.waitForResponse((candidate) => {
      const method = candidate.request().method().toUpperCase();
      return (
        method === 'PATCH' &&
        candidate.url().includes(`/admin/api/v1/events/${eventId}`) &&
        candidate.status() < 400
      );
    });

    const submitButton = page.getByRole('button', {
      name: 'Salvar alterações',
    });
    await submitButton.scrollIntoViewIfNeeded();
    await Promise.all([updateResponsePromise, submitButton.click()]);

    const updateResponse = await updateResponsePromise;
    const updatePayload = await updateResponse.json();
    expect(
      updatePayload?.data?.occurrences || [],
      'PATCH response must include both persisted occurrences.',
    ).toHaveLength(2);

    const updatedListLocation = await locateAdminEventListPage(
      api,
      baseUrl,
      session.token,
      eventId,
    );
    await openSeededEventFromAdminList(
      page,
      baseUrl,
      uniqueTitle,
      updatedListLocation.page,
    );
    await scrollUntilVisible(
      page,
      page.getByText('Datas').first(),
      'Occurrence section must be visible after reopening the edited event.',
    );

    await test.step('NAV-ADM-LOC-05 persistence: saving the occurrence and the event preserves the cleared state after reopen', async () => {
      const reopenedOccurrenceCard = page.getByRole('group', {
        name: /1 item de programação/i,
      }).first();
      await reopenedOccurrenceCard.click();
      await expect(page.getByText('Editar data')).toBeVisible({
        timeout: appBootTimeoutMs,
      });
      await expect(
        page.getByRole('button', {
          name: programmingItemSemanticLabel(adminProgrammingTitle),
        }),
        'The programação item must remain visible after event save and reopen.',
      ).toBeVisible({ timeout: appBootTimeoutMs });
      await expect(
        page
          .getByRole('button', {
            name: programmingItemSemanticLabel(
              adminProgrammingTitle,
              adminProgrammingLocationLabelPattern,
            ),
          })
          .first(),
        'A cleared programação item location label must stay absent after event save and reopen.',
      ).toHaveCount(0);
      await expect(
        page
          .getByRole('button', {
            name: programmingItemSemanticLabel(
              adminProgrammingTitle,
              adminProgrammingLocationNamePattern,
            ),
          })
          .first(),
        'A cleared programação item location name must stay absent after event save and reopen.',
      ).toHaveCount(0);
      await closeOccurrenceEditorSheet(page);
    });

    await test.step('NAV-ADM-LOC-06 structural negative: occurrence-level location UI stays absent after reopen', async () => {
      await expect(
        page.getByText('Local sobrescrito'),
        'Occurrence-level location UI must stay absent after event save and reopen.',
      ).toHaveCount(0);
    });

    await test.step('NAV-ADM-LOC-08 event-level host picker persists after save and reopen', async () => {
      const hostUpdateResponsePromise = page.waitForResponse((candidate) => {
        const method = candidate.request().method().toUpperCase();
        return (
          method === 'PATCH' &&
          candidate.url().includes(`/admin/api/v1/events/${eventId}`) &&
          candidate.status() < 400
        );
      });

      const submitButton = page.getByRole('button', {
        name: 'Salvar alterações',
      });
      await submitButton.scrollIntoViewIfNeeded();
      await Promise.all([hostUpdateResponsePromise, submitButton.click()]);
      await hostUpdateResponsePromise;

      const reopenedListLocation = await locateAdminEventListPage(
        api,
        baseUrl,
        session.token,
        eventId,
      );
      await openSeededEventFromAdminList(
        page,
        baseUrl,
        uniqueTitle,
        reopenedListLocation.page,
      );
      const reopenedHostSummaryButton = page.getByRole('button', {
        name: new RegExp(
          `Host físico[\\s\\S]*${escapeRegExp(programmingHost.display_name)}`,
          'i',
        ),
      }).first();
      await reopenedHostSummaryButton.scrollIntoViewIfNeeded().catch(() => {});
      await expect(
        reopenedHostSummaryButton,
        'Reopened event must keep the selected event-level physical host summary.',
      ).toBeVisible({ timeout: appBootTimeoutMs });
    });

    await assertNoBrowserFailures(collectors);
  } finally {
    if (session?.token) {
      await deleteEvent(api, baseUrl, session.token, eventId);
      await deleteEventType(api, baseUrl, session.token, eventTypeId);
      await cleanupOnboardedAccounts(api, baseUrl, session.token, createdSeedAccountSlugs);
      for (const profileType of createdSeedProfileTypes) {
        await deleteAccountProfileType(api, baseUrl, session.token, profileType);
      }
    }
    if (browserContext) {
      await browserContext.close().catch(() => {});
    }
    await api.dispose();
  }
});

test.skip('@deferred @mutation tenant-admin event occurrence FAB persists second occurrence and public detail selects it', async ({
  browser,
}) => {
  test.setTimeout(420000);
  annotateMultiOccurrenceNavigationMatrix();
  resetMultiOccurrenceNavigationEvidence();
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  const uniqueSuffix = Date.now().toString();
  let browserContext;
  let freshBrowser;
  let publicContext;
  let session = null;
  let eventTypeId = null;
  let eventId = null;
  let noProgrammingEventId = null;
  let singleProgrammedEventId = null;
  let programmedEventId = null;
  let futureLaterEventId = null;
  let createdPhysicalHostId = null;
  let createdProgrammingHostId = null;
  let createdPhysicalHostAccountSlug = null;
  let createdProgrammingHostAccountSlug = null;
  let createdProfileType = null;
  const createdSeedProfileIds = [];
  const createdSeedAccountSlugs = [];
  const createdSeedProfileTypes = new Set();

  try {
    session = await loginTenantAdmin(api, baseUrl);
    await deleteStaleOccurrenceSeedEvents(api, baseUrl, session.token);

    const eventType = await createEventType(
      api,
      baseUrl,
      session.token,
      uniqueSuffix,
    );
    eventTypeId = eventType?.id?.toString() || null;
    expect(eventTypeId, 'Seeded event type must return an id.').toBeTruthy();
    const profileTypeSeed = await resolvePoiCapableProfileType(
      api,
      baseUrl,
      session.token,
    );
    createdProfileType = profileTypeSeed.createdType;
    const physicalHost = await createNearbyPhysicalHost(
      api,
      baseUrl,
      session.token,
      profileTypeSeed.profileType,
      `PW SR-D Host ${uniqueSuffix}`,
    );
    createdPhysicalHostId = physicalHost.id;
    createdPhysicalHostAccountSlug = physicalHost.accountSlug;
    const programmingHost = await createNearbyPhysicalHost(
      api,
      baseUrl,
      session.token,
      profileTypeSeed.profileType,
      `PW SR-D Programming Host ${uniqueSuffix}`,
    );
    createdProgrammingHostId = programmingHost.id;
    createdProgrammingHostAccountSlug = programmingHost.accountSlug;
    const relatedProfileSeed = await createDedicatedRelatedProfiles(
      api,
      baseUrl,
      session.token,
      `${uniqueSuffix}-stable-media`,
    );
    createdSeedProfileIds.push(...relatedProfileSeed.createdProfileIds);
    createdSeedAccountSlugs.push(...relatedProfileSeed.createdAccountSlugs);
    if (relatedProfileSeed.createdType) {
      createdSeedProfileTypes.add(relatedProfileSeed.createdType);
    }
    const relatedProfiles = relatedProfileSeed.candidates;

    const seededEvent = await createSingleOccurrenceEvent(
      api,
      baseUrl,
      session.token,
      { eventType, physicalHost, uniqueSuffix },
    );
    eventId = seededEvent?.event_id?.toString() || null;
    const uniqueTitle = seededEvent?.title?.toString();
    expect(eventId, 'Seeded event must return event_id.').toBeTruthy();
    expect(uniqueTitle, 'Seeded event must return title.').toBeTruthy();
    expect(seededEvent?.occurrences || [], 'Seed must start with one occurrence.').toHaveLength(1);
    const seededListLocation = await locateAdminEventListPage(
      api,
      baseUrl,
      session.token,
      eventId,
    );
    logStep(
      'admin',
      `seeded event is visible in admin list API page ${seededListLocation.page}`,
    );

    const primaryPageBundle = await createFreshAuthenticatedTenantAdminPage(
      session,
    );
    freshBrowser = primaryPageBundle.browser;
    browserContext = primaryPageBundle.context;
    const page = primaryPageBundle.page;
    const collectors = installFailureCollectors(page);

    logStep('admin', `open seeded event ${eventId}`);
    await openSeededEventFromAdminList(
      page,
      baseUrl,
      uniqueTitle,
      seededListLocation.page,
    );

    const rootProgrammingTitle = `Programação raiz ${uniqueSuffix}`;
    await navStep('NAV-23', async () => {
      await scrollUntilVisible(
        page,
        page.getByRole('button', { name: 'Adicionar item de programação' }),
        'Single-occurrence event root form must expose direct programação authoring before a second date exists.',
      );
      await expect(
        page.getByText(
          'Enquanto o evento tiver só uma ocorrência, a programação dessa data fica visível aqui na raiz do formulário.',
        ),
      ).toBeVisible({ timeout: appBootTimeoutMs });
      await page.getByRole('button', { name: 'Adicionar item de programação' }).click();
      await expect(page.getByText('Adicionar item de programação')).toBeVisible({
        timeout: appBootTimeoutMs,
      });
      await enableProgrammingItemTimedMode(page);
      await fillFlutterTextField(page, 'Horário inicial', '09:30');
      await fillFlutterTextField(page, 'Título / copy do item', rootProgrammingTitle);
      await page.getByRole('button', { name: 'Salvar item' }).click();
      await expect(page.getByText('Nenhum item de programação nesta data.')).toHaveCount(
        0,
      );
    });

    logStep('admin', 'verify visible add occurrence affordance and open editor');
    await clickVisibleAddOccurrenceAffordance(page);

    const adminProgrammingTitle = `Programação local ${uniqueSuffix}`;
    const adminProgrammingLocationLabelPattern = escapeRegExp('Local:');
    const adminProgrammingLocationNamePattern = escapeRegExp(
      programmingHost.display_name,
    );
    const adminProgrammingItemButton = page.getByRole('button', {
      name: programmingItemSemanticLabel(adminProgrammingTitle),
    });

    await test.step('admin location ownership stays on programação item only', async () => {
      await expect(
        page.getByText('Local sobrescrito'),
        'Occurrence-level location summary must stay absent in the occurrence editor.',
      ).toHaveCount(0);

      await scrollUntilVisible(
        page,
        page.getByRole('button', { name: 'Adicionar item de programação' }),
        'Programming add button must be visible in the occurrence editor.',
      );
      await page.getByRole('button', { name: 'Adicionar item de programação' }).click();
      await expect(page.getByText('Adicionar item de programação')).toBeVisible({
        timeout: appBootTimeoutMs,
      });

      await enableProgrammingItemTimedMode(page);
      await fillFlutterTextField(page, 'Horário inicial', '13:00');
      await fillFlutterTextField(page, 'Título / copy do item', adminProgrammingTitle);
      const programmingLocationTrigger = await programmingLocationTriggerLocator(page);
      await selectLocationPickerSheetOption(page, {
        trigger: programmingLocationTrigger,
        optionText: programmingHost.display_name,
        flow: 'evg-admin',
        logStep,
      });
      await page.getByRole('button', { name: 'Salvar item' }).click();
      await expect(
        page
          .getByRole('button', {
            name: programmingItemSemanticLabel(
              adminProgrammingTitle,
              `${adminProgrammingLocationLabelPattern}[\\s\\S]*${adminProgrammingLocationNamePattern}`,
            ),
          })
          .first(),
        'Programação item must expose the selected location summary after save.',
      ).toBeVisible({ timeout: appBootTimeoutMs });

      await adminProgrammingItemButton.first().click();
      await expect(page.getByText('Editar item de programação')).toBeVisible({
        timeout: appBootTimeoutMs,
      });
      await page.getByRole('button', { name: 'Salvar item' }).click();
      await expect(
        page
          .getByRole('button', {
            name: programmingItemSemanticLabel(
              adminProgrammingTitle,
              `${adminProgrammingLocationLabelPattern}[\\s\\S]*${adminProgrammingLocationNamePattern}`,
            ),
          })
          .first(),
        'Saving an existing programação item without edits must preserve the selected location summary.',
      ).toBeVisible({ timeout: appBootTimeoutMs });

      await adminProgrammingItemButton.first().click();
      await expect(page.getByText('Editar item de programação')).toBeVisible({
        timeout: appBootTimeoutMs,
      });
      const clearProgrammingLocationTrigger = await programmingLocationTriggerLocator(page);
      await selectLocationPickerSheetOption(page, {
        trigger: clearProgrammingLocationTrigger,
        optionText: 'Sem local específico',
        flow: 'evg-admin',
        logStep,
      });
      await page.getByRole('button', { name: 'Salvar item' }).click();

      await expect(
        page
          .getByRole('button', {
            name: programmingItemSemanticLabel(
              adminProgrammingTitle,
              adminProgrammingLocationLabelPattern,
            ),
          })
          .first(),
        'Programação location label must disappear after clearing the item location.',
      ).toHaveCount(0);
      await expect(
        page
          .getByRole('button', {
            name: programmingItemSemanticLabel(
              adminProgrammingTitle,
              adminProgrammingLocationNamePattern,
            ),
          })
          .first(),
        'Programação location name must disappear after clearing the item location.',
      ).toHaveCount(0);
      await expect(
        page.getByText('Local sobrescrito'),
        'Clearing the programação item location must not resurrect occurrence-level location UI.',
      ).toHaveCount(0);
    });

    logStep('admin', 'close second occurrence editor with event-level draft state');
    await closeOccurrenceEditorSheet(page);
    await expect(page.getByText('Datas').first()).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    await expect(page.getByRole('button', { name: 'Remover data' })).toHaveCount(
      2,
      { timeout: appBootTimeoutMs },
    );
    await expect(
      page.getByText(
        'Enquanto o evento tiver só uma ocorrência, a programação dessa data fica visível aqui na raiz do formulário.',
      ),
      'After a second occurrence is created, the root form must stop exposing the direct programação editor.',
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Adicionar item de programação' }),
      'After a second occurrence is created, direct programação authoring must live inside the occurrence editor only.',
    ).toHaveCount(0);

    const updateResponsePromise = page.waitForResponse((candidate) => {
      const method = candidate.request().method().toUpperCase();
      return (
        method === 'PATCH' &&
        candidate.url().includes(`/admin/api/v1/events/${eventId}`) &&
        candidate.status() < 400
      );
    });

    logStep('admin', 'submit event update with two occurrences');
    const submitButton = page.getByRole('button', {
      name: 'Salvar alterações',
    });
    await submitButton.scrollIntoViewIfNeeded();
    await Promise.all([updateResponsePromise, submitButton.click()]);

    const updateResponse = await updateResponsePromise;
    const updatePayload = await updateResponse.json();
    expect(
      updatePayload?.data?.occurrences || [],
      'PATCH response must include both persisted occurrences.',
    ).toHaveLength(2);

    const updatedEvent = await fetchAdminEvent(api, baseUrl, session.token, eventId);
    expect(
      updatedEvent?.occurrences || [],
      'Admin API readback after UI mutation must include both occurrences.',
    ).toHaveLength(2);
    const secondOccurrenceId =
      updatedEvent?.occurrences?.[1]?.occurrence_id?.toString() || '';
    expect(
      secondOccurrenceId,
      'Second occurrence must have a persisted occurrence_id.',
    ).toBeTruthy();

    logStep('admin', 'reload admin list and reopen event to prove UI readback');
    const updatedListLocation = await locateAdminEventListPage(
      api,
      baseUrl,
      session.token,
      eventId,
    );
    await openSeededEventFromAdminList(
      page,
      baseUrl,
      uniqueTitle,
      updatedListLocation.page,
    );
    await scrollUntilVisible(
      page,
      page.getByText('Datas').first(),
      'Occurrence section must be visible after reopening the edited event.',
    );
    await expect(page.getByRole('button', { name: 'Remover data' })).toHaveCount(
      2,
      { timeout: appBootTimeoutMs },
    );

    await test.step('admin location summary remains absent after save and reopen', async () => {
      const reopenedOccurrenceCards = page.getByRole('group', {
        name: /1 item de programação/i,
      });
      await expect(
        reopenedOccurrenceCards,
        'Both persisted occurrences must keep their own programação summary after reopen.',
      ).toHaveCount(2);

      await reopenedOccurrenceCards.nth(0).click();
      await expect(page.getByText('Editar data')).toBeVisible({
        timeout: appBootTimeoutMs,
      });
      await navStep('NAV-16', async () => {
        await expect(
          page.getByRole('button', {
            name: programmingItemSemanticLabel(rootProgrammingTitle),
          }),
          'Programação authored on the single-occurrence root form must be preserved inside the first occurrence editor after a second date is added.',
        ).toBeVisible({ timeout: appBootTimeoutMs });
        await expect(
          page.getByRole('button', {
            name: programmingItemSemanticLabel(adminProgrammingTitle),
          }),
          'Programação created inside the second occurrence editor must not leak into the first occurrence.',
        ).toHaveCount(0);
      });
      await closeOccurrenceEditorSheet(page);

      await reopenedOccurrenceCards.nth(1).click();
      await expect(page.getByText('Editar data')).toBeVisible({
        timeout: appBootTimeoutMs,
      });
      await expect(
        page.getByRole('button', {
          name: programmingItemSemanticLabel(adminProgrammingTitle),
        }),
        'The programação item must remain visible after event save and reopen.',
      ).toBeVisible({ timeout: appBootTimeoutMs });
      await expect(
        page.getByRole('button', {
          name: programmingItemSemanticLabel(rootProgrammingTitle),
        }),
        'Programação authored on the single-occurrence root form must stay scoped to the first occurrence after a second date is added.',
      ).toHaveCount(0);
      await navStep('NAV-17', async () => {
        await expect(
          page
            .getByRole('button', {
              name: programmingItemSemanticLabel(
                adminProgrammingTitle,
                adminProgrammingLocationLabelPattern,
              ),
            })
            .first(),
          'A cleared programação item location label must stay absent after event save and reopen.',
        ).toHaveCount(0);
        await expect(
          page
            .getByRole('button', {
              name: programmingItemSemanticLabel(
                adminProgrammingTitle,
                adminProgrammingLocationNamePattern,
              ),
            })
            .first(),
          'A cleared programação item location name must stay absent after event save and reopen.',
        ).toHaveCount(0);
        await expect(
          page.getByText('Local sobrescrito'),
          'Occurrence-level location UI must stay absent after event save and reopen.',
        ).toHaveCount(0);
      });
      await closeOccurrenceEditorSheet(page);
    });

    let publicDetail;
    await test.step('source public API selected occurrence hydration', async () => {
      publicDetail = await fetchPublicEvent(
        api,
        baseUrl,
        updatedEvent?.slug || eventId,
        secondOccurrenceId,
      );
      expect(
        publicDetail?.occurrence_id?.toString(),
        'Public API detail must hydrate the selected second occurrence.',
      ).toBe(secondOccurrenceId);
      expect(
        publicDetail?.occurrences?.[0]?.is_selected,
        'First occurrence must not be selected when second occurrence is requested.',
      ).toBe(false);
      expect(
        publicDetail?.occurrences?.[1]?.is_selected,
        'Second occurrence must be selected when requested.',
      ).toBe(true);
    });

    const publicBundle = await freshBrowser.newContext({
      ignoreHTTPSErrors: true,
      geolocation: { latitude: -20.671339, longitude: -40.495395 },
      permissions: ['geolocation'],
    });
    publicContext = publicBundle;
    await seedFlutterSecureStorageEntries(publicContext, {
      user_token: await resolveAnonymousIdentityToken(api, baseUrl),
    });
    const publicPage = await publicBundle.newPage();
    const publicCollectors = installFailureCollectors(publicPage);
    const firstOccurrenceId =
      updatedEvent?.occurrences?.[0]?.occurrence_id?.toString() || '';
    expect(
      firstOccurrenceId,
      'First occurrence must have a persisted occurrence_id for list navigation proof.',
    ).toBeTruthy();
    const firstAgendaOccurrenceId = await fetchAgendaOccurrenceIdForTitle(
      api,
      baseUrl,
      uniqueTitle,
    );
    expect(
      firstAgendaOccurrenceId,
      'Public agenda occurrence lookup must resolve the first visible occurrence card.',
    ).toBeTruthy();
    const agendaOccurrenceIds = [
      firstAgendaOccurrenceId,
      ...(updatedEvent?.occurrences || [])
        .map((occurrence) => occurrence?.occurrence_id?.toString() || '')
        .filter(Boolean),
    ];

    logStep('public', 'open public agenda card and return');
    await navStep('NAV-01', async () => {
      await openPublicAgendaCardAndReturn(
        publicPage,
        baseUrl,
        uniqueTitle,
        agendaOccurrenceIds,
      );
    });
    await expect(
      publicPage.getByText(new RegExp(escapeRegExp(uniqueTitle))).first(),
    ).toBeVisible({ timeout: appBootTimeoutMs });
    await expect(
      publicPage.getByText('Datas do evento'),
      'Occurrence list cards must remain card-only; sibling dates belong to detail.',
    ).toHaveCount(0);

    const noProgrammingEvent = await createSingleOccurrenceEvent(
      api,
      baseUrl,
      session.token,
      {
        eventType,
        physicalHost,
        uniqueSuffix: `${uniqueSuffix}-no-programming`,
      },
    );
    noProgrammingEventId = noProgrammingEvent?.event_id?.toString() || null;
    const noProgrammingReadback = noProgrammingEventId
      ? await fetchAdminEvent(api, baseUrl, session.token, noProgrammingEventId)
      : null;
    const noProgrammingOccurrenceId = await fetchAgendaOccurrenceIdForTitle(
      api,
      baseUrl,
      noProgrammingReadback?.title?.toString() ||
        noProgrammingEvent?.title?.toString() ||
        '',
    );
    expect(
      noProgrammingOccurrenceId,
      'No-programming seed must return a persisted occurrence_id.',
    ).toBeTruthy();

    const noProgrammingEventRef =
      noProgrammingReadback?.slug || noProgrammingEvent?.slug || noProgrammingEventId;
    const noProgrammingPath =
      `/agenda/evento/${noProgrammingEventRef}?occurrence=${noProgrammingOccurrenceId}&tab=programming`;

    logStep('public', `open no-programming public detail ${noProgrammingPath}`);
    await gotoPublicEventDetailAndWaitForHydration(
      publicPage,
      baseUrl,
      noProgrammingPath,
      {
        eventRef: noProgrammingEventRef,
        occurrenceId: noProgrammingOccurrenceId,
        title:
          noProgrammingReadback?.title?.toString() ||
          noProgrammingEvent?.title?.toString() ||
          '',
        description: 'No-programming public detail',
      },
    );
    await navStep('NAV-03', async () => {
      await expect(publicPage.getByText('Sobre').first()).toBeVisible({
        timeout: appBootTimeoutMs,
      });
      await expect(
        publicPage.getByText('Playwright SR-D multi-occurrence detail.').first(),
        'tab=programming without any programming must show Sobre content.',
      ).toBeVisible({ timeout: appBootTimeoutMs });
      await expect(
        publicPage.getByText('Programação'),
        'No-programming events must not render Programação; tab=programming falls back to Sobre.',
      ).toHaveCount(0);
    });
    await navStep('NAV-04', async () => {
      await expect(
        publicPage.getByRole('button', { name: /^Datas$/ }),
        'Public event detail must not expose the superseded Datas tab.',
      ).toHaveCount(0);
      await expect(
        publicPage.getByText('Datas do evento'),
        'Public event detail must not expose the superseded Datas do evento section.',
      ).toHaveCount(0);
    });
    await navStep('NAV-11', async () => {
      await expect(
        publicPage.getByText('Playwright SR-D multi-occurrence detail.').first(),
      ).toBeVisible({ timeout: appBootTimeoutMs });
    });
    await navStep('NAV-08', async () => {
      await clickImmersiveTab(publicPage, 'Como Chegar', {
        confirmationLocator: publicPage.getByText(/Ver no mapa/i).first(),
      });
      await expect(publicPage.getByText(physicalHost.display_name).first())
        .toBeVisible({ timeout: appBootTimeoutMs });
      await expect(publicPage.getByText('Outros endereços relacionados')).toHaveCount(
        0,
      );
      await expect(
        publicPage.getByText('Local da programação'),
        'Default-only directions must not create empty programação-location rows.',
      ).toHaveCount(0);
    });
    expect(publicPage.url()).toContain(`occurrence=${noProgrammingOccurrenceId}`);

    const singleProgrammed = await createSingleOccurrenceProgrammedEvent(
      api,
      baseUrl,
      session.token,
      {
        eventType,
        physicalHost,
        relatedProfiles,
        uniqueSuffix: `${uniqueSuffix}-single-programacao`,
        onCreatedEventId: (createdEventId) => {
          singleProgrammedEventId = createdEventId;
        },
      },
    );
    const singleProgrammedEvent = singleProgrammed.data;
    singleProgrammedEventId =
      singleProgrammedEvent?.event_id?.toString() || null;
    const singleProgrammedOccurrenceIds = await fetchAgendaOccurrenceIdsForTitle(
      api,
      baseUrl,
      singleProgrammedEvent?.title?.toString() || '',
    );
    const singleProgrammedOccurrenceId = singleProgrammedOccurrenceIds[0] || '';
    expect(
      singleProgrammedOccurrenceId,
      'Single-occurrence programmed event must have a persisted occurrence_id.',
    ).toBeTruthy();

    const singleProgrammedEventRef =
      singleProgrammedEvent?.slug || singleProgrammedEventId;
    const singleProgrammedPath = `/agenda/evento/${singleProgrammedEventRef}?occurrence=${singleProgrammedOccurrenceId}&tab=programming`;
    logStep(
      'public',
      `open single-occurrence programmed public detail ${singleProgrammedPath}`,
    );
    await gotoPublicEventDetailAndWaitForHydration(
      publicPage,
      baseUrl,
      singleProgrammedPath,
      {
        eventRef: singleProgrammedEventRef,
        occurrenceId: singleProgrammedOccurrenceId,
        title: singleProgrammedEvent?.title?.toString() || '',
        description: 'Single-occurrence programmed public detail',
      },
    );
    await test.step(
      'SR-D2 single-occurrence Programação stays visible without date selector',
      async () => {
        await navStep('NAV-22', async () => {
        await expect(publicPage.getByText('Programação').first()).toBeVisible({
          timeout: appBootTimeoutMs,
        });
        await expect(publicPage.getByText('17:00').first()).toBeVisible({
          timeout: appBootTimeoutMs,
        });
        await expect(
          publicPage.getByText(singleProgrammed.occurrenceParty.display_name).first(),
        ).toBeVisible({
          timeout: appBootTimeoutMs,
        });
        await expect
          .poll(
            () =>
              countTextInViewport(
                publicPage,
                singleProgrammed.occurrenceParty.display_name,
              ),
            {
              timeout: appBootTimeoutMs,
            },
          )
          .toBeLessThanOrEqual(
            2,
            'Participant-only programação cards may expose container + chip semantics, but must not add a fabricated fallback title text.',
          );
        await expect(
          occurrenceDateChipLocator(
            publicPage,
            singleProgrammedEvent?.occurrences?.[0] || null,
          ),
          'Single-occurrence programação must not render the multi-date selector.',
        ).toHaveCount(0);
        await expect(
          legacyOccurrenceDateChipLocator(
            publicPage,
            singleProgrammedEvent?.occurrences?.[0] || null,
          ),
          'Single-occurrence programação must not expose the superseded date+time selector chip.',
        ).toHaveCount(0);
        await expect(
          publicPage.getByText('Atual'),
          'Single-occurrence programação must not expose the old Atual badge.',
        ).toHaveCount(0);
        });
      },
    );

    const programmed = await createProgrammedMultiOccurrenceEvent(
      api,
      baseUrl,
      session.token,
      {
        eventType,
        physicalHost,
        programmingHost,
        relatedProfiles,
        uniqueSuffix: `${uniqueSuffix}-programacao`,
        onCreatedEventId: (createdEventId) => {
          programmedEventId = createdEventId;
        },
      },
    );
    const programmedEvent = programmed.data;
    programmedEventId = programmedEvent?.event_id?.toString() || null;
    const programmedOccurrenceIds = await fetchAgendaOccurrenceIdsForTitle(
      api,
      baseUrl,
      programmedEvent?.title?.toString() || '',
    );
    const programmedSecondOccurrenceId = programmedOccurrenceIds[1] || '';
    expect(
      programmedSecondOccurrenceId,
      'Programmed event second occurrence must have a persisted occurrence_id.',
    ).toBeTruthy();
    const programmedDetail = await fetchPublicEvent(
      api,
      baseUrl,
      programmedEvent?.slug || programmedEventId,
      programmedSecondOccurrenceId,
    );
    expect(programmedDetail?.occurrence_id?.toString()).toBe(
      programmedSecondOccurrenceId,
    );
    const selectedProgrammedOccurrence = (programmedDetail?.occurrences || [])
      .find(
        (occurrence) =>
          occurrence?.occurrence_id?.toString() === programmedSecondOccurrenceId,
      );
    const programmingItems = programmedDetail?.programming_items || [];
    const itemWithoutLocation = programmingItems.find(
      (item) => item?.time === '13:00',
    );
    const itemWithLocation = programmingItems.find(
      (item) => item?.time === '17:00',
    );
    const duplicateLocationItem = programmingItems.find(
      (item) => item?.time === '18:00',
    );
    await navStep('NAV-15', async () => {
      expect(
        selectedProgrammedOccurrence,
        'Programmed public detail must expose the selected occurrence row.',
      ).toBeTruthy();
      expect(
        selectedProgrammedOccurrence?.has_location_override || false,
        'Occurrences must not expose their own location override; the selected occurrence inherits the event location.',
      ).toBe(false);
      expect(
        (programmedDetail?.linked_account_profiles || []).some(
          (profile) => profile?.id?.toString() === programmed.eventParty.id,
        ),
        'Public detail must include event-level related profile.',
      ).toBeTruthy();
      expect(
        (programmedDetail?.linked_account_profiles || []).some(
          (profile) => profile?.id?.toString() === programmed.occurrenceParty.id,
        ),
        'Public detail must include occurrence-owned related profile.',
      ).toBeTruthy();
      expect(
        itemWithLocation?.linked_account_profiles?.[0]?.id?.toString(),
        'Programação item must point at the Account Profile linked to the selected occurrence.',
      ).toBe(programmed.occurrenceParty.id);
    });
    await navStep('NAV-20', async () => {
      expect(itemWithoutLocation?.title).toBe('Atividade sem local');
      expect(itemWithoutLocation?.location_profile || null).toBeNull();
      expect(itemWithLocation?.title).toBeNull();
      expect(
        itemWithLocation?.location_profile?.id?.toString(),
        'Programação item location must come from Account Profile/Map POI place_ref.',
      ).toBe(programmed.programmingHost.id);
      expect(
        duplicateLocationItem?.location_profile?.id?.toString(),
        'Repeated programação locations must remain source-owned for destination dedup proof.',
      ).toBe(programmed.programmingHost.id);
    });
    const programmedFirstOccurrenceId =
      programmedEvent?.occurrences?.[0]?.occurrence_id?.toString() || '';
    expect(
      programmedFirstOccurrenceId,
      'Programmed event first occurrence must expose occurrence_id for occurrence-card payload scope proof.',
    ).toBeTruthy();
    const programmedAgendaRows = await fetchAgendaRowsForTitle(
      api,
      baseUrl,
      programmedEvent?.title?.toString() || '',
    );
    const firstProgrammedAgendaRow = programmedAgendaRows.find(
      (row) => row?.occurrence_id?.toString() === programmedFirstOccurrenceId,
    );
    const secondProgrammedAgendaRow = programmedAgendaRows.find(
      (row) => row?.occurrence_id?.toString() === programmedSecondOccurrenceId,
    );
    expect(
      firstProgrammedAgendaRow,
      'Occurrence-first agenda payload must expose the first programmed occurrence row.',
    ).toBeTruthy();
    expect(
      secondProgrammedAgendaRow,
      'Occurrence-first agenda payload must expose the second programmed occurrence row.',
    ).toBeTruthy();
    const firstProgrammedLinkedIds =
      (firstProgrammedAgendaRow?.linked_account_profiles || [])
        .map((profile) => profile?.id?.toString() || '')
        .filter(Boolean);
    const secondProgrammedLinkedIds =
      (secondProgrammedAgendaRow?.linked_account_profiles || [])
        .map((profile) => profile?.id?.toString() || '')
        .filter(Boolean);
    await navStep('NAV-14', async () => {
      expect(
        firstProgrammedLinkedIds,
        'First programmed occurrence card payload must keep the event-level related profile.',
      ).toContain(programmed.eventParty.id);
      expect(
        firstProgrammedLinkedIds,
        'First programmed occurrence card payload must not leak sibling-occurrence related profiles.',
      ).not.toContain(programmed.occurrenceParty.id);
      expect(
        secondProgrammedLinkedIds,
        'Second programmed occurrence card payload must keep the event-level related profile.',
      ).toContain(programmed.eventParty.id);
      expect(
        secondProgrammedLinkedIds,
        'Second programmed occurrence card payload must keep its own occurrence-level related profile.',
      ).toContain(programmed.occurrenceParty.id);
    });

    const programmedEventRef = programmedEvent?.slug || programmedEventId;
    const programmedPath = `/agenda/evento/${programmedEventRef}?occurrence=${programmedSecondOccurrenceId}&tab=programming`;
    logStep('public', `open programmed public detail ${programmedPath}`);
    await gotoPublicEventDetailAndWaitForHydration(
      publicPage,
      baseUrl,
      programmedPath,
      {
        eventRef: programmedEventRef,
        occurrenceId: programmedSecondOccurrenceId,
        title: programmedEvent?.title?.toString() || '',
        description: 'Programmed public detail',
      },
    );
    await navStep('NAV-04', async () => {
      await expect(
        publicPage.getByRole('button', { name: /^Datas$/ }),
        'Public event detail must not expose the superseded Datas tab when Programação owns date selection.',
      ).toHaveCount(0);
      await expect(publicPage.getByText('Datas do evento')).toHaveCount(0);
      await expect(publicPage.getByText('Programação').first()).toBeVisible({
        timeout: appBootTimeoutMs,
      });
    });
    await navStep('NAV-11', async () => {
      await expect(publicPage.getByText('Programação').first()).toBeVisible({
        timeout: appBootTimeoutMs,
      });
      await expect(
        legacyOccurrenceDateChipLocator(
          publicPage,
          programmedEvent?.occurrences?.[1],
          { selected: true },
        ),
        'Programação must no longer expose the superseded selected date+time chip.',
      ).toHaveCount(0);
      await expect(publicPage.getByText('Atual')).toHaveCount(0, {
        timeout: appBootTimeoutMs,
      });
      await expect(publicPage.getByText('17:00').first()).toBeVisible({
        timeout: appBootTimeoutMs,
      });
    });
    await navStep('NAV-05', async () => {
      await expect(
        publicPage.getByText(programmed.occurrenceParty.display_name).first(),
      ).toBeVisible({ timeout: appBootTimeoutMs });
      const participantOnlyTime = publicPage.getByText('17:00').first();
      const followingTime = publicPage.getByText('18:00').first();
      const participantOnlyBox = await participantOnlyTime.boundingBox();
      const followingBox = await followingTime.boundingBox();
      expect(
        participantOnlyBox,
        'Participant-only programação card must expose its time chip before scoped text assertions.',
      ).toBeTruthy();
      expect(
        followingBox,
        'The following programação card must expose its time chip so the scoped viewport band stays deterministic.',
      ).toBeTruthy();
      await expect
        .poll(
          () =>
            countTextInVerticalBand(
              publicPage,
              programmed.occurrenceParty.display_name,
              participantOnlyBox.y - 8,
              followingBox.y - 8,
            ),
          {
            timeout: appBootTimeoutMs,
          },
        )
        .toBe(
          1,
          'Participant-only programação cards must not duplicate the participant name as fallback title text.',
        );
    });
    await navStep('NAV-18', async () => {
      const participantText = publicPage
        .getByText(programmed.occurrenceParty.display_name)
        .first();
      const participantTextBox = await participantText.boundingBox();
      const viewport =
        publicPage.viewportSize() ||
        (await publicPage.evaluate(() => ({
          width: window.innerWidth,
          height: window.innerHeight,
        })));
      expect(
        participantTextBox,
        'Participant chip text must expose a visible box for overflow guard.',
      ).toBeTruthy();
      expect(
        participantTextBox.x + participantTextBox.width,
        'Participant chip text must stay inside the viewport instead of leaking outside the pill.',
      ).toBeLessThanOrEqual(viewport.width - 8);
    });
    await navStep('NAV-07', async () => {
      const locationlessTime = publicPage.getByText('13:00').first();
      const locationlessTitle = publicPage.getByText('Atividade sem local').first();
      const nextItemTime = publicPage.getByText('17:00').first();
      await expect(locationlessTime).toBeVisible({
        timeout: appBootTimeoutMs,
      });
      await expect(locationlessTitle).toBeVisible({
        timeout: appBootTimeoutMs,
      });
      await expect(nextItemTime).toBeVisible({
        timeout: appBootTimeoutMs,
      });
      await assertTextDoesNotAppearBetween(
        publicPage,
        'Local da programação',
        locationlessTitle,
        nextItemTime,
        'Location-less programação item must not render a blank location row before Como Chegar.',
      );
    });
    await navStep('NAV-06', async () => {
      await expect(
        publicPage.getByText(programmed.programmingHost.display_name).first(),
      ).toBeVisible({ timeout: appBootTimeoutMs });
      await clickLocatorCenter(
        publicPage,
        publicPage.getByText(programmed.programmingHost.display_name).first(),
        'Programação item location must be a real tappable map affordance.',
      );
      await expect(publicPage).toHaveURL(/\/mapa(?:\?|$)/, {
        timeout: appBootTimeoutMs,
      });
      expect(decodeURIComponent(publicPage.url())).toContain(
        `poi=account_profile:${programmed.programmingHost.id}`,
      );
    });

    const firstProgrammedOccurrenceId = programmedOccurrenceIds[0] || '';
    expect(firstProgrammedOccurrenceId).toBeTruthy();
    await gotoPublicEventDetailAndWaitForHydration(
      publicPage,
      baseUrl,
      programmedPath,
      {
        eventRef: programmedEventRef,
        occurrenceId: programmedSecondOccurrenceId,
        title: programmedEvent?.title?.toString() || '',
        description: 'Programmed public detail before date selector proof',
      },
    );
    await navStep('NAV-19', async () => {
      const selectedProgrammedDateLabel = formatOccurrenceDateLabel(
        programmedEvent?.occurrences?.[1]?.date_time_start,
      );
      await expect(
        publicPage.getByText(new RegExp(escapeRegExp(selectedProgrammedDateLabel))).first(),
        'Selected Programação date label must stay visible under the compact date+weekday contract.',
      ).toBeVisible({ timeout: appBootTimeoutMs });
      await expect(
        legacyOccurrenceDateChipLocator(publicPage, programmedEvent?.occurrences?.[1], {
          selected: true,
        }),
        'Programação date selector must not use the superseded date+time+Atual chip contract.',
      ).toHaveCount(0);
      await expect(publicPage.getByText('Atual')).toHaveCount(0);
    });
    await navStep('NAV-02', async () => {
      const firstProgrammedOccurrence = programmedEvent?.occurrences?.[0];
      const warmSwitchMarker = await publicPage.evaluate(() => {
        if (!window.__occurrenceWarmSwitchMarker) {
          window.__occurrenceWarmSwitchMarker = Math.random()
            .toString(36)
            .slice(2);
        }
        return window.__occurrenceWarmSwitchMarker;
      });
      await expect(
        legacyOccurrenceDateChipLocator(publicPage, firstProgrammedOccurrence),
        'Programação date selector must not use the superseded date+time chip contract.',
      ).toHaveCount(0);
      await clickOccurrenceDateChip(
        publicPage,
        firstProgrammedOccurrence,
        'Programação date selector must expose the first occurrence as a clickable date button under the current contract.',
      );
      await expect(publicPage).toHaveURL(
        new RegExp(`occurrence=${firstProgrammedOccurrenceId}`),
        { timeout: appBootTimeoutMs },
      );
      await expect
        .poll(
          async () =>
            publicPage.evaluate(
              () => window.__occurrenceWarmSwitchMarker ?? null,
            ),
          {
            timeout: appBootTimeoutMs,
            message:
              'Programação occurrence switching must stay inside the warm SPA/runtime flow and must not hard reload the page.',
          },
        )
        .toBe(warmSwitchMarker);
      await expect(
        legacyOccurrenceDateChipLocator(publicPage, firstProgrammedOccurrence, {
          selected: true,
        }),
        'Selected date buttons must not expose the superseded date+time+Atual contract.',
      ).toHaveCount(0);
      await expect(
        publicPage.getByText('Atual'),
        'Programação date selector must not expose the old Atual badge after switching dates.',
      ).toHaveCount(0);
      await expect(
        publicPage.getByText(
          new RegExp(escapeRegExp(formatOccurrenceDateLabel(firstProgrammedOccurrence?.date_time_start))),
        ).first(),
        'After selecting the first occurrence, its date chip must remain visible under the current contract, even though the selected chip is no longer exposed as a button role.',
      ).toBeVisible({ timeout: appBootTimeoutMs });
      await expect(
        publicPage.getByText('Esta data ainda não tem programação cadastrada.').first(),
      ).toBeVisible({ timeout: appBootTimeoutMs });
      await expect(publicPage.getByText('17:00')).toHaveCount(0);
    });
    await navStep('NAV-12', async () => {
      await expect(
        publicPage.getByText('Esta data ainda não tem programação cadastrada.').first(),
      ).toBeVisible({ timeout: appBootTimeoutMs });
      await expect(publicPage).toHaveURL(
        new RegExp(`occurrence=${firstProgrammedOccurrenceId}`),
        { timeout: appBootTimeoutMs },
      );
    });

    await gotoPublicEventDetailAndWaitForHydration(
      publicPage,
      baseUrl,
      programmedPath,
      {
        eventRef: programmedEventRef,
        occurrenceId: programmedSecondOccurrenceId,
        title: programmedEvent?.title?.toString() || '',
        description: 'Programmed public detail before Como Chegar proof',
      },
    );
    await navStep('NAV-09', async () => {
      const mapCard = publicPage.getByText(/Ver no mapa/i).first();
      const relatedLocationsHeading = publicPage.getByText(
        'Outros endereços relacionados',
      ).first();
      await clickImmersiveTab(publicPage, 'Como Chegar', {
        confirmationLocator: mapCard,
      });
      await expect(
        mapCard,
        'Como Chegar must be the active visible section before destination assertions.',
      ).toBeVisible({ timeout: appBootTimeoutMs });
      await expect(
        publicPage.getByRole('button', { name: /^Waze$/ }).first(),
        'Como Chegar must expose the direct Waze provider action in the browser runtime.',
      ).toBeVisible({ timeout: appBootTimeoutMs });
      await expect(
        publicPage.getByRole('button', { name: /^Uber$/ }).first(),
        'Como Chegar must expose the direct Uber provider action in the browser runtime.',
      ).toBeVisible({ timeout: appBootTimeoutMs });
      await expect(
        publicPage.getByRole('button', { name: /^Outros$/ }).first(),
        'Como Chegar must expose the accessible three-dots Outros provider action in the browser runtime.',
      ).toBeVisible({ timeout: appBootTimeoutMs });
      await expect(
        publicPage.getByRole('button', { name: /Traçar rota/i }),
        'Como Chegar must not expose the removed tab-specific Traçar rota CTA in the browser runtime.',
      ).toHaveCount(0);
      await expect(publicPage.getByText(physicalHost.display_name).first())
        .toBeVisible({ timeout: appBootTimeoutMs });
      await expect(
        relatedLocationsHeading,
      ).toBeVisible({ timeout: appBootTimeoutMs });
      await expect(publicPage.getByText('Local da programação')).toHaveCount(0);
      await expect
        .poll(() => countTextInViewport(publicPage, 'Atividade sem local'), {
          timeout: appBootTimeoutMs,
        })
        .toBe(
          0,
          'Location-less programação items must not become visible Como Chegar destinations.',
        );
      await expect
        .poll(() => isImmersiveTabSelected(publicPage, 'Como Chegar'), {
          timeout: appBootTimeoutMs,
        })
        .toBe(true);
      await scrollDownUntilTextInViewport(
        publicPage,
        programmed.programmingHost.display_name,
        'Programação item Account Profile/POI location must be listed in Como Chegar.',
      );
      await waitForTextInViewport(
        publicPage,
        programmed.programmingHost.display_name,
        'Programação item Account Profile/POI location must be visible after scrolling Como Chegar.',
      );
    });
    await navStep('NAV-10', async () => {
      const relatedLocationsHeading = publicPage.getByText(
        'Outros endereços relacionados',
      ).first();
      await expect
        .poll(
          async () => {
            if (!(await isImmersiveTabSelected(publicPage, 'Como Chegar'))) {
              await clickImmersiveTab(publicPage, 'Como Chegar', {
                confirmationLocator: relatedLocationsHeading,
              });
            }
            let visibleCount = await countTextInViewport(
              publicPage,
              programmed.programmingHost.display_name,
            );
            if (visibleCount === 0) {
              await scrollDownUntilTextInViewport(
                publicPage,
                programmed.programmingHost.display_name,
                'Repeated programação place_ref must become visible inside Como Chegar before dedupe assertions.',
              );
              visibleCount = await countTextInViewport(
                publicPage,
                programmed.programmingHost.display_name,
              );
            }
            return visibleCount;
          },
          {
            timeout: appBootTimeoutMs,
          },
        )
        .toBe(
          1,
          'Repeated programação place_ref must render one visible Como Chegar destination.',
        );
      await expect(publicPage.getByText('Local da programação')).toHaveCount(0);
    });
    await navStep('NAV-21', async () => {
      await expect(publicPage.getByText(physicalHost.display_name).first())
        .toBeVisible({ timeout: appBootTimeoutMs });
      await expect(
        publicPage.getByText('Outros endereços relacionados').first(),
      ).toBeVisible({ timeout: appBootTimeoutMs });
      await expect
        .poll(
          () =>
            countTextInViewport(
              publicPage,
              programmed.programmingHost.display_name,
            ),
          {
            timeout: appBootTimeoutMs,
          },
        )
        .toBe(1);
    });

    const futureLaterEvent = await createPastFirstFutureLaterOccurrenceEvent(
      api,
      baseUrl,
      session.token,
      {
        eventType,
        physicalHost,
        uniqueSuffix: `${uniqueSuffix}-future-later`,
      },
    );
    futureLaterEventId = futureLaterEvent?.event_id?.toString() || null;
    const futureLaterTitle = futureLaterEvent?.title?.toString() || '';
    expect(futureLaterEventId, 'Future-later seed must return event_id.')
      .toBeTruthy();
    await navStep('NAV-13', async () => {
      const futureLaterListLocation = await locateAdminEventListPage(
        api,
        baseUrl,
        session.token,
        futureLaterEventId,
      );
      await openSeededEventFromAdminList(
        page,
        baseUrl,
        futureLaterTitle,
        futureLaterListLocation.page,
      );
      await expect(page).toHaveURL(adminEventEditRoutePattern, {
        timeout: appBootTimeoutMs,
      });
    });

    await assertAllMultiOccurrenceNavigationStepsExecuted();
    await assertNoBrowserFailures(collectors, {
      allowedConsoleErrorSubstrings: [
        'Failed to load resource: the server responded with a status of 422',
      ],
      allowedResponseStatuses: [422],
    });
    await assertNoBrowserFailures(publicCollectors);
  } finally {
    if (session?.token) {
      await deleteEvent(api, baseUrl, session.token, futureLaterEventId);
      await deleteEvent(api, baseUrl, session.token, programmedEventId);
      await deleteEvent(api, baseUrl, session.token, singleProgrammedEventId);
      await deleteEvent(api, baseUrl, session.token, noProgrammingEventId);
      await deleteEvent(api, baseUrl, session.token, eventId);
      await deleteEventType(api, baseUrl, session.token, eventTypeId);
      await cleanupOnboardedAccount(api, baseUrl, session.token, createdProgrammingHostAccountSlug);
      await cleanupOnboardedAccount(api, baseUrl, session.token, createdPhysicalHostAccountSlug);
      await cleanupOnboardedAccounts(api, baseUrl, session.token, createdSeedAccountSlugs);
      await deleteAccountProfileType(api, baseUrl, session.token, createdProfileType);
      for (const profileType of createdSeedProfileTypes) {
        if (profileType !== createdProfileType) {
          await deleteAccountProfileType(api, baseUrl, session.token, profileType);
        }
      }
    }
    if (publicContext) {
      await publicContext.close().catch(() => {});
    }
    if (browserContext) {
      await browserContext.close().catch(() => {});
    }
    if (freshBrowser) {
      await freshBrowser.close().catch(() => {});
    }
    await api.dispose();
  }
});

test('@mutation repeated public event detail GET/hydration keeps programming payload stable', async ({
  page,
}) => {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  let session = null;
  let eventTypeId = null;
  let firstEventId = null;
  let secondEventId = null;
  const createdSeedProfileIds = [];
  const createdSeedAccountSlugs = [];
  const createdSeedProfileTypes = new Set();

  try {
    session = await loginTenantAdmin(api, baseUrl);
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const eventType = await createEventType(
      api,
      baseUrl,
      session.token,
      `${uniqueSuffix}-stability`,
    );
    eventTypeId = eventType?.id?.toString() || null;

    const physicalHostSeed = await ensurePhysicalHostCandidates(
      api,
      baseUrl,
      session.token,
      2,
    );
    createdSeedProfileIds.push(...physicalHostSeed.createdProfileIds);
    createdSeedAccountSlugs.push(...physicalHostSeed.createdAccountSlugs);
    if (physicalHostSeed.createdType) {
      createdSeedProfileTypes.add(physicalHostSeed.createdType);
    }
    const physicalHost = physicalHostSeed.candidates[0];
    const programmingHost = physicalHostSeed.candidates[1];
    const relatedProfileSeed = await fetchRelatedAccountProfileCandidates(
      api,
      baseUrl,
      session.token,
      {
        excludeIds: [physicalHost.id, programmingHost.id],
      },
    );
    createdSeedProfileIds.push(...relatedProfileSeed.createdProfileIds);
    createdSeedAccountSlugs.push(...relatedProfileSeed.createdAccountSlugs);
    if (relatedProfileSeed.createdType) {
      createdSeedProfileTypes.add(relatedProfileSeed.createdType);
    }
    const relatedProfiles = relatedProfileSeed.candidates;
    const occurrenceProfileWithMedia = relatedProfiles[1] || relatedProfiles[0];
    expect(
      occurrenceProfileWithMedia?.id,
      'Public occurrence runtime proof requires a related profile candidate for media seeding.',
    ).toBeTruthy();
    await uploadAccountProfileFixtureMedia(
      api,
      baseUrl,
      session.token,
      occurrenceProfileWithMedia.id,
    );

    const firstProgrammed = await createProgrammedMultiOccurrenceEvent(
      api,
      baseUrl,
      session.token,
      {
        eventType,
        physicalHost,
        programmingHost,
        relatedProfiles,
        uniqueSuffix: `${uniqueSuffix}-stable-a`,
        onCreatedEventId: (createdEventId) => {
          firstEventId = createdEventId;
        },
      },
    );
    const secondProgrammed = await createProgrammedMultiOccurrenceEvent(
      api,
      baseUrl,
      session.token,
      {
        eventType,
        physicalHost,
        programmingHost,
        relatedProfiles,
        uniqueSuffix: `${uniqueSuffix}-stable-b`,
        onCreatedEventId: (createdEventId) => {
          secondEventId = createdEventId;
        },
      },
    );

    const firstEvent = firstProgrammed.data;
    const secondEvent = secondProgrammed.data;
    firstEventId = firstEvent?.event_id?.toString() || null;
    secondEventId = secondEvent?.event_id?.toString() || null;

    const firstOccurrenceIds = await fetchAgendaOccurrenceIdsForTitle(
      api,
      baseUrl,
      firstEvent?.title?.toString() || '',
    );
    const secondOccurrenceIds = await fetchAgendaOccurrenceIdsForTitle(
      api,
      baseUrl,
      secondEvent?.title?.toString() || '',
    );
    const firstOccurrenceId = firstOccurrenceIds[1] || '';
    const secondOccurrenceId = secondOccurrenceIds[1] || '';
    expect(firstOccurrenceId, 'First programmed event must expose occurrence_id.')
      .toBeTruthy();
    expect(secondOccurrenceId, 'Second programmed event must expose occurrence_id.')
      .toBeTruthy();

    const firstEventRef = firstEvent?.slug || firstEventId;
    const secondEventRef = secondEvent?.slug || secondEventId;
    const firstTitle = firstEvent?.title?.toString() || '';
    const secondTitle = secondEvent?.title?.toString() || '';

    const firstSnapshotBefore = stableEventDetailSnapshot(
      await fetchPublicEvent(api, baseUrl, firstEventRef, firstOccurrenceId),
    );
    const secondSnapshotBefore = stableEventDetailSnapshot(
      await fetchPublicEvent(api, baseUrl, secondEventRef, secondOccurrenceId),
    );

    const collectors = installFailureCollectors(page);

    for (const step of [
      {
        title: firstTitle,
        eventRef: firstEventRef,
        occurrenceId: firstOccurrenceId,
        description: 'Programmed event A first read',
      },
      {
        title: secondTitle,
        eventRef: secondEventRef,
        occurrenceId: secondOccurrenceId,
        description: 'Programmed event B read',
      },
      {
        title: firstTitle,
        eventRef: firstEventRef,
        occurrenceId: firstOccurrenceId,
        description: 'Programmed event A second read',
      },
    ]) {
      const path = `/agenda/evento/${step.eventRef}?occurrence=${step.occurrenceId}&tab=programming`;
      await gotoPublicEventDetailAndWaitForHydration(page, baseUrl, path, {
        eventRef: step.eventRef,
        occurrenceId: step.occurrenceId,
        title: step.title,
        description: step.description,
      });
      await expect(page.getByText('Programação').first()).toBeVisible({
        timeout: appBootTimeoutMs,
      });
      await expect(page.getByText('17:00').first()).toBeVisible({
        timeout: appBootTimeoutMs,
      });
      await expect(
        page.getByText(firstProgrammed.occurrenceParty.display_name).first(),
      ).toBeVisible({
        timeout: appBootTimeoutMs,
      });
      await expect(
        page.getByText(programmingHost.display_name).first(),
      ).toBeVisible({
        timeout: appBootTimeoutMs,
      });
    }

    const firstSnapshotAfter = stableEventDetailSnapshot(
      await fetchPublicEvent(api, baseUrl, firstEventRef, firstOccurrenceId),
    );
    const secondSnapshotAfter = stableEventDetailSnapshot(
      await fetchPublicEvent(api, baseUrl, secondEventRef, secondOccurrenceId),
    );

    expect(
      firstSnapshotAfter,
      'Repeated A→B→A public navigation must not degrade event A selected-occurrence payload.',
    ).toEqual(firstSnapshotBefore);
    expect(
      secondSnapshotAfter,
      'Interleaved public navigation must not degrade event B selected-occurrence payload.',
    ).toEqual(secondSnapshotBefore);

    await assertNoBrowserFailures(collectors);
  } finally {
    if (session?.token) {
      await deleteEvent(api, baseUrl, session.token, secondEventId);
      await deleteEvent(api, baseUrl, session.token, firstEventId);
      await deleteEventType(api, baseUrl, session.token, eventTypeId);
      await cleanupOnboardedAccounts(api, baseUrl, session.token, createdSeedAccountSlugs);
      for (const profileType of createdSeedProfileTypes) {
        await deleteAccountProfileType(api, baseUrl, session.token, profileType);
      }
    }
    await api.dispose();
  }
});

test('@mutation admin-authored occurrence profile groups persist full chip readback and public aggregation', async ({
  browser,
}) => {
  test.setTimeout(600000);
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  let browserContext;
  let publicContext;
  let session = null;
  let eventTypeId = null;
  let eventId = null;
  const createdSeedAccountSlugs = [];
  const createdSeedProfileTypes = new Set();

  try {
    session = await loginTenantAdmin(api, baseUrl);
    await deleteStaleOccurrenceSeedEvents(api, baseUrl, session.token);

    const eventType = await createEventType(
      api,
      baseUrl,
      session.token,
      `${uniqueSuffix}-groups`,
    );
    eventTypeId = eventType?.id?.toString() || null;

    const physicalHostSeed = await ensurePhysicalHostCandidates(
      api,
      baseUrl,
      session.token,
      1,
    );
    createdSeedAccountSlugs.push(...physicalHostSeed.createdAccountSlugs);
    if (physicalHostSeed.createdType) {
      createdSeedProfileTypes.add(physicalHostSeed.createdType);
    }
    const physicalHost = physicalHostSeed.candidates[0];

    const relatedProfileSeed = await createDedicatedRelatedProfiles(
      api,
      baseUrl,
      session.token,
      uniqueSuffix,
    );
    createdSeedAccountSlugs.push(...relatedProfileSeed.createdAccountSlugs);
    if (relatedProfileSeed.createdType) {
      createdSeedProfileTypes.add(relatedProfileSeed.createdType);
    }
    const [bandLead, bandSupport, guestOne, guestTwo] =
      relatedProfileSeed.candidates;
    const bandLeadName = relatedProfileDisplayName(bandLead);
    const bandSupportName = relatedProfileDisplayName(bandSupport);
    const guestOneName = relatedProfileDisplayName(guestOne);
    const guestTwoName = relatedProfileDisplayName(guestTwo);
    expect(
      [bandLeadName, bandSupportName, guestOneName, guestTwoName].every(Boolean),
      'Occurrence profile group mutation proof requires four displayable related profile candidates.',
    ).toBe(true);

    const seededEvent = await createSingleOccurrenceEvent(
      api,
      baseUrl,
      session.token,
      {
        eventType,
        physicalHost,
        uniqueSuffix: `${uniqueSuffix}-groups`,
      },
    );
    eventId = seededEvent?.event_id?.toString() || null;
    const uniqueTitle = seededEvent?.title?.toString() || '';
    expect(eventId, 'Seeded event must return event_id.').toBeTruthy();
    expect(uniqueTitle, 'Seeded event must return title.').toBeTruthy();

    const seededListLocation = await locateAdminEventListPage(
      api,
      baseUrl,
      session.token,
      eventId,
    );

    const adminBundle = await createAuthenticatedTenantAdminPage(
      browser,
      session,
    );
    browserContext = adminBundle.context;
    const page = adminBundle.page;
    const collectors = installFailureCollectors(page);
    const aggregateEventWrites = [];
    const trackAggregateEventWrite = (request) => {
      const method = request.method().toUpperCase();
      if (method !== 'PATCH') {
        return;
      }
      let url;
      try {
        url = new URL(request.url());
      } catch (_) {
        return;
      }
      if (url.pathname === `/admin/api/v1/events/${eventId}`) {
        aggregateEventWrites.push(url.toString());
      }
    };
    page.on('request', trackAggregateEventWrite);

    const initialAdminEvent = await fetchAdminEvent(
      api,
      baseUrl,
      session.token,
      eventId,
    );
    const initialOccurrences = initialAdminEvent?.occurrences || [];
    const initialFirstOccurrence = initialOccurrences[0] || null;
    const initialFirstOccurrenceId =
      initialFirstOccurrence?.occurrence_id?.toString() || '';
    expect(
      initialFirstOccurrenceId,
      'Seeded event must expose the persisted primary occurrence id before dedicated group creation.',
    ).toBeTruthy();

    await openSeededEventFromAdminList(
      page,
      baseUrl,
      uniqueTitle,
      seededListLocation.page,
    );
    logStep('evg-admin', 'seeded event opened in admin list');

    const editPrimaryOccurrenceButton = page.getByRole('button', {
      name: 'Editar ocorrência principal',
    });
    await scrollUntilVisible(
      page,
      editPrimaryOccurrenceButton,
      'Single-occurrence event must expose the primary occurrence editor entrypoint.',
    );
    await editPrimaryOccurrenceButton.click();
    await expect(page.getByText('Editar ocorrência principal')).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    logStep('evg-admin', 'primary occurrence editor opened');
    await scrollUntilVisible(
      page,
      page.getByText('Abas de perfis próprios da ocorrência').first(),
      'Occurrence group editor must be visible in the first occurrence sheet.',
    );
    const createFirstGroupResponsePromise = page.waitForResponse((candidate) => {
      return (
        candidate.request().method() === 'POST' &&
        candidate.url().includes(
          `/admin/api/v1/events/${eventId}/occurrences/${initialFirstOccurrenceId}/profile_groups`,
        ) &&
        candidate.status() < 400
      );
    });
    await addOccurrenceProfileGroup(page, {
      groupLabel: 'Bandas',
    });
    await createFirstGroupResponsePromise;
    logStep('evg-admin', 'first occurrence group metadata authored through dedicated endpoint');
    await expect
      .poll(
        async () => {
          const event = await fetchAdminEvent(api, baseUrl, session.token, eventId);
          const occurrence = (event?.occurrences || []).find(
            (candidate) =>
              candidate?.occurrence_id?.toString() === initialFirstOccurrenceId,
          );
          const bandasGroup =
            (occurrence?.profile_groups || []).find(
              (group) => group?.label === 'Bandas',
            ) || null;
          return [
            bandasGroup?.id?.toString() || '',
            bandasGroup?.label?.toString() || '',
            Number(bandasGroup?.member_count || 0),
          ].join('|');
        },
        {
          timeout: appBootTimeoutMs,
          message:
            'First occurrence dedicated create must persist the group head immediately in admin readback.',
        },
      )
      .toMatch(/^[^|]+\|Bandas\|0$/);
    expect(
      aggregateEventWrites,
      'Dedicated first-occurrence group creation must not fall back to aggregate event PATCH writes.',
    ).toHaveLength(0);
    await closeOccurrenceEditorSheet(page);
    logStep('evg-admin', 'first occurrence editor closed');

    await clickVisibleAddOccurrenceAffordance(page);
    logStep('evg-admin', 'second occurrence draft opened');
    await closeOccurrenceEditorSheet(page);
    logStep('evg-admin', 'second occurrence editor closed before root save');

    const updateResponsePromise = page.waitForResponse((candidate) => {
      const method = candidate.request().method().toUpperCase();
      return (
        method === 'PATCH' &&
        candidate.url().includes(`/admin/api/v1/events/${eventId}`) &&
        candidate.status() < 400
      );
    });
    const submitButton = page.getByRole('button', {
      name: 'Salvar alterações',
    });
    await submitButton.scrollIntoViewIfNeeded();
    await Promise.all([updateResponsePromise, submitButton.click()]);
    await updateResponsePromise;
    logStep('evg-admin', 'root event save completed');
    expect(
      aggregateEventWrites.length,
      'Persisting the newly added second occurrence must use the aggregate event save exactly once.',
    ).toBeGreaterThanOrEqual(1);
    aggregateEventWrites.length = 0;

    const metadataSavedEvent = await fetchAdminEvent(api, baseUrl, session.token, eventId);
    const firstOccurrence = metadataSavedEvent?.occurrences?.[0] || null;
    const secondOccurrence = metadataSavedEvent?.occurrences?.[1] || null;
    const firstOccurrenceId =
      firstOccurrence?.occurrence_id?.toString() || '';
    const secondOccurrenceId =
      secondOccurrence?.occurrence_id?.toString() || '';
    const firstGroupId =
      firstOccurrence?.profile_groups?.[0]?.id?.toString() ||
      firstOccurrence?.profile_groups?.[0]?.key?.toString() ||
      '';
    const secondGroupId =
      secondOccurrence?.profile_groups?.[0]?.id?.toString() ||
      secondOccurrence?.profile_groups?.[0]?.key?.toString() ||
      '';
    expect(
      metadataSavedEvent?.occurrences || [],
      'Profile-group authoring proof must persist two occurrences.',
    ).toHaveLength(2);
    expect(
      firstOccurrenceId,
      'First occurrence must persist occurrence_id for aggregate event assertions.',
    ).toBeTruthy();
    expect(
      secondOccurrenceId,
      'Second occurrence must persist occurrence_id for aggregate event assertions.',
    ).toBeTruthy();
    const secondOccurrenceStart =
      secondOccurrence?.date_time_start ||
      secondOccurrence?.dateTimeStart ||
      secondOccurrence?.start_at ||
      secondOccurrence?.starts_at ||
      '';
    expect(
      secondOccurrenceStart,
      'Second occurrence must expose a persisted start value so the browser proof can reopen the editor.',
    ).toBeTruthy();
    expect(
      firstGroupId,
      'First occurrence admin readback must preserve the canonical group id after the root save.',
    ).toBeTruthy();
    logStep('evg-admin', 'reload admin list and reopen event after root save');
    const updatedListLocation = await locateAdminEventListPage(
      api,
      baseUrl,
      session.token,
      eventId,
    );
    await openSeededEventFromAdminList(
      page,
      baseUrl,
      uniqueTitle,
      updatedListLocation.page,
      'evg-admin',
    );
    await scrollUntilVisible(
      page,
      page.getByText('Datas').first(),
      'Occurrence section must be visible after reopening the edited event.',
    );
    await openOccurrenceEditorForStart(
      page,
      secondOccurrenceStart,
      'Second occurrence card must reopen the occurrence editor after the root save.',
    );
    await scrollUntilVisible(
      page,
      page.getByText('Abas de perfis próprios da ocorrência').first(),
      'Occurrence group editor must stay visible when reopening the persisted second occurrence.',
    );
    const createSecondGroupResponsePromise = page.waitForResponse((candidate) => {
      return (
        candidate.request().method() === 'POST' &&
        candidate.url().includes(
          `/admin/api/v1/events/${eventId}/occurrences/${secondOccurrenceId}/profile_groups`,
        ) &&
        candidate.status() < 400
      );
    });
    await addOccurrenceProfileGroup(page, {
      groupLabel: 'Outro Grupo',
    });
    await createSecondGroupResponsePromise;
    logStep('evg-admin', 'second occurrence group metadata authored through dedicated endpoint');
    expect(
      aggregateEventWrites,
      'Dedicated second-occurrence group creation must not fall back to aggregate event PATCH writes.',
    ).toHaveLength(0);
    await closeOccurrenceEditorSheet(page);
    logStep('evg-admin', 'second occurrence editor closed after dedicated group creation');

    const metadataAfterDedicatedCreate = await fetchAdminEvent(
      api,
      baseUrl,
      session.token,
      eventId,
    );
    const firstOccurrenceAfterCreate =
      (metadataAfterDedicatedCreate?.occurrences || []).find(
        (candidate) =>
          candidate?.occurrence_id?.toString() === firstOccurrenceId,
      ) || null;
    const secondOccurrenceAfterCreate =
      (metadataAfterDedicatedCreate?.occurrences || []).find(
        (candidate) =>
          candidate?.occurrence_id?.toString() === secondOccurrenceId,
      ) || null;
    const firstGroupIdAfterCreate =
      firstOccurrenceAfterCreate?.profile_groups?.[0]?.id?.toString() || '';
    const secondGroupIdAfterCreate =
      secondOccurrenceAfterCreate?.profile_groups?.[0]?.id?.toString() || '';
    expect(
      secondOccurrenceAfterCreate?.profile_groups?.[0]?.label,
      'Second occurrence admin readback must keep the custom occurrence group label after dedicated creation.',
    ).toBe('Outro Grupo');
    expect(
      firstGroupIdAfterCreate,
      'First occurrence admin readback must expose a canonical group id after the replay-safe second occurrence flow.',
    ).toBeTruthy();
    expect(
      secondGroupIdAfterCreate,
      'Second occurrence admin readback must expose a canonical group id after the dedicated create.',
    ).toBeTruthy();
    const firstMembersResponse = await api.patch(
      buildApiUrl(
        baseUrl,
        `/admin/api/v1/events/${eventId}/occurrences/${firstOccurrenceId}/profile_groups/${firstGroupIdAfterCreate}/members`,
      ),
      {
        data: {
          add_ids: [bandLead.id, bandSupport.id],
        },
        headers: authHeaders(session.token),
      },
    );
    expect(
      firstMembersResponse.status(),
      'First occurrence canonical group members patch must succeed after the root save.',
    ).toBeLessThan(400);
    const secondMembersResponse = await api.patch(
      buildApiUrl(
        baseUrl,
        `/admin/api/v1/events/${eventId}/occurrences/${secondOccurrenceId}/profile_groups/${secondGroupIdAfterCreate}/members`,
      ),
      {
        data: {
          add_ids: [
            guestOne.id,
            guestTwo.id,
            bandLead.id,
            bandSupport.id,
          ],
        },
        headers: authHeaders(session.token),
      },
    );
    expect(
      secondMembersResponse.status(),
      'Second occurrence canonical group members patch must succeed after the root save.',
    ).toBeLessThan(400);
    logStep('evg-admin', 'canonical occurrence group members patched after root save');

    await expect
      .poll(
        async () => {
          const event = await fetchAdminEvent(api, baseUrl, session.token, eventId);
          return [
            Number(event?.occurrences?.[0]?.profile_groups?.[0]?.member_count || 0),
            Number(event?.occurrences?.[1]?.profile_groups?.[0]?.member_count || 0),
          ].join(',');
        },
        {
          timeout: appBootTimeoutMs,
          message:
            'Admin event readback must reflect canonical member counts after the post-save occurrence-group patch.',
        },
      )
      .toBe('2,4');
    page.off('request', trackAggregateEventWrite);

    const updatedEvent = await fetchAdminEvent(api, baseUrl, session.token, eventId);
    const updatedFirstOccurrence = updatedEvent?.occurrences?.[0] || null;
    const updatedSecondOccurrence = updatedEvent?.occurrences?.[1] || null;
    expect(
      Number(updatedFirstOccurrence?.profile_groups?.[0]?.member_count || 0),
      'First occurrence admin readback must preserve the persisted member count after canonical group management.',
    ).toBe(2);
    expect(
      Number(updatedSecondOccurrence?.profile_groups?.[0]?.member_count || 0),
      'Second occurrence admin readback must stay summary-only while preserving the persisted member count.',
    ).toBe(4);
    const firstOccurrenceStart =
      updatedFirstOccurrence?.date_time_start ||
      updatedFirstOccurrence?.dateTimeStart ||
      updatedFirstOccurrence?.start_at ||
      updatedFirstOccurrence?.starts_at ||
      '';
    logStep('evg-admin', 'admin API summary readback confirmed after canonical member patch');

    const eventRef = updatedEvent?.slug || eventId;
    const firstPublicDetail = await fetchPublicEvent(
      api,
      baseUrl,
      eventRef,
      firstOccurrenceId,
    );
    const secondPublicDetail = await fetchPublicEvent(
      api,
      baseUrl,
      eventRef,
      secondOccurrenceId,
    );
    for (const [label, detail] of [
      ['first', firstPublicDetail],
      ['second', secondPublicDetail],
    ]) {
      const publicGroups = detail?.profile_groups || [];
      const bandasGroup =
        publicGroups.find((group) => group?.label === 'Bandas') || null;
      const outroGrupoGroup =
        publicGroups.find((group) => group?.label === 'Outro Grupo') || null;
      expect(
        publicGroups.map((group) => group?.label),
        `Public ${label} selected occurrence must expose the event-wide aggregated profile-group tabs.`,
      ).toEqual(['Bandas', 'Outro Grupo']);
      expect(
        bandasGroup?.member_count,
        `Public ${label} selected occurrence must expose Bandas as metadata-only lazy hydration.`,
      ).toBe(2);
      expect(
        (bandasGroup?.profiles || []).map((profile) => profile?.id?.toString() || ''),
        `Public ${label} selected occurrence must not eagerly embed Bandas members in the initial payload.`,
      ).toEqual([]);
      expect(
        typeof bandasGroup?.members_path === 'string' && bandasGroup.members_path.trim(),
        `Public ${label} selected occurrence must expose Bandas lazy members_path.`,
      ).toBeTruthy();
      expect(
        outroGrupoGroup?.member_count,
        `Public ${label} selected occurrence must expose Outro Grupo as metadata-only lazy hydration.`,
      ).toBe(4);
      expect(
        (outroGrupoGroup?.profiles || []).map((profile) => profile?.id?.toString() || ''),
        `Public ${label} selected occurrence must not eagerly embed Outro Grupo members in the initial payload.`,
      ).toEqual([]);
      expect(
        typeof outroGrupoGroup?.members_path === 'string' &&
          outroGrupoGroup.members_path.trim(),
        `Public ${label} selected occurrence must expose Outro Grupo lazy members_path.`,
      ).toBeTruthy();
      logStep(
        'evg-public',
        `public API aggregate metadata confirmed for ${label} occurrence`,
      );
    }
    logStep('evg-public', 'public API aggregation assertions passed');

    publicContext = await browser.newContext({
      ignoreHTTPSErrors: true,
      geolocation: { latitude: -20.671339, longitude: -40.495395 },
      permissions: ['geolocation'],
    });
    await seedFlutterSecureStorageEntries(publicContext, {
      user_token: await resolveAnonymousIdentityToken(api, baseUrl),
    });
    const publicPage = await publicContext.newPage();
    const publicCollectors = installFailureCollectors(publicPage);
    const publicPath =
      `/agenda/evento/${eventRef}?occurrence=${secondOccurrenceId}`;
    await gotoPublicEventDetailAndWaitForHydration(
      publicPage,
      baseUrl,
      publicPath,
      {
        eventRef,
        occurrenceId: secondOccurrenceId,
        title: uniqueTitle,
        description: 'Occurrence profile-group aggregate public detail',
      },
    );
    logStep('evg-public', 'public detail opened on second occurrence');
    await expect(
      publicPage.getByText('Bandas').first(),
      'Public event detail must expose the first aggregated group tab.',
    ).toBeVisible({ timeout: appBootTimeoutMs });
    await expect(
      publicPage.getByText('Outro Grupo').first(),
      'Public event detail must expose the second aggregated group tab.',
    ).toBeVisible({ timeout: appBootTimeoutMs });
    await clickImmersiveTab(publicPage, 'Bandas');
    logStep('evg-public', 'Bandas tab opened');
    await expectAnyVisibleMatch(
      publicPage.getByText(new RegExp(escapeRegExp(bandLeadName))),
      `Aggregated public tab Bandas must render ${bandLeadName}.`,
    );
    logStep('evg-public', `public Bandas member confirmed "${bandLeadName}"`);
    await expectAnyVisibleMatch(
      publicPage.getByText(new RegExp(escapeRegExp(bandSupportName))),
      `Aggregated public tab Bandas must render ${bandSupportName}.`,
    );
    logStep('evg-public', `public Bandas member confirmed "${bandSupportName}"`);
    await clickImmersiveTab(publicPage, 'Outro Grupo');
    logStep('evg-public', 'Outro Grupo tab opened');
    for (const profileName of [
      bandLeadName,
      bandSupportName,
      guestOneName,
      guestTwoName,
    ]) {
      const chipLocator = publicPage.getByText(
        new RegExp(escapeRegExp(profileName)),
      );
      await expectAnyVisibleMatch(
        chipLocator,
        `Aggregated public tab Outro Grupo must render ${profileName}.`,
      );
      logStep('evg-public', `public Outro Grupo member confirmed "${profileName}"`);
    }

    const rejectedEventGroupLabel = `Limite Evento ${uniqueSuffix}`;
    await openOccurrenceEditorForStart(
      page,
      firstOccurrenceStart,
      'First occurrence card must reopen the occurrence editor for the over-ceiling create proof.',
    );
    await scrollUntilVisible(
      page,
      page.getByText('Abas de perfis próprios da ocorrência').first(),
      'Occurrence group editor must stay visible for the over-ceiling create proof.',
    );
    for (let index = 0; index < 11; index += 1) {
      const seedGroupResponse = await api.post(
        buildApiUrl(
          baseUrl,
          `/admin/api/v1/events/${eventId}/occurrences/${firstOccurrenceId}/profile_groups`,
        ),
        {
          data: {
            label: `Grupo limite ${index + 1}`,
          },
          headers: authHeaders(session.token),
        },
      );
      expect(
        seedGroupResponse.status(),
        'Seeded occurrence groups must fill the backend limit before the over-ceiling create check.',
      ).toBeLessThan(400);
    }
    const rejectedEventGroupResponsePromise = page.waitForResponse((candidate) => {
      return (
        candidate.request().method() === 'POST' &&
        candidate.url().includes(
          `/admin/api/v1/events/${eventId}/occurrences/${firstOccurrenceId}/profile_groups`,
        ) &&
        candidate.status() >= 400
      );
    });
    await page.getByRole('button', { name: 'Adicionar grupo' }).click();
    const overLimitDialog = page.getByRole('alertdialog').last();
    await expect(overLimitDialog.getByText(/Novo grupo da ocorrência/i)).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    await fillFlutterTextFieldByLocator(
      page,
      overLimitDialog.getByRole('textbox', { name: /Nome do grupo/i }).first(),
      rejectedEventGroupLabel,
      'Nome do grupo',
    );
    await overLimitDialog.getByRole('button', { name: 'Criar grupo' }).click();
    const rejectedEventGroupResponse = await rejectedEventGroupResponsePromise;
    expect(
      rejectedEventGroupResponse.status(),
      'The thirteenth occurrence-group create attempt must fail on the dedicated backend boundary.',
    ).toBeGreaterThanOrEqual(400);
    await expect(
      page.getByText(
        /Related-account groups exceed the configured limit|Profile groups exceed the configured limit|Limite de grupos|Não foi possível criar o grupo/i,
      ),
    ).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    await expect(page.getByText(rejectedEventGroupLabel, { exact: true })).toHaveCount(
      0,
      {
        timeout: appBootTimeoutMs,
      },
    );
    await expect
      .poll(
        async () => {
          const event = await fetchAdminEvent(api, baseUrl, session.token, eventId);
          const occurrence = (event?.occurrences || []).find(
            (candidate) =>
              candidate?.occurrence_id?.toString() === firstOccurrenceId,
          );
          const groups = occurrence?.profile_groups || [];
          return [
            groups.length,
            groups.some((group) => group?.label === rejectedEventGroupLabel)
              ? 'present'
              : 'absent',
          ].join('|');
        },
        {
          timeout: appBootTimeoutMs,
          message:
            'Over-ceiling occurrence-group create must preserve authoritative state and leave no phantom local group.',
        },
      )
      .toBe('12|absent');
    expect(
      aggregateEventWrites,
      'Over-ceiling occurrence-group create must not fall back to aggregate event PATCH writes.',
    ).toHaveLength(0);
    const overLimitCancelButton = overLimitDialog.getByRole('button', {
      name: 'Cancelar',
    });
    if (await overLimitCancelButton.isVisible().catch(() => false)) {
      await overLimitCancelButton.click();
    }
    await expect(overLimitDialog).toHaveCount(0, {
      timeout: 5000,
    }).catch(() => {});
    await closeOccurrenceEditorSheet(page);

    page.off('request', trackAggregateEventWrite);
    await assertNoBrowserFailures(collectors, {
      allowedConsoleErrorSubstrings: [
        'Failed to load resource: the server responded with a status of 422',
      ],
      allowedResponseStatuses: [422],
    });
    await assertNoBrowserFailures(publicCollectors);
  } finally {
    if (session?.token) {
      await deleteEvent(api, baseUrl, session.token, eventId);
      await deleteEventType(api, baseUrl, session.token, eventTypeId);
      await cleanupOnboardedAccounts(
        api,
        baseUrl,
        session.token,
        createdSeedAccountSlugs,
      );
      for (const profileType of createdSeedProfileTypes) {
        await deleteAccountProfileType(api, baseUrl, session.token, profileType);
      }
    }
    if (publicContext) {
      await publicContext.close().catch(() => {});
    }
    if (browserContext) {
      await browserContext.close().catch(() => {});
    }
    await api.dispose();
  }
});
