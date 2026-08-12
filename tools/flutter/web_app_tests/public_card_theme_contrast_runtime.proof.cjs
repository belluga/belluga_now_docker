'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium, expect, request } = require('@playwright/test');
const { loginTenantAdmin } = require('./support/tenant_admin_auth');
const { seedFlutterSecureStorage } = require('./support/tenant_admin_seeded_session');
const {
  installFailureCollectors,
  summarizeCriticalBrowserFailures,
} = require('./support/browser_failure_collectors');
const {
  cleanupOnboardedAccounts,
  runCleanupPreservingPrimaryError,
} = require('./support/account_onboarding_cleanup');

const tenantUrl = process.env.NAV_TENANT_URL;
const appBootTimeoutMs = Number.parseInt(
  process.env.NAV_APP_BOOT_TIMEOUT_MS || '90000',
  10,
);
const screenshotDir =
  process.env.NAV_PUBLIC_CARD_THEME_SCREENSHOT_DIR ||
  path.join(os.tmpdir(), 'belluga-web-navigation', 'public-card-theme-contrast');

function requireTenantUrl() {
  expect(
    tenantUrl,
    'Missing NAV_TENANT_URL. Public card theme runtime proof requires a live tenant URL.',
  ).toBeTruthy();
  return tenantUrl;
}

function requireLocalPublicTenantUrl() {
  const baseUrl = requireTenantUrl();
  const parsed = new URL(baseUrl);
  expect(
    parsed.protocol,
    `Public card theme runtime proof must use HTTPS local-public tunnel hosts. Received ${baseUrl}.`,
  ).toBe('https:');
  expect(
    parsed.hostname.toLowerCase(),
    `Public card theme runtime proof must target the local-public tenant tunnel host, never a production custom domain. Received ${baseUrl}.`,
  ).toMatch(/^[a-z0-9-]+\.belluga\.space$/);
  return baseUrl;
}

