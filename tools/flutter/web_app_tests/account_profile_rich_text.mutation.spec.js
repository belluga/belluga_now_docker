const crypto = require('crypto');
const { test, expect, request } = require('@playwright/test');
const {
  loginTenantAdmin: loginTenantAdminWithRequiredCredentials,
} = require('./support/tenant_admin_auth');
const {
  cleanupOnboardedAccount,
} = require('./support/account_onboarding_cleanup');
const {
  installFailureCollectors,
  summarizeCriticalBrowserFailures,
} = require('./support/browser_failure_collectors');

const tenantUrl = process.env.NAV_TENANT_URL;
const appBootTimeoutMs = 90000;

test.describe.configure({ timeout: 300000 });

function requireTenantUrl() {
  expect(
    tenantUrl,
    'Missing NAV_TENANT_URL. Account Profile rich-text mutation suite requires a live tenant URL.',
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
    .update(`account-profile-rich-text:${baseUrl}`)
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

function isRetriableCleanupNetworkError(error) {
  const message = error?.message || '';
  return [
    'ECONNRESET',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'socket hang up',
  ].some((fragment) => message.includes(fragment));
}

async function waitMs(delayMs) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
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
    deviceName: 'playwright-account-profile-rich-text',
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

async function resolveRichTextProfileType(api, baseUrl, token) {
  const type = `playwright-rich-${Date.now()}`;
  const createResponse = await api.post(
    buildUrl(baseUrl, '/admin/api/v1/account_profile_types'),
    {
      data: {
        type,
        label: 'Playwright Rich Text',
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
          is_publicly_discoverable: true,
          is_poi_enabled: false,
          is_reference_location_enabled: false,
          has_bio: true,
          has_content: true,
          has_taxonomies: false,
          has_avatar: false,
          has_cover: false,
          has_events: false,
        },
      },
      headers: authHeaders(token),
    },
  );
  expect(
    createResponse.status(),
    'Fallback rich-text profile type must be created when none exists.',
  ).toBe(201);
  return { profileType: type, createdType: type, isPoiEnabled: false };
}

async function createRichTextAccountProfile(
  api,
  baseUrl,
  token,
  { profileType, isPoiEnabled = false },
) {
  const suffix = Date.now();
  const requestPayload = {
    name: `Playwright Rich ${suffix}`,
    ownership_state: 'unmanaged',
    profile_type: profileType,
    bio: '<p>Initial bio</p>',
    content: '<p>Initial content</p>',
  };

  if (isPoiEnabled) {
    requestPayload.location = {
      lat: -20.671339,
      lng: -40.495395,
    };
  }

  const response = await api.post(
    buildUrl(baseUrl, '/admin/api/v1/account_onboardings'),
    {
      data: requestPayload,
      headers: authHeaders(token),
    },
  );
  expect(response.status(), 'Account onboarding must succeed.').toBe(201);

  const payload = await response.json();
  const data = normalizePayload(payload);
  const profile = data?.account_profile || {};
  const account = data?.account || {};
  const accountSlug = account?.slug?.toString() || '';
  expect(accountSlug, 'Created rich-text account must expose an account slug.').toBeTruthy();
  const publishResponse = await api.patch(
    buildUrl(baseUrl, `/admin/api/v1/accounts/${accountSlug}`),
    {
      data: {
        publication: {
          status: 'published',
        },
      },
      headers: authHeaders(token),
    },
  );
  expect(
    publishResponse.status(),
    'Created rich-text account must publish successfully before public readback.',
  ).toBe(200);
  return {
    accountSlug,
    profileId: profile?.id?.toString() || '',
    profileSlug: profile?.slug?.toString() || account?.slug?.toString() || '',
    displayName: profile?.display_name?.toString() || account?.name?.toString(),
  };
}

async function updateAccountProfileRichText(
  api,
  baseUrl,
  token,
  { profileId, profileType, displayName, bio, content },
) {
  const response = await api.patch(
    buildUrl(baseUrl, `/admin/api/v1/account_profiles/${profileId}`),
    {
      data: {
        profile_type: profileType,
        display_name: displayName,
        bio,
        content,
      },
      headers: authHeaders(token),
    },
  );
  expect(response.status(), 'Account Profile rich-text update must succeed.')
    .toBeLessThan(400);
  const payload = await response.json();
  return normalizePayload(payload);
}

async function fetchAdminProfile(api, baseUrl, token, profileId) {
  const response = await api.get(
    buildUrl(baseUrl, `/admin/api/v1/account_profiles/${profileId}`),
    {
      headers: authHeaders(token),
    },
  );
  expect(response.status(), 'Admin Account Profile readback must succeed.')
    .toBe(200);
  return normalizePayload(await response.json());
}

async function fetchPublicProfile(api, baseUrl, profileSlug) {
  const anonymousToken = await resolveAnonymousIdentityToken(api, baseUrl);
  await expect
    .poll(
      async () => {
        const response = await api.get(
          buildUrl(baseUrl, `/api/v1/account_profiles/${profileSlug}`),
          {
            headers: authHeaders(anonymousToken),
            failOnStatusCode: false,
          },
        );
        return response.status();
      },
      {
        timeout: appBootTimeoutMs,
        message: `Public account profile ${profileSlug} must hydrate before rich-text readback.`,
      },
    )
    .toBe(200);

  const response = await api.get(
    buildUrl(baseUrl, `/api/v1/account_profiles/${profileSlug}`),
    {
      headers: authHeaders(anonymousToken),
    },
  );
  expect(response.status(), 'Public Account Profile readback must succeed.')
    .toBe(200);
  return normalizePayload(await response.json());
}

async function resolveAnonymousIdentityToken(api, baseUrl) {
  const response = await api.post(
    buildUrl(baseUrl, '/api/v1/anonymous/identities'),
    {
      data: {
        device_name: 'playwright-account-profile-rich-text-public',
        fingerprint: {
          hash: anonymousFingerprintHash(baseUrl),
          user_agent: 'playwright-account-profile-rich-text-public',
          locale: 'pt-BR',
        },
        metadata: {
          source: 'web_navigation_account_profile_rich_text',
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

async function deleteAccountProfileType(api, baseUrl, token, profileType) {
  if (!profileType) {
    return;
  }

  const targetUrl = buildUrl(
    baseUrl,
    `/admin/api/v1/account_profile_types/${encodeURIComponent(profileType)}`,
  );

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await api.delete(targetUrl, {
        headers: authHeaders(token),
        failOnStatusCode: false,
      });
      return;
    } catch (error) {
      if (!isRetriableCleanupNetworkError(error) || attempt === 3) {
        throw error;
      }
      await waitMs(400 * attempt);
    }
  }
}

async function assertVisibleRichText(page, expectedTexts) {
  for (const text of expectedTexts) {
    await expect(page.getByText(textPattern(text)).first()).toBeVisible({
      timeout: appBootTimeoutMs,
    });
  }
  await expect(page.getByText(/<h[1-6]|<strong>|<em>|<s>|<ul>|<ol>|<blockquote>/i))
    .toHaveCount(0);
}

async function isVisible(locator) {
  try {
    return await locator.isVisible();
  } catch (_) {
    return false;
  }
}

async function waitForAdminRichTextSurfaceState(page, expectedTexts) {
  const firstExpectedText = expectedTexts[0] ?? '';
  const deadline = Date.now() + 30000;

  while (Date.now() < deadline) {
    if (
      firstExpectedText &&
      await isVisible(page.getByText(textPattern(firstExpectedText)).first())
    ) {
      return 'ready';
    }

    if (
      await isVisible(
        page.getByText(/Não foi possível carregar os dados da conta\./i).first(),
      ) ||
      await isVisible(
        page.getByRole('button', { name: /Tentar novamente/i }).first(),
      )
    ) {
      return 'recoverable-error';
    }

    await page.waitForTimeout(500);
  }

  const hasLoadedAccountAnchors =
    await isVisible(page.getByText('Detalhes da conta').first()) &&
    await isVisible(page.getByText('Perfil da conta').first());

  return hasLoadedAccountAnchors ? 'loaded-without-rich-text' : 'recoverable-error';
}

async function openAdminAccountDetailWithRichTextRetry({
  browser,
  session,
  baseUrl,
  accountSlug,
  expectedTexts,
}) {
  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const adminBundle = await createAuthenticatedTenantAdminPage(
      browser,
      session,
    );
    const adminCollectors = installFailureCollectors(adminBundle.page);

    try {
      await openAppPath(
        adminBundle.page,
        baseUrl,
        `/admin/accounts/${accountSlug}`,
      );

      const surfaceState = await waitForAdminRichTextSurfaceState(
        adminBundle.page,
        expectedTexts,
      );

      if (surfaceState === 'recoverable-error') {
        throw new Error(
          `Admin account detail load stayed in a transient error state on attempt ${attempt}.`,
        );
      }

      await assertVisibleRichText(adminBundle.page, expectedTexts);

      return {
        context: adminBundle.context,
        page: adminBundle.page,
        collectors: adminCollectors,
      };
    } catch (error) {
      lastError = error;
      await adminBundle.context.close().catch(() => {});

      if (attempt === 3) {
        throw error;
      }

      await waitMs(750 * attempt);
    }
  }

  throw lastError ?? new Error('Admin account detail rich-text retry exhausted.');
}

test('@mutation tenant-admin account-profile rich text persists and renders on admin and public surfaces', async ({
  browser,
}) => {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  let adminContext;
  let publicContext;
  let profileId = null;
  let accountSlug = null;
  let createdType = null;
  let session = null;

  const bio = '<h2>Bio Heading 🎉</h2>'
    + '<p><strong>Bold bio</strong><br />Second bio line</p>'
    + '<blockquote>Bio quote</blockquote>'
    + '<ul><li>Bio bullet</li></ul>';
  const content = '<h3>Content Heading</h3>'
    + '<p><em>Italic content</em> and <s>strike content</s> 😄</p>'
    + '<ol><li>Content ordered</li></ol>';
  const expectedTexts = [
    'Bio Heading 🎉',
    'Bold bio',
    'Second bio line',
    'Bio quote',
    'Bio bullet',
    'Content Heading',
    'Italic content',
    'strike content',
    '😄',
    'Content ordered',
  ];

  try {
    session = await loginTenantAdmin(api, baseUrl);
    const resolvedType = await resolveRichTextProfileType(
      api,
      baseUrl,
      session.token,
    );
    createdType = resolvedType.createdType;
    const created = await createRichTextAccountProfile(
      api,
      baseUrl,
      session.token,
      resolvedType,
    );
    profileId = created.profileId;
    accountSlug = created.accountSlug;
    expect(created.accountSlug, 'Created account slug must be present.')
      .toBeTruthy();
    expect(profileId, 'Created Account Profile id must be present.').toBeTruthy();
    expect(created.profileSlug, 'Created public Account Profile slug must be present.')
      .toBeTruthy();

    const updated = await updateAccountProfileRichText(api, baseUrl, session.token, {
      profileId,
      profileType: resolvedType.profileType,
      displayName: created.displayName,
      bio,
      content,
    });
    expect(updated?.bio, 'Admin update response must include rich bio.')
      .toContain('Bio Heading 🎉');
    expect(updated?.content, 'Admin update response must include rich content.')
      .toContain('Content Heading');

    const adminReadback = await fetchAdminProfile(
      api,
      baseUrl,
      session.token,
      profileId,
    );
    expect(adminReadback?.bio).toContain('<h2>Bio Heading 🎉</h2>');
    expect(adminReadback?.bio).toContain('<strong>Bold bio</strong>');
    expect(adminReadback?.bio).toContain('<blockquote>Bio quote</blockquote>');
    expect(adminReadback?.bio).toContain('<ul><li>Bio bullet</li></ul>');
    expect(adminReadback?.content).toContain('<h3>Content Heading</h3>');
    expect(adminReadback?.content).toContain('<em>Italic content</em>');
    expect(adminReadback?.content).toContain('<s>strike content</s>');
    expect(adminReadback?.content).toContain('<ol><li>Content ordered</li></ol>');

    const publicReadback = await fetchPublicProfile(
      api,
      baseUrl,
      created.profileSlug,
    );
    expect(publicReadback?.bio).toContain('Bio Heading 🎉');
    expect(publicReadback?.content).toContain('Content Heading');

    adminContext = null;
    const adminBundle = await openAdminAccountDetailWithRichTextRetry({
      browser,
      session,
      baseUrl,
      accountSlug: created.accountSlug,
      expectedTexts,
    });
    adminContext = adminBundle.context;
    const adminPage = adminBundle.page;
    const adminCollectors = adminBundle.collectors;

    await assertNoCriticalBrowserFailures(adminCollectors);

    publicContext = await browser.newContext({
      ignoreHTTPSErrors: true,
    });
    const publicPage = await publicContext.newPage();
    const publicCollectors = installFailureCollectors(publicPage);

    await openAppPath(publicPage, baseUrl, `/parceiro/${created.profileSlug}`);
    await assertVisibleRichText(publicPage, expectedTexts);
    await expect(publicPage.getByText('Sobre').first()).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    await expect(publicPage.getByText('Conteúdo').first()).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    await assertNoCriticalBrowserFailures(publicCollectors);
  } finally {
    if (session?.token) {
      await cleanupOnboardedAccount(api, baseUrl, session.token, accountSlug);
      await deleteAccountProfileType(api, baseUrl, session.token, createdType);
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
