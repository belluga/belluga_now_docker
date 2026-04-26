const crypto = require('crypto');
const { test, expect, request } = require('@playwright/test');
const {
  loginTenantAdmin: loginTenantAdminWithRequiredCredentials,
} = require('./support/tenant_admin_auth');

const tenantUrl = process.env.NAV_TENANT_URL;
const appBootTimeoutMs = 90000;

test.describe.configure({ timeout: 300000 });

function requireTenantUrl() {
  expect(
    tenantUrl,
    'Missing NAV_TENANT_URL. Event rich-text mutation suite requires a live tenant URL.',
  ).toBeTruthy();
  return tenantUrl;
}

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
}

function buildUrl(baseUrl, pathName) {
  return new URL(pathName, baseUrl).toString();
}

function anonymousFingerprintHash(baseUrl) {
  return crypto
    .createHash('sha256')
    .update(`event-rich-text:${baseUrl}`)
    .digest('hex');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function textPattern(value) {
  return new RegExp(escapeRegExp(value), 'i');
}

function normalizePayload(payload) {
  if (payload?.data && typeof payload.data === 'object') {
    return payload.data;
  }
  return payload;
}

function installFailureCollectors(page) {
  const runtimeErrors = [];
  const failedRequests = [];
  const consoleErrors = [];

  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('requestfailed', (requestEntry) => {
    const failureText = requestEntry.failure()?.errorText || 'unknown';
    if (failureText === 'net::ERR_ABORTED') {
      return;
    }
    failedRequests.push(
      `${requestEntry.method()} ${requestEntry.url()} (${failureText})`,
    );
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

async function openAppPath(page, baseUrl, pathName) {
  const response = await page.goto(buildUrl(baseUrl, pathName), {
    waitUntil: 'domcontentloaded',
  });
  expect(response, `Response should be available for ${pathName}`).not.toBeNull();
  expect(response.status(), `Response should be successful for ${pathName}`)
    .toBeLessThan(400);
  await assertAppBooted(page);
  await enableAccessibilityIfNeeded(page);
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
    deviceName: 'playwright-event-rich-text',
  });
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

async function createAuthenticatedTenantAdminPage(browser, session) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
  });
  await seedFlutterSecureStorage(context, session);
  const page = await context.newPage();
  return { context, page };
}

async function resolveAnonymousIdentityToken(api, baseUrl) {
  const response = await api.post(
    buildUrl(baseUrl, '/api/v1/anonymous/identities'),
    {
      data: {
        device_name: 'playwright-event-rich-text-public',
        fingerprint: {
          hash: anonymousFingerprintHash(baseUrl),
          user_agent: 'playwright-event-rich-text-public',
          locale: 'pt-BR',
        },
        metadata: {
          source: 'web_navigation_event_rich_text',
        },
      },
      headers: {
        Accept: 'application/json',
      },
    },
  );
  expect(
    [200, 201],
    `Anonymous tenant identity bootstrap must succeed. Status ${response.status()}`,
  ).toContain(response.status());
  const payload = await response.json();
  const token = payload?.data?.token?.toString() || '';
  expect(token, 'Anonymous tenant identity bootstrap must return data.token.')
    .toBeTruthy();
  return token;
}

async function tenantPublicAuthHeaders(api, baseUrl) {
  return authHeaders(await resolveAnonymousIdentityToken(api, baseUrl));
}