function buildUrl(baseUrl, pathName, searchParams = {}) {
  const url = new URL(pathName, baseUrl);
  for (const [key, value] of Object.entries(searchParams)) {
    if (value != null && value !== '') {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function authHeaders(token) {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
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

function normalizeRunSuffix() {
  const raw = (process.env.NAV_TEST_RUN_ID || `u02-${Date.now()}`)
    .toString()
    .trim()
    .toLowerCase();
  const normalized = raw.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  expect(
    normalized,
    'Runtime proof requires a non-empty normalized run suffix.',
  ).toBeTruthy();
  return normalized.slice(0, 40);
}

function numericRunSuffix(runSuffix) {
  const digits = runSuffix.replace(/\D+/g, '').slice(-4);
  return digits.padStart(4, '0');
}

function reviewAccessPhone(runSuffix) {
  return `+552799999${numericRunSuffix(runSuffix)}`;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJsonArtifact(fileName, payload) {
  ensureDir(screenshotDir);
  fs.writeFileSync(
    path.join(screenshotDir, fileName),
    `${JSON.stringify(payload, null, 2)}\n`,
    'utf8',
  );
}

async function createApiContext(baseUrl) {
  return request.newContext({
    baseURL: baseUrl,
    extraHTTPHeaders: {
      Accept: 'application/json',
    },
    ignoreHTTPSErrors: true,
    timeout: 45000,
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

async function scrollUntilVisible(page, locator, description) {
  const viewport =
    page.viewportSize() ||
    (await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    })));

  await page.mouse.move(viewport.width * 0.55, viewport.height * 0.78);
  for (const direction of [1, -1]) {
    for (let attempt = 0; attempt < 34; attempt += 1) {
      if (await locator.isVisible().catch(() => false)) {
        return;
      }
      await page.mouse.wheel(0, direction * 220);
      await page.waitForTimeout(180);
    }
  }

  throw new Error(description);
}

function summarizeCollectors(collectors, label) {
  const hasOptionalProximity404 = (collectors.httpErrorResponses || []).some(
    (entry) =>
      Number(entry?.status) === 404 &&
      entry?.url?.includes('/api/v1/profile/proximity-preferences'),
  );
  const filteredConsolePairs = (collectors.consoleErrors || []).reduce(
    (result, errorText, index) => {
      const locationUrl = (collectors.consoleErrorUrls || [])[index] || '';
      const isOptionalProximity404Console =
        hasOptionalProximity404 &&
        locationUrl.includes('/api/v1/profile/proximity-preferences') &&
        errorText.startsWith(
          'Failed to load resource: the server responded with a status of 404',
        );
      const isOptionalProximity404ConsoleNoise =
        hasOptionalProximity404 &&
        locationUrl.length === 0 &&
        errorText ===
          'Failed to load resource: the server responded with a status of 404 ()';
      if (!isOptionalProximity404Console && !isOptionalProximity404ConsoleNoise) {
        result.consoleErrors.push(errorText);
        result.consoleErrorUrls.push(locationUrl);
      }
      return result;
    },
    { consoleErrors: [], consoleErrorUrls: [] },
  );
  const filteredCollectors = {
    ...collectors,
    consoleErrors: filteredConsolePairs.consoleErrors,
    consoleErrorUrls: filteredConsolePairs.consoleErrorUrls,
    httpErrorResponses: (collectors.httpErrorResponses || []).filter(
      (entry) =>
        !(
          Number(entry?.status) === 404 &&
          entry?.url?.includes('/api/v1/profile/proximity-preferences')
      ),
    ),
  };
  const summary = summarizeCriticalBrowserFailures(filteredCollectors);
  writeJsonArtifact(
    `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-collectors.json`,
    {
      label,
      raw: collectors,
      filtered: filteredCollectors,
      summary,
    },
  );
  expect(summary.runtimeErrors, `${label} must have no runtime page errors.`).toEqual([]);
  expect(summary.failedRequests, `${label} must have no critical failed requests.`).toEqual([]);
  expect(
    summary.criticalHttpResponses,
    `${label} must have no critical HTTP failures.`,
  ).toEqual([]);
  expect(
    summary.disallowedRateLimitedResponses,
    `${label} must have no disallowed rate-limited responses.`,
  ).toEqual([]);
  expect(
    summary.criticalConsoleErrors,
    `${label} must have no critical console errors.`,
  ).toEqual([]);
}

async function fetchTenantEnvironment(api, baseUrl, token = '') {
  const response = await api.get(buildUrl(baseUrl, '/api/v1/environment'), {
    headers: token ? authHeaders(token) : { Accept: 'application/json' },
  });
  expect(response.status(), 'Tenant environment must load.').toBe(200);
  const payload = await response.json();
  return payload?.data || payload;
}

async function fetchSettingsValues(api, baseUrl, token) {
  const response = await api.get(buildUrl(baseUrl, '/admin/api/v1/settings/values'), {
    headers: authHeaders(token),
  });
  expect(response.status(), 'Tenant settings values must load.').toBe(200);
  const payload = await response.json();
  return payload?.data || {};
}

async function patchSettingsNamespace(api, baseUrl, token, namespace, payload) {
  const response = await api.patch(
    buildUrl(baseUrl, `/admin/api/v1/settings/values/${encodeURIComponent(namespace)}`),
    {
      headers: authHeaders(token),
      data: payload,
    },
  );
  expect(
    response.status(),
    `Settings namespace ${namespace} must patch successfully.`,
  ).toBe(200);
  const body = await response.json();
  return body?.data || {};
}

async function generatePhoneOtpReviewAccessHash(api, baseUrl, token, code) {
  const response = await api.post(
    buildUrl(baseUrl, '/admin/api/v1/settings/values/phone_otp_review_access/hash'),
    {
      headers: authHeaders(token),
      data: { code },
    },
  );
  expect(response.status(), 'Review-access hash helper must succeed.').toBe(200);
  const body = await response.json();
  const codeHash = body?.data?.code_hash?.toString().trim() || '';
  expect(codeHash, 'Review-access hash helper must return code_hash.').toBeTruthy();
  return codeHash;
}

async function updateReviewAccess(api, baseUrl, token, phone, code) {
  const codeHash = await generatePhoneOtpReviewAccessHash(api, baseUrl, token, code);
  const values = await patchSettingsNamespace(
    api,
    baseUrl,
    token,
    'phone_otp_review_access',
    {
      phone_e164: phone,
      code_hash: codeHash,
    },
  );
  expect(
    values?.phone_e164?.toString().trim(),
    'Patched review-access phone must echo back.',
  ).toBe(phone);
  return { phone_e164: phone, code_hash: codeHash };
}

async function waitForEnvironmentBrightness(api, baseUrl, expectedBrightness) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const environment = await fetchTenantEnvironment(api, baseUrl);
    const brightness =
      environment?.theme_data_settings?.brightness_default?.toString().trim() || '';
    if (brightness === expectedBrightness) {
      return environment;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }

  throw new Error(
    `Tenant environment did not converge to brightness_default=${expectedBrightness}.`,
  );
}

async function updateBranding(api, baseUrl, token, branding) {
  const form = new FormData();
  form.set('name', branding.name);
  form.set('theme_data_settings[brightness_default]', branding.brightnessDefault);
  form.set('theme_data_settings[primary_seed_color]', branding.primarySeedColor);
  form.set('theme_data_settings[secondary_seed_color]', branding.secondarySeedColor);
  form.set(
    'public_web_metadata[default_title]',
    branding.publicWebDefaultTitle || '',
  );
  form.set(
    'public_web_metadata[default_description]',
    branding.publicWebDefaultDescription || '',
  );

  const response = await api.post(buildUrl(baseUrl, '/admin/api/v1/branding/update'), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    multipart: Object.fromEntries(form.entries()),
  });
  expect(response.status(), 'Branding update must succeed.').toBeLessThan(400);
}

async function createAccountProfileType(api, baseUrl, token, type, label, plural) {
  const response = await api.post(
    buildUrl(baseUrl, '/admin/api/v1/account_profile_types'),
    {
      headers: authHeaders(token),
      data: {
        type,
        label,
        labels: {
          singular: label,
          plural,
        },
        allowed_taxonomies: [],
        capabilities: {
          is_queryable: true,
          is_publicly_navigable: false,
          is_favoritable: false,
          is_publicly_discoverable: false,
          is_poi_enabled: false,
          is_reference_location_enabled: false,
          has_avatar: true,
          has_cover: false,
          has_bio: false,
          has_content: false,
          has_taxonomies: false,
          has_events: false,
        },
        visual: {
          mode: 'icon',
          icon: 'store',
          color: '#0F766E',
          icon_color: '#FFFFFF',
        },
      },
    },
  );
  expect(response.status(), `Account profile type ${type} must be created.`).toBe(201);
}

async function deleteAccountProfileType(api, baseUrl, token, type) {
  if (!type) {
    return;
  }

  const response = await api.delete(
    buildUrl(baseUrl, `/admin/api/v1/account_profile_types/${encodeURIComponent(type)}`),
    {
      headers: authHeaders(token),
      failOnStatusCode: false,
      timeout: 15000,
    },
  );
  expect([200, 202, 204, 404, 422]).toContain(response.status());
}

async function createAccountProfile(api, baseUrl, token, profileType, name) {
  const response = await api.post(
    buildUrl(baseUrl, '/admin/api/v1/account_onboardings'),
    {
      headers: authHeaders(token),
      data: {
        name,
        ownership_state: 'unmanaged',
        profile_type: profileType,
      },
    },
  );
  expect(response.status(), `Account profile ${name} must be created.`).toBe(201);
  const payload = await response.json();
  const data = payload?.data || {};
  const account = data?.account || {};
  const profile = data?.account_profile || {};
  const id = profile?.id?.toString() || '';
  expect(id, `Account profile ${name} must return id.`).toBeTruthy();
  return {
    id,
    displayName: textValue(profile?.display_name, name),
    accountSlug: account?.slug?.toString() || '',
  };
}

async function createPoiCapableProfileType(api, baseUrl, token, suffix) {
  const type = `pw_u02_host_${suffix}`;
  const response = await api.post(
    buildUrl(baseUrl, '/admin/api/v1/account_profile_types'),
    {
      headers: authHeaders(token),
      data: {
        type,
        label: `PW U02 Host ${suffix}`,
        labels: {
          singular: `PW U02 Host ${suffix}`,
          plural: `PW U02 Hosts ${suffix}`,
        },
        allowed_taxonomies: [],
        capabilities: {
          is_queryable: true,
          is_publicly_navigable: false,
          is_favoritable: false,
          is_publicly_discoverable: false,
          is_poi_enabled: true,
          is_reference_location_enabled: true,
          has_avatar: true,
          has_cover: false,
          has_bio: false,
          has_content: false,
          has_taxonomies: false,
          has_events: false,
        },
        visual: {
          mode: 'icon',
          icon: 'store',
          color: '#2563EB',
          icon_color: '#FFFFFF',
        },
      },
    },
  );
  expect(response.status(), 'POI-capable host type seed must succeed.').toBe(201);
  return { type };
}

async function createPhysicalHost(api, baseUrl, token, suffix) {
  const profileType = await createPoiCapableProfileType(api, baseUrl, token, suffix);
  const response = await api.post(
    buildUrl(baseUrl, '/admin/api/v1/account_onboardings'),
    {
      headers: authHeaders(token),
      data: {
        name: `PW U02 Host ${suffix}`,
        ownership_state: 'unmanaged',
        profile_type: profileType.type,
        location: {
          lat: -20.671339,
          lng: -40.495395,
        },
      },
    },
  );
  expect(response.status(), 'Physical host seed must succeed.').toBe(201);
  const payload = await response.json();
  const account = payload?.data?.account || {};
  const profile = payload?.data?.account_profile || {};
  return {
    id: profile?.id?.toString() || '',
    displayName: textValue(profile?.display_name, `PW U02 Host ${suffix}`),
    cleanupAccountSlug: account?.slug?.toString() || '',
    cleanupProfileType: profileType.type,
  };
}

async function createEventType(api, baseUrl, token, suffix) {
  const response = await api.post(buildUrl(baseUrl, '/admin/api/v1/event_types'), {
    headers: authHeaders(token),
    data: {
      name: `PW U02 Tipo Evento ${suffix}`,
      slug: `pw-u02-tipo-evento-${suffix}`,
      description: 'Public card theme contrast runtime proof event type',
    },
  });
  expect(response.status(), 'Runtime-proof event type must be created.').toBe(201);
  const payload = await response.json();
  return payload?.data;
}

function futureWindow(daysFromNow, hourOffset = 0) {
  const start = new Date(
    Date.now() + daysFromNow * 24 * 60 * 60 * 1000 + hourOffset * 60 * 60 * 1000,
  );
  start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  return {
    date_time_start: start.toISOString(),
    date_time_end: end.toISOString(),
  };
}

async function createDiagnosticEvent(
  api,
  baseUrl,
  token,
  {
    title,
    eventType,
    host,
    daysFromNow,
    occurrenceProfileGroups = [],
    occurrenceGroupMembers = [],
  },
) {
  const resolvedOccurrenceGroups = occurrenceProfileGroups.map((group, index) => ({
    id: group.id,
    label: group.label,
    order: group.order ?? index,
  }));
  const response = await api.post(buildUrl(baseUrl, '/admin/api/v1/events'), {
    headers: authHeaders(token),
    data: {
      title,
      content: `<p>${title} validates public card contrast on the served runtime.</p>`,
      type: {
        id: eventType.id,
        name: eventType.name,
        slug: eventType.slug,
        description: eventType.description || 'Runtime proof event type',
      },
      location: {
        mode: 'physical',
      },
      place_ref: {
        type: 'account_profile',
        id: host.id,
      },
      occurrences: [
        {
          ...futureWindow(daysFromNow),
        },
      ],
      publication: {
        status: 'published',
        publish_at: new Date(Date.now() - 60 * 1000).toISOString(),
      },
    },
  });
  const body = await response.json().catch(async () => ({
    raw: await response.text().catch(() => ''),
  }));
  expect(
    response.status(),
    `Runtime-proof event must be created. Response: ${JSON.stringify(body)}`,
  ).toBe(201);
  const event = body?.data;
  const occurrenceId = firstOccurrenceId(event);
  const canonicalOccurrenceGroupIds = new Map();
  for (const group of resolvedOccurrenceGroups) {
    const createGroupResponse = await api.post(
      buildUrl(
        baseUrl,
        `/admin/api/v1/events/${event.event_id}/occurrences/${occurrenceId}/profile_groups`,
      ),
      {
        headers: authHeaders(token),
        data: {
          label: group.label,
        },
      },
    );
    const createGroupBody = await createGroupResponse.json().catch(async () => ({
      raw: await createGroupResponse.text().catch(() => ''),
    }));
    expect(
      createGroupResponse.status(),
      `Runtime-proof event must create occurrence group ${group.label}. Response: ${JSON.stringify(createGroupBody)}`,
    ).toBe(201);
    const canonicalGroupId =
      (Array.isArray(createGroupBody?.data?.profile_groups)
        ? createGroupBody.data.profile_groups.find(
            (candidate) => candidate?.label === group.label,
          ) || createGroupBody.data.profile_groups.at(-1)
        : null)?.id?.toString() || '';
    expect(
      canonicalGroupId,
      `Runtime-proof event must return a canonical id for occurrence group ${group.label}.`,
    ).toBeTruthy();
    canonicalOccurrenceGroupIds.set(group.id, canonicalGroupId);
  }
  for (const group of occurrenceGroupMembers) {
    const canonicalGroupId =
      canonicalOccurrenceGroupIds.get(group.groupId) || group.groupId;
    expect(
      canonicalGroupId,
      `Runtime-proof event must resolve a canonical occurrence group id before patching members for ${group.groupId}.`,
    ).toBeTruthy();
    const responseGroupMembers = await api.patch(
      buildUrl(
        baseUrl,
        `/admin/api/v1/events/${event.event_id}/occurrences/${occurrenceId}/profile_groups/${canonicalGroupId}/members`,
      ),
      {
        headers: authHeaders(token),
        data: {
          add_ids: group.addIds,
        },
      },
    );
    expect(
      responseGroupMembers.status(),
      `Runtime-proof event must patch group members for ${group.groupId}.`,
    ).toBeLessThan(400);
  }
  return event;
}

function firstOccurrenceId(event) {
  const occurrenceId = event?.occurrences?.[0]?.occurrence_id?.toString() || '';
  expect(occurrenceId, 'Runtime-proof event must expose first occurrence id.').toBeTruthy();
  return occurrenceId;
}

function eventRoutePath(event) {
  const routeRef = textValue(event?.slug, event?.event_id);
  expect(routeRef, 'Runtime-proof event must expose slug or event id.').toBeTruthy();
  return `/agenda/evento/${routeRef}?occurrence=${firstOccurrenceId(event)}`;
}

async function deleteEvent(api, baseUrl, token, event) {
  const eventId = event?.event_id?.toString() || '';
  if (!eventId) {
    return;
  }

  const response = await api.delete(
    buildUrl(baseUrl, `/admin/api/v1/events/${eventId}`),
    {
      headers: authHeaders(token),
      failOnStatusCode: false,
      timeout: 15000,
    },
  );
  expect([200, 202, 204, 404]).toContain(response.status());
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
  expect([200, 202, 204, 404]).toContain(response.status());
}

async function loginPublicUserViaReviewAccess(api, baseUrl, phone, code, deviceName) {
  const challengeResponse = await api.post(
    buildUrl(baseUrl, '/api/v1/auth/otp/challenge'),
    {
      headers: { Accept: 'application/json' },
      data: {
        phone,
        device_name: deviceName,
      },
    },
  );
  expect(challengeResponse.status(), 'OTP challenge must succeed.').toBe(202);
  const challengePayload = await challengeResponse.json();
  const challengeId =
    challengePayload?.data?.challenge_id?.toString().trim() || '';
  expect(challengeId, 'OTP challenge must return challenge_id.').toBeTruthy();

  const verifyResponse = await api.post(
    buildUrl(baseUrl, '/api/v1/auth/otp/verify'),
    {
      headers: { Accept: 'application/json' },
      data: {
        challenge_id: challengeId,
        phone,
        code,
        device_name: deviceName,
      },
    },
  );
  expect(verifyResponse.status(), 'OTP verification must succeed.').toBe(200);
  const verifyPayload = await verifyResponse.json();
  const token = verifyPayload?.data?.token?.toString().trim() || '';
  const userId = verifyPayload?.data?.user_id?.toString().trim() || '';
  expect(token, 'OTP verification must return token.').toBeTruthy();
  expect(userId, 'OTP verification must return user_id.').toBeTruthy();
  return { token, userId };
}

async function confirmAttendance(api, baseUrl, token, eventId, occurrenceId) {
  const response = await api.post(
    buildUrl(baseUrl, `/api/v1/events/${eventId}/attendance/confirm`),
    {
      headers: authHeaders(token),
      data: {
        occurrence_id: occurrenceId,
      },
    },
  );
  expect(response.status(), 'Attendance confirmation must succeed.').toBeLessThan(300);
}

async function fetchConfirmedOccurrenceIds(api, baseUrl, token) {
  const response = await api.get(
    buildUrl(baseUrl, '/api/v1/events/attendance/confirmed'),
    {
      headers: authHeaders(token),
    },
  );
  expect(response.status(), 'Confirmed attendance list must load.').toBe(200);
  const payload = await response.json();
  return payload?.data?.confirmed_occurrence_ids || payload?.confirmed_occurrence_ids || [];
}

async function fetchConfirmedAgendaItems(api, baseUrl, token) {
  const response = await api.get(
    buildUrl(baseUrl, '/api/v1/agenda', {
      confirmed_only: 1,
      past_only: 0,
    }),
    {
      headers: authHeaders(token),
    },
  );
  expect(response.status(), 'Confirmed-only agenda query must load.').toBe(200);
  const payload = await response.json();
  return payload?.data?.items || payload?.items || [];
}

async function deleteCurrentPublicUser(api, baseUrl, token) {
  if (!token) {
    return;
  }

  const response = await api.delete(buildUrl(baseUrl, '/api/v1/profile'), {
    headers: authHeaders(token),
    data: { confirmation: 'remove_account' },
    failOnStatusCode: false,
    timeout: 30000,
  });
  expect([200, 202, 204, 401, 404]).toContain(response.status());
}

async function createAuthenticatedPublicPage(browser, session) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
  });
  await seedFlutterSecureStorage(context, {
    user_token: session.token,
    user_id: session.userId,
  });
  const page = await context.newPage();
  return { context, page };
}

