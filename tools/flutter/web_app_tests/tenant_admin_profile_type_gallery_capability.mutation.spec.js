const { test, expect, request } = require('@playwright/test');
const { loginTenantAdmin } = require('./support/tenant_admin_auth');
const {
  createAuthenticatedTenantAdminPage,
} = require('./support/tenant_admin_seeded_session');
const {
  cleanupOnboardedAccount,
} = require('./support/account_onboarding_cleanup');
const {
  installFailureCollectors,
  summarizeCriticalBrowserFailures,
} = require('./support/browser_failure_collectors');

const tenantUrl = process.env.NAV_TENANT_URL;
const appBootTimeoutMs = 90000;

test.describe.configure({ timeout: 420000 });

function requireTenantUrl() {
  expect(
    tenantUrl,
    'Missing NAV_TENANT_URL. Gallery capability profile type mutation suite requires a live tenant URL.',
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

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pageWait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertNoCriticalBrowserFailures(browserFailures, context) {
  const summary = summarizeCriticalBrowserFailures(browserFailures);
  expect(summary.runtimeErrors, `${context} must not produce page runtime errors.`)
    .toEqual([]);
  expect(summary.failedRequests, `${context} must not produce failed requests.`)
    .toEqual([]);
  expect(
    summary.criticalHttpResponses,
    `${context} must not produce critical HTTP responses.`,
  ).toEqual([]);
  expect(
    summary.disallowedRateLimitedResponses,
    `${context} must not produce disallowed rate-limited responses.`,
  ).toEqual([]);
  expect(
    summary.criticalConsoleErrors,
    `${context} must not produce critical console errors.`,
  ).toEqual([]);
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

async function resolveVisibleFlutterTextField(page, label) {
  const fields = page.getByLabel(label);
  const deadline = Date.now() + appBootTimeoutMs;

  while (Date.now() < deadline) {
    const count = await fields.count();
    for (let index = 0; index < count; index += 1) {
      const field = fields.nth(index);
      if (await field.isVisible().catch(() => false)) {
        return field;
      }
    }

    await page.waitForTimeout(250);
  }

  throw new Error(`No visible Flutter text field found for label "${label}".`);
}

async function fillFlutterTextField(page, label, value) {
  const field = await resolveVisibleFlutterTextField(page, label);
  await field.scrollIntoViewIfNeeded();
  await expect(field).toBeVisible({ timeout: appBootTimeoutMs });

  await field.click();
  const selectAll = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
  await page.keyboard.press(selectAll);
  await page.keyboard.press('Backspace');
  await page.keyboard.type(value, { delay: 5 });
  return field;
}

async function clickSaveChanges(page) {
  await page
    .getByRole('button', { name: /Salvar altera/i })
    .first()
    .click();
}

async function createAccountProfileType(
  api,
  baseUrl,
  token,
  type,
  label,
  plural,
) {
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
          is_favoritable: true,
          has_avatar: true,
          has_cover: false,
          has_bio: false,
          has_content: false,
          has_taxonomies: false,
          has_events: false,
          is_poi_enabled: false,
          is_reference_location_enabled: false,
          has_gallery: true,
        },
        visual: {
          mode: 'icon',
          icon: 'place',
          color: '#0F766E',
          icon_color: '#FFFFFF',
        },
      },
    },
  );
  expect(response.status(), `Account profile type ${type} must be created.`).toBe(
    201,
  );
}

async function deleteAccountProfileType(api, baseUrl, token, type) {
  await api.delete(
    buildUrl(
      baseUrl,
      `/admin/api/v1/account_profile_types/${encodeURIComponent(type)}`,
    ),
    {
      headers: authHeaders(token),
      failOnStatusCode: false,
    },
  );
}

async function fetchAccountProfileType(api, baseUrl, token, type) {
  const response = await api.get(
    buildUrl(
      baseUrl,
      `/admin/api/v1/account_profile_types/${encodeURIComponent(type)}`,
    ),
    {
      headers: authHeaders(token),
      failOnStatusCode: false,
    },
  );
  return response;
}

async function waitForPersistedAccountProfileType(
  api,
  baseUrl,
  token,
  type,
  predicate,
  description,
) {
  for (let attempt = 1; attempt <= 24; attempt += 1) {
    const response = await fetchAccountProfileType(api, baseUrl, token, type);
    if (response.status() < 400) {
      const payload = await response.json();
      const data = payload?.data || {};
      if (predicate(data)) {
        return data;
      }
    }
    await pageWait(500);
  }

  throw new Error(description);
}

