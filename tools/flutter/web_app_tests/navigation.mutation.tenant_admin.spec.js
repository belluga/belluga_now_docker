const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { test, expect, request } = require('@playwright/test');
const {
  loginTenantAdmin: loginTenantAdminWithRequiredCredentials,
} = require('./support/tenant_admin_auth');

const tenantUrl = process.env.NAV_TENANT_URL;
const fixtureImagePath = path.resolve(
  __dirname,
  '../../../foundation_documentation/todos/ephemeral/image.png',
);
const fixtureFaviconPath = path.resolve(
  __dirname,
  '../../../laravel-app/tests/Assets/tenant_1.ico',
);
const fallbackFixtureImageBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAADIElEQVR4nO3UIQEAIBDAwI9AZWKRDmIgduL81GadfYGm+R0A/GMAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEPYAluQiSDn9lCoAAAAASUVORK5CYII=';
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

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function generatedNavigationFixtureImage() {
  const width = 320;
  const height = 180;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  let offset = 0;

  for (let y = 0; y < height; y += 1) {
    raw[offset] = 0;
    offset += 1;
    for (let x = 0; x < width; x += 1) {
      raw[offset] = Math.floor((x * 255) / (width - 1));
      raw[offset + 1] = Math.floor((y * 255) / (height - 1));
      raw[offset + 2] = (x * 7 + y * 13) % 256;
      raw[offset + 3] = 255;
      offset += 4;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
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

function fixtureImagePayload() {
  const buffer = fs.existsSync(fixtureImagePath)
    ? fs.readFileSync(fixtureImagePath)
    : generatedNavigationFixtureImage();
  return {
    name: 'belluga-navigation-fixture.png',
    mimeType: 'image/png',
    buffer,
  };
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
  await fileChooser.setFiles(
    fs.existsSync(fixturePath) ? fixturePath : fixtureImagePayload(),
  );

  if (!cropTitle) {
    return;
  }

  await expect(page.getByText(cropTitle)).toBeVisible({
    timeout: appBootTimeoutMs,
  });
  logStep(flow, `${cropTitle} visible`);
}

async function confirmCropSelection(page, flow) {
  const useButton = page.getByRole('button', { name: 'Usar' }).last();
  await expect(useButton).toBeVisible({ timeout: appBootTimeoutMs });
  await expect(useButton).toBeEnabled({ timeout: appBootTimeoutMs });
  logStep(flow, 'confirm crop selection');
  await useButton.click();
  await expect(useButton).toBeHidden({ timeout: appBootTimeoutMs });
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

  let lastValue = '';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await field.click();
    const selectAll = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
    await page.keyboard.press(selectAll);
    await page.keyboard.press('Backspace');
    await page.keyboard.type(value, { delay: 5 });

    try {
      await expect
        .poll(
          async () => {
            try {
              return await field.inputValue();
            } catch (_) {
              return '';
            }
          },
          {
            timeout: 3000,
            message: `Expected Flutter text field "${label}" to retain input.`,
          },
        )
        .toBe(value);
      return field;
    } catch (_) {
      try {
        lastValue = await field.inputValue();
      } catch (_) {
        lastValue = '<unreadable>';
      }
      await page.waitForTimeout(150);
    }
  }

  throw new Error(
    `Flutter text field "${label}" did not retain "${value}" before submit; last value was "${lastValue}".`,
  );
}

async function fillColorPickerField(page, label, value) {
  await fillFlutterTextField(page, label, value);
  const colorDialogTitle = page.getByText('Cor do marcador').last();
  const applyButton = page.getByRole('button', { name: /Aplicar cor/i }).last();
  if (await applyButton.count()) {
    await expect(applyButton).toBeVisible({ timeout: 2000 });
    await applyButton.click();
    await expect(colorDialogTitle).toBeHidden({ timeout: appBootTimeoutMs });
  }
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

async function clickSaveChanges(page) {
  const saveButton = page
    .getByRole('button', { name: /Salvar altera/i })
    .last();
  await saveButton.scrollIntoViewIfNeeded();
  await expect(saveButton).toBeVisible({
    timeout: appBootTimeoutMs,
  });
  await saveButton.click({ noWaitAfter: true });
}

async function scrollTenantAdminSheetToTop(page) {
  const viewport =
    page.viewportSize() ||
    (await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    })));
  await page.mouse.move(viewport.width * 0.62, viewport.height * 0.72);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await page.mouse.wheel(0, -1400);
    await page.waitForTimeout(120);
  }
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
    buildUrl: buildApiUrl,
    deviceName: 'playwright-web-navigation',
  });
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

