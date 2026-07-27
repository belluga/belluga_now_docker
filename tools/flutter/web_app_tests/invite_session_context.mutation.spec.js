const { test, expect, request } = require('@playwright/test');
const crypto = require('crypto');
const {
  loginTenantAdmin: loginTenantAdminWithRequiredCredentials,
} = require('./support/tenant_admin_auth');
const {
  cleanupOnboardedAccounts,
  runCleanupPreservingPrimaryError,
} = require('./support/account_onboarding_cleanup');
const {
  androidBrowserContextOptions,
  expectAndroidDirectPublicHandoff,
} = require('./support/android_intent');
const {
  withFreshBrowserPage,
} = require('./support/fresh_browser_context');

const tenantUrl = process.env.NAV_TENANT_URL;
const appBootTimeoutMs = 90000;
const seedTitle = 'PW Invite Session Context Store Release';
const navigationRunId = (process.env.NAV_TEST_RUN_ID || 'local').trim();

test.describe.configure({ timeout: 300000 });

function requireTenantUrl() {
  expect(
    tenantUrl,
    'Missing NAV_TENANT_URL. Invite session-context mutation suite requires a live tenant URL.',
  ).toBeTruthy();
  return tenantUrl;
}

function buildUrl(baseUrl, pathName) {
  return new URL(pathName, baseUrl).toString();
}

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function visibleTextPattern(value) {
  return new RegExp(
    value
      .trim()
      .split(/\s+/)
      .map((part) => escapeRegExp(part))
      .join('\\s+'),
    'i',
  );
}

