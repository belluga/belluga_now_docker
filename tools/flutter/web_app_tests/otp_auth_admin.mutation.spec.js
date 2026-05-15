const { test, expect, request } = require('@playwright/test');
const {
  loginTenantAdmin: loginTenantAdminWithRequiredCredentials,
} = require('./support/tenant_admin_auth');

const tenantUrl = process.env.NAV_TENANT_URL;
const appBootTimeoutMs = 90000;

test.describe.configure({ timeout: 300000 });

function requireTenantUrl() {
  expect(
    tenantUrl,
    'Missing NAV_TENANT_URL. OTP admin mutation suite requires a live tenant URL.',
  ).toBeTruthy();
  return tenantUrl;
}

function buildApiUrl(baseUrl, pathName) {
  return new URL(pathName, baseUrl).toString();
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
    deviceName: 'playwright-otp-auth-admin',
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
  const fieldLocator = () => page.getByLabel(label).first();
  const visibleTimeoutMs = Math.max(1000, Math.floor(appBootTimeoutMs / 3));

  async function resolveStableField() {
    let lastError = null;

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const field = fieldLocator();
      try {
        await field.scrollIntoViewIfNeeded({ timeout: visibleTimeoutMs });
        await expect(field).toBeVisible({ timeout: visibleTimeoutMs });
        return field;
      } catch (error) {
        const message = String(error?.message ?? error ?? '');
        if (!message.includes('not attached to the DOM')) {
          throw error;
        }
        lastError = error;
        await page.waitForTimeout(150);
      }
    }

    throw lastError ?? new Error(`Flutter text field "${label}" did not stabilize in the DOM.`);
  }

  let lastValue = '';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const field = await resolveStableField();
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
              return await fieldLocator().inputValue();
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
        lastValue = await fieldLocator().inputValue();
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

async function expectFlutterTextFieldValue(page, label, value) {
  const field = page.getByLabel(label).first();
  await expect(field).toBeVisible({ timeout: appBootTimeoutMs });
  await expect
    .poll(
      async () => {
        try {
          return await page.getByLabel(label).first().inputValue();
        } catch (_) {
          return '';
        }
      },
      {
        timeout: appBootTimeoutMs,
        message: `Expected Flutter text field "${label}" to reflect persisted modal state.`,
      },
    )
    .toBe(value);
}

async function enableSecondarySmsFallback(page) {
  const smsUrlButton = page.getByRole('button', { name: /Editar URL SMS/i });
  const smsSwitch = page
    .getByRole('switch', { name: /Secondary OTP Channel com SMS/i })
    .first();

  await expect(smsSwitch).toBeVisible({ timeout: appBootTimeoutMs });
  await smsSwitch.scrollIntoViewIfNeeded({ timeout: appBootTimeoutMs });
  await smsSwitch.click({ timeout: appBootTimeoutMs });
  await expect(smsUrlButton).toBeVisible({ timeout: appBootTimeoutMs });
}

function outboundSettingsPayload({
  whatsappWebhookUrl = 'https://webhooks.example.test/whatsapp',
  smsWebhookUrl = null,
} = {}) {
  return {
    data: {
      outbound_integrations: {
        whatsapp: {
          webhook_url: whatsappWebhookUrl,
        },
        otp: {
          webhook_url: smsWebhookUrl,
          use_whatsapp_webhook: true,
          delivery_channel: 'whatsapp',
          ttl_minutes: 10,
          resend_cooldown_seconds: 60,
          max_attempts: 5,
        },
      },
    },
  };
}

async function installOutboundSettingsRoutes(page, capturedPatches) {
  await page.route('**/admin/api/v1/settings/values', async (route) => {
    if (route.request().method().toUpperCase() !== 'GET') {
      await route.fallback();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(outboundSettingsPayload()),
    });
  });

  await page.route(
    '**/admin/api/v1/settings/values/outbound_integrations',
    async (route) => {
      if (route.request().method().toUpperCase() !== 'PATCH') {
        await route.fallback();
        return;
      }

      const payload = route.request().postDataJSON();
      capturedPatches.push(payload);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          outboundSettingsPayload({
            whatsappWebhookUrl: payload['whatsapp.webhook_url'],
            smsWebhookUrl: payload['otp.webhook_url'],
          }),
        ),
      });
    },
  );
}

