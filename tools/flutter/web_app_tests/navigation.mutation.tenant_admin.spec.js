const fs = require('fs');
const path = require('path');
const { test, expect, request } = require('@playwright/test');

const tenantUrl = process.env.NAV_TENANT_URL;
const adminEmail =
  process.env.NAV_ADMIN_EMAIL || 'admin@bellugasolutions.com.br';
const adminPassword = process.env.NAV_ADMIN_PASSWORD || '765432e1';
const fixtureImagePath = path.resolve(
  __dirname,
  '../../../foundation_documentation/todos/ephemeral/image.png',
);
const fixtureFaviconPath = path.resolve(
  __dirname,
  '../../../laravel-app/tests/Assets/tenant_1.ico',
);
const appBootTimeoutMs = 90000;

test.describe.configure({ timeout: 300000 });

function requireTenantUrl() {
  expect(
    tenantUrl,
    'Missing NAV_TENANT_URL. Tenant-admin mutation suite requires a live tenant URL.',
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

function resolveAbsoluteUrl(baseUrl, rawUrl) {
  return new URL(rawUrl, baseUrl).toString();
}

function urlsMatchIgnoringQuery(candidateUrl, expectedUrl) {
  try {
    const candidate = new URL(candidateUrl);
    const expected = new URL(expectedUrl);
    return (
      candidate.origin === expected.origin &&
      candidate.pathname === expected.pathname
    );
  } catch (_) {
    return candidateUrl.split('?')[0] === expectedUrl.split('?')[0];
  }
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

function logStep(flow, message) {
  console.log(`[tenant-admin][${flow}] ${message}`);
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
  await expect(page.locator('script[src*="main.dart.js"]')).toHaveCount(1, {
    timeout: appBootTimeoutMs,
  });
  await expect(page.locator('flt-glass-pane')).toHaveCount(1, {
    timeout: appBootTimeoutMs,
  });
  await expect(page.locator('#splash-screen')).toHaveCount(0, {
    timeout: appBootTimeoutMs,
  });
}

async function attachImageFromDevice(
  page,
  {
    flow,
    buttonName,
    buttonIndex = 0,
    cropTitle = null,
    fixturePath = fixtureImagePath,
  },
) {
  const trigger = page.getByRole('button', { name: buttonName }).nth(buttonIndex);
  await trigger.scrollIntoViewIfNeeded();
  await expect(trigger).toBeVisible({
    timeout: appBootTimeoutMs,
  });

  logStep(flow, `open image source sheet via ${buttonName}[${buttonIndex}]`);
  await trigger.click();
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByText('Do dispositivo').last().click(),
  ]);
  logStep(flow, `attach fixture ${fixturePath}`);
  await fileChooser.setFiles(fixturePath);

  if (!cropTitle) {
    return;
  }

  await expect(page.getByText(cropTitle)).toBeVisible({
    timeout: appBootTimeoutMs,
  });
  logStep(flow, `${cropTitle} visible`);
}

async function enableAccessibilityIfNeeded(page) {
  const a11yButton = page.getByRole('button', { name: /Enable accessibility/i });
  if ((await a11yButton.count()) === 0) {
    return;
  }

  const placeholder = page
    .locator('flt-semantics-placeholder[aria-label="Enable accessibility"]')
    .first();
  await placeholder.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
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
  const loginResponse = await api.post(
    buildApiUrl(baseUrl, '/admin/api/v1/auth/login'),
    {
      data: {
        email: adminEmail,
        password: adminPassword,
        device_name: 'playwright-web-navigation',
      },
    },
  );
  expect(loginResponse.status(), 'Tenant-admin login must succeed.').toBe(200);

  const loginPayload = await loginResponse.json();
  const token = loginPayload?.data?.token;
  expect(token, 'Tenant-admin login must return a bearer token.').toBeTruthy();

  const meResponse = await api.get(buildApiUrl(baseUrl, '/admin/api/v1/me'), {
    headers: authHeaders(token),
  });
  expect(meResponse.status(), 'Tenant-admin /me must succeed after login.').toBe(
    200,
  );
  const mePayload = await meResponse.json();

  return {
    token,
    userId: mePayload?.data?.user_id?.toString() || '',
  };
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

async function selectDropdownOption(
  page,
  {
    flow,
    fieldLabel,
    optionText,
    fallbackButtonName = null,
  },
) {
  const buttonTrigger = page.getByRole('button', {
    name: new RegExp(fieldLabel, 'i'),
  });
  if ((await buttonTrigger.count()) > 0) {
    logStep(flow, `open dropdown ${fieldLabel}`);
    await buttonTrigger.last().click();
  } else {
    if (fallbackButtonName) {
      const fallbackTrigger = page.getByRole('button', {
        name: new RegExp(fallbackButtonName, 'i'),
      });
      if ((await fallbackTrigger.count()) > 0) {
        logStep(flow, `open fallback dropdown ${fallbackButtonName}`);
        await fallbackTrigger.last().click();
      } else {
        const labelTrigger = page.getByLabel(fieldLabel);
        expect(
          await labelTrigger.count(),
          `Expected a visible trigger for dropdown "${fieldLabel}".`,
        ).toBeGreaterThan(0);
        logStep(flow, `open labeled dropdown ${fieldLabel}`);
        await labelTrigger.last().click();
      }
    } else {
      const labelTrigger = page.getByLabel(fieldLabel);
      expect(
        await labelTrigger.count(),
        `Expected a visible trigger for dropdown "${fieldLabel}".`,
      ).toBeGreaterThan(0);
      logStep(flow, `open labeled dropdown ${fieldLabel}`);
      await labelTrigger.last().click();
    }
  }

  const optionByRole = page.getByRole('option', { name: optionText });
  if ((await optionByRole.count()) > 0) {
    logStep(flow, `select option ${optionText} via role`);
    await optionByRole.last().click();
    return;
  }

  const optionByText = page.getByText(optionText, { exact: true });
  if ((await optionByText.count()) > 0) {
    logStep(flow, `select option ${optionText} via text`);
    await optionByText.last().click();
    return;
  }

  logStep(
    flow,
    `fallback to keyboard selection for ${fieldLabel} -> ${optionText}`,
  );
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
}

async function fetchPublicEnvironment(api, baseUrl) {
  const response = await api.get(buildApiUrl(baseUrl, '/api/v1/environment'));
  expect(response.status(), 'Public environment payload must load.').toBe(200);
  const payload = await response.json();
  return payload?.data || payload;
}

async function resolveImageCapableProfileType(
  api,
  baseUrl,
  token,
  { requireAvatar = false, requireCover = false } = {},
) {
  const response = await api.get(
    buildApiUrl(baseUrl, '/admin/api/v1/account_profile_types'),
    {
      headers: authHeaders(token),
    },
  );
  expect(response.status(), 'Account profile types must load for admin flows.').toBe(
    200,
  );

  const payload = await response.json();
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const selected =
    rows.find(
      (row) =>
        (!requireAvatar || row?.capabilities?.has_avatar === true) &&
        (!requireCover || row?.capabilities?.has_cover === true) &&
        row?.capabilities?.is_poi_enabled !== true,
    ) ||
    rows.find(
      (row) =>
        (!requireAvatar || row?.capabilities?.has_avatar === true) &&
        (!requireCover || row?.capabilities?.has_cover === true),
    );

  expect(
    selected,
    `Expected at least one account profile type with ` +
      `${requireAvatar ? 'has_avatar=true ' : ''}` +
      `${requireCover ? 'has_cover=true' : ''}`.trim(),
  ).toBeTruthy();

  return selected;
}

async function createImageTestProfile(
  api,
  baseUrl,
  token,
  { requireAvatar = false, requireCover = false } = {},
) {
  const profileType = await resolveImageCapableProfileType(api, baseUrl, token, {
    requireAvatar,
    requireCover,
  });
  const uniqueSuffix = Date.now();
  const payload = {
    name: `Playwright Cover ${uniqueSuffix}`,
    ownership_state: 'tenant_owned',
    profile_type: profileType.type,
  };

  if (profileType?.capabilities?.is_poi_enabled === true) {
    payload.location = {
      lat: -20.671339,
      lng: -40.495395,
    };
  }

  const response = await api.post(
    buildApiUrl(baseUrl, '/admin/api/v1/account_onboardings'),
    {
      data: payload,
      headers: authHeaders(token),
    },
  );
  expect(response.status(), 'Account onboarding must succeed for cover test.').toBe(
    201,
  );

  const created = await response.json();
  return {
    accountSlug: created?.data?.account?.slug,
    profileId: created?.data?.account_profile?.id,
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

async function createEventTypeWithTypeAsset(
  api,
  baseUrl,
  token,
  {
    name,
    slug,
    description = 'Tipo com imagem canônica',
  },
) {
  const response = await api.post(
    buildApiUrl(baseUrl, '/admin/api/v1/event_types'),
    {
      headers: authHeaders(token),
      multipart: {
        name,
        slug,
        description,
        'visual[mode]': 'image',
        'visual[image_source]': 'type_asset',
        'poi_visual[mode]': 'image',
        'poi_visual[image_source]': 'type_asset',
        type_asset: {
          name: 'event-type-asset.png',
          mimeType: 'image/png',
          buffer: fs.readFileSync(fixtureImagePath),
        },
      },
    },
  );
  expect(
    response.status(),
    'Seeded event type with type asset must be created successfully.',
  ).toBe(201);
  return response.json();
}

test('@mutation tenant-admin account-profile cover upload persists and renders after reload', async ({
  browser,
}) => {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  let browserContext;
  let verificationContext;
  let profileId = null;
  let session = null;

  try {
    session = await loginTenantAdmin(api, baseUrl);
    const created = await createImageTestProfile(api, baseUrl, session.token, {
      requireCover: true,
    });
    profileId = created.profileId;

    expect(created.accountSlug, 'Created onboarding must return an account slug.').toBeTruthy();
    expect(profileId, 'Created onboarding must return an account profile id.').toBeTruthy();

    const editUrl = buildApiUrl(
      baseUrl,
      `/admin/accounts/${created.accountSlug}/profiles/${profileId}/edit`,
    );
    const primaryPageBundle = await createAuthenticatedTenantAdminPage(
      browser,
      session,
    );
    browserContext = primaryPageBundle.context;
    const page = primaryPageBundle.page;
    const collectors = installFailureCollectors(page);

    logStep('cover', `open edit route ${editUrl}`);
    const initialResponse = await page.goto(editUrl, {
      waitUntil: 'domcontentloaded',
    });
    expect(initialResponse, 'Edit screen response should be available.').not.toBeNull();
    expect(initialResponse.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);

    await expect(page.getByRole('button', { name: 'Adicionar capa' })).toBeVisible({
      timeout: appBootTimeoutMs,
    });

    await attachImageFromDevice(page, {
      flow: 'cover',
      buttonName: 'Adicionar capa',
      cropTitle: 'Recortar capa',
    });

    const saveResponsePromise = page.waitForResponse((response) => {
      const method = response.request().method().toUpperCase();
      return (
        (method === 'PATCH' || method === 'POST') &&
        response.url().includes(`/admin/api/v1/account_profiles/${profileId}`) &&
        response.status() < 400
      );
    });

    logStep('cover', 'confirm crop and wait for autosave');
    await Promise.all([
      saveResponsePromise,
      page.getByRole('button', { name: 'Usar' }).click(),
    ]);

    const saveResponse = await saveResponsePromise;
    const savePayload = await saveResponse.json();
    const coverUrl = savePayload?.data?.cover_url?.toString() || '';
    logStep('cover', `autosave returned ${coverUrl}`);
    expect(coverUrl, 'Cover save must return a canonical cover URL.').toBeTruthy();

    const coverResponse = await api.get(coverUrl, { failOnStatusCode: false });
    expect(coverResponse.status(), 'Persisted cover URL must be readable.').toBeLessThan(400);

    const verificationBundle = await createAuthenticatedTenantAdminPage(
      browser,
      session,
    );
    verificationContext = verificationBundle.context;
    const verificationPage = verificationBundle.page;
    const verificationCollectors = installFailureCollectors(verificationPage);
    const coverStatuses = [];

    verificationPage.on('response', (response) => {
      if (response.url() === coverUrl) {
        coverStatuses.push(response.status());
      }
    });

    logStep('cover', 'reload edit route to validate rendered persisted cover');
    const verificationResponse = await verificationPage.goto(editUrl, {
      waitUntil: 'domcontentloaded',
    });
    expect(
      verificationResponse,
      'Verification edit response should be available.',
    ).not.toBeNull();
    expect(verificationResponse.status()).toBeLessThan(400);
    await assertAppBooted(verificationPage);
    await enableAccessibilityIfNeeded(verificationPage);

    await expect
      .poll(() => coverStatuses.some((status) => status === 200), {
        timeout: appBootTimeoutMs,
        message: 'Expected the persisted cover image request to succeed after reload.',
      })
      .toBeTruthy();
    logStep('cover', 'persisted cover returned 200 after reload');

    await assertNoBrowserFailures(collectors);
    await assertNoBrowserFailures(verificationCollectors);
  } finally {
    if (session?.token) {
      await deleteAccountProfile(api, baseUrl, session.token, profileId);
    }
    if (verificationContext) {
      await verificationContext.close();
    }
    if (browserContext) {
      await browserContext.close();
    }
    await api.dispose();
  }
});

test('@mutation tenant-admin account-profile avatar upload persists and renders after reload', async ({
  browser,
}) => {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  let browserContext;
  let verificationContext;
  let profileId = null;
  let session = null;

  try {
    session = await loginTenantAdmin(api, baseUrl);
    const created = await createImageTestProfile(api, baseUrl, session.token, {
      requireAvatar: true,
    });
    profileId = created.profileId;

    expect(created.accountSlug, 'Created onboarding must return an account slug.').toBeTruthy();
    expect(profileId, 'Created onboarding must return an account profile id.').toBeTruthy();

    const editUrl = buildApiUrl(
      baseUrl,
      `/admin/accounts/${created.accountSlug}/profiles/${profileId}/edit`,
    );
    const primaryPageBundle = await createAuthenticatedTenantAdminPage(
      browser,
      session,
    );
    browserContext = primaryPageBundle.context;
    const page = primaryPageBundle.page;
    const collectors = installFailureCollectors(page);

    logStep('avatar', `open edit route ${editUrl}`);
    const initialResponse = await page.goto(editUrl, {
      waitUntil: 'domcontentloaded',
    });
    expect(initialResponse, 'Edit screen response should be available.').not.toBeNull();
    expect(initialResponse.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);

    await expect(page.getByRole('button', { name: 'Adicionar avatar' })).toBeVisible({
      timeout: appBootTimeoutMs,
    });

    await attachImageFromDevice(page, {
      flow: 'avatar',
      buttonName: 'Adicionar avatar',
      cropTitle: 'Recortar avatar',
    });

    const saveResponsePromise = page.waitForResponse((response) => {
      const method = response.request().method().toUpperCase();
      return (
        (method === 'PATCH' || method === 'POST') &&
        response.url().includes(`/admin/api/v1/account_profiles/${profileId}`) &&
        response.status() < 400
      );
    });

    logStep('avatar', 'confirm crop and wait for autosave');
    await Promise.all([
      saveResponsePromise,
      page.getByRole('button', { name: 'Usar' }).click(),
    ]);

    const saveResponse = await saveResponsePromise;
    const savePayload = await saveResponse.json();
    const avatarUrl = savePayload?.data?.avatar_url?.toString() || '';
    logStep('avatar', `autosave returned ${avatarUrl}`);
    expect(avatarUrl, 'Avatar save must return a canonical avatar URL.').toBeTruthy();

    const avatarResponse = await api.get(avatarUrl, { failOnStatusCode: false });
    expect(avatarResponse.status(), 'Persisted avatar URL must be readable.').toBeLessThan(400);

    const verificationBundle = await createAuthenticatedTenantAdminPage(
      browser,
      session,
    );
    verificationContext = verificationBundle.context;
    const verificationPage = verificationBundle.page;
    const verificationCollectors = installFailureCollectors(verificationPage);
    const avatarStatuses = [];

    verificationPage.on('response', (response) => {
      if (urlsMatchIgnoringQuery(response.url(), avatarUrl)) {
        avatarStatuses.push(response.status());
      }
    });

    logStep('avatar', 'reload edit route to validate rendered persisted avatar');
    const verificationResponse = await verificationPage.goto(editUrl, {
      waitUntil: 'domcontentloaded',
    });
    expect(
      verificationResponse,
      'Verification edit response should be available.',
    ).not.toBeNull();
    expect(verificationResponse.status()).toBeLessThan(400);
    await assertAppBooted(verificationPage);
    await enableAccessibilityIfNeeded(verificationPage);

    await expect
      .poll(() => avatarStatuses.some((status) => status === 200), {
        timeout: appBootTimeoutMs,
        message: 'Expected the persisted avatar image request to succeed after reload.',
      })
      .toBeTruthy();
    logStep('avatar', 'persisted avatar returned 200 after reload');

    await assertNoBrowserFailures(collectors);
    await assertNoBrowserFailures(verificationCollectors);
  } finally {
    if (session?.token) {
      await deleteAccountProfile(api, baseUrl, session.token, profileId);
    }
    if (verificationContext) {
      await verificationContext.close();
    }
    if (browserContext) {
      await browserContext.close();
    }
    await api.dispose();
  }
});

test('@mutation tenant-admin event type create flow works through the real browser', async ({
  browser,
}) => {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  let browserContext;
  let createdEventTypeId = null;
  let session = null;

  try {
    session = await loginTenantAdmin(api, baseUrl);
    const primaryPageBundle = await createAuthenticatedTenantAdminPage(
      browser,
      session,
    );
    browserContext = primaryPageBundle.context;
    const page = primaryPageBundle.page;
    const collectors = installFailureCollectors(page);
    const uniqueSlug = `playwright-type-${Date.now()}`;
    const uniqueName = `Playwright ${uniqueSlug}`;

    logStep('event-type', 'open event types list');
    const response = await page.goto(
      buildApiUrl(baseUrl, '/admin/events/types'),
      {
        waitUntil: 'domcontentloaded',
      },
    );
    expect(response, 'Event types route response should be available.').not.toBeNull();
    expect(response.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);

    await expect(page.getByText('Tipos de evento')).toBeVisible({
      timeout: appBootTimeoutMs,
    });

    logStep('event-type', 'open create form');
    await page.getByRole('button', { name: 'Criar tipo' }).first().click();
    await expect(page.getByText('Criar tipo de evento')).toBeVisible({
      timeout: appBootTimeoutMs,
    });

    logStep('event-type', `fill form ${uniqueSlug}`);
    await page.getByLabel('Nome').fill(uniqueName);
    await page.getByLabel('Slug').fill(uniqueSlug);

    const createResponsePromise = page.waitForResponse((candidate) => {
      return (
        candidate.request().method() === 'POST' &&
        candidate.url().includes('/admin/api/v1/event_types')
      );
    });

    logStep('event-type', 'submit create');
    await Promise.all([
      createResponsePromise,
      page.getByRole('button', { name: 'Criar tipo' }).last().click(),
    ]);

    const createResponse = await createResponsePromise;
    expect(
      createResponse.status(),
      'Event type create request must succeed.',
    ).toBe(201);
    const createPayload = await createResponse.json();
    createdEventTypeId = createPayload?.data?.id?.toString() || null;
    logStep('event-type', `created ${createdEventTypeId}`);

    expect(createdEventTypeId, 'Event type create must return an id.').toBeTruthy();

    const verificationResponse = await api.get(
      buildApiUrl(baseUrl, '/admin/api/v1/event_types'),
      {
        headers: authHeaders(session.token),
      },
    );
    expect(
      verificationResponse.status(),
      'Created event type must be queryable after browser submit.',
    ).toBe(200);
    const verificationPayload = await verificationResponse.json();
    const createdRows = Array.isArray(verificationPayload?.data)
        ? verificationPayload.data
        : [];
    expect(
      createdRows.some((row) => row?.id?.toString() === createdEventTypeId),
      'Created event type id must be present in the tenant-admin registry.',
    ).toBeTruthy();

    await assertNoBrowserFailures(collectors);
  } finally {
    if (createdEventTypeId && session?.token) {
      await deleteEventType(api, baseUrl, session.token, createdEventTypeId);
    }
    if (browserContext) {
      await browserContext.close();
    }
    await api.dispose();
  }
});

test('@mutation tenant-admin event type type asset upload persists and renders after edit reopen', async ({
  browser,
}) => {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  let browserContext;
  let verificationContext;
  let createdEventTypeId = null;
  let session = null;

  try {
    session = await loginTenantAdmin(api, baseUrl);
    const uniqueSlug = `playwright-type-asset-${Date.now()}`;
    const uniqueName = `Playwright ${uniqueSlug}`;
    const seededPayload = await createEventTypeWithTypeAsset(
      api,
      baseUrl,
      session.token,
      {
        name: uniqueName,
        slug: uniqueSlug,
      },
    );
    createdEventTypeId = seededPayload?.data?.id?.toString() || null;
    expect(createdEventTypeId, 'Seeded event type must return an id.').toBeTruthy();

    const verificationResponse = await api.get(
      buildApiUrl(baseUrl, '/admin/api/v1/event_types'),
      {
        headers: authHeaders(session.token),
      },
    );
    expect(
      verificationResponse.status(),
      'Seeded event type must be queryable after API creation.',
    ).toBe(200);
    const verificationPayload = await verificationResponse.json();
    const createdRows = Array.isArray(verificationPayload?.data)
      ? verificationPayload.data
      : [];
    const createdRow = createdRows.find(
      (row) => row?.id?.toString() === createdEventTypeId,
    );
    expect(
      createdRow,
      'Seeded event type must be present in the tenant-admin registry.',
    ).toBeTruthy();
    const typeAssetUrl = createdRow?.visual?.image_url?.toString() || '';
    expect(
      typeAssetUrl,
      'Seeded event type must expose the canonical type asset URL.',
    ).toBeTruthy();

    const typeAssetResponse = await api.get(typeAssetUrl, {
      failOnStatusCode: false,
    });
    expect(
      typeAssetResponse.status(),
      'Persisted type asset URL must be readable.',
    ).toBeLessThan(400);

    const primaryPageBundle = await createAuthenticatedTenantAdminPage(
      browser,
      session,
    );
    browserContext = primaryPageBundle.context;
    const page = primaryPageBundle.page;
    const collectors = installFailureCollectors(page);
    const typeAssetStatuses = [];

    page.on('response', (candidate) => {
      if (urlsMatchIgnoringQuery(candidate.url(), typeAssetUrl)) {
        typeAssetStatuses.push(candidate.status());
      }
    });

    logStep('event-type-asset', 'open event types list');
    const response = await page.goto(
      buildApiUrl(baseUrl, '/admin/events/types'),
      {
        waitUntil: 'domcontentloaded',
      },
    );
    expect(response, 'Event types route response should be available.').not.toBeNull();
    expect(response.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);

    await expect(page.getByText('Tipos de evento')).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    logStep('event-type-asset', 'open seeded row from list');
    await page
      .getByRole('button', {
        name: new RegExp(uniqueName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      })
      .first()
      .click();
    await expect(page.getByText('Editar tipo de evento')).toBeVisible({
      timeout: appBootTimeoutMs,
    });

    await expect
      .poll(() => typeAssetStatuses.some((status) => status === 200), {
        timeout: appBootTimeoutMs,
        message:
          'Expected the persisted event-type type asset image request to succeed after reopening edit.',
      })
      .toBeTruthy();
    logStep('event-type-asset', 'persisted type asset returned 200 after edit reopen');

    await assertNoBrowserFailures(collectors);
  } finally {
    if (createdEventTypeId && session?.token) {
      await deleteEventType(api, baseUrl, session.token, createdEventTypeId);
    }
    if (browserContext) {
      await browserContext.close().catch(() => {});
    }
    await api.dispose();
  }
});

test('@mutation tenant-admin branding public default image and favicon persist after save and reload', async ({
  browser,
}) => {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  let browserContext;
  let verificationContext;
  let session = null;

  try {
    session = await loginTenantAdmin(api, baseUrl);
    const primaryPageBundle = await createAuthenticatedTenantAdminPage(
      browser,
      session,
    );
    browserContext = primaryPageBundle.context;
    const page = primaryPageBundle.page;
    const collectors = installFailureCollectors(page);
    const visualIdentityUrl = buildApiUrl(baseUrl, '/admin/settings/visual-identity');

    logStep('branding', `open visual identity route ${visualIdentityUrl}`);
    const response = await page.goto(visualIdentityUrl, {
      waitUntil: 'domcontentloaded',
    });
    expect(response, 'Visual identity route response should be available.').not.toBeNull();
    expect(response.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);

    await attachImageFromDevice(page, {
      flow: 'branding',
      buttonName: 'Selecionar imagem de compartilhamento',
      cropTitle: 'Recortar imagem de compartilhamento',
    });

    logStep('branding', 'confirm public default image crop');
    await page.getByRole('button', { name: 'Usar' }).click();
    logStep('branding', 'scroll to favicon field');
    await page.mouse.wheel(0, 1600);
    await page.waitForTimeout(400);

    await attachImageFromDevice(page, {
      flow: 'branding',
      buttonName: /favicon/i,
      cropTitle: null,
      fixturePath: fixtureFaviconPath,
    });

    const saveResponsePromise = page.waitForResponse((candidate) => {
      return (
        candidate.request().method() === 'POST' &&
        candidate.url().includes('/admin/api/v1/branding/update') &&
        candidate.status() < 400
      );
    });

    logStep('branding', 'save branding payload');
    await Promise.all([
      saveResponsePromise,
      page.getByRole('button', { name: 'Salvar Branding' }).first().click(),
    ]);

    const saveResponse = await saveResponsePromise;
    expect(saveResponse.status(), 'Branding save request must succeed.').toBeLessThan(400);

    const environment = await fetchPublicEnvironment(api, baseUrl);
    const publicWebDefaultImageRaw =
      environment?.public_web_metadata?.default_image?.toString() || '';
    expect(
      publicWebDefaultImageRaw,
      'Saved branding must publish a default public image in the environment payload.',
    ).toBeTruthy();
    const publicWebDefaultImageUrl = resolveAbsoluteUrl(
      baseUrl,
      publicWebDefaultImageRaw,
    );
    const faviconUrl = buildApiUrl(baseUrl, '/favicon.ico');

    const publicWebDefaultImageResponse = await api.get(publicWebDefaultImageUrl, {
      failOnStatusCode: false,
    });
    expect(
      publicWebDefaultImageResponse.status(),
      'Published default public image must be readable.',
    ).toBeLessThan(400);

    const faviconResponse = await api.get(faviconUrl, {
      failOnStatusCode: false,
    });
    expect(faviconResponse.status(), 'Published favicon route must be readable.').toBeLessThan(400);

    const verificationBundle = await createAuthenticatedTenantAdminPage(
      browser,
      session,
    );
    verificationContext = verificationBundle.context;
    const verificationPage = verificationBundle.page;
    const verificationCollectors = installFailureCollectors(verificationPage);
    const defaultImageStatuses = [];
    const faviconStatuses = [];

    verificationPage.on('response', (candidate) => {
      if (urlsMatchIgnoringQuery(candidate.url(), publicWebDefaultImageUrl)) {
        defaultImageStatuses.push(candidate.status());
      }
      if (urlsMatchIgnoringQuery(candidate.url(), faviconUrl)) {
        faviconStatuses.push(candidate.status());
      }
    });

    logStep('branding', 'reload visual identity route to validate rendered persisted assets');
    const verificationResponse = await verificationPage.goto(visualIdentityUrl, {
      waitUntil: 'domcontentloaded',
    });
    expect(
      verificationResponse,
      'Visual identity verification response should be available.',
    ).not.toBeNull();
    expect(verificationResponse.status()).toBeLessThan(400);
    await assertAppBooted(verificationPage);
    await enableAccessibilityIfNeeded(verificationPage);

    await expect
      .poll(() => defaultImageStatuses.some((status) => status === 200), {
        timeout: appBootTimeoutMs,
        message:
          'Expected the persisted public default image request to succeed after reload.',
      })
      .toBeTruthy();
    await expect
      .poll(() => faviconStatuses.some((status) => status === 200), {
        timeout: appBootTimeoutMs,
        message: 'Expected the persisted favicon request to succeed after reload.',
      })
      .toBeTruthy();
    logStep('branding', 'persisted default image and favicon returned 200 after reload');

    await assertNoBrowserFailures(collectors);
    await assertNoBrowserFailures(verificationCollectors);
  } finally {
    if (verificationContext) {
      await verificationContext.close().catch(() => {});
    }
    if (browserContext) {
      await browserContext.close().catch(() => {});
    }
    await api.dispose();
  }
});