function normalizeVisibleText(value) {
  return value
    .toString()
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function anonymousFingerprintHash(baseUrl, label) {
  return crypto
    .createHash('sha256')
    .update(`invite-session-context:${baseUrl}:${label}:${navigationRunId}`)
    .digest('hex');
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

function expectDeleteSucceeded(response, label) {
  expect(
    [200, 202, 204, 404],
    `${label} cleanup must succeed or be already absent. Status ${response.status()}.`,
  ).toContain(response.status());
}

async function loginTenantAdmin(api, baseUrl) {
  return loginTenantAdminWithRequiredCredentials({
    api,
    baseUrl,
    buildUrl,
    deviceName: 'playwright-invite-session-context',
  });
}

async function createAnonymousIdentity(api, baseUrl, label) {
  const response = await api.post(buildUrl(baseUrl, '/api/v1/anonymous/identities'), {
    data: {
      device_name: `playwright-invite-session-${label}`,
      fingerprint: {
        hash: anonymousFingerprintHash(baseUrl, label),
        user_agent: `playwright-invite-session-${label}`,
        locale: 'pt-BR',
      },
      metadata: {
        source: 'web_navigation_invite_session_context',
      },
    },
  });
  expect(
    [200, 201],
    `Anonymous identity bootstrap must succeed for ${label}. Status ${response.status()}`,
  ).toContain(response.status());

  const payload = await response.json();
  const token = payload?.data?.token?.toString().trim() || '';
  expect(token, `Anonymous identity bootstrap must return token for ${label}.`)
    .toBeTruthy();
  return token;
}

async function assertAppBooted(page) {
  await expect(page.locator('flt-glass-pane')).toHaveCount(1, {
    timeout: appBootTimeoutMs,
  });
  await expect(page.locator('#splash-screen')).toHaveCount(0, {
    timeout: appBootTimeoutMs,
  });
}

async function gotoAllowingAndroidIntent(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (error) {
    const message = String(error?.message || error);
    const isExpectedIntentNavigationFailure =
      message.includes('ERR_UNKNOWN_URL_SCHEME') ||
      message.includes('net::ERR_ABORTED') ||
      message.includes('intent://');
    if (!isExpectedIntentNavigationFailure) {
      throw error;
    }
  }
}

async function enableAccessibilityIfNeeded(page) {
  const a11yButton = page.getByRole('button', {
    name: /Enable accessibility/i,
  });
  const placeholder = page
    .locator('flt-semantics-placeholder[aria-label="Enable accessibility"]')
    .first();

  for (let attempt = 0; attempt < 25; attempt += 1) {
    if ((await page.getByRole('button').count()) > 1) {
      return;
    }

    const placeholderCount = await placeholder.count();
    const a11yCount = await a11yButton.count();
    if (placeholderCount === 0 && a11yCount === 0) {
      return;
    }

    if (placeholderCount > 0) {
      await placeholder.focus();
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
      if ((await page.getByRole('button').count()) > 1) {
        return;
      }
    } else if (a11yCount > 0) {
      await a11yButton.first().click();
      await page.waitForTimeout(300);
      if ((await page.getByRole('button').count()) > 1) {
        return;
      }
    }

    await page.waitForTimeout(200);
  }
}

async function installInviteFallbackFlashRecorder(context) {
  await context.addInitScript(() => {
    const fallbackPattern =
      /Aceite convites pelo app|B[oó]ra pro App|Baixe o App para Confirmar|Baixe para continuar|Escolha sua loja/i;
    const flashes = [];
    Object.defineProperty(window, '__bellugaInviteFallbackFlash', {
      configurable: false,
      enumerable: false,
      value: flashes,
      writable: false,
    });

    const recordFallbackText = () => {
      const text = document.body?.innerText || '';
      const match = text.match(fallbackPattern);
      if (match) {
        flashes.push(match[0]);
      }
    };

    const start = () => {
      recordFallbackText();
      const target = document.body || document.documentElement;
      if (!target) {
        return;
      }
      new MutationObserver(recordFallbackText).observe(target, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
      start();
    }
  });
}

async function assertNoInviteFallbackFlash(page) {
  const flashes = await page.evaluate(
    () => window.__bellugaInviteFallbackFlash || [],
  );
  expect(
    flashes,
    `Invite web fallback flashed during invite preview/detail flow: ${flashes.join(', ')}`,
  ).toEqual([]);
}

async function expectInviteAccessibilitySummary(page, expectedTexts, timeoutMs) {
  const normalizedExpected = expectedTexts
    .map((text) => normalizeVisibleText(text))
    .filter(Boolean);

  await page.waitForFunction(
    ({ expected }) => {
      const corpus = Array.from(document.querySelectorAll('[aria-label]'))
        .map((element) => element.getAttribute('aria-label') || '')
        .map((value) => value.trim().replace(/\s+/g, ' ').toLowerCase())
        .filter(Boolean)
        .join(' ');

      return expected.every((text) => corpus.includes(text));
    },
    { expected: normalizedExpected },
    { timeout: timeoutMs },
  );
}

function recordInviteAcceptRequests(page, code) {
  const requests = [];
  page.on('request', (candidate) => {
    const method = candidate.method().toUpperCase();
    if (method !== 'POST') {
      return;
    }
    const pathname = new URL(candidate.url()).pathname;
    if (
      pathname === `/api/v1/invites/share/${code}/accept` ||
      /\/api\/v1\/invites\/(?!share\/)[^/]+\/accept$/.test(pathname)
    ) {
      requests.push(`${method} ${candidate.url()}`);
    }
  });
  return requests;
}

async function openInvitePreview({
  page,
  baseUrl,
  code,
  eventTitle,
  expectedVisibleTexts = [],
}) {
  const detailsCtaPattern = /Ver detalhes(?: do evento)?/i;
  const eventTitlePattern = visibleTextPattern(eventTitle);
  await page.goto(buildUrl(baseUrl, `/invite?code=${encodeURIComponent(code)}`), {
    waitUntil: 'domcontentloaded',
  });
  await assertAppBooted(page);
  await enableAccessibilityIfNeeded(page);
  await expect(page.locator('flutter-view')).toHaveCount(1, {
    timeout: appBootTimeoutMs,
  });
  await assertNoInviteFallbackFlash(page);
  await expect(
    page.getByRole('img', { name: new RegExp(escapeRegExp(eventTitle), 'i') }).first(),
    'Invite preview must expose the invite summary card for the seeded event.',
  ).toBeVisible({
    timeout: appBootTimeoutMs,
  });
  await expect(
    page.getByRole('button', { name: detailsCtaPattern }),
    'Invite preview must expose the primary details CTA before proceeding.',
  ).toBeVisible({
    timeout: appBootTimeoutMs,
  });
  await expectInviteAccessibilitySummary(
    page,
    [eventTitle, ...expectedVisibleTexts],
    appBootTimeoutMs,
  );
  return eventTitlePattern;
}

async function openEventDetailFromInvite({
  page,
  baseUrl,
  code,
  eventTitle,
  eventRouteRef,
  occurrenceId,
}) {
  const detailsCtaPattern = /Ver detalhes(?: do evento)?/i;
  const eventTitlePattern = await openInvitePreview({
    page,
    baseUrl,
    code,
    eventTitle,
  });

  await page.getByRole('button', { name: detailsCtaPattern }).click();
  await page.waitForFunction(
    ({ expectedRouteRef, expectedOccurrence }) => {
      const href = window.location.href;
      return (
        href.includes('/agenda/evento/') &&
        href.includes(expectedRouteRef) &&
        href.includes(`occurrence=${encodeURIComponent(expectedOccurrence)}`)
      );
    },
    { expectedRouteRef: eventRouteRef, expectedOccurrence: occurrenceId },
    { timeout: appBootTimeoutMs },
  );

  await assertAppBooted(page);
  await enableAccessibilityIfNeeded(page);
  await expect(page.getByText(eventTitlePattern)).toBeVisible({
    timeout: appBootTimeoutMs,
  });
  await assertNoInviteFallbackFlash(page);
}

async function createEventType(api, baseUrl, token, uniqueSuffix) {
  const slug = `pw-invite-session-${uniqueSuffix}`;
  const response = await api.post(buildUrl(baseUrl, '/admin/api/v1/event_types'), {
    data: {
      name: `PW Invite Session ${uniqueSuffix}`,
      slug,
      description: 'Playwright invite session-context type',
    },
    headers: authHeaders(token),
  });
  expect(response.status(), 'Invite session event type seed must succeed.').toBe(
    201,
  );
  const payload = await response.json();
  return payload?.data;
}

async function resolvePoiCapableProfileType(api, baseUrl, token) {
  const type = `pw-invite-host-${Date.now()}`;
  const createResponse = await api.post(
    buildUrl(baseUrl, '/admin/api/v1/account_profile_types'),
    {
      data: {
        type,
        label: 'PW Invite Host',
        labels: {
          singular: 'PW Invite Host',
          plural: 'PW Invite Hosts',
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
  expect(
    createResponse.status(),
    'Fallback invite host profile type must be created.',
  ).toBe(201);
  return {
    profileType: type,
    createdProfileType: type,
  };
}

async function createPhysicalHost(api, baseUrl, token, name, profileType) {
  return createOnboardedProfile(api, baseUrl, token, {
    name,
    profileType,
    location: {
      lat: -20.671339,
      lng: -40.495395,
    },
  });
}

async function createOnboardedProfile(
  api,
  baseUrl,
  token,
  { name, profileType, location = undefined },
) {
  const response = await api.post(
    buildUrl(baseUrl, '/admin/api/v1/account_onboardings'),
    {
      data: {
        name,
        ownership_state: 'unmanaged',
        profile_type: profileType,
        ...(location ? { location } : {}),
      },
      headers: authHeaders(token),
    },
  );
  expect(response.status(), 'Invite session physical host seed must succeed.')
    .toBe(201);

  const payload = await response.json();
  const account = payload?.data?.account || {};
  const profile = payload?.data?.account_profile || {};
  const profileId = profile?.id?.toString() || '';
  expect(profileId, 'Physical host seed must return account_profile id.')
    .toBeTruthy();
  return {
    id: profileId,
    display_name: textValue(profile?.display_name, profile?.name, name),
    account_slug: account?.slug?.toString() || '',
  };
}

async function deleteEvent(api, baseUrl, token, eventId) {
  if (!eventId) {
    return;
  }

  const response = await api.delete(buildUrl(baseUrl, `/admin/api/v1/events/${eventId}`), {
    headers: authHeaders(token),
    failOnStatusCode: false,
    timeout: 15000,
  });
  expectDeleteSucceeded(response, `Event ${eventId}`);
}

async function deleteEventType(api, baseUrl, token, eventTypeId) {
  if (!eventTypeId) {
    return;
  }

  const response = await api.delete(
    buildUrl(baseUrl, `/admin/api/v1/event_types/${eventTypeId}`),
    {
      headers: authHeaders(token),
      failOnStatusCode: false,
      timeout: 15000,
    },
  );
  expectDeleteSucceeded(response, `Event type ${eventTypeId}`);
}

async function deleteAccountProfileType(api, baseUrl, token, profileType) {
  if (!profileType) {
    return;
  }

  const response = await api.delete(
    buildUrl(
      baseUrl,
      `/admin/api/v1/account_profile_types/${encodeURIComponent(profileType)}`,
    ),
    {
      headers: authHeaders(token),
      failOnStatusCode: false,
      timeout: 15000,
    },
  );
  expectDeleteSucceeded(response, `Account profile type ${profileType}`);
}

async function findExistingSeedEvent(api, baseUrl, token) {
  for (let page = 1; page <= 10; page += 1) {
    const url = new URL(buildUrl(baseUrl, '/admin/api/v1/events'));
    url.searchParams.set('page', page.toString());
    url.searchParams.set('page_size', '100');
    url.searchParams.set('temporal', 'now,future');
    const response = await api.get(url.toString(), {
      headers: authHeaders(token),
    });
    expect(response.status(), `Admin events page ${page} must load.`).toBe(200);
    const payload = await response.json();
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    const match = rows.find(
      (row) => textValue(row?.title, row?.name) === seedTitle,
    );
    if (match?.event_id) {
      return fetchAdminEvent(api, baseUrl, token, match.event_id.toString());
    }
    if (rows.length === 0) {
      break;
    }
  }
  return null;
}

async function fetchAdminEvent(api, baseUrl, token, eventId) {
  const response = await api.get(
    buildUrl(baseUrl, `/admin/api/v1/events/${eventId}`),
    {
      headers: authHeaders(token),
    },
  );
  expect(response.status(), 'Admin event readback must succeed.').toBe(200);
  const payload = await response.json();
  return payload?.data;
}

async function createSeedEvent(api, baseUrl, token) {
  const uniqueSuffix = Date.now().toString();
  const title = `${seedTitle} ${uniqueSuffix}`;
  let eventId = '';
  let eventTypeId = '';
  let createdProfileType = '';
  const cleanupAccountSlugs = [];

  try {
    const eventType = await createEventType(api, baseUrl, token, uniqueSuffix);
    eventTypeId = eventType?.id?.toString() || '';
    const { profileType, createdProfileType: fallbackProfileType } =
      await resolvePoiCapableProfileType(api, baseUrl, token);
    createdProfileType = fallbackProfileType;
    const physicalHost = await createPhysicalHost(
      api,
      baseUrl,
      token,
      `PW Invite Session Host ${uniqueSuffix}`,
      profileType,
    );
    if (physicalHost.account_slug) {
      cleanupAccountSlugs.push(physicalHost.account_slug);
    }

    const start = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    const response = await api.post(buildUrl(baseUrl, '/admin/api/v1/events'), {
      data: {
        title,
        content:
          '<p>Playwright invite session context event for Store Release validation.</p>',
        type: {
          id: eventType.id,
          name: eventType.name,
          slug: eventType.slug,
          description: eventType.description || 'Playwright invite type',
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
      headers: authHeaders(token),
    });
    expect(response.status(), 'Invite session seed event must be created.').toBe(
      201,
    );
    const payload = await response.json();
    eventId = payload?.data?.event_id?.toString() || '';
    return {
      event: payload?.data,
      title,
      eventTypeId,
      createdProfileType,
      cleanupAccountSlugs,
    };
  } catch (error) {
    await runCleanupPreservingPrimaryError(error, async () => {
      await deleteEvent(api, baseUrl, token, eventId);
      await cleanupOnboardedAccounts(
        api,
        baseUrl,
        token,
        cleanupAccountSlugs,
      );
      await deleteEventType(api, baseUrl, token, eventTypeId);
      await deleteAccountProfileType(
        api,
        baseUrl,
        token,
        createdProfileType,
      );
    });
    throw error;
  }
}

async function createInvitePreviewSeedEvent(api, baseUrl, token) {
  const uniqueSuffix = Date.now().toString();
  const title = `${seedTitle} ${uniqueSuffix}`;
  let eventId = '';
  let eventTypeId = '';
  let createdProfileType = '';
  const cleanupAccountSlugs = [];

  try {
    const eventType = await createEventType(api, baseUrl, token, uniqueSuffix);
    eventTypeId = eventType?.id?.toString() || '';
    const { profileType, createdProfileType: fallbackProfileType } =
      await resolvePoiCapableProfileType(api, baseUrl, token);
    createdProfileType = fallbackProfileType;
    const host = await createPhysicalHost(
      api,
      baseUrl,
      token,
      `PW Invite Session Host ${uniqueSuffix}`,
      profileType,
    );
    const band = await createPhysicalHost(
      api,
      baseUrl,
      token,
      `PW Invite Session Band ${uniqueSuffix}`,
      profileType,
    );
    const exhibitor = await createPhysicalHost(
      api,
      baseUrl,
      token,
      `PW Invite Session Exhibitor ${uniqueSuffix}`,
      profileType,
    );
    cleanupAccountSlugs.push(
      ...[host.account_slug, band.account_slug, exhibitor.account_slug]
        .map((slug) => slug?.toString().trim())
        .filter(Boolean),
    );

    const start = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    const response = await api.post(buildUrl(baseUrl, '/admin/api/v1/events'), {
      data: {
        title,
        content:
          '<p>Playwright invite session context event for visible invite preview validation.</p>',
        type: {
          id: eventType.id,
          name: eventType.name,
          slug: eventType.slug,
          description: eventType.description || 'Playwright invite type',
        },
        location: {
          mode: 'physical',
        },
        place_ref: {
          type: 'account_profile',
          id: host.id,
        },
        event_parties: [band, exhibitor].map((profile) => ({
          party_ref_id: profile.id,
        })),
        profile_groups: [
          {
            id: 'bandas',
            label: 'Bandas',
            order: 0,
            account_profile_ids: [band.id],
          },
          {
            id: 'expositores',
            label: 'Expositores',
            order: 1,
            account_profile_ids: [exhibitor.id],
          },
        ],
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
      headers: authHeaders(token),
    });
    const payload = await response.json().catch(async () => ({
      raw: await response.text().catch(() => ''),
    }));
    expect(
      response.status(),
      `Invite preview seed event must be created. Response: ${JSON.stringify(payload)}`,
    ).toBe(201);
    eventId = payload?.data?.event_id?.toString() || '';
    return {
      event: payload?.data,
      title,
      hostLabel: host.display_name,
      bandLabel: band.display_name,
      exhibitorLabel: exhibitor.display_name,
      eventTypeId,
      createdProfileType,
      cleanupAccountSlugs,
    };
  } catch (error) {
    await runCleanupPreservingPrimaryError(error, async () => {
      await deleteEvent(api, baseUrl, token, eventId);
      await cleanupOnboardedAccounts(
        api,
        baseUrl,
        token,
        cleanupAccountSlugs,
      );
      await deleteEventType(api, baseUrl, token, eventTypeId);
      await deleteAccountProfileType(
        api,
        baseUrl,
        token,
        createdProfileType,
      );
    });
    throw error;
  }
}

function firstOccurrenceId(event) {
  const occurrenceId = event?.occurrences?.[0]?.occurrence_id?.toString() || '';
  expect(occurrenceId, 'Seed event must expose first occurrence id.').toBeTruthy();
  return occurrenceId;
}

async function createShareCode(api, baseUrl, token, event) {
  const eventId = event?.event_id?.toString() || '';
  expect(eventId, 'Seed event must expose event_id.').toBeTruthy();
  const occurrenceId = firstOccurrenceId(event);
  return createShareCodeFromTarget(api, baseUrl, token, { eventId, occurrenceId });
}

async function createShareCodeFromTarget(
  api,
  baseUrl,
  token,
  { eventId, occurrenceId },
) {
  expect(eventId, 'Share-code creation requires event_id.').toBeTruthy();
  expect(occurrenceId, 'Share-code creation requires occurrence_id.').toBeTruthy();
  let response = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    response = await api.post(buildUrl(baseUrl, '/api/v1/invites/share'), {
      data: {
        target_ref: {
          event_id: eventId,
          occurrence_id: occurrenceId,
        },
      },
      headers: authHeaders(token),
    });

    if (response.status() !== 429) {
      break;
    }

    if (attempt < 4) {
      const retryAfterHeader = response.headers()['retry-after'];
      const retryAfterSeconds = Number.parseFloat(
        Array.isArray(retryAfterHeader) ? retryAfterHeader[0] : retryAfterHeader || '',
      );
      const fallbackDelayMs = 1000 * attempt;
      const delayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? Math.ceil(retryAfterSeconds * 1000)
        : fallbackDelayMs;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  expect(response.status(), 'Share-code creation must succeed.').toBe(200);
  const payload = await response.json();
  const code = payload?.code?.toString().trim() || '';
  expect(code, 'Share-code creation must return code.').toBeTruthy();
  expect(payload?.target_ref?.occurrence_id?.toString()).toBe(occurrenceId);
  return { code, occurrenceId };
}

async function assertSharePreview(
  api,
  baseUrl,
  code,
  { expectedEventName, occurrenceId },
) {
  const response = await api.get(buildUrl(baseUrl, `/api/v1/invites/share/${code}`));
  expect(response.status(), 'Share-code preview must succeed.').toBe(200);
  const payload = await response.json();
  expect(payload?.code?.toString()).toBe(code);
  expect(payload?.invite?.target_ref?.occurrence_id?.toString()).toBe(
    occurrenceId,
  );
  expect(payload?.invite?.event_name?.toString()).toBe(expectedEventName);
  return payload;
}

async function fetchPublicAgendaShareTarget(api, baseUrl, token) {
  for (let page = 1; page <= 10; page += 1) {
    const url = new URL(buildUrl(baseUrl, '/api/v1/agenda'));
    url.searchParams.set('page', page.toString());
    url.searchParams.set('page_size', '20');
    const response = await api.get(url.toString(), {
      headers: authHeaders(token),
    });
    expect(response.status(), 'Public agenda lookup must succeed.').toBe(200);
    const payload = await response.json();
    const rows = Array.isArray(payload?.items)
      ? payload.items
      : Array.isArray(payload?.data)
        ? payload.data
        : [];
    for (const row of rows) {
      const eventId = textValue(row?.event_id);
      const occurrenceId = textValue(row?.occurrence_id);
      const title = textValue(row?.title);
      if (eventId && occurrenceId && title) {
        return { eventId, occurrenceId, title };
      }
    }
    if (rows.length === 0) {
      break;
    }
  }

  throw new Error('Public agenda did not expose an event_id/occurrence_id pair for invite metadata validation.');
}

test('@mutation INVITE-SESSION-CONTEXT invite landing exposes dynamic share metadata', async ({
  page,
}) => {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  let session = null;
  let seeded = null;
  let secondSeeded = null;
  let primaryError = null;

  try {
    session = await loginTenantAdmin(api, baseUrl);
    seeded = await createInvitePreviewSeedEvent(api, baseUrl, session.token);
    secondSeeded = await createInvitePreviewSeedEvent(api, baseUrl, session.token);
    await installInviteFallbackFlashRecorder(page.context());
    const firstVisit = async (
      seed,
      {
        expectedLinkedProfiles,
      },
    ) => {
      const event = seed.event;
      const eventId = event?.event_id?.toString() || '';
      const eventTitle = seed.title;
      const occurrenceId = firstOccurrenceId(event);
      const shareSenderToken = await createAnonymousIdentity(
        api,
        baseUrl,
        `metadata-sender-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      );
      const { code } = await createShareCodeFromTarget(api, baseUrl, shareSenderToken, {
        eventId,
        occurrenceId,
      });
      const preview = await assertSharePreview(api, baseUrl, code, {
        expectedEventName: eventTitle,
        occurrenceId,
      });
      const invitePath = `/invite?code=${encodeURIComponent(code)}`;
      const inviteUrl = buildUrl(baseUrl, invitePath);
      const response = await page.goto(inviteUrl, {
        waitUntil: 'domcontentloaded',
      });
      expect(response, 'Invite landing response should be available.').not.toBeNull();
      expect(response.status()).toBeLessThan(400);

      await expect(page).toHaveTitle(new RegExp(escapeRegExp(eventTitle), 'i'), {
        timeout: appBootTimeoutMs,
      });
      await expect(page.locator('head meta[property="og:title"]')).toHaveAttribute(
        'content',
        new RegExp(escapeRegExp(eventTitle), 'i'),
        {
          timeout: appBootTimeoutMs,
        },
      );
      await expect(page.locator('head meta[name="twitter:title"]')).toHaveAttribute(
        'content',
        new RegExp(escapeRegExp(eventTitle), 'i'),
        {
          timeout: appBootTimeoutMs,
        },
      );
      await expect(page.locator('head meta[property="og:description"]')).toHaveAttribute(
        'content',
        new RegExp(escapeRegExp(eventTitle), 'i'),
        {
          timeout: appBootTimeoutMs,
        },
      );
      await expect(page.locator('head meta[property="og:url"]')).toHaveAttribute(
        'content',
        inviteUrl,
        {
          timeout: appBootTimeoutMs,
        },
      );
      await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute(
        'href',
        inviteUrl,
        {
          timeout: appBootTimeoutMs,
        },
      );
      const expectedImage = textValue(preview?.invite?.event_image_url);
      const ogImage = page.locator('head meta[property="og:image"]');
      const twitterImage = page.locator('head meta[name="twitter:image"]');
      if (expectedImage) {
        await expect(ogImage).toHaveAttribute('content', expectedImage, {
          timeout: appBootTimeoutMs,
        });
        await expect(twitterImage).toHaveAttribute('content', expectedImage, {
          timeout: appBootTimeoutMs,
        });
      } else {
        await expect(ogImage).toHaveAttribute('content', /.+/, {
          timeout: appBootTimeoutMs,
        });
        await expect(twitterImage).toHaveAttribute('content', /.+/, {
          timeout: appBootTimeoutMs,
        });
      }

      expect((preview?.invite?.profile_groups || []).map((group) => group.label)).toEqual([
        'Bandas',
        'Expositores',
      ]);
      expect(
        (preview?.invite?.linked_account_profiles || []).map((profile) =>
          textValue(profile?.display_name, profile?.name),
        ),
      ).toEqual(expect.arrayContaining(expectedLinkedProfiles));
      const expectedVisibleTexts = [
        textValue(
          preview?.invite?.linked_account_profiles?.[0]?.display_name,
          preview?.invite?.linked_account_profiles?.[0]?.name,
        ),
      ].filter(Boolean);
      await openInvitePreview({
        page,
        baseUrl,
        code,
        eventTitle,
        expectedVisibleTexts,
      });
      return {
        code,
        inviteUrl,
        expectedImage,
        title: eventTitle,
      };
    };

    const firstMetadata = await firstVisit(seeded, {
      expectedLinkedProfiles: [
        seeded.bandLabel,
        seeded.exhibitorLabel,
      ],
    });
    await expect(page.locator('flutter-view')).toHaveCount(1, {
      timeout: appBootTimeoutMs,
    });
    const shellStats = await page.evaluate(() => ({
      glassPaneCount: document.querySelectorAll('flt-glass-pane').length,
      splashCount: document.querySelectorAll('#splash-screen').length,
      flutterViewCount: document.querySelectorAll('flutter-view').length,
      semanticsPlaceholderCount: document.querySelectorAll(
        'flt-semantics-placeholder[aria-label="Enable accessibility"]',
      ).length,
    }));
    expect(shellStats).toEqual({
      glassPaneCount: 1,
      splashCount: 0,
      flutterViewCount: 1,
      semanticsPlaceholderCount: expect.any(Number),
    });

    const secondMetadata = await firstVisit(secondSeeded, {
      expectedLinkedProfiles: [
        secondSeeded.bandLabel,
        secondSeeded.exhibitorLabel,
      ],
    });
    expect(secondMetadata.code).not.toBe(firstMetadata.code);
    expect(secondMetadata.inviteUrl).not.toBe(firstMetadata.inviteUrl);
    expect(secondMetadata.title).not.toBe(firstMetadata.title);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await runCleanupPreservingPrimaryError(primaryError, async () => {
      try {
        if (session) {
          await deleteEvent(
            api,
            baseUrl,
            session.token,
            seeded?.event?.event_id?.toString() || '',
          );
          await deleteEvent(
            api,
            baseUrl,
            session.token,
            secondSeeded?.event?.event_id?.toString() || '',
          );
          await cleanupOnboardedAccounts(
            api,
            baseUrl,
            session.token,
            [
              ...(seeded?.cleanupAccountSlugs || []),
              ...(secondSeeded?.cleanupAccountSlugs || []),
            ],
          );
          await deleteEventType(api, baseUrl, session.token, seeded?.eventTypeId || '');
          await deleteEventType(api, baseUrl, session.token, secondSeeded?.eventTypeId || '');
          await deleteAccountProfileType(
            api,
            baseUrl,
            session.token,
            seeded?.createdProfileType || '',
          );
          await deleteAccountProfileType(
            api,
            baseUrl,
            session.token,
            secondSeeded?.createdProfileType || '',
          );
        }
      } finally {
        await api.dispose();
      }
    });
  }
});

test('@mutation INVITE-SESSION-CONTEXT Android direct invite and event links generate app intent handoff', async ({
  browser,
}) => {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  let seeded = null;
  let session = null;
  let primaryError = null;

  try {
    session = await loginTenantAdmin(api, baseUrl);
    const shareSenderToken = await createAnonymousIdentity(
      api,
      baseUrl,
      'sender',
    );
    seeded = await createSeedEvent(api, baseUrl, session.token);
    const event = seeded.event;
    const eventTitle = seeded.title;
    const eventRouteRef = textValue(event?.event_id, event?.slug);
    expect(eventTitle, 'Seed event must expose title.').toBeTruthy();
    expect(eventRouteRef, 'Seed event must expose event_id/slug route ref.')
      .toBeTruthy();

    const { code, occurrenceId } = await createShareCode(
      api,
      baseUrl,
      shareSenderToken,
      event,
    );
    await assertSharePreview(api, baseUrl, code, {
      expectedEventName: eventTitle,
      occurrenceId,
    });

    const inviteTargetPath = `/invite?code=${encodeURIComponent(code)}`;
    const eventTargetPath = `/agenda/evento/${encodeURIComponent(eventRouteRef)}?occurrence=${encodeURIComponent(occurrenceId)}`;

    await withFreshBrowserPage(async ({ page: androidPage }) => {
      for (const targetPath of [inviteTargetPath, eventTargetPath]) {
        await expectAndroidDirectPublicHandoff({
          page: androidPage,
          baseUrl,
          expectedTargetPath: targetPath,
          timeoutMs: appBootTimeoutMs,
          action: async () => {
            await gotoAllowingAndroidIntent(
              androidPage,
              buildUrl(baseUrl, targetPath),
            );
          },
        });
      }
    }, androidBrowserContextOptions);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await runCleanupPreservingPrimaryError(primaryError, async () => {
      try {
        if (seeded && session) {
          await deleteEvent(api, baseUrl, session.token, seeded.event?.event_id?.toString() || '');
          await cleanupOnboardedAccounts(
            api,
            baseUrl,
            session.token,
            seeded.cleanupAccountSlugs,
          );
          await deleteEventType(api, baseUrl, session.token, seeded.eventTypeId);
          await deleteAccountProfileType(
            api,
            baseUrl,
            session.token,
            seeded.createdProfileType,
          );
        }
      } finally {
        await api.dispose();
      }
    });
  }
});
