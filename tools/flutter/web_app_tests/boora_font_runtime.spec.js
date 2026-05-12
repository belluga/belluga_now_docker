const { test, expect } = require('@playwright/test');

const tenantUrl = process.env.NAV_TENANT_URL;
const expectedWebBuildSha = process.env.NAV_EXPECTED_WEB_BUILD_SHA;
const expectedLandlordHost = process.env.NAV_EXPECTED_LANDLORD_HOST;
const appBootTimeoutMs = 120000;

function requireTenantUrl() {
  expect(
    tenantUrl,
    'Missing NAV_TENANT_URL. Boora font runtime spec requires a live tenant URL.',
  ).toBeTruthy();

  return tenantUrl;
}

function buildUrl(baseUrl, pathName) {
  return new URL(pathName, baseUrl).toString();
}

function fontAssetUrl(baseUrl, assetPath) {
  return buildUrl(baseUrl, `/assets/${assetPath}`);
}

async function assertAppBooted(page) {
  await expect(page.locator('flt-glass-pane')).toHaveCount(1, {
    timeout: appBootTimeoutMs,
  });
  await expect(page.locator('#splash-screen')).toHaveCount(0, {
    timeout: appBootTimeoutMs,
  });
}

test('@readonly BOORA-FONT-01 web runtime loads and draws BooraIcons glyphs', async ({
  page,
  request,
}) => {
  const baseUrl = requireTenantUrl();
  const manifestResponse = await request.get(
    buildUrl(baseUrl, '/assets/FontManifest.json'),
  );
  expect(manifestResponse.status(), 'FontManifest must be reachable.').toBeLessThan(400);

  const manifest = await manifestResponse.json();
  const booraEntries = manifest.filter((entry) =>
    ['BooraIcons', 'Boora'].includes(entry?.family),
  );
  expect(
    booraEntries.map((entry) => entry.family).sort(),
    'FontManifest must expose runtime BooraIcons and legacy Boora families.',
  ).toEqual(['Boora', 'BooraIcons']);

  const booraEntry = booraEntries.find((entry) => entry.family === 'BooraIcons');
  const booraFontPath = booraEntry?.fonts?.[0]?.asset;
  expect(booraFontPath, 'BooraIcons manifest entry must include a font asset.').toBeTruthy();

  const fontResponse = await request.get(fontAssetUrl(baseUrl, booraFontPath));
  expect(fontResponse.status(), 'BooraIcons TTF must be reachable.').toBeLessThan(400);
  const fontBody = await fontResponse.body();
  expect(fontBody.length, 'BooraIcons TTF must not be empty.').toBeGreaterThan(10000);

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await assertAppBooted(page);

  const runtimeProvenance = await page.evaluate(() => ({
    buildSha: window.__WEB_BUILD_SHA__ || null,
    landlordHost: window.__LANDLORD_HOST__ || null,
  }));
  if (expectedWebBuildSha) {
    expect(runtimeProvenance.buildSha).toBe(expectedWebBuildSha);
  }
  if (expectedLandlordHost) {
    expect(runtimeProvenance.landlordHost).toBe(expectedLandlordHost);
  }

  const drawProof = await page.evaluate(async ({ fontUrl }) => {
    const family = 'BooraIconsRuntimeProbe';
    const fontFace = new FontFace(family, `url(${fontUrl})`);
    await fontFace.load();
    document.fonts.add(fontFace);
    await document.fonts.ready;

    const glyphs = [0xf000, 0xf001, 0xf002, 0xf003, 0xf004, 0xf005]
      .map((codePoint) => String.fromCharCode(codePoint))
      .join('');

    function draw(fontFamily) {
      const canvas = document.createElement('canvas');
      canvas.width = 360;
      canvas.height = 96;
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#000000';
      context.font = `48px "${fontFamily}"`;
      context.textBaseline = 'middle';
      context.fillText(glyphs, 8, 48);
      return Array.from(
        context.getImageData(0, 0, canvas.width, canvas.height).data,
      );
    }

    function inkPixelCount(pixels) {
      let count = 0;
      for (let index = 0; index + 3 < pixels.length; index += 4) {
        const red = pixels[index];
        const green = pixels[index + 1];
        const blue = pixels[index + 2];
        const alpha = pixels[index + 3];
        if (alpha > 0 && (red < 245 || green < 245 || blue < 245)) {
          count += 1;
        }
      }
      return count;
    }

    function differentPixelCount(left, right) {
      const length = Math.min(left.length, right.length);
      let count = 0;
      for (let index = 0; index + 3 < length; index += 4) {
        const delta =
          Math.abs(left[index] - right[index]) +
          Math.abs(left[index + 1] - right[index + 1]) +
          Math.abs(left[index + 2] - right[index + 2]);
        if (delta > 60) {
          count += 1;
        }
      }
      return count;
    }

    const booraPixels = draw(family);
    const fallbackPixels = draw('__missing_boora_icon_font__');

    return {
      booraInk: inkPixelCount(booraPixels),
      fallbackInk: inkPixelCount(fallbackPixels),
      differentPixels: differentPixelCount(booraPixels, fallbackPixels),
    };
  }, {
    fontUrl: fontAssetUrl(baseUrl, booraFontPath),
  });

  console.log(`[boora-font] draw proof: ${JSON.stringify(drawProof)}`);
  expect(drawProof.booraInk, 'BooraIcons glyph row must draw visible ink.').toBeGreaterThan(500);
  expect(
    drawProof.differentPixels,
    'BooraIcons glyph drawing must differ from a missing-font fallback.',
  ).toBeGreaterThan(500);
});
