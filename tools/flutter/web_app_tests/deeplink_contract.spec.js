const { test, expect } = require('@playwright/test');

const landlordUrl = process.env.NAV_LANDLORD_URL;
const tenantUrl = process.env.NAV_TENANT_URL;

function requireNavigationUrls() {
  expect(
    landlordUrl,
    'Missing NAV_LANDLORD_URL. Readonly web navigation suite requires live landlord URL.',
  ).toBeTruthy();
  expect(
    tenantUrl,
    'Missing NAV_TENANT_URL. Readonly web navigation suite requires live tenant URL.',
  ).toBeTruthy();

  return { landlordUrl, tenantUrl };
}

async function fetchJsonContract(request, baseUrl, path) {
  const endpoint = new URL(path, baseUrl).toString();
  const response = await request.get(endpoint, { failOnStatusCode: false });

  expect(response.status(), `Endpoint must succeed: ${endpoint}`).toBeLessThan(
    400,
  );

  const contentType = (
    response.headers()['content-type'] || ''
  ).toLowerCase();
  expect(
    contentType,
    `Endpoint must be JSON-compatible: ${endpoint}`,
  ).toContain('application/json');

  const bodyText = await response.text();
  expect(bodyText, `Endpoint must not fallback to HTML: ${endpoint}`).not.toContain(
    '<!DOCTYPE html>',
  );

  let json;
  expect(() => {
    json = JSON.parse(bodyText);
  }, `Endpoint must return parseable JSON: ${endpoint}`).not.toThrow();

  return { endpoint, payload: json };
}

async function fetchManifestContract(request, baseUrl) {
  const endpoint = new URL('/manifest.json', baseUrl).toString();
  const response = await request.get(endpoint, { failOnStatusCode: false });

  expect(response.status(), `Manifest must succeed: ${endpoint}`).toBeLessThan(
    400,
  );

  const contentType = (
    response.headers()['content-type'] || ''
  ).toLowerCase();
  const hasExpectedContentType =
    contentType.includes('application/manifest+json') ||
    contentType.includes('application/json');
  expect(
    hasExpectedContentType,
    `Manifest must be JSON-compatible: ${endpoint} (content-type=${contentType})`,
  ).toBeTruthy();

  const bodyText = await response.text();
  expect(bodyText, `Manifest must not fallback to HTML: ${endpoint}`).not.toContain(
    '<!DOCTYPE html>',
  );

  const payload = JSON.parse(bodyText);
  expect(payload, `Manifest payload must be an object: ${endpoint}`).toBeTruthy();
  expect(typeof payload.name, `Manifest must contain "name": ${endpoint}`).toBe(
    'string',
  );
  expect(
    Array.isArray(payload.icons),
    `Manifest must contain "icons" array: ${endpoint}`,
  ).toBeTruthy();
}

async function fetchFaviconContract(request, baseUrl) {
  const endpoint = new URL('/favicon.ico', baseUrl).toString();
  const response = await request.get(endpoint, { failOnStatusCode: false });

  expect(response.status(), `Favicon must succeed: ${endpoint}`).toBeLessThan(
    400,
  );

  const contentType = (
    response.headers()['content-type'] || ''
  ).toLowerCase();
  const hasExpectedContentType =
    contentType.startsWith('image/') ||
    contentType.includes('application/octet-stream');
  expect(
    hasExpectedContentType,
    `Favicon must be image-compatible: ${endpoint} (content-type=${contentType})`,
  ).toBeTruthy();

  const bodyBuffer = await response.body();
  expect(bodyBuffer.length, `Favicon body must not be empty: ${endpoint}`).toBeGreaterThan(0);

  const preview = bodyBuffer.toString('utf8', 0, 256).toLowerCase();
  expect(preview, `Favicon must not fallback to HTML: ${endpoint}`).not.toContain(
    '<!doctype html>',
  );
  expect(preview, `Favicon must not fallback to HTML shell: ${endpoint}`).not.toContain(
    '<html',
  );
}

test('@readonly landlord and tenant well-known endpoints are JSON and not SPA fallback', async ({
  page,
}) => {
  const { landlordUrl, tenantUrl } = requireNavigationUrls();
  const request = page.request;

  for (const baseUrl of [landlordUrl, tenantUrl]) {
    const assetLinks = await fetchJsonContract(
      request,
      baseUrl,
      '/.well-known/assetlinks.json',
    );
    expect(
      Array.isArray(assetLinks.payload),
      `assetlinks payload must be an array: ${assetLinks.endpoint}`,
    ).toBeTruthy();
    for (const entry of assetLinks.payload) {
      expect(entry?.target?.namespace).toBe('android_app');
      expect(Array.isArray(entry?.target?.sha256_cert_fingerprints)).toBeTruthy();
    }

    const appleAssociation = await fetchJsonContract(
      request,
      baseUrl,
      '/.well-known/apple-app-site-association',
    );
    expect(
      appleAssociation.payload?.applinks,
      `AASA payload must contain applinks: ${appleAssociation.endpoint}`,
    ).toBeTruthy();
    expect(
      Array.isArray(appleAssociation.payload?.applinks?.apps),
      `AASA payload must contain applinks.apps array: ${appleAssociation.endpoint}`,
    ).toBeTruthy();
    expect(
      Array.isArray(appleAssociation.payload?.applinks?.details),
      `AASA payload must contain applinks.details array: ${appleAssociation.endpoint}`,
    ).toBeTruthy();
  }
});

test('@readonly landlord and tenant manifest endpoint is JSON and not SPA fallback', async ({
  page,
}) => {
  const { landlordUrl, tenantUrl } = requireNavigationUrls();
  const request = page.request;

  await fetchManifestContract(request, landlordUrl);
  await fetchManifestContract(request, tenantUrl);
});

test('@readonly landlord and tenant favicon endpoint is image and not SPA fallback', async ({
  page,
}) => {
  const { landlordUrl, tenantUrl } = requireNavigationUrls();
  const request = page.request;

  await fetchFaviconContract(request, landlordUrl);
  await fetchFaviconContract(request, tenantUrl);
});
