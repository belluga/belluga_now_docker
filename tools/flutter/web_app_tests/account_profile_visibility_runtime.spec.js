const crypto = require('crypto');
const { test, expect, request, chromium } = require('@playwright/test');
const { loginTenantAdmin } = require('./support/tenant_admin_auth');
const {
  createFreshAuthenticatedTenantAdminPage,
} = require('./support/tenant_admin_seeded_session');
const {
  cleanupOnboardedAccount,
} = require('./support/account_onboarding_cleanup');
const {
  accountProfileSemanticHeroPattern,
} = require('./support/account_profile_readonly_proof_contract');

const tenantUrl = process.env.NAV_TENANT_URL;
const appBootTimeoutMs = 90000;
const fixtureAvatar = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==',
  'base64',
);

test.describe.configure({ timeout: 420000 });

function requireTenantUrl() {
  expect(
    tenantUrl,
    'VIS runtime proof requires NAV_TENANT_URL.',
  ).toBeTruthy();
  return tenantUrl;
}

function runSuffix() {
  const raw = (process.env.NAV_TEST_RUN_ID || '').toString().trim();
  expect(raw, 'VIS runtime proof requires NAV_TEST_RUN_ID for owned fixture ids.')
    .toBeTruthy();
  const suffix = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  expect(suffix, 'NAV_TEST_RUN_ID must produce an owned fixture suffix.').toBeTruthy();
  return suffix;
}

function buildUrl(baseUrl, pathName) {
  return new URL(pathName, baseUrl).toString();
}

