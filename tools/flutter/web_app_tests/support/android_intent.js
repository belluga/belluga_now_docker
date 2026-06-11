const { expect } = require('@playwright/test');

const androidChromeUserAgent =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

const androidBrowserContextOptions = {
  ignoreHTTPSErrors: true,
  userAgent: androidChromeUserAgent,
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
};

function assertAndroidIntentLocation(location, baseUrl, expectedTargetPath) {
  expect(location, `Expected Android intent redirect for ${expectedTargetPath}`)
    .toBeTruthy();
  expect(location).toContain('intent://');
  expect(location).toContain(';scheme=https;');
  expect(location).toContain(';package=');
  expect(location).toContain(';S.browser_fallback_url=');
  expect(location).toContain(';end');

  const base = new URL(baseUrl);
  const expectedIntentPrefix = `intent://${base.host}${expectedTargetPath}`;
  expect(
    location.startsWith(expectedIntentPrefix),
    `Intent must target the current tenant host. Expected prefix ${expectedIntentPrefix}, got ${location}`,
  ).toBeTruthy();

  const fallbackMatch = location.match(/;S\.browser_fallback_url=([^;]+);end$/);
  expect(fallbackMatch, `Intent must include browser fallback URL: ${location}`)
    .toBeTruthy();
  const fallbackUrl = decodeURIComponent(fallbackMatch[1]);
  const fallback = new URL(fallbackUrl);
  expect(fallback.origin).toBe(base.origin);
  expect(fallback.pathname).toBe('/baixe-o-app');
  expect(fallback.searchParams.get('redirect')).toBe(expectedTargetPath);
}

function assertAndroidPromotionFallbackLocation(location, baseUrl, expectedTargetPath) {
  expect(location, `Expected Android promotion fallback for ${expectedTargetPath}`)
    .toBeTruthy();

  const base = new URL(baseUrl);
  const fallback = new URL(location, base.origin);
  expect(fallback.origin).toBe(base.origin);
  expect(fallback.pathname).toBe('/baixe-o-app');
  expect(fallback.searchParams.get('redirect')).toBe(expectedTargetPath);
}

function assertAndroidTargetFallbackLocation(location, baseUrl, expectedTargetPath) {
  expect(location, `Expected Android target fallback for ${expectedTargetPath}`)
    .toBeTruthy();

  const base = new URL(baseUrl);
  const fallback = new URL(location, base.origin);
  expect(fallback.origin).toBe(base.origin);

  const fallbackTarget = fallback.pathname
    + (fallback.search ? fallback.search : '');
  expect(fallbackTarget).toBe(expectedTargetPath);
}

function assertAndroidOpenAppHandoffLocation(location, baseUrl, expectedTargetPath) {
  if (location.startsWith('intent://')) {
    assertAndroidIntentLocation(location, baseUrl, expectedTargetPath);
    return;
  }

  assertAndroidPromotionFallbackLocation(location, baseUrl, expectedTargetPath);
}

function assertAndroidDirectPublicHandoffLocation(location, baseUrl, expectedTargetPath) {
  if (location.startsWith('intent://')) {
    expect(location, `Expected Android intent redirect for ${expectedTargetPath}`)
      .toBeTruthy();
    expect(location).toContain('intent://');
    expect(location).toContain(';scheme=https;');
    expect(location).toContain(';package=');
    expect(location).toContain(';S.browser_fallback_url=');
    expect(location).toContain(';end');

    const base = new URL(baseUrl);
    const expectedIntentPrefix = `intent://${base.host}${expectedTargetPath}`;
    expect(
      location.startsWith(expectedIntentPrefix),
      `Intent must target the current tenant host. Expected prefix ${expectedIntentPrefix}, got ${location}`,
    ).toBeTruthy();

    const fallbackMatch = location.match(/;S\.browser_fallback_url=([^;]+);end$/);
    expect(fallbackMatch, `Intent must include browser fallback URL: ${location}`)
      .toBeTruthy();
    const fallbackUrl = decodeURIComponent(fallbackMatch[1]);
    assertAndroidTargetFallbackLocation(
      fallbackUrl,
      baseUrl,
      expectedTargetPath,
    );
    return;
  }

  assertAndroidTargetFallbackLocation(location, baseUrl, expectedTargetPath);
}

function androidDirectBrowserFallbackUrl(location, baseUrl) {
  if (location.startsWith('intent://')) {
    const fallbackMatch = location.match(/;S\.browser_fallback_url=([^;]+);end$/);
    expect(fallbackMatch, `Intent must include browser fallback URL: ${location}`)
      .toBeTruthy();
    return decodeURIComponent(fallbackMatch[1]);
  }

  return new URL(location, baseUrl).toString();
}

