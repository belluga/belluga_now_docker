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
  const type = `pw-gallery-capability-${unique}`;
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

    const detailButton = page.getByRole('button', {
      name: new RegExp(escapeRegex(updatedLabel), 'i'),
    }).first();
    const listLabel = page
      .getByText(new RegExp(escapeRegex(updatedLabel), 'i'))
      .first();
    if ((await detailButton.count()) > 0) {
      await detailButton.click();
    } else {
      await listLabel.click();
    }
    await expect
      .poll(
        async () =>
          page.url().includes(
            `/admin/profile-types/${encodeURIComponent(type)}`,
          ),
        {
          timeout: appBootTimeoutMs,
          message:
            'Clicking the profile type list card must navigate to the profile type detail route.',
        },
      )
      .toBe(true);
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