async function openPublicPath(page, baseUrl, pathName) {
  const response = await page.goto(buildUrl(baseUrl, pathName), {
    waitUntil: 'domcontentloaded',
  });
  expect(response, `Response should exist for ${pathName}.`).not.toBeNull();
  expect(response.status(), `Response should be successful for ${pathName}.`).toBeLessThan(
    400,
  );
  await assertAppBooted(page);
  await enableAccessibilityIfNeeded(page);
}

async function clickTab(page, label) {
  const exactPattern = new RegExp(`^${escapeRegExp(label)}$`, 'i');
  const roleTab = page.getByRole('button', { name: exactPattern }).first();
  if (await roleTab.isVisible().catch(() => false)) {
    await roleTab.click();
    return;
  }

  const textTab = page.getByText(exactPattern).first();
  await expect(textTab, `Tab ${label} must be visible.`).toBeVisible({
    timeout: appBootTimeoutMs,
  });
  await textTab.click();
}

async function waitForMyEventsHomeProof(page, eventTitle) {
  const header = page.getByText(/^Meus Eventos$/i).first();
  const titlePattern = new RegExp(escapeRegExp(eventTitle), 'i');
  const title = page.getByRole('img', { name: titlePattern }).first();
  const deadline = Date.now() + appBootTimeoutMs;
  let lastVisibleText = '';
  const eventTitlePrefix = eventTitle.slice(0, 18).toLowerCase();

  while (Date.now() < deadline) {
    const headerVisible = await header.isVisible().catch(() => false);
    const titleVisible = await title.isVisible().catch(() => false);
    if (headerVisible && titleVisible) {
      return { header, title };
    }

    lastVisibleText = (
      await page.locator('body').textContent().catch(() => '')
    )
      .replace(/\s+/g, ' ')
      .trim();
    await page.mouse.wheel(0, 260);
    await page.waitForTimeout(1000);
  }

  const debugScreenshotPath = path.join(
    screenshotDir,
    'my-events-light-missing-debug.png',
  );
  await page.screenshot({
    path: debugScreenshotPath,
    fullPage: true,
  }).catch(() => {});
  const debugSnapshot = await page.evaluate(() => ({
    bodyClassName: document.body?.className || '',
    buttonCount: document.querySelectorAll('[role="button"]').length,
    fltGlassPaneCount: document.querySelectorAll('flt-glass-pane').length,
    fltSemanticsCount: document.querySelectorAll('flt-semantics').length,
    splashCount: document.querySelectorAll('#splash-screen').length,
    accessibilityPlaceholderCount: document.querySelectorAll(
      'flt-semantics-placeholder[aria-label="Enable accessibility"]',
    ).length,
  })).catch(() => ({}));
  const semanticsSnapshot = await page.evaluate((prefix) => {
    const rows = [...document.querySelectorAll('flt-semantics')]
      .map((node) => {
        const text = node.textContent?.replace(/\s+/g, ' ').trim() || '';
        const aria = node.getAttribute('aria-label')?.trim() || '';
        const role = node.getAttribute('role')?.trim() || '';
        const rect = node.getBoundingClientRect();
        return {
          text,
          aria,
          role,
          top: Math.round(rect.top),
          left: Math.round(rect.left),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      })
      .filter((entry) => entry.text || entry.aria);
    return {
      matchingTitleNodes: rows.filter((entry) =>
        `${entry.text} ${entry.aria}`.toLowerCase().includes(prefix),
      ),
      firstNodes: rows.slice(0, 40),
    };
  }, eventTitlePrefix).catch(() => ({}));

  throw new Error(
    `Expected Meus Eventos section with ${eventTitle}. Visible text snapshot: ${lastVisibleText.slice(0, 600)}. Debug: ${JSON.stringify(debugSnapshot)}. Semantics: ${JSON.stringify(semanticsSnapshot)}. Screenshot: ${debugScreenshotPath}`,
  );
}

async function main() {
  const baseUrl = requireLocalPublicTenantUrl();
  ensureDir(screenshotDir);
  const api = await createApiContext(baseUrl);
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  });
  const runSuffix = normalizeRunSuffix();
  const reviewPhone = reviewAccessPhone(runSuffix);
  const reviewCode = '123456';
  const createdAccountSlugs = [];
  const createdProfileTypes = [];
  let createdEvent = null;
  let createdEventTypeId = '';
  let publicSession = null;
  let originalSettings = null;
  let originalEnvironment = null;
  let lightContext = null;
  let darkContext = null;
  let primaryError = null;

  try {
    const adminSession = await loginTenantAdmin({
      api,
      baseUrl,
      deviceName: `playwright-u02-public-card-contrast-${runSuffix}`,
    });
    const adminToken = adminSession.token;

    originalSettings = await fetchSettingsValues(api, baseUrl, adminToken);
    originalEnvironment = await fetchTenantEnvironment(api, baseUrl);

    await updateReviewAccess(api, baseUrl, adminToken, reviewPhone, reviewCode);

    const typeA = `pw_u02_alpha_${runSuffix}`;
    const typeB = `pw_u02_beta_${runSuffix}`;
    await createAccountProfileType(
      api,
      baseUrl,
      adminToken,
      typeA,
      `Tipo Alpha ${runSuffix}`,
      `Tipos Alpha ${runSuffix}`,
    );
    await createAccountProfileType(
      api,
      baseUrl,
      adminToken,
      typeB,
      `Tipo Beta ${runSuffix}`,
      `Tipos Beta ${runSuffix}`,
    );
    createdProfileTypes.push(typeA, typeB);

    const [alphaOne, betaOne] = await Promise.all([
      createAccountProfile(api, baseUrl, adminToken, typeA, `PW U02 Alpha ${runSuffix}`),
      createAccountProfile(api, baseUrl, adminToken, typeB, `PW U02 Beta ${runSuffix}`),
    ]);
    createdAccountSlugs.push(alphaOne.accountSlug, betaOne.accountSlug);

    const host = await createPhysicalHost(api, baseUrl, adminToken, runSuffix);
    if (host.cleanupAccountSlug) {
      createdAccountSlugs.push(host.cleanupAccountSlug);
    }
    if (host.cleanupProfileType) {
      createdProfileTypes.push(host.cleanupProfileType);
    }

    const eventType = await createEventType(api, baseUrl, adminToken, runSuffix);
    createdEventTypeId = eventType?.id?.toString() || '';

    const eventTitle = `PW U02 Contraste ${runSuffix}`;
    createdEvent = await createDiagnosticEvent(api, baseUrl, adminToken, {
      title: eventTitle,
      eventType,
      host,
      occurrenceProfileGroups: [
        {
          id: 'bandas-contraste',
          label: 'Bandas Contraste',
          order: 0,
        },
      ],
      occurrenceGroupMembers: [
        {
          groupId: 'bandas-contraste',
          addIds: [alphaOne.id, betaOne.id],
        },
      ],
      daysFromNow: 10,
    });

    publicSession = await loginPublicUserViaReviewAccess(
      api,
      baseUrl,
      reviewPhone,
      reviewCode,
      `playwright-u02-public-user-${runSuffix}`,
    );

    const occurrenceId = firstOccurrenceId(createdEvent);
    await confirmAttendance(
      api,
      baseUrl,
      publicSession.token,
      createdEvent.event_id,
      occurrenceId,
    );
    const confirmedOccurrenceIds = await fetchConfirmedOccurrenceIds(
      api,
      baseUrl,
      publicSession.token,
    );
    expect(
      confirmedOccurrenceIds,
      'Confirmed attendance list must include the seeded occurrence.',
    ).toContain(occurrenceId);
    const confirmedAgendaItems = await fetchConfirmedAgendaItems(
      api,
      baseUrl,
      publicSession.token,
    );
    expect(
      confirmedAgendaItems.some((item) => {
        const itemTitle = item?.title?.toString().trim() || '';
        const itemOccurrenceId =
          item?.occurrence_id?.toString().trim() ||
          item?.occurrences?.[0]?.occurrence_id?.toString().trim() ||
          '';
        return itemTitle === eventTitle || itemOccurrenceId === occurrenceId;
      }),
      'Confirmed-only agenda query must include the seeded event before Home proof.',
    ).toBe(true);
    writeJsonArtifact('confirmed-agenda-direct.json', {
      occurrenceId,
      eventTitle,
      items: confirmedAgendaItems,
    });

    const lightBundle = await createAuthenticatedPublicPage(browser, publicSession);
    lightContext = lightBundle.context;
    const lightPage = lightBundle.page;
    const lightCollectors = installFailureCollectors(lightPage);
    const confirmedAttendanceResponse = lightPage.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/events/attendance/confirmed') &&
        response.status() < 400,
      { timeout: appBootTimeoutMs },
    ).catch(() => null);
    const confirmedAgendaResponse = lightPage.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/agenda') &&
        response.url().includes('confirmed_only=1') &&
        response.status() < 400,
      { timeout: appBootTimeoutMs },
    ).catch(() => null);

    await openPublicPath(lightPage, baseUrl, '/');
    const [homeConfirmedAttendanceResponse, homeConfirmedAgendaResponse] =
      await Promise.all([
      confirmedAttendanceResponse,
      confirmedAgendaResponse,
    ]);
    expect(
      homeConfirmedAttendanceResponse,
      'Home proof must observe the confirmed-attendance refresh request.',
    ).not.toBeNull();
    expect(
      homeConfirmedAgendaResponse,
      'Home proof must observe the confirmed-only agenda request.',
    ).not.toBeNull();
    const [
      homeConfirmedAttendanceHeaders,
      homeConfirmedAgendaHeaders,
    ] = await Promise.all([
      homeConfirmedAttendanceResponse.request().allHeaders(),
      homeConfirmedAgendaResponse.request().allHeaders(),
    ]);
    expect(
      homeConfirmedAttendanceHeaders.authorization || '',
      'Home confirmed-attendance request must use the seeded registered bearer token.',
    ).toBe(`Bearer ${publicSession.token}`);
    expect(
      homeConfirmedAgendaHeaders.authorization || '',
      'Home confirmed-only agenda request must use the seeded registered bearer token.',
    ).toBe(`Bearer ${publicSession.token}`);
    const homeConfirmedAttendancePayload =
      await homeConfirmedAttendanceResponse.json();
    const homeConfirmedOccurrenceIds =
      homeConfirmedAttendancePayload?.data?.confirmed_occurrence_ids ||
      homeConfirmedAttendancePayload?.confirmed_occurrence_ids ||
      [];
    expect(
      homeConfirmedOccurrenceIds,
      'Home confirmed-attendance refresh must include the seeded occurrence.',
    ).toContain(occurrenceId);
    const homeConfirmedAgendaPayload = await homeConfirmedAgendaResponse.json();
    const homeConfirmedAgendaItems =
      homeConfirmedAgendaPayload?.data?.items ||
      homeConfirmedAgendaPayload?.items ||
      [];
    expect(
      homeConfirmedAgendaItems.some((item) => {
        const itemTitle = item?.title?.toString().trim() || '';
        const itemOccurrenceId =
          item?.occurrence_id?.toString().trim() ||
          item?.occurrences?.[0]?.occurrence_id?.toString().trim() ||
          '';
        return itemTitle === eventTitle || itemOccurrenceId === occurrenceId;
      }),
      'Home confirmed-only agenda response must include the seeded event.',
    ).toBe(true);
    writeJsonArtifact('confirmed-agenda-home.json', {
      occurrenceId,
      eventTitle,
      response: homeConfirmedAgendaPayload,
    });
    const { header: myEventsHeader, title: lightTitle } =
      await waitForMyEventsHomeProof(lightPage, eventTitle);
    await scrollUntilVisible(
      lightPage,
      myEventsHeader,
      'Expected Meus Eventos section to be visible for the confirmed user.',
    );
    await expect(myEventsHeader).toBeVisible({ timeout: appBootTimeoutMs });
    await scrollUntilVisible(
      lightPage,
      lightTitle,
      'Expected confirmed event title inside Meus Eventos.',
    );
    await expect(lightTitle).toBeVisible({ timeout: appBootTimeoutMs });
    const lightScreenshotPath = path.join(screenshotDir, 'my-events-light.png');
    await lightPage.screenshot({ path: lightScreenshotPath, fullPage: true });
    summarizeCollectors(lightCollectors, 'Light theme home proof');

    await updateBranding(api, baseUrl, adminToken, {
      name: textValue(originalEnvironment?.name, 'Guarappari'),
      brightnessDefault: 'dark',
      primarySeedColor: textValue(
        originalEnvironment?.theme_data_settings?.primary_seed_color,
        '#4FA0E3',
      ),
      secondarySeedColor: textValue(
        originalEnvironment?.theme_data_settings?.secondary_seed_color,
        '#4FA0E3',
      ),
      publicWebDefaultTitle: textValue(
        originalEnvironment?.public_web_metadata?.default_title,
      ),
      publicWebDefaultDescription: textValue(
        originalEnvironment?.public_web_metadata?.default_description,
      ),
    });
    await waitForEnvironmentBrightness(api, baseUrl, 'dark');

    const darkBundle = await createAuthenticatedPublicPage(browser, publicSession);
    darkContext = darkBundle.context;
    const darkPage = darkBundle.page;
    const darkCollectors = installFailureCollectors(darkPage);

    await openPublicPath(darkPage, baseUrl, eventRoutePath(createdEvent));
    await clickTab(darkPage, 'Bandas Contraste');
    const alphaProfile = darkPage.getByText(new RegExp(alphaOne.displayName, 'i')).first();
    await scrollUntilVisible(
      darkPage,
      alphaProfile,
      'Expected linked profile card in dark theme tab.',
    );
    await expect(alphaProfile).toBeVisible({ timeout: appBootTimeoutMs });
    const darkScreenshotPath = path.join(
      screenshotDir,
      'linked-profiles-dark.png',
    );
    await darkPage.screenshot({ path: darkScreenshotPath, fullPage: true });
    summarizeCollectors(darkCollectors, 'Dark theme linked-profile proof');

    console.log(
      JSON.stringify(
        {
          status: 'passed',
          screenshots: {
            myEventsLight: lightScreenshotPath,
            linkedProfilesDark: darkScreenshotPath,
          },
          eventTitle,
          eventRoute: buildUrl(baseUrl, eventRoutePath(createdEvent)),
          reviewAccessPhone: reviewPhone,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    const cleanupTasks = [];

    cleanupTasks.push(async () => {
      if (darkContext) {
        await darkContext.close();
      }
    });
    cleanupTasks.push(async () => {
      if (lightContext) {
        await lightContext.close();
      }
    });
    cleanupTasks.push(async () => {
      if (originalEnvironment && originalSettings) {
        await updateBranding(api, baseUrl, await loginTenantAdmin({
          api,
          baseUrl,
          deviceName: `playwright-u02-restore-branding-${runSuffix}`,
        }).then((session) => session.token), {
          name: textValue(originalEnvironment?.name, 'Guarappari'),
          brightnessDefault: textValue(
            originalEnvironment?.theme_data_settings?.brightness_default,
            'light',
          ),
          primarySeedColor: textValue(
            originalEnvironment?.theme_data_settings?.primary_seed_color,
            '#4FA0E3',
          ),
          secondarySeedColor: textValue(
            originalEnvironment?.theme_data_settings?.secondary_seed_color,
            '#4FA0E3',
          ),
          publicWebDefaultTitle: textValue(
            originalEnvironment?.public_web_metadata?.default_title,
          ),
          publicWebDefaultDescription: textValue(
            originalEnvironment?.public_web_metadata?.default_description,
          ),
        });
        await waitForEnvironmentBrightness(
          api,
          baseUrl,
          textValue(
            originalEnvironment?.theme_data_settings?.brightness_default,
            'light',
          ),
        );
      }
    });
    cleanupTasks.push(async () => {
      if (originalSettings) {
        const restoreSession = await loginTenantAdmin({
          api,
          baseUrl,
          deviceName: `playwright-u02-restore-settings-${runSuffix}`,
        });
        const reviewAccess = originalSettings.phone_otp_review_access || {};
        await patchSettingsNamespace(
          api,
          baseUrl,
          restoreSession.token,
          'phone_otp_review_access',
          {
            phone_e164: reviewAccess.phone_e164 ?? '',
            code_hash: reviewAccess.code_hash ?? '',
          },
        );
      }
    });
    cleanupTasks.push(async () => {
      if (publicSession?.token) {
        await deleteCurrentPublicUser(api, baseUrl, publicSession.token);
      }
    });
    cleanupTasks.push(async () => {
      if (
        createdEvent ||
        createdEventTypeId ||
        createdAccountSlugs.length > 0 ||
        createdProfileTypes.length > 0
      ) {
        const restoreSession = await loginTenantAdmin({
          api,
          baseUrl,
          deviceName: `playwright-u02-clean-event-${runSuffix}`,
        });
        await deleteEvent(api, baseUrl, restoreSession.token, createdEvent);
        await deleteEventType(api, baseUrl, restoreSession.token, createdEventTypeId);
        await runCleanupPreservingPrimaryError(primaryError, async () => {
          await cleanupOnboardedAccounts(
            api,
            baseUrl,
            restoreSession.token,
            createdAccountSlugs.filter(Boolean),
          );
        });
        for (const profileType of createdProfileTypes.reverse()) {
          await deleteAccountProfileType(api, baseUrl, restoreSession.token, profileType);
        }
      }
    });
    cleanupTasks.push(async () => {
      await browser.close().catch(() => {});
    });
    cleanupTasks.push(async () => {
      await api.dispose().catch(() => {});
    });

    for (const task of cleanupTasks) {
      try {
        await task();
      } catch (cleanupError) {
        if (!primaryError) {
          throw cleanupError;
        }
        console.error('[public-card-theme-contrast-runtime] cleanup error', cleanupError);
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