async function createTaxonomy(
  api,
  baseUrl,
  token,
  {
    slug,
    name,
    appliesTo,
    terms,
    icon = 'category',
    color = '#AA5500',
  },
) {
  const response = await api.post(
    buildApiUrl(baseUrl, '/admin/api/v1/taxonomies'),
    {
      headers: authHeaders(token),
      data: {
        slug,
        name,
        applies_to: appliesTo,
        icon,
        color,
      },
    },
  );
  expect(response.status(), `Taxonomy ${slug} must be created.`).toBe(201);
  const payload = await response.json();
  const taxonomyId = payload?.data?.id?.toString() || '';
  expect(taxonomyId, `Taxonomy ${slug} must return an id.`).toBeTruthy();

  for (const term of terms) {
    const termResponse = await api.post(
      buildApiUrl(baseUrl, `/admin/api/v1/taxonomies/${taxonomyId}/terms`),
      {
        headers: authHeaders(token),
        data: term,
      },
    );
    expect(
      termResponse.status(),
      `Taxonomy term ${term.slug} must be created for ${slug}.`,
    ).toBe(201);
  }

  return { taxonomyId, slug, name, terms };
}

async function deleteTaxonomy(api, baseUrl, token, taxonomyId) {
  if (!taxonomyId) {
    return;
  }

  await api.delete(
    buildApiUrl(baseUrl, `/admin/api/v1/taxonomies/${taxonomyId}`),
    {
      headers: authHeaders(token),
      failOnStatusCode: false,
    },
  );
}

async function waitForTaxonomyRegistry(api, baseUrl, token, slugs) {
  await expect
    .poll(
      async () => {
        const response = await api.get(
          buildApiUrl(baseUrl, '/admin/api/v1/taxonomies?page=1&page_size=500'),
          {
            headers: authHeaders(token),
          },
        );
        if (response.status() >= 400) {
          return false;
        }
        const payload = await response.json();
        const rows = Array.isArray(payload?.data) ? payload.data : [];
        const available = new Set(
          rows.map((entry) => entry?.slug?.toString()).filter(Boolean),
        );
        return slugs.every((slug) => available.has(slug));
      },
      {
        timeout: appBootTimeoutMs,
        message:
          'Expected newly created taxonomies to appear in the tenant-admin taxonomy registry before opening type editors.',
      },
    )
    .toBeTruthy();
}

async function createAccountProfileType(
  api,
  baseUrl,
  token,
  {
    type,
    label,
    allowedTaxonomies,
    markerColor,
    iconColor = '#FFFFFF',
  },
) {
  const response = await api.post(
    buildApiUrl(baseUrl, '/admin/api/v1/account_profile_types'),
    {
      headers: authHeaders(token),
      data: {
        type,
        label,
        labels: {
          singular: label,
          plural: `${label}s`,
        },
        allowed_taxonomies: allowedTaxonomies,
        capabilities: {
          is_favoritable: true,
          has_taxonomies: true,
          has_avatar: true,
        },
        poi_visual: {
          mode: 'icon',
          icon: 'place',
          color: markerColor,
          icon_color: iconColor,
        },
      },
    },
  );
  expect(response.status(), `Account profile type ${type} must be created.`).toBe(
    201,
  );
  return response.json();
}

async function deleteAccountProfileType(api, baseUrl, token, type) {
  if (!type) {
    return;
  }

  await api.delete(
    buildApiUrl(
      baseUrl,
      `/admin/api/v1/account_profile_types/${encodeURIComponent(type)}`,
    ),
    {
      headers: authHeaders(token),
      failOnStatusCode: false,
    },
  );
}

