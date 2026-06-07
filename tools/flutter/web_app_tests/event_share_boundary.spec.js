const { test, expect, request } = require('@playwright/test');
const { loginTenantAdmin } = require('./support/tenant_admin_auth');
const {
  cleanupOnboardedAccounts,
} = require('./support/account_onboarding_cleanup');

const tenantUrl = process.env.NAV_TENANT_URL;
const appBootTimeoutMs = 90000;
const seedTitle = 'PW Event Share Boundary Store Release';

test.describe.configure({ timeout: 300000 });

function requireTenantUrl() {
  expect(
    tenantUrl,
    'Missing NAV_TENANT_URL. Event share boundary suite requires a live tenant URL.',
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
  const a11yButton = page.getByRole('button', { name: /Enable accessibility/i });

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

async function createEventType(api, baseUrl, token, uniqueSuffix) {
  const slug = `pw-event-share-${uniqueSuffix}`;
  const response = await api.post(buildUrl(baseUrl, '/admin/api/v1/event_types'), {
    data: {
      name: `PW Event Share ${uniqueSuffix}`,
      slug,
      description: 'Playwright event share boundary type',
    },
    headers: authHeaders(token),
  });
  expect(response.status(), 'Event type seed must succeed.').toBe(201);
  const payload = await response.json();
  return payload?.data;
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

  const response = await api.delete(buildUrl(baseUrl, `/admin/api/v1/event_types/${eventTypeId}`), {
    headers: authHeaders(token),
    failOnStatusCode: false,
    timeout: 15000,
  });
  expectDeleteSucceeded(response, `Event type ${eventTypeId}`);
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
      timeout: 15000,
    },
  );
  expectDeleteSucceeded(response, `Account profile type ${profileType}`);
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
    'Tenant-admin physical host candidates must load for event share seed.',
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
    return {
      type: selected.type,
      createdType: '',
    };
  }

  const type = `pw-share-host-${Date.now()}`;
  const createResponse = await api.post(
    buildUrl(baseUrl, '/admin/api/v1/account_profile_types'),
    {
      data: {
        type,
        label: 'PW Share Host',
        labels: {
          singular: 'PW Share Host',
          plural: 'PW Share Hosts',
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
  expect(createResponse.status(), 'Fallback share host profile type must be created.')
    .toBe(201);
  return {
    type,
    createdType: type,
  };
}

async function createPhysicalHost(api, baseUrl, token, name) {
  const profileTypeResolution = await resolvePoiCapableProfileType(api, baseUrl, token);
  const response = await api.post(
    buildUrl(baseUrl, '/admin/api/v1/account_onboardings'),
    {
      data: {
        name,
        ownership_state: 'unmanaged',
        profile_type: profileTypeResolution.type,
        location: {
          lat: -20.671339,
          lng: -40.495395,
        },
      },
      headers: authHeaders(token),
    },
  );
  expect(response.status(), 'Physical host seed must succeed.').toBe(201);

  const payload = await response.json();
  const account = payload?.data?.account || {};
  const profile = payload?.data?.account_profile || {};
  const profileId = profile?.id?.toString() || '';
  expect(profileId, 'Physical host seed must return account_profile id.').toBeTruthy();
  return {
    id: profileId,
    display_name: textValue(profile?.display_name, profile?.name, name),
    account_slug: account?.slug?.toString() || '',
    cleanupProfileType: profileTypeResolution.createdType,
    cleanupAccountSlug: account?.slug?.toString() || '',
  };
}

async function createSeedEvent(api, baseUrl, token) {
  const uniqueSuffix = Date.now().toString();
  const eventType = await createEventType(api, baseUrl, token, uniqueSuffix);
  const createdAccountSlugs = [];
  const createdProfileTypes = [];
  try {
    const hostCandidates = await fetchPhysicalHostCandidates(api, baseUrl, token);
    const physicalHost =
      hostCandidates[0] ||
      (await createPhysicalHost(
        api,
        baseUrl,
        token,
        `PW Event Share Host ${uniqueSuffix}`,
      ));
    if (physicalHost.cleanupAccountSlug) {
      createdAccountSlugs.push(physicalHost.cleanupAccountSlug);
    }
    if (physicalHost.cleanupProfileType) {
      createdProfileTypes.push(physicalHost.cleanupProfileType);
    }
    const start = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    const response = await api.post(buildUrl(baseUrl, '/admin/api/v1/events'), {
      data: {
        title: seedTitle,
        content: '<p>Playwright event share boundary validation event.</p>',
        type: {
          id: eventType.id,
          name: eventType.name,
          slug: eventType.slug,
          description: eventType.description || 'Playwright event type',
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
    expect(response.status(), 'Event share seed event must be created.').toBe(201);
    const payload = await response.json();
    return {
      ...(payload?.data || {}),
      __cleanup: {
        eventId: payload?.data?.event_id?.toString() || '',
        eventTypeId: eventType?.id?.toString() || '',
        accountSlugs: createdAccountSlugs,
        profileTypes: createdProfileTypes,
      },
    };
  } catch (error) {
    await cleanupOnboardedAccounts(api, baseUrl, token, createdAccountSlugs);
    for (const profileType of createdProfileTypes) {
      await deleteAccountProfileType(api, baseUrl, token, profileType);
    }
    await deleteEventType(api, baseUrl, token, eventType?.id?.toString() || '');
    throw error;
  }
}

function firstOccurrenceId(event) {
  const occurrenceId = event?.occurrences?.[0]?.occurrence_id?.toString() || '';
  expect(occurrenceId, 'Seed event must expose first occurrence id.').toBeTruthy();
  return occurrenceId;
}

function recordShareCreateRequests(page) {
  const requests = [];
  page.on('request', (candidate) => {
    if (candidate.method().toUpperCase() !== 'POST') {
      return;
    }
    const pathname = new URL(candidate.url()).pathname;
    if (pathname === '/api/v1/invites/share') {
      requests.push(`${candidate.method()} ${candidate.url()}`);
    }
  });
  return requests;
}

async function attachExternalLaunchCapture(page) {
  const popupUrls = [];
  const requestUrls = [];
  const popups = new Set();
  const popupListeners = new Map();
  const cdpRequestUrls = [];
  const onRequest = (request) => {
    requestUrls.push(request.url());
  };
  const onPopup = (popup) => {
    popups.add(popup);
    popupUrls.push(popup.url());
    const onFrameNavigated = (frame) => {
      if (frame === popup.mainFrame()) {
        popupUrls.push(frame.url());
      }
    };
    popupListeners.set(popup, onFrameNavigated);
    popup.on('framenavigated', onFrameNavigated);
  };

  let cdpSession = null;
  try {
    cdpSession = await page.context().newCDPSession(page);
    await cdpSession.send('Network.enable');
    cdpSession.on('Network.requestWillBeSent', (event) => {
      const url = event?.request?.url?.toString().trim();
      if (url) {
        cdpRequestUrls.push(url);
      }
    });
  } catch (_) {
    cdpSession = null;
  }

  page.on('request', onRequest);
  page.on('popup', onPopup);

  return {
    snapshot: () => ({
      popupUrls: [...popupUrls],
      requestUrls: [...requestUrls],
      cdpRequestUrls: [...cdpRequestUrls],
    }),
    dispose: async () => {
      page.off('request', onRequest);
      page.off('popup', onPopup);
      for (const [popup, listener] of popupListeners.entries()) {
        popup.off('framenavigated', listener);
        await popup.close({ runBeforeUnload: false }).catch(() => {});
      }
      popupListeners.clear();
      popups.clear();
      if (cdpSession != null) {
        await cdpSession.detach().catch(() => {});
      }
    },
  };
}

async function installSystemShareRecorder(context) {
  await context.addInitScript(() => {
    const payloads = [];
    const externalLaunches = [];
    Object.defineProperty(window, '__bellugaSystemSharePayloads', {
      configurable: false,
      enumerable: false,
      value: payloads,
      writable: false,
    });
    Object.defineProperty(window, '__bellugaExternalLaunches', {
      configurable: false,
      enumerable: false,
      value: externalLaunches,
      writable: false,
    });
    const recordExternalLaunch = (value) => {
      const url = value?.toString().trim();
      if (url) {
        externalLaunches.push(url);
      }
    };
    const originalWindowOpen = window.open?.bind(window);
    window.open = function patchedWindowOpen(...args) {
      recordExternalLaunch(args[0]);
      if (originalWindowOpen == null) {
        return null;
      }
      return originalWindowOpen(...args);
    };
    const originalAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function patchedAnchorClick() {
      recordExternalLaunch(this.href || this.getAttribute('href'));
      return originalAnchorClick.apply(this, arguments);
    };
    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      value: () => true,
    });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (payload) => {
        payloads.push({
          title: payload?.title || '',
          text: payload?.text || '',
          url: payload?.url || '',
        });
      },
    });
  });
}

test('@mutation T6-EVENT-SHARE anonymous web event invite opens contextual promotion directly', async ({
  browser,
}) => {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  const { token } = await loginTenantAdmin({
    api,
    baseUrl,
    deviceName: 'playwright-event-share-boundary',
  });
  const event = await createSeedEvent(api, baseUrl, token);
  const occurrenceId = firstOccurrenceId(event);
  const routeRef = textValue(event?.slug, event?.event_id);
  const eventPath = `/agenda/evento/${routeRef}?occurrence=${occurrenceId}`;
  expect(routeRef, 'Seed event must expose slug or event id route reference.')
    .toBeTruthy();

  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
  });
  await installSystemShareRecorder(context);
  const page = await context.newPage();
  const shareCreateRequests = recordShareCreateRequests(page);
  const externalLaunchSignals = await attachExternalLaunchCapture(page);
  const cleanup = event?.__cleanup || {};

  try {
    const response = await page.goto(buildUrl(baseUrl, eventPath), {
      waitUntil: 'domcontentloaded',
    });
    expect(response, 'Public event detail response should be available.').not.toBeNull();
    expect(response.status()).toBeLessThan(400);

    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);
    await expect(page.getByRole('button', { name: /Convidar/i })).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    await expect(page.getByRole('button', { name: /Compartilhar/i })).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    await expect(page.getByRole('button', { name: /WhatsApp/i })).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    const sharePayloadCountBeforeWhatsapp = await page.evaluate(
      () => window.__bellugaSystemSharePayloads?.length || 0,
    );
    await page.getByRole('button', { name: /WhatsApp/i }).click();
    await expect
      .poll(
        async () => {
          const currentUrl = page.url();
          const signals = externalLaunchSignals.snapshot();
          const domSignals = await page.evaluate(
            () => window.__bellugaExternalLaunches || [],
          );
          return (
            /(?:^whatsapp:)|(?:https:\/\/wa\.me\/)/i.test(currentUrl) ||
            domSignals.some((url) =>
              /(?:^whatsapp:)|(?:https:\/\/wa\.me\/)/i.test(url),
            ) ||
            signals.cdpRequestUrls.some((url) =>
              /(?:^whatsapp:)|(?:https:\/\/wa\.me\/)/i.test(url),
            ) ||
            signals.requestUrls.some((url) =>
              /(?:^whatsapp:)|(?:https:\/\/wa\.me\/)/i.test(url),
            ) ||
            signals.popupUrls.some((url) =>
              /(?:^whatsapp:)|(?:https:\/\/wa\.me\/)/i.test(url),
            )
          );
        },
        {
          message:
            'Anonymous web WhatsApp share must launch the direct WhatsApp handoff instead of falling back to the invite/auth boundary.',
          timeout: appBootTimeoutMs,
        },
      )
      .toBe(true);
    await expect
      .poll(
        () => page.evaluate(() => window.__bellugaSystemSharePayloads?.length || 0),
        {
          message:
            'Anonymous web WhatsApp share must not fall back to the system share bridge.',
          timeout: appBootTimeoutMs,
        },
      )
      .toBe(sharePayloadCountBeforeWhatsapp);
    await expect(
      page.getByText(/Convide pessoas pelo app/i),
      'Anonymous web WhatsApp share must not open the invite app-promotion boundary.',
    ).toHaveCount(0);
    await expect(
      page.getByText(/Use o app para escolher contatos/i),
      'Anonymous web WhatsApp share must not open the invite app-promotion boundary.',
    ).toHaveCount(0);
    await expect(page.getByText(new RegExp(escapeRegExp(seedTitle), 'i'))).toBeVisible({
      timeout: appBootTimeoutMs,
    });

    await page.getByRole('button', { name: /Compartilhar/i }).click();
    await expect
      .poll(
        () =>
          page.evaluate(
            () => window.__bellugaSystemSharePayloads?.length || 0,
          ),
        {
          message:
            'Anonymous web share must call the system share bridge with public event payload.',
          timeout: appBootTimeoutMs,
        },
      )
      .toBe(1);
    const [publicSharePayload] = await page.evaluate(
      () => window.__bellugaSystemSharePayloads || [],
    );
    const publicShareText = [
      publicSharePayload?.title || '',
      publicSharePayload?.text || '',
      publicSharePayload?.url || '',
    ].join('\n');
    expect(publicShareText).toContain(seedTitle);
    expect(publicShareText).toContain('Ver evento:');
    expect(publicShareText).toContain(`/agenda/evento/${routeRef}`);
    expect(publicShareText).toContain(`occurrence=${occurrenceId}`);
    expect(publicShareText).not.toContain('Convite para');
    expect(publicShareText).not.toContain('te convidou');
    expect(publicShareText).not.toContain('Responder ao convite:');
    expect(publicShareText).not.toContain('/invite?code=');
    expect(
      shareCreateRequests,
      'Anonymous web public share must not create invite share codes.',
    ).toEqual([]);

    await page.getByRole('button', { name: /Confirmar Presen/i }).click();
    await expect(
      page.getByText(/Confirme presença pelo app/i).first(),
      'Anonymous web confirm attendance must open the canonical app promotion surface.',
    ).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    await expect(
      page.getByText(/Use o app para confirmar sua presença/i).first(),
      'Anonymous web confirm attendance must explain the contextual app action.',
    ).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    expect(
      shareCreateRequests,
      'Anonymous web confirm attendance must not create invite share codes.',
    ).toEqual([]);
    await page.getByRole('button', { name: /^Agora não$/i }).click();
    await expect(page.getByText(/Confirme presença pelo app/i).first()).toBeHidden({
      timeout: appBootTimeoutMs,
    });

    await page.getByRole('button', { name: /Convidar/i }).click();

    await expect(
      page.getByText(/Convide pessoas pelo app/i).first(),
      'Anonymous event invite action must open the canonical contextual app-promotion modal directly.',
    ).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    await expect(
      page.getByText(/Use o app para escolher contatos/i).first(),
      'Anonymous event invite action must explain the invite-specific app boundary.',
    ).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    expect(
      page.url(),
      'Anonymous event invite action must not navigate to the legacy app-promotion route.',
    ).not.toContain('/baixe-o-app');

    expect(
      shareCreateRequests,
      'Anonymous web invite action must stop at the promotion/auth boundary and must not create invite share codes on web.',
    ).toEqual([]);
  } finally {
    await externalLaunchSignals.dispose();
    await context.close();
    await deleteEvent(api, baseUrl, token, cleanup.eventId);
    await cleanupOnboardedAccounts(api, baseUrl, token, cleanup.accountSlugs || []);
    for (const profileType of cleanup.profileTypes || []) {
      await deleteAccountProfileType(api, baseUrl, token, profileType);
    }
    await deleteEventType(api, baseUrl, token, cleanup.eventTypeId);
    await api.dispose();
  }
});
