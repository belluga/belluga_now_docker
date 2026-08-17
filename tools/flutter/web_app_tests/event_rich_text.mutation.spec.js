const crypto = require('crypto');
const { test, expect, request } = require('@playwright/test');
const {
  loginTenantAdmin: loginTenantAdminWithRequiredCredentials,
} = require('./support/tenant_admin_auth');
const {
  installFailureCollectors,
  summarizeCriticalBrowserFailures,
} = require('./support/browser_failure_collectors');

const tenantUrl = process.env.NAV_TENANT_URL;
const appBootTimeoutMs = 90000;
const apiRequestTimeoutMs = 30000;

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

function normalizeReadableText(value) {
  return (value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePayload(payload) {
  if (payload?.data && typeof payload.data === 'object') {
    return payload.data;
  }
  return payload;
}

async function assertNoCriticalBrowserFailures(collectors) {
  const summary = summarizeCriticalBrowserFailures(collectors);
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
    timeout: apiRequestTimeoutMs,
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
    timeout: apiRequestTimeoutMs,
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

function matchesAdminEventsListResponse(candidate, baseUrl) {
  const method = candidate.request().method().toUpperCase();
  if (method !== 'GET') {
    return false;
  }

  const actual = new URL(candidate.url());
  const expected = new URL(buildUrl(baseUrl, '/admin/api/v1/events'));
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

async function countTextInViewport(page, text) {
  const viewport =
    page.viewportSize() ||
    (await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    })));

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

async function expectAdminEditFormForEvent(page, uniqueTitle, uniqueRichHeading) {
  await expect(page.getByText('Editar evento').first()).toBeVisible({
    timeout: appBootTimeoutMs,
  });
  expect(uniqueTitle, 'Seeded event title must be known before admin edit.')
    .toBeTruthy();
}

async function openSeededEventFromAdminList(
  page,
  baseUrl,
  uniqueTitle,
  uniqueRichHeading,
  placement = { page: 1, index: 0 },
) {
  async function openList() {
    let listResponse = null;
    const captureListResponse = (candidate) => {
      if (!listResponse && matchesAdminEventsListResponse(candidate, baseUrl)) {
        listResponse = candidate;
      }
    };
    page.on('response', captureListResponse);
    const response = await page.goto(buildUrl(baseUrl, '/admin/events'), {
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

    if (!listResponse) {
      return;
    }

    expect(
      listResponse.status(),
      'Tenant-admin events list response must succeed before UI assertions.',
    ).toBeGreaterThanOrEqual(200);
    expect(
      listResponse.status(),
      'Tenant-admin events list response must succeed before UI assertions.',
    ).toBeLessThan(300);
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
      placement.page,
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
    await waitForAdminEventsListUiReady(page);
    titleCandidate = await resolveTitleCandidate();
  }
  if (!titleCandidate.locator) {
    await nudgeAdminEventListRefresh(page);
    await waitForAdminEventsListUiReady(page);
    titleCandidate = await resolveTitleCandidate();
  }
  if (titleCandidate.locator) {
    await titleCandidate.locator.scrollIntoViewIfNeeded({ timeout: appBootTimeoutMs }).catch(() => {});
    await titleCandidate.locator.click({ timeout: appBootTimeoutMs });
    await expect(page).toHaveURL(/\/admin\/events\/[^/]+\/edit(?:\?.*)?$/, {
      timeout: appBootTimeoutMs,
    });
    await expectAdminEditFormForEvent(page, uniqueTitle, uniqueRichHeading);
    return;
  }

  await waitForTextInViewport(
    page,
    uniqueTitle,
    `Seeded admin event card "${uniqueTitle}" must be reachable before editing.`,
  );

  throw new Error(
    `Seeded admin event card "${uniqueTitle}" was present in the admin API `
      + `at page ${placement.page}, index ${placement.index}, but the real `
      + 'admin Events UI did not expose a reachable text/semantic edit card. '
      + 'This spec intentionally has no coordinate fallback.',
  );
}

async function assertVisibleRichText(page, expectedTexts) {
  for (const text of expectedTexts) {
    const normalizedExpected = normalizeReadableText(text);
    await expect
      .poll(
        async () =>
          normalizeReadableText(
            await page.evaluate(() => document.body?.innerText || ''),
          ),
        {
          timeout: appBootTimeoutMs,
          message: `Expected visible text "${normalizedExpected}" in page body text.`,
        },
      )
      .toContain(normalizedExpected);
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