async function createEventType(api, baseUrl, token, uniqueSuffix) {
  const slug = `pw-src-rich-${uniqueSuffix}`;
  const response = await api.post(
    buildUrl(baseUrl, '/admin/api/v1/event_types'),
    {
      data: {
        name: `PW SR-C Rich ${uniqueSuffix}`,
        slug,
        description: 'Playwright SR-C rich-text event type',
      },
      headers: authHeaders(token),
    },
  );
  expect(response.status(), 'Event type seed must succeed.').toBe(201);
  return normalizePayload(await response.json());
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

async function fetchPhysicalHostCandidate(api, baseUrl, token) {
  const url = new URL(
    buildUrl(baseUrl, '/admin/api/v1/events/account_profile_candidates'),
  );
  url.searchParams.set('type', 'physical_host');
  url.searchParams.set('page', '1');
  url.searchParams.set('page_size', '10');
  const response = await api.get(url.toString(), {
    headers: authHeaders(token),
  });
  expect(response.status(), 'Tenant-admin physical host candidates must load.')
    .toBe(200);
  const payload = await response.json();
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const candidate = rows.find((row) => row?.id?.toString().trim());
  expect(
    candidate,
    'Event rich-text mutation seed requires at least one physical host candidate.',
  ).toBeTruthy();
  return candidate;
}

async function createRichTextEvent(
  api,
  baseUrl,
  token,
  { eventType, physicalHost, uniqueSuffix, content },
) {
  const start = new Date(Date.now() + 10 * 60 * 1000);
  const end = new Date(start.getTime() + 90 * 60 * 1000);
  const response = await api.post(buildUrl(baseUrl, '/admin/api/v1/events'), {
    data: {
      title: `PW SR-C Rich Event ${uniqueSuffix}`,
      content,
      type: {
        id: eventType.id,
        name: eventType.name,
        slug: eventType.slug,
        description: eventType.description || 'Playwright SR-C rich type',
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
  expect(response.status(), 'Rich-text event seed must succeed.').toBe(201);
  return normalizePayload(await response.json());
}

async function fetchAdminEvent(api, baseUrl, token, eventId) {
  const response = await api.get(buildUrl(baseUrl, `/admin/api/v1/events/${eventId}`), {
    headers: authHeaders(token),
  });
  expect(response.status(), 'Tenant-admin event readback must succeed.').toBe(
    200,
  );
  return normalizePayload(await response.json());
}

async function fetchPublicEvent(api, baseUrl, eventRef) {
  const response = await api.get(buildUrl(baseUrl, `/api/v1/events/${eventRef}`), {
    headers: await tenantPublicAuthHeaders(api, baseUrl),
  });
  expect(response.status(), 'Public event detail readback must succeed.').toBe(
    200,
  );
  return normalizePayload(await response.json());
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

async function locateAdminEventListPlacement(api, baseUrl, token, eventId) {
  for (let page = 1; page <= 8; page += 1) {
    const url = new URL(buildUrl(baseUrl, '/admin/api/v1/events'));
    url.searchParams.set('page', page.toString());
    url.searchParams.set('page_size', '20');
    url.searchParams.set('temporal', 'now,future');
    const response = await api.get(url.toString(), {
      headers: authHeaders(token),
    });
    expect(response.status(), `Tenant-admin events page ${page} must load.`)
      .toBe(200);
    const payload = await response.json();
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    const index = rows.findIndex((row) => row?.event_id?.toString() === eventId);
    if (index >= 0) {
      return { page, index };
    }
  }

  throw new Error(
    `Seeded event ${eventId} was created but was not returned by the tenant-admin events list API.`,
  );
}

async function scrollToSeededEventCard(page, uniqueTitle, expectedApiPage) {
  const semanticCard = page
    .getByRole('button', {
      name: new RegExp(`Editar evento\\s+${escapeRegExp(uniqueTitle)}`, 'i'),
    })
    .first();
  const title = page.getByText(new RegExp(escapeRegExp(uniqueTitle))).first();
  const maxAttempts = Math.max(48, expectedApiPage * 32);
  const viewport =
    page.viewportSize() ||
    (await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    })));
  await page.mouse.move(viewport.width * 0.55, viewport.height * 0.78);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (await semanticCard.isVisible().catch(() => false)) {
      return { locator: semanticCard, source: 'semantic button' };
    }
    if (await title.isVisible().catch(() => false)) {
      return { locator: title, source: 'visible title text' };
    }

    if (attempt === 0) {
      await page.waitForTimeout(1200);
      continue;
    }

    await page.mouse.wheel(0, 280);
    await page.waitForTimeout(220);
  }

  return null;
}

async function expectAdminEditFormForEvent(page, uniqueTitle, uniqueRichHeading) {
  await expect(page.getByText('Editar evento').first()).toBeVisible({
    timeout: appBootTimeoutMs,
  });
  expect(uniqueTitle, 'Seeded event title must be known before admin edit.')
    .toBeTruthy();
  await expect(page.getByText(textPattern(uniqueRichHeading)).first()).toBeVisible({
    timeout: appBootTimeoutMs,
  });
}

async function openSeededEventFromAdminList(
  page,
  baseUrl,
  uniqueTitle,
  uniqueRichHeading,
  placement = { page: 1, index: 0 },
) {
  await openAppPath(page, baseUrl, '/admin/events');

  const card = await scrollToSeededEventCard(
    page,
    uniqueTitle,
    placement.page,
  );
  if (card) {
    await card.locator.click();
    await expect(page).toHaveURL(/\/admin\/events\/edit/, {
      timeout: appBootTimeoutMs,
    });
    await expectAdminEditFormForEvent(page, uniqueTitle, uniqueRichHeading);
    return;
  }

  throw new Error(
    `Seeded admin event card "${uniqueTitle}" was present in the admin API `
      + `at page ${placement.page}, index ${placement.index}, but the real `
      + 'admin Events UI did not expose a reachable text/semantic edit card. '
      + 'This spec intentionally has no coordinate fallback.',
  );
}

async function assertVisibleRichText(page, expectedTexts) {
  for (const text of expectedTexts) {
    await expect(page.getByText(textPattern(text)).first()).toBeVisible({
      timeout: appBootTimeoutMs,
    });
  }
  await expect(
    page.getByText(
      /Bold eventSecond event lineItalic event and strike eventEvent quoteEvent bulletEvent ordered/i,
    ),
  ).toHaveCount(0);
  await expect(
    page.getByText(/<h[1-6]|<strong>|<em>|<s>|<ul>|<ol>|<blockquote>|<script|<u>|<a\s/i),
  ).toHaveCount(0);
}

test('@mutation tenant-admin event rich text persists and renders in public Sobre', async ({
  browser,
}) => {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  const uniqueSuffix = Date.now().toString();
  let adminContext;
  let publicContext;
  let session = null;
  let eventId = null;
  let eventTypeId = null;

  const uniqueRichHeading = `Event Rich Heading ${uniqueSuffix.slice(-6)} 🎉`;
  const richContent = `<h2>${uniqueRichHeading}</h2>`
    + '<p><strong>Bold event</strong><br />Second event line</p>'
    + '<p><em>Italic event</em> and <s>strike event</s></p>'
    + '<blockquote>Event quote</blockquote>'
    + '<ul><li>Event bullet</li></ul>'
    + '<ol><li>Event ordered</li></ol>'
    + '<script>badEvent()</script>'
    + '<p><u>Unsupported underline</u> <a href="https://example.test">unsupported link text</a></p>';
  const expectedTexts = [
    uniqueRichHeading,
    'Bold event',
    'Second event line',
    'Italic event',
    'strike event',
    'Event quote',
    'Event bullet',
    'Event ordered',
    'Unsupported underline',
    'unsupported link text',
  ];

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

    const physicalHost = await fetchPhysicalHostCandidate(
      api,
      baseUrl,
      session.token,
    );
    const seededEvent = await createRichTextEvent(api, baseUrl, session.token, {
      eventType,
      physicalHost,
      uniqueSuffix,
      content: richContent,
    });
    eventId = seededEvent?.event_id?.toString() || null;
    const eventSlug = seededEvent?.slug?.toString() || eventId;
    const uniqueTitle = seededEvent?.title?.toString();
    expect(eventId, 'Seeded Event must return event_id.').toBeTruthy();
    expect(uniqueTitle, 'Seeded Event must return title.').toBeTruthy();

    const adminReadback = await fetchAdminEvent(
      api,
      baseUrl,
      session.token,
      eventId,
    );
    expect(adminReadback?.content).toContain(`<h2>${uniqueRichHeading}</h2>`);
    expect(adminReadback?.content).toContain('<strong>Bold event</strong>');
    expect(adminReadback?.content).toContain('<br');
    expect(adminReadback?.content).toContain('<em>Italic event</em>');
    expect(adminReadback?.content).toContain('<s>strike event</s>');
    expect(adminReadback?.content).toContain('<blockquote>Event quote</blockquote>');
    expect(adminReadback?.content).toContain('<ul><li>Event bullet</li></ul>');
    expect(adminReadback?.content).toContain('<ol><li>Event ordered</li></ol>');
    expect(adminReadback?.content).not.toContain('<script');
    expect(adminReadback?.content).not.toContain('<u>');
    expect(adminReadback?.content).not.toContain('<a ');

    const publicReadback = await fetchPublicEvent(api, baseUrl, eventSlug);
    expect(publicReadback?.content).toContain(uniqueRichHeading);
    expect(publicReadback?.content).toContain('<blockquote>Event quote</blockquote>');
    expect(publicReadback?.content).not.toContain('<script');

    publicContext = await browser.newContext({
      ignoreHTTPSErrors: true,
    });
    const publicPage = await publicContext.newPage();
    const publicCollectors = installFailureCollectors(publicPage);
    await openAppPath(publicPage, baseUrl, `/agenda/evento/${eventSlug}`);
    await expect(publicPage).toHaveURL(
      new RegExp(`/agenda/evento/${escapeRegExp(eventSlug)}`),
      {
        timeout: appBootTimeoutMs,
      },
    );
    await expect(publicPage.getByText('Sobre').first()).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    await assertVisibleRichText(publicPage, expectedTexts);
    await expect(publicPage.getByText(/badEvent/i)).toHaveCount(0);
    await assertNoCriticalBrowserFailures(publicCollectors);

    const adminBundle = await createAuthenticatedTenantAdminPage(
      browser,
      session,
    );
    adminContext = adminBundle.context;
    const adminPage = adminBundle.page;
    const adminCollectors = installFailureCollectors(adminPage);
    const placement = await locateAdminEventListPlacement(
      api,
      baseUrl,
      session.token,
      eventId,
    );
    await openSeededEventFromAdminList(
      adminPage,
      baseUrl,
      uniqueTitle,
      uniqueRichHeading,
      placement,
    );
    await assertVisibleRichText(adminPage, expectedTexts);
    await assertNoCriticalBrowserFailures(adminCollectors);
  } finally {
    if (session?.token) {
      await deleteEvent(api, baseUrl, session.token, eventId);
      await deleteEventType(api, baseUrl, session.token, eventTypeId);
    }
    if (publicContext) {
      await publicContext.close().catch(() => {});
    }
    if (adminContext) {
      await adminContext.close().catch(() => {});
    }
    await api.dispose();
  }
});
