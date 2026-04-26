const { test, expect, request } = require('@playwright/test');
const crypto = require('crypto');
const {
  loginTenantAdmin: loginTenantAdminWithRequiredCredentials,
} = require('./support/tenant_admin_auth');
const { selectDropdownOption } = require('./support/semantic_dropdown');

const tenantUrl = process.env.NAV_TENANT_URL;
const appBootTimeoutMs = 90000;
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

function anonymousFingerprintHash(baseUrl) {
  return crypto
    .createHash('sha256')
    .update(`event-occurrences:${baseUrl}`)
    .digest('hex');
}

function installFailureCollectors(page) {
  const runtimeErrors = [];
  const failedRequests = [];
  const consoleErrors = [];
  const rateLimitedResponses = [];

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
  page.on('response', (response) => {
    if (response.status() !== 429) {
      return;
    }
    rateLimitedResponses.push(
      `${response.request().method()} ${response.url()}`,
    );
  });

  return { runtimeErrors, failedRequests, consoleErrors, rateLimitedResponses };
}

async function assertNoBrowserFailures(collectors) {
  expect(
    collectors.runtimeErrors,
    `Unexpected runtime errors:\n${collectors.runtimeErrors.join('\n')}`,
  ).toEqual([]);
  expect(
    collectors.failedRequests,
    `Unexpected failed requests:\n${collectors.failedRequests.join('\n')}`,
  ).toEqual([]);

  const disallowedRateLimits = collectors.rateLimitedResponses.filter(
    (entry) =>
      !entry.includes('/api/v1/media/') &&
      !entry.includes('/api/v1/account-profiles/') &&
      !entry.includes('/avatar') &&
      !entry.includes('/cover') &&
      !entry.includes('ingest.sentry.io') &&
      !entry.includes('/envelope/'),
  );
  expect(
    disallowedRateLimits,
    `Disallowed 429 responses:\n${disallowedRateLimits.join('\n')}`,
  ).toEqual([]);

  const criticalConsoleErrors = collectors.consoleErrors.filter(
    (entry) =>
      !entry.includes('status of 401') &&
      !entry.includes('ResizeObserver loop limit exceeded') &&
      !(
        entry.includes('status of 429') &&
        collectors.rateLimitedResponses.length > 0 &&
        disallowedRateLimits.length == 0
      ),
  );
  expect(
    criticalConsoleErrors,
    `Critical console errors:\n${criticalConsoleErrors.join('\n')}`,
  ).toEqual([]);
}

function logStep(flow, message) {
  console.log(`[event-occurrences][${flow}] ${message}`);
}

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
    },
  );
}

async function fetchPhysicalHostCandidates(api, baseUrl, token, minimum = 1) {
  const url = new URL(
    buildApiUrl(baseUrl, '/admin/api/v1/events/account_profile_candidates'),
  );
  url.searchParams.set('type', 'physical_host');
  url.searchParams.set('page', '1');
  url.searchParams.set('page_size', '20');
  const response = await api.get(url.toString(), {
    headers: authHeaders(token),
  });
  expect(
    response.status(),
    'Tenant-admin physical host candidates must load for event seed.',
  ).toBe(200);
  const payload = await response.json();
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const candidates = rows.filter((row) => row?.id?.toString().trim());
  expect(
    candidates.length,
    `Event occurrence mutation seed requires at least ${minimum} physical host candidate(s).`,
  ).toBeGreaterThanOrEqual(minimum);
  return candidates.slice(0, Math.max(minimum, 1));
}