async function resolveToggle(page, label) {
  const pattern = new RegExp(escapeRegex(label), 'i');
  const candidates = [
    page.getByRole('switch', { name: pattern }),
    page.getByRole('checkbox', { name: pattern }),
  ];
  const deadline = Date.now() + appBootTimeoutMs;

  while (Date.now() < deadline) {
    for (const candidate of candidates) {
      const count = await candidate.count().catch(() => 0);
      for (let index = 0; index < count; index += 1) {
        const locator = candidate.nth(index);
        if (await locator.isVisible().catch(() => false)) {
          return locator;
        }
      }
    }

    await page.waitForTimeout(250);
  }

  throw new Error(`No visible toggle found for label "${label}".`);
}

async function expectToggleChecked(toggle, message) {
  await expect
    .poll(
      async () => {
        const ariaChecked = await toggle
          .getAttribute('aria-checked')
          .catch(() => null);
        if (ariaChecked != null) {
          return ariaChecked;
        }

        const nativeChecked = await toggle.isChecked().catch(() => null);
        if (nativeChecked != null) {
          return nativeChecked ? 'true' : 'false';
        }

        return 'unknown';
      },
      {
        timeout: appBootTimeoutMs,
        message,
      },
    )
    .toBe('true');
}

async function toggleCheckedValue(toggle) {
  const ariaChecked = await toggle.getAttribute('aria-checked').catch(() => null);
  if (ariaChecked != null) {
    return ariaChecked === 'true';
  }

  return toggle.isChecked().catch(() => false);
}

async function setExternalLinksCapability({
  page,
  api,
  baseUrl,
  token,
  type,
  enabled,
}) {
  const editUrl = buildUrl(
    baseUrl,
    `/admin/profile-types/${encodeURIComponent(type)}/edit`,
  );
  const response = await page.goto(editUrl, { waitUntil: 'domcontentloaded' });
  expect(response, 'Profile type capability edit response should be available.')
    .not.toBeNull();
  expect(response.status()).toBeLessThan(400);
  await assertAppBooted(page);
  await enableAccessibilityIfNeeded(page);
  await expect(await resolveVisibleFlutterTextField(page, 'Tipo (slug)')).toBeVisible({
    timeout: appBootTimeoutMs,
  });

  const toggle = await resolveToggle(page, 'Links externos habilitados');
  await toggle.scrollIntoViewIfNeeded();
  if ((await toggleCheckedValue(toggle)) !== enabled) {
    await toggle.click();
  }

  const patchResponsePromise = page.waitForResponse((candidate) =>
    candidate.request().method() === 'PATCH' &&
    candidate.url().includes(
      `/admin/api/v1/account_profile_types/${encodeURIComponent(type)}`,
    ),
  );
  await clickSaveChanges(page);
  const patchResponse = await patchResponsePromise;
  expect(
    patchResponse.status(),
    `Profile type has_external_links=${enabled} mutation must succeed.`,
  ).toBeLessThan(400);

  return waitForPersistedAccountProfileType(
    api,
    baseUrl,
    token,
    type,
    (data) => data?.capabilities?.has_external_links === enabled,
    `Account profile type ${type} did not persist has_external_links=${enabled}.`,
  );
}

async function createPublishedAccountProfile(api, baseUrl, token, type, name) {
  const onboardingResponse = await api.post(
    buildUrl(baseUrl, '/admin/api/v1/account_onboardings'),
    {
      headers: authHeaders(token),
      data: {
        name,
        ownership_state: 'unmanaged',
        profile_type: type,
      },
    },
  );
  expect(onboardingResponse.status(), 'External-links account onboarding must succeed.')
    .toBe(201);
  const onboarding = await onboardingResponse.json();
  const account = onboarding?.data?.account || {};
  const profile = onboarding?.data?.account_profile || {};
  const accountSlug = account?.slug?.toString() || '';
  const profileId = profile?.id?.toString() || '';
  const profileSlug = profile?.slug?.toString() || accountSlug;
  expect(accountSlug, 'Onboarding response must expose an account slug.').toBeTruthy();
  expect(profileId, 'Onboarding response must expose a profile id.').toBeTruthy();

  const publishResponse = await api.patch(
    buildUrl(baseUrl, `/admin/api/v1/accounts/${encodeURIComponent(accountSlug)}`),
    {
      headers: authHeaders(token),
      data: { publication: { status: 'published' } },
    },
  );
  expect(publishResponse.status(), 'External-links fixture must publish.').toBe(200);
  return { accountSlug, profileId, profileSlug };
}