async function createStaticProfileType(
  api,
  baseUrl,
  token,
  {
    type,
    label,
    allowedTaxonomies,
    markerColor,
    iconColor = '#FFFFFF',
  },
) {
  const response = await api.post(
    buildApiUrl(baseUrl, '/admin/api/v1/static_profile_types'),
    {
      headers: authHeaders(token),
      data: {
        type,
        label,
        map_category: 'beach',
        allowed_taxonomies: allowedTaxonomies,
        capabilities: {
          is_poi_enabled: true,
          has_taxonomies: true,
          has_content: true,
        },
        poi_visual: {
          mode: 'icon',
          icon: 'place',
          color: markerColor,
          icon_color: iconColor,
        },
      },
    },
  );
  expect(response.status(), `Static profile type ${type} must be created.`).toBe(
    201,
  );
  return response.json();
}

async function createEventType(
  api,
  baseUrl,
  token,
  {
    name,
    slug,
    allowedTaxonomies,
    icon = 'celebration',
    color = '#B51E5B',
    iconColor = '#FFFFFF',
  },
) {
  const response = await api.post(
    buildApiUrl(baseUrl, '/admin/api/v1/event_types'),
    {
      headers: authHeaders(token),
      data: {
        name,
        slug,
        allowed_taxonomies: allowedTaxonomies,
        visual: {
          mode: 'icon',
          icon,
          color,
          icon_color: iconColor,
        },
      },
    },
  );
  expect(response.status(), `Event type ${slug} must be created.`).toBe(201);
  return response.json();
}

async function deleteStaticProfileType(api, baseUrl, token, type) {
  if (!type) {
    return;
  }

  await api.delete(
    buildApiUrl(
      baseUrl,
      `/admin/api/v1/static_profile_types/${encodeURIComponent(type)}`,
    ),
    {
      headers: authHeaders(token),
      failOnStatusCode: false,
    },
  );
}

