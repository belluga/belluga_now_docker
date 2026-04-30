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