async function fetchAdminProfile(api, baseUrl, token, profileId) {
  const response = await api.get(
    buildUrl(
      baseUrl,
      `/admin/api/v1/account_profiles/${encodeURIComponent(profileId)}`,
    ),
    { headers: authHeaders(token), failOnStatusCode: false },
  );
  expect(response.status(), 'Admin profile readback must succeed.').toBe(200);
  const payload = await response.json();
  return payload?.data || {};
}

async function createExternalLink(api, baseUrl, token, profileId, data) {
  const response = await api.post(
    buildUrl(
      baseUrl,
      `/admin/api/v1/account_profiles/${encodeURIComponent(profileId)}/external_links`,
    ),
    {
      headers: { ...authHeaders(token), 'X-Request-ID': `pw-links-${Date.now()}-${data.type}` },
      data,
      failOnStatusCode: false,
    },
  );
  return response;
}

async function deleteExternalLink(api, baseUrl, token, profileId, linkId) {
  return api.delete(
    buildUrl(
      baseUrl,
      `/admin/api/v1/account_profiles/${encodeURIComponent(profileId)}` +
        `/external_links/${encodeURIComponent(linkId)}`,
    ),
    {
      headers: { ...authHeaders(token), 'X-Request-ID': `pw-links-delete-${linkId}` },
      failOnStatusCode: false,
    },
  );
}

async function gotoAdminProfileEdit(page, baseUrl, accountSlug, profileId) {
  const response = await page.goto(
    buildUrl(
      baseUrl,
      `/admin/accounts/${encodeURIComponent(accountSlug)}` +
        `/profiles/${encodeURIComponent(profileId)}/edit`,
    ),
    { waitUntil: 'domcontentloaded' },
  );
  expect(response, 'Admin account-profile edit response should be available.')
    .not.toBeNull();
  expect(response.status()).toBeLessThan(400);
  await assertAppBooted(page);
  await enableAccessibilityIfNeeded(page);
  await expect(page.getByText('Editar Perfil')).toBeVisible({
    timeout: appBootTimeoutMs,
  });
}

async function gotoPublicProfile(page, baseUrl, profileSlug) {
  const hydrationPromise = page.waitForResponse((candidate) => {
    const url = new URL(candidate.url());
    return candidate.request().method() === 'GET' &&
      url.pathname === `/api/v1/account_profiles/${profileSlug}`;
  });
  const response = await page.goto(
    buildUrl(baseUrl, `/parceiro/${encodeURIComponent(profileSlug)}`),
    { waitUntil: 'domcontentloaded' },
  );
  expect(response, 'Public profile response should be available.').not.toBeNull();
  expect(response.status()).toBeLessThan(400);
  await assertAppBooted(page);
  await enableAccessibilityIfNeeded(page);
  const hydrationResponse = await hydrationPromise;
  expect(hydrationResponse.status()).toBeLessThan(400);
  return (await hydrationResponse.json())?.data || {};
}

async function scrollUntilVisible(page, locator, description) {
  async function tryCurrentLocator() {
    const candidateCount = await locator.count().catch(() => 0);
    if (candidateCount <= 0) {
      return false;
    }
    const first = locator.first();
    await first.scrollIntoViewIfNeeded().catch(() => {});
    return first.isVisible().catch(() => false);
  }

  if (await tryCurrentLocator()) {
    return;
  }

  const viewport =
    page.viewportSize() ||
    (await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    })));
  await page.mouse.move(viewport.width * 0.62, viewport.height * 0.72);

  for (const delta of [900, -900]) {
    for (let attempt = 0; attempt < 36; attempt += 1) {
      if (await tryCurrentLocator()) {
        return;
      }
      await page.mouse.wheel(0, delta);
      await page.waitForTimeout(250);
    }
  }

  await expect(locator, description).toBeVisible({
    timeout: appBootTimeoutMs,
  });
}

