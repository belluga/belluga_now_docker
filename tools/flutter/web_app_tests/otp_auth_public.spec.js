const { test, expect } = require('@playwright/test');

const tenantUrl = process.env.NAV_TENANT_URL;
const appBootTimeoutMs = 90000;

test.describe.configure({ timeout: 300000 });

function requireTenantUrl() {
  expect(
    tenantUrl,
    'Missing NAV_TENANT_URL. OTP public mutation suite requires a live tenant URL.',
  ).toBeTruthy();
  return tenantUrl;
}

function buildApiUrl(baseUrl, pathName) {
  return new URL(pathName, baseUrl).toString();
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

async function installSmsEnabledEnvironmentRoute(page) {
  await page.route('**/api/v1/environment**', async (route) => {
    const response = await route.fetch();
    const headers = response.headers();
    const bodyText = await response.text();
    let payload;

    try {
      payload = JSON.parse(bodyText);
    } catch (_) {
      await route.fulfill({
        status: response.status(),
        headers,
        body: bodyText,
      });
      return;
    }

    const data = payload && typeof payload.data === 'object' ? payload.data : payload;
    data.settings = {
      ...(data.settings || {}),
      outbound_integrations: {
        ...((data.settings || {}).outbound_integrations || {}),
        whatsapp: {
          ...(((data.settings || {}).outbound_integrations || {}).whatsapp ||
            {}),
          webhook_url:
            'https://n8ntech.unifast.com.br/webhook/otp?channel=whatsapp',
        },
        otp: {
          ...(((data.settings || {}).outbound_integrations || {}).otp || {}),
          webhook_url: 'https://n8ntech.unifast.com.br/webhook/otp?channel=sms',
          use_whatsapp_webhook: true,
          delivery_channel: 'whatsapp',
          ttl_minutes: 10,
          resend_cooldown_seconds: 60,
          max_attempts: 5,
        },
      },
    };

    await route.fulfill({
      status: response.status(),
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  });
}

async function installOtpChallengeRoute(page, capturedChallenges) {
  await page.route('**/api/v1/auth/otp/challenge**', async (route) => {
    const payload = route.request().postDataJSON();
    capturedChallenges.push(payload);
    const channel = payload.delivery_channel || 'whatsapp';

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          challenge_id: `playwright-otp-${capturedChallenges.length}`,
          phone: payload.phone,
          delivery: {
            channel,
          },
          expires_at: '2026-04-29T23:59:59Z',
          resend_available_at: '2026-04-29T23:50:59Z',
        },
      }),
    });
  });
}

test('@readonly OTP-WEB-BOUNDARY-01 tenant-public web auth remains app promotion boundary', async ({
  page,
}) => {
  const baseUrl = requireTenantUrl();

  await page.goto(buildApiUrl(baseUrl, '/auth/login'), {
    waitUntil: 'domcontentloaded',
  });
  await assertAppBooted(page);
  await enableAccessibilityIfNeeded(page);

  await expect(
    page.getByText(/Baixe para continuar|Escolha sua loja|Bora testar/i),
  ).toBeVisible({ timeout: appBootTimeoutMs });
  await expect(page.getByText('Entrar com telefone')).toHaveCount(0);
  await expect(page.getByLabel('Telefone')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /Continuar via WhatsApp/i }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /Confirmar codigo/i }),
  ).toHaveCount(0);
});

test('@mutation OTP Auth public requests WhatsApp by default and SMS fallback with segmented code UI', async ({
  page,
}) => {
  const baseUrl = requireTenantUrl();
  const capturedChallenges = [];

  await installSmsEnabledEnvironmentRoute(page);
  await installOtpChallengeRoute(page, capturedChallenges);

  await page.goto(buildApiUrl(baseUrl, '/auth/login'), {
    waitUntil: 'domcontentloaded',
  });
  await assertAppBooted(page);
  await enableAccessibilityIfNeeded(page);

  await expect(page.getByText('Entrar com telefone')).toBeVisible({
    timeout: appBootTimeoutMs,
  });
  await expect(page.getByLabel(/E-mail/i)).toHaveCount(0);
  await expect(page.getByLabel(/Senha/i)).toHaveCount(0);
  await fillFlutterTextField(page, 'Telefone', '27999990000');

  await page.getByRole('button', { name: /Continuar via WhatsApp/i }).click();
  await expect
    .poll(() => capturedChallenges.length, {
      timeout: appBootTimeoutMs,
      message: 'Expected WhatsApp OTP challenge request.',
    })
    .toBe(1);

  expect(capturedChallenges[0].phone).toBe('+5527999990000');
  expect(capturedChallenges[0].delivery_channel).toBe('whatsapp');
  await expect(page.getByText('Codigo enviado por WhatsApp')).toBeVisible({
    timeout: appBootTimeoutMs,
  });
  await expect(page.getByRole('button', { name: /Confirmar codigo/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Outras formas/i })).toBeVisible();
  await expect(page.getByText('Receber por SMS')).toHaveCount(0);

  await page.getByRole('button', { name: /Outras formas/i }).click();
  await expect(page.getByText('Receber por SMS')).toBeVisible();
  await page.getByText('Receber por SMS').click();
  await expect
    .poll(() => capturedChallenges.length, {
      timeout: appBootTimeoutMs,
      message: 'Expected SMS OTP fallback challenge request.',
    })
    .toBe(2);

  expect(capturedChallenges[1].phone).toBe('+5527999990000');
  expect(capturedChallenges[1].delivery_channel).toBe('sms');
  await expect(page.getByText('Codigo enviado por SMS')).toBeVisible({
    timeout: appBootTimeoutMs,
  });
});
