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
  { expectedPlural, expectedSingular, expectedLabel },
) {
  for (let attempt = 1; attempt <= 24; attempt += 1) {
    const response = await fetchAccountProfileType(api, baseUrl, token, type);
    if (response.status() < 400) {
      const payload = await response.json();
      const data = payload?.data || {};
      if (
        data?.labels?.plural === expectedPlural &&
        data?.labels?.singular === expectedSingular &&
        data?.label === expectedLabel
      ) {
        return data;
      }
    }
    await pageWait(500);
  }

  throw new Error(
    `Account profile type ${type} did not persist plural="${expectedPlural}" within the expected polling window.`,
  );
}

function pageWait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

    await clickSaveChanges(page);

    const patchRequest = await patchRequestPromise;
    const patchPayload = patchRequest.postDataJSON();
    expect(patchPayload?.labels?.plural).toBe(updatedPlural);

    const patchResult = await waitForPersistedAccountProfileType(
      api,
      baseUrl,
      session.token,
      type,
      {
        expectedPlural: updatedPlural,
        expectedSingular: label,
        expectedLabel: label,
      },
    );
    expect(patchResult?.labels?.plural).toBe(updatedPlural);
    expect(patchResult?.labels?.singular).toBe(label);
    expect(patchResult?.label).toBe(label);
    await testInfo.attach('plural-after-save', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });

    await browserContext.close();
    pageBundle = await createAuthenticatedTenantAdminPage(browser, session);
    browserContext = pageBundle.context;
    page = pageBundle.page;

    const reopenResponse = await page.goto(editUrl, {
      waitUntil: 'domcontentloaded',
    });
    expect(reopenResponse).not.toBeNull();
    expect(reopenResponse.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);
    await expect(
      await resolveVisibleFlutterTextField(page, 'Tipo (slug)'),
      'Reopened edit screen must expose the profile type form again before persisted readback is asserted.',
    ).toBeVisible({ timeout: appBootTimeoutMs });
    const reopenHydratePayload = await waitForPersistedAccountProfileType(
      api,
      baseUrl,
      session.token,
      type,
      {
        expectedPlural: updatedPlural,
        expectedSingular: label,
        expectedLabel: label,
      },
    );
    expect(reopenHydratePayload?.labels?.plural).toBe(updatedPlural);
    expect(reopenHydratePayload?.labels?.singular).toBe(label);
    expect(reopenHydratePayload?.label).toBe(label);

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