async function expectListCardShowsGallery(page, label) {
  const escapedAttributeValue = label.replace(/["\\]/g, '\\$&');
  const listCard = page
    .locator(
      `flt-semantics[aria-label*="${escapedAttributeValue}"][aria-label*="Galeria"], [aria-label*="${escapedAttributeValue}"][aria-label*="Galeria"]`,
    )
    .first();

  await scrollUntilVisible(
    page,
    listCard,
    `Expected account profile type list card for "${label}" to become visible before asserting Galeria.`,
  );

  await expect
    .poll(
      async () =>
        page
          .locator(
            `flt-semantics[aria-label*="${escapedAttributeValue}"][aria-label*="Galeria"], [aria-label*="${escapedAttributeValue}"][aria-label*="Galeria"]`,
          )
          .count()
          .then((count) => count > 0)
          .catch(() => false),
      {
        timeout: appBootTimeoutMs,
        message: `Expected account profile type list card for "${label}" to expose the Galeria capability label.`,
      },
    )
    .toBe(true);

  return listCard;
}

test('@mutation T6-GALLERY-CAPABILITY tenant-admin account profile type gallery capability rehydrates and renders across edit list and detail', async ({
  browser,
}, testInfo) => {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  const session = await loginTenantAdmin({
    api,
    baseUrl,
    deviceName: 'playwright-profile-type-gallery-capability',
  });
  const unique = Date.now().toString();
  const type = `a0-gallery-capability-${unique}`;
  const initialLabel = `A0 Perfil Galeria ${unique}`;
  const updatedLabel = `A0 Perfil Galeria Atualizado ${unique}`;
  const plural = `A0 Perfis Galeria ${unique}`;
  let browserContext;

  try {
    await createAccountProfileType(
      api,
      baseUrl,
      session.token,
      type,
      initialLabel,
      plural,
    );

    let pageBundle = await createAuthenticatedTenantAdminPage(
      browser,
      session,
    );
    browserContext = pageBundle.context;
    let page = pageBundle.page;
    const editUrl = buildUrl(
      baseUrl,
      `/admin/profile-types/${encodeURIComponent(type)}/edit`,
    );

    let response = await page.goto(editUrl, {
      waitUntil: 'domcontentloaded',
    });
    expect(response, 'Account profile type edit response should be available.')
      .not.toBeNull();
    expect(response.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);
    await expect(
      await resolveVisibleFlutterTextField(page, 'Tipo (slug)'),
      'Edit screen must expose the profile type form before gallery-capability hydration is asserted.',
    ).toBeVisible({ timeout: appBootTimeoutMs });

    const galleryToggle = await resolveToggle(page, 'Galeria habilitada');
    await galleryToggle.scrollIntoViewIfNeeded();
    await expectToggleChecked(
      galleryToggle,
      'Persisted gallery-capable profile type must reopen with Galeria habilitada active.',
    );

    await fillFlutterTextField(page, 'Label', updatedLabel);

    const patchRequestPromise = page.waitForRequest((candidate) => {
      return (
        candidate.method() === 'PATCH' &&
        candidate.url().includes(
          `/admin/api/v1/account_profile_types/${encodeURIComponent(type)}`,
        )
      );
    });
    const patchResponsePromise = page.waitForResponse((candidate) => {
      return (
        candidate.request().method() === 'PATCH' &&
        candidate.url().includes(
          `/admin/api/v1/account_profile_types/${encodeURIComponent(type)}`,
        ) &&
        candidate.status() < 400
      );
    });

    await clickSaveChanges(page);

    const patchRequest = await patchRequestPromise;
    const patchPayload = patchRequest.postDataJSON();
    expect(patchPayload?.label).toBe(updatedLabel);
    expect(
      patchPayload?.capabilities?.has_gallery,
      'Saving an unrelated profile type change must preserve has_gallery=true in the submitted payload.',
    ).toBe(true);
    await patchResponsePromise;

    const savedType = await waitForPersistedAccountProfileType(
      api,
      baseUrl,
      session.token,
      type,
      (data) =>
        data?.label === updatedLabel &&
        data?.capabilities?.has_gallery === true,
      `Account profile type ${type} did not persist label="${updatedLabel}" and has_gallery=true within the expected polling window.`,
    );
    expect(savedType?.label).toBe(updatedLabel);
    expect(savedType?.capabilities?.has_gallery).toBe(true);

    await testInfo.attach('gallery-capability-after-save', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });

    await browserContext.close();
    pageBundle = await createAuthenticatedTenantAdminPage(browser, session);
    browserContext = pageBundle.context;
    page = pageBundle.page;

    response = await page.goto(editUrl, {
      waitUntil: 'domcontentloaded',
    });
    expect(response, 'Account profile type reopen response should be available.')
      .not.toBeNull();
    expect(response.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);
    await expect(
      await resolveVisibleFlutterTextField(page, 'Tipo (slug)'),
      'Reopened edit screen must expose the profile type form again before persisted gallery-capability readback is asserted.',
    ).toBeVisible({ timeout: appBootTimeoutMs });
    await expectToggleChecked(
      await resolveToggle(page, 'Galeria habilitada'),
      'Reopened edit screen must keep Galeria habilitada active for the persisted type.',
    );

    const listUrl = buildUrl(baseUrl, '/admin/profile-types');
    response = await page.goto(listUrl, {
      waitUntil: 'domcontentloaded',
    });
    expect(response, 'Account profile type list response should be available.')
      .not.toBeNull();
    expect(response.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);
    await expectListCardShowsGallery(page, updatedLabel);

    const detailUrl = buildUrl(
      baseUrl,
      `/admin/profile-types/${encodeURIComponent(type)}`,
    );
    response = await page.goto(detailUrl, {
      waitUntil: 'domcontentloaded',
    });
    expect(response, 'Account profile type detail response should be available.')
      .not.toBeNull();
    expect(response.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);
    await expect(
      page.getByRole('button', { name: 'Editar', exact: true }),
      'Profile type detail must expose the Editar action once the detail route opens.',
    ).toBeVisible({ timeout: appBootTimeoutMs });

    await testInfo.attach('gallery-capability-detail', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  } finally {
    if (browserContext) {
      await browserContext.close();
    }
    await deleteAccountProfileType(api, baseUrl, session.token, type);
    await api.dispose();
  }
});

test('@mutation T6-EXTERNAL-LINKS profile capability gates admin CRUD, dormant restoration, and capacity-driven icon strip', async ({
  browser,
}, testInfo) => {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  const session = await loginTenantAdmin({
    api,
    baseUrl,
    deviceName: 'playwright-profile-external-links-capability',
  });
  const unique = Date.now().toString();
  const type = `a0-external-links-${unique}`;
  const typeLabel = `A0 Links Externos ${unique}`;
  const longProfileName = `A0 Perfil com nome deliberadamente longo para validar a faixa compacta de links externos ${unique}`;
  const initialInstagramUrl = `https://www.instagram.com/belluga.now.${unique}/`;
  const updatedInstagramUrl = `https://instagram.com/belluga.updated.${unique}`;
  let browserContext;
  let accountSlug;
  let profileId;

  try {
    await createAccountProfileType(
      api,
      baseUrl,
      session.token,
      type,
      typeLabel,
      `${typeLabel} plural`,
    );

    const defaultType = await waitForPersistedAccountProfileType(
      api,
      baseUrl,
      session.token,
      type,
      (data) => data?.capabilities?.has_external_links === false,
      `New profile type ${type} did not default has_external_links to false.`,
    );
    expect(defaultType.capabilities.has_external_links).toBe(false);

    const pageBundle = await createAuthenticatedTenantAdminPage(browser, session);
    browserContext = pageBundle.context;
    const page = pageBundle.page;
    await page.route('https://*.ingest.sentry.io/**', (route) =>
      route.fulfill({ status: 204, body: '' }),
    );
    const browserFailures = installFailureCollectors(page);
    const namespacedAssetRequests = [];
    page.on('request', (candidate) => {
      const pathName = new URL(candidate.url()).pathname;
      if (pathName.includes('/assets/releases/')) {
        namespacedAssetRequests.push(pathName);
      }
    });

    await setExternalLinksCapability({
      page,
      api,
      baseUrl,
      token: session.token,
      type,
      enabled: true,
    });

    const servedBuildSha = await page.evaluate(
      () => window.__WEB_BUILD_SHA__ || '',
    );
    expect(servedBuildSha, 'Runtime must expose its build fingerprint.').toBeTruthy();
    const expectedAssetPrefix =
      `/assets/releases/${encodeURIComponent(servedBuildSha)}/assets/`;
    expect(
      namespacedAssetRequests.some(
        (pathName) => pathName === `${expectedAssetPrefix}FontManifest.json`,
      ),
      'Flutter must load its font manifest through the build-namespaced asset base.',
    ).toBe(true);

    const fontManifestResponse = await api.get(
      buildUrl(baseUrl, `${expectedAssetPrefix}FontManifest.json`),
    );
    expect(fontManifestResponse.status()).toBe(200);
    expect(fontManifestResponse.headers()['cache-control']).toContain('no-cache');
    expect(fontManifestResponse.headers()['cache-control']).not.toContain('immutable');
    const fontManifest = await fontManifestResponse.json();
    const simpleIconsFontPath = fontManifest.find(
      (entry) => entry?.family === 'packages/simple_icons/SimpleIcons',
    )?.fonts?.[0]?.asset;
    expect(
      simpleIconsFontPath,
      'Namespaced FontManifest must expose the SimpleIcons font asset.',
    ).toBeTruthy();
    const simpleIconsFontResponse = await api.get(
      buildUrl(baseUrl, `${expectedAssetPrefix}${simpleIconsFontPath}`),
    );
    expect(simpleIconsFontResponse.status()).toBe(200);
    expect((await simpleIconsFontResponse.body()).length).toBeGreaterThan(10000);
    expect(simpleIconsFontResponse.headers()['cache-control']).not.toContain(
      'immutable',
    );

    const fixture = await createPublishedAccountProfile(
      api,
      baseUrl,
      session.token,
      type,
      longProfileName,
    );
    ({ accountSlug, profileId } = fixture);
    let capacityProfile = await fetchAdminProfile(
      api,
      baseUrl,
      session.token,
      profileId,
    );
    const externalLinksLimit = Number(capacityProfile.external_links_limit);
    expect(
      Number.isSafeInteger(externalLinksLimit) && externalLinksLimit >= 0,
      'Admin profile detail must expose a non-negative plan-resolved external_links_limit.',
    ).toBe(true);

    const emptyPublicProfile = await gotoPublicProfile(
      page,
      baseUrl,
      fixture.profileSlug,
    );
    await expect(
      page.getByRole('button', { name: /^Abrir / }),
      'A capable profile with no configured links must render no external-link controls.',
    ).toHaveCount(0);
    expect(emptyPublicProfile.display_name).toBe(longProfileName);
    await testInfo.attach('external-links-public-zero-long-name', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });

    if (externalLinksLimit === 0) {
      assertNoCriticalBrowserFailures(browserFailures, 'T6');
      return;
    }

    await gotoAdminProfileEdit(page, baseUrl, accountSlug, profileId);
    await expect(page.getByText('Links externos', { exact: true })).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    const addLinkButton = page.getByRole('button', { name: /Adicionar link/ });
    await scrollUntilVisible(
      page,
      addLinkButton,
      'The external-links section must expose its tappable add row.',
    );
    await addLinkButton.click();
    await expect(page.getByText('Adicionar link', { exact: true })).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    await fillFlutterTextField(page, 'URL HTTPS', initialInstagramUrl);
    const createResponsePromise = page.waitForResponse((candidate) =>
      candidate.request().method() === 'POST' &&
      candidate.url().includes(`/account_profiles/${profileId}/external_links`),
    );
    await page.getByRole('button', { name: 'Salvar link', exact: true }).click();
    const createResponse = await createResponsePromise;
    expect(createResponse.status(), 'Admin form must create the Instagram link.').toBe(201);
    const createdProfile = (await createResponse.json())?.data || {};
    capacityProfile = createdProfile;
    const instagramLink = createdProfile.external_links?.find(
      (link) => link.type === 'instagram',
    );
    expect(instagramLink?.id, 'Created Instagram link must expose stable identity.')
      .toBeTruthy();

    await gotoPublicProfile(page, baseUrl, fixture.profileSlug);
    const instagramButton = page.getByRole('button', { name: 'Abrir Instagram' });
    await expect(instagramButton).toHaveCount(1);
    const instagramScreenshotPath = testInfo.outputPath(
      'external-links-public-instagram-icon.png',
    );
    await page.screenshot({ path: instagramScreenshotPath });
    await testInfo.attach('external-links-public-instagram-icon', {
      path: instagramScreenshotPath,
      contentType: 'image/png',
    });
    const popupPromise = browserContext.waitForEvent('page');
    await instagramButton.click();
    const popup = await popupPromise;
    await expect.poll(() => popup.url(), { timeout: appBootTimeoutMs })
      .toBe(initialInstagramUrl);
    await popup.close();

    const editLinkUrl = buildUrl(
      baseUrl,
      `/admin/accounts/${encodeURIComponent(accountSlug)}` +
        `/profiles/${encodeURIComponent(profileId)}` +
        `/links/${encodeURIComponent(instagramLink.id)}/edit`,
    );
    let response = await page.goto(editLinkUrl, { waitUntil: 'domcontentloaded' });
    expect(response).not.toBeNull();
    expect(response.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);
    await expect(page.getByText('Instagram', { exact: true }).first()).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    await fillFlutterTextField(page, 'URL HTTPS', updatedInstagramUrl);
    const updateResponsePromise = page.waitForResponse((candidate) =>
      candidate.request().method() === 'PATCH' &&
      candidate.url().includes(`/external_links/${instagramLink.id}`),
    );
    await page.getByRole('button', { name: 'Salvar link', exact: true }).click();
    const updateResponse = await updateResponsePromise;
    expect(updateResponse.status(), 'Admin form must update the Instagram link.').toBe(200);

    const beforeDisable = await fetchAdminProfile(
      api,
      baseUrl,
      session.token,
      profileId,
    );
    const dormantSnapshot = JSON.stringify(beforeDisable.external_links);
    expect(beforeDisable.external_links?.[0]?.url).toBe(updatedInstagramUrl);

    await setExternalLinksCapability({
      page,
      api,
      baseUrl,
      token: session.token,
      type,
      enabled: false,
    });
    await gotoAdminProfileEdit(page, baseUrl, accountSlug, profileId);
    await expect(page.getByText('Links externos', { exact: true })).toHaveCount(0);

    response = await page.goto(editLinkUrl, { waitUntil: 'domcontentloaded' });
    expect(response).not.toBeNull();
    expect(response.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);
    await expect.poll(() => new URL(page.url()).pathname, {
      timeout: appBootTimeoutMs,
      message: 'Disabled direct entry must return to the parent Profile editor.',
    }).toBe(
      `/admin/accounts/${encodeURIComponent(accountSlug)}` +
        `/profiles/${encodeURIComponent(profileId)}/edit`,
    );
    await expect(page.getByText('Links externos', { exact: true })).toHaveCount(0);

    const rejectedMutation = await createExternalLink(
      api,
      baseUrl,
      session.token,
      profileId,
      { type: 'facebook', url: 'https://facebook.com/belluga.now' },
    );
    expect(rejectedMutation.status()).toBe(422);
    expect((await rejectedMutation.json())?.code).toBe(
      'account_profile_external_links_capability_disabled',
    );
    const disabledReadback = await fetchAdminProfile(
      api,
      baseUrl,
      session.token,
      profileId,
    );
    expect(disabledReadback).not.toHaveProperty('external_links');

    await gotoPublicProfile(page, baseUrl, fixture.profileSlug);
    await expect(page.getByRole('button', { name: /^Abrir / })).toHaveCount(0);

    await setExternalLinksCapability({
      page,
      api,
      baseUrl,
      token: session.token,
      type,
      enabled: true,
    });
    const restored = await fetchAdminProfile(
      api,
      baseUrl,
      session.token,
      profileId,
    );
    expect(JSON.stringify(restored.external_links)).toBe(dormantSnapshot);

    await gotoAdminProfileEdit(page, baseUrl, accountSlug, profileId);
    await expect(page.getByText('Links externos', { exact: true })).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    const restoredUrl = page.getByRole('button', {
      name: new RegExp(escapeRegex(updatedInstagramUrl)),
    });
    await scrollUntilVisible(
      page,
      restoredUrl,
      'Re-enabled external links must expose the dormant URL unchanged.',
    );

    if (externalLinksLimit >= 2) {
      const youtubeResponse = await createExternalLink(
        api,
        baseUrl,
        session.token,
        profileId,
        { type: 'youtube', url: 'https://youtu.be/dQw4w9WgXcQ' },
      );
      expect(youtubeResponse.status()).toBe(201);
      capacityProfile = (await youtubeResponse.json())?.data || {};
      await gotoPublicProfile(page, baseUrl, fixture.profileSlug);
      await expect(page.getByRole('button', { name: /^Abrir / })).toHaveCount(2);
    }

    if (externalLinksLimit >= 3) {
      const websiteResponse = await createExternalLink(
        api,
        baseUrl,
        session.token,
        profileId,
        {
          type: 'website',
          url: 'https://belluga.example/profile',
          label: 'Site oficial',
        },
      );
      expect(websiteResponse.status()).toBe(201);
      capacityProfile = (await websiteResponse.json())?.data || {};
    }
    expect(capacityProfile.external_links.map((link) => link.type)).toEqual(
      externalLinksLimit >= 3
        ? ['instagram', 'youtube', 'website']
        : externalLinksLimit >= 2
          ? ['instagram', 'youtube']
          : ['instagram'],
    );
    expect(capacityProfile.external_links.length).toBeLessThanOrEqual(
      externalLinksLimit,
    );
    const capacityFillCandidates = [
      { type: 'facebook', url: 'https://facebook.com/belluga.now' },
      { type: 'tiktok', url: 'https://www.tiktok.com/@belluga' },
      { type: 'spotify', url: 'https://open.spotify.com/artist/belluga' },
    ];
    for (const candidate of capacityFillCandidates) {
      if (capacityProfile.external_links.length >= externalLinksLimit) {
        break;
      }
      const fillResponse = await createExternalLink(
        api,
        baseUrl,
        session.token,
        profileId,
        candidate,
      );
      expect(fillResponse.status()).toBe(201);
      capacityProfile = (await fillResponse.json())?.data || {};
    }
    expect(capacityProfile.external_links.length).toBeLessThanOrEqual(
      externalLinksLimit,
    );

    const overflowCandidate = capacityFillCandidates.find(
      (candidate) =>
        !capacityProfile.external_links.some((link) => link.type === candidate.type),
    );
    if (overflowCandidate) {
      const overflowResponse = await createExternalLink(
        api,
        baseUrl,
        session.token,
        profileId,
        overflowCandidate,
      );
      expect(overflowResponse.status()).toBe(422);
      expect((await overflowResponse.json())?.errors).toHaveProperty(
        'external_links_limit',
      );
    }

    await gotoPublicProfile(page, baseUrl, fixture.profileSlug);
    await expect(page.getByRole('button', { name: /^Abrir / })).toHaveCount(
      capacityProfile.external_links.length,
    );
    await expect(page.getByRole('button', { name: 'Abrir Instagram' })).toBeVisible();
    if (capacityProfile.external_links.some((link) => link.type === 'youtube')) {
      await expect(page.getByRole('button', { name: 'Abrir YouTube' })).toBeVisible();
    }
    if (capacityProfile.external_links.some((link) => link.type === 'website')) {
      await expect(page.getByRole('button', { name: 'Abrir Site oficial' })).toBeVisible();
    }
    const threeLinkScreenshotPath = testInfo.outputPath(
      'external-links-public-three-long-name.png',
    );
    await page.screenshot({ path: threeLinkScreenshotPath });
    await testInfo.attach('external-links-public-three-long-name', {
      path: threeLinkScreenshotPath,
      contentType: 'image/png',
    });

    response = await page.goto(editLinkUrl, { waitUntil: 'domcontentloaded' });
    expect(response).not.toBeNull();
    expect(response.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);
    const deleteResponsePromise = page.waitForResponse((candidate) =>
      candidate.request().method() === 'DELETE' &&
      candidate.url().includes(`/external_links/${instagramLink.id}`),
    );
    const removeLinkButton = page.getByRole('button', {
      name: 'Remover link',
      exact: true,
    });
    await scrollUntilVisible(
      page,
      removeLinkButton,
      'The external-link edit route must expose its destructive footer.',
    );
    await removeLinkButton.click();
    await page.getByRole('button', { name: 'Remover', exact: true }).last().click();
    expect((await deleteResponsePromise).status()).toBe(200);

    const afterUiDelete = await fetchAdminProfile(
      api,
      baseUrl,
      session.token,
      profileId,
    );
    for (const link of afterUiDelete.external_links) {
      expect(
        (await deleteExternalLink(
          api,
          baseUrl,
          session.token,
          profileId,
          link.id,
        )).status(),
      ).toBe(200);
    }
    await gotoPublicProfile(page, baseUrl, fixture.profileSlug);
    await expect(page.getByRole('button', { name: /^Abrir / })).toHaveCount(0);

    assertNoCriticalBrowserFailures(browserFailures, 'T6');
  } finally {
    if (browserContext) {
      await browserContext.close().catch(() => {});
    }
    try {
      if (accountSlug) {
        await cleanupOnboardedAccount(
          api,
          baseUrl,
          session.token,
          accountSlug,
          {
            strict: false,
            maxAttempts: 5,
            baseDelayMs: 250,
            requestTimeoutMs: 10000,
          },
        );
      }
    } finally {
      await deleteAccountProfileType(api, baseUrl, session.token, type);
      await api.dispose();
    }
  }
});
