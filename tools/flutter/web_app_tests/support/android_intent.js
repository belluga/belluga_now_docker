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

function assertAndroidOpenAppHandoffLocation(location, baseUrl, expectedTargetPath) {
  if (location.startsWith('intent://')) {
    assertAndroidIntentLocation(location, baseUrl, expectedTargetPath);
    return;
  }

  assertAndroidPromotionFallbackLocation(location, baseUrl, expectedTargetPath);
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

function waitForOpenAppResponse(context, baseUrl, timeoutMs) {
  const expectedOrigin = new URL(baseUrl).origin;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      context.off('response', onResponse);
      reject(new Error(`Timed out waiting for /open-app on ${expectedOrigin}`));
    }, timeoutMs);

    function onResponse(response) {
      const url = new URL(response.url());
      if (url.origin !== expectedOrigin || url.pathname !== '/open-app') {
        return;
      }
      clearTimeout(timer);
      context.off('response', onResponse);
      resolve(response);
    }

    context.on('response', onResponse);
  });
}

async function expectAndroidOpenAppIntent({
  page,
  baseUrl,
  expectedTargetPath,
  action,
  timeoutMs,
}) {
  const responsePromise = waitForOpenAppResponse(
    page.context(),
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
    page.context(),
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

module.exports = {
  androidBrowserContextOptions,
  assertAndroidOpenAppHandoffLocation,
  assertAndroidIntentLocation,
  assertAndroidPromotionFallbackLocation,
  expectAndroidOpenAppHandoff,
  expectAndroidOpenAppIntent,
  fetchAndroidIntentRedirect,
};
