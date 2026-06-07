const { test, expect } = require('@playwright/test');

const tenantUrl = process.env.NAV_TENANT_URL;
const appBootTimeoutMs = 90000;

test.describe.configure({ timeout: 300000 });

function requireTenantUrl() {
  expect(
    tenantUrl,
    'Missing NAV_TENANT_URL. Favorite auth gate readonly runtime proof requires a live tenant URL.',
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
  const onRequest = (request) => {
    const url = request.url();
    if (url.includes('/open-app')) {
      openAppUrls.push(url);
    }
  };
  const popupListeners = new Map();
  const onPopup = (popup) => {
    popupUrls.push(popup.url());
    const onFrameNavigated = (frame) => {
      if (frame === popup.mainFrame()) {
        popupUrls.push(frame.url());
      }
    };
    popupListeners.set(popup, onFrameNavigated);
    popup.on('framenavigated', onFrameNavigated);
  };

  page.on('request', onRequest);
  page.on('popup', onPopup);

  return {
    snapshot: () => ({ openAppUrls: [...openAppUrls], popupUrls: [...popupUrls] }),
    dispose: () => {
      page.off('request', onRequest);
      page.off('popup', onPopup);
      for (const [popup, listener] of popupListeners.entries()) {
        popup.off('framenavigated', listener);
      }
      popupListeners.clear();
    },
  };
}

function snapshotUnexpectedPromotionHandoff(page, promotionSignals) {
  const signals = promotionSignals.snapshot();
  return {
    currentUrl: page.url(),
    openAppUrls: signals.openAppUrls.filter(Boolean),
    popupUrls: signals.popupUrls.filter(Boolean),
  };
}

function hasUnexpectedPromotionHandoff(snapshot) {
  return (
    snapshot.currentUrl.includes('/open-app') ||
    snapshot.currentUrl.includes('/baixe-o-app') ||
    snapshot.currentUrl.includes('/auth/login') ||
    snapshot.openAppUrls.length > 0 ||
    snapshot.popupUrls.length > 0
  );
}

async function expectNoPromotionHandoffForWindow(
  page,
  promotionSignals,
  label,
  timeoutMs = 1500,
) {
  await expect
    .poll(
      () => hasUnexpectedPromotionHandoff(
        snapshotUnexpectedPromotionHandoff(page, promotionSignals),
      ),
      {
        timeout: timeoutMs,
        message: label,
      },
    )
    .toBe(false);
}

function attachFavoriteMutationCapture(page) {
  const urls = [];
  const onRequest = (request) => {
    const method = request.method().toUpperCase();
    if (method !== 'POST' && method !== 'DELETE' && method !== 'PATCH') {
      return;
    }
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/v1/favorites') {
      urls.push(`${method} ${pathname}`);
    }
  };

  page.on('request', onRequest);
  return {
    snapshot: () => [...urls],
    dispose: () => {
      page.off('request', onRequest);
    },
  };
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
  const appPreparingHeading = page.getByText('App em preparação');
  const singleStoreHeading = page.getByText('Baixe para continuar');
  const multiStoreHeading = page.getByText('Escolha sua loja');
  const runtimeStoreStateVisible =
    (await appPreparingHeading.count()) > 0 ||
    (await singleStoreHeading.count()) > 0 ||
    (await multiStoreHeading.count()) > 0;
  expect(
    runtimeStoreStateVisible,
    'Promotion modal must render the canonical current store/publication state.',
  ).toBeTruthy();
  if ((await appPreparingHeading.count()) > 0) {
    await expect(appPreparingHeading).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    await expect(
      page.getByText('A publicação nas lojas ainda não está ativa.'),
    ).toBeVisible({
      timeout: appBootTimeoutMs,
    });
  } else if ((await singleStoreHeading.count()) > 0) {
    await expect(singleStoreHeading).toBeVisible({
      timeout: appBootTimeoutMs,
    });
  } else {
    await expect(multiStoreHeading).toBeVisible({
      timeout: appBootTimeoutMs,
    });
  }
  await expect(page.getByRole('button', { name: /^Agora não$/i })).toBeVisible({
    timeout: appBootTimeoutMs,
  });

  await expectNoPromotionHandoffForWindow(
    page,
    promotionSignals,
    'Favorite gate must keep the promotion modal stable without redirecting, opening popups, or handing off before confirmation.',
  );

  await page.getByRole('button', { name: /^Agora não$/i }).click();
  await expect(page.getByText(/Escolha seus favoritos pelo app/i)).toHaveCount(0, {
    timeout: appBootTimeoutMs,
  });
  await expectNoPromotionHandoffForWindow(
    page,
    promotionSignals,
    'Favorite gate must remain on the current web flow after dismissing the promotion modal.',
  );
}

function expectNoFavoriteMutations(favoriteMutations, label) {
  expect(
    favoriteMutations.snapshot(),
    label,
  ).toEqual([]);
}

async function expectNoFavoriteMutationsForWindow(
  favoriteMutations,
  label,
  timeoutMs = 1500,
) {
  await expect
    .poll(
      () => favoriteMutations.snapshot(),
      {
        timeout: timeoutMs,
        message: label,
      },
    )
    .toEqual([]);
}