function authHeaders(token) {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

function textValue(value) {
  return value?.toString().trim() || '';
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function createApiContext(baseUrl) {
  return request.newContext({
    baseURL: baseUrl,
    extraHTTPHeaders: { Accept: 'application/json' },
    ignoreHTTPSErrors: true,
    timeout: 45000,
  });
}

async function enableAccessibilityIfNeeded(page) {
  const placeholder = page
    .locator('flt-semantics-placeholder[aria-label="Enable accessibility"]')
    .first();
  const button = page.getByRole('button', { name: /Enable accessibility/i });

  for (let attempt = 0; attempt < 25; attempt += 1) {
    if ((await page.getByRole('button').count()) > 1) return;
    if ((await placeholder.count()) > 0) {
      await placeholder.focus();
      await page.keyboard.press('Enter');
    } else if ((await button.count()) > 0) {
      await button.first().click();
    }
    await page.waitForTimeout(250);
  }
}

async function assertAppBooted(page) {
  await expect(page.locator('flt-glass-pane')).toHaveCount(1, {
    timeout: appBootTimeoutMs,
  });
  await expect(page.locator('#splash-screen')).toHaveCount(0, {
    timeout: appBootTimeoutMs,
  });
  await enableAccessibilityIfNeeded(page);
}

async function createProfileType(api, baseUrl, token, { type, label, capabilities }) {
  const response = await api.post(
    buildUrl(baseUrl, '/admin/api/v1/account_profile_types'),
    {
      headers: authHeaders(token),
      data: {
        type,
        label,
        labels: { singular: label, plural: `${label}s` },
        allowed_taxonomies: [],
        capabilities: {
          is_queryable: { value: true, parameters: {} },
          is_publicly_discoverable: { value: false, parameters: {} },
          is_publicly_navigable: { value: false, parameters: {} },
          location_policy: { value: 'disabled', parameters: {} },
          is_map_poi_enabled: { value: false, parameters: {} },
          is_physical_host_enabled: { value: false, parameters: {} },
          is_reference_location_enabled: { value: false, parameters: {} },
          is_favoritable: { value: false, parameters: {} },
          has_avatar: { value: false, parameters: {} },
          has_cover: { value: false, parameters: {} },
          has_bio: { value: false, parameters: {} },
          has_taxonomies: { value: false, parameters: {} },
          has_events: { value: false, parameters: {} },
          has_nested_profile_groups: { value: false, parameters: {} },
          ...capabilities,
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
  expect(response.status(), `Fixture type ${type} must be created.`).toBe(201);
  return response.json();
}

async function createProfile(api, baseUrl, token, { name, type }) {
  const response = await api.post(
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
  expect(response.status(), `Fixture profile ${name} must be created.`).toBe(201);
  const payload = await response.json();
  const accountSlug = textValue(payload?.data?.account?.slug);
  const id = textValue(payload?.data?.account_profile?.id);
  const slug = textValue(payload?.data?.account_profile?.slug);
  expect(accountSlug, `Fixture ${name} requires account slug.`).toBeTruthy();
  expect(id, `Fixture ${name} requires profile id.`).toBeTruthy();
  expect(slug, `Fixture ${name} requires profile slug.`).toBeTruthy();

  return { id, slug, name, accountSlug };
}

async function publishAccount(api, baseUrl, token, profile) {
  const publication = await api.patch(
    buildUrl(baseUrl, `/admin/api/v1/accounts/${profile.accountSlug}`),
    {
      headers: authHeaders(token),
      data: { publication: { status: 'published' } },
    },
  );
  expect(publication.status(), `Fixture ${profile.name} parent must publish.`)
    .toBeLessThan(400);
}

async function deleteProfileType(api, baseUrl, token, type) {
  if (!type) return;
  const response = await api.delete(
    buildUrl(baseUrl, `/admin/api/v1/account_profile_types/${encodeURIComponent(type)}`),
    { headers: authHeaders(token), failOnStatusCode: false },
  );
  expect([200, 202, 204, 404], `Fixture type ${type} cleanup must succeed.`)
    .toContain(response.status());
}

async function publicHeaders(api, baseUrl) {
  const fingerprint = crypto
    .createHash('sha256')
    .update(`visibility-runtime:${baseUrl}`)
    .digest('hex');
  const response = await api.post(
    buildUrl(baseUrl, '/api/v1/anonymous/identities'),
    {
      data: {
        device_name: 'playwright-account-profile-visibility-runtime',
        fingerprint: {
          hash: fingerprint,
          user_agent: 'playwright-account-profile-visibility-runtime',
          locale: 'pt-BR',
        },
        metadata: { source: 'account_profile_visibility_runtime' },
      },
    },
  );
  expect([200, 201]).toContain(response.status());
  const payload = await response.json();
  const token = textValue(payload?.data?.token);
  expect(token, 'Anonymous public identity token is required.').toBeTruthy();
  return { Accept: 'application/json', Authorization: `Bearer ${token}` };
}

async function attachAvatar(page) {
  const addAvatar = page.getByRole('button', { name: 'Adicionar avatar' });
  await addAvatar.scrollIntoViewIfNeeded();
  await expect(addAvatar).toBeVisible({ timeout: appBootTimeoutMs });
  await addAvatar.click();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByText('Do dispositivo').last().click(),
  ]);
  await chooser.setFiles({
    name: 'visibility-avatar.png',
    mimeType: 'image/png',
    buffer: fixtureAvatar,
  });
  await expect(page.getByText('Recortar avatar')).toBeVisible({
    timeout: appBootTimeoutMs,
  });
}

test('@mutation VIS-RUNTIME-01 public visibility states and protected admin media stay connected', async () => {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  const ownedAccounts = [];
  const ownedTypes = [];
  let browser;
  let adminBrowser;
  let adminContext;
  let session;
  let primaryError = null;

  try {
    session = await loginTenantAdmin({
      api,
      baseUrl,
      deviceName: 'playwright-account-profile-visibility-runtime',
    });
    const suffix = runSuffix();
    const rowType = `pw_vis_row_${suffix}`;
    const directType = `pw_vis_direct_${suffix}`;
    const draftType = `pw_vis_draft_${suffix}`;

    await createProfileType(api, baseUrl, session.token, {
      type: rowType,
      label: `PW VIS Row ${suffix}`,
      capabilities: {
        is_publicly_discoverable: { value: true, parameters: {} },
        is_publicly_navigable: { value: false, parameters: {} },
      },
    });
    ownedTypes.push(rowType);
    await createProfileType(api, baseUrl, session.token, {
      type: directType,
      label: `PW VIS Direct ${suffix}`,
      capabilities: {
        is_publicly_discoverable: { value: false, parameters: {} },
        is_publicly_navigable: { value: true, parameters: {} },
      },
    });
    ownedTypes.push(directType);
    await createProfileType(api, baseUrl, session.token, {
      type: draftType,
      label: `PW VIS Draft ${suffix}`,
      capabilities: {
        has_avatar: { value: true, parameters: {} },
      },
    });
    ownedTypes.push(draftType);

    const rowOnly = await createProfile(api, baseUrl, session.token, {
      name: `PW VIS Row Only ${suffix}`,
      type: rowType,
    });
    ownedAccounts.push(rowOnly.accountSlug);
    await publishAccount(api, baseUrl, session.token, rowOnly);
    const directOnly = await createProfile(api, baseUrl, session.token, {
      name: `PW VIS Direct Only ${suffix}`,
      type: directType,
    });
    ownedAccounts.push(directOnly.accountSlug);
    await publishAccount(api, baseUrl, session.token, directOnly);
    const adminDraft = await createProfile(api, baseUrl, session.token, {
      name: `PW VIS Draft ${suffix}`,
      type: draftType,
    });
    ownedAccounts.push(adminDraft.accountSlug);

    const headers = await publicHeaders(api, baseUrl);
    const rowSearchUrl = new URL(buildUrl(baseUrl, '/api/v1/account_profiles'));
    rowSearchUrl.searchParams.set('search', rowOnly.name);
    rowSearchUrl.searchParams.set('page_size', '20');
    const catalog = await api.get(rowSearchUrl.toString(), {
      headers,
    });
    expect(catalog.status()).toBe(200);
    const catalogPayload = await catalog.json();
    const rows = Array.isArray(catalogPayload?.data?.data)
      ? catalogPayload.data.data
      : Array.isArray(catalogPayload?.data)
        ? catalogPayload.data
        : [];
    const rowOnlyPayload = rows.find((row) => row?.id?.toString() === rowOnly.id);
    expect(rowOnlyPayload, 'Discoverable fixture must be present in the public row payload.')
      .toMatchObject({
        display_name: rowOnly.name,
        can_open_public_detail: false,
        public_detail_path: null,
      });
    const directSearchUrl = new URL(buildUrl(baseUrl, '/api/v1/account_profiles'));
    directSearchUrl.searchParams.set('search', directOnly.name);
    directSearchUrl.searchParams.set('page_size', '20');
    const directCatalogResponse = await api.get(directSearchUrl.toString(), { headers });
    expect(directCatalogResponse.status()).toBe(200);
    const directCatalogPayload = await directCatalogResponse.json();
    const directRows = Array.isArray(directCatalogPayload?.data?.data)
      ? directCatalogPayload.data.data
      : Array.isArray(directCatalogPayload?.data)
        ? directCatalogPayload.data
        : [];
    expect(
      directRows.some((row) => row?.id?.toString() === directOnly.id),
      'Non-discoverable direct fixture must not enter its public row search.',
    ).toBe(false);

    const directPayloadResponse = await api.get(
      buildUrl(baseUrl, `/api/v1/account_profiles/${directOnly.slug}`),
      { headers },
    );
    expect(directPayloadResponse.status(), 'Navigable non-discoverable detail must load.')
      .toBe(200);
    const unavailablePayloadResponse = await api.get(
      buildUrl(baseUrl, `/api/v1/account_profiles/${adminDraft.slug}`),
      { headers, failOnStatusCode: false },
    );
    expect(unavailablePayloadResponse.status(), 'Draft-parent public detail must stay unavailable.')
      .toBe(404);

    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    });
    const publicContext = await browser.newContext({ ignoreHTTPSErrors: true });
    const publicPage = await publicContext.newPage();
    try {
      const directResponse = await publicPage.goto(
        buildUrl(baseUrl, `/parceiro/${directOnly.slug}`),
        { waitUntil: 'domcontentloaded' },
      );
      expect(directResponse).not.toBeNull();
      await assertAppBooted(publicPage);
      await expect(publicPage.getByRole('banner', {
        name: accountProfileSemanticHeroPattern(directOnly.name),
      }).first()).toBeVisible({ timeout: appBootTimeoutMs });

      const discoveryResponse = await publicPage.goto(buildUrl(baseUrl, '/descobrir'), {
        waitUntil: 'domcontentloaded',
      });
      expect(discoveryResponse).not.toBeNull();
      await assertAppBooted(publicPage);
      const searchButton = publicPage.getByRole('button', { name: 'Buscar perfis' });
      await expect(searchButton).toBeVisible({ timeout: appBootTimeoutMs });
      await searchButton.click();
      const discoverySearch = publicPage.getByPlaceholder('Buscar artistas, locais...');
      await expect(discoverySearch).toBeVisible({ timeout: appBootTimeoutMs });
      await discoverySearch.fill(rowOnly.name);
      const rowOnlyText = publicPage.getByText(
        new RegExp(`^Perfil ${escapeRegExp(rowOnly.name)}(?:\\s|$)`, 'i'),
      ).first();
      await expect(rowOnlyText)
        .toBeVisible({ timeout: appBootTimeoutMs });
      const rowOnlyTapTarget = rowOnlyText.locator('xpath=..');
      const discoveryUrl = publicPage.url();
      await rowOnlyTapTarget.click();
      expect(
        publicPage.url(),
        'A discoverable but non-navigable profile row must not route after a real tap.',
      ).toBe(discoveryUrl);

      const unavailablePath = `/api/v1/account_profiles/${adminDraft.slug}`;
      const unavailablePayloadResponsePromise = publicPage.waitForResponse(
        (candidate) => candidate.request().method().toUpperCase() === 'GET'
          && new URL(candidate.url()).pathname === unavailablePath,
        { timeout: appBootTimeoutMs },
      );
      const unavailableResponse = await publicPage.goto(
        buildUrl(baseUrl, `/parceiro/${adminDraft.slug}`),
        { waitUntil: 'domcontentloaded' },
      );
      expect(unavailableResponse).not.toBeNull();
      const unavailablePayloadResponse = await unavailablePayloadResponsePromise;
      expect(
        unavailablePayloadResponse.status(),
        'Draft-parent browser detail hydration must remain unavailable.',
      ).toBe(404);
      await assertAppBooted(publicPage);
      await expect(publicPage.getByText('Algo deu errado'))
        .toBeVisible({ timeout: appBootTimeoutMs });
      await expect(publicPage.getByRole('button', { name: 'Tentar novamente' }))
        .toBeVisible({ timeout: appBootTimeoutMs });
    } finally {
      await publicContext.close();
    }

    const adminReadback = await api.get(
      buildUrl(baseUrl, `/admin/api/v1/account_profiles/${adminDraft.id}`),
      { headers: authHeaders(session.token) },
    );
    expect(adminReadback.status(), 'Authorized admin must read the draft fixture.').toBe(200);
    const adminPayload = await adminReadback.json();
    expect(textValue(adminPayload?.data?.parent_account_publication_status))
      .toBe('draft');

    const adminBundle = await createFreshAuthenticatedTenantAdminPage(session);
    adminBrowser = adminBundle.browser;
    adminContext = adminBundle.context;
    const adminPage = adminBundle.page;
    const protectedResponses = [];
    const protectedPath = `/admin/api/v1/account_profiles/${adminDraft.id}/media/avatar`;
    adminPage.on('response', (candidate) => {
      if (new URL(candidate.url()).pathname === protectedPath) {
        protectedResponses.push(candidate);
      }
    });
    const editResponse = await adminPage.goto(
      buildUrl(baseUrl, `/admin/accounts/${adminDraft.accountSlug}/profiles/${adminDraft.id}/edit`),
      { waitUntil: 'domcontentloaded' },
    );
    expect(editResponse).not.toBeNull();
    await assertAppBooted(adminPage);
    await expect(adminPage.getByText('Publicacao da conta: Rascunho'))
      .toBeVisible({ timeout: appBootTimeoutMs });
    await expect(adminPage.getByRole('button', { name: 'Adicionar avatar' }))
      .toBeVisible({ timeout: appBootTimeoutMs });
    await attachAvatar(adminPage);
    await adminPage.getByRole('button', { name: 'Usar' }).click();
    await expect.poll(() => protectedResponses.some((response) => response.status() === 200), {
      timeout: appBootTimeoutMs,
      message: 'Admin draft reload must issue an authenticated avatar byte request.',
    }).toBeTruthy();
    const protectedResponse = protectedResponses.find((response) => response.status() === 200);
    expect(protectedResponse, 'Protected avatar bytes must return successfully.').toBeTruthy();
    const protectedRequest = protectedResponse.request();
    expect(protectedRequest.headers().authorization).toMatch(/^Bearer\s+\S+$/);
    expect(protectedRequest.url()).not.toMatch(/[?&](?:token|access_token|authorization)=/i);
    await expect(adminPage.getByRole('button', { name: 'Remover' }).first())
      .toBeVisible({ timeout: appBootTimeoutMs });
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    const cleanupErrors = [];
    for (const accountSlug of ownedAccounts.reverse()) {
      try {
        await cleanupOnboardedAccount(api, baseUrl, session?.token, accountSlug);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    for (const type of ownedTypes.reverse()) {
      try {
        await deleteProfileType(api, baseUrl, session?.token, type);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (adminContext) await adminContext.close();
    if (adminBrowser) await adminBrowser.close();
    if (browser) await browser.close();
    await api.dispose();
    if (cleanupErrors.length > 0 && !primaryError) throw cleanupErrors[0];
  }
});
