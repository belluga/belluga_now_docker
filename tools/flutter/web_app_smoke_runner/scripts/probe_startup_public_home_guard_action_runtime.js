#!/usr/bin/env node

const { chromium } = require('playwright');

const APP_BOOT_TIMEOUT_MS = 120000;
const STARTUP_SETTLE_MS = 4000;
const GUARD_ACTION_SETTLE_MS = 1000;

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function buildUrl(baseUrl, pathName) {
  return new URL(pathName, baseUrl).toString();
}

async function assertAppBooted(page) {
  const deadline = Date.now() + APP_BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const glassPaneCount = await page.locator('flt-glass-pane').count();
    const splashCount = await page.locator('#splash-screen').count();
    if (glassPaneCount === 1 && splashCount === 0) {
      return;
    }
    await page.waitForTimeout(300);
  }
  throw new Error('App did not finish booting before timeout.');
}

async function enableAccessibilityIfNeeded(page) {
  const placeholder = page
    .locator('flt-semantics-placeholder[aria-label="Enable accessibility"]')
    .first();
  const button = page.getByRole('button', {
    name: /Enable accessibility/i,
  });

  for (let attempt = 0; attempt < 40; attempt += 1) {
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
    } else if ((await button.count()) > 0) {
      await button.first().click();
      await page.waitForTimeout(300);
      if ((await page.getByRole('button').count()) > 1) {
        return;
      }
    }

    await page.waitForTimeout(200);
  }
}

async function waitForTenantPath(page, allowedPrefixes) {
  const deadline = Date.now() + APP_BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const currentUrl = new URL(page.url());
    const { pathname, hash } = currentUrl;
    const pathMatches = allowedPrefixes.some((prefix) =>
      prefix === '/' ? pathname === '/' : pathname.startsWith(prefix),
    );
    const hashMatches = allowedPrefixes.some((prefix) =>
      prefix === '/'
        ? hash === '#' || hash === '#/'
        : hash.startsWith(`#${prefix}`),
    );
    if (pathMatches || hashMatches) {
      return;
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`Tenant path did not match ${allowedPrefixes.join(', ')}.`);
}

function currentPathIndicatesPromotion(url) {
  return (
    url.includes('/open-app') ||
    url.includes('/baixe-o-app') ||
    url.includes('/auth/login')
  );
}

