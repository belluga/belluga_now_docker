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

  await expect(page.getByText(/fica melhor no app/i)).toBeVisible({
    timeout: appBootTimeoutMs,
  });
  await expect(
    page.getByText('Continue no app para destravar as ações e a experiência completa.'),
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

async function clickDiscoveryFavoriteForProfile(page, profileName) {
  const cards = await page
    .getByRole('button', { name: new RegExp(`Abrir perfil ${profileName}`, 'i') })
    .all();

  let cardBox = null;
  for (const card of cards) {
    const box = await card.boundingBox();
    if (!box) {
      continue;
    }
    if (box.width >= 120 && box.x >= 0 && box.x < 430 && box.y >= 250) {
      cardBox = box;
      break;
    }
  }

  expect(cardBox, `Expected visible discovery card for ${profileName}.`).toBeTruthy();

  const buttons = await page.getByRole('button').all();
  for (const button of buttons) {
    const box = await button.boundingBox();
    if (!box) {
      continue;
    }
    const horizontallyInsideFavoriteSlot =
      box.x >= cardBox.x + cardBox.width - 58 &&
      box.x <= cardBox.x + cardBox.width - 6;
    const verticallyInsideFavoriteSlot =
      box.y >= cardBox.y && box.y <= cardBox.y + 70;
    if (horizontallyInsideFavoriteSlot && verticallyInsideFavoriteSlot) {
      await button.click({ timeout: appBootTimeoutMs });
      return;
    }
  }

  throw new Error(`Could not locate favorite button for ${profileName}.`);
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
  await clickDiscoveryFavoriteForProfile(page, 'QA Discovery Tag Longa');
  await expectFavoritePromotionModal(page, promotionSignals);
});