test('@mutation OTP Auth admin exposes WhatsApp primary and optional SMS fallback without legacy controls', async ({
  browser,
}) => {
  const baseUrl = requireTenantUrl();
  const whatsappWebhookUrl =
    'https://n8ntech.unifast.com.br/webhook/otp?channel=whatsapp';
  const smsWebhookUrl =
    'https://n8ntech.unifast.com.br/webhook/otp?channel=sms';
  const api = await createApiContext(baseUrl);
  let browserContext;

  try {
    const session = await loginTenantAdmin(api, baseUrl);
    const pageBundle = await createAuthenticatedTenantAdminPage(
      browser,
      session,
    );
    browserContext = pageBundle.context;
    const page = pageBundle.page;
    const capturedPatches = [];

    await installOutboundSettingsRoutes(page, capturedPatches);

    await page.goto(buildApiUrl(baseUrl, '/admin/settings/technical-integrations'), {
      waitUntil: 'domcontentloaded',
    });
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);

    await expect(
      page.getByRole('button', { name: /Editar Webhook WhatsApp/i }),
    ).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    await expect(
      page.getByRole('switch', { name: /Secondary OTP Channel com SMS/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Editar Webhook OTP/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('switch', { name: /Usar webhook WhatsApp para OTP/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /Editar Canal OTP/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /Editar URL SMS/i }),
    ).toHaveCount(0);

    await page
      .getByRole('button', { name: /Editar Webhook WhatsApp/i })
      .first()
      .click();
    await fillFlutterTextField(page, 'Webhook WhatsApp', whatsappWebhookUrl);
    await page.getByRole('button', { name: 'Aplicar' }).last().click();
    await page
      .getByRole('button', { name: /Editar Webhook WhatsApp/i })
      .first()
      .click();
    await expectFlutterTextFieldValue(page, 'Webhook WhatsApp', whatsappWebhookUrl);
    await page.getByRole('button', { name: 'Aplicar' }).last().click();

    await enableSecondarySmsFallback(page);
    await expect(
      page.getByRole('button', { name: /Editar URL SMS/i }),
    ).toBeVisible({
      timeout: appBootTimeoutMs,
    });

    await page
      .getByRole('button', { name: /Editar URL SMS/i })
      .first()
      .click();
    await fillFlutterTextField(page, 'URL SMS', smsWebhookUrl);
    await page.getByRole('button', { name: 'Aplicar' }).last().click();
    await page
      .getByRole('button', { name: /Editar URL SMS/i })
      .first()
      .click();
    await expectFlutterTextFieldValue(page, 'URL SMS', smsWebhookUrl);
    await page.getByRole('button', { name: 'Aplicar' }).last().click();

    await page.getByRole('button', { name: /Salvar Webhooks/i }).click();

    await expect
      .poll(() => capturedPatches.length, {
        timeout: appBootTimeoutMs,
        message: 'Expected outbound integrations PATCH payload.',
      })
      .toBe(1);

    expect(capturedPatches[0]['whatsapp.webhook_url']).toBe(whatsappWebhookUrl);
    expect(capturedPatches[0]['otp.webhook_url']).toBe(smsWebhookUrl);
    expect(capturedPatches[0]['otp.use_whatsapp_webhook']).toBe(true);
    expect(capturedPatches[0]['otp.delivery_channel']).toBe('whatsapp');
    expect(capturedPatches[0]['otp.ttl_minutes']).toBe(10);
    expect(capturedPatches[0]['otp.resend_cooldown_seconds']).toBe(60);
    expect(capturedPatches[0]['otp.max_attempts']).toBe(5);
  } finally {
    await browserContext?.close();
    await api.dispose();
  }
});
