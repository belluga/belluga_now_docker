const { test, expect } = require('@playwright/test');

const tenantUrl = process.env.NAV_TENANT_URL;
const appBootTimeoutMs = 90000;

test.describe.configure({ timeout: 300000 });

function requireTenantUrl() {
  expect(
    tenantUrl,
    'Missing NAV_TENANT_URL. Favorite auth gate runtime diagnostics require a live tenant URL.',
  ).toBeTruthy();
  return tenantUrl;
}

function buildUrl(baseUrl, pathName) {
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

async function gotoBooted(page, baseUrl, pathName) {
  const response = await page.goto(buildUrl(baseUrl, pathName), {
    waitUntil: 'domcontentloaded',
    timeout: appBootTimeoutMs,
  });
  expect(response, `Response should be available for ${pathName}`).not.toBeNull();
  expect(response.status(), `Response should be successful for ${pathName}`).toBeLessThan(400);
  await assertAppBooted(page);
  await enableAccessibilityIfNeeded(page);
  await page.waitForTimeout(1000);
}

function attachPromotionSignalCapture(page) {
  const openAppUrls = [];
  const popupUrls = [];

  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/open-app')) {
      openAppUrls.push(url);
    }
  });

  page.on('popup', (popup) => {
    popupUrls.push(popup.url());
    popup.on('framenavigated', (frame) => {
      if (frame === popup.mainFrame()) {
        popupUrls.push(frame.url());
      }
    });
  });

  return () => ({ openAppUrls, popupUrls });
}

async function expectFavoritePromotionModal(page, promotionSignals) {
  await expect(page.getByText('Entrar para favoritar')).toHaveCount(0, {
    timeout: appBootTimeoutMs,
  });

  await expect(page.getByText(/Escolha seus favoritos pelo app/i)).toBeVisible({
    timeout: appBootTimeoutMs,
  });
  await expect(
    page.getByText('Use o app para salvar perfis favoritos e receber novidades.'),
  ).toBeVisible({
    timeout: appBootTimeoutMs,
  });
  await expect(page.getByRole('button', { name: /^Agora não$/i })).toBeVisible({
    timeout: appBootTimeoutMs,
  });

  await page.waitForTimeout(500);
  const currentUrl = page.url();
  const signals = promotionSignals();
  const openedAppImmediately =
    currentUrl.includes('/open-app') ||
    signals.openAppUrls.some((url) => url.includes('/open-app')) ||
    signals.popupUrls.some((url) => url.includes('/open-app'));

  expect(
    openedAppImmediately,
    'Favorite gate must not open the app before the user confirms in the modal.',
  ).toBeFalsy();
  expect(currentUrl).not.toContain('/baixe-o-app');
  expect(currentUrl).not.toContain('/auth/login');
}

async function clickVisibleButtonByName(page, namePattern, description) {
  const locator = page.getByRole('button', { name: namePattern }).first();
  await expect(locator, description).toBeVisible({ timeout: appBootTimeoutMs });
  await locator.click({ timeout: appBootTimeoutMs });
}

async function clickAccountHeroFavorite(page) {
  const buttons = await page.getByRole('button', { name: /Favoritar/i }).all();
  for (const button of buttons) {
    const box = await button.boundingBox();
    if (!box) {
      continue;
    }
    const isHeroAction =
      box.x >= 330 && box.y >= 0 && box.y <= 110 && box.width >= 32;
    if (!isHeroAction) {
      continue;
    }
    await button.click({ timeout: appBootTimeoutMs });
    return;
  }

  throw new Error('Could not locate the account hero favorite action.');
}

async function clickFirstDiscoveryFavorite(page) {
  await expect(page.getByText(/^Descubra$/i)).toBeVisible({
    timeout: appBootTimeoutMs,
  });

  const namedFavoriteButtons = await page
    .getByRole('button', { name: /Favoritar/i })
    .all();
  for (const button of namedFavoriteButtons) {
    const box = await button.boundingBox();
    if (!box) {
      continue;
    }
    if (box.y >= 320 && box.x >= 100 && box.width >= 32 && box.height >= 32) {
      await button.click({ timeout: appBootTimeoutMs });
      return;
    }
  }

  const buttons = await page.getByRole('button').all();
  for (const button of buttons) {
    const box = await button.boundingBox();
    if (!box) {
      continue;
    }
    const isDiscoveryCardFavorite =
      box.y >= 320 &&
      box.x >= 100 &&
      box.x <= 430 &&
      box.width >= 32 &&
      box.width <= 60 &&
      box.height >= 32 &&
      box.height <= 60;
    if (isDiscoveryCardFavorite) {
      await button.click({ timeout: appBootTimeoutMs });
      return;
    }
  }

  throw new Error('Could not locate a visible discovery favorite action.');
}

test('@readonly @diagnostic FAV-GATE-RUNTIME web anonymous account and discovery favorite actions show app promotion modal', async ({
  page,
}) => {
  const baseUrl = requireTenantUrl();
  await page.setViewportSize({ width: 430, height: 900 });
  const promotionSignals = attachPromotionSignalCapture(page);

  await gotoBooted(page, baseUrl, '/parceiro/qa-discovery-tag-longa');
  await clickAccountHeroFavorite(page);
  await expectFavoritePromotionModal(page, promotionSignals);

  await gotoBooted(page, baseUrl, '/descobrir');
  await clickFirstDiscoveryFavorite(page);
  await expectFavoritePromotionModal(page, promotionSignals);
});