function attachStartupCapture(page) {
  const anonymousIdentityResponses = [];
  const requestTimeline = [];
  const protectedReadResponses = [];
  const protectedReadFailures = [];
  const openAppUrls = [];
  const popupUrls = [];
  const consoleErrors = [];
  const pageErrors = [];
  const responseTimeline = [];
  const eventTimeline = [];
  let timelineSequence = 0;

  const protectedReadPrefixes = [
    '/api/v1/agenda',
    '/api/v1/map/filters',
    '/api/v1/map/pois',
    '/api/v1/invites/settings',
    '/api/v1/invites',
  ];

  const matchedProtectedRead = (url) => {
    const pathname = new URL(url).pathname;
    return protectedReadPrefixes.includes(pathname) ? pathname : null;
  };

  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/open-app')) {
      openAppUrls.push(url);
    }

    if (url.includes('/api/v1/anonymous/identities')) {
      const seq = timelineSequence += 1;
      const entry = {
        seq,
        kind: 'anonymous_identity',
        url,
      };
      requestTimeline.push(entry);
      eventTimeline.push({
        ...entry,
        phase: 'request',
      });
      return;
    }

    const protectedRead = matchedProtectedRead(url);
    if (!protectedRead) {
      return;
    }

    const seq = timelineSequence += 1;
    const entry = {
      seq,
      kind: 'protected_read',
      label: protectedRead,
      url,
    };
    requestTimeline.push(entry);
    eventTimeline.push({
      ...entry,
      phase: 'request',
    });

  });

  page.on('response', (response) => {
    const url = response.url();
    const seq = timelineSequence += 1;
    if (url.includes('/api/v1/anonymous/identities')) {
      const entry = {
        seq,
        status: response.status(),
        url,
      };
      anonymousIdentityResponses.push(entry);
      responseTimeline.push({
        ...entry,
        kind: 'anonymous_identity',
      });
      eventTimeline.push({
        ...entry,
        phase: 'response',
        kind: 'anonymous_identity',
      });
      return;
    }

    const protectedRead = matchedProtectedRead(url);
    if (!protectedRead) {
      return;
    }

    const entry = {
      seq,
      kind: 'protected_read',
      label: protectedRead,
      status: response.status(),
      url,
    };
    protectedReadResponses.push(entry);
    responseTimeline.push(entry);
    eventTimeline.push({
      ...entry,
      phase: 'response',
    });
    if (response.status() >= 400) {
      protectedReadFailures.push(`${response.status()} ${url}`);
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

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  page.on('pageerror', (error) => {
    pageErrors.push(String(error));
  });

  return {
    snapshot: () => ({
      anonymousIdentityResponses: [...anonymousIdentityResponses],
      requestTimeline: [...requestTimeline],
      protectedReadResponses: [...protectedReadResponses],
      protectedReadFailures: [...protectedReadFailures],
      openAppUrls: [...openAppUrls],
      popupUrls: [...popupUrls],
      consoleErrors: [...consoleErrors],
      pageErrors: [...pageErrors],
      responseTimeline: [...responseTimeline],
      eventTimeline: [...eventTimeline],
    }),
  };
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
    snapshot: () => ({
      openAppUrls: [...openAppUrls],
      popupUrls: [...popupUrls],
      currentUrl: page.url(),
    }),
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

async function findFirstDiscoveryCardWithFavorite(page) {
  await page.getByText(/^Descubra$/i).first().waitFor({
    state: 'visible',
    timeout: APP_BOOT_TIMEOUT_MS,
  });

  const cards = await page.getByRole('button', { name: /Abrir perfil/i }).all();
  for (const card of cards) {
    if (!(await card.isVisible().catch(() => false))) {
      continue;
    }

    const favoriteButton = card.getByRole('button', {
      name: /Favoritar perfil|Perfil favoritado/i,
    }).first();
    if (!(await favoriteButton.isVisible().catch(() => false))) {
      continue;
    }
    return favoriteButton;
  }

  throw new Error(
    'Could not locate a visible discovery card with a nested favorite action.',
  );
}

async function run() {
  const baseUrl = requireEnv('NAV_TENANT_URL');
  const executablePath =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/google-chrome';

  const browser = await chromium.launch({
    headless: true,
    executablePath,
  });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 430, height: 900 },
  });
  const page = await context.newPage();

  const startupCapture = attachStartupCapture(page);

  try {
    const response = await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    if (!response || response.status() >= 400) {
      throw new Error(
        `Tenant bootstrap failed: ${response ? response.status() : 'no response'}`,
      );
    }

    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);
    await waitForTenantPath(page, ['/']);
    await page.waitForTimeout(STARTUP_SETTLE_MS);

    const homeSnapshot = startupCapture.snapshot();
    const homeFinalUrl = page.url();
    const buildSha = await page.evaluate(() => window.__WEB_BUILD_SHA__ ?? null);
    const mainScriptSrc = await page.evaluate(() => {
      const script = [...document.scripts].find((entry) =>
        entry.src.includes('main.dart.js'),
      );
      return script?.src ?? null;
    });
    const bootstrapScriptSrc = await page.evaluate(() => {
      const script = [...document.scripts].find((entry) =>
        entry.src.includes('flutter_bootstrap.js'),
      );
      return script?.src ?? null;
    });

    const agendaVisible = await page
      .getByText(/^Agenda$/i)
      .first()
      .isVisible()
      .catch(() => false);
    const promotionTextCount = await page
      .getByText(/fica melhor no app|continue no app|baixe para continuar|escolha sua loja|app em preparação/i)
      .count();

    const discoveryUrl = buildUrl(baseUrl, '/descobrir');
    const discoveryResponse = await page.goto(discoveryUrl, {
      waitUntil: 'domcontentloaded',
    });
    if (!discoveryResponse || discoveryResponse.status() >= 400) {
      throw new Error(
        `Discovery bootstrap failed: ${discoveryResponse ? discoveryResponse.status() : 'no response'}`,
      );
    }

    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);
    await page.waitForTimeout(GUARD_ACTION_SETTLE_MS);

    const promotionSignals = attachPromotionSignalCapture(page);
    const favoriteMutations = attachFavoriteMutationCapture(page);
    let promotionHeadlineVisible = false;
    try {
      const favoriteButton = await findFirstDiscoveryCardWithFavorite(page);
      await favoriteButton.click({ timeout: APP_BOOT_TIMEOUT_MS });
      await page.waitForTimeout(GUARD_ACTION_SETTLE_MS);
      promotionHeadlineVisible = await page
        .getByText(/Escolha seus favoritos pelo app/i)
        .isVisible()
        .catch(() => false);
    } finally {
      const guardActionSnapshot = promotionSignals.snapshot();
      const favoriteMutationSnapshot = favoriteMutations.snapshot();
      promotionSignals.dispose();
      favoriteMutations.dispose();

      const result = {
        buildSha,
        mainScriptSrc,
        bootstrapScriptSrc,
        home: {
          finalUrl: homeFinalUrl,
          anonymousIdentityResponses: homeSnapshot.anonymousIdentityResponses,
          requestTimeline: homeSnapshot.requestTimeline,
          protectedReadResponses: homeSnapshot.protectedReadResponses,
          protectedReadFailures: homeSnapshot.protectedReadFailures,
          openAppUrls: homeSnapshot.openAppUrls,
          popupUrls: homeSnapshot.popupUrls,
          consoleErrors: homeSnapshot.consoleErrors.filter(
            (entry) => !entry.includes('status of 401'),
          ),
          pageErrors: homeSnapshot.pageErrors,
          agendaVisible,
          promotionTextCount,
        },
        guardedAction: {
          currentUrl: page.url(),
          promotionHeadlineVisible,
          openAppUrls: guardActionSnapshot.openAppUrls,
          popupUrls: guardActionSnapshot.popupUrls,
          favoriteMutations: favoriteMutationSnapshot,
        },
      };

      console.log(JSON.stringify(result, null, 2));

      const homeHealthy =
        homeSnapshot.anonymousIdentityResponses.length > 0 &&
        homeSnapshot.anonymousIdentityResponses.every(
          (entry) => entry.status === 200 || entry.status === 201,
        ) &&
        homeSnapshot.requestTimeline.filter(
          (entry) =>
            entry.kind === 'protected_read'
            && entry.seq
              < (homeSnapshot.anonymousIdentityResponses.find(
                (candidate) => candidate.status === 200 || candidate.status === 201,
              )?.seq ?? Number.POSITIVE_INFINITY),
        ).length === 0 &&
        homeSnapshot.protectedReadResponses.some(
          (entry) => entry.label === '/api/v1/agenda' && entry.status >= 200 && entry.status < 400,
        ) &&
        homeSnapshot.protectedReadFailures.length === 0 &&
        homeSnapshot.openAppUrls.length === 0 &&
        homeSnapshot.popupUrls.length === 0 &&
        homeSnapshot.pageErrors.length === 0 &&
        homeSnapshot.consoleErrors.filter(
          (entry) => !entry.includes('status of 401'),
        ).length === 0 &&
        !currentPathIndicatesPromotion(homeFinalUrl) &&
        agendaVisible &&
        promotionTextCount === 0;

      const guardActionHealthy =
        promotionHeadlineVisible &&
        favoriteMutationSnapshot.length === 0 &&
        guardActionSnapshot.openAppUrls.length === 0 &&
        guardActionSnapshot.popupUrls.length === 0 &&
        /\/descobrir(?:[/?#]|$)/.test(guardActionSnapshot.currentUrl);

      if (!homeHealthy || !guardActionHealthy) {
        process.exitCode = 1;
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
