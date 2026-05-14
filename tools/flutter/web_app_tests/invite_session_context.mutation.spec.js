const { test, expect, request } = require('@playwright/test');
const crypto = require('crypto');
const {
  loginTenantAdmin: loginTenantAdminWithRequiredCredentials,
} = require('./support/tenant_admin_auth');
const {
  androidBrowserContextOptions,
  expectAndroidOpenAppHandoff,
} = require('./support/android_intent');

const tenantUrl = process.env.NAV_TENANT_URL;
const appBootTimeoutMs = 90000;
const seedTitle = 'PW Invite Session Context Store Release';

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

function anonymousFingerprintHash(baseUrl, label) {
  return crypto
    .createHash('sha256')
    .update(`invite-session-context:${baseUrl}:${label}:${Date.now()}`)
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

async function installInviteFallbackFlashRecorder(context) {
  await context.addInitScript(() => {
    const fallbackPattern =
      /B[oó]ra pro App|Baixe o App para Confirmar|Baixe para continuar|Escolha sua loja/i;
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

async function openInvitePreview({ page, baseUrl, code, eventTitle }) {
  await page.goto(buildUrl(baseUrl, `/invite?code=${encodeURIComponent(code)}`), {
    waitUntil: 'domcontentloaded',
  });
  await assertAppBooted(page);
  await enableAccessibilityIfNeeded(page);

  const eventTitlePattern = visibleTextPattern(eventTitle);
  await expect(page.getByRole('img', { name: eventTitlePattern })).toBeVisible({
    timeout: appBootTimeoutMs,
  });
  await assertNoInviteFallbackFlash(page);
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
  const eventTitlePattern = await openInvitePreview({
    page,
    baseUrl,
    code,
    eventTitle,
  });

  await page.getByRole('button', { name: /Ver detalhes do evento/i }).click();
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

async function fetchPhysicalHostCandidates(api, baseUrl, token) {
  const url = new URL(
    buildUrl(baseUrl, '/admin/api/v1/events/account_profile_candidates'),
  );
  url.searchParams.set('type', 'physical_host');
  url.searchParams.set('page', '1');
  url.searchParams.set('page_size', '20');
  const response = await api.get(url.toString(), {
    headers: authHeaders(token),
  });
  expect(
    response.status(),
    'Tenant-admin physical host candidates must load for invite session seed.',
  ).toBe(200);
  const payload = await response.json();
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return rows.filter((row) => row?.id?.toString().trim());
}

async function resolvePoiCapableProfileType(api, baseUrl, token) {
  const response = await api.get(
    buildUrl(baseUrl, '/admin/api/v1/account_profile_types'),
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
    return selected.type;
  }

  const type = `pw-invite-host-${Date.now()}`;
  const createResponse = await api.post(
    buildUrl(baseUrl, '/admin/api/v1/account_profile_types'),
    {
      data: {
        type,
        label: 'PW Invite Host',
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
  expect(
    createResponse.status(),
    'Fallback invite host profile type must be created.',
  ).toBe(201);
  return type;
}

async function createPhysicalHost(api, baseUrl, token, name) {
  const profileType = await resolvePoiCapableProfileType(api, baseUrl, token);
  const response = await api.post(
    buildUrl(baseUrl, '/admin/api/v1/account_onboardings'),
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
  expect(response.status(), 'Invite session physical host seed must succeed.')
    .toBe(201);

  const payload = await response.json();
  const profile = payload?.data?.account_profile || {};
  const profileId = profile?.id?.toString() || '';
  expect(profileId, 'Physical host seed must return account_profile id.')
    .toBeTruthy();
  return {
    id: profileId,
    display_name: textValue(profile?.display_name, profile?.name, name),
  };
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
  const eventType = await createEventType(api, baseUrl, token, uniqueSuffix);
  const hostCandidates = await fetchPhysicalHostCandidates(api, baseUrl, token);
  const physicalHost =
    hostCandidates[0] ||
    (await createPhysicalHost(
      api,
      baseUrl,
      token,
      `PW Invite Session Host ${uniqueSuffix}`,
    ));
  const start = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  const response = await api.post(buildUrl(baseUrl, '/admin/api/v1/events'), {
    data: {
      title: seedTitle,
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
  return payload?.data;
}

async function resolveSeedEvent(api, baseUrl, token) {
  return (await findExistingSeedEvent(api, baseUrl, token)) ||
    (await createSeedEvent(api, baseUrl, token));
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
  const response = await api.post(buildUrl(baseUrl, '/api/v1/invites/share'), {
    data: {
      target_ref: {
        event_id: eventId,
        occurrence_id: occurrenceId,
      },
    },
    headers: authHeaders(token),
  });
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
  const shareSenderToken = await createAnonymousIdentity(
    api,
    baseUrl,
    'metadata-sender',
  );
  const publicTarget = await fetchPublicAgendaShareTarget(
    api,
    baseUrl,
    shareSenderToken,
  );
  const eventTitle = publicTarget.title;

  const { code, occurrenceId } = await createShareCodeFromTarget(
    api,
    baseUrl,
    shareSenderToken,
    publicTarget,
  );
  const preview = await assertSharePreview(api, baseUrl, code, {
    expectedEventName: eventTitle,
    occurrenceId,
  });
  const invitePath = `/invite?code=${encodeURIComponent(code)}`;
  const inviteUrl = buildUrl(baseUrl, invitePath);

  try {
    const response = await page.goto(inviteUrl, {
      waitUntil: 'domcontentloaded',
    });
    expect(response, 'Invite landing response should be available.').not.toBeNull();
    expect(response.status()).toBeLessThan(400);

    await expect(page).toHaveTitle(new RegExp(escapeRegExp(eventTitle), 'i'));
    await expect(page.locator('head meta[property="og:title"]')).toHaveAttribute(
      'content',
      new RegExp(escapeRegExp(eventTitle), 'i'),
    );
    await expect(page.locator('head meta[name="twitter:title"]')).toHaveAttribute(
      'content',
      new RegExp(escapeRegExp(eventTitle), 'i'),
    );
    await expect(page.locator('head meta[property="og:description"]')).toHaveAttribute(
      'content',
      new RegExp(escapeRegExp(eventTitle), 'i'),
    );
    await expect(page.locator('head meta[property="og:url"]')).toHaveAttribute(
      'content',
      inviteUrl,
    );
    await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute(
      'href',
      inviteUrl,
    );

    const expectedImage = textValue(preview?.invite?.event_image_url);
    const ogImage = page.locator('head meta[property="og:image"]');
    const twitterImage = page.locator('head meta[name="twitter:image"]');
    if (expectedImage) {
      await expect(ogImage).toHaveAttribute('content', expectedImage);
      await expect(twitterImage).toHaveAttribute('content', expectedImage);
    } else {
      await expect(ogImage).toHaveAttribute('content', /.+/);
      await expect(twitterImage).toHaveAttribute('content', /.+/);
    }
  } finally {
    await api.dispose();
  }
});

test('@mutation INVITE-SESSION-CONTEXT Android direct invite and event links generate app intent handoff', async ({
  browser,
}) => {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  let androidContext = null;

  try {
    const session = await loginTenantAdmin(api, baseUrl);
    const shareSenderToken = await createAnonymousIdentity(
      api,
      baseUrl,
      'sender',
    );
    const event = await resolveSeedEvent(api, baseUrl, session.token);
    const eventTitle = textValue(event?.title, event?.name);
    const eventRouteRef = textValue(event?.event_id, event?.slug);
    expect(eventTitle, 'Seed event must expose title.').toBe(seedTitle);
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

    androidContext = await browser.newContext(androidBrowserContextOptions);
    const androidPage = await androidContext.newPage();
    for (const targetPath of [inviteTargetPath, eventTargetPath]) {
      await expectAndroidOpenAppHandoff({
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
  } finally {
    if (androidContext) {
      await androidContext.close();
    }
    await api.dispose();
  }
});
