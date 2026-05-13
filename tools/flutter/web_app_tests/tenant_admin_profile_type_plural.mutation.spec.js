const { test, expect, request } = require('@playwright/test');
const { loginTenantAdmin } = require('./support/tenant_admin_auth');
const {
  createAuthenticatedTenantAdminPage,
} = require('./support/tenant_admin_seeded_session');

const tenantUrl = process.env.NAV_TENANT_URL;
const appBootTimeoutMs = 90000;

test.describe.configure({ timeout: 300000 });

function requireTenantUrl() {
  expect(
    tenantUrl,
    'Missing NAV_TENANT_URL. Profile type plural mutation suite requires a live tenant URL.',
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

async function fillFlutterTextField(page, label, value) {
  const field = page.getByLabel(label).first();
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
          is_favoritable: true,
          has_avatar: true,
          has_cover: false,
          has_bio: false,
          has_content: false,
          has_taxonomies: false,
          has_events: false,
          is_poi_enabled: false,
          is_reference_location_enabled: false,
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

test('@mutation T6-PLURAL tenant-admin account profile type edit persists plural label', async ({
  browser,
}, testInfo) => {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  const session = await loginTenantAdmin({
    api,
    baseUrl,
    deviceName: 'playwright-profile-type-plural',
  });
  const unique = Date.now().toString();
  const type = `pw-plural-${unique}`;
  const label = `Perfil PW ${unique}`;
  const initialPlural = `Perfis PW ${unique}`;
  const updatedPlural = `Perfis Atualizados ${unique}`;
  let browserContext;

  try {
    await createAccountProfileType(
      api,
      baseUrl,
      session.token,
      type,
      label,
      initialPlural,
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

    const response = await page.goto(editUrl, {
      waitUntil: 'domcontentloaded',
    });
    expect(response, 'Account profile type edit response should be available.')
      .not.toBeNull();
    expect(response.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);

    await fillFlutterTextField(page, 'Label plural', updatedPlural);

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
        )
      );
    });

    await clickSaveChanges(page);

    const patchRequest = await patchRequestPromise;
    const patchPayload = patchRequest.postDataJSON();
    expect(patchPayload?.labels?.plural).toBe(updatedPlural);

    const patchResponse = await patchResponsePromise;
    expect(patchResponse.status()).toBeLessThan(400);
    const patchResult = await patchResponse.json();
    expect(patchResult?.data?.labels?.plural).toBe(updatedPlural);
    expect(patchResult?.data?.labels?.singular).toBe(label);
    expect(patchResult?.data?.label).toBe(label);
    await testInfo.attach('plural-after-save', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });

    await browserContext.close();
    pageBundle = await createAuthenticatedTenantAdminPage(browser, session);
    browserContext = pageBundle.context;
    page = pageBundle.page;

    const reopenHydratePromise = page.waitForResponse((candidate) => {
      return (
        candidate.request().method() === 'GET' &&
        candidate.url().includes(
          `/admin/api/v1/account_profile_types/${encodeURIComponent(type)}`,
        )
      );
    });

    const reopenResponse = await page.goto(editUrl, {
      waitUntil: 'domcontentloaded',
    });
    expect(reopenResponse).not.toBeNull();
    expect(reopenResponse.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);

    const reopenHydrateResponse = await reopenHydratePromise;
    expect(reopenHydrateResponse.status()).toBeLessThan(400);
    const reopenHydratePayload = await reopenHydrateResponse.json();
    expect(reopenHydratePayload?.data?.labels?.plural).toBe(updatedPlural);
    expect(reopenHydratePayload?.data?.labels?.singular).toBe(label);
    expect(reopenHydratePayload?.data?.label).toBe(label);

    await testInfo.attach('plural-after-reopen', {
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