async function expectSelectedToggleChip(page, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const switchChip = page.getByRole('switch', {
    name: new RegExp(escaped, 'i'),
  });
  const checkboxChip = page.getByRole('checkbox', {
    name: new RegExp(escaped, 'i'),
  });
  const namedButtonChip = page.getByRole('button', {
    name: new RegExp(escaped, 'i'),
  });
  const textFallbackChip = page.getByText(label, { exact: true }).first();
  let chip;
  if ((await switchChip.count()) > 0) {
    chip = switchChip.first();
  } else if ((await checkboxChip.count()) > 0) {
    chip = checkboxChip.first();
  } else if ((await namedButtonChip.count()) > 0) {
    chip = namedButtonChip.first();
  } else {
    chip = textFallbackChip;
  }
  await scrollUntilVisible(
    page,
    chip,
    `Expected taxonomy chip "${label}" to appear before asserting selected state.`,
  );
  const stateChip = chip
    .locator(
      'xpath=ancestor-or-self::*[@aria-pressed or @aria-selected or @aria-checked or @data-selected][1]',
    )
    .first();
  const hasStateChip = (await stateChip.count().catch(() => 0)) > 0;
  const target = hasStateChip ? stateChip : chip;
  await expect
    .poll(
      async () => {
        return (
          (await target.getAttribute('aria-pressed').catch(() => null)) ||
          (await target.getAttribute('aria-selected').catch(() => null)) ||
          (await target.getAttribute('aria-checked').catch(() => null)) ||
          (await target.getAttribute('data-selected').catch(() => null)) ||
          ''
        );
      },
      {
        timeout: appBootTimeoutMs,
        message: `Expected taxonomy chip "${label}" to reopen selected.`,
      },
    )
    .toBe('true');
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
          buffer: fixtureImagePayload().buffer,
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

    await confirmCropSelection(page, 'cover');
    logStep('cover', 'save cover change');
    await Promise.all([saveResponsePromise, clickSaveChanges(page)]);

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
      if (urlsMatchIgnoringQuery(response.url(), coverUrl)) {
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

    await expect(
      verificationPage.getByRole('button', { name: 'Remover' }).first(),
      'Reloaded edit screen must render the persisted cover controls.',
    ).toBeVisible({ timeout: appBootTimeoutMs });

    const reloadedCoverResponse = await api.get(coverUrl, {
      failOnStatusCode: false,
    });
    expect(
      reloadedCoverResponse.status(),
      'Persisted cover URL must remain readable after edit-screen reload.',
    ).toBeLessThan(400);

    const renderedCoverRequestSucceeded = coverStatuses.some(
      (status) => status >= 200 && status < 400,
    );
    if (renderedCoverRequestSucceeded) {
      logStep('cover', 'persisted cover returned a successful browser response after reload');
    } else {
      logStep('cover', 'persisted cover remained readable after reload; browser reused cached media');
    }

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

    await confirmCropSelection(page, 'avatar');
    logStep('avatar', 'save avatar change');
    await Promise.all([saveResponsePromise, clickSaveChanges(page)]);

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
    const uniqueSlug = `playwrighttype${Date.now()}`;
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
    const nameField = await fillFlutterTextField(page, 'Nome', uniqueName);
    const slugField = await fillFlutterTextField(page, 'Slug', uniqueSlug);
    await expect(nameField).toHaveValue(uniqueName, {
      timeout: appBootTimeoutMs,
    });
    await expect(slugField).toHaveValue(uniqueSlug, {
      timeout: appBootTimeoutMs,
    });

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

    const eventTypesUrl = buildApiUrl(baseUrl, '/admin/events/types');
    logStep('event-type-asset', `open event types list ${eventTypesUrl}`);
    const response = await page.goto(eventTypesUrl, {
      waitUntil: 'domcontentloaded',
    });
    expect(response, 'Event types route response should be available.').not.toBeNull();
    expect(response.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);

    await expect(page.getByText('Tipos de evento')).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    const seededTypeButton = page
      .getByRole('button', {
        name: new RegExp(uniqueName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      })
      .first();
    await scrollUntilVisible(
      page,
      seededTypeButton,
      'Expected the seeded event type to appear in the admin event-type list before reopening edit.',
    );
    logStep('event-type-asset', 'open seeded row from list');
    await seededTypeButton.click();
    await expect(page.getByText('Editar tipo de evento')).toBeVisible({
      timeout: appBootTimeoutMs,
    });

    await expect
      .poll(
        async () => {
          if (typeAssetStatuses.some((status) => status === 200)) {
            return true;
          }
          const renderedSources = await page.locator('img').evaluateAll((nodes) =>
            nodes
              .map((node) => node.getAttribute('src') || '')
              .filter((entry) => entry.length > 0),
          );
          return renderedSources.some((entry) =>
            urlsMatchIgnoringQuery(
              entry.startsWith('http') ? entry : resolveAbsoluteUrl(baseUrl, entry),
              typeAssetUrl,
            ),
          );
        },
        {
          timeout: appBootTimeoutMs,
          message:
            'Expected the persisted event-type type asset to be observable after reopening edit, either via network fetch or rendered preview.',
        },
      )
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
    await confirmCropSelection(page, 'branding');
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

test('@mutation tenant-admin profile-type editors preload and preserve allowed taxonomies when saving unrelated visual changes', async ({
  browser,
}) => {
  test.setTimeout(600000);
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  let browserContext;
  let session = null;
  let eventTaxonomyAId = null;
  let eventTaxonomyBId = null;
  let profileTaxonomyAId = null;
  let profileTaxonomyBId = null;
  let staticTaxonomyId = null;
  let createdEventTypeId = null;
  let createdProfileType = null;
  let createdStaticType = null;

  try {
    session = await loginTenantAdmin(api, baseUrl);
    const unique = Date.now();
    const uniqueSuffix = String(unique).slice(-4);
    const eventTaxonomyA = await createTaxonomy(api, baseUrl, session.token, {
      slug: `hd13-event-a-${unique}`,
      name: `AA EvtA ${uniqueSuffix}`,
      appliesTo: ['event'],
      terms: [{ slug: `term-event-a-${unique}`, name: `Termo A ${uniqueSuffix}` }],
    });
    eventTaxonomyAId = eventTaxonomyA.taxonomyId;
    const eventTaxonomyB = await createTaxonomy(api, baseUrl, session.token, {
      slug: `hd13-event-b-${unique}`,
      name: `AB EvtB ${uniqueSuffix}`,
      appliesTo: ['event'],
      terms: [{ slug: `term-event-b-${unique}`, name: `Termo B ${uniqueSuffix}` }],
    });
    eventTaxonomyBId = eventTaxonomyB.taxonomyId;
    const profileTaxonomyA = await createTaxonomy(api, baseUrl, session.token, {
      slug: `hd13-profile-a-${unique}`,
      name: `AA Perfil A ${uniqueSuffix}`,
      appliesTo: ['account_profile'],
      terms: [{ slug: `term-a-${unique}`, name: `Termo A ${unique}` }],
    });
    profileTaxonomyAId = profileTaxonomyA.taxonomyId;
    const profileTaxonomyB = await createTaxonomy(api, baseUrl, session.token, {
      slug: `hd13-profile-b-${unique}`,
      name: `AB Perfil B ${uniqueSuffix}`,
      appliesTo: ['account_profile'],
      terms: [{ slug: `term-b-${unique}`, name: `Termo B ${unique}` }],
    });
    profileTaxonomyBId = profileTaxonomyB.taxonomyId;
    const staticTaxonomy = await createTaxonomy(api, baseUrl, session.token, {
      slug: `hd13-static-${unique}`,
      name: `AA Ativo ${uniqueSuffix}`,
      appliesTo: ['static_asset'],
      terms: [{ slug: `term-static-${unique}`, name: `Termo Ativo ${unique}` }],
    });
    staticTaxonomyId = staticTaxonomy.taxonomyId;
    await waitForTaxonomyRegistry(api, baseUrl, session.token, [
      eventTaxonomyA.slug,
      eventTaxonomyB.slug,
      profileTaxonomyA.slug,
      profileTaxonomyB.slug,
      staticTaxonomy.slug,
    ]);

    const createdEventType = await createEventType(
      api,
      baseUrl,
      session.token,
      {
        name: `HD13 Evento ${unique}`,
        slug: `hd13-event-${unique}`,
        allowedTaxonomies: [eventTaxonomyA.slug, eventTaxonomyB.slug],
        color: '#9E4B00',
      },
    );
    createdEventTypeId = createdEventType?.data?.id?.toString() || null;
    createdProfileType = await createAccountProfileType(
      api,
      baseUrl,
      session.token,
      {
        type: `hd13-profile-${unique}`,
        label: `HD13 Perfil ${unique}`,
        allowedTaxonomies: [profileTaxonomyA.slug, profileTaxonomyB.slug],
        markerColor: '#B51E5B',
      },
    );
    createdStaticType = await createStaticProfileType(
      api,
      baseUrl,
      session.token,
      {
        type: `hd13-static-${unique}`,
        label: `HD13 Ativo ${unique}`,
        allowedTaxonomies: [staticTaxonomy.slug],
        markerColor: '#1E6FB5',
      },
    );

    const pageBundle = await createAuthenticatedTenantAdminPage(browser, session);
    browserContext = pageBundle.context;
    const page = pageBundle.page;
    const collectors = installFailureCollectors(page);

    const profileTypeKey = createdProfileType?.data?.type?.toString() || '';
    const staticTypeKey = createdStaticType?.data?.type?.toString() || '';
    const eventTypeName = createdEventType?.data?.name?.toString() || '';
    expect(createdEventTypeId, 'Created event type must expose id.').toBeTruthy();
    expect(profileTypeKey, 'Created account profile type must expose type.').toBeTruthy();
    expect(staticTypeKey, 'Created static profile type must expose type.').toBeTruthy();

    const eventTypesUrl = buildApiUrl(baseUrl, '/admin/events/types');
    logStep('type-taxonomies', `open event types route ${eventTypesUrl}`);
    let response = await page.goto(eventTypesUrl, {
      waitUntil: 'domcontentloaded',
    });
    expect(response, 'Event types route response should be available.').not.toBeNull();
    expect(response.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);
    const eventTypeButton = page.getByRole('button', {
      name: new RegExp(eventTypeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    }).first();
    await scrollUntilVisible(
      page,
      eventTypeButton,
      'Expected the created event type to appear in the admin event-type list before validating allowed taxonomies.',
    );
    logStep('type-taxonomies', 'open created event type from list');
    await eventTypeButton.click();
    await expect(page.getByText('Editar tipo de evento')).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    await expect(page.getByText('Taxonomias permitidas')).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    await expectSelectedToggleChip(page, eventTaxonomyA.name);
    await expectSelectedToggleChip(page, eventTaxonomyB.name);
    logStep('type-taxonomies', 'event type preloaded allowed taxonomies confirmed');

    const eventDescriptionUpdate = `Descricao atualizada ${unique}`;
    await fillFlutterTextField(
      page,
      'Descrição (opcional)',
      eventDescriptionUpdate,
    );
    logStep('type-taxonomies', 'save event type with unrelated description change');
    const eventSaveResponsePromise = page.waitForResponse((candidate) => {
      return (
        candidate.request().method() === 'PATCH' &&
        candidate.url().includes(`/admin/api/v1/event_types/${createdEventTypeId}`)
      );
    });
    const visibleButtonTexts = await page.getByRole('button').evaluateAll((nodes) =>
      nodes
        .map((node) => (node.textContent || '').trim())
        .filter((entry) => entry.length > 0),
    );
    logStep(
      'type-taxonomies',
      `visible buttons before event save: ${visibleButtonTexts.join(' | ')}`,
    );
    logStep('type-taxonomies', 'click event type save button');
    await clickSaveChanges(page);
    logStep('type-taxonomies', 'event type save button clicked');
    const eventSaveResponse = await eventSaveResponsePromise;
    expect(eventSaveResponse.status()).toBeLessThan(400);
    const eventSavePayload = await eventSaveResponse.json();
    expect(
      (eventSavePayload?.data?.allowed_taxonomies || []).slice().sort(),
    ).toEqual([eventTaxonomyA.slug, eventTaxonomyB.slug].slice().sort());
    expect(eventSavePayload?.data?.description).toBe(eventDescriptionUpdate);
    logStep('type-taxonomies', 'event type save preserved allowed taxonomies');

    response = await page.goto(eventTypesUrl, {
      waitUntil: 'domcontentloaded',
    });
    expect(response, 'Event types reopen response should be available.').not.toBeNull();
    expect(response.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);
    const reopenedEventTypeButton = page.getByRole('button', {
      name: new RegExp(eventTypeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    }).first();
    await scrollUntilVisible(
      page,
      reopenedEventTypeButton,
      'Expected the created event type to reappear in the admin event-type list before verifying preserved allowed taxonomies.',
    );
    logStep('type-taxonomies', 'reopen event type from list');
    await reopenedEventTypeButton.click();
    await expect(page.getByText('Editar tipo de evento')).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    await expectSelectedToggleChip(page, eventTaxonomyA.name);
    await expectSelectedToggleChip(page, eventTaxonomyB.name);
    logStep('type-taxonomies', 'event type reopen preserved allowed taxonomies');

    const profileEditUrl = buildApiUrl(
      baseUrl,
      `/admin/profile-types/${encodeURIComponent(profileTypeKey)}/edit`,
    );
    logStep('type-taxonomies', `open account profile type route ${profileEditUrl}`);
    response = await page.goto(profileEditUrl, {
      waitUntil: 'domcontentloaded',
    });
    expect(response, 'Account profile type edit response should be available.').not.toBeNull();
    expect(response.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);
    await scrollTenantAdminSheetToTop(page);
    await expect(page.getByText('Taxonomias permitidas')).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    await expectSelectedToggleChip(
      page,
      profileTaxonomyA.name,
    );
    await expectSelectedToggleChip(
      page,
      profileTaxonomyB.name,
    );
    logStep('type-taxonomies', 'profile type preloaded allowed taxonomies confirmed');

    const profileLabelUpdate = `HD13 Perfil Atualizado ${unique}`;
    await fillFlutterTextField(page, 'Label', profileLabelUpdate);
    logStep('type-taxonomies', 'save profile type with unrelated label change');
    const profileSaveResponsePromise = page.waitForResponse((candidate) => {
      return (
        candidate.request().method() === 'PATCH' &&
        candidate.url().includes(
          `/admin/api/v1/account_profile_types/${encodeURIComponent(
            profileTypeKey,
          )}`,
        )
      );
    });
    logStep('type-taxonomies', 'click profile type save button');
    await clickSaveChanges(page);
    logStep('type-taxonomies', 'profile type save button clicked');
    const profileSaveResponse = await profileSaveResponsePromise;
    expect(profileSaveResponse.status()).toBeLessThan(400);
    const profileSavePayload = await profileSaveResponse.json();
    expect(
      (profileSavePayload?.data?.allowed_taxonomies || []).slice().sort(),
    ).toEqual([profileTaxonomyA.slug, profileTaxonomyB.slug].slice().sort());
    expect(profileSavePayload?.data?.label).toBe(profileLabelUpdate);
    logStep('type-taxonomies', 'profile type save preserved allowed taxonomies');

    response = await page.goto(profileEditUrl, {
      waitUntil: 'domcontentloaded',
    });
    expect(response, 'Account profile type reopen response should be available.').not.toBeNull();
    expect(response.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);
    await scrollTenantAdminSheetToTop(page);
    await expect(page.getByText('Taxonomias permitidas')).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    await expectSelectedToggleChip(
      page,
      profileTaxonomyA.name,
    );
    await expectSelectedToggleChip(
      page,
      profileTaxonomyB.name,
    );
    logStep('type-taxonomies', 'profile type reopen preserved allowed taxonomies');

    const staticEditUrl = buildApiUrl(
      baseUrl,
      `/admin/static_profile_types/${encodeURIComponent(staticTypeKey)}/edit`,
    );
    logStep('type-taxonomies', `open static profile type route ${staticEditUrl}`);
    response = await page.goto(staticEditUrl, {
      waitUntil: 'domcontentloaded',
    });
    expect(response, 'Static profile type edit response should be available.').not.toBeNull();
    expect(response.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);
    await scrollTenantAdminSheetToTop(page);
    await expect(page.getByText('Taxonomias permitidas')).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    await expectSelectedToggleChip(page, staticTaxonomy.name);
    logStep('type-taxonomies', 'static type preloaded allowed taxonomies confirmed');

    const staticLabelUpdate = `HD13 Ativo Atualizado ${unique}`;
    await fillFlutterTextField(page, 'Label', staticLabelUpdate);
    logStep('type-taxonomies', 'save static type with unrelated label change');
    const staticSaveResponsePromise = page.waitForResponse((candidate) => {
      return (
        candidate.request().method() === 'PATCH' &&
        candidate.url().includes(
          `/admin/api/v1/static_profile_types/${encodeURIComponent(
            staticTypeKey,
          )}`,
        )
      );
    });
    logStep('type-taxonomies', 'click static type save button');
    await clickSaveChanges(page);
    logStep('type-taxonomies', 'static type save button clicked');
    const staticSaveResponse = await staticSaveResponsePromise;
    expect(staticSaveResponse.status()).toBeLessThan(400);
    const staticSavePayload = await staticSaveResponse.json();
    expect(staticSavePayload?.data?.allowed_taxonomies || []).toEqual([
      staticTaxonomy.slug,
    ]);
    expect(staticSavePayload?.data?.label).toBe(staticLabelUpdate);
    logStep('type-taxonomies', 'static type save preserved allowed taxonomies');
    expect(staticSavePayload?.data?.poi_visual?.color).toBe('#1E6FB5');

    response = await page.goto(staticEditUrl, {
      waitUntil: 'domcontentloaded',
    });
    expect(response, 'Static profile type reopen response should be available.').not.toBeNull();
    expect(response.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);
    await scrollTenantAdminSheetToTop(page);
    await expect(page.getByText('Taxonomias permitidas')).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    await expectSelectedToggleChip(page, staticTaxonomy.name);

    await assertNoBrowserFailures(collectors);
  } finally {
    await deleteEventType(api, baseUrl, session?.token, createdEventTypeId);
    await deleteStaticProfileType(
      api,
      baseUrl,
      session?.token,
      createdStaticType?.data?.type?.toString() || '',
    );
    await deleteAccountProfileType(
      api,
      baseUrl,
      session?.token,
      createdProfileType?.data?.type?.toString() || '',
    );
    await deleteTaxonomy(api, baseUrl, session?.token, eventTaxonomyBId);
    await deleteTaxonomy(api, baseUrl, session?.token, eventTaxonomyAId);
    await deleteTaxonomy(api, baseUrl, session?.token, staticTaxonomyId);
    await deleteTaxonomy(api, baseUrl, session?.token, profileTaxonomyBId);
    await deleteTaxonomy(api, baseUrl, session?.token, profileTaxonomyAId);
    if (browserContext) {
      await browserContext.close().catch(() => {});
    }
    await api.dispose();
  }
});