async function waitForPublicRouteToSettle(page, expectedTargetPath, timeoutMs) {
  await page.waitForFunction(
    (targetPath) => {
      const current = window.location.pathname + window.location.search;
      const hash = window.location.hash || '';
      const atExpectedTarget =
        current === targetPath
        || (
          targetPath === '/'
            ? (hash === '#' || hash === '#/')
            : (
              hash === `#${targetPath}`
              || hash.startsWith(`#${targetPath}?`)
            )
        );
      if (!atExpectedTarget) {
        return false;
      }

      const splashVisible = document.querySelector('#splash-screen') !== null;
      const hasFlutterView = document.querySelector('flutter-view') !== null;
      const hasGlassPane = document.querySelector('flt-glass-pane') !== null;
      const readyState = document.readyState;

      return !splashVisible
        && (hasGlassPane || hasFlutterView)
        && (readyState === 'interactive' || readyState === 'complete');
    },
    expectedTargetPath,
    { timeout: timeoutMs },
  );
}

async function fetchAndroidIntentRedirect(request, baseUrl, params) {
  const endpoint = new URL('/open-app', baseUrl);
  endpoint.searchParams.set('store_channel', 'web');
  endpoint.searchParams.set('platform_target', 'android');
  endpoint.searchParams.set('fallback', 'promotion');
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      endpoint.searchParams.set(key, value);
    }
  }

  const response = await request.get(endpoint.toString(), {
    failOnStatusCode: false,
    maxRedirects: 0,
  });

  expect(
    response.status(),
    `/open-app must respond with a redirect for ${endpoint.toString()}`,
  ).toBe(302);

  return response.headers().location || '';
}

function waitForOpenAppResponse(page, baseUrl, timeoutMs) {
  const expectedOrigin = new URL(baseUrl).origin;
  return page.waitForResponse(
    (response) => {
      const url = new URL(response.url());
      return url.origin === expectedOrigin && url.pathname === '/open-app';
    },
    { timeout: timeoutMs },
  );
}

function startOpenAppResponseCollector(page, baseUrl) {
  const expectedOrigin = new URL(baseUrl).origin;
  const responses = [];
  const listener = (response) => {
    const url = new URL(response.url());
    if (url.origin !== expectedOrigin || url.pathname !== '/open-app') {
      return;
    }
    responses.push({
      status: response.status(),
      location: response.headers().location || '',
      url: response.url(),
    });
  };

  page.on('response', listener);

  return {
    responses,
    stop() {
      page.off('response', listener);
    },
  };
}

async function expectAndroidOpenAppIntent({
  page,
  baseUrl,
  expectedTargetPath,
  action,
  timeoutMs,
}) {
  const responsePromise = waitForOpenAppResponse(
    page,
    baseUrl,
    timeoutMs,
  );

  await action();
  const response = await responsePromise;
  expect(response.status(), '/open-app must return a redirect response.')
    .toBe(302);
  assertAndroidIntentLocation(
    response.headers().location || '',
    baseUrl,
    expectedTargetPath,
  );
}

async function expectAndroidOpenAppHandoff({
  page,
  baseUrl,
  expectedTargetPath,
  action,
  timeoutMs,
}) {
  const responsePromise = waitForOpenAppResponse(
    page,
    baseUrl,
    timeoutMs,
  );

  await action();
  const response = await responsePromise;
  expect(response.status(), '/open-app must return a redirect response.')
    .toBe(302);
  assertAndroidOpenAppHandoffLocation(
    response.headers().location || '',
    baseUrl,
    expectedTargetPath,
  );
}

async function expectAndroidDirectPublicHandoff({
  page,
  baseUrl,
  expectedTargetPath,
  action,
  timeoutMs,
}) {
  const collector = startOpenAppResponseCollector(page, baseUrl);
  const responsePromise = waitForOpenAppResponse(
    page,
    baseUrl,
    timeoutMs,
  );

  try {
    await action();
    const response = await responsePromise;
    expect(response.status(), '/open-app must return a redirect response.')
      .toBe(302);
    const location = response.headers().location || '';
    assertAndroidDirectPublicHandoffLocation(
      location,
      baseUrl,
      expectedTargetPath,
    );

    if (location.startsWith('intent://')) {
      const fallbackUrl = androidDirectBrowserFallbackUrl(location, baseUrl);
      const fallbackResponse = await page.goto(fallbackUrl, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs,
      });
      expect(
        fallbackResponse,
        `Browser fallback must render the original public route ${expectedTargetPath}.`,
      ).not.toBeNull();
      expect(
        fallbackResponse.status(),
        `Browser fallback must stay on the original public route ${expectedTargetPath}.`,
      ).toBeLessThan(400);
    }

    await waitForPublicRouteToSettle(
      page,
      expectedTargetPath,
      timeoutMs,
    );
    const current = new URL(page.url());
    const currentTarget = current.pathname + current.search;
    expect(currentTarget).toBe(expectedTargetPath);
    expect(
      collector.responses,
      `Direct-public handoff must traverse /open-app exactly once for ${expectedTargetPath}. Responses:\n${JSON.stringify(collector.responses, null, 2)}`,
    ).toHaveLength(1);
  } finally {
    collector.stop();
  }
}

module.exports = {
  androidBrowserContextOptions,
  androidDirectBrowserFallbackUrl,
  assertAndroidDirectPublicHandoffLocation,
  assertAndroidOpenAppHandoffLocation,
  assertAndroidIntentLocation,
  assertAndroidPromotionFallbackLocation,
  expectAndroidDirectPublicHandoff,
  expectAndroidOpenAppHandoff,
  expectAndroidOpenAppIntent,
  fetchAndroidIntentRedirect,
};
