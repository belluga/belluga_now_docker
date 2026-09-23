const { test, expect, request } = require('@playwright/test');
const { loginTenantAdmin } = require('./support/tenant_admin_auth');
const {
  createAuthenticatedTenantAdminPage,
} = require('./support/tenant_admin_seeded_session');
const {
  cleanupOnboardedAccount,
} = require('./support/account_onboarding_cleanup');
const { selectDropdownOption } = require('./support/semantic_dropdown');

const tenantUrl = process.env.NAV_TENANT_URL;
const appBootTimeoutMs = 90000;

test.describe.configure({ timeout: 420000 });

function requireTenantUrl() {
  expect(
    tenantUrl,
    'Missing NAV_TENANT_URL. Location-policy mutation evidence requires a live tenant URL.',
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
    extraHTTPHeaders: { Accept: 'application/json' },
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
    } else if ((await a11yButton.count()) > 0) {
      await a11yButton.first().click();
    }
    await page.waitForTimeout(250);
  }
}

async function resolveToggle(page, label) {
  const pattern = new RegExp(label, 'i');
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

async function toggleCheckedValue(toggle) {
  const ariaChecked = await toggle.getAttribute('aria-checked').catch(() => null);
  if (ariaChecked != null) {
    return ariaChecked === 'true';
  }
  return toggle.isChecked().catch(() => false);
}

async function toggleEnabledValue(toggle) {
  const ariaDisabled = await toggle
    .getAttribute('aria-disabled')
    .catch(() => null);
  if (ariaDisabled != null) {
    return ariaDisabled !== 'true';
  }
  return toggle.isEnabled().catch(() => false);
}

async function createProfileType(
  api,
  baseUrl,
  token,
  type,
  label,
  capabilities = undefined,
) {
  const response = await api.post(
    buildUrl(baseUrl, '/admin/api/v1/account_profile_types'),
    {
      headers: authHeaders(token),
      data: {
        type,
        label,
        labels: { singular: label, plural: `${label}s` },
        allowed_taxonomies: [],
        visual: {
          mode: 'icon',
          icon: 'place',
          color: '#0F766E',
          icon_color: '#FFFFFF',
        },
        ...(capabilities ? { capabilities } : {}),
      },
      failOnStatusCode: false,
    },
  );
  expect(response.status(), 'Location-policy profile type must be created.').toBe(
    201,
  );
  return (await response.json())?.data || {};
}

async function fetchProfileType(api, baseUrl, token, type) {
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
  expect(response.status(), 'Profile type readback must succeed.').toBe(200);
  return (await response.json())?.data || {};
}

async function deleteProfileType(api, baseUrl, token, type) {
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

async function onboardAccount(api, baseUrl, token, data) {
  return api.post(buildUrl(baseUrl, '/admin/api/v1/account_onboardings'), {
    headers: {
      ...authHeaders(token),
      'X-Request-ID': `pw-location-policy-${Date.now()}-${Math.random()}`,
    },
    data,
    failOnStatusCode: false,
  });
}

test('@mutation T6-LOCATION-POLICY profile type policy persists and optional accounts support absent or present location', async ({
  browser,
}, testInfo) => {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  const session = await loginTenantAdmin({
    api,
    baseUrl,
    deviceName: 'playwright-account-profile-location-policy',
  });
  const unique = Date.now().toString();
  const type = `a0-location-policy-${unique}`;
  const label = `A0 Location Policy ${unique}`;
  const accountSlugs = [];
  let browserContext;

  try {
    await createProfileType(api, baseUrl, session.token, type, label);

    const pageBundle = await createAuthenticatedTenantAdminPage(
      browser,
      session,
    );
    browserContext = pageBundle.context;
    const page = pageBundle.page;
    const response = await page.goto(
      buildUrl(
        baseUrl,
        `/admin/profile-types/${encodeURIComponent(type)}/edit`,
      ),
      { waitUntil: 'domcontentloaded' },
    );
    expect(response, 'Profile type edit response should be available.').not.toBeNull();
    expect(response.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);

    const mapPoi = await resolveToggle(page, 'Is map poi enabled');
    const physicalHost = await resolveToggle(page, 'Is physical host enabled');
    const referenceLocation = await resolveToggle(
      page,
      'Is reference location enabled',
    );
    expect(await toggleEnabledValue(mapPoi)).toBe(true);
    expect(await toggleEnabledValue(physicalHost)).toBe(true);
    expect(await toggleEnabledValue(referenceLocation)).toBe(true);

    await selectDropdownOption(page, {
      fieldLabel: 'Location policy',
      optionText: 'Optional',
    });
    await expect.poll(() => toggleEnabledValue(mapPoi)).toBe(true);
    await expect.poll(() => toggleEnabledValue(physicalHost)).toBe(true);
    await expect.poll(() => toggleEnabledValue(referenceLocation)).toBe(true);

    await mapPoi.click();
    await physicalHost.click();
    await expect.poll(() => toggleCheckedValue(mapPoi)).toBe(true);
    await expect.poll(() => toggleCheckedValue(physicalHost)).toBe(true);

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
    const save = page.getByRole('button', { name: /Salvar altera/i }).first();
    await save.scrollIntoViewIfNeeded();
    await save.click();

    const patchRequest = await patchRequestPromise;
    const patchPayload = patchRequest.postDataJSON();
    expect(patchPayload.expected_capability_revision).toBe(0);
    expect(patchPayload.capabilities.location_policy.value).toBe('optional');
    expect(patchPayload.capabilities.is_map_poi_enabled.value).toBe(true);
    expect(patchPayload.capabilities.is_physical_host_enabled.value).toBe(true);
    const patchResponse = await patchResponsePromise;
    expect(patchResponse.status(), 'Location-policy update must succeed.').toBe(200);

    const persisted = await fetchProfileType(
      api,
      baseUrl,
      session.token,
      type,
    );
    expect(persisted.capability_revision).toBe(1);
    expect(persisted.capabilities.location_policy.configured.value).toBe(
      'optional',
    );
    expect(persisted.capabilities.location_policy.effective.value).toBe(
      'optional',
    );
    expect(
      persisted.capabilities.is_map_poi_enabled.configured.value,
    ).toBe(true);
    expect(persisted.capabilities.is_map_poi_enabled.effective.value).toBe(
      true,
    );
    expect(
      persisted.capabilities.is_physical_host_enabled.configured.value,
    ).toBe(true);
    expect(
      persisted.capabilities.is_physical_host_enabled.effective.value,
    ).toBe(true);

    const withoutLocation = await onboardAccount(api, baseUrl, session.token, {
      name: `A0 Optional Sem Local ${unique}`,
      ownership_state: 'unmanaged',
      profile_type: type,
    });
    expect(
      withoutLocation.status(),
      'Optional policy must allow onboarding without location.',
    ).toBe(201);
    const withoutLocationPayload = await withoutLocation.json();
    accountSlugs.push(withoutLocationPayload?.data?.account?.slug);

    const withLocation = await onboardAccount(api, baseUrl, session.token, {
      name: `A0 Optional Com Local ${unique}`,
      ownership_state: 'unmanaged',
      profile_type: type,
      location: { lat: -20.6736, lng: -40.4976 },
    });
    expect(
      withLocation.status(),
      'Optional policy must allow onboarding with location.',
    ).toBe(201);
    const withLocationPayload = await withLocation.json();
    accountSlugs.push(withLocationPayload?.data?.account?.slug);

    await testInfo.attach('location-policy-optional-save', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  } finally {
    for (const accountSlug of accountSlugs.filter(Boolean).reverse()) {
      await cleanupOnboardedAccount(
        api,
        baseUrl,
        session.token,
        accountSlug,
      );
    }
    if (browserContext) {
      await browserContext.close();
    }
    await deleteProfileType(api, baseUrl, session.token, type);
    await api.dispose();
  }
});