async function clickBackAffordance(page) {
  const namedBack = page.getByRole('button', { name: /voltar|back/i }).first();
  if (await namedBack.isVisible().catch(() => false)) {
    await namedBack.click({ timeout: appBootTimeoutMs });
    return;
  }

  const semanticBack = page.locator('[aria-label*="Voltar"], [aria-label*="Back"]').first();
  if (await semanticBack.isVisible().catch(() => false)) {
    await semanticBack.click({ timeout: appBootTimeoutMs });
    return;
  }

  const buttons = page.getByRole('button');
  const topLeftIndex = await buttons.evaluateAll((nodes) =>
    nodes.findIndex((node) => {
      if (!(node instanceof HTMLElement)) {
        return false;
      }
      const style = window.getComputedStyle(node);
      if (style.visibility === 'hidden' || style.display === 'none') {
        return false;
      }
      const rect = node.getBoundingClientRect();
      return rect.width >= 32
        && rect.height >= 32
        && rect.top >= 0
        && rect.left >= 0
        && rect.top <= 120
        && rect.left <= 120;
    }),
  );
  if (topLeftIndex >= 0) {
    const topLeftButton = buttons.nth(topLeftIndex);
    await expect(topLeftButton).toBeVisible({ timeout: appBootTimeoutMs });
    await topLeftButton.click({ timeout: appBootTimeoutMs });
    return;
  }

  const beforeUrl = page.url();
  await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await expect
    .poll(
      () => page.url(),
      {
        timeout: 5000,
        message: 'Browser history fallback must navigate away from the account detail route.',
      },
    )
    .not.toBe(beforeUrl);
}

async function clickAccountHeroFavorite(page) {
  const heroFavorite = page.getByRole('button', {
    name: /^Favoritar perfil$/i,
  });
  await expect(heroFavorite).toBeVisible({ timeout: appBootTimeoutMs });
  await heroFavorite.click({ timeout: appBootTimeoutMs });
}

async function isDocumentFollower(referenceLocator, candidateLocator) {
  const referenceHandle = await referenceLocator.elementHandle();
  const candidateHandle = await candidateLocator.elementHandle();
  if (!referenceHandle || !candidateHandle) {
    await referenceHandle?.dispose().catch(() => {});
    await candidateHandle?.dispose().catch(() => {});
    return false;
  }

  try {
    return await referenceHandle.evaluate(
      (referenceNode, candidateNode) =>
        Boolean(
          referenceNode.compareDocumentPosition(candidateNode)
            & Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      candidateHandle,
    );
  } finally {
    await referenceHandle.dispose().catch(() => {});
    await candidateHandle.dispose().catch(() => {});
  }
}

async function findFirstDiscoveryCardWithFavorite(page) {
  const heading = page.getByText(/^Descubra$/i).first();
  await expect(heading).toBeVisible({
    timeout: appBootTimeoutMs,
  });

  const cards = await page.getByRole('button', { name: /Abrir perfil/i }).all();
  for (const card of cards) {
    if (!(await card.isVisible().catch(() => false))) {
      continue;
    }
    if (!(await isDocumentFollower(heading, card))) {
      continue;
    }

    const favoriteButton = card.getByRole('button', {
      name: /Favoritar perfil/i,
    }).first();
    if (!(await favoriteButton.isVisible().catch(() => false))) {
      continue;
    }
    return { card, favoriteButton };
  }

  throw new Error(
    'Could not locate a discovery card with a nested favorite action after the Descubra heading.',
  );
}

async function openFirstDiscoveryCardDetail(page) {
  const { card } = await findFirstDiscoveryCardWithFavorite(page);
  await card.click({ timeout: appBootTimeoutMs });
  await expect(page).toHaveURL(/\/parceiro\//, { timeout: appBootTimeoutMs });
}

async function clickFirstDiscoveryFavorite(page) {
  const { favoriteButton } = await findFirstDiscoveryCardWithFavorite(page);
  await favoriteButton.click({ timeout: appBootTimeoutMs });
}

test('@readonly FAV-GATE-RUNTIME web anonymous account and discovery favorite actions show app promotion modal', async ({
  page,
}) => {
  const baseUrl = requireTenantUrl();
  await page.setViewportSize({ width: 430, height: 900 });

  await gotoBooted(page, baseUrl, '/descobrir');
  await openFirstDiscoveryCardDetail(page);
  const accountSignals = attachPromotionSignalCapture(page);
  const accountFavoriteMutations = attachFavoriteMutationCapture(page);
  try {
    await clickAccountHeroFavorite(page);
    await expectNoFavoriteMutationsForWindow(
      accountFavoriteMutations,
      'Anonymous account-profile favorite gate must not emit favorite mutations before the modal opens.',
    );
    await expectFavoritePromotionModal(page, accountSignals);
    await expectNoFavoriteMutationsForWindow(
      accountFavoriteMutations,
      'Anonymous account-profile favorite gate must not emit favorite mutations after dismissing the modal.',
    );
  } finally {
    accountSignals.dispose();
    accountFavoriteMutations.dispose();
  }

  await clickBackAffordance(page);
  await expect(page).toHaveURL(/\/descobrir(?:[/?#]|$)/, {
    timeout: appBootTimeoutMs,
  });
  const discoverySignals = attachPromotionSignalCapture(page);
  const discoveryFavoriteMutations = attachFavoriteMutationCapture(page);
  try {
    await clickFirstDiscoveryFavorite(page);
    await expectNoFavoriteMutationsForWindow(
      discoveryFavoriteMutations,
      'Anonymous discovery favorite gate must not emit favorite mutations before the modal opens.',
    );
    await expect(page).toHaveURL(new RegExp('/descobrir(?:[/?#]|$)'), {
      timeout: appBootTimeoutMs,
    });
    await expectFavoritePromotionModal(page, discoverySignals);
    await expectNoFavoriteMutationsForWindow(
      discoveryFavoriteMutations,
      'Anonymous discovery favorite gate must not emit favorite mutations after dismissing the modal.',
    );
  } finally {
    discoverySignals.dispose();
    discoveryFavoriteMutations.dispose();
  }
});