async function resolvePoiCapableProfileType(api, baseUrl, token) {
  const response = await api.get(
    buildApiUrl(baseUrl, '/admin/api/v1/account_profile_types'),
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
    return { profileType: selected.type, createdType: null };
  }

  const type = `pw-srd-host-${Date.now()}`;
  const createResponse = await api.post(
    buildApiUrl(baseUrl, '/admin/api/v1/account_profile_types'),
    {
      data: {
        type,
        label: 'PW SR-D Host',
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
  expect(createResponse.status(), 'Fallback SR-D host profile type must be created.')
    .toBe(201);

  return { profileType: type, createdType: type };
}

async function createNearbyPhysicalHost(api, baseUrl, token, profileType, name) {
  const response = await api.post(
    buildApiUrl(baseUrl, '/admin/api/v1/account_onboardings'),
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
  expect(response.status(), 'Nearby physical host onboarding must succeed.')
    .toBe(201);

  const payload = await response.json();
  const data = payload?.data || {};
  const profile = data?.account_profile || {};
  const profileId = profile?.id?.toString() || '';
  expect(profileId, 'Nearby physical host seed must return a profile id.')
    .toBeTruthy();
  return {
    id: profileId,
    display_name: profile?.display_name?.toString() || name,
  };
}

async function deleteAccountProfile(api, baseUrl, token, profileId) {
  if (!profileId) {
    return;
  }

  await api.delete(
    buildApiUrl(baseUrl, `/admin/api/v1/account_profiles/${profileId}`),
    {
      headers: authHeaders(token),
      failOnStatusCode: false,
    },
  );
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
    },
  );
}

async function fetchRelatedAccountProfileCandidates(api, baseUrl, token) {
  const url = new URL(
    buildApiUrl(baseUrl, '/admin/api/v1/events/account_profile_candidates'),
  );
  url.searchParams.set('type', 'related_account_profile');
  url.searchParams.set('page', '1');
  url.searchParams.set('page_size', '10');
  const response = await api.get(url.toString(), {
    headers: authHeaders(token),
  });
  expect(
    response.status(),
    'Tenant-admin related profile candidates must load for event runtime proof.',
  ).toBe(200);
  const payload = await response.json();
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const candidates = rows.filter((row) => row?.id?.toString().trim());
  expect(
    candidates.length,
    'Event occurrence runtime proof requires at least two related profile candidates.',
  ).toBeGreaterThanOrEqual(2);
  return candidates.slice(0, 2);
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
        event_parties: [],
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
  expect(response.status(), 'Single-occurrence event seed must succeed.').toBe(
    201,
  );
  const payload = await response.json();
  return payload?.data;
}

async function createSingleOccurrenceProgrammedEvent(
  api,
  baseUrl,
  token,
  { eventType, physicalHost, relatedProfiles, uniqueSuffix },
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
        event_parties: [],
        occurrences: [
          {
            date_time_start: firstStart.toISOString(),
            date_time_end: firstEnd.toISOString(),
            event_parties: [
              {
                party_ref_id: occurrenceParty.id,
                permissions: { can_edit: false },
              },
            ],
            programming_items: [
              {
                time: '17:00',
                title: null,
                account_profile_ids: [occurrenceParty.id],
              },
            ],
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
  expect(
    response.status(),
    'Single-occurrence programmed event seed must succeed.',
  ).toBe(201);
  const payload = await response.json();
  const data = payload?.data;
  expect(
    data?.occurrences || [],
    'Single-occurrence programmed event must return one occurrence.',
  ).toHaveLength(1);
  return {
    data,
    occurrenceParty,
  };
}

async function createProgrammedMultiOccurrenceEvent(
  api,
  baseUrl,
  token,
  { eventType, physicalHost, programmingHost, relatedProfiles, uniqueSuffix },
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
        event_parties: [
          {
            party_ref_id: eventParty.id,
            permissions: { can_edit: false },
          },
        ],
        occurrences: [
          {
            date_time_start: firstStart.toISOString(),
            date_time_end: firstEnd.toISOString(),
          },
          {
            date_time_start: secondStart.toISOString(),
            date_time_end: secondEnd.toISOString(),
            event_parties: [
              {
                party_ref_id: occurrenceParty.id,
                permissions: { can_edit: false },
              },
            ],
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
  expect(response.status(), 'Programmed multi-occurrence event seed must succeed.')
    .toBe(201);
  const payload = await response.json();
  const data = payload?.data;
  expect(data?.event_id?.toString(), 'Programmed event must return event_id.')
    .toBeTruthy();
  expect(data?.occurrences || [], 'Programmed event must return two occurrences.')
    .toHaveLength(2);
  return {
    data,
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
        event_parties: [],
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

async function fetchAgendaOccurrenceIdsForTitle(api, baseUrl, title) {
  const normalizedTitle = title?.toString().trim();
  expect(normalizedTitle, 'Agenda occurrence lookup requires a title.').toBeTruthy();

  const occurrenceIds = [];
  for (let page = 1; page <= 10; page += 1) {
    const url = new URL(buildApiUrl(baseUrl, '/api/v1/agenda'));
    url.searchParams.set('page', page.toString());
    url.searchParams.set('page_size', '20');
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
        occurrenceIds.push(occurrenceId);
      }
    }
    if (rows.length === 0) {
      break;
    }
  }

  return occurrenceIds;
}

async function fetchAgendaOccurrenceIdForTitle(api, baseUrl, title) {
  const occurrenceIds = await fetchAgendaOccurrenceIdsForTitle(
    api,
    baseUrl,
    title,
  );
  return occurrenceIds[0] || '';
}

async function fetchAgendaRowsForTitle(api, baseUrl, title) {
  const normalizedTitle = title?.toString().trim();
  expect(normalizedTitle, 'Agenda occurrence row lookup requires a title.').toBeTruthy();

  const rowsByOccurrenceId = new Map();
  for (let page = 1; page <= 10; page += 1) {
    const url = new URL(buildApiUrl(baseUrl, '/api/v1/agenda'));
    url.searchParams.set('page', page.toString());
    url.searchParams.set('page_size', '20');
    const response = await api.get(url.toString(), {
      headers: await tenantPublicAuthHeaders(
        api,
        baseUrl,
        'Public agenda occurrence row lookup',
      ),
    });
    expect(response.status(), 'Public agenda occurrence row lookup must succeed.')
      .toBe(200);
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
        rowsByOccurrenceId.set(occurrenceId, row);
      }
    }
    if (rows.length === 0) {
      break;
    }
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
    programming_items: (detail?.programming_items || []).map((item) => ({
      time: item?.time?.toString() || '',
      title: item?.title?.toString() || '',
      linked_profile_ids: (item?.linked_account_profiles || [])
        .map((profile) => profile?.id?.toString() || '')
        .filter(Boolean),
      location_profile_id: item?.location_profile?.id?.toString() || '',
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

async function fillFlutterTextField(page, label, value) {
  const field = page.getByLabel(label).first();
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
  { confirmationTextInViewport = null } = {},
) {
  const target = page
    .getByRole('button', { name: new RegExp(`^${escapeRegExp(title)}$`) })
    .first();
  await expect(
    target,
    `Immersive tab "${title}" must expose a semantic button target.`,
  ).toBeVisible({ timeout: appBootTimeoutMs });
  await target.click({ timeout: appBootTimeoutMs });
  if (confirmationTextInViewport) {
    await waitForTextInViewport(
      page,
      confirmationTextInViewport,
      `Immersive tab "${title}" must activate visibly.`,
    );
  }
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

async function scrollUntilTextInViewport(page, text, description) {
  const viewport =
    page.viewportSize() ||
    (await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    })));
  await page.mouse.move(viewport.width * 0.62, viewport.height * 0.72);
  for (let attempt = 0; attempt < 24; attempt += 1) {
    if ((await countTextInViewport(page, text)) > 0) {
      return;
    }
    await page.mouse.wheel(0, 700);
    await page.waitForTimeout(250);
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
  const locator = page.getByText(text);
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
  const locator = page.getByText(text);
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
    const listResponsePromise = page.waitForResponse(
      (candidate) => matchesAdminEventsListResponse(candidate, baseUrl),
      { timeout: appBootTimeoutMs },
    );
    const response = await page.goto(buildApiUrl(baseUrl, '/admin/events'), {
      waitUntil: 'domcontentloaded',
    });
    expect(response, 'Events list response should be available.').not.toBeNull();
    expect(response.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);
    const listResponse = await listResponsePromise;
    expect(
      listResponse.status(),
      'Tenant-admin events list response must succeed before UI assertions.',
    ).toBeGreaterThanOrEqual(200);
    expect(
      listResponse.status(),
      'Tenant-admin events list response must succeed before UI assertions.',
    ).toBeLessThan(300);
    await logAdminEventsListResponse(flow, listResponse, 'initial');
    await waitForAdminEventsListUiReady(page);
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
    ).toHaveURL(/\/admin\/events\/edit/, {
      timeout: appBootTimeoutMs,
    });
    return;
  }
  logStep(
    flow,
    `accessible edit button unavailable for "${uniqueTitle}"; using the resolved title locator without coordinate fallback`,
  );
  await title.click({ timeout: appBootTimeoutMs });
  await expect(page).toHaveURL(/\/admin\/events\/edit/, {
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
  await expect(
    page.getByRole('button', { name: 'Salvar data' }),
    'Occurrence editor must not expose the superseded per-occurrence save boundary.',
  ).toHaveCount(0);
  const closeButton = page.getByRole('button', { name: 'Fechar' }).last();
  await expect(closeButton).toBeVisible({ timeout: appBootTimeoutMs });
  await closeButton.click({ timeout: appBootTimeoutMs });
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

test('@mutation NAV-ADM-LOC-01..06 admin occurrence programming location ownership matrix holds', async ({
  browser,
}) => {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  const uniqueSuffix = Date.now().toString();
  let browserContext;
  let session = null;
  let eventTypeId = null;
  let eventId = null;

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

    const physicalHosts = await fetchPhysicalHostCandidates(
      api,
      baseUrl,
      session.token,
      2,
    );
    const physicalHost = physicalHosts[0];
    const programmingHost = physicalHosts[1];

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

      await fillFlutterTextField(page, 'Horário', '13:00');
      await fillFlutterTextField(page, 'Título (opcional)', adminProgrammingTitle);
      await selectDropdownOption(page, {
        fieldLabel: 'Local da programação',
        optionText: programmingHost.display_name,
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
      await selectDropdownOption(page, {
        fieldLabel: 'Local da programação',
        optionText: 'Sem local específico',
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

    await assertNoBrowserFailures(collectors);
  } finally {
    if (session?.token) {
      await deleteEvent(api, baseUrl, session.token, eventId);
      await deleteEventType(api, baseUrl, session.token, eventTypeId);
    }
    if (browserContext) {
      await browserContext.close().catch(() => {});
    }
    await api.dispose();
  }
});

test('@mutation tenant-admin event occurrence FAB persists second occurrence and public detail selects it', async ({
  browser,
}) => {
  annotateMultiOccurrenceNavigationMatrix();
  resetMultiOccurrenceNavigationEvidence();
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  const uniqueSuffix = Date.now().toString();
  let browserContext;
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
  let createdProfileType = null;

  try {
    session = await loginTenantAdmin(api, baseUrl);

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
    const programmingHost = await createNearbyPhysicalHost(
      api,
      baseUrl,
      session.token,
      profileTypeSeed.profileType,
      `PW SR-D Programming Host ${uniqueSuffix}`,
    );
    createdProgrammingHostId = programmingHost.id;
    const relatedProfiles = await fetchRelatedAccountProfileCandidates(
      api,
      baseUrl,
      session.token,
    );

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

    const primaryPageBundle = await createAuthenticatedTenantAdminPage(
      browser,
      session,
    );
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
      await fillFlutterTextField(page, 'Horário', '09:30');
      await fillFlutterTextField(page, 'Título (opcional)', rootProgrammingTitle);
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

      await fillFlutterTextField(page, 'Horário', '13:00');
      await fillFlutterTextField(page, 'Título (opcional)', adminProgrammingTitle);
      await selectDropdownOption(page, {
        fieldLabel: 'Local da programação',
        optionText: programmingHost.display_name,
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
      await selectDropdownOption(page, {
        fieldLabel: 'Local da programação',
        optionText: 'Sem local específico',
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

    const publicBundle = await browser.newContext({
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
        confirmationTextInViewport: 'Ver no mapa',
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
      await clickImmersiveTab(publicPage, 'Como Chegar', {
        confirmationTextInViewport: 'Ver no mapa',
      });
      await waitForTextInViewport(
        publicPage,
        'Ver no mapa',
        'Como Chegar must be the active visible section before destination assertions.',
      );
      await expect(publicPage.getByText(physicalHost.display_name).first())
        .toBeVisible({ timeout: appBootTimeoutMs });
      await expect(
        publicPage.getByText('Outros endereços relacionados').first(),
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
      await scrollUntilTextInViewport(
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
      await expect(page).toHaveURL(/\/admin\/events\/edit/, {
        timeout: appBootTimeoutMs,
      });
    });

    await assertAllMultiOccurrenceNavigationStepsExecuted();
    await assertNoBrowserFailures(collectors);
    await assertNoBrowserFailures(publicCollectors);
  } finally {
    if (session?.token) {
      await deleteEvent(api, baseUrl, session.token, futureLaterEventId);
      await deleteEvent(api, baseUrl, session.token, programmedEventId);
      await deleteEvent(api, baseUrl, session.token, singleProgrammedEventId);
      await deleteEvent(api, baseUrl, session.token, noProgrammingEventId);
      await deleteEvent(api, baseUrl, session.token, eventId);
      await deleteEventType(api, baseUrl, session.token, eventTypeId);
      await deleteAccountProfile(api, baseUrl, session.token, createdProgrammingHostId);
      await deleteAccountProfile(api, baseUrl, session.token, createdPhysicalHostId);
      await deleteAccountProfileType(api, baseUrl, session.token, createdProfileType);
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

test('@mutation repeated public event detail GET/hydration keeps programming payload stable', async ({
  page,
}) => {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  let session = null;
  let eventTypeId = null;
  let firstEventId = null;
  let secondEventId = null;

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

    const physicalHosts = await fetchPhysicalHostCandidates(
      api,
      baseUrl,
      session.token,
      2,
    );
    const physicalHost = physicalHosts[0];
    const programmingHost = physicalHosts[1];
    const relatedProfiles = await fetchRelatedAccountProfileCandidates(
      api,
      baseUrl,
      session.token,
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
    }
    await api.dispose();
  }
});
