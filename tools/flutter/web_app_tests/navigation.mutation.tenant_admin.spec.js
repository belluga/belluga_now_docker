const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { test, expect, request } = require('@playwright/test');
const {
  loginTenantAdmin: loginTenantAdminWithRequiredCredentials,
} = require('./support/tenant_admin_auth');
const { selectDropdownOption } = require('./support/semantic_dropdown');
const {
  selectRichTextEditorContents,
} = require('./support/rich_text_editor');
const {
  installFailureCollectors,
  resetFailureCollectors,
  summarizeCriticalBrowserFailures,
} = require('./support/browser_failure_collectors');
const {
  cleanupOnboardedAccount,
  runCleanupPreservingPrimaryError,
  runCleanupSteps,
} = require('./support/account_onboarding_cleanup');
const {
  createFreshAuthenticatedTenantAdminPage,
} = require('./support/tenant_admin_seeded_session');

const tenantUrl = process.env.NAV_TENANT_URL;
const fixtureImagePath = path.join(os.tmpdir(), 'belluga-navigation-fixture.png');
const fixtureFaviconPath = path.resolve(
  __dirname,
  '../../../laravel-app/tests/Assets/tenant_1.ico',
);
const fallbackFixtureImageBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAADIElEQVR4nO3UIQEAIBDAwI9AZWKRDmIgduL81GadfYGm+R0A/GMAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEGYAEPYAluQiSDn9lCoAAAAASUVORK5CYII=';
const appBootTimeoutMs = 90000;
const favoriteChipAvatarFrameSize = 72;
const favoriteChipHaloProbeCenterY = favoriteChipAvatarFrameSize / 2;
const favoriteChipHaloProbeInnerRadius = favoriteChipAvatarFrameSize / 2 - 3;
const favoriteChipHaloProbeOuterRadius = favoriteChipAvatarFrameSize / 2 + 3;
const favoriteChipLiveVsUpcomingDiffFactor = 1.08;
const favoriteChipUpcomingVsFallbackPixelDelta = 24;
const favoriteChipUpcomingVsFallbackDiffDelta = 1200;
let generatedFixtureImageBuffer = null;

test.describe.configure({ timeout: 300000 });

function requireTenantUrl() {
  expect(
    tenantUrl,
    'Missing NAV_TENANT_URL. Tenant-admin mutation suite requires a live tenant URL.',
  ).toBeTruthy();
  return tenantUrl;
}

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
}

function buildApiUrl(baseUrl, pathName) {
  return new URL(pathName, baseUrl).toString();
}

function resolveAbsoluteUrl(baseUrl, rawUrl) {
  return new URL(rawUrl, baseUrl).toString();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function writeRuntimeActualRun(runtimeOutputDir, payload) {
  fs.mkdirSync(runtimeOutputDir, { recursive: true, mode: 0o700 });
  const outputDirectory = fs.lstatSync(runtimeOutputDir);
  if (!outputDirectory.isDirectory() || outputDirectory.isSymbolicLink()) {
    throw new Error('Rich-text runtime output directory must be a real directory.');
  }
  const actualPath = path.join(runtimeOutputDir, 'actual-run.json');
  if (fs.existsSync(actualPath) || fs.lstatSync(runtimeOutputDir).isSymbolicLink()) {
    throw new Error('Refusing to overwrite rich-text actual-run evidence.');
  }
  const temporaryPath = path.join(
    runtimeOutputDir,
    `.actual-run.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`,
  );
  fs.writeFileSync(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  try {
    fs.linkSync(temporaryPath, actualPath);
  } finally {
    fs.unlinkSync(temporaryPath);
  }
}

const u04PickerDebugEnabled = process.env.U04_DEBUG_PICKER === '1';

async function logU04PickerSemanticSnapshot(page, needle) {
  if (!u04PickerDebugEnabled) {
    return;
  }

  const snapshot = await page.evaluate((rawNeedle) => {
    const needleValue = rawNeedle.toLowerCase();
    const rows = [];
    for (const element of document.querySelectorAll('[role]')) {
      const role = element.getAttribute('role') || '';
      const name = element.getAttribute('aria-label') || '';
      const text = (element.textContent || '').trim();
      const checked = element.getAttribute('aria-checked') || '';
      const selected = element.getAttribute('aria-selected') || '';
      const blob = `${role} ${name} ${text}`.toLowerCase();
      if (
        !blob.includes(needleValue) &&
        !blob.includes('adicionar perfis') &&
        !blob.includes('selecionado')
      ) {
        continue;
      }
      rows.push({
        role,
        name,
        text,
        checked,
        selected,
      });
      if (rows.length >= 30) {
        break;
      }
    }
    return rows;
  }, needle);

  const rendered = `[U04 picker semantic snapshot] ${JSON.stringify(snapshot, null, 2)}\n`;
  console.log(rendered);
  require('fs').appendFileSync('/tmp/u04_picker_debug.log', rendered);
}

function urlsMatchIgnoringQuery(candidateUrl, expectedUrl) {
  try {
    const candidate = new URL(candidateUrl);
    const expected = new URL(expectedUrl);
    return (
      candidate.origin === expected.origin &&
      candidate.pathname === expected.pathname
    );
  } catch (_) {
    return candidateUrl.split('?')[0] === expectedUrl.split('?')[0];
  }
}

async function expectImagePreviewRenderedOrRequested({
  page,
  expectedUrl,
  successfulStatuses,
  message,
}) {
  const expectedWithoutQuery = expectedUrl.split('?')[0];
  await expect
    .poll(
      async () => {
        if (successfulStatuses.some((status) => status === 200)) {
          return true;
        }

        return page.locator('img').evaluateAll(
          (elements, expectedSrc) => {
            return elements.some((element) => {
              const src =
                element.getAttribute('src') ||
                element.getAttribute('currentSrc') ||
                '';
              return src.split('?')[0] === expectedSrc;
            });
          },
          expectedWithoutQuery,
        ).catch(() => false);
      },
      {
        timeout: appBootTimeoutMs,
        message,
      },
    )
    .toBeTruthy();
}

function logStep(flow, message) {
  console.log(`[tenant-admin][${flow}] ${message}`);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function createFixturePngBuffer() {
  const width = 1024;
  const height = 768;
  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel + 1;
  const raw = Buffer.alloc(stride * height);

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * stride;
    raw[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = rowOffset + 1 + x * bytesPerPixel;
      raw[offset] = 32 + Math.floor((x / width) * 160);
      raw[offset + 1] = 96 + Math.floor((y / height) * 96);
      raw[offset + 2] = 180 - Math.floor(((x + y) / (width + height)) * 80);
      raw[offset + 3] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND'),
  ]);
}

function generatedFixtureImage() {
  if (!generatedFixtureImageBuffer) {
    generatedFixtureImageBuffer = createFixturePngBuffer();
  }
  return generatedFixtureImageBuffer;
}

function decodePng(buffer) {
  const signature = '89504e470d0a1a0a';
  expect(buffer.subarray(0, 8).toString('hex')).toBe(signature);

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    offset += 4;
    const type = buffer.subarray(offset, offset + 4).toString('ascii');
    offset += 4;
    const data = buffer.subarray(offset, offset + length);
    offset += length;
    offset += 4;

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  expect(width, 'PNG width must be available.').toBeGreaterThan(0);
  expect(height, 'PNG height must be available.').toBeGreaterThan(0);
  expect(bitDepth, 'PNG screenshots must be 8-bit.').toBe(8);
  expect(
    [2, 6],
    `Unsupported PNG color type ${colorType} in locator screenshot.`,
  ).toContain(colorType);

  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const stride = width * bytesPerPixel;
  const inflated = zlib.inflateSync(Buffer.concat(idatChunks));
  const reconstructed = Buffer.alloc(height * stride);

  let sourceOffset = 0;
  for (let row = 0; row < height; row += 1) {
    const filterType = inflated[sourceOffset];
    sourceOffset += 1;
    const rowStart = row * stride;

    for (let column = 0; column < stride; column += 1) {
      const raw = inflated[sourceOffset + column];
      const left = column >= bytesPerPixel
        ? reconstructed[rowStart + column - bytesPerPixel]
        : 0;
      const up = row > 0 ? reconstructed[rowStart - stride + column] : 0;
      const upLeft =
        row > 0 && column >= bytesPerPixel
          ? reconstructed[rowStart - stride + column - bytesPerPixel]
          : 0;

      let value = raw;
      if (filterType === 1) {
        value = (raw + left) & 0xff;
      } else if (filterType === 2) {
        value = (raw + up) & 0xff;
      } else if (filterType === 3) {
        value = (raw + Math.floor((left + up) / 2)) & 0xff;
      } else if (filterType === 4) {
        const predictor = paethPredictor(left, up, upLeft);
        value = (raw + predictor) & 0xff;
      } else {
        expect(filterType, 'PNG filter type must be 0-4.').toBe(0);
      }

      reconstructed[rowStart + column] = value;
    }

    sourceOffset += stride;
  }

  const rgba = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const sourceIndex = index * bytesPerPixel;
    const targetIndex = index * 4;
    rgba[targetIndex] = reconstructed[sourceIndex];
    rgba[targetIndex + 1] = reconstructed[sourceIndex + 1];
    rgba[targetIndex + 2] = reconstructed[sourceIndex + 2];
    rgba[targetIndex + 3] = bytesPerPixel === 4 ? reconstructed[sourceIndex + 3] : 255;
  }

  return { width, height, rgba };
}

function paethPredictor(left, up, upLeft) {
  const base = left + up - upLeft;
  const leftDistance = Math.abs(base - left);
  const upDistance = Math.abs(base - up);
  const upLeftDistance = Math.abs(base - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) {
    return left;
  }
  if (upDistance <= upLeftDistance) {
    return up;
  }
  return upLeft;
}

function readPixel(png, x, y) {
  const clampedX = Math.max(0, Math.min(png.width - 1, x));
  const clampedY = Math.max(0, Math.min(png.height - 1, y));
  const index = (clampedY * png.width + clampedX) * 4;
  return {
    r: png.rgba[index],
    g: png.rgba[index + 1],
    b: png.rgba[index + 2],
    a: png.rgba[index + 3],
  };
}

function clampTextBand(png, { x0, x1, y0, y1 }) {
  const safeX0 = Math.max(0, Math.min(png.width - 1, x0));
  const safeY0 = Math.max(0, Math.min(png.height - 1, y0));
  const safeX1 = Math.max(safeX0 + 1, Math.min(png.width, x1));
  const safeY1 = Math.max(safeY0 + 1, Math.min(png.height, y1));
  return {
    x0: safeX0,
    x1: safeX1,
    y0: safeY0,
    y1: safeY1,
  };
}

function measureTextInkBand(png, band) {
  const clampedBand = clampTextBand(png, band);
  const background = readPixel(
    png,
    5,
    Math.max(
      5,
      Math.min(
        png.height - 5,
        Math.floor((clampedBand.y0 + clampedBand.y1) / 2),
      ),
    ),
  );
  let darkPixelCount = 0;
  let diffSum = 0;
  let totalPixels = 0;

  for (let y = clampedBand.y0; y < clampedBand.y1; y += 1) {
    for (let x = clampedBand.x0; x < clampedBand.x1; x += 1) {
      const pixel = readPixel(png, x, y);
      const brightness = (pixel.r + pixel.g + pixel.b) / 3;
      const diff = colorDistance(pixel, background);
      totalPixels += 1;
      diffSum += diff;
      if (brightness < 215 && diff > 45) {
        darkPixelCount += 1;
      }
    }
  }

  return {
    darkPixelCount,
    totalPixels,
    darkPixelRatio: totalPixels > 0 ? darkPixelCount / totalPixels : 0,
    averageDiff: totalPixels > 0 ? diffSum / totalPixels : 0,
  };
}

function measureFlutterFieldValueInkSignature(png) {
  return {
    valueBand: measureTextInkBand(png, {
      x0: 16,
      x1: Math.min(png.width - 16, 450),
      y0: 18,
      y1: 40,
    }),
    lowerBand: measureTextInkBand(png, {
      x0: 16,
      x1: Math.min(png.width - 16, 450),
      y0: 24,
      y1: 48,
    }),
    rightBand: measureTextInkBand(png, {
      x0: Math.max(0, png.width - 202),
      x1: Math.max(1, png.width - 22),
      y0: 18,
      y1: 40,
    }),
  };
}

function flutterFieldValueInkLooksRendered(signature) {
  return (
    signature.valueBand.darkPixelCount >= 200 &&
    signature.valueBand.darkPixelRatio >= 0.03 &&
    signature.valueBand.averageDiff >= 12 &&
    signature.lowerBand.darkPixelCount >= 120 &&
    signature.lowerBand.darkPixelRatio >= 0.02 &&
    signature.rightBand.darkPixelCount <= 40
  );
}

function colorDistance(a, b) {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

function quantizeColor(pixel) {
  return {
    r: Math.round(pixel.r / 16) * 16,
    g: Math.round(pixel.g / 16) * 16,
    b: Math.round(pixel.b / 16) * 16,
  };
}

function measureFavoriteHaloSignature(png) {
  const background = readPixel(png, 1, 1);
  const centerX = Math.floor(png.width / 2);
  // Tie the probe to FavoriteChip's canonical 72px avatar frame.
  const centerY = favoriteChipHaloProbeCenterY;
  const counts = new Map();
  let coloredPixelCount = 0;
  let diffSum = 0;

  for (let y = 0; y < Math.min(png.height, favoriteChipAvatarFrameSize); y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const dx = x + 0.5 - centerX;
      const dy = y + 0.5 - centerY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (
        distance < favoriteChipHaloProbeInnerRadius ||
        distance > favoriteChipHaloProbeOuterRadius
      ) {
        continue;
      }

      const pixel = readPixel(png, x, y);
      if (pixel.a < 220) {
        continue;
      }

      const diff = colorDistance(pixel, background);
      if (diff < 22) {
        continue;
      }

      coloredPixelCount += 1;
      diffSum += diff;
      const quantized = quantizeColor(pixel);
      const key = `${quantized.r},${quantized.g},${quantized.b}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  const winner = [...counts.entries()].sort((left, right) => right[1] - left[1])[0];
  const dominantColor = winner
    ? (() => {
      const [r, g, b] = winner[0].split(',').map(Number);
      return { r, g, b };
    })()
    : background;

  return {
    coloredPixelCount,
    diffSum,
    dominantColor,
  };
}

async function resolveFavoriteHaloSignature(locator) {
  return measureFavoriteHaloSignature(
    decodePng(await locator.screenshot({ scale: 'css' })),
  );
}

function fixtureImagePayload() {
  return {
    name: 'belluga-navigation-fixture.png',
    mimeType: 'image/png',
    buffer: generatedFixtureImage(),
  };
}

function ensureFixtureImageFile(fixturePath) {
  if (fixturePath !== fixtureImagePath) {
    if (!fs.existsSync(fixturePath)) {
      throw new Error(`Missing required image fixture: ${fixturePath}`);
    }
    return fixturePath;
  }

  fs.writeFileSync(fixtureImagePath, generatedFixtureImage());
  return fixtureImagePath;
}

async function assertNoBrowserFailures(
  collectors,
  {
    allowedConsoleErrorSubstrings = [],
    allowedResponseStatuses,
  } = {},
) {
  const summary = summarizeCriticalBrowserFailures(collectors, {
    allowedConsoleErrorSubstrings,
    allowedResponseStatuses,
  });
  expect(
    summary.runtimeErrors,
    `Unexpected runtime errors:\n${summary.runtimeErrors.join('\n')}`,
  ).toEqual([]);
  expect(
    summary.failedRequests,
    `Unexpected failed requests:\n${summary.failedRequests.join('\n')}`,
  ).toEqual([]);
  expect(
    summary.criticalHttpResponses,
    `Critical HTTP responses:\n${summary.criticalHttpResponses.join('\n')}`,
  ).toEqual([]);
  expect(
    summary.disallowedRateLimitedResponses,
    `Disallowed 429 responses:\n${summary.disallowedRateLimitedResponses.join('\n')}`,
  ).toEqual([]);
  expect(
    summary.criticalConsoleErrors,
    `Critical console errors:\n${summary.criticalConsoleErrors.join('\n')}`,
  ).toEqual([]);
}

async function disposeApiResponse(response) {
  if (!response) {
    return;
  }

  await response.dispose().catch(() => {});
}

async function assertAppBooted(page) {
  await expect(page.locator('flt-glass-pane')).toHaveCount(1, {
    timeout: appBootTimeoutMs,
  });
  await expect(page.locator('#splash-screen')).toHaveCount(0, {
    timeout: appBootTimeoutMs,
  });
}

async function assertAppBootedWithSingleReload(page, {
  flow,
  logStep,
  responseLabel,
}) {
  try {
    await assertAppBooted(page);
    return;
  } catch (error) {
    logStep(flow, `${responseLabel} splash stall detected; reloading once`);
    const reloadResponse = await page.reload({ waitUntil: 'domcontentloaded' });
    expect(reloadResponse, `${responseLabel} reload must respond.`).not.toBeNull();
    expect(reloadResponse.status()).toBeLessThan(400);
    logStep(flow, `${responseLabel} reload responded ${reloadResponse.status()}`);
    await assertAppBooted(page);
  }
}

async function attachImageFromDevice(
  page,
  {
    flow,
    buttonName,
    buttonIndex = 0,
    cropTitle = null,
    fixturePath = fixtureImagePath,
  },
) {
  const trigger = page.getByRole('button', { name: buttonName }).nth(buttonIndex);
  await trigger.scrollIntoViewIfNeeded();
  await expect(trigger).toBeVisible({
    timeout: appBootTimeoutMs,
  });

  logStep(flow, `open image source sheet via ${buttonName}[${buttonIndex}]`);
  await trigger.click();
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByText('Do dispositivo').last().click(),
  ]);
  const resolvedFixturePath = ensureFixtureImageFile(fixturePath);
  logStep(flow, `attach fixture ${resolvedFixturePath}`);
  await fileChooser.setFiles(resolvedFixturePath);

  if (!cropTitle) {
    return;
  }

  await expect(page.getByText(cropTitle)).toBeVisible({
    timeout: appBootTimeoutMs,
  });
  logStep(flow, `${cropTitle} visible`);
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

function normalizeFlutterWitnessText(value) {
  return (value || '').toString().replace(/\s+/g, ' ').trim();
}

async function captureFlutterFieldScreenshot(field) {
  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await field.screenshot({ scale: 'css' });
    } catch (error) {
      lastError = error;
      if (!/not attached to the DOM/i.test(error?.message || '')) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  throw lastError;
}

async function collectFlutterRenderedTextCorpus(field) {
  return normalizeFlutterWitnessText(
    await field.evaluate(() => {
      const bodyText = (document.body?.innerText || '').trim();
      const ariaText = Array.from(
        document.querySelectorAll('[aria-label], [aria-valuetext]'),
      )
        .map((element) =>
          [
            element.getAttribute('aria-label') || '',
            element.getAttribute('aria-valuetext') || '',
          ]
            .filter(Boolean)
            .join(' '),
        )
        .filter(Boolean)
        .join('\n');
      return `${bodyText}\n${ariaText}`;
    }),
  );
}

async function collectFlutterFieldValueInkSignature(field) {
  return measureFlutterFieldValueInkSignature(
    decodePng(await captureFlutterFieldScreenshot(field)),
  );
}

// Under CanvasKit, pre-focus field text can exist only on the painted layer.
async function expectFlutterFieldRenderedValue(field, expectedValue, message) {
  const normalizedExpectedValue = normalizeFlutterWitnessText(expectedValue);
  expect(
    normalizedExpectedValue,
    `${message} requires a non-empty expected value.`,
  ).toBeTruthy();

  let lastWitness = null;
  try {
    await expect
      .poll(
        async () => {
          const renderedTextCorpus = await collectFlutterRenderedTextCorpus(
            field,
          );
          if (
            renderedTextCorpus
              .toLowerCase()
              .includes(normalizedExpectedValue.toLowerCase())
          ) {
            lastWitness = {
              witnessType: 'page-rendered-text-corpus',
              renderedTextCorpus,
            };
            return true;
          }

          const valueInkSignature = await collectFlutterFieldValueInkSignature(
            field,
          );
          lastWitness = {
            witnessType: 'painted-value-band',
            renderedTextCorpus,
            valueInkSignature,
          };
          return flutterFieldValueInkLooksRendered(valueInkSignature);
        },
        {
          timeout: appBootTimeoutMs,
          message,
        },
      )
      .toBe(true);
  } catch (error) {
    throw new Error(
      `${message} Last witness: ${JSON.stringify(lastWitness)}`,
    );
  }
}

async function expectFlutterFieldRenderedAndFocusedValue(
  field,
  expectedValue,
  message,
) {
  const normalizedExpectedValue = normalizeFlutterWitnessText(expectedValue);
  expect(
    normalizedExpectedValue,
    `${message} requires a non-empty expected value.`,
  ).toBeTruthy();

  let lastWitness = null;
  try {
    await expect
      .poll(
        async () => {
          const renderedTextCorpus = await collectFlutterRenderedTextCorpus(
            field,
          );
          const valueInkSignature = await collectFlutterFieldValueInkSignature(
            field,
          );

          try {
            await field.click();
          } catch (error) {
            lastWitness = {
              witnessType: 'field-focus-failed',
              renderedTextCorpus,
              valueInkSignature,
              focusError: error?.message || String(error),
            };
            return (
              renderedTextCorpus
                .toLowerCase()
                .includes(normalizedExpectedValue.toLowerCase())
            );
          }

          let focusedInputValue = '';
          try {
            focusedInputValue = normalizeFlutterWitnessText(
              await field.inputValue(),
            );
          } catch (error) {
            lastWitness = {
              witnessType: 'focused-input-unreadable',
              renderedTextCorpus,
              valueInkSignature,
              inputError: error?.message || String(error),
            };
            return (
              renderedTextCorpus
                .toLowerCase()
                .includes(normalizedExpectedValue.toLowerCase())
            );
          }

          lastWitness = {
            witnessType: 'rendered-and-focused-input-value',
            renderedTextCorpus,
            valueInkSignature,
            focusedInputValue,
          };
          return (
            renderedTextCorpus
              .toLowerCase()
              .includes(normalizedExpectedValue.toLowerCase()) ||
            focusedInputValue.toLowerCase() ===
            normalizedExpectedValue.toLowerCase()
          );
        },
        {
          timeout: appBootTimeoutMs,
          message,
        },
      )
      .toBe(true);
  } catch (error) {
    throw new Error(
      `${message} Last witness: ${JSON.stringify(lastWitness)}`,
    );
  }
}

async function fillResolvedFlutterTextField(page, field, value, description) {
  await scrollUntilVisible(
    page,
    field,
    `Expected ${description} to become visible before typing.`,
  );
  await expect
    .poll(
      async () => field.isEditable().catch(() => false),
      {
        timeout: 5000,
        message: `Expected ${description} to become editable before typing.`,
      },
    )
    .toBe(true);

  let lastValue = '';
  const normalizedValue = value?.toString() || '';
  const selectAll = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await scrollUntilVisible(
        page,
        field,
        `Expected ${description} to stay visible while typing.`,
      );
      try {
        await field.focus();
      } catch (_) {
        await field.click({ timeout: 1500 });
      }
      await page.keyboard.press(selectAll);
      await page.keyboard.press('Backspace');
      if (normalizedValue) {
        await page.keyboard.insertText(normalizedValue);
      }
    } catch (error) {
      if (attempt === 3) {
        throw error;
      }
      await page.waitForTimeout(250);
      continue;
    }

    try {
      await expect
        .poll(
          async () => {
            try {
              return await field.inputValue();
            } catch (_) {
              return '';
            }
          },
          {
            timeout: 3000,
            message: `Expected ${description} to retain input.`,
          },
        )
        .toBe(normalizedValue);
      return field;
    } catch (_) {
      try {
        lastValue = await field.inputValue();
      } catch (_) {
        lastValue = '<unreadable>';
      }
      await page.waitForTimeout(150);
    }
  }

  throw new Error(
    `${description} did not retain "${value}" before submit; last value was "${lastValue}".`,
  );
}

async function fillFlutterTextField(page, label, value) {
  const field = page.getByLabel(label).first();
  return fillResolvedFlutterTextField(
    page,
    field,
    value,
    `Flutter text field "${label}"`,
  );
}

async function clickFirstVisibleLocator(locator, message) {
  await expect
    .poll(
      async () => {
        const count = await locator.count().catch(() => 0);
        for (let index = 0; index < count; index += 1) {
          if (await locator.nth(index).isVisible().catch(() => false)) {
            return true;
          }
        }
        return false;
      },
      {
        timeout: 5000,
        message,
      },
    )
    .toBe(true);

  const count = await locator.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) {
      await candidate.click();
      return;
    }
  }
  throw new Error(message);
}

function localIsoDate(date) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function targetCalendarSelection(daysFromNow) {
  const reference = new Date();
  reference.setHours(12, 0, 0, 0);
  const target = new Date(reference);
  target.setDate(target.getDate() + daysFromNow);
  target.setHours(12, 0, 0, 0);
  return {
    date: target,
    isoDate: localIsoDate(target),
    day: String(target.getDate()),
    monthDelta:
      (target.getFullYear() - reference.getFullYear()) * 12 +
      (target.getMonth() - reference.getMonth()),
  };
}

function assertEventDatePickerBoundaryCoverage() {
  const augustBoundary = targetCalendarSelectionFromReference(
    new Date(2026, 7, 31, 12, 0, 0, 0),
    1,
  );
  expect(
    augustBoundary.monthDelta,
    'Tenant-admin event date picker helper must navigate from August 31 to September 1.',
  ).toBe(1);

  const decemberBoundary = targetCalendarSelectionFromReference(
    new Date(2026, 11, 31, 12, 0, 0, 0),
    1,
  );
  expect(
    decemberBoundary.monthDelta,
    'Tenant-admin event date picker helper must navigate from December 31 to January 1.',
  ).toBe(1);
}

function targetCalendarSelectionFromReference(baseDate, daysFromNow) {
  const reference = new Date(baseDate);
  reference.setHours(12, 0, 0, 0);
  const target = new Date(reference);
  target.setDate(target.getDate() + daysFromNow);
  target.setHours(12, 0, 0, 0);
  return {
    date: target,
    isoDate: localIsoDate(target),
    day: String(target.getDate()),
    monthDelta:
      (target.getFullYear() - reference.getFullYear()) * 12 +
      (target.getMonth() - reference.getMonth()),
  };
}

async function pickReadOnlyTenantAdminEventDateTime(page, { daysFromNow }) {
  assertEventDatePickerBoundaryCoverage();
  const selection = targetCalendarSelection(daysFromNow);

  const openPickerButton = page.getByRole('button', {
    name: /Selecionar data e hora/i,
  }).first();
  await scrollUntilVisible(
    page,
    openPickerButton,
    'Expected the event date/time picker affordance to become visible before selecting the start date.',
  );
  await openPickerButton.click();

  if (selection.monthDelta !== 0) {
    const monthStepper = page.getByRole('button', {
      name:
        selection.monthDelta > 0
          ? /^(Next month|Próximo mês)$/i
          : /^(Previous month|Mês anterior)$/i,
    });
    for (let step = 0; step < Math.abs(selection.monthDelta); step += 1) {
      await clickFirstVisibleLocator(
        monthStepper,
        `Expected the date picker to expose the month navigation button for step ${
          step + 1
        }/${Math.abs(selection.monthDelta)}.`,
      );
      await page.waitForTimeout(100);
    }
  }

  const targetDayButtons = page.getByRole('button', {
    name: new RegExp(`^${escapeRegExp(selection.day)}(?:,|$)`),
  });
  await clickFirstVisibleLocator(
    targetDayButtons,
    `Expected the date picker to expose the target day ${selection.day}.`,
  );

  const confirmButtons = page.getByRole('button', {
    name: /^(OK|Confirmar)$/i,
  });
  await clickFirstVisibleLocator(
    confirmButtons,
    'Expected the date picker confirmation button to be visible.',
  );
  await clickFirstVisibleLocator(
    confirmButtons,
    'Expected the time picker confirmation button to be visible.',
  );

  await expect
    .poll(
      async () => page.getByRole('dialog').count().catch(() => 0),
      {
        timeout: appBootTimeoutMs,
        message: 'Expected the date/time picker dialogs to close after both confirmations.',
      },
    )
    .toBe(0);

  return selection;
}

async function countVisibleLocators(locator) {
  const count = await locator.count().catch(() => 0);
  let visibleCount = 0;
  for (let index = 0; index < count; index += 1) {
    if (await locator.nth(index).isVisible().catch(() => false)) {
      visibleCount += 1;
    }
  }
  return visibleCount;
}

async function expectNoVisibleFlutterTextField(page, label, message) {
  const locator = page.getByLabel(label);
  await expect
    .poll(
      async () => countVisibleLocators(locator),
      {
        timeout: appBootTimeoutMs,
        message,
      },
    )
    .toBe(0);
}

async function fillColorPickerField(page, label, value) {
  await fillFlutterTextField(page, label, value);
  const colorDialogTitle = page.getByText('Cor do marcador').last();
  const applyButton = page.getByRole('button', { name: /Aplicar cor/i }).last();
  if (await applyButton.count()) {
    await expect(applyButton).toBeVisible({ timeout: 2000 });
    await applyButton.click();
    await expect(colorDialogTitle).toBeHidden({ timeout: appBootTimeoutMs });
  }
}

async function scrollUntilVisible(page, locator, description) {
  async function tryCurrentLocator() {
    const candidateCount = await locator.count().catch(() => 0);
    if (candidateCount <= 0) {
      return false;
    }
    const first = locator.first();
    await first.scrollIntoViewIfNeeded().catch(() => {});
    return first.isVisible().catch(() => false);
  }

  if (await tryCurrentLocator()) {
    return;
  }

  const viewport =
    page.viewportSize() ||
    (await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    })));
  await page.mouse.move(viewport.width * 0.62, viewport.height * 0.72);

  for (const delta of [900, -900]) {
    for (let attempt = 0; attempt < 36; attempt += 1) {
      if (await tryCurrentLocator()) {
        return;
      }
      await page.mouse.wheel(0, delta);
      await page.waitForTimeout(250);
    }
  }

  await expect(locator, description).toBeVisible({
    timeout: appBootTimeoutMs,
  });
}

async function clickSaveChanges(page) {
  const saveButton = page
    .getByRole('button', { name: /Salvar altera/i })
    .last();
  await saveButton.scrollIntoViewIfNeeded();
  await expect(saveButton).toBeVisible({
    timeout: appBootTimeoutMs,
  });
  await saveButton.click({ noWaitAfter: true });
}

async function resolveUniqueFlutterTappableText(page, text) {
  const renderedText = page.getByText(text, { exact: true });
  await expect(renderedText).toHaveCount(1, { timeout: appBootTimeoutMs });
  await expect(renderedText).toHaveText(text);

  const tappableSemantics = renderedText.locator(
    'xpath=ancestor-or-self::*[@flt-tappable][1]',
  );
  await expect(tappableSemantics).toHaveCount(1, {
    timeout: appBootTimeoutMs,
  });
  await expect(tappableSemantics).toHaveAttribute('flt-tappable', '');
  await expect(tappableSemantics).toBeVisible({ timeout: appBootTimeoutMs });

  return tappableSemantics;
}

function requestPostDataContainsAll(request, expectedFragments = []) {
  const body = request.postData() || '';
  return expectedFragments.every((fragment) => body.includes(fragment));
}

function normalizedSearchParamSet(value) {
  return (value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .sort()
    .join(',');
}

function responseMatchesTenantAdminEventsList(
  candidate,
  { status = 'published', temporal = ['now', 'future'], pageSize = 20 } = {},
) {
  if (candidate.request().method() !== 'GET' || candidate.status() !== 200) {
    return false;
  }

  let url;
  try {
    url = new URL(candidate.url());
  } catch {
    return false;
  }

  if (url.pathname !== '/admin/api/v1/events') {
    return false;
  }

  if (url.searchParams.get('page') !== '1') {
    return false;
  }
  if (url.searchParams.get('page_size') !== pageSize.toString()) {
    return false;
  }
  if (url.searchParams.get('status') !== status) {
    return false;
  }
  if (
    normalizedSearchParamSet(url.searchParams.get('temporal')) !==
    normalizedSearchParamSet(temporal.join(','))
  ) {
    return false;
  }

  return ![
    'date',
    'venue_profile_id',
    'related_account_profile_id',
    'archived',
    'search',
  ].some((key) => url.searchParams.has(key));
}

function waitForTenantAdminEventsListResponse(
  page,
  { status = 'published', temporal = ['now', 'future'], pageSize = 20 } = {},
) {
  return page.waitForResponse((candidate) =>
    responseMatchesTenantAdminEventsList(candidate, {
      status,
      temporal,
      pageSize,
    }),
  );
}

async function waitForNoVisibleProgressIndicators(page, message) {
  await expect
    .poll(
      async () => countVisibleLocators(page.getByRole('progressbar')),
      {
        timeout: appBootTimeoutMs,
        message,
      },
    )
    .toBe(0);
}

function waitForSuccessfulAccountProfilePatchResponse(
  page,
  profileId,
  { requestMustContain = [] } = {},
) {
  return page.waitForResponse((candidate) => {
    return (
      candidate.request().method() === 'PATCH' &&
      candidate.url().includes(`/admin/api/v1/account_profiles/${profileId}`) &&
      candidate.status() < 400 &&
      requestPostDataContainsAll(candidate.request(), requestMustContain)
    );
  });
}

async function countVisibleMatches(locator) {
  return locator
    .evaluateAll((elements) =>
      elements.filter((element) => {
        if (!(element instanceof HTMLElement)) {
          return false;
        }
        const style = window.getComputedStyle(element);
        const hiddenByStyle =
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          Number.parseFloat(style.opacity || '1') === 0;
        if (hiddenByStyle) {
          return false;
        }
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }).length,
    )
    .catch(() => 0);
}

async function expectAnyVisibleMatch(locator, message) {
  await expect
    .poll(async () => countVisibleMatches(locator), {
      timeout: appBootTimeoutMs,
      message,
    })
    .toBeGreaterThan(0);
}

async function clickVisibleAddOccurrenceAffordance(page) {
  const candidates = page.getByRole('button', { name: /^Adicionar data$/ });
  await expect(candidates.first()).toBeVisible({ timeout: appBootTimeoutMs });
  const count = await candidates.count();
  let addOccurrence = candidates.first();
  let rightmostX = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index);
    const box = await candidate.boundingBox();
    if (!box || box.x <= rightmostX) {
      continue;
    }
    rightmostX = box.x;
    addOccurrence = candidate;
  }

  await expect(addOccurrence).toBeVisible({ timeout: appBootTimeoutMs });
  await addOccurrence.click();
  await expect(page.getByText('Adicionar data').last()).toBeVisible({
    timeout: appBootTimeoutMs,
  });
}

async function closeOccurrenceEditorSheet(page) {
  const occurrenceEditorDialog = page.locator('[aria-label="Caixa de diálogo"]').first();
  const waitForOccurrenceEditorDismissed = async (message, timeout = appBootTimeoutMs) => {
    await expect
      .poll(
        async () => countVisibleMatches(occurrenceEditorDialog),
        {
          timeout,
          message,
        },
      )
      .toBe(0);
  };
  await expect(
    page.getByRole('button', { name: 'Salvar data' }),
    'Occurrence editor must not expose the superseded per-occurrence save boundary.',
  ).toHaveCount(0);
  await expectAnyVisibleMatch(
    occurrenceEditorDialog,
    'Occurrence editor dialog must be visible before the helper tries to dismiss it.',
  );
  const headerCloseButton = occurrenceEditorDialog.getByRole('button', {
    name: 'Fechar',
  }).first();
  await expect(headerCloseButton).toBeVisible({ timeout: appBootTimeoutMs });

  try {
    await headerCloseButton.click();
    await waitForOccurrenceEditorDismissed(
      'Closing the occurrence editor via the dialog close action must dismiss the dialog container.',
      3000,
    );
    return;
  } catch (_) {}

  try {
    await headerCloseButton.focus().catch(() => {});
    await headerCloseButton.press('Enter');
    await waitForOccurrenceEditorDismissed(
      'Pressing Enter on the occurrence editor close action must dismiss the dialog container.',
      3000,
    );
    return;
  } catch (_) {}

  await page.keyboard.press('Escape');
  await waitForOccurrenceEditorDismissed(
    'Escaping the occurrence editor must dismiss the dialog container.',
    3000,
  );
}

async function scrollTenantAdminSheetToTop(page) {
  const viewport =
    page.viewportSize() ||
    (await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    })));
  await page.mouse.move(viewport.width * 0.62, viewport.height * 0.72);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await page.mouse.wheel(0, -1400);
    await page.waitForTimeout(120);
  }
}

async function createApiContext(baseUrl) {
  return request.newContext({
    baseURL: baseUrl,
    extraHTTPHeaders: {
      Accept: 'application/json',
    },
    ignoreHTTPSErrors: true,
  });
}

async function loginTenantAdmin(api, baseUrl) {
  return loginTenantAdminWithRequiredCredentials({
    api,
    baseUrl,
    buildUrl: buildApiUrl,
    deviceName: 'playwright-web-navigation',
  });
}

function normalizePayload(payload) {
  if (payload?.data && typeof payload.data === 'object') {
    return payload.data;
  }
  return payload;
}

function normalizeList(value) {
  return Array.isArray(value) ? value : [];
}

async function seedFlutterSecureStorage(context, entries) {
  await context.addInitScript(
    async ({ entries }) => {
      if (!['http:', 'https:'].includes(window.location.protocol)) {
        return;
      }

      const publicKey = 'FlutterSecureStorage';
      let storage;
      try {
        storage = window.localStorage;
      } catch (_) {
        return;
      }
      const algorithm = { name: 'AES-GCM', length: 256 };

      const bytesToBase64 = (bytes) => {
        let binary = '';
        const chunkSize = 0x8000;
        for (let index = 0; index < bytes.length; index += chunkSize) {
          binary += String.fromCharCode(
            ...bytes.subarray(index, index + chunkSize),
          );
        }
        return window.btoa(binary);
      };

      const base64ToBytes = (value) => {
        const binary = window.atob(value);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index);
        }
        return bytes;
      };

      const getEncryptionKey = async () => {
        const stored = storage.getItem(publicKey);
        if (stored) {
          return window.crypto.subtle.importKey(
            'raw',
            base64ToBytes(stored),
            algorithm,
            false,
            ['encrypt', 'decrypt'],
          );
        }

        const generated = await window.crypto.subtle.generateKey(
          algorithm,
          true,
          ['encrypt', 'decrypt'],
        );
        const exported = new Uint8Array(
          await window.crypto.subtle.exportKey('raw', generated),
        );
        storage.setItem(publicKey, bytesToBase64(exported));
        return generated;
      };

      const encryptionKey = await getEncryptionKey();
      const encoder = new TextEncoder();

      for (const [key, value] of Object.entries(entries)) {
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const encrypted = new Uint8Array(
          await window.crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            encryptionKey,
            encoder.encode(value),
          ),
        );
        storage.setItem(
          `${publicKey}.${key}`,
          `${bytesToBase64(iv)}.${bytesToBase64(encrypted)}`,
        );
      }
    },
    {
      entries,
    },
  );
}

async function createAuthenticatedTenantAdminPage(browser, session) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
  });
  await seedFlutterSecureStorage(context, {
    landlord_token: session.token,
    landlord_user_id: session.userId,
    active_mode: 'landlord',
  });
  const page = await context.newPage();
  return { context, page };
}

async function fetchPublicEnvironment(api, baseUrl) {
  const response = await api.get(buildApiUrl(baseUrl, '/api/v1/environment'));
  expect(response.status(), 'Public environment payload must load.').toBe(200);
  const payload = await response.json();
  return payload?.data || payload;
}

async function createAnonymousIdentity(api, baseUrl, source) {
  const fingerprintHash = crypto
    .createHash('sha256')
    .update(`${source}:${Date.now()}:${Math.random()}`)
    .digest('hex');
  const response = await api.post(
    buildApiUrl(baseUrl, '/api/v1/anonymous/identities'),
    {
      headers: { Accept: 'application/json' },
      data: {
        device_name: `playwright-${source}`,
        fingerprint: {
          hash: fingerprintHash,
          user_agent: `playwright-${source}`,
          locale: 'pt-BR',
        },
        metadata: {
          source,
        },
      },
    },
  );
  expect(
    [200, 201],
    `Anonymous tenant identity bootstrap must succeed for ${source}. Status ${response.status()}`,
  ).toContain(response.status());
  const payload = normalizePayload(await response.json());
  const token = payload?.token?.toString().trim() || '';
  const userId = payload?.user_id?.toString().trim() || '';
  expect(token, `${source} anonymous identity must return token.`).toBeTruthy();
  expect(userId, `${source} anonymous identity must return user_id.`).toBeTruthy();
  return { token, userId };
}

function liveOccurrenceWindow() {
  const start = new Date(Date.now() - 30 * 60 * 1000);
  const end = new Date(Date.now() + 90 * 60 * 1000);
  return {
    date_time_start: start.toISOString(),
    date_time_end: end.toISOString(),
  };
}

function futureOccurrenceWindow(daysFromNow) {
  const start = new Date();
  start.setDate(start.getDate() + daysFromNow);
  start.setHours(20, 0, 0, 0);

  const end = new Date(start);
  end.setHours(end.getHours() + 2);

  return {
    date_time_start: start.toISOString(),
    date_time_end: end.toISOString(),
  };
}

async function createAccountProfileEvent(
  api,
  baseUrl,
  token,
  {
    title,
    eventType,
    host,
    occurrences,
  },
) {
  const response = await api.post(
    buildApiUrl(baseUrl, '/admin/api/v1/events'),
    {
      headers: authHeaders(token),
      data: {
        title,
        content: `<p>${title}</p>`,
        type: {
          id: eventType.id,
          name: eventType.name,
          slug: eventType.slug,
          description: eventType.description || 'Playwright favorites runtime event type',
        },
        location: {
          mode: 'physical',
        },
        place_ref: {
          type: 'account_profile',
          id: host.profileId || host.id,
        },
        occurrences,
        publication: {
          status: 'published',
          publish_at: new Date(Date.now() - 60 * 1000).toISOString(),
        },
      },
    },
  );
  const payload = await response.json().catch(async () => ({
    raw: await response.text().catch(() => ''),
  }));
  expect(
    response.status(),
    `Event ${title} must be created. Response: ${JSON.stringify(payload)}`,
  ).toBe(201);
  return normalizePayload(payload);
}

async function deleteEvent(api, baseUrl, token, eventId) {
  if (!eventId) {
    return;
  }

  return api.delete(
    buildApiUrl(baseUrl, `/admin/api/v1/events/${eventId}`),
    {
      headers: authHeaders(token),
      failOnStatusCode: false,
    },
  );
}

async function favoriteAccountProfile(api, baseUrl, token, profileId) {
  const response = await api.post(
    buildApiUrl(baseUrl, '/api/v1/favorites'),
    {
      headers: authHeaders(token),
      data: {
        target_id: profileId,
        registry_key: 'account_profile',
        target_type: 'account_profile',
      },
    },
  );
  expect(response.status(), `Favorite mutation must succeed for ${profileId}.`).toBe(200);
  return response.json();
}

async function unfavoriteAccountProfile(api, baseUrl, token, profileId) {
  if (!profileId) {
    return;
  }

  const response = await api.delete(
    buildApiUrl(baseUrl, '/api/v1/favorites'),
    {
      headers: authHeaders(token),
      data: {
        target_id: profileId,
        registry_key: 'account_profile',
        target_type: 'account_profile',
      },
      failOnStatusCode: false,
    },
  );
  expect(
    [200, 404],
    `Favorite cleanup must succeed for ${profileId}.`,
  ).toContain(response.status());
}

async function fetchFavoritesForIdentity(api, baseUrl, token) {
  const response = await api.get(
    buildApiUrl(
      baseUrl,
      '/api/v1/favorites?page=1&page_size=10&registry_key=account_profile&target_type=account_profile',
    ),
    {
      headers: authHeaders(token),
    },
  );
  expect(response.status(), 'Favorites index must load for runtime readback.').toBe(200);
  return normalizePayload(await response.json());
}

async function fetchPublicProfile(api, baseUrl, token, profileSlug) {
  await expect
    .poll(
      async () => {
        const response = await api.get(
          buildApiUrl(baseUrl, `/api/v1/account_profiles/${profileSlug}`),
          {
            headers: authHeaders(token),
            failOnStatusCode: false,
          },
        );
        return response.status();
      },
      {
        timeout: appBootTimeoutMs,
        message: `Public account profile ${profileSlug} must hydrate before runtime readback.`,
      },
    )
    .toBe(200);

  const response = await api.get(
    buildApiUrl(baseUrl, `/api/v1/account_profiles/${profileSlug}`),
    {
      headers: authHeaders(token),
    },
  );
  expect(response.status(), 'Public account profile readback must succeed.').toBe(200);
  return normalizePayload(await response.json());
}

async function fetchAdminProfile(api, baseUrl, token, profileId) {
  const response = await api.get(
    buildApiUrl(baseUrl, `/admin/api/v1/account_profiles/${profileId}`),
    {
      headers: authHeaders(token),
    },
  );
  expect(response.status(), 'Admin account profile readback must succeed.').toBe(200);
  return normalizePayload(await response.json());
}

async function fetchAdminNestedGroupMembers(
  api,
  baseUrl,
  token,
  profileId,
  groupId,
) {
  const response = await api.get(
    buildApiUrl(
      baseUrl,
      `/admin/api/v1/account_profiles/${profileId}/nested_profile_groups/${groupId}/members`,
    ),
    {
      headers: authHeaders(token),
    },
  );
  expect(
    response.status(),
    'Nested-group member readback must succeed against the dedicated authority.',
  ).toBe(200);
  return await response.json();
}

async function fetchAdminEvent(api, baseUrl, token, eventId) {
  const response = await api.get(
    buildApiUrl(baseUrl, `/admin/api/v1/events/${eventId}`),
    {
      headers: authHeaders(token),
    },
  );
  expect(response.status(), 'Tenant-admin event readback must succeed.').toBe(200);
  return normalizePayload(await response.json());
}

function firstOccurrenceIsoDate(payload) {
  const firstOccurrence = normalizeList(payload?.occurrences)[0] || {};
  const rawStart =
    firstOccurrence?.date_time_start?.toString() ||
    firstOccurrence?.dateTimeStart?.toString() ||
    '';
  if (!rawStart) {
    return '';
  }
  const parsed = new Date(rawStart);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  return localIsoDate(parsed);
}

async function waitForAccountDeletion(api, baseUrl, token, profileId) {
  await expect
    .poll(
      async () => {
        const response = await api.get(
          buildApiUrl(baseUrl, `/admin/api/v1/account_profiles/${profileId}`),
          {
            headers: authHeaders(token),
            failOnStatusCode: false,
          },
        );
        return [404, 410].includes(response.status());
      },
      {
        timeout: appBootTimeoutMs,
        message: `Account profile ${profileId} must disappear after account deletion.`,
      },
    )
    .toBe(true);
}

async function waitForEventDeletion(api, baseUrl, token, eventId) {
  await expect
    .poll(
      async () => {
        const response = await api.get(
          buildApiUrl(baseUrl, `/admin/api/v1/events/${eventId}`),
          {
            headers: authHeaders(token),
            failOnStatusCode: false,
          },
        );
        return [404, 410].includes(response.status());
      },
      {
        timeout: appBootTimeoutMs,
        message: `Event ${eventId} must disappear after the admin delete flow.`,
      },
    )
    .toBe(true);
}

function eventTitleLocator(page, eventTitle) {
  return page.getByRole('button', {
    name: new RegExp(escapeRegExp(eventTitle), 'i'),
  }).first();
}

function eventTitleLocators(page, eventTitle) {
  return page.getByRole('button', {
    name: new RegExp(escapeRegExp(eventTitle), 'i'),
  });
}

function publicationStatusFilterLabel(status) {
  switch ((status || '').trim()) {
    case 'draft':
      return 'Rascunhos';
    case 'publish_scheduled':
      return 'Agendados';
    case 'ended':
      return 'Encerrados';
    case 'published':
      return 'Publicados';
    default:
      return null;
  }
}

function adminEventPublicationFilterCheckbox(page, label) {
  return page.getByRole('checkbox', {
    name: new RegExp(`^${escapeRegExp(label)}$`, 'i'),
  }).first();
}

function adminEventPublicationStatusValue(status) {
  switch ((status || '').trim()) {
    case 'draft':
      return 'draft';
    case 'publish_scheduled':
      return 'publish_scheduled';
    case 'ended':
      return 'ended';
    case 'published':
      return 'published';
    default:
      return null;
  }
}

async function expectAdminEventPublicationFilterChecked(page, label, expectedChecked, message) {
  const checkbox = adminEventPublicationFilterCheckbox(page, label);
  await scrollUntilVisible(
    page,
    checkbox,
    `Expected publication filter "${label}" to be reachable in the tenant-admin events list.`,
  );
  await expect(checkbox).toBeVisible({ timeout: appBootTimeoutMs });
  await expect
    .poll(
      async () => (await checkbox.getAttribute('aria-checked').catch(() => '')) || '',
      {
        timeout: appBootTimeoutMs,
        message,
      },
    )
    .toBe(expectedChecked ? 'true' : 'false');
}

async function ensureAdminEventPublicationFilterSelected(page, status) {
  const label = publicationStatusFilterLabel(status);
  if (!label) {
    return;
  }

  if (label === 'Publicados') {
    await expectAdminEventPublicationFilterChecked(
      page,
      label,
      true,
      'Expected the default tenant-admin events filter to keep Publicados selected.',
    );
    return;
  }

  const checkbox = adminEventPublicationFilterCheckbox(page, label);
  const publishedCheckbox = adminEventPublicationFilterCheckbox(page, 'Publicados');
  await expectAdminEventPublicationFilterChecked(
    page,
    'Publicados',
    true,
    'Expected the tenant-admin events list to default to Publicados before switching filters.',
  );

  if (((await checkbox.getAttribute('aria-checked').catch(() => '')) || '') !== 'true') {
    const targetStatus = adminEventPublicationStatusValue(status);
    const listRefreshPromise = targetStatus
      ? waitForTenantAdminEventsListResponse(page, { status: targetStatus })
      : null;
    await checkbox.click();
    if (listRefreshPromise) {
      await listRefreshPromise;
      await waitForNoVisibleProgressIndicators(
        page,
        `Expected the tenant-admin events list to finish rendering after switching visibility to ${label}.`,
      );
    }
  }

  await expect
    .poll(
      async () => {
        return JSON.stringify({
          target: (await checkbox.getAttribute('aria-checked').catch(() => '')) || '',
          published:
            (await publishedCheckbox.getAttribute('aria-checked').catch(() => '')) || '',
        });
      },
      {
        timeout: appBootTimeoutMs,
        message: `Expected publication filter "${label}" to become the exclusive tenant-admin events selection.`,
      },
    )
    .toBe(JSON.stringify({ target: 'true', published: 'false' }));
}

async function expectAdminEventAbsentFromList(page, eventTitle, message) {
  const candidates = eventTitleLocators(page, eventTitle);
  await expect
    .poll(
      async () => {
        const count = await candidates.count().catch(() => 0);
        for (let index = 0; index < count; index += 1) {
          if (await candidates.nth(index).isVisible().catch(() => false)) {
            return true;
          }
        }
        return false;
      },
      {
        timeout: appBootTimeoutMs,
        message,
      },
    )
    .toBe(false);
}

async function openEventFromAdminList(page, eventTitle, eventId) {
  const eventTitleText = eventTitleLocator(page, eventTitle);
  await scrollUntilVisible(
    page,
    eventTitleText,
    `Expected admin event "${eventTitle}" to appear in the tenant-admin list.`,
  );
  await expect(eventTitleText).toBeVisible({ timeout: appBootTimeoutMs });

  const editUrl = new URL(`/admin/events/${encodeURIComponent(eventId)}/edit`, page.url())
    .toString();
  const editResponse = await page.goto(editUrl, {
    waitUntil: 'domcontentloaded',
  });
  expect(
    editResponse,
    `Expected event "${eventTitle}" to reopen through the canonical edit route after appearing in the admin list.`,
  ).not.toBeNull();
  expect(editResponse.status()).toBeLessThan(400);
  await assertAppBooted(page);
  await enableAccessibilityIfNeeded(page);
}

async function openEventMenuFromAdminList(page, eventTitle) {
  const eventMenuButton = page.getByRole('button', {
    name: new RegExp(`^Ações do evento ${escapeRegExp(eventTitle)}$`, 'i'),
  }).first();
  await scrollUntilVisible(
    page,
    eventMenuButton,
    `Expected event-card menu for "${eventTitle}" to stay reachable in the admin list.`,
  );
  await expect(eventMenuButton).toBeVisible({ timeout: appBootTimeoutMs });
  await eventMenuButton.click();
  await expect(page.getByRole('menuitem', { name: 'Remover' }).last()).toBeVisible({
    timeout: appBootTimeoutMs,
  });
}

async function continueWithoutLocationIfPrompted(page) {
  const continueButton = page.getByRole('button', {
    name: /Continuar sem localizacao|Continuar sem localização/i,
  });
  if (!(await continueButton.count())) {
    return;
  }
  await continueButton.first().click();
}

async function resolveImageCapableProfileType(
  api,
  baseUrl,
  token,
  { requireAvatar = false, requireCover = false } = {},
) {
  const response = await api.get(
    buildApiUrl(baseUrl, '/admin/api/v1/account_profile_types'),
    {
      headers: authHeaders(token),
    },
  );
  expect(response.status(), 'Account profile types must load for admin flows.').toBe(
    200,
  );

  const payload = await response.json();
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const selected =
    rows.find(
      (row) =>
        (!requireAvatar || row?.capabilities?.has_avatar === true) &&
        (!requireCover || row?.capabilities?.has_cover === true) &&
        row?.capabilities?.is_poi_enabled !== true,
    ) ||
    rows.find(
      (row) =>
        (!requireAvatar || row?.capabilities?.has_avatar === true) &&
        (!requireCover || row?.capabilities?.has_cover === true),
    );

  return selected || null;
}

async function ensureImageCapableProfileType(
  api,
  baseUrl,
  token,
  { requireAvatar = false, requireCover = false } = {},
) {
  const existingProfileType = await resolveImageCapableProfileType(
    api,
    baseUrl,
    token,
    {
      requireAvatar,
      requireCover,
    },
  );
  if (existingProfileType) {
    return {
      profileType: existingProfileType,
      temporaryProfileType: null,
    };
  }

  const uniqueSuffix = Date.now();
  const createdPayload = await createAccountProfileType(api, baseUrl, token, {
    type: `playwright-image-${uniqueSuffix}`,
    label: `Playwright Image ${uniqueSuffix}`,
    allowedTaxonomies: [],
    markerColor: '#0E7A6A',
    capabilities: {
      is_favoritable: true,
      has_taxonomies: false,
      has_avatar: requireAvatar,
      has_cover: requireCover,
    },
  });
  const createdType = createdPayload?.data || {};
  const createdTypeKey = createdType?.type?.toString() || '';
  expect(
    createdTypeKey,
    'Autocreated image-capable account profile type must expose its type key.',
  ).toBeTruthy();

  return {
    profileType: createdType,
    temporaryProfileType: createdTypeKey,
  };
}

async function createImageTestProfile(
  api,
  baseUrl,
  token,
  { requireAvatar = false, requireCover = false } = {},
) {
  const { profileType, temporaryProfileType } =
    await ensureImageCapableProfileType(api, baseUrl, token, {
      requireAvatar,
      requireCover,
    });
  const uniqueSuffix = Date.now();
  const payload = {
    name: `Playwright Cover ${uniqueSuffix}`,
    ownership_state: 'unmanaged',
    profile_type: profileType.type,
  };

  if (profileType?.capabilities?.is_poi_enabled === true) {
    payload.location = {
      lat: -20.671339,
      lng: -40.495395,
    };
  }

  const response = await api.post(
    buildApiUrl(baseUrl, '/admin/api/v1/account_onboardings'),
    {
      data: payload,
      headers: authHeaders(token),
    },
  );
  expect(response.status(), 'Account onboarding must succeed for cover test.').toBe(
    201,
  );

  const created = await response.json();
  return {
    accountSlug: created?.data?.account?.slug,
    profileId: created?.data?.account_profile?.id,
    temporaryProfileType,
  };
}

async function createAccountProfileForType(
  api,
  baseUrl,
  token,
  { name, profileType },
) {
  const payload = {
    name,
    ownership_state: 'unmanaged',
    profile_type: profileType.type,
  };

  if (profileType?.capabilities?.is_poi_enabled === true) {
    payload.location = {
      lat: -20.671339,
      lng: -40.495395,
    };
  }

  const response = await api.post(
    buildApiUrl(baseUrl, '/admin/api/v1/account_onboardings'),
    {
      data: payload,
      headers: authHeaders(token),
    },
  );
  expect(response.status(), `Account onboarding must succeed for ${name}.`).toBe(
    201,
  );
  const created = await response.json();
  return {
    accountSlug: created?.data?.account?.slug,
    profileId: created?.data?.account_profile?.id,
    profileSlug:
      created?.data?.account_profile?.slug ||
      created?.data?.account?.slug ||
      '',
    displayName:
      created?.data?.account_profile?.display_name ||
      created?.data?.account?.name ||
      name,
  };
}

async function createPublicAccountProfileForType(
  api,
  baseUrl,
  token,
  { name, profileType },
) {
  const created = await createAccountProfileForType(
    api,
    baseUrl,
    token,
    { name, profileType },
  );
  await publishAccount(api, baseUrl, token, created.accountSlug);
  return created;
}

async function publishAccount(api, baseUrl, token, accountSlug) {
  const response = await api.patch(
    buildApiUrl(baseUrl, `/admin/api/v1/accounts/${accountSlug}`),
    {
      headers: authHeaders(token),
      data: {
        publication: {
          status: 'published',
        },
      },
    },
  );
  expect(response.status(), `Account ${accountSlug} publish must succeed.`).toBe(200);
  const payload = normalizePayload(await response.json());
  expect(
    payload?.publication?.status?.toString() || '',
    `Account ${accountSlug} must persist the canonical published status.`,
  ).toBe('published');
}

async function deleteEventType(api, baseUrl, token, eventTypeId) {
  if (!eventTypeId) {
    return;
  }

  return api.delete(
    buildApiUrl(baseUrl, `/admin/api/v1/event_types/${eventTypeId}`),
    {
      headers: authHeaders(token),
      failOnStatusCode: false,
    },
  );
}

async function createTaxonomy(
  api,
  baseUrl,
  token,
  {
    slug,
    name,
    appliesTo,
    terms,
    icon = 'category',
    color = '#AA5500',
  },
) {
  const response = await api.post(
    buildApiUrl(baseUrl, '/admin/api/v1/taxonomies'),
    {
      headers: authHeaders(token),
      data: {
        slug,
        name,
        applies_to: appliesTo,
        icon,
        color,
      },
    },
  );
  expect(response.status(), `Taxonomy ${slug} must be created.`).toBe(201);
  const payload = await response.json();
  const taxonomyId = payload?.data?.id?.toString() || '';
  expect(taxonomyId, `Taxonomy ${slug} must return an id.`).toBeTruthy();

  for (const term of terms) {
    const termResponse = await api.post(
      buildApiUrl(baseUrl, `/admin/api/v1/taxonomies/${taxonomyId}/terms`),
      {
        headers: authHeaders(token),
        data: term,
      },
    );
    expect(
      termResponse.status(),
      `Taxonomy term ${term.slug} must be created for ${slug}.`,
    ).toBe(201);
  }

  return { taxonomyId, slug, name, terms };
}

async function deleteTaxonomy(api, baseUrl, token, taxonomyId) {
  if (!taxonomyId) {
    return;
  }

  await api.delete(
    buildApiUrl(baseUrl, `/admin/api/v1/taxonomies/${taxonomyId}`),
    {
      headers: authHeaders(token),
      failOnStatusCode: false,
    },
  );
}

async function waitForTaxonomyRegistry(api, baseUrl, token, slugs) {
  await expect
    .poll(
      async () => {
        const response = await api.get(
          buildApiUrl(baseUrl, '/admin/api/v1/taxonomies?page=1&page_size=500'),
          {
            headers: authHeaders(token),
          },
        );
        if (response.status() >= 400) {
          return false;
        }
        const payload = await response.json();
        const rows = Array.isArray(payload?.data) ? payload.data : [];
        const available = new Set(
          rows.map((entry) => entry?.slug?.toString()).filter(Boolean),
        );
        return slugs.every((slug) => available.has(slug));
      },
      {
        timeout: appBootTimeoutMs,
        message:
          'Expected newly created taxonomies to appear in the tenant-admin taxonomy registry before opening type editors.',
      },
    )
    .toBeTruthy();
}

async function waitForAccountProfileTypeRegistry(api, baseUrl, token, types) {
  await expect
    .poll(
      async () => {
        const response = await api.get(
          buildApiUrl(baseUrl, '/admin/api/v1/account_profile_types'),
          {
            headers: authHeaders(token),
          },
        );
        if (response.status() >= 400) {
          return false;
        }
        const payload = await response.json();
        const rows = Array.isArray(payload?.data) ? payload.data : [];
        const available = new Set(
          rows.map((entry) => entry?.type?.toString()).filter(Boolean),
        );
        return types.every((type) => available.has(type));
      },
      {
        timeout: appBootTimeoutMs,
        message:
          'Expected newly created account profile types to appear in the admin registry before opening onboarding flows.',
      },
    )
    .toBeTruthy();
}

async function waitForEventTypeRegistry(api, baseUrl, token, slugs) {
  await expect
    .poll(
      async () => {
        const response = await api.get(
          buildApiUrl(baseUrl, '/admin/api/v1/event_types?page=1&page_size=500'),
          {
            headers: authHeaders(token),
          },
        );
        if (response.status() >= 400) {
          return false;
        }
        const payload = await response.json();
        const rows = Array.isArray(payload?.data) ? payload.data : [];
        const available = new Set(
          rows.map((entry) => entry?.slug?.toString()).filter(Boolean),
        );
        return slugs.every((slug) => available.has(slug));
      },
      {
        timeout: appBootTimeoutMs,
        message:
          'Expected newly created event types to appear in the admin registry before opening event create flows.',
      },
    )
    .toBeTruthy();
}

async function createAccountProfileType(
  api,
  baseUrl,
  token,
  {
    type,
    label,
    allowedTaxonomies,
    markerColor,
    iconColor = '#FFFFFF',
    capabilities = {},
  },
) {
  const resolvedCapabilities = {
    is_favoritable: true,
    has_taxonomies: (allowedTaxonomies || []).length > 0,
    has_avatar: true,
    has_cover: false,
    ...capabilities,
  };
  const response = await api.post(
    buildApiUrl(baseUrl, '/admin/api/v1/account_profile_types'),
    {
      headers: authHeaders(token),
      data: {
        type,
        label,
        labels: {
          singular: label,
          plural: `${label}s`,
        },
        allowed_taxonomies: allowedTaxonomies,
        capabilities: resolvedCapabilities,
        visual: {
          mode: 'icon',
          icon: 'place',
          color: markerColor,
          icon_color: iconColor,
        },
      },
    },
  );
  expect(response.status(), `Account profile type ${type} must be created.`).toBe(
    201,
  );
  await waitForAccountProfileTypeRegistry(api, baseUrl, token, [type]);
  return response.json();
}

async function updateAccountProfileType(api, baseUrl, token, type, payload) {
  const response = await api.patch(
    buildApiUrl(
      baseUrl,
      `/admin/api/v1/account_profile_types/${encodeURIComponent(type)}`,
    ),
    {
      headers: authHeaders(token),
      data: payload,
    },
  );
  expect(response.status(), `Account profile type ${type} must be updated.`).toBe(
    200,
  );
  return response.json();
}

async function deleteAccountProfileType(api, baseUrl, token, type) {
  if (!type) {
    return;
  }

  return api.delete(
    buildApiUrl(
      baseUrl,
      `/admin/api/v1/account_profile_types/${encodeURIComponent(type)}`,
    ),
    {
      headers: authHeaders(token),
      failOnStatusCode: false,
    },
  );
}

async function forceDeleteAccountProfile(api, baseUrl, token, profileId) {
  if (!profileId) {
    return;
  }

  return api.post(
    buildApiUrl(
      baseUrl,
      `/admin/api/v1/account_profiles/${encodeURIComponent(profileId)}/force_delete`,
    ),
    {
      headers: authHeaders(token),
      failOnStatusCode: false,
    },
  );
}

async function createStaticProfileType(
  api,
  baseUrl,
  token,
  {
    type,
    label,
    allowedTaxonomies,
    markerColor,
    iconColor = '#FFFFFF',
  },
) {
  const response = await api.post(
    buildApiUrl(baseUrl, '/admin/api/v1/static_profile_types'),
    {
      headers: authHeaders(token),
      data: {
        type,
        label,
        map_category: 'beach',
        allowed_taxonomies: allowedTaxonomies,
        capabilities: {
          is_poi_enabled: true,
          has_taxonomies: true,
          has_content: true,
        },
        visual: {
          mode: 'icon',
          icon: 'place',
          color: markerColor,
          icon_color: iconColor,
        },
      },
    },
  );
  expect(response.status(), `Static profile type ${type} must be created.`).toBe(
    201,
  );
  return response.json();
}

async function createEventType(
  api,
  baseUrl,
  token,
  {
    name,
    slug,
    allowedTaxonomies,
    icon = 'celebration',
    color = '#B51E5B',
    iconColor = '#FFFFFF',
  },
) {
  const response = await api.post(
    buildApiUrl(baseUrl, '/admin/api/v1/event_types'),
    {
      headers: authHeaders(token),
      data: {
        name,
        slug,
        allowed_taxonomies: allowedTaxonomies,
        visual: {
          mode: 'icon',
          icon,
          color,
          icon_color: iconColor,
        },
      },
    },
  );
  expect(response.status(), `Event type ${slug} must be created.`).toBe(201);
  await waitForEventTypeRegistry(api, baseUrl, token, [slug]);
  return response.json();
}

async function fetchStaticProfileTypeListEntry(
  api,
  baseUrl,
  token,
  type,
) {
  const response = await api.get(
    buildApiUrl(baseUrl, '/admin/api/v1/static_profile_types?page=1&page_size=500'),
    {
      headers: authHeaders(token),
    },
  );
  expect(response.status(), 'Static profile type index must load for readback.').toBe(
    200,
  );
  const payload = await response.json();
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return rows.find((row) => row?.type?.toString() === type) || null;
}

async function fetchAccountProfileTypeListEntry(
  api,
  baseUrl,
  token,
  type,
) {
  const response = await api.get(
    buildApiUrl(baseUrl, '/admin/api/v1/account_profile_types?page=1&page_size=500'),
    {
      headers: authHeaders(token),
    },
  );
  expect(response.status(), 'Account profile type index must load for readback.').toBe(
    200,
  );
  const payload = await response.json();
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return rows.find((row) => row?.type?.toString() === type) || null;
}

async function deleteStaticProfileType(api, baseUrl, token, type) {
  if (!type) {
    return;
  }

  await api.delete(
    buildApiUrl(
      baseUrl,
      `/admin/api/v1/static_profile_types/${encodeURIComponent(type)}`,
    ),
    {
      headers: authHeaders(token),
      failOnStatusCode: false,
    },
  );
}

async function expectSelectedToggleChip(page, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedAttributeValue = label.replace(/["\\]/g, '\\$&');
  const switchChip = page.getByRole('switch', {
    name: new RegExp(escaped, 'i'),
  });
  const checkboxChip = page.getByRole('checkbox', {
    name: new RegExp(escaped, 'i'),
  });
  const namedButtonChip = page.getByRole('button', {
    name: new RegExp(escaped, 'i'),
  });
  const ariaFallbackChip = page
    .locator(`[aria-label*="${escapedAttributeValue}"]`)
    .first();
  const textFallbackChip = page.getByText(new RegExp(escaped, 'i')).first();

  async function expectLocatorState(locator, message) {
    await expect
      .poll(
        async () => {
          return locator
            .first()
            .evaluate((element, expectedLabel) => {
              let current = element;
              for (let depth = 0; depth < 8 && current; depth += 1) {
                const state =
                  current.getAttribute('aria-pressed') ||
                  current.getAttribute('aria-selected') ||
                  current.getAttribute('aria-checked') ||
                  current.getAttribute('data-selected') ||
                  '';
                if (state === 'true') {
                  return state;
                }
                if (depth <= 2) {
                  const normalizedText = (current.textContent || '').trim();
                  const hasLeadingCheckGlyph =
                    normalizedText.startsWith('check') ||
                    normalizedText.startsWith('done');
                  const hasLocalSelectionIcon =
                    current.querySelector('svg') !== null ||
                    current.querySelector('[data-icon*=\"check\" i]') !== null ||
                    current.querySelector('[aria-label*=\"check\" i]') !== null;
                  if (
                    normalizedText.toLowerCase().includes(
                      String(expectedLabel).trim().toLowerCase(),
                    ) &&
                    (hasLeadingCheckGlyph || hasLocalSelectionIcon)
                  ) {
                    return 'true';
                  }
                }
                current = current.parentElement;
              }
              return '';
            }, label)
            .catch(() => '');
        },
        {
          timeout: appBootTimeoutMs,
          message,
        },
      )
      .toBe('true');
  }

  if ((await switchChip.count()) > 0) {
    await expectLocatorState(
      switchChip,
      `Expected taxonomy switch chip "${label}" to reopen selected.`,
    );
    return;
  }

  if ((await checkboxChip.count()) > 0) {
    await expectLocatorState(
      checkboxChip,
      `Expected taxonomy checkbox chip "${label}" to reopen selected.`,
    );
    return;
  }

  if ((await namedButtonChip.count()) > 0) {
    await expectLocatorState(
      namedButtonChip,
      `Expected taxonomy button chip "${label}" to reopen selected.`,
    );
    return;
  }

  if ((await ariaFallbackChip.count()) > 0) {
    await expectLocatorState(
      ariaFallbackChip,
      `Expected taxonomy aria chip "${label}" to reopen selected.`,
    );
    return;
  }

  await scrollUntilVisible(
    page,
    textFallbackChip,
    `Expected taxonomy chip "${label}" to appear before asserting selected state.`,
  );
  await expectLocatorState(
    textFallbackChip,
    `Expected taxonomy chip "${label}" to reopen selected.`,
  );
}

async function createEventTypeWithTypeAsset(
  api,
  baseUrl,
  token,
  {
    name,
    slug,
    description = 'Tipo com imagem canônica',
  },
) {
  const response = await api.post(
    buildApiUrl(baseUrl, '/admin/api/v1/event_types'),
    {
      headers: authHeaders(token),
      multipart: {
        name,
        slug,
        description,
        'visual[mode]': 'image',
        'visual[image_source]': 'type_asset',
        type_asset: {
          name: 'event-type-asset.png',
          mimeType: 'image/png',
          buffer: fixtureImagePayload().buffer,
        },
      },
    },
  );
  expect(
    response.status(),
    'Seeded event type with type asset must be created successfully.',
  ).toBe(201);
  return response.json();
}

test('@mutation tenant-admin account-profile cover upload persists and renders after reload', async ({
  browser,
}) => {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  let freshBrowser;
  let browserContext;
  let profileId = null;
  let accountSlug = null;
  let temporaryProfileType = null;
  let session = null;

  try {
    session = await loginTenantAdmin(api, baseUrl);
    const created = await createImageTestProfile(api, baseUrl, session.token, {
      requireCover: true,
    });
    profileId = created.profileId;
    accountSlug = created.accountSlug;
    temporaryProfileType = created.temporaryProfileType;

    expect(created.accountSlug, 'Created onboarding must return an account slug.').toBeTruthy();
    expect(profileId, 'Created onboarding must return an account profile id.').toBeTruthy();

    const editUrl = buildApiUrl(
      baseUrl,
      `/admin/accounts/${created.accountSlug}/profiles/${profileId}/edit`,
    );
    const primaryPageBundle = await createFreshAuthenticatedTenantAdminPage(
      session,
    );
    freshBrowser = primaryPageBundle.browser;
    browserContext = primaryPageBundle.context;
    const page = primaryPageBundle.page;
    const collectors = installFailureCollectors(page);

    logStep('cover', `open edit route ${editUrl}`);
    const initialResponse = await page.goto(editUrl, {
      waitUntil: 'domcontentloaded',
    });
    expect(initialResponse, 'Edit screen response should be available.').not.toBeNull();
    expect(initialResponse.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);

    await expect(page.getByRole('button', { name: 'Adicionar capa' })).toBeVisible({
      timeout: appBootTimeoutMs,
    });

    await attachImageFromDevice(page, {
      flow: 'cover',
      buttonName: 'Adicionar capa',
      cropTitle: 'Recortar capa',
    });

    const saveResponsePromise = page.waitForResponse((response) => {
      const method = response.request().method().toUpperCase();
      return (
        (method === 'PATCH' || method === 'POST') &&
        response.url().includes(`/admin/api/v1/account_profiles/${profileId}`) &&
        response.status() < 400
      );
    });

    logStep('cover', 'confirm crop and wait for autosave');
    const [saveResponse] = await Promise.all([
      saveResponsePromise,
      page.getByRole('button', { name: 'Usar' }).click(),
    ]);
    const savePayload = await saveResponse.json();
    const coverUrl = savePayload?.data?.cover_url?.toString() || '';
    logStep('cover', `autosave returned ${coverUrl}`);
    expect(coverUrl, 'Cover save must return a canonical cover URL.').toBeTruthy();

    const unpublishedCoverResponse = await api.get(coverUrl, {
      failOnStatusCode: false,
    });
    expect(
      unpublishedCoverResponse.status(),
      'Persisted cover URL must stay private while the parent Account remains unpublished.',
    ).toBe(404);
    await disposeApiResponse(unpublishedCoverResponse);

    await publishAccount(api, baseUrl, session.token, created.accountSlug);

    const publishedCoverResponse = await api.get(coverUrl, {
      failOnStatusCode: false,
    });
    expect(
      publishedCoverResponse.status(),
      'Persisted cover URL must become publicly readable after publication.',
    ).toBe(200);
    await disposeApiResponse(publishedCoverResponse);

    const verificationPage = await browserContext.newPage();
    const verificationCollectors = installFailureCollectors(verificationPage);
    const coverStatuses = [];

    verificationPage.on('response', (response) => {
      if (response.url() === coverUrl) {
        coverStatuses.push(response.status());
      }
    });

    logStep('cover', 'reload edit route to validate rendered persisted cover');
    const verificationResponse = await verificationPage.goto(editUrl, {
      waitUntil: 'domcontentloaded',
    });
    expect(
      verificationResponse,
      'Verification edit response should be available.',
    ).not.toBeNull();
    expect(verificationResponse.status()).toBeLessThan(400);
    await assertAppBooted(verificationPage);
    await enableAccessibilityIfNeeded(verificationPage);

    await expect
      .poll(() => coverStatuses.some((status) => status === 200), {
        timeout: appBootTimeoutMs,
        message: 'Expected the persisted cover image request to succeed after reload.',
      })
      .toBeTruthy();
    logStep('cover', 'persisted cover returned 200 after reload');

    await assertNoBrowserFailures(collectors);
    await assertNoBrowserFailures(verificationCollectors);
  } finally {
    if (session?.token) {
      await cleanupOnboardedAccount(api, baseUrl, session.token, accountSlug);
      await deleteAccountProfileType(
        api,
        baseUrl,
        session.token,
        temporaryProfileType,
      );
    }
    if (browserContext) {
      await browserContext.close();
    }
    if (freshBrowser) {
      await freshBrowser.close().catch(() => {});
    }
    await api.dispose();
  }
});

test('@mutation tenant-admin event rich text toolbar authors HTTPS link, persists, reads back, taps in public Sobre, and records tap outcome', async ({ browser }) => {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  const startedAt = new Date().toISOString();
  const authoredText = 'Belluga HTTPS runtime link';
  const explicitHttpsUrl = 'https://example.com/belluga-rich-text-event';
  const expectedHtml = `<p><a href="${explicitHttpsUrl}">${authoredText}</a></p>`;
  let browserContext;
  let session = null;
  let eventId = null;
  let eventTypeId = null;
  let runtimeEvidence = null;

  try {
    session = await loginTenantAdmin(api, baseUrl);
    const unique = Date.now();
    const eventTypeName = `PW Rich Text Event Type ${unique}`;
    const createdEventType = normalizePayload(
      await createEventType(api, baseUrl, session.token, {
        name: eventTypeName,
        slug: `pw-rich-text-event-${unique}`,
        allowedTaxonomies: [],
      }),
    );
    eventTypeId = createdEventType?.id?.toString() || null;
    expect(eventTypeId, 'Rich-text event type must be created.').toBeTruthy();

    const pageBundle = await createAuthenticatedTenantAdminPage(browser, session);
    browserContext = pageBundle.context;
    const page = pageBundle.page;

    const response = await page.goto(buildApiUrl(baseUrl, '/admin/events/create'), {
      waitUntil: 'domcontentloaded',
    });
    expect(response, 'Tenant-admin event create route must respond.').not.toBeNull();
    expect(response.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);
    await fillFlutterTextField(page, 'Título', `PW Rich Text Event ${unique}`);
    await selectDropdownOption(page, {
      flow: 'event-rich-text-runtime',
      fieldLabel: 'Tipo',
      optionText: eventTypeName,
      logStep,
    });
    await pickReadOnlyTenantAdminEventDateTime(page, { daysFromNow: 1 });
    await scrollUntilVisible(
      page,
      page.getByText('Localização').first(),
      'Expected the location section in the event bootstrap form.',
    );
    await selectDropdownOption(page, {
      flow: 'event-rich-text-runtime',
      fieldLabel: 'Modo',
      optionText: 'Online',
      logStep,
    });
    await fillFlutterTextField(page, 'URL online', 'https://example.com/live');
    const createResponsePromise = page.waitForResponse((candidate) =>
      candidate.request().method() === 'POST' &&
      candidate.url().includes('/admin/api/v1/events'),
    );
    await page.getByRole('button', { name: 'Criar evento' }).last().click();
    const createResponse = await createResponsePromise;
    expect(createResponse.status(), 'Rich-text event bootstrap must succeed.').toBe(201);
    eventId = normalizePayload(await createResponse.json())?.event_id?.toString() || null;
    expect(eventId, 'Rich-text event bootstrap must return event_id.').toBeTruthy();
    await expect(page).toHaveURL(
      new RegExp(`/admin/events/${escapeRegExp(eventId)}/edit$`),
      { timeout: appBootTimeoutMs },
    );
    await expect(page.getByRole('button', { name: 'Salvar alterações' }).last()).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    const editor = page.getByLabel('Descrição (opcional)', { exact: true });
    const linkButton = page.getByRole('button', {
      name: 'Descrição (opcional): Inserir URL',
      exact: true,
    });
    await editor.click();
    await editor.pressSequentially(authoredText, { delay: 10 });
    await selectRichTextEditorContents(page, editor);
    await linkButton.click();
    const linkDialog = page.getByRole('alertdialog');
    await expect(linkDialog).toBeVisible({ timeout: appBootTimeoutMs });
    await expect(
      linkDialog.getByLabel('Texto', { exact: true }),
    ).toHaveValue(authoredText);
    const okButton = linkDialog.getByRole('button', { name: 'Ok' });
    await linkDialog.getByLabel('Link').fill('http://example.com/not-allowed');
    await expect(okButton).toBeDisabled();
    await linkDialog.getByLabel('Link').fill(explicitHttpsUrl);
    await expect(okButton).toBeEnabled();
    await okButton.click();
    await expect(linkDialog).toBeHidden({ timeout: appBootTimeoutMs });

    await selectDropdownOption(page, {
      flow: 'event-rich-text-runtime',
      fieldLabel: 'Status',
      optionText: 'Published',
      logStep,
    });
    const saveResponsePromise = page.waitForResponse((candidate) =>
      candidate.request().method() === 'PATCH' &&
      candidate.url().includes(`/admin/api/v1/events/${eventId}`),
    );
    await clickSaveChanges(page);
    const saveResponse = await saveResponsePromise;
    expect(saveResponse.status(), 'Rich-text Event save must succeed.').toBe(200);
    const saveRequestPayload = saveResponse.request().postDataJSON();
    expect(
      saveRequestPayload?.content?.toString() || '',
      'Event PATCH request must carry the exact authored HTTPS anchor.',
    ).toBe(expectedHtml);
    const savePayload = normalizePayload(await saveResponse.json());
    expect(
      savePayload?.content?.toString() || '',
      'Event PATCH response must preserve the exact authored HTTPS anchor.',
    ).toBe(expectedHtml);

    const savedEvent = await fetchAdminEvent(api, baseUrl, session.token, eventId);
    expect(savedEvent?.content?.toString() || '', 'Event backend rich-text readback must be exact.').toBe(expectedHtml);
    expect(savedEvent?.publication?.status?.toString() || '').toBe('published');
    const eventRouteRef =
      savedEvent?.slug?.toString() ||
      savedEvent?.event_id?.toString() ||
      eventId;
    const publicApiResponse = await api.get(
      buildApiUrl(baseUrl, `/api/v1/events/${encodeURIComponent(eventRouteRef)}`),
      { headers: authHeaders(session.token) },
    );
    expect(publicApiResponse.status(), 'Public Event API readback must succeed.').toBe(200);
    const publicEvent = normalizePayload(await publicApiResponse.json());
    expect(
      publicEvent?.content?.toString() || '',
      'Public Event API projection must preserve the exact authored HTTPS anchor.',
    ).toBe(expectedHtml);
    const publicResponse = await page.goto(
      buildApiUrl(baseUrl, `/agenda/evento/${encodeURIComponent(eventRouteRef)}`),
      { waitUntil: 'domcontentloaded' },
    );
    expect(publicResponse, 'Public Event route must respond.').not.toBeNull();
    expect(publicResponse.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);
    await expect(page.getByRole('button', { name: 'Sobre', exact: true })).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    const publicLink = await resolveUniqueFlutterTappableText(page, authoredText);
    const popupPromise = browserContext.waitForEvent('page');
    await publicLink.click();
    const popup = await popupPromise;
    await expect.poll(() => popup.url(), { timeout: appBootTimeoutMs }).toBe(explicitHttpsUrl);
    await popup.close();

    runtimeEvidence = {
      schema_version: 2,
      lane: 'event-web',
      run_id: process.env.RICH_TEXT_RUNTIME_RUN_ID,
      served_build_fingerprint: await page.evaluate(() => window.__WEB_BUILD_SHA__ || 'unknown'),
      target_base_url: baseUrl,
      tenant_id: new URL(baseUrl).hostname,
      fixture_ids: [eventId, eventTypeId],
      platform: 'web',
      runtime_identity: 'playwright-chromium',
      backend_identity: new URL(baseUrl).origin,
      steps: ['toolbar_authoring', 'delta_or_html', 'backend_readback', 'public_render', 'anchor_tap', 'tap_outcome'],
      lifecycle: {
        started_at: startedAt,
        completed_at: new Date().toISOString(),
      },
      tap_outcome: {
        status: 'opened',
        target_urls: [explicitHttpsUrl],
      },
    };
  } finally {
    const eventCleanup = await deleteEvent(api, baseUrl, session?.token, eventId);
    const typeCleanup = await deleteEventType(api, baseUrl, session?.token, eventTypeId);
    if (eventCleanup) {
      expect([200, 204, 404]).toContain(eventCleanup.status());
    }
    if (typeCleanup) {
      expect([200, 204, 404]).toContain(typeCleanup.status());
    }
    if (browserContext) {
      await browserContext.close();
    }
    await api.dispose();
  }
  const runtimeOutputDir = (process.env.RICH_TEXT_RUNTIME_OUTPUT_DIR || '').trim();
  if (runtimeOutputDir && runtimeEvidence) {
    runtimeEvidence.lifecycle.cleanup_completed_at = new Date().toISOString();
    runtimeEvidence.lifecycle.cleanup_succeeded = true;
    writeRuntimeActualRun(runtimeOutputDir, runtimeEvidence);
  }
});

test('@mutation tenant-admin account-profile rich text toolbar authors HTTPS link, persists, reads back, taps in public detail, and records tap outcome', async ({ browser }) => {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  const startedAt = new Date().toISOString();
  const bioText = 'Belluga HTTPS profile bio link';
  const contentText = 'Belluga HTTPS profile content link';
  const bioUrl = 'https://example.com/belluga-profile-bio';
  const contentUrl = 'https://example.com/belluga-profile-content';
  const expectedBio = `<p><a href="${bioUrl}">${bioText}</a></p>`;
  const expectedContent = `<p><a href="${contentUrl}">${contentText}</a></p>`;
  let browserContext;
  let session = null;
  let accountSlug = null;
  let profileTypeKey = null;
  let profileId = null;
  let runtimeEvidence = null;

  try {
    session = await loginTenantAdmin(api, baseUrl);
    const unique = Date.now();
    const createdType = normalizePayload(
      await createAccountProfileType(api, baseUrl, session.token, {
        type: `pw-rich-text-${unique}`,
        label: `PW Rich Text ${unique}`,
        allowedTaxonomies: [],
        markerColor: '#0F766E',
        capabilities: {
          is_favoritable: false,
          is_publicly_discoverable: true,
          is_publicly_navigable: true,
          has_avatar: false,
          has_cover: false,
          has_taxonomies: false,
          has_content: true,
          has_bio: true,
        },
      }),
    );
    profileTypeKey = createdType?.type?.toString() || '';
    const created = await createPublicAccountProfileForType(
      api,
      baseUrl,
      session.token,
      {
        name: `PW Rich Text Profile ${unique}`,
        profileType: createdType,
      },
    );
    accountSlug = created.accountSlug;
    profileId = created.profileId?.toString() || null;
    expect(profileId, 'Rich-text account profile id must be created.').toBeTruthy();

    const pageBundle = await createAuthenticatedTenantAdminPage(browser, session);
    browserContext = pageBundle.context;
    const page = pageBundle.page;
    const response = await page.goto(
      buildApiUrl(
        baseUrl,
        `/admin/accounts/${accountSlug}/profiles/${created.profileId}/edit`,
      ),
      { waitUntil: 'domcontentloaded' },
    );
    expect(response, 'Tenant-admin account-profile edit route must respond.').not.toBeNull();
    expect(response.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);
    const editors = [
      {
        locator: page.getByLabel('Conteudo', { exact: true }),
        label: 'Conteudo',
        text: contentText,
        url: contentUrl,
      },
      {
        locator: page.getByLabel('Bio', { exact: true }),
        label: 'Bio',
        text: bioText,
        url: bioUrl,
      },
    ];
    for (const editor of editors) {
      const linkButton = page.getByRole('button', {
        name: `${editor.label}: Inserir URL`,
        exact: true,
      });
      await expect(linkButton).toHaveCount(1);
      await linkButton.scrollIntoViewIfNeeded();
      await expect(linkButton).toBeVisible();
      await editor.locator.click();
      await editor.locator.pressSequentially(editor.text, { delay: 10 });
      await selectRichTextEditorContents(page, editor.locator);
      await linkButton.click();
      const dialog = page.getByRole('alertdialog');
      await expect(dialog).toBeVisible({ timeout: appBootTimeoutMs });
      await expect(dialog.getByLabel('Texto', { exact: true })).toHaveValue(editor.text);
      const linkInput = dialog.getByLabel('Link');
      await linkInput.click();
      await linkInput.pressSequentially(editor.url, { delay: 10 });
      await expect(linkInput).toHaveValue(editor.url);
      await expect(dialog.getByRole('button', { name: 'Ok' })).toBeEnabled();
      await dialog.getByRole('button', { name: 'Ok' }).click();
      await expect(dialog).toBeHidden({ timeout: appBootTimeoutMs });
    }

    const saveResponsePromise = waitForSuccessfulAccountProfilePatchResponse(
      page,
      profileId,
    );
    await clickSaveChanges(page);
    const saveResponse = await saveResponsePromise;
    const saveRequestPayload = saveResponse.request().postDataJSON();
    expect(saveRequestPayload?.bio?.toString() || '').toBe(expectedBio);
    expect(saveRequestPayload?.content?.toString() || '').toBe(expectedContent);
    const savePayload = normalizePayload(await saveResponse.json());
    expect(savePayload?.bio?.toString() || '').toBe(expectedBio);
    expect(savePayload?.content?.toString() || '').toBe(expectedContent);

    const adminProfile = await fetchAdminProfile(
      api,
      baseUrl,
      session.token,
      profileId,
    );
    expect(adminProfile?.bio?.toString() || '').toBe(expectedBio);
    expect(adminProfile?.content?.toString() || '').toBe(expectedContent);
    const publicProfile = await fetchPublicProfile(
      api,
      baseUrl,
      session.token,
      created.profileSlug,
    );
    expect(publicProfile?.bio?.toString() || '').toBe(expectedBio);
    expect(publicProfile?.content?.toString() || '').toBe(expectedContent);

    const publicResponse = await page.goto(
      buildApiUrl(baseUrl, `/parceiro/${encodeURIComponent(created.profileSlug)}`),
      { waitUntil: 'domcontentloaded' },
    );
    expect(publicResponse, 'Public Account Profile route must respond.').not.toBeNull();
    expect(publicResponse.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);
    for (const target of [
      { text: bioText, url: bioUrl },
      { text: contentText, url: contentUrl },
    ]) {
      const publicLink = await resolveUniqueFlutterTappableText(page, target.text);
      const popupPromise = browserContext.waitForEvent('page');
      await publicLink.click();
      const popup = await popupPromise;
      await expect.poll(() => popup.url(), { timeout: appBootTimeoutMs }).toBe(target.url);
      await popup.close();
    }

    runtimeEvidence = {
      schema_version: 2,
      lane: 'account-profile-web',
      run_id: process.env.RICH_TEXT_RUNTIME_RUN_ID,
      served_build_fingerprint: await page.evaluate(() => window.__WEB_BUILD_SHA__ || 'unknown'),
      target_base_url: baseUrl,
      tenant_id: new URL(baseUrl).hostname,
      fixture_ids: [profileId, accountSlug, profileTypeKey],
      platform: 'web',
      runtime_identity: 'playwright-chromium',
      backend_identity: new URL(baseUrl).origin,
      steps: ['toolbar_authoring', 'delta_or_html', 'backend_readback', 'public_render', 'anchor_tap', 'tap_outcome'],
      lifecycle: {
        started_at: startedAt,
        completed_at: new Date().toISOString(),
      },
      tap_outcome: {
        status: 'opened',
        target_urls: [bioUrl, contentUrl],
      },
    };
  } finally {
    await cleanupOnboardedAccount(
      api,
      baseUrl,
      session?.token,
      accountSlug,
    );
    const profileCleanup = await forceDeleteAccountProfile(
      api,
      baseUrl,
      session?.token,
      profileId,
    );
    if (profileCleanup) {
      expect([200, 204, 404]).toContain(profileCleanup.status());
    }
    const typeCleanup = await deleteAccountProfileType(
      api,
      baseUrl,
      session?.token,
      profileTypeKey,
    );
    if (typeCleanup) {
      expect([200, 204, 404]).toContain(typeCleanup.status());
    }
    if (browserContext) {
      await browserContext.close();
    }
    await api.dispose();
  }
  const runtimeOutputDir = (process.env.RICH_TEXT_RUNTIME_OUTPUT_DIR || '').trim();
  if (runtimeOutputDir && runtimeEvidence) {
    runtimeEvidence.lifecycle.cleanup_completed_at = new Date().toISOString();
    runtimeEvidence.lifecycle.cleanup_succeeded = true;
    writeRuntimeActualRun(runtimeOutputDir, runtimeEvidence);
  }
});

test('@mutation tenant-admin account-profile avatar upload persists and renders after reload', async ({
  browser,
}) => {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  let freshBrowser;
  let browserContext;
  let profileId = null;
  let accountSlug = null;
  let temporaryProfileType = null;
  let session = null;

  try {
    session = await loginTenantAdmin(api, baseUrl);
    const created = await createImageTestProfile(api, baseUrl, session.token, {
      requireAvatar: true,
    });
    profileId = created.profileId;
    accountSlug = created.accountSlug;
    temporaryProfileType = created.temporaryProfileType;

    expect(created.accountSlug, 'Created onboarding must return an account slug.').toBeTruthy();
    expect(profileId, 'Created onboarding must return an account profile id.').toBeTruthy();

    const editUrl = buildApiUrl(
      baseUrl,
      `/admin/accounts/${created.accountSlug}/profiles/${profileId}/edit`,
    );
    const primaryPageBundle = await createFreshAuthenticatedTenantAdminPage(
      session,
    );
    freshBrowser = primaryPageBundle.browser;
    browserContext = primaryPageBundle.context;
    const page = primaryPageBundle.page;
    const collectors = installFailureCollectors(page);

    logStep('avatar', `open edit route ${editUrl}`);
    const initialResponse = await page.goto(editUrl, {
      waitUntil: 'domcontentloaded',
    });
    expect(initialResponse, 'Edit screen response should be available.').not.toBeNull();
    expect(initialResponse.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);

    await expect(page.getByRole('button', { name: 'Adicionar avatar' })).toBeVisible({
      timeout: appBootTimeoutMs,
    });

    await attachImageFromDevice(page, {
      flow: 'avatar',
      buttonName: 'Adicionar avatar',
      cropTitle: 'Recortar avatar',
    });

    const saveResponsePromise = page.waitForResponse((response) => {
      const method = response.request().method().toUpperCase();
      return (
        (method === 'PATCH' || method === 'POST') &&
        response.url().includes(`/admin/api/v1/account_profiles/${profileId}`) &&
        response.status() < 400
      );
    });

    logStep('avatar', 'confirm crop and wait for autosave');
    const [saveResponse] = await Promise.all([
      saveResponsePromise,
      page.getByRole('button', { name: 'Usar' }).click(),
    ]);
    const savePayload = await saveResponse.json();
    const avatarUrl = savePayload?.data?.avatar_url?.toString() || '';
    logStep('avatar', `autosave returned ${avatarUrl}`);
    expect(avatarUrl, 'Avatar save must return a canonical avatar URL.').toBeTruthy();

    const unpublishedAvatarResponse = await api.get(avatarUrl, {
      failOnStatusCode: false,
    });
    expect(
      unpublishedAvatarResponse.status(),
      'Persisted avatar URL must stay private while the parent Account remains unpublished.',
    ).toBe(404);
    await disposeApiResponse(unpublishedAvatarResponse);

    await publishAccount(api, baseUrl, session.token, created.accountSlug);

    const publishedAvatarResponse = await api.get(avatarUrl, {
      failOnStatusCode: false,
    });
    expect(
      publishedAvatarResponse.status(),
      'Persisted avatar URL must become publicly readable after publication.',
    ).toBe(200);
    await disposeApiResponse(publishedAvatarResponse);

    const verificationPage = await browserContext.newPage();
    const verificationCollectors = installFailureCollectors(verificationPage);
    const avatarStatuses = [];

    verificationPage.on('response', (response) => {
      if (urlsMatchIgnoringQuery(response.url(), avatarUrl)) {
        avatarStatuses.push(response.status());
      }
    });

    logStep('avatar', 'reload edit route to validate rendered persisted avatar');
    const verificationResponse = await verificationPage.goto(editUrl, {
      waitUntil: 'domcontentloaded',
    });
    expect(
      verificationResponse,
      'Verification edit response should be available.',
    ).not.toBeNull();
    expect(verificationResponse.status()).toBeLessThan(400);
    await assertAppBooted(verificationPage);
    await enableAccessibilityIfNeeded(verificationPage);

    await expect
      .poll(() => avatarStatuses.some((status) => status === 200), {
        timeout: appBootTimeoutMs,
        message: 'Expected the persisted avatar image request to succeed after reload.',
      })
      .toBeTruthy();
    logStep('avatar', 'persisted avatar returned 200 after reload');

    await assertNoBrowserFailures(collectors);
    await assertNoBrowserFailures(verificationCollectors);
  } finally {
    if (session?.token) {
      await cleanupOnboardedAccount(api, baseUrl, session.token, accountSlug);
      await deleteAccountProfileType(
        api,
        baseUrl,
        session.token,
        temporaryProfileType,
      );
    }
    if (browserContext) {
      await browserContext.close();
    }
    if (freshBrowser) {
      await freshBrowser.close().catch(() => {});
    }
    await api.dispose();
  }
});

test.skip('@deferred @mutation tenant-admin account-profile gallery groups persist and render in the public modal', async ({
  browser,
}) => {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  let browserContext;
  let freshBrowser;
  let publicContext;
  let session = null;
  let accountSlug = null;
  let profileId = null;
  let profileSlug = '';
  let profileTypeKey = null;
  let primaryError = null;

  try {
    session = await loginTenantAdmin(api, baseUrl);
    const unique = Date.now();
    const createdProfileType = (
      await createAccountProfileType(api, baseUrl, session.token, {
        type: `pw-gallery-${unique}`,
        label: `PW Gallery ${unique}`,
        allowedTaxonomies: [],
        markerColor: '#0E7A6A',
        capabilities: {
          is_favoritable: false,
          is_publicly_discoverable: true,
          is_publicly_navigable: true,
          has_content: true,
          has_gallery: true,
          has_avatar: false,
          has_cover: false,
          has_taxonomies: false,
        },
      })
    )?.data;
    profileTypeKey = createdProfileType?.type?.toString() || '';
    expect(profileTypeKey, 'Gallery profile type must be created.').toBeTruthy();

    const createdProfile = await createAccountProfileForType(
      api,
      baseUrl,
      session.token,
      {
        name: `PW Gallery Profile ${unique}`,
        profileType: createdProfileType,
      },
    );
    accountSlug = createdProfile.accountSlug;
    profileId = createdProfile.profileId?.toString() || null;
    profileSlug = createdProfile.profileSlug?.toString() || '';
    expect(accountSlug, 'Gallery onboarding must return account slug.').toBeTruthy();
    expect(profileId, 'Gallery onboarding must return profile id.').toBeTruthy();
    expect(profileSlug, 'Gallery onboarding must return public profile slug.').toBeTruthy();

    const editUrl = buildApiUrl(
      baseUrl,
      `/admin/accounts/${accountSlug}/profiles/${profileId}/edit`,
    );
    const groupSubtitle = `Ambiente ${unique}`;
    const photoDescription = `Vista para o palco ${unique}`;

    const pageBundle = await createFreshAuthenticatedTenantAdminPage(session);
    freshBrowser = pageBundle.browser;
    browserContext = pageBundle.context;
    const page = pageBundle.page;
    const collectors = installFailureCollectors(page);

    const response = await page.goto(editUrl, {
      waitUntil: 'domcontentloaded',
    });
    expect(response, 'Gallery edit response should be available.').not.toBeNull();
    expect(response.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);

    await scrollUntilVisible(
      page,
      page.getByText('Galerias de fotos'),
      'Expected gallery section for a content-capable account profile.',
    );
    await page.getByRole('button', { name: 'Adicionar grupo de fotos' }).click();
    await fillFlutterTextField(page, 'Subtítulo do agrupamento', groupSubtitle);
    await attachImageFromDevice(page, {
      flow: 'gallery',
      buttonName: 'Adicionar foto',
      cropTitle: 'Ajustar foto da galeria',
    });
    await page.getByRole('button', { name: 'Usar' }).click();
    await fillFlutterTextField(page, 'Descrição da foto', photoDescription);

    const profileSaveResponsePromise = page.waitForResponse((candidate) => {
      return (
        candidate.request().method() === 'PATCH' &&
        candidate.url().includes(`/admin/api/v1/account_profiles/${profileId}`) &&
        candidate.status() < 400
      );
    });
    const gallerySaveResponsePromise = page.waitForResponse((candidate) => {
      return (
        candidate.request().method() === 'POST' &&
        candidate.url().includes(`/admin/api/v1/account_profiles/${profileId}/gallery`) &&
        candidate.status() < 400
      );
    });
    await clickSaveChanges(page);
    await profileSaveResponsePromise;
    const gallerySaveResponse = await gallerySaveResponsePromise;
    const gallerySavePayload = normalizePayload(await gallerySaveResponse.json());
    const savedGroups = normalizeList(gallerySavePayload?.gallery_groups);
    expect(savedGroups).toHaveLength(1);
    expect(savedGroups[0]?.subtitle).toBe(groupSubtitle);
    expect(savedGroups[0]?.items?.[0]?.description).toBe(photoDescription);
    expect(savedGroups[0]?.items?.[0]?.modal_url).toBeTruthy();

    const anonymousIdentity = await createAnonymousIdentity(
      api,
      baseUrl,
      'tenant-admin-gallery-public',
    );
    let publicProfile = null;
    await expect
      .poll(
        async () => {
          const publicProfileResponse = await api.get(
            buildApiUrl(baseUrl, `/api/v1/account_profiles/${profileSlug}`),
            {
              headers: authHeaders(anonymousIdentity.token),
              failOnStatusCode: false,
            },
          );
          const status = publicProfileResponse.status();
          if (status !== 200) {
            await disposeApiResponse(publicProfileResponse);
            return ['', '', false];
          }

          publicProfile = normalizePayload(await publicProfileResponse.json());
          await disposeApiResponse(publicProfileResponse);
          const publicGroup = normalizeList(publicProfile?.gallery_groups)[0];
          const publicItem = normalizeList(publicGroup?.items)[0];

          return [
            publicGroup?.subtitle?.toString() || '',
            publicItem?.description?.toString() || '',
            Boolean(publicItem?.modal_url),
          ];
        },
        {
          timeout: appBootTimeoutMs,
          message:
            'Public gallery projection must settle with the grouped subtitle, description, and modal URL before runtime validation.',
        },
      )
      .toEqual([groupSubtitle, photoDescription, true]);

    const publicGroup = normalizeList(publicProfile?.gallery_groups)[0];
    const publicItem = normalizeList(publicGroup?.items)[0];
    const publicModalUrlPath = publicItem?.modal_url?.toString() || '';
    expect(
      publicModalUrlPath,
      'Public gallery projection must expose a modal URL for runtime validation.',
    ).toBeTruthy();
    const publicModalUrl = resolveAbsoluteUrl(baseUrl, publicModalUrlPath);
    const publicModalResponse = await api.get(publicModalUrl, {
      failOnStatusCode: false,
    });
    expect(
      publicModalResponse.status(),
      'Public gallery modal URL must be directly readable once projection settles.',
    ).toBeLessThan(400);
    await disposeApiResponse(publicModalResponse);

    publicContext = await browser.newContext({
      ignoreHTTPSErrors: true,
    });
    await seedFlutterSecureStorage(publicContext, {
      user_token: anonymousIdentity.token,
      user_id: anonymousIdentity.userId,
    });
    const publicPage = await publicContext.newPage();
    const publicCollectors = installFailureCollectors(publicPage);
    const modalImageStatuses = [];

    publicPage.on('response', (candidate) => {
      if (urlsMatchIgnoringQuery(candidate.url(), publicModalUrl)) {
        modalImageStatuses.push(candidate.status());
      }
    });

    const publicResponse = await publicPage.goto(
      buildApiUrl(baseUrl, `/parceiro/${profileSlug}`),
      { waitUntil: 'domcontentloaded' },
    );
    expect(publicResponse, 'Public gallery detail response should be available.').not.toBeNull();
    expect(publicResponse.status()).toBeLessThan(400);
    await assertAppBooted(publicPage);
    await enableAccessibilityIfNeeded(publicPage);

    await scrollUntilVisible(
      publicPage,
      publicPage.getByText(groupSubtitle, { exact: true }),
      'Expected public grouped gallery subtitle to render.',
    );
    modalImageStatuses.length = 0;
    await publicPage.getByRole('button', {
      name: `Abrir foto da galeria ${groupSubtitle}: ${photoDescription}`,
    }).click();
    await expect
      .poll(() => modalImageStatuses.some((status) => status === 200), {
        timeout: appBootTimeoutMs,
        message: 'Expected the public gallery modal image request to succeed.',
      })
      .toBeTruthy();
    await expect(publicPage.getByText(photoDescription, { exact: true }))
      .toBeVisible({ timeout: appBootTimeoutMs });
    await publicPage.getByRole('button', { name: /Fechar galeria/i }).click();
    await expect(publicPage.getByText(photoDescription, { exact: true }))
      .toHaveCount(0, { timeout: appBootTimeoutMs });

    await assertNoBrowserFailures(collectors);
    await assertNoBrowserFailures(publicCollectors);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await runCleanupPreservingPrimaryError(primaryError, async () => {
      try {
        await runCleanupSteps([
          accountSlug
            ? () => cleanupOnboardedAccount(api, baseUrl, session?.token, accountSlug)
            : null,
          profileTypeKey
            ? () => deleteAccountProfileType(api, baseUrl, session?.token, profileTypeKey)
            : null,
        ]);
      } finally {
        if (publicContext) {
          await publicContext.close().catch(() => {});
        }
        if (browserContext) {
          await browserContext.close().catch(() => {});
        }
        if (freshBrowser) {
          await freshBrowser.close().catch(() => {});
        }
        await api.dispose();
      }
    });
  }
});

test.skip('@mutation tenant-admin account-profile edit save keeps Display Name visible, skips persisted-empty gallery resend, and clears persisted gallery content', async () => {
  test.setTimeout(600000);
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  let browserContext;
  let freshBrowser;
  let session = null;
  let accountSlug = null;
  let profileId = null;
  let profileTypeKey = null;
  let primaryError = null;

  try {
    session = await loginTenantAdmin(api, baseUrl);
    const unique = Date.now();
    const createdProfileType = (
      await createAccountProfileType(api, baseUrl, session.token, {
        type: `pw-edit-gallery-${unique}`,
        label: `PW Edit Gallery ${unique}`,
        allowedTaxonomies: [],
        markerColor: '#0B6E4F',
        capabilities: {
          is_favoritable: false,
          is_publicly_discoverable: true,
          is_publicly_navigable: true,
          has_content: true,
          has_gallery: true,
          has_avatar: false,
          has_cover: false,
          has_taxonomies: false,
        },
      })
    )?.data;
    profileTypeKey = createdProfileType?.type?.toString() || '';
    expect(profileTypeKey, 'Edit-save gallery profile type must be created.').toBeTruthy();

    const createdProfile = await createAccountProfileForType(
      api,
      baseUrl,
      session.token,
      {
        name: `PW Edit Gallery Profile ${unique}`,
        profileType: createdProfileType,
      },
    );
    accountSlug = createdProfile.accountSlug;
    profileId = createdProfile.profileId?.toString() || null;
    expect(accountSlug, 'Edit-save onboarding must return account slug.').toBeTruthy();
    expect(profileId, 'Edit-save onboarding must return profile id.').toBeTruthy();

    const editUrl = buildApiUrl(
      baseUrl,
      `/admin/accounts/${accountSlug}/profiles/${profileId}/edit`,
    );
    const initialDisplayName = createdProfile.displayName;
    const updatedDisplayName = `PW Edit Visible ${unique}`;
    const groupSubtitle = `Limpeza ${unique}`;
    const photoDescription = `Foto persistida ${unique}`;

    const pageBundle = await createFreshAuthenticatedTenantAdminPage(session);
    freshBrowser = pageBundle.browser;
    browserContext = pageBundle.context;
    const page = pageBundle.page;
    const collectors = installFailureCollectors(page);

    const initialResponse = await page.goto(editUrl, {
      waitUntil: 'domcontentloaded',
    });
    expect(initialResponse, 'Edit save response should be available.').not.toBeNull();
    expect(initialResponse.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);

    const displayNameField = page.getByLabel('Nome de exibicao').first();
    await scrollUntilVisible(
      page,
      displayNameField,
      'Expected Display Name field to render in the real edit flow.',
    );
    await expect(displayNameField).toBeVisible({ timeout: appBootTimeoutMs });
    await expectFlutterFieldRenderedValue(
      displayNameField,
      initialDisplayName,
      'Expected the real edit flow to render the persisted Display Name before the field receives focus.',
    );
    await fillFlutterTextField(page, 'Nome de exibicao', updatedDisplayName);

    const galleryEndpoint = `**/admin/api/v1/account_profiles/${profileId}/gallery`;
    let unexpectedGalleryRequestBody = null;
    const failClosedUnexpectedGalleryRoute = async (route) => {
      unexpectedGalleryRequestBody =
        route.request().postData() || '<missing postData>';
      await route.abort();
    };
    await page.route(galleryEndpoint, failClosedUnexpectedGalleryRoute);

    const persistedEmptyProfileSaveResponsePromise =
      waitForSuccessfulAccountProfilePatchResponse(page, profileId, {
        requestMustContain: [updatedDisplayName],
      });
    const [persistedEmptyProfileSaveResponse] = await Promise.all([
      persistedEmptyProfileSaveResponsePromise,
      clickSaveChanges(page),
    ]);
    const persistedEmptyProfileSavePayload = normalizePayload(
      await persistedEmptyProfileSaveResponse.json(),
    );
    expect(
      persistedEmptyProfileSavePayload?.display_name,
      'The edit save response must preserve the submitted Display Name.',
    ).toBe(updatedDisplayName);

    await expect
      .poll(
        async () => {
          const adminProfile = await fetchAdminProfile(
            api,
            baseUrl,
            session.token,
            profileId,
          );
          return [
            adminProfile?.display_name?.toString() || '',
            normalizeList(adminProfile?.gallery_groups).length,
          ];
        },
        {
          timeout: appBootTimeoutMs,
          message:
            'Expected the persisted-empty edit save to keep the updated Display Name while the stored gallery remains empty.',
        },
      )
      .toEqual([updatedDisplayName, 0]);

    // Allow any chained gallery follow-through to surface; this branch must stay silent.
    await page.waitForTimeout(2000);
    expect(
      unexpectedGalleryRequestBody,
      'Persisted-empty edit saves must not emit the gallery mutation.',
    ).toBeNull();
    await page.unroute(galleryEndpoint, failClosedUnexpectedGalleryRoute);

    await scrollUntilVisible(
      page,
      page.getByText('Galerias de fotos'),
      'Expected gallery section for a gallery-enabled account profile.',
    );
    await page.getByRole('button', { name: 'Adicionar grupo de fotos' }).click();
    await fillFlutterTextField(page, 'Subtítulo do agrupamento', groupSubtitle);
    await attachImageFromDevice(page, {
      flow: 'edit-gallery',
      buttonName: 'Adicionar foto',
      cropTitle: 'Ajustar foto da galeria',
    });
    await page.getByRole('button', { name: 'Usar' }).click();
    await fillFlutterTextField(page, 'Descrição da foto', photoDescription);

    const gallerySeedProfileSaveResponsePromise =
      waitForSuccessfulAccountProfilePatchResponse(page, profileId, {
        requestMustContain: [updatedDisplayName],
      });
    const gallerySeedSaveResponsePromise = page.waitForResponse((candidate) => {
      return (
        candidate.request().method() === 'POST' &&
        candidate.url().includes(`/admin/api/v1/account_profiles/${profileId}/gallery`) &&
        candidate.status() < 400
      );
    });
    await Promise.all([
      gallerySeedProfileSaveResponsePromise,
      clickSaveChanges(page),
    ]);
    const gallerySeedSaveResponse = await gallerySeedSaveResponsePromise;
    const gallerySeedSavePayload = normalizePayload(
      await gallerySeedSaveResponse.json(),
    );
    const seededGroups = normalizeList(gallerySeedSavePayload?.gallery_groups);
    expect(seededGroups).toHaveLength(1);
    const seededGroup = seededGroups[0];
    expect(seededGroup?.subtitle).toBe(groupSubtitle);
    const seededItems = normalizeList(seededGroup?.items);
    expect(seededItems).toHaveLength(1);
    expect(seededItems[0]?.description).toBe(photoDescription);

    await expect
      .poll(
        async () => {
          const adminProfile = await fetchAdminProfile(
            api,
            baseUrl,
            session.token,
            profileId,
          );
          const groups = normalizeList(adminProfile?.gallery_groups);
          return [
            groups.length,
            groups[0]?.subtitle?.toString() || '',
            normalizeList(groups[0]?.items)[0]?.description?.toString() || '',
          ];
        },
        {
          timeout: appBootTimeoutMs,
          message:
            'Expected the seeded gallery content to persist before the clear-all edit phase.',
        },
      )
      .toEqual([1, groupSubtitle, photoDescription]);

    const reopenResponse = await page.goto(editUrl, {
      waitUntil: 'domcontentloaded',
    });
    expect(reopenResponse, 'Reopened edit route should be available.').not.toBeNull();
    expect(reopenResponse.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);

    const reopenedDisplayNameField = page.getByLabel('Nome de exibicao').first();
    await scrollUntilVisible(
      page,
      reopenedDisplayNameField,
      'Expected Display Name field to remain visible after reopening the real edit flow.',
    );
    await expectFlutterFieldRenderedValue(
      reopenedDisplayNameField,
      updatedDisplayName,
      'Expected the reopened edit flow to visibly render the persisted Display Name before refocus.',
    );
    const reopenedGroupSubtitleField = page
      .getByLabel('Subtítulo do agrupamento')
      .first();
    await scrollUntilVisible(
      page,
      reopenedGroupSubtitleField,
      'Expected persisted gallery subtitle field to rehydrate before clear-all save.',
    );
    await expectFlutterFieldRenderedAndFocusedValue(
      reopenedGroupSubtitleField,
      groupSubtitle,
      'Expected persisted gallery content to rehydrate before clear-all save.',
    );
    await page.getByRole('button', { name: 'Remover grupo' }).first().click();
    await expectNoVisibleFlutterTextField(
      page,
      'Subtítulo do agrupamento',
      'Expected removing the only gallery group to remove the visible subtitle field before save.',
    );

    const clearAllProfileSaveResponsePromise =
      waitForSuccessfulAccountProfilePatchResponse(page, profileId, {
        requestMustContain: [updatedDisplayName],
      });
    const clearAllGallerySaveResponsePromise = page.waitForResponse((candidate) => {
      return (
        candidate.request().method() === 'POST' &&
        candidate.url().includes(`/admin/api/v1/account_profiles/${profileId}/gallery`) &&
        candidate.status() < 400
      );
    });
    await Promise.all([
      clearAllProfileSaveResponsePromise,
      clickSaveChanges(page),
    ]);
    const clearAllGallerySaveResponse = await clearAllGallerySaveResponsePromise;
    const clearAllGalleryRequestBody =
      clearAllGallerySaveResponse.request().postData() || '';
    expect(
      clearAllGalleryRequestBody,
      'Clear-all edit saves must submit gallery_groups for the bounded empty-array contract.',
    ).toContain('gallery_groups');
    expect(
      clearAllGalleryRequestBody,
      'Clear-all edit saves must submit the bounded gallery_groups=[] payload.',
    ).toContain('[]');

    const clearAllGallerySavePayload = normalizePayload(
      await clearAllGallerySaveResponse.json(),
    );
    expect(
      normalizeList(clearAllGallerySavePayload?.gallery_groups),
      'Clear-all edit saves must settle with an empty persisted gallery.',
    ).toEqual([]);

    await expect
      .poll(
        async () => {
          const adminProfile = await fetchAdminProfile(
            api,
            baseUrl,
            session.token,
            profileId,
          );
          return [
            adminProfile?.display_name?.toString() || '',
            normalizeList(adminProfile?.gallery_groups).length,
          ];
        },
        {
          timeout: appBootTimeoutMs,
          message:
            'Expected the bounded clear-all save to preserve Display Name while emptying the persisted gallery.',
        },
      )
      .toEqual([updatedDisplayName, 0]);

    const finalDisplayNameField = page.getByLabel('Nome de exibicao').first();
    await scrollUntilVisible(
      page,
      finalDisplayNameField,
      'Expected the edit flow to keep the Display Name field reachable after clear-all save.',
    );
    await expectFlutterFieldRenderedValue(
      finalDisplayNameField,
      updatedDisplayName,
      'Expected the edit flow to visibly render the persisted Display Name after clear-all save.',
    );
    await scrollUntilVisible(
      page,
      page.getByText('Galerias de fotos'),
      'Expected the gallery section to remain available after clear-all save.',
    );
    await expectNoVisibleFlutterTextField(
      page,
      'Subtítulo do agrupamento',
      'Expected the cleared gallery subtitle field to remain absent after clear-all save.',
    );
    await expect(
      page.getByRole('button', { name: 'Adicionar grupo de fotos' }),
    ).toBeVisible({
      timeout: appBootTimeoutMs,
    });

    await assertNoBrowserFailures(collectors);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await runCleanupPreservingPrimaryError(primaryError, async () => {
      try {
        await runCleanupSteps([
          accountSlug
            ? () => cleanupOnboardedAccount(api, baseUrl, session?.token, accountSlug)
            : null,
          profileTypeKey
            ? () => deleteAccountProfileType(api, baseUrl, session?.token, profileTypeKey)
            : null,
        ]);
      } finally {
        if (browserContext) {
          await browserContext.close().catch(() => {});
        }
        if (freshBrowser) {
          await freshBrowser.close().catch(() => {});
        }
        await api.dispose();
      }
    });
  }
});

test.skip('@deferred @mutation tenant-admin gallery data stays dormant when has_gallery is disabled', async ({
  browser,
}) => {
  test.setTimeout(600000);
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  let browserContext;
  let freshBrowser;
  let publicContext;
  let session = null;
  let accountSlug = null;
  let profileId = null;
  let profileSlug = '';
  let profileTypeKey = null;
  let primaryError = null;

  try {
    session = await loginTenantAdmin(api, baseUrl);
    const unique = Date.now();
    logStep('gallery-dormant', `seed start ${unique}`);
    const createdProfileType = (
      await createAccountProfileType(api, baseUrl, session.token, {
        type: `pw-gallery-cap-${unique}`,
        label: `PW Gallery Cap ${unique}`,
        allowedTaxonomies: [],
        markerColor: '#136F63',
        capabilities: {
          is_favoritable: false,
          is_publicly_discoverable: true,
          is_publicly_navigable: true,
          has_content: true,
          has_gallery: true,
          has_avatar: false,
          has_cover: false,
          has_taxonomies: false,
        },
      })
    )?.data;
    profileTypeKey = createdProfileType?.type?.toString() || '';
    expect(profileTypeKey, 'Gallery capability profile type must be created.').toBeTruthy();

    const createdProfile = await createAccountProfileForType(
      api,
      baseUrl,
      session.token,
      {
        name: `PW Gallery Capability Profile ${unique}`,
        profileType: createdProfileType,
      },
    );
    accountSlug = createdProfile.accountSlug;
    profileId = createdProfile.profileId?.toString() || null;
    profileSlug = createdProfile.profileSlug?.toString() || '';
    expect(accountSlug, 'Gallery capability onboarding must return account slug.').toBeTruthy();
    expect(profileId, 'Gallery capability onboarding must return profile id.').toBeTruthy();
    expect(
      profileSlug,
      'Gallery capability onboarding must return public profile slug.',
    ).toBeTruthy();

    const editUrl = buildApiUrl(
      baseUrl,
      `/admin/accounts/${accountSlug}/profiles/${profileId}/edit`,
    );
    const groupSubtitle = `Dormant ${unique}`;
    const photoDescription = `Gallery dormant proof ${unique}`;

    const pageBundle = await createFreshAuthenticatedTenantAdminPage(session);
    freshBrowser = pageBundle.browser;
    browserContext = pageBundle.context;
    const page = pageBundle.page;
    const collectors = installFailureCollectors(page);

    const response = await page.goto(editUrl, {
      waitUntil: 'domcontentloaded',
    });
    expect(response, 'Gallery capability edit response should be available.').not.toBeNull();
    expect(response.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);

    await scrollUntilVisible(
      page,
      page.getByText('Galerias de fotos'),
      'Expected gallery section for a gallery-enabled account profile.',
    );
    await page.getByRole('button', { name: 'Adicionar grupo de fotos' }).click();
    await fillFlutterTextField(page, 'Subtítulo do agrupamento', groupSubtitle);
    await attachImageFromDevice(page, {
      flow: 'gallery',
      buttonName: 'Adicionar foto',
      cropTitle: 'Ajustar foto da galeria',
    });
    await page.getByRole('button', { name: 'Usar' }).click();
    await fillFlutterTextField(page, 'Descrição da foto', photoDescription);

    const profileSaveResponsePromise = page.waitForResponse((candidate) => {
      return (
        candidate.request().method() === 'PATCH' &&
        candidate.url().includes(`/admin/api/v1/account_profiles/${profileId}`) &&
        candidate.status() < 400
      );
    });
    const gallerySaveResponsePromise = page.waitForResponse((candidate) => {
      return (
        candidate.request().method() === 'POST' &&
        candidate.url().includes(`/admin/api/v1/account_profiles/${profileId}/gallery`) &&
        candidate.status() < 400
      );
    });
    await clickSaveChanges(page);
    await profileSaveResponsePromise;
    const gallerySaveResponse = await gallerySaveResponsePromise;
    const gallerySavePayload = normalizePayload(await gallerySaveResponse.json());
    const savedGroups = normalizeList(gallerySavePayload?.gallery_groups);
    expect(savedGroups).toHaveLength(1);
    const savedGroup = savedGroups[0];
    expect(savedGroup?.subtitle).toBe(groupSubtitle);
    const savedItems = normalizeList(savedGroup?.items);
    expect(savedItems).toHaveLength(1);
    const savedItem = savedItems[0];
    expect(savedItem?.description).toBe(photoDescription);
    const savedItemModalUrl = savedItem?.modal_url?.toString() || '';
    expect(
      savedItemModalUrl,
      'Gallery save response must expose a public modal URL for the saved item.',
    ).toBeTruthy();

    const disabledTypePayload = await updateAccountProfileType(
      api,
      baseUrl,
      session.token,
      profileTypeKey,
      {
        capabilities: {
          has_gallery: false,
        },
      },
    );
    expect(
      disabledTypePayload?.data?.capabilities?.has_gallery,
      'Account profile type update must disable has_gallery.',
    ).toBe(false);

    const rejectedGalleryResponse = await api.post(
      buildApiUrl(baseUrl, `/admin/api/v1/account_profiles/${profileId}/gallery`),
      {
        headers: authHeaders(session.token),
        failOnStatusCode: false,
        multipart: {
          _method: 'PATCH',
          gallery_groups: JSON.stringify([
            {
              group_id: savedGroup?.group_id,
              subtitle: savedGroup?.subtitle,
              order: savedGroup?.order,
              items: [
                {
                  item_id: savedItem?.item_id,
                  description: savedItem?.description,
                  order: savedItem?.order,
                },
              ],
            },
          ]),
        },
      },
    );
    expect(
      rejectedGalleryResponse.status(),
      'Disabled gallery capability must reject gallery mutations.',
    ).toBe(422);
    const rejectedGalleryPayload = await rejectedGalleryResponse.json();
    expect(
      rejectedGalleryPayload?.errors?.gallery_groups,
      'Disabled gallery mutation must report a gallery_groups validation error.',
    ).toBeTruthy();
    await disposeApiResponse(rejectedGalleryResponse);
    const rejectedGalleryMediaResponse = await api.get(savedItemModalUrl, {
      failOnStatusCode: false,
    });
    expect(
      rejectedGalleryMediaResponse.status(),
      'Disabled gallery capability must also suppress direct public gallery media access.',
    ).toBe(404);
    await disposeApiResponse(rejectedGalleryMediaResponse);
    logStep(
      'gallery-dormant',
      `gallery mutation rejected and media suppressed for ${profileTypeKey}`,
    );
    logStep('gallery-dormant', 'wait for admin API catalog readback has_gallery=false');
    await expect
      .poll(
        async () => {
          const profileTypeReadback = await fetchAccountProfileTypeListEntry(
            api,
            baseUrl,
            session.token,
            profileTypeKey,
          );
          const hasGallery = profileTypeReadback?.capabilities?.has_gallery ?? null;
          logStep(
            'gallery-dormant',
            `admin API catalog readback has_gallery=${hasGallery}`,
          );
          return hasGallery;
        },
        {
          timeout: appBootTimeoutMs,
          message: 'Expected account profile type catalog readback to refresh has_gallery=false before reopening the admin edit form.',
        },
      )
      .toBe(false);

    logStep(
      'gallery-dormant',
      'allow current admin edit session to settle after gallery suppression',
    );
    await page.waitForTimeout(2500);
    resetFailureCollectors(collectors);
    await page.waitForTimeout(750);
    await assertNoBrowserFailures(collectors);
    resetFailureCollectors(collectors);

    const anonymousIdentity = await createAnonymousIdentity(
      api,
      baseUrl,
      'tenant-admin-gallery-disabled-public',
    );
    logStep('gallery-dormant', 'wait for public projection to suppress gallery groups');
    await expect
      .poll(
        async () => {
          const publicProfileResponse = await api.get(
            buildApiUrl(baseUrl, `/api/v1/account_profiles/${profileSlug}`),
            {
              headers: authHeaders(anonymousIdentity.token),
              failOnStatusCode: false,
            },
          );
          const status = publicProfileResponse.status();
          let groupCount = -1;
          if (status === 200) {
            const publicProfile = normalizePayload(
              await publicProfileResponse.json(),
            );
            groupCount = normalizeList(publicProfile?.gallery_groups).length;
          }
          await disposeApiResponse(publicProfileResponse);
          logStep(
            'gallery-dormant',
            `public projection status=${status} gallery_groups=${groupCount}`,
          );
          return [status, groupCount];
        },
        {
          timeout: appBootTimeoutMs,
          message: 'Expected public gallery readback to stay suppressed when has_gallery=false.',
        },
      )
      .toEqual([200, 0]);
    logStep(
      'gallery-dormant',
      'wait for fresh admin edit sessions to stop rendering the gallery section',
    );
    await expect
      .poll(
        async () => {
          const probeBundle = await createFreshAuthenticatedTenantAdminPage(
            session,
          );
          try {
            const probeResponse = await probeBundle.page.goto(editUrl, {
              waitUntil: 'domcontentloaded',
            });
            if (!probeResponse || probeResponse.status() >= 400) {
              logStep(
                'gallery-dormant',
                `fresh admin probe returned status=${probeResponse?.status() ?? 'null'}`,
              );
              return 1;
            }
            await assertAppBooted(probeBundle.page);
            await enableAccessibilityIfNeeded(probeBundle.page);
            await probeBundle.page.waitForTimeout(1200);
            const browserCatalog = await probeBundle.page.evaluate(
              async ({ token, typeKey }) => {
                const response = await fetch(
                  '/admin/api/v1/account_profile_types?page=1&page_size=500',
                  {
                    headers: {
                      Authorization: `Bearer ${token}`,
                      Accept: 'application/json',
                    },
                  },
                );
                const payload = await response.json().catch(() => ({}));
                const rows = Array.isArray(payload?.data) ? payload.data : [];
                const entry =
                  rows.find((row) => row?.type?.toString() === typeKey) || null;
                return {
                  status: response.status,
                  hasGallery: entry?.capabilities?.has_gallery ?? null,
                };
              },
              {
                token: session.token,
                typeKey: profileTypeKey,
              },
            );
            const galleryCount =
              await probeBundle.page.getByText('Galerias de fotos').count();
            logStep(
              'gallery-dormant',
              `fresh admin probe catalogStatus=${browserCatalog.status} has_gallery=${browserCatalog.hasGallery} uiGalleryCount=${galleryCount}`,
            );
            return galleryCount;
          } finally {
            await probeBundle.context.close().catch(() => {});
            await probeBundle.browser.close().catch(() => {});
          }
        },
        {
          timeout: appBootTimeoutMs,
          message: 'Expected fresh admin edit sessions to stop rendering the gallery section after has_gallery=false propagates.',
        },
      )
      .toBe(0);

    publicContext = await browser.newContext({
      ignoreHTTPSErrors: true,
    });
    await seedFlutterSecureStorage(publicContext, {
      user_token: anonymousIdentity.token,
      user_id: anonymousIdentity.userId,
    });
    const publicPage = await publicContext.newPage();
    const publicCollectors = installFailureCollectors(publicPage);

    const publicResponse = await publicPage.goto(
      buildApiUrl(baseUrl, `/parceiro/${profileSlug}`),
      { waitUntil: 'domcontentloaded' },
    );
    expect(
      publicResponse,
      'Public disabled-gallery detail response should be available.',
    ).not.toBeNull();
    expect(publicResponse.status()).toBeLessThan(400);
    await assertAppBooted(publicPage);
    await enableAccessibilityIfNeeded(publicPage);
    logStep('gallery-dormant', 'wait for final public page to converge without gallery content');
    await expect
      .poll(
        async () => publicPage.getByText(groupSubtitle, { exact: true }).count(),
        {
          timeout: appBootTimeoutMs,
          message:
            'Expected the final public page to stop rendering the gallery subtitle after runtime convergence.',
        },
      )
      .toBe(0);
    await expect
      .poll(
        async () =>
          publicPage
            .getByRole('button', {
              name: `Abrir foto da galeria ${groupSubtitle}: ${photoDescription}`,
            })
            .count(),
        {
          timeout: appBootTimeoutMs,
          message:
            'Expected the final public page to remove the gallery modal trigger after runtime convergence.',
        },
      )
      .toBe(0);

    // Only steady-state browser failures should fail this proof; gallery suppression
    // may emit transient 404s while the public page converges to has_gallery=false.
    logStep(
      'gallery-dormant',
      'allow final public page to settle after gallery suppression',
    );
    await publicPage.waitForTimeout(2500);
    resetFailureCollectors(publicCollectors);
    await publicPage.waitForTimeout(750);

    await assertNoBrowserFailures(collectors);
    await assertNoBrowserFailures(publicCollectors);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await runCleanupPreservingPrimaryError(primaryError, async () => {
      try {
        await runCleanupSteps([
          accountSlug
            ? () => cleanupOnboardedAccount(api, baseUrl, session?.token, accountSlug)
            : null,
          profileTypeKey
            ? () => deleteAccountProfileType(api, baseUrl, session?.token, profileTypeKey)
            : null,
        ]);
      } finally {
        if (publicContext) {
          await publicContext.close().catch(() => {});
        }
        if (browserContext) {
          await browserContext.close().catch(() => {});
        }
        if (freshBrowser) {
          await freshBrowser.close().catch(() => {});
        }
        await api.dispose();
      }
    });
  }
});

test('@mutation home favorites preserve backend order and expose event status halos', async ({
  browser,
}) => {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  let publicContext;
  let fallbackPublicContext;
  let session = null;
  let anonymousIdentity = null;
  let fallbackOnlyIdentity = null;
  let profileTypeKey = null;
  let eventTypeId = null;
  const createdEvents = [];
  const createdFavoriteProfileIds = [];
  const createdFallbackFavoriteProfileIds = [];
  const createdAccountSlugs = [];
  let primaryError = null;

  try {
    session = await loginTenantAdmin(api, baseUrl);
    const unique = Date.now();
    const createdProfileType = (
      await createAccountProfileType(api, baseUrl, session.token, {
        type: `pw-favorites-${unique}`,
        label: `PW Favorites ${unique}`,
        allowedTaxonomies: [],
        markerColor: '#225588',
        capabilities: {
          is_favoritable: true,
          is_publicly_discoverable: true,
          is_publicly_navigable: true,
          is_poi_enabled: true,
          has_events: true,
          has_content: false,
          has_avatar: false,
          has_cover: false,
          has_taxonomies: false,
        },
      })
    )?.data;
    profileTypeKey = createdProfileType?.type?.toString() || '';
    expect(profileTypeKey, 'Favorites profile type must be created.').toBeTruthy();

    // Create fixtures out of the eventual runtime order so the UI assertion
    // catches unintended client-side sorting by title or creation time.
    const fallbackProfile = await createPublicAccountProfileForType(
      api,
      baseUrl,
      session.token,
      {
        name: `Zulu Fav Fallback ${unique}`,
        profileType: createdProfileType,
      },
    );
    const upcomingLaterProfile = await createPublicAccountProfileForType(
      api,
      baseUrl,
      session.token,
      {
        name: `Bravo Fav Later ${unique}`,
        profileType: createdProfileType,
      },
    );
    const liveProfile = await createPublicAccountProfileForType(
      api,
      baseUrl,
      session.token,
      {
        name: `Lima Fav Live ${unique}`,
        profileType: createdProfileType,
      },
    );
    const upcomingSoonProfile = await createPublicAccountProfileForType(
      api,
      baseUrl,
      session.token,
      {
        name: `Echo Fav Soon ${unique}`,
        profileType: createdProfileType,
      },
    );
    createdAccountSlugs.push(
      liveProfile.accountSlug,
      upcomingSoonProfile.accountSlug,
      upcomingLaterProfile.accountSlug,
      fallbackProfile.accountSlug,
    );

    const createdEventType = await createEventType(api, baseUrl, session.token, {
      name: `PW Favorites Event ${unique}`,
      slug: `pw-favorites-event-${unique}`,
      allowedTaxonomies: [],
      icon: 'music_note',
      color: '#B51E5B',
    });
    eventTypeId = createdEventType?.data?.id?.toString() || null;
    expect(eventTypeId, 'Favorites event type must be created.').toBeTruthy();

    const upcomingLaterEvent = await createAccountProfileEvent(
      api,
      baseUrl,
      session.token,
      {
        title: `PW Favorites Later ${unique}`,
        eventType: createdEventType.data,
        host: upcomingLaterProfile,
        occurrences: [futureOccurrenceWindow(3)],
      },
    );
    const liveEvent = await createAccountProfileEvent(
      api,
      baseUrl,
      session.token,
      {
        title: `PW Favorites Live ${unique}`,
        eventType: createdEventType.data,
        host: liveProfile,
        occurrences: [liveOccurrenceWindow()],
      },
    );
    const upcomingSoonEvent = await createAccountProfileEvent(
      api,
      baseUrl,
      session.token,
      {
        title: `PW Favorites Soon ${unique}`,
        eventType: createdEventType.data,
        host: upcomingSoonProfile,
        occurrences: [futureOccurrenceWindow(1)],
      },
    );
    createdEvents.push(
      liveEvent?.event_id?.toString() || '',
      upcomingSoonEvent?.event_id?.toString() || '',
      upcomingLaterEvent?.event_id?.toString() || '',
    );

    anonymousIdentity = await createAnonymousIdentity(
      api,
      baseUrl,
      'tenant-home-favorites',
    );
    createdFavoriteProfileIds.push(
      fallbackProfile.profileId,
      upcomingLaterProfile.profileId,
      liveProfile.profileId,
      upcomingSoonProfile.profileId,
    );
    await favoriteAccountProfile(api, baseUrl, anonymousIdentity.token, fallbackProfile.profileId);
    await favoriteAccountProfile(api, baseUrl, anonymousIdentity.token, upcomingLaterProfile.profileId);
    await favoriteAccountProfile(api, baseUrl, anonymousIdentity.token, liveProfile.profileId);
    await favoriteAccountProfile(api, baseUrl, anonymousIdentity.token, upcomingSoonProfile.profileId);
    logStep('favorites', 'favorites seeded for anonymous identity');

    const expectedIds = [
      liveProfile.profileId?.toString(),
      upcomingSoonProfile.profileId?.toString(),
      upcomingLaterProfile.profileId?.toString(),
      fallbackProfile.profileId?.toString(),
    ];
    await expect
      .poll(
        async () => {
          const payload = await fetchFavoritesForIdentity(
            api,
            baseUrl,
            anonymousIdentity.token,
          );
          return normalizeList(payload?.items).map((item) =>
            item?.target_id?.toString() || '',
          );
        },
        {
          timeout: appBootTimeoutMs,
          message:
            'Favorites API must settle into the canonical live-now -> upcoming -> fallback order before runtime UI validation.',
        },
      )
      .toEqual(expectedIds);
    logStep('favorites', 'favorites API reached canonical order');

    const favoritesPayload = await fetchFavoritesForIdentity(
      api,
      baseUrl,
      anonymousIdentity.token,
    );
    const favoriteItems = normalizeList(favoritesPayload?.items);
    const liveFavoritePayload = favoriteItems.find(
      (item) => item?.target_id?.toString() === liveProfile.profileId?.toString(),
    );
    const fallbackFavoritePayload = favoriteItems.find(
      (item) => item?.target_id?.toString() === fallbackProfile.profileId?.toString(),
    );
    const liveTargetPath =
      liveFavoritePayload?.navigation?.target_path?.toString() || '';
    const fallbackTargetPath =
      fallbackFavoritePayload?.navigation?.target_path?.toString() || '';
    expect(
      liveFavoritePayload?.navigation?.kind,
      'Live favorite must expose canonical event navigation in /favorites payload.',
    ).toBe('event');
    expect(
      liveFavoritePayload?.navigation?.event_target_path,
      'Live favorite must expose explicit event_target_path in /favorites payload.',
    ).toBe(liveTargetPath);
    expect(
      liveFavoritePayload?.navigation?.event_occurrence_id?.toString() || '',
      'Live favorite must expose event_occurrence_id in /favorites payload.',
    ).toBeTruthy();
    expect(
      fallbackFavoritePayload?.navigation?.kind,
      'Fallback favorite must keep canonical account-profile navigation in /favorites payload.',
    ).toBe('account_profile');
    expect(
      fallbackFavoritePayload?.navigation?.profile_target_path,
      'Fallback favorite must expose profile_target_path in /favorites payload.',
    ).toBe(fallbackTargetPath);
    expect(liveTargetPath, 'Live favorite target_path must be present.').toBeTruthy();
    expect(
      fallbackTargetPath,
      'Fallback favorite target_path must be present.',
    ).toBeTruthy();

    publicContext = await browser.newContext({
      ignoreHTTPSErrors: true,
      geolocation: {
        latitude: -20.671339,
        longitude: -40.495395,
      },
      permissions: ['geolocation'],
    });
    await seedFlutterSecureStorage(publicContext, {
      user_token: anonymousIdentity.token,
      user_id: anonymousIdentity.userId,
    });
    const publicPage = await publicContext.newPage();
    const collectors = installFailureCollectors(publicPage);
    logStep('favorites', 'public context created');

    const response = await publicPage.goto(buildApiUrl(baseUrl, '/'), {
      waitUntil: 'domcontentloaded',
    });
    expect(response, 'Home response should be available.').not.toBeNull();
    expect(response.status()).toBeLessThan(400);
    await assertAppBooted(publicPage);
    await enableAccessibilityIfNeeded(publicPage);
    await continueWithoutLocationIfPrompted(publicPage);
    logStep('favorites', 'public home booted');

    const liveChipLabel = `${liveProfile.displayName}, TOCANDO AGORA`;
    const upcomingSoonChipLabel = `${upcomingSoonProfile.displayName}, TEM EVENTO`;
    const upcomingLaterChipLabel = `${upcomingLaterProfile.displayName}, TEM EVENTO`;
    const fallbackChipLabel = fallbackProfile.displayName;

    const liveChip = publicPage.getByRole('button', { name: liveChipLabel }).first();
    const upcomingSoonChip = publicPage.getByRole('button', { name: upcomingSoonChipLabel }).first();
    const upcomingLaterChip = publicPage.getByRole('button', { name: upcomingLaterChipLabel }).first();
    const fallbackChip = publicPage.getByRole('button', { name: fallbackChipLabel }).first();

    const ensureChipAccessible = async (chip, label) => {
      await chip.evaluate((element) => {
        let node = element;
        while (node instanceof HTMLElement) {
          const parent = node.parentElement;
          if (!(parent instanceof HTMLElement)) {
            break;
          }

          if (parent.scrollWidth > parent.clientWidth + 1) {
            const parentRect = parent.getBoundingClientRect();
            const nodeRect = node.getBoundingClientRect();
            const hiddenLeft = parentRect.left - nodeRect.left;
            const hiddenRight = nodeRect.right - parentRect.right;

            if (hiddenLeft > 0) {
              parent.scrollLeft -= hiddenLeft + 24;
            } else if (hiddenRight > 0) {
              parent.scrollLeft += hiddenRight + 24;
            }
          }

          node = parent;
        }
      });
      await chip.scrollIntoViewIfNeeded();
      await expect(chip, `${label} must stay reachable inside the horizontal favorites strip.`)
        .toBeVisible({ timeout: appBootTimeoutMs });
    };

    await ensureChipAccessible(liveChip, 'live favorite');
    await ensureChipAccessible(upcomingSoonChip, 'upcoming-soon favorite');
    await ensureChipAccessible(upcomingLaterChip, 'upcoming-later favorite');
    await ensureChipAccessible(fallbackChip, 'fallback favorite');
    await expect(liveChip).toBeVisible({ timeout: appBootTimeoutMs });
    await expect(upcomingSoonChip).toBeVisible({ timeout: appBootTimeoutMs });
    await expect(upcomingLaterChip).toBeVisible({ timeout: appBootTimeoutMs });
    await expect(fallbackChip).toHaveCount(1);

    const chipPositions = await Promise.all([
      liveChip.boundingBox(),
      upcomingSoonChip.boundingBox(),
      upcomingLaterChip.boundingBox(),
      fallbackChip.boundingBox(),
    ]);
    expect(
      chipPositions.every((position) => position && Number.isFinite(position.x) && Number.isFinite(position.y)),
      'Favorites runtime chips must expose stable positions for order validation.',
    ).toBe(true);
    expect(
      chipPositions.every((position) => position.y === chipPositions[0].y),
      'Favorites runtime chips must stay on the same row in the canonical desktop lane.',
    ).toBe(true);
    expect(chipPositions[0].x).toBeLessThan(chipPositions[1].x);
    expect(chipPositions[1].x).toBeLessThan(chipPositions[2].x);
    expect(chipPositions[2].x).toBeLessThan(chipPositions[3].x);
    logStep('favorites', 'favorite strip order validated');

    const liveHaloSignature = await resolveFavoriteHaloSignature(liveChip);
    const upcomingSoonHaloSignature = await resolveFavoriteHaloSignature(
      upcomingSoonChip,
    );
    const upcomingLaterHaloSignature = await resolveFavoriteHaloSignature(
      upcomingLaterChip,
    );
    const fallbackHaloSignature = await resolveFavoriteHaloSignature(
      fallbackChip,
    );

    expect(
      liveHaloSignature.diffSum,
      `Live favorite halo must stay visually stronger than upcoming halo in the served strip. live=${JSON.stringify(
        liveHaloSignature,
      )} upcoming=${JSON.stringify(upcomingSoonHaloSignature)}`,
    ).toBeGreaterThan(
      upcomingSoonHaloSignature.diffSum * favoriteChipLiveVsUpcomingDiffFactor,
    );
    expect(
      upcomingSoonHaloSignature.coloredPixelCount,
      `Upcoming favorites must keep a visible runtime halo beyond the no-event state. upcoming=${JSON.stringify(
        upcomingSoonHaloSignature,
      )} fallback=${JSON.stringify(fallbackHaloSignature)}`,
    ).toBeGreaterThan(
      fallbackHaloSignature.coloredPixelCount +
        favoriteChipUpcomingVsFallbackPixelDelta,
    );
    expect(
      upcomingSoonHaloSignature.diffSum,
      `Upcoming favorites must keep a stronger ring signal than the no-event state. upcoming=${JSON.stringify(
        upcomingSoonHaloSignature,
      )} fallback=${JSON.stringify(fallbackHaloSignature)}`,
    ).toBeGreaterThan(
      fallbackHaloSignature.diffSum + favoriteChipUpcomingVsFallbackDiffDelta,
    );
    expect(
      colorDistance(
        upcomingSoonHaloSignature.dominantColor,
        upcomingLaterHaloSignature.dominantColor,
      ),
      `Upcoming favorites must stay in the same halo family across multiple event chips. soon=${JSON.stringify(
        upcomingSoonHaloSignature,
      )} later=${JSON.stringify(upcomingLaterHaloSignature)}`,
    ).toBeLessThanOrEqual(48);
    logStep('favorites', 'favorite runtime halo signatures validated');

    const clickChipSurface = async (
      chip,
      label,
      {
        requireReachable = true,
      } = {},
    ) => {
      if (requireReachable) {
        await ensureChipAccessible(
          chip,
          `${label} full-surface navigation target`,
        );
        await chip.click();
      } else {
        await expect(chip, `${label} must remain present in the favorites strip.`)
          .toHaveCount(1);
        await chip.dispatchEvent('click');
      }
    };
    const currentPath = () => {
      const current = new URL(publicPage.url());
      return `${current.pathname}${current.search}`;
    };

    await clickChipSurface(liveChip, 'live favorite');
    await expect
      .poll(currentPath, {
        timeout: appBootTimeoutMs,
        message:
          'Active-event favorite chip must open the canonical event detail path.',
      })
      .toBe(liveTargetPath);
    logStep('favorites', 'live favorite navigated to event detail');

    fallbackOnlyIdentity = await createAnonymousIdentity(
      api,
      baseUrl,
      'tenant-home-favorites-fallback',
    );
    createdFallbackFavoriteProfileIds.push(fallbackProfile.profileId);
    await favoriteAccountProfile(
      api,
      baseUrl,
      fallbackOnlyIdentity.token,
      fallbackProfile.profileId,
    );
    await expect
      .poll(
        async () => {
          const payload = await fetchFavoritesForIdentity(
            api,
            baseUrl,
            fallbackOnlyIdentity.token,
          );
          return normalizeList(payload?.items).map((item) =>
            item?.target_id?.toString() || '',
          );
        },
        {
          timeout: appBootTimeoutMs,
          message:
            'Fallback-only identity must settle into a single canonical favorite before browser validation.',
        },
      )
      .toEqual([fallbackProfile.profileId?.toString()]);
    logStep('favorites', 'fallback-only identity prepared');

    fallbackPublicContext = await browser.newContext({
      ignoreHTTPSErrors: true,
      geolocation: {
        latitude: -20.671339,
        longitude: -40.495395,
      },
      permissions: ['geolocation'],
    });
    await seedFlutterSecureStorage(fallbackPublicContext, {
      user_token: fallbackOnlyIdentity.token,
      user_id: fallbackOnlyIdentity.userId,
    });
    const fallbackPage = await fallbackPublicContext.newPage();
    const fallbackCollectors = installFailureCollectors(fallbackPage);
    const fallbackHomeResponse = await fallbackPage.goto(buildApiUrl(baseUrl, '/'), {
      waitUntil: 'domcontentloaded',
    });
    expect(
      fallbackHomeResponse,
      'Fallback-only home response should be available.',
    ).not.toBeNull();
    expect(fallbackHomeResponse.status()).toBeLessThan(400);
    await assertAppBooted(fallbackPage);
    await enableAccessibilityIfNeeded(fallbackPage);
    await continueWithoutLocationIfPrompted(fallbackPage);
    logStep('favorites', 'fallback-only public home booted');

    const fallbackOnlyChip = fallbackPage
      .getByRole('button', { name: fallbackChipLabel })
      .first();
    await ensureChipAccessible(fallbackOnlyChip, 'fallback-only favorite');
    await fallbackOnlyChip.click();
    logStep('favorites', 'fallback-only favorite dispatched');
    await expect
      .poll(() => {
        const current = new URL(fallbackPage.url());
        return `${current.pathname}${current.search}`;
      }, {
        timeout: appBootTimeoutMs,
        message:
          'No-event favorite chip must open the canonical account-profile path.',
      })
      .toBe(fallbackTargetPath);
    logStep('favorites', 'fallback favorite navigated to profile detail');

    await assertNoBrowserFailures(collectors);
    await assertNoBrowserFailures(fallbackCollectors);
    logStep('favorites', 'favorite runtime assertions completed');
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await runCleanupPreservingPrimaryError(primaryError, async () => {
      logStep('favorites', 'cleanup start');
      try {
        await runCleanupSteps([
          ...createdFavoriteProfileIds.filter(Boolean).map((profileId) =>
            anonymousIdentity?.token
              ? () => unfavoriteAccountProfile(api, baseUrl, anonymousIdentity.token, profileId)
              : null
          ),
          ...createdFallbackFavoriteProfileIds.filter(Boolean).map((profileId) =>
            fallbackOnlyIdentity?.token
              ? () => unfavoriteAccountProfile(api, baseUrl, fallbackOnlyIdentity.token, profileId)
              : null
          ),
          ...[...createdEvents].reverse().filter(Boolean).map((eventId) =>
            () => deleteEvent(api, baseUrl, session?.token, eventId)
          ),
          ...createdAccountSlugs.filter(Boolean).map((accountSlug) =>
            () => cleanupOnboardedAccount(api, baseUrl, session?.token, accountSlug)
          ),
          eventTypeId
            ? () => deleteEventType(api, baseUrl, session?.token, eventTypeId)
            : null,
          profileTypeKey
            ? () => deleteAccountProfileType(api, baseUrl, session?.token, profileTypeKey)
            : null,
        ]);
        logStep('favorites', 'cleanup steps completed');
      } finally {
        if (fallbackPublicContext) {
          await fallbackPublicContext.close().catch(() => {});
        }
        if (publicContext) {
          await publicContext.close().catch(() => {});
        }
        logStep('favorites', 'public context closed');
        await api.dispose();
        logStep('favorites', 'api disposed');
      }
    });
  }
});

test('@mutation tenant-admin persisted WhatsApp edit saves without a draft key and preserves server-owned id', async () => {
  test.setTimeout(600000);
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  let browserContext;
  let freshBrowser;
  let session = null;
  let accountSlug = null;
  let profileId = null;
  let profileTypeKey = null;
  let primaryError = null;

  try {
    session = await loginTenantAdmin(api, baseUrl);
    const unique = Date.now();
    const createdProfileType = (
      await createAccountProfileType(api, baseUrl, session.token, {
        type: `pw-contact-channel-${unique}`,
        label: `PW Contact Channel ${unique}`,
        allowedTaxonomies: [],
        markerColor: '#0B6E4F',
        capabilities: {
          is_favoritable: false,
          is_publicly_discoverable: false,
          is_publicly_navigable: false,
          has_avatar: false,
          has_cover: false,
          has_taxonomies: false,
          has_contact_channels: true,
        },
      })
    )?.data;
    profileTypeKey = createdProfileType?.type?.toString() || '';
    expect(profileTypeKey, 'Contact-channel profile type must be created.').toBeTruthy();

    const createdProfile = await createAccountProfileForType(
      api,
      baseUrl,
      session.token,
      {
        name: `PW Contact Channel Profile ${unique}`,
        profileType: createdProfileType,
      },
    );
    accountSlug = createdProfile.accountSlug;
    profileId = createdProfile.profileId?.toString() || null;
    expect(accountSlug, 'Contact-channel account onboarding must return a slug.').toBeTruthy();
    expect(profileId, 'Contact-channel account onboarding must return a profile id.').toBeTruthy();

    const initialTitle = `Inicial ${unique}`;
    const seedResponse = await api.patch(
      buildApiUrl(baseUrl, `/admin/api/v1/account_profiles/${profileId}`),
      {
        headers: authHeaders(session.token),
        data: {
          contact_mode: 'own',
          contact_channels: [
            {
              draft_key: `whatsapp-${unique}`,
              type: 'whatsapp',
              value: '+55 (27) 99999-1111',
              title: initialTitle,
            },
          ],
        },
      },
    );
    expect(seedResponse.status(), 'Persisted WhatsApp seed must succeed.').toBe(200);
    const seededProfile = normalizePayload(await seedResponse.json());
    const persistedChannel = normalizeList(seededProfile?.contact_channels)[0] || {};
    const persistedChannelId = persistedChannel?.id?.toString() || '';
    expect(persistedChannelId, 'Seeded WhatsApp must receive a server-owned id.').toBeTruthy();

    const pageBundle = await createFreshAuthenticatedTenantAdminPage(session);
    freshBrowser = pageBundle.browser;
    browserContext = pageBundle.context;
    const page = pageBundle.page;
    const collectors = installFailureCollectors(page);
    const editUrl = buildApiUrl(
      baseUrl,
      `/admin/accounts/${accountSlug}/profiles/${profileId}/edit`,
    );

    const editResponse = await page.goto(editUrl, { waitUntil: 'domcontentloaded' });
    expect(editResponse, 'Contact-channel edit route must respond.').not.toBeNull();
    expect(editResponse.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);

    const titleField = page.getByLabel('Título de WhatsApp (opcional)').first();
    await scrollUntilVisible(
      page,
      titleField,
      'Expected the persisted WhatsApp title editor in the account-profile edit flow.',
    );
    await expectFlutterFieldRenderedValue(
      titleField,
      initialTitle,
      'Expected the persisted WhatsApp title before editing.',
    );

    const updatedTitle = `Atualizado ${unique}`;
    await fillFlutterTextField(page, 'Título de WhatsApp (opcional)', updatedTitle);

    const saveRequestPromise = page.waitForRequest((candidate) => {
      return (
        candidate.method() === 'PATCH' &&
        candidate.url().includes(`/admin/api/v1/account_profiles/${profileId}`)
      );
    });
    const saveResponsePromise = page.waitForResponse((candidate) => {
      return (
        candidate.request().method() === 'PATCH' &&
        candidate.url().includes(`/admin/api/v1/account_profiles/${profileId}`)
      );
    });
    await clickSaveChanges(page);
    const [saveRequest, saveResponse] = await Promise.all([
      saveRequestPromise,
      saveResponsePromise,
    ]);
    expect(saveResponse.status(), 'Persisted WhatsApp edit must not return 422.').toBe(200);

    const savePayload = saveRequest.postDataJSON();
    const savedChannel = normalizeList(savePayload?.contact_channels).find(
      (channel) => channel?.type === 'whatsapp',
    );
    expect(savedChannel, 'Edit save must submit the persisted WhatsApp.').toBeTruthy();
    expect(savedChannel?.id, 'Edit save must retain the server-owned id.').toBe(
      persistedChannelId,
    );
    expect(
      Object.prototype.hasOwnProperty.call(savedChannel, 'draft_key'),
      'Edit save must omit the request-local draft key for a persisted WhatsApp.',
    ).toBe(false);
    expect(savedChannel?.title, 'Edit save must submit the changed WhatsApp title.').toBe(
      updatedTitle,
    );

    await expect
      .poll(
        async () => {
          const profile = await fetchAdminProfile(
            api,
            baseUrl,
            session.token,
            profileId,
          );
          return normalizeList(profile?.contact_channels).find(
            (channel) => channel?.id?.toString() === persistedChannelId,
          )?.title || '';
        },
        {
          timeout: appBootTimeoutMs,
          message: 'Expected persisted WhatsApp title to survive the edit/save readback.',
        },
      )
      .toBe(updatedTitle);

    await assertNoBrowserFailures(collectors);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await runCleanupPreservingPrimaryError(primaryError, async () => {
      try {
        await runCleanupSteps([
          accountSlug
            ? () => cleanupOnboardedAccount(api, baseUrl, session?.token, accountSlug)
            : null,
          profileTypeKey
            ? () => deleteAccountProfileType(api, baseUrl, session?.token, profileTypeKey)
            : null,
        ]);
      } finally {
        if (browserContext) {
          await browserContext.close().catch(() => {});
        }
        if (freshBrowser) {
          await freshBrowser.close().catch(() => {});
        }
        await api.dispose();
      }
    });
  }
});

test.skip('@deferred @mutation tenant-admin account profile nested tabs obey profile type capability', async ({
  browser,
}) => {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  let browserContext;
  let freshBrowser;
  let session = null;
  let disabledTypeKey = null;
  let enabledTypeKey = null;
  let disabledAccountSlug = null;
  let enabledAccountSlug = null;

  try {
    session = await loginTenantAdmin(api, baseUrl);
    const unique = Date.now();
    const disabledType = (
      await createAccountProfileType(api, baseUrl, session.token, {
        type: `pw-nested-off-${unique}`,
        label: `PW Nested Off ${unique}`,
        allowedTaxonomies: [],
        markerColor: '#65758B',
        capabilities: {
          is_favoritable: false,
          is_poi_enabled: false,
          has_avatar: false,
          has_cover: false,
          has_taxonomies: false,
          has_nested_profile_groups: false,
        },
      })
    )?.data;
    const enabledType = (
      await createAccountProfileType(api, baseUrl, session.token, {
        type: `pw-nested-on-${unique}`,
        label: `PW Nested On ${unique}`,
        allowedTaxonomies: [],
        markerColor: '#0E7A6A',
        capabilities: {
          is_favoritable: false,
          is_poi_enabled: false,
          has_avatar: false,
          has_cover: false,
          has_taxonomies: false,
          has_nested_profile_groups: true,
        },
      })
    )?.data;
    disabledTypeKey = disabledType?.type?.toString() || '';
    enabledTypeKey = enabledType?.type?.toString() || '';
    expect(disabledTypeKey, 'Disabled nested type must be created.').toBeTruthy();
    expect(enabledTypeKey, 'Enabled nested type must be created.').toBeTruthy();

    const disabledProfile = await createAccountProfileForType(
      api,
      baseUrl,
      session.token,
      {
        name: `PW Nested Disabled ${unique}`,
        profileType: disabledType,
      },
    );
    const enabledProfile = await createAccountProfileForType(
      api,
      baseUrl,
      session.token,
      {
        name: `PW Nested Enabled ${unique}`,
        profileType: enabledType,
      },
    );
    disabledAccountSlug = disabledProfile.accountSlug;
    enabledAccountSlug = enabledProfile.accountSlug;
    expect(disabledProfile.profileId, 'Disabled profile id must exist.').toBeTruthy();
    expect(enabledProfile.profileId, 'Enabled profile id must exist.').toBeTruthy();

    const pageBundle = await createFreshAuthenticatedTenantAdminPage(session);
    freshBrowser = pageBundle.browser;
    browserContext = pageBundle.context;
    const page = pageBundle.page;
    const collectors = installFailureCollectors(page);

    let response = await page.goto(
      buildApiUrl(
        baseUrl,
        `/admin/accounts/${disabledProfile.accountSlug}/profiles/${disabledProfile.profileId}/edit`,
      ),
      { waitUntil: 'domcontentloaded' },
    );
    expect(response, 'Disabled profile edit response should be available.').not.toBeNull();
    expect(response.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);
    await expect(page.getByText('Editar Perfil')).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    await expect(page.getByText('Abas de contas vinculadas')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Adicionar grupo' }),
    ).toHaveCount(0);

    response = await page.goto(
      buildApiUrl(
        baseUrl,
        `/admin/accounts/${enabledProfile.accountSlug}/profiles/${enabledProfile.profileId}/edit`,
      ),
      { waitUntil: 'domcontentloaded' },
    );
    expect(response, 'Enabled profile edit response should be available.').not.toBeNull();
    expect(response.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);
    await scrollUntilVisible(
      page,
      page.getByText('Abas de contas vinculadas'),
      'Expected nested account tabs section for a capability-enabled profile type.',
    );
    await expect(page.getByText('Abas de contas vinculadas')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Adicionar grupo' })).toBeVisible();

    const profileTypesLoaded = page.waitForResponse((candidate) => {
      if (!candidate.url().includes('/admin/api/v1/account_profile_types')) {
        return false;
      }
      return candidate.status() === 200;
    });

    response = await page.goto(
      buildApiUrl(baseUrl, '/admin/accounts/create'),
      { waitUntil: 'domcontentloaded' },
    );
    expect(response, 'Account onboarding create response should be available.').not.toBeNull();
    expect(response.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);
    const profileTypesPayload = await (await profileTypesLoaded).json();
    const loadedTypes = Array.isArray(profileTypesPayload?.data)
      ? profileTypesPayload.data
      : [];
    expect(
      loadedTypes.some((entry) => entry?.type === disabledTypeKey),
      `Expected disabled profile type ${disabledTypeKey} in account onboarding type payload.`,
    ).toBe(true);
    expect(
      loadedTypes.some((entry) => entry?.type === enabledTypeKey),
      `Expected enabled profile type ${enabledTypeKey} in account onboarding type payload.`,
    ).toBe(true);
    await expect(page.getByText('Criar Conta')).toBeVisible({
      timeout: appBootTimeoutMs,
    });

    await selectDropdownOption(page, {
      flow: 'nested-tabs',
      fieldLabel: 'Tipo de perfil',
      optionText: disabledType.label,
      logStep,
    });
    await page.waitForTimeout(250);
    await expect(page.getByText('Abas de contas vinculadas')).toHaveCount(0);

    await selectDropdownOption(page, {
      flow: 'nested-tabs',
      fieldLabel: 'Tipo de perfil',
      optionText: enabledType.label,
      logStep,
    });
    await page.waitForTimeout(250);
    await scrollUntilVisible(
      page,
      page.getByText('Abas de contas vinculadas'),
      'Expected nested account tabs section in canonical account onboarding create flow.',
    );
    await expect(page.getByText('Abas de contas vinculadas')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Adicionar grupo' })).toBeVisible();

    await assertNoBrowserFailures(collectors);
  } finally {
    if (session?.token) {
      await cleanupOnboardedAccount(api, baseUrl, session.token, disabledAccountSlug);
      await cleanupOnboardedAccount(api, baseUrl, session.token, enabledAccountSlug);
      await deleteAccountProfileType(api, baseUrl, session.token, disabledTypeKey);
      await deleteAccountProfileType(api, baseUrl, session.token, enabledTypeKey);
    }
    if (browserContext) {
      await browserContext.close();
    }
    if (freshBrowser) {
      await freshBrowser.close().catch(() => {});
    }
    await api.dispose();
  }
});

test('@mutation U04-ACCOUNT-GROUP-HEAD tenant-admin account-profile group heads persist independently, adopt canonical ids, and delete after confirmation', async () => {
  test.setTimeout(900000);
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  let browserContext;
  let freshBrowser;
  let session = null;
  let nestedTypeKey = null;
  let primaryError = null;
  const createdAccountSlugs = [];

  try {
    session = await loginTenantAdmin(api, baseUrl);
    const unique = Date.now();
    const nestedType = (
      await createAccountProfileType(api, baseUrl, session.token, {
        type: `pw-u04-nested-${unique}`,
        label: `PW U04 Nested ${unique}`,
        allowedTaxonomies: [],
        markerColor: '#0E7A6A',
        capabilities: {
          is_queryable: true,
          is_favoritable: false,
          is_poi_enabled: false,
          has_avatar: false,
          has_cover: false,
          has_taxonomies: false,
          has_nested_profile_groups: true,
        },
      })
    )?.data;
    nestedTypeKey = nestedType?.type?.toString() || '';
    expect(nestedTypeKey, 'U04 nested profile type must be created.').toBeTruthy();

    const xapuri = await createAccountProfileForType(
      api,
      baseUrl,
      session.token,
      {
        name: `Xapuri U04 ${unique}`,
        profileType: nestedType,
      },
    );
    createdAccountSlugs.push(xapuri.accountSlug);
    expect(xapuri.profileId, 'U04 Xapuri candidate must have an id.').toBeTruthy();
    expect(xapuri.displayName, 'U04 Xapuri candidate must expose display name.').toBeTruthy();

    const nestedParent = await createAccountProfileForType(
      api,
      baseUrl,
      session.token,
      {
        name: `PW U04 Nested Parent ${unique}`,
        profileType: nestedType,
      },
    );
    createdAccountSlugs.push(nestedParent.accountSlug);
    expect(nestedParent.profileId, 'U04 nested parent must have an id.').toBeTruthy();

    const pageBundle = await createFreshAuthenticatedTenantAdminPage(session);
    freshBrowser = pageBundle.browser;
    browserContext = pageBundle.context;
    const page = pageBundle.page;
    const collectors = installFailureCollectors(page);
    const nestedEditUrl = buildApiUrl(
      baseUrl,
      `/admin/accounts/${nestedParent.accountSlug}/profiles/${nestedParent.profileId}/edit`,
    );
    const aggregateProfileWrites = [];
    const trackAggregateProfileWrite = (request) => {
      const method = request.method().toUpperCase();
      if (method !== 'PATCH') {
        return;
      }
      let url;
      try {
        url = new URL(request.url());
      } catch (_) {
        return;
      }
      if (url.pathname === `/admin/api/v1/account_profiles/${nestedParent.profileId}`) {
        aggregateProfileWrites.push(url.toString());
      }
    };
    page.on('request', trackAggregateProfileWrite);

    const nestedEditResponse = await page.goto(nestedEditUrl, {
      waitUntil: 'domcontentloaded',
    });
    expect(nestedEditResponse, 'U04 nested edit route must respond.').not.toBeNull();
    expect(nestedEditResponse.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);
    await scrollUntilVisible(
      page,
      page.getByText('Abas de contas vinculadas'),
      'U04 nested parent must expose the canonical nested-group editor.',
    );

    const createGroupResponsePromise = page.waitForResponse((candidate) => {
      return (
        candidate.request().method() === 'POST' &&
        candidate.url().includes(
          `/admin/api/v1/account_profiles/${nestedParent.profileId}/nested_profile_groups`,
        ) &&
        candidate.status() < 400
      );
    });
    await page.getByRole('button', { name: 'Adicionar grupo' }).click();
    await expect(page.getByText('Novo grupo')).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    await fillFlutterTextField(page, 'Nome do grupo', 'Parceiros');
    await page.getByRole('button', { name: 'Criar grupo' }).click();
    const createGroupResponse = await createGroupResponsePromise;
    const createGroupPayload = normalizePayload(await createGroupResponse.json());
    const createdGroupFromResponse = normalizeList(
      createGroupPayload?.nested_profile_groups,
    ).find((group) => group?.label === 'Parceiros');
    const createdGroupIdFromResponse =
      createdGroupFromResponse?.id?.toString().trim() || '';
    expect(
      createdGroupIdFromResponse,
      'Dedicated nested-group create must return a persisted group id.',
    ).toBeTruthy();
    await expect(page.getByRole('button', {
      name: new RegExp(`^Nome da aba\\s*${escapeRegExp('Parceiros')}$`, 'i'),
    })).toBeVisible({ timeout: appBootTimeoutMs });
    await expect(page.getByText('0 perfis vinculados', { exact: true })).toBeVisible({
      timeout: appBootTimeoutMs,
    });

    let createdGroupId = createdGroupIdFromResponse;
    await expect
      .poll(
        async () => {
          const nestedReadback = await fetchAdminProfile(
            api,
            baseUrl,
            session.token,
            nestedParent.profileId,
          );
          const persistedGroup = normalizeList(
            nestedReadback?.nested_profile_groups,
          ).find((group) => group?.label === 'Parceiros');
          createdGroupId = persistedGroup?.id?.toString().trim() || '';
          return [
            createdGroupId,
            persistedGroup?.label?.toString() || '',
            Number(persistedGroup?.member_count || 0),
          ].join('|');
        },
        {
          timeout: appBootTimeoutMs,
          message:
            'U04 nested-group create must persist the group head immediately in authoritative readback.',
        },
      )
      .toBe(`${createdGroupIdFromResponse}|Parceiros|0`);

    await page.getByRole('button', { name: 'Gerenciar perfis' }).click();
    await expect(page.getByRole('button', { name: 'Adicionar perfis' })).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    await page.getByRole('button', { name: 'Adicionar perfis' }).click();

    await fillFlutterTextField(page, 'Buscar perfil', xapuri.displayName);
    const addMemberResponsePromise = page.waitForResponse((candidate) => {
      return (
        candidate.request().method() === 'PATCH' &&
        candidate.url().includes(
          `/admin/api/v1/account_profiles/${nestedParent.profileId}/nested_profile_groups/${createdGroupId}/members`,
        ) &&
        candidate.status() < 400
      );
    });
    const xapuriCheckbox = page.getByRole('checkbox', {
      name: new RegExp(escapeRegExp(xapuri.displayName)),
    });
    await expect(xapuriCheckbox).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    await logU04PickerSemanticSnapshot(page, xapuri.displayName);
    let xapuriChecked = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await xapuriCheckbox.click();
      await page.waitForTimeout(150);
      xapuriChecked =
        ((await xapuriCheckbox.getAttribute('aria-checked').catch(() => '')) || '') ===
        'true';
      if (xapuriChecked) {
        break;
      }
    }
    await logU04PickerSemanticSnapshot(page, xapuri.displayName);
    expect(
      xapuriChecked,
      'U04 nested-group candidate checkbox must become checked through semantic row interaction.',
    ).toBe(true);
    await expect(page.getByText('1 selecionado(s)', { exact: true })).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    await page.getByRole('button', { name: 'Adicionar' }).last().click();
    const addMemberResponse = await addMemberResponsePromise;
    const addMemberPayload = normalizePayload(await addMemberResponse.json());
    logStep(
      'u04-group-head',
      `dedicated add-members response aggregate revision ${Number(addMemberPayload?.aggregate_revision || 0)}`,
    );

    await expect
      .poll(
        async () => {
          const nestedSummaryReadback = await fetchAdminProfile(
            api,
            baseUrl,
            session.token,
            nestedParent.profileId,
          );
          const persistedGroup = normalizeList(
            nestedSummaryReadback?.nested_profile_groups,
          ).find((group) => group?.id?.toString() === createdGroupId);
          const nestedMembersReadback = await fetchAdminNestedGroupMembers(
            api,
            baseUrl,
            session.token,
            nestedParent.profileId,
            createdGroupId,
          );
          const memberIds = normalizeList(nestedMembersReadback?.data).map((member) =>
            member?.id?.toString(),
          );
          return [
            Number(nestedSummaryReadback?.aggregate_revision || 0),
            Number(persistedGroup?.member_count || 0),
            memberIds.includes(xapuri.profileId?.toString()) ? 'present' : 'missing',
          ].join('|');
        },
        {
          timeout: appBootTimeoutMs,
          message:
            'U04 nested-group member add must target the persisted group id and survive authoritative readback.',
        },
      )
      .toBe('3|1|present');

    const backToEditButton = page.getByRole('button', { name: /voltar/i }).first();
    if (await backToEditButton.isVisible().catch(() => false)) {
      await backToEditButton.click();
      await expect(page.getByText('Editar Perfil')).toBeVisible({
        timeout: appBootTimeoutMs,
      });
    } else {
      const reloadedResponse = await page.goto(nestedEditUrl, {
        waitUntil: 'domcontentloaded',
      });
      expect(reloadedResponse, 'U04 nested edit route reload must respond.').not.toBeNull();
      expect(reloadedResponse.status()).toBeLessThan(400);
      await assertAppBooted(page);
      await enableAccessibilityIfNeeded(page);
    }
    await scrollUntilVisible(
      page,
      page.getByRole('button', {
        name: new RegExp(`^Nome da aba\\s*${escapeRegExp('Parceiros')}$`, 'i'),
      }),
      'U04 persisted group must stay visible after returning from member management.',
    );
    await expect(page.getByText('1 perfil vinculado', { exact: true })).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    logStep('u04-group-head', 'returned to edit with 1 linked profile');

    const removeGroupButton = page.getByRole('button', { name: 'Remover grupo' }).first();
    const deleteGroupDialogTitle = page.getByText('Excluir grupo', { exact: true });
    logStep('u04-group-head', 'preparing first destructive-confirmation open');
    await scrollUntilVisible(
      page,
      removeGroupButton,
      'U04 remove-group action must stay actionable after returning from member management.',
    );
    await expect(removeGroupButton).toBeEnabled({
      timeout: appBootTimeoutMs,
    });
    await removeGroupButton.focus();
    await page.keyboard.press('Enter');
    logStep('u04-group-head', 'first destructive-confirmation trigger sent');
    await expect(deleteGroupDialogTitle).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    logStep('u04-group-head', 'first destructive-confirmation visible');
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await expect(deleteGroupDialogTitle).toHaveCount(0, {
      timeout: appBootTimeoutMs,
    });
    logStep('u04-group-head', 'first destructive-confirmation cancelled');
    await expect(page.getByRole('button', {
      name: new RegExp(`^Nome da aba\\s*${escapeRegExp('Parceiros')}$`, 'i'),
    })).toBeVisible({ timeout: appBootTimeoutMs });
    const cancelledDeleteReadback = await fetchAdminProfile(
      api,
      baseUrl,
      session.token,
      nestedParent.profileId,
    );
    expect(
      normalizeList(cancelledDeleteReadback?.nested_profile_groups).some(
        (group) => group?.id?.toString() === createdGroupId,
      ),
      'Cancelling the destructive confirmation must preserve the persisted group head.',
    ).toBe(true);
    logStep(
      'u04-group-head',
      `authoritative aggregate revision before confirmed delete ${Number(cancelledDeleteReadback?.aggregate_revision || 0)}`,
    );

    const deleteGroupRequestPromise = page.waitForRequest((candidate) => {
      return (
        candidate.method() === 'DELETE' &&
        candidate.url().includes(
          `/admin/api/v1/account_profiles/${nestedParent.profileId}/nested_profile_groups/${createdGroupId}`,
        )
      );
    });
    const deleteGroupResponsePromise = page.waitForResponse((candidate) => {
      return (
        candidate.request().method() === 'DELETE' &&
        candidate.url().includes(
          `/admin/api/v1/account_profiles/${nestedParent.profileId}/nested_profile_groups/${createdGroupId}`,
        )
      );
    });
    logStep('u04-group-head', 'preparing confirmed delete');
    await scrollUntilVisible(
      page,
      removeGroupButton,
      'U04 confirmed delete action must stay actionable after cancellation.',
    );
    await expect(removeGroupButton).toBeEnabled({
      timeout: appBootTimeoutMs,
    });
    await removeGroupButton.focus();
    await page.keyboard.press('Enter');
    logStep('u04-group-head', 'confirmed delete trigger sent');
    await expect(deleteGroupDialogTitle).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    logStep('u04-group-head', 'confirmed delete dialog visible');
    const confirmDeleteButton = page.getByRole('button', { name: 'Excluir' }).last();
    await confirmDeleteButton.focus();
    await page.keyboard.press('Enter');
    logStep('u04-group-head', 'confirmed delete button triggered');
    const deleteGroupRequest = await deleteGroupRequestPromise;
    logStep(
      'u04-group-head',
      `confirmed delete request sent ${deleteGroupRequest.method()} ${deleteGroupRequest.url()} body=${deleteGroupRequest.postData() || ''}`,
    );
    const deleteGroupResponse = await deleteGroupResponsePromise;
    logStep(
      'u04-group-head',
      `confirmed delete response received ${deleteGroupResponse.status()}`,
    );
    expect(
      deleteGroupResponse.status(),
      'Confirmed delete request must succeed against the dedicated authority.',
    ).toBeLessThan(400);
    await expect(page.getByRole('button', {
      name: new RegExp(`^Nome da aba\\s*${escapeRegExp('Parceiros')}$`, 'i'),
    })).toHaveCount(0, { timeout: appBootTimeoutMs });
    logStep('u04-group-head', 'ui no longer renders the deleted group');
    await expect
      .poll(
        async () => {
          const nestedReadback = await fetchAdminProfile(
            api,
            baseUrl,
            session.token,
            nestedParent.profileId,
          );
          return normalizeList(nestedReadback?.nested_profile_groups).some(
            (group) => group?.id?.toString() === createdGroupId,
          )
            ? 'present'
            : 'deleted';
        },
        {
          timeout: appBootTimeoutMs,
          message:
            'Confirmed delete must remove the persisted group head from authoritative readback.',
        },
      )
      .toBe('deleted');

    const overLimitLabel = `Limite U04 ${unique}`;
    for (let index = 0; index < 12; index += 1) {
      const seedGroupResponse = await api.post(
        buildApiUrl(
          baseUrl,
          `/admin/api/v1/account_profiles/${nestedParent.profileId}/nested_profile_groups`,
        ),
        {
          data: {
            label: `Grupo limite ${index + 1}`,
          },
          headers: authHeaders(session.token),
        },
      );
      expect(
        seedGroupResponse.status(),
        'Seeded nested groups must fill the backend limit before the over-ceiling create check.',
      ).toBeLessThan(400);
    }
    const overLimitCreateResponsePromise = page.waitForResponse((candidate) => {
      return (
        candidate.request().method() === 'POST' &&
        candidate.url().includes(
          `/admin/api/v1/account_profiles/${nestedParent.profileId}/nested_profile_groups`,
        ) &&
        candidate.status() >= 400
      );
    });
    const overLimitAddGroupButton = page.getByRole('button', {
      name: 'Adicionar grupo',
    });
    await scrollUntilVisible(
      page,
      overLimitAddGroupButton,
      'U04 over-limit create must keep the dedicated add-group action reachable on the stale local route state.',
    );
    await expect(overLimitAddGroupButton).toBeEnabled({
      timeout: appBootTimeoutMs,
    });
    logStep(
      'u04-group-head',
      'over-limit create path still exposes a locally actionable add-group trigger before the backend rejection.',
    );
    await overLimitAddGroupButton.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Novo grupo')).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    await fillFlutterTextField(page, 'Nome do grupo', overLimitLabel);
    await page.getByRole('button', { name: 'Criar grupo' }).last().click();
    const overLimitCreateResponse = await overLimitCreateResponsePromise;
    expect(
      overLimitCreateResponse.status(),
      'The thirteenth nested-group create attempt must fail on the dedicated backend boundary.',
    ).toBeGreaterThanOrEqual(400);
    await expect(
      page.getByText(
        /Nested profile groups exceed the configured limit|Limite de grupos|Não foi possível criar o grupo/i,
      ),
    ).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    await expect(page.getByText(overLimitLabel, { exact: true })).toHaveCount(0, {
      timeout: appBootTimeoutMs,
    });
    await expect
      .poll(
        async () => {
          const nestedReadback = await fetchAdminProfile(
            api,
            baseUrl,
            session.token,
            nestedParent.profileId,
          );
          const groups = normalizeList(nestedReadback?.nested_profile_groups);
          return [
            groups.length,
            groups.some((group) => group?.label === overLimitLabel)
              ? 'present'
              : 'absent',
          ].join('|');
        },
        {
          timeout: appBootTimeoutMs,
          message:
            'Over-ceiling nested-group create must preserve authoritative state and leave no phantom local group.',
        },
      )
      .toBe('12|absent');

    page.off('request', trackAggregateProfileWrite);
    expect(
      aggregateProfileWrites,
      'U04 dedicated group create/delete flow must not fall back to aggregate account-profile PATCH writes.',
    ).toHaveLength(0);
    await assertNoBrowserFailures(collectors, {
      allowedConsoleErrorSubstrings: [
        'Failed to load resource: the server responded with a status of 422',
      ],
      allowedResponseStatuses: [422],
    });
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await runCleanupPreservingPrimaryError(primaryError, async () => {
      for (const cleanup of [
        ...createdAccountSlugs
          .filter(Boolean)
          .map(
            (slug) => () =>
              cleanupOnboardedAccount(api, baseUrl, session?.token, slug),
          ),
        nestedTypeKey
          ? () => deleteAccountProfileType(api, baseUrl, session?.token, nestedTypeKey)
          : null,
      ].filter(Boolean)) {
        await cleanup();
      }
      if (browserContext) {
        await browserContext.close();
      }
      if (freshBrowser) {
        await freshBrowser.close().catch(() => {});
      }
      await api.dispose();
    });
  }
});

test.skip('@deferred @mutation U06-CANDIDATE-PICKER server-owned nested and contact candidate search persists through the canonical picker', async () => {
  test.setTimeout(900000);
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  let browserContext;
  let freshBrowser;
  let session = null;
  let nestedTypeKey = null;
  let contactTypeKey = null;
  let primaryError = null;
  const createdAccountSlugs = [];

  try {
    session = await loginTenantAdmin(api, baseUrl);
    const unique = Date.now();
    const nestedType = (
      await createAccountProfileType(api, baseUrl, session.token, {
        type: `pw-u06-nested-${unique}`,
        label: `PW U06 Nested ${unique}`,
        allowedTaxonomies: [],
        markerColor: '#0E7A6A',
        capabilities: {
          is_queryable: true,
          is_favoritable: false,
          is_poi_enabled: false,
          has_avatar: false,
          has_cover: false,
          has_taxonomies: false,
          has_nested_profile_groups: true,
        },
      })
    )?.data;
    nestedTypeKey = nestedType?.type?.toString() || '';
    expect(nestedTypeKey, 'U06 nested profile type must be created.').toBeTruthy();

    const contactType = (
      await createAccountProfileType(api, baseUrl, session.token, {
        type: `pw-u06-contact-${unique}`,
        label: `PW U06 Contact ${unique}`,
        allowedTaxonomies: [],
        markerColor: '#1D4ED8',
        capabilities: {
          is_queryable: false,
          is_favoritable: false,
          is_poi_enabled: false,
          has_avatar: false,
          has_cover: false,
          has_taxonomies: false,
          has_contact_channels: true,
        },
      })
    )?.data;
    contactTypeKey = contactType?.type?.toString() || '';
    expect(contactTypeKey, 'U06 contact profile type must be created.').toBeTruthy();

    for (let index = 1; index <= 21; index += 1) {
      const filler = await createAccountProfileForType(
        api,
        baseUrl,
        session.token,
        {
          name: `Xa Fixture ${String(index).padStart(3, '0')} ${unique}`,
          profileType: nestedType,
        },
      );
      createdAccountSlugs.push(filler.accountSlug);
    }

    const xapuri = await createAccountProfileForType(
      api,
      baseUrl,
      session.token,
      {
        name: `Xapuri U06 ${unique}`,
        profileType: nestedType,
      },
    );
    createdAccountSlugs.push(xapuri.accountSlug);
    expect(xapuri.profileId, 'U06 Xapuri candidate must have an id.').toBeTruthy();

    const nestedParent = await createAccountProfileForType(
      api,
      baseUrl,
      session.token,
      {
        name: `PW U06 Nested Parent ${unique}`,
        profileType: nestedType,
      },
    );
    createdAccountSlugs.push(nestedParent.accountSlug);
    expect(nestedParent.profileId, 'U06 nested parent must have an id.').toBeTruthy();

    const contactSource = await createAccountProfileForType(
      api,
      baseUrl,
      session.token,
      {
        name: `Mirror Source U06 ${unique}`,
        profileType: contactType,
      },
    );
    createdAccountSlugs.push(contactSource.accountSlug);
    expect(contactSource.profileId, 'U06 contact source must have an id.').toBeTruthy();

    const contactTitle = `WhatsApp U06 ${unique}`;
    const sourceSeed = await api.patch(
      buildApiUrl(baseUrl, `/admin/api/v1/account_profiles/${contactSource.profileId}`),
      {
        headers: authHeaders(session.token),
        data: {
          contact_mode: 'own',
          contact_channels: [
            {
              draft_key: `u06-whatsapp-${unique}`,
              type: 'whatsapp',
              value: '+55 (27) 99999-0040',
              title: contactTitle,
            },
          ],
        },
      },
    );
    expect(sourceSeed.status(), 'U06 contact source seed must succeed.').toBe(200);
    const sourcePayload = normalizePayload(await sourceSeed.json());
    const sourceChannel = normalizeList(sourcePayload?.contact_channels)[0] || {};
    const sourceChannelId = sourceChannel?.id?.toString() || '';
    expect(sourceChannelId, 'U06 contact source must retain a channel id.').toBeTruthy();

    const contactTarget = await createAccountProfileForType(
      api,
      baseUrl,
      session.token,
      {
        name: `Mirror Target U06 ${unique}`,
        profileType: contactType,
      },
    );
    createdAccountSlugs.push(contactTarget.accountSlug);
    expect(contactTarget.profileId, 'U06 contact target must have an id.').toBeTruthy();

    const pageBundle = await createFreshAuthenticatedTenantAdminPage(session);
    freshBrowser = pageBundle.browser;
    browserContext = pageBundle.context;
    const page = pageBundle.page;
    const collectors = installFailureCollectors(page);

    const nestedEditUrl = buildApiUrl(
      baseUrl,
      `/admin/accounts/${nestedParent.accountSlug}/profiles/${nestedParent.profileId}/edit`,
    );
    const nestedEditResponse = await page.goto(nestedEditUrl, {
      waitUntil: 'domcontentloaded',
    });
    expect(nestedEditResponse, 'U06 nested edit route must respond.').not.toBeNull();
    expect(nestedEditResponse.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);
    await scrollUntilVisible(
      page,
      page.getByText('Abas de contas vinculadas'),
      'U06 nested parent must expose the canonical nested-group editor.',
    );
    await page.getByRole('button', { name: 'Adicionar grupo' }).click();
    await page.getByRole('button', { name: 'Selecionar perfis' }).click();
    await expect(
      page.getByText('Digite ao menos 2 caracteres para buscar.'),
    ).toBeVisible({ timeout: appBootTimeoutMs });

    const firstPageResponsePromise = page.waitForResponse((candidate) => {
      const url = new URL(candidate.url());
      return (
        candidate.request().method() === 'GET' &&
        url.pathname === '/admin/api/v1/account_profiles/candidates' &&
        url.searchParams.get('scope') === 'queryable' &&
        url.searchParams.get('search') === 'xa' &&
        candidate.status() === 200
      );
    });
    await fillFlutterTextField(page, 'Buscar perfil', 'xa');
    const firstPageResponse = await firstPageResponsePromise;
    const firstPagePayload = await firstPageResponse.json();
    expect(firstPagePayload?.data).toHaveLength(20);
    expect(firstPagePayload?.has_more).toBe(true);
    expect(
      normalizeList(firstPagePayload?.data).some(
        (entry) => entry?.id?.toString() === xapuri.profileId?.toString(),
      ),
      'Xapuri must be outside the initial 20-row xa page fixture.',
    ).toBe(false);

    const xapuriSearchResponsePromise = page.waitForResponse((candidate) => {
      const url = new URL(candidate.url());
      return (
        candidate.request().method() === 'GET' &&
        url.pathname === '/admin/api/v1/account_profiles/candidates' &&
        url.searchParams.get('scope') === 'queryable' &&
        url.searchParams.get('search') === 'xapuri' &&
        candidate.status() === 200
      );
    });
    await fillFlutterTextField(page, 'Buscar perfil', 'xapuri');
    const xapuriSearchResponse = await xapuriSearchResponsePromise;
    const xapuriPayload = await xapuriSearchResponse.json();
    expect(
      normalizeList(xapuriPayload?.data).map((entry) => entry?.id?.toString()),
    ).toContain(xapuri.profileId?.toString());

    await page.getByText(xapuri.displayName, { exact: true }).click();
    await page.getByRole('button', { name: 'Confirmar' }).last().click();
    const nestedSaveResponsePromise = page.waitForResponse((candidate) => {
      return (
        candidate.request().method() === 'PATCH' &&
        candidate.url().includes(`/admin/api/v1/account_profiles/${nestedParent.profileId}`) &&
        candidate.status() === 200
      );
    });
    await clickSaveChanges(page);
    await nestedSaveResponsePromise;
    const nestedReadback = await fetchAdminProfile(
      api,
      baseUrl,
      session.token,
      nestedParent.profileId,
    );
    expect(
      normalizeList(nestedReadback?.nested_profile_groups)
        .flatMap((group) => normalizeList(group?.account_profile_ids))
        .map((id) => id?.toString()),
      'Nested save must persist the selected Xapuri profile id.',
    ).toContain(xapuri.profileId?.toString());

    const contactEditUrl = buildApiUrl(
      baseUrl,
      `/admin/accounts/${contactTarget.accountSlug}/profiles/${contactTarget.profileId}/edit`,
    );
    const contactEditResponse = await page.goto(contactEditUrl, {
      waitUntil: 'domcontentloaded',
    });
    expect(contactEditResponse, 'U06 contact edit route must respond.').not.toBeNull();
    expect(contactEditResponse.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);
    await scrollUntilVisible(
      page,
      page.getByText('Origem do Contato'),
      'U06 contact target must expose the canonical contact-source section.',
    );
    await page.getByRole('radio', { name: /Espelhar outro perfil/i }).click();
    await page
      .getByRole('button', { name: 'Selecionar perfil de origem' })
      .click();

    const contactSearchResponsePromise = page.waitForResponse((candidate) => {
      const url = new URL(candidate.url());
      return (
        candidate.request().method() === 'GET' &&
        url.pathname === '/admin/api/v1/account_profiles/candidates' &&
        url.searchParams.get('scope') === 'contact_capable' &&
        url.searchParams.get('search') === 'mi' &&
        candidate.status() === 200
      );
    });
    await fillFlutterTextField(page, 'Buscar perfil', 'mi');
    const contactSearchResponse = await contactSearchResponsePromise;
    const contactSearchPayload = await contactSearchResponse.json();
    expect(
      normalizeList(contactSearchPayload?.data).map((entry) => entry?.id?.toString()),
    ).toContain(contactSource.profileId?.toString());

    await page.getByText(contactSource.displayName, { exact: true }).click();
    const sourceDetailResponsePromise = page.waitForResponse((candidate) => {
      return (
        candidate.request().method() === 'GET' &&
        candidate.url().includes(
          `/admin/api/v1/account_profiles/${contactSource.profileId}`,
        ) &&
        candidate.status() === 200
      );
    });
    await page.getByRole('button', { name: 'Confirmar' }).last().click();
    await sourceDetailResponsePromise;
    await expect(page.getByText(contactTitle, { exact: false }).first()).toBeVisible({
      timeout: appBootTimeoutMs,
    });

    const contactSaveResponsePromise = page.waitForResponse((candidate) => {
      return (
        candidate.request().method() === 'PATCH' &&
        candidate.url().includes(`/admin/api/v1/account_profiles/${contactTarget.profileId}`) &&
        candidate.status() === 200
      );
    });
    await clickSaveChanges(page);
    await contactSaveResponsePromise;
    const contactReadback = await fetchAdminProfile(
      api,
      baseUrl,
      session.token,
      contactTarget.profileId,
    );
    expect(contactReadback?.contact_mode).toBe('mirrored_account_profile');
    expect(contactReadback?.contact_source_account_profile_id?.toString()).toBe(
      contactSource.profileId?.toString(),
    );
    expect(
      normalizeList(contactReadback?.effective_contact_channels).map(
        (channel) => channel?.id?.toString(),
      ),
    ).toContain(sourceChannelId);

    await assertNoBrowserFailures(collectors);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await runCleanupPreservingPrimaryError(primaryError, async () => {
      try {
        await runCleanupSteps([
          ...createdAccountSlugs
            .reverse()
            .map((slug) => () => cleanupOnboardedAccount(api, baseUrl, session?.token, slug)),
          nestedTypeKey
            ? () => deleteAccountProfileType(api, baseUrl, session?.token, nestedTypeKey)
            : null,
          contactTypeKey
            ? () => deleteAccountProfileType(api, baseUrl, session?.token, contactTypeKey)
            : null,
        ]);
      } finally {
        if (browserContext) {
          await browserContext.close().catch(() => {});
        }
        if (freshBrowser) {
          await freshBrowser.close().catch(() => {});
        }
        await api.dispose();
      }
    });
  }
});

test.skip('@deferred @mutation tenant-admin account onboarding CRUD persists detail/edit readback and delete flow', async () => {
  test.setTimeout(600000);
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  let browserContext;
  let freshBrowser;
  let session = null;
  let accountSlug = null;
  let profileId = null;
  let profileTypeKey = null;
  let primaryError = null;

  try {
    session = await loginTenantAdmin(api, baseUrl);
    const unique = Date.now();
    const profileTypeLabel = `PW CRUD Account ${unique}`;
    const createdProfileType = normalizePayload(
      await createAccountProfileType(api, baseUrl, session.token, {
        type: `pw-crud-account-${unique}`,
        label: profileTypeLabel,
        allowedTaxonomies: [],
        markerColor: '#0F766E',
        capabilities: {
          is_favoritable: false,
          is_publicly_discoverable: true,
          is_publicly_navigable: true,
          has_avatar: false,
          has_cover: false,
          has_taxonomies: false,
          has_content: false,
          has_bio: false,
        },
      }),
    );
    profileTypeKey = createdProfileType?.type?.toString() || '';
    expect(profileTypeKey, 'CRUD account profile type must be created.').toBeTruthy();

    const initialName = `PW CRUD Account ${unique}`;
    const updatedDisplayName = `PW CRUD Visible ${unique}`;

    const pageBundle = await createFreshAuthenticatedTenantAdminPage(session);
    freshBrowser = pageBundle.browser;
    browserContext = pageBundle.context;
    const page = pageBundle.page;
    const collectors = installFailureCollectors(page);

    const createResponse = await page.goto(buildApiUrl(baseUrl, '/admin/accounts/create'), {
      waitUntil: 'domcontentloaded',
    });
    expect(createResponse, 'Account onboarding create route must respond.').not.toBeNull();
    expect(createResponse.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);

    await expect(page.getByText('Criar Conta')).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    await selectDropdownOption(page, {
      flow: 'account-crud',
      fieldLabel: 'Tipo de perfil',
      optionText: profileTypeLabel,
      logStep,
    });
    await page.waitForTimeout(250);
    await page.getByRole('button', { name: 'Nao gerenciada' }).click();
    await fillFlutterTextField(page, 'Nome', initialName);

    const createRequestPromise = page.waitForResponse((candidate) => {
      return (
        candidate.request().method() === 'POST' &&
        candidate.url().includes('/admin/api/v1/account_onboardings')
      );
    });

    await Promise.all([
      createRequestPromise,
      page.getByRole('button', { name: 'Salvar conta' }).last().click(),
    ]);

    const createRequest = await createRequestPromise;
    expect(createRequest.status(), 'Account onboarding create must succeed.').toBe(201);
    const created = normalizePayload(await createRequest.json());
    accountSlug = created?.account?.slug?.toString() || null;
    profileId = created?.account_profile?.id?.toString() || null;
    expect(accountSlug, 'Account onboarding must return account slug.').toBeTruthy();
    expect(profileId, 'Account onboarding must return profile id.').toBeTruthy();

    await expect(page.getByText(`Conta: ${accountSlug}`)).toBeVisible({
      timeout: appBootTimeoutMs,
    });

    await page.getByRole('button', { name: 'Editar' }).first().click();
    await expect(page.getByText('Editar Perfil')).toBeVisible({
      timeout: appBootTimeoutMs,
    });

    const displayNameField = page.getByLabel('Nome de exibicao').first();
    await scrollUntilVisible(
      page,
      displayNameField,
      'Expected Display Name field to render in the account-profile edit flow.',
    );
    await expectFlutterFieldRenderedValue(
      displayNameField,
      initialName,
      'Expected account onboarding readback to render the initial display name before edit.',
    );

    const saveResponsePromise = page.waitForResponse((candidate) => {
      return (
        candidate.request().method() === 'PATCH' &&
        candidate.url().includes(`/admin/api/v1/account_profiles/${profileId}`) &&
        candidate.status() < 400
      );
    });
    await fillFlutterTextField(page, 'Nome de exibicao', updatedDisplayName);
    await clickSaveChanges(page);
    await saveResponsePromise;

    await expect
      .poll(
        async () => {
          const profile = await fetchAdminProfile(
            api,
            baseUrl,
            session.token,
            profileId,
          );
          return profile?.display_name?.toString() || '';
        },
        {
          timeout: appBootTimeoutMs,
          message:
            'Expected account-profile edit save to persist the updated Display Name.',
        },
      )
      .toBe(updatedDisplayName);

    const detailResponse = await page.goto(
      buildApiUrl(baseUrl, `/admin/accounts/${accountSlug}`),
      {
        waitUntil: 'domcontentloaded',
      },
    );
    expect(detailResponse, 'Account detail route must reopen after edit.').not.toBeNull();
    expect(detailResponse.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);

    const deleteAccountButton = page.getByRole('button', { name: 'Excluir conta' }).first();
    await scrollUntilVisible(
      page,
      deleteAccountButton,
      'Expected unmanaged account detail to expose the delete action.',
    );
    const deleteResponsePromise = page.waitForResponse((candidate) => {
      return (
        candidate.request().method() === 'DELETE' &&
        candidate.url().includes(`/admin/api/v1/accounts/${accountSlug}`)
      );
    });
    await deleteAccountButton.click();
    await expect(page.getByText('Excluir conta').last()).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    await page.getByRole('button', { name: 'Excluir' }).last().click();
    const deleteResponse = await deleteResponsePromise;
    expect(
      [200, 204],
      'Account delete request must succeed after the bounded admin delete flow.',
    ).toContain(deleteResponse.status());

    await waitForAccountDeletion(api, baseUrl, session.token, profileId);
    accountSlug = null;
    profileId = null;

    await assertNoBrowserFailures(collectors);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await runCleanupPreservingPrimaryError(primaryError, async () => {
      try {
        await runCleanupSteps([
          accountSlug
            ? () => cleanupOnboardedAccount(api, baseUrl, session?.token, accountSlug)
            : null,
          profileTypeKey
            ? () => deleteAccountProfileType(api, baseUrl, session?.token, profileTypeKey)
            : null,
        ]);
      } finally {
        if (browserContext) {
          await browserContext.close().catch(() => {});
        }
        if (freshBrowser) {
          await freshBrowser.close().catch(() => {});
        }
        await api.dispose();
      }
    });
  }
});

test('@mutation tenant-admin account onboarding rejects stale selected profile type with inline 422', async () => {
  test.setTimeout(600000);
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  let browserContext;
  let freshBrowser;
  let session = null;
  let profileTypeKey = null;
  let primaryError = null;

  try {
    session = await loginTenantAdmin(api, baseUrl);
    const unique = Date.now();
    const profileTypeLabel = `PW Stale Profile Type ${unique}`;
    const createdProfileType = normalizePayload(
      await createAccountProfileType(api, baseUrl, session.token, {
        type: `pw-stale-profile-${unique}`,
        label: profileTypeLabel,
        allowedTaxonomies: [],
        markerColor: '#1D4ED8',
        capabilities: {
          is_favoritable: false,
          has_avatar: false,
          has_cover: false,
          has_taxonomies: false,
          has_content: false,
          has_bio: false,
        },
      }),
    );
    profileTypeKey = createdProfileType?.type?.toString() || '';
    expect(profileTypeKey, 'Stale-profile account type must be created.').toBeTruthy();

    const pageBundle = await createFreshAuthenticatedTenantAdminPage(session);
    freshBrowser = pageBundle.browser;
    browserContext = pageBundle.context;
    const page = pageBundle.page;
    const collectors = installFailureCollectors(page);
    const profileTypesLoaded = page.waitForResponse((candidate) => {
      if (!candidate.url().includes('/admin/api/v1/account_profile_types')) {
        return false;
      }
      return candidate.status() === 200;
    });

    const response = await page.goto(buildApiUrl(baseUrl, '/admin/accounts/create'), {
      waitUntil: 'domcontentloaded',
    });
    expect(response, 'Account onboarding create route must respond.').not.toBeNull();
    expect(response.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);
    const profileTypesPayload = await (await profileTypesLoaded).json();
    const loadedTypes = Array.isArray(profileTypesPayload?.data)
      ? profileTypesPayload.data
      : [];
    expect(
      loadedTypes.some((entry) => entry?.type === profileTypeKey),
      `Expected stale profile type ${profileTypeKey} in account onboarding type payload.`,
    ).toBe(true);

    await selectDropdownOption(page, {
      flow: 'account-422',
      fieldLabel: 'Tipo de perfil',
      optionText: profileTypeLabel,
      logStep,
    });
    logStep('account-422', 'profile type selected');
    await page.waitForTimeout(250);
    await fillFlutterTextField(page, 'Nome', `PW Invalid Account ${unique}`);
    logStep('account-422', 'name field filled');
    await deleteAccountProfileType(api, baseUrl, session.token, profileTypeKey);
    profileTypeKey = null;
    logStep('account-422', 'selected profile type deleted via API');

    const createRequestPromise = page.waitForResponse((candidate) => {
      return (
        candidate.request().method() === 'POST' &&
        candidate.url().includes('/admin/api/v1/account_onboardings')
      );
    });

    logStep('account-422', 'submit stale onboarding');
    await Promise.all([
      createRequestPromise,
      page.getByRole('button', { name: 'Salvar conta' }).last().click(),
    ]);

    const createRequest = await createRequestPromise;
    logStep('account-422', `backend responded ${createRequest.status()}`);
    expect(
      createRequest.status(),
      'Stale selected profile type must fail with backend 422 instead of succeeding silently.',
    ).toBe(422);
    const payload = await createRequest.json();
    const profileTypeErrors = normalizeList(
      payload?.errors?.profile_type || payload?.fieldErrors?.profile_type,
    );
    expect(profileTypeErrors.length).toBeGreaterThan(0);
    await expect(page.getByText(profileTypeErrors[0])).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    logStep('account-422', 'inline validation rendered');
    await expect(page.getByRole('button', { name: 'Salvar conta' }).last()).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    logStep('account-422', 'submit button remains visible after 422');

    logStep(
      'account-422',
      `browser collectors runtime=${collectors.runtimeErrors.length} failedRequests=${collectors.failedRequests.length} consoleErrors=${collectors.consoleErrors.length}`,
    );
    if (
      collectors.runtimeErrors.length > 0 ||
      collectors.failedRequests.length > 0 ||
      collectors.consoleErrors.length > 0
    ) {
      logStep(
        'account-422',
        `browser collectors detail ${JSON.stringify({
          runtimeErrors: collectors.runtimeErrors,
          failedRequests: collectors.failedRequests,
          consoleErrors: collectors.consoleErrors,
        })}`,
      );
    }
    await assertNoBrowserFailures(collectors, {
      allowedConsoleErrorSubstrings: [
        'Failed to load resource: the server responded with a status of 422',
      ],
      allowedResponseStatuses: [422],
    });
    logStep('account-422', 'browser assertions completed');
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await runCleanupPreservingPrimaryError(primaryError, async () => {
      try {
        if (profileTypeKey && session?.token) {
          logStep('account-422', 'cleanup stale profile type');
          await deleteAccountProfileType(api, baseUrl, session.token, profileTypeKey);
        }
      } finally {
        if (browserContext) {
          logStep('account-422', 'cleanup close browser context');
          await browserContext.close().catch(() => {});
        }
        if (freshBrowser) {
          logStep('account-422', 'cleanup close fresh browser');
          await freshBrowser.close().catch(() => {});
        }
        logStep('account-422', 'cleanup dispose api');
        await api.dispose();
        logStep('account-422', 'cleanup completed');
      }
    });
  }
});

test('@mutation tenant-admin event CRUD creates, reopens edit readback, and removes from manager', async () => {
  test.setTimeout(600000);
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  let browserContext;
  let freshBrowser;
  let session = null;
  let eventTypeId = null;
  let eventId = null;
  let primaryError = null;

  try {
    logStep('event-crud', 'test start');
    session = await loginTenantAdmin(api, baseUrl);
    logStep('event-crud', 'tenant admin login completed');
    const unique = Date.now();
    const eventTypeName = `PW CRUD Event Type ${unique}`;
    const eventTypeSlug = `pw-crud-event-type-${unique}`;
    const createdEventType = normalizePayload(
      await createEventType(api, baseUrl, session.token, {
        name: eventTypeName,
        slug: eventTypeSlug,
        allowedTaxonomies: [],
      }),
    );
    eventTypeId = createdEventType?.id?.toString() || null;
    expect(eventTypeId, 'CRUD event type must be created.').toBeTruthy();
    logStep('event-crud', `event type seeded ${eventTypeId}`);

    const initialTitle = `PW CRUD Event ${unique}`;
    const updatedTitle = `PW CRUD Event Updated ${unique}`;

    const pageBundle = await createFreshAuthenticatedTenantAdminPage(session);
    logStep('event-crud', 'fresh authenticated page created');
    freshBrowser = pageBundle.browser;
    browserContext = pageBundle.context;
    const page = pageBundle.page;
    const collectors = installFailureCollectors(page);

    const listResponse = await page.goto(buildApiUrl(baseUrl, '/admin/events'), {
      waitUntil: 'domcontentloaded',
    });
    expect(listResponse, 'Tenant-admin events route must respond.').not.toBeNull();
    expect(listResponse.status()).toBeLessThan(400);
    logStep('event-crud', `events list responded ${listResponse.status()}`);
    await assertAppBootedWithSingleReload(page, {
      flow: 'event-crud',
      logStep,
      responseLabel: 'Tenant-admin events route',
    });
    logStep('event-crud', 'events app boot completed');
    await enableAccessibilityIfNeeded(page);
    logStep('event-crud', 'events accessibility enabled');

    const newEventButton = page.getByRole('button', { name: 'Novo evento' }).first();
    await scrollUntilVisible(
      page,
      newEventButton,
      'Expected tenant-admin events list to expose the Novo evento action.',
    );
    logStep('event-crud', 'new event button visible');
    const createRoutePromise = page.waitForURL(
      (candidate) => candidate.pathname.endsWith('/admin/events/create'),
      {
        timeout: appBootTimeoutMs,
        waitUntil: 'commit',
      },
    );
    await newEventButton.click();
    logStep('event-crud', 'new event button clicked');
    await createRoutePromise;
    logStep('event-crud', `create route opened ${page.url()}`);
    await expect(page.getByRole('button', { name: 'Criar evento' }).last()).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    logStep('event-crud', 'create form opened');

    await fillFlutterTextField(page, 'Título', initialTitle);
    logStep('event-crud', 'title filled');
    await scrollUntilVisible(
      page,
      page.getByText('Tipo de evento').first(),
      'Expected the event type section to become reachable in the create form.',
    );
    logStep('event-crud', 'event type section visible');
    await selectDropdownOption(page, {
      flow: 'event-crud',
      fieldLabel: 'Tipo',
      optionText: eventTypeName,
      logStep,
    });
    await page.waitForTimeout(250);
    logStep('event-crud', 'event type selected');
    const selectedStart = await pickReadOnlyTenantAdminEventDateTime(page, {
      daysFromNow: 1,
    });
    logStep('event-crud', 'event start picked');
    await scrollUntilVisible(
      page,
      page.getByText('Localização').first(),
      'Expected the location section to become reachable in the create form.',
    );
    logStep('event-crud', 'location section visible');
    await selectDropdownOption(page, {
      flow: 'event-crud',
      fieldLabel: 'Modo',
      optionText: 'Online',
      logStep,
    });
    logStep('event-crud', 'online mode selected');
    await fillFlutterTextField(page, 'URL online', 'https://example.com/live');
    logStep('event-crud', 'online URL filled');

    const createRequestPromise = page.waitForResponse((candidate) => {
      return (
        candidate.request().method() === 'POST' &&
        candidate.url().includes('/admin/api/v1/events')
      );
    });
    const redirectToEditRoutePromise = page.waitForURL(
      (candidate) => /\/admin\/events\/[^/]+\/edit$/.test(candidate.pathname),
      {
        timeout: 30000,
        waitUntil: 'commit',
      },
    );

    await Promise.all([
      createRequestPromise,
      redirectToEditRoutePromise,
      page.getByRole('button', { name: 'Criar evento' }).last().click(),
    ]);

    const createRequest = await createRequestPromise;
    logStep('event-crud', `create backend responded ${createRequest.status()}`);
    expect(createRequest.status(), 'Tenant-admin event create must succeed.').toBe(201);
    const createdEvent = normalizePayload(await createRequest.json());
    eventId = createdEvent?.event_id?.toString() || null;
    const createRequestPayload = createRequest.request().postDataJSON();
    expect(
      firstOccurrenceIsoDate(createRequestPayload),
      'Tenant-admin event create must submit the selected occurrence date.',
    ).toBe(selectedStart.isoDate);
    expect(
      createdEvent?.publication?.status?.toString().trim() || '',
      'Tenant-admin event bootstrap create must persist draft publication status.',
    ).toBe('draft');
    expect(eventId, 'Created event must expose event_id.').toBeTruthy();
    await expect(page).toHaveURL(
      new RegExp(`/admin/events/${escapeRegExp(eventId)}/edit$`),
      {
        timeout: appBootTimeoutMs,
      },
    );
    logStep('event-crud', `redirected to edit route ${page.url()}`);
    await expect
      .poll(
        async () => {
          const event = await fetchAdminEvent(api, baseUrl, session.token, eventId);
          return event?.publication?.status?.toString().trim() || '';
        },
        {
          timeout: appBootTimeoutMs,
          message:
            'Expected tenant-admin event bootstrap create to read back as draft on the canonical admin endpoint.',
        },
      )
      .toBe('draft');

    const initialEditTitleField = page
      .locator('input[data-semantics-role="text-field"]')
      .first();
    await scrollUntilVisible(
      page,
      initialEditTitleField,
      'Expected event title field to render after bootstrap create redirects to edit.',
    );
    await expectFlutterFieldRenderedValue(
      initialEditTitleField,
      initialTitle,
      'Expected bootstrap create redirect to preserve the persisted title on the edit route.',
    );

    const returnToEventsListDataPromise = waitForTenantAdminEventsListResponse(page);
    const returnToEventsListResponse = await page.goto(buildApiUrl(baseUrl, '/admin/events'), {
      waitUntil: 'domcontentloaded',
    });
    expect(
      returnToEventsListResponse,
      'Tenant-admin events list must remain reachable after create redirect.',
    ).not.toBeNull();
    expect(returnToEventsListResponse.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);
    logStep('event-crud', `returned to events list ${page.url()}`);
    await expect(page.getByRole('button', { name: 'Novo evento' }).last()).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    logStep('event-crud', 'waiting for published events list response after create return');
    await returnToEventsListDataPromise;
    logStep('event-crud', 'published events list response settled after create return');
    logStep('event-crud', 'waiting for visible progress indicators to clear after create return');
    await waitForNoVisibleProgressIndicators(
      page,
      'Expected the tenant-admin events list to finish rendering before asserting the default Publicados visibility state.',
    );
    logStep('event-crud', 'visible progress indicators cleared after create return');
    logStep('event-crud', 'verifying Publicados remains selected after create return');
    await ensureAdminEventPublicationFilterSelected(page, 'published');
    logStep('event-crud', 'Publicados confirmed after create return');
    logStep('event-crud', 'verifying created draft stays absent under Publicados');
    await expectAdminEventAbsentFromList(
      page,
      initialTitle,
      'Expected a draft event to stay hidden while the tenant-admin list remains on the default Publicados filter.',
    );
    logStep('event-crud', 'created draft confirmed absent under Publicados');
    logStep('event-crud', 'switching tenant-admin events list to Rascunhos after create return');
    await ensureAdminEventPublicationFilterSelected(page, 'draft');
    logStep('event-crud', 'Rascunhos selected after create return');

    await openEventFromAdminList(page, initialTitle, eventId);

    const titleField = page
      .locator('input[data-semantics-role="text-field"]')
      .first();
    await scrollUntilVisible(
      page,
      titleField,
      'Expected event title field to render after reopening the saved event.',
    );
    logStep('event-crud', 'saved event reopened from manager list');
    await expectFlutterFieldRenderedValue(
      titleField,
      initialTitle,
      'Expected saved event reopen to render the persisted title before editing.',
    );

    const updateRequestPromise = page.waitForResponse((candidate) => {
      return (
        candidate.request().method() === 'PATCH' &&
        candidate.url().includes(`/admin/api/v1/events/${eventId}`) &&
        candidate.status() < 400
      );
    });
    await fillResolvedFlutterTextField(
      page,
      titleField,
      updatedTitle,
      'reopened event title field',
    );
    await clickSaveChanges(page);
    await updateRequestPromise;
    logStep('event-crud', 'event title updated');

    await expect(page.getByRole('button', { name: 'Salvar alterações' }).last()).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    logStep('event-crud', `post-update edit route preserved ${page.url()}`);
    await expect
      .poll(
        async () => {
          const event = await fetchAdminEvent(api, baseUrl, session.token, eventId);
          return [
            event?.title?.toString() || '',
            firstOccurrenceIsoDate(event),
          ].join('|');
        },
        {
          timeout: appBootTimeoutMs,
          message:
            'Expected tenant-admin event edit save to persist the updated title and selected occurrence date.',
        },
      )
      .toBe(`${updatedTitle}|${selectedStart.isoDate}`);
    logStep('event-crud', 'updated title persisted through admin readback');

    const postUpdateEventsListDataPromise = waitForTenantAdminEventsListResponse(page);
    const postUpdateEventsListResponse = await page.goto(
      buildApiUrl(baseUrl, '/admin/events'),
      {
        waitUntil: 'domcontentloaded',
      },
    );
    expect(
      postUpdateEventsListResponse,
      'Tenant-admin events list must remain reachable after saving an existing event.',
    ).not.toBeNull();
    expect(postUpdateEventsListResponse.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);
    logStep('event-crud', `returned to events list after edit save ${page.url()}`);
    await expect(page.getByRole('button', { name: 'Novo evento' }).last()).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    logStep('event-crud', 'waiting for published events list response after edit save return');
    await postUpdateEventsListDataPromise;
    logStep('event-crud', 'published events list response settled after edit save return');
    logStep('event-crud', 'waiting for visible progress indicators to clear after edit save return');
    await waitForNoVisibleProgressIndicators(
      page,
      'Expected the tenant-admin events list to finish rendering after edit save before asserting the default Publicados visibility state.',
    );
    logStep('event-crud', 'visible progress indicators cleared after edit save return');
    logStep('event-crud', 'verifying Publicados remains selected after edit save return');
    await ensureAdminEventPublicationFilterSelected(page, 'published');
    logStep('event-crud', 'Publicados confirmed after edit save return');
    logStep('event-crud', 'verifying updated draft stays absent under Publicados');
    await expectAdminEventAbsentFromList(
      page,
      updatedTitle,
      'Expected the draft event to remain hidden on the default Publicados filter after saving edits.',
    );
    logStep('event-crud', 'updated draft confirmed absent under Publicados');
    logStep('event-crud', 'switching tenant-admin events list to Rascunhos after edit save return');
    await ensureAdminEventPublicationFilterSelected(page, 'draft');
    logStep('event-crud', 'Rascunhos selected after edit save return');

    await openEventMenuFromAdminList(page, updatedTitle);
    logStep('event-crud', 'event menu opened');
    await page.getByRole('menuitem', { name: 'Remover' }).last().click();
    await expect(page.getByText('Remover evento')).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    logStep('event-crud', 'delete confirmation opened');

    const deleteRequestPromise = page.waitForResponse((candidate) => {
      return (
        candidate.request().method() === 'DELETE' &&
        candidate.url().includes(`/admin/api/v1/events/${eventId}`)
      );
    });
    await page.getByRole('button', { name: 'Remover' }).last().click();
    const deleteRequest = await deleteRequestPromise;
    logStep('event-crud', `delete backend responded ${deleteRequest.status()}`);
    expect(
      [200, 204],
      'Tenant-admin event delete flow must succeed from the manager list.',
    ).toContain(deleteRequest.status());

    await waitForEventDeletion(api, baseUrl, session.token, eventId);
    eventId = null;

    await assertNoBrowserFailures(collectors);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await runCleanupPreservingPrimaryError(primaryError, async () => {
      try {
        await runCleanupSteps([
          eventId ? () => deleteEvent(api, baseUrl, session?.token, eventId) : null,
          eventTypeId
            ? () => deleteEventType(api, baseUrl, session?.token, eventTypeId)
            : null,
        ]);
      } finally {
        if (browserContext) {
          await browserContext.close().catch(() => {});
        }
        if (freshBrowser) {
          await freshBrowser.close().catch(() => {});
        }
        await api.dispose();
      }
    });
  }
});

test('@mutation tenant-admin event create rejects stale selected event type with inline 422', async () => {
  test.setTimeout(600000);
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  let browserContext;
  let freshBrowser;
  let session = null;
  let eventTypeId = null;
  let primaryError = null;

  try {
    logStep('event-422', 'test start');
    session = await loginTenantAdmin(api, baseUrl);
    logStep('event-422', 'tenant admin login completed');
    const unique = Date.now();
    const eventTypeName = `PW Stale Event Type ${unique}`;
    const eventTypeSlug = `pw-stale-event-type-${unique}`;
    const createdEventType = normalizePayload(
      await createEventType(api, baseUrl, session.token, {
        name: eventTypeName,
        slug: eventTypeSlug,
        allowedTaxonomies: [],
      }),
    );
    eventTypeId = createdEventType?.id?.toString() || null;
    expect(eventTypeId, 'Stale selected event type must be created.').toBeTruthy();
    logStep('event-422', `event type seeded ${eventTypeId}`);

    const pageBundle = await createFreshAuthenticatedTenantAdminPage(session);
    logStep('event-422', 'fresh authenticated page created');
    freshBrowser = pageBundle.browser;
    browserContext = pageBundle.context;
    const page = pageBundle.page;
    const collectors = installFailureCollectors(page);

    const response = await page.goto(buildApiUrl(baseUrl, '/admin/events'), {
      waitUntil: 'domcontentloaded',
    });
    expect(response, 'Tenant-admin events route must respond.').not.toBeNull();
    expect(response.status()).toBeLessThan(400);
    logStep('event-422', `events list responded ${response.status()}`);
    await assertAppBootedWithSingleReload(page, {
      flow: 'event-422',
      logStep,
      responseLabel: 'Tenant-admin events route',
    });
    logStep('event-422', 'events app boot completed');
    await enableAccessibilityIfNeeded(page);
    logStep('event-422', 'events accessibility enabled');

    const newEventButton = page.getByRole('button', { name: 'Novo evento' }).first();
    await scrollUntilVisible(
      page,
      newEventButton,
      'Expected tenant-admin events list to expose the Novo evento action.',
    );
    logStep('event-422', 'new event button visible');
    const createRoutePromise = page.waitForURL(
      (candidate) => candidate.pathname.endsWith('/admin/events/create'),
      {
        timeout: appBootTimeoutMs,
        waitUntil: 'commit',
      },
    );
    await newEventButton.click();
    logStep('event-422', 'new event button clicked');
    await createRoutePromise;
    logStep('event-422', `create route opened ${page.url()}`);
    await expect(page.getByRole('button', { name: 'Criar evento' }).last()).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    logStep('event-422', 'create form opened');
    const eventTypesLoaded = page.waitForResponse((candidate) => {
      if (!candidate.url().includes('/admin/api/v1/event_types')) {
        return false;
      }
      return candidate.status() === 200;
    });

    await fillFlutterTextField(page, 'Título', `PW Invalid Event ${unique}`);
    logStep('event-422', 'title filled');
    await scrollUntilVisible(
      page,
      page.getByText('Tipo de evento').first(),
      'Expected the event type section to become reachable in the create form.',
    );
    logStep('event-422', 'event type section visible');
    const eventTypesPayload = await (await eventTypesLoaded).json();
    const loadedEventTypes = Array.isArray(eventTypesPayload?.data)
      ? eventTypesPayload.data
      : [];
    expect(
      loadedEventTypes.some((entry) => entry?.slug === eventTypeSlug),
      `Expected stale event type ${eventTypeSlug} in event create type payload.`,
    ).toBe(true);
    await selectDropdownOption(page, {
      flow: 'event-422',
      fieldLabel: 'Tipo',
      optionText: eventTypeName,
      logStep,
    });
    await page.waitForTimeout(250);
    logStep('event-422', 'event type selected');
    const selectedStart = await pickReadOnlyTenantAdminEventDateTime(page, {
      daysFromNow: 1,
    });
    logStep('event-422', 'event start picked');
    await scrollUntilVisible(
      page,
      page.getByText('Localização').first(),
      'Expected the location section to become reachable in the create form.',
    );
    logStep('event-422', 'location section visible');
    await selectDropdownOption(page, {
      flow: 'event-422',
      fieldLabel: 'Modo',
      optionText: 'Online',
      logStep,
    });
    logStep('event-422', 'online mode selected');
    await fillFlutterTextField(page, 'URL online', 'https://example.com/live');
    logStep('event-422', 'online URL filled');

    await deleteEventType(api, baseUrl, session.token, eventTypeId);
    eventTypeId = null;
    logStep('event-422', 'selected event type deleted via API');

    const createRequestPromise = page.waitForResponse((candidate) => {
      return (
        candidate.request().method() === 'POST' &&
        candidate.url().includes('/admin/api/v1/events')
      );
    });

    await Promise.all([
      createRequestPromise,
      page.getByRole('button', { name: 'Criar evento' }).last().click(),
    ]);

    const createRequest = await createRequestPromise;
    logStep('event-422', `backend responded ${createRequest.status()}`);
    const createRequestPayload = createRequest.request().postDataJSON();
    expect(
      firstOccurrenceIsoDate(createRequestPayload),
      'Stale selected event type proof must still submit the chosen occurrence date.',
    ).toBe(selectedStart.isoDate);
    expect(
      createRequest.status(),
      'Stale selected event type must fail with backend 422 instead of succeeding silently.',
    ).toBe(422);
    const payload = await createRequest.json();
    const eventTypeErrors = normalizeList(
      payload?.errors?.['type.id'] || payload?.fieldErrors?.['type.id'],
    );
    expect(eventTypeErrors.length).toBeGreaterThan(0);
    await scrollTenantAdminSheetToTop(page);
    await scrollUntilVisible(
      page,
      page.getByText('Tipo de evento').first(),
      'Expected the event type section to remain reachable after the stale-type 422 response.',
    );
    await expect(page.getByText(eventTypeErrors[0])).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    logStep('event-422', 'inline validation rendered');

    const createEventButton = page.getByRole('button', { name: 'Criar evento' }).last();
    await scrollUntilVisible(
      page,
      createEventButton,
      'Expected the create-event submit action to remain reachable after the stale-type 422 response.',
    );
    await expect(createEventButton).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    logStep('event-422', 'submit button remains visible after 422');

    await assertNoBrowserFailures(collectors, {
      allowedConsoleErrorSubstrings: [
        'Failed to load resource: the server responded with a status of 422',
      ],
      allowedResponseStatuses: [422],
    });
    logStep('event-422', 'browser assertions completed');
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await runCleanupPreservingPrimaryError(primaryError, async () => {
      try {
        if (eventTypeId && session?.token) {
          logStep('event-422', 'cleanup stale event type');
          await deleteEventType(api, baseUrl, session.token, eventTypeId);
        }
      } finally {
        if (browserContext) {
          logStep('event-422', 'cleanup close browser context');
          await browserContext.close().catch(() => {});
        }
        if (freshBrowser) {
          logStep('event-422', 'cleanup close fresh browser');
          await freshBrowser.close().catch(() => {});
        }
        logStep('event-422', 'cleanup dispose api');
        await api.dispose();
        logStep('event-422', 'cleanup completed');
      }
    });
  }
});

test('@mutation tenant-admin event type create flow works through the real browser', async ({
  browser,
}) => {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  let browserContext;
  let createdEventTypeId = null;
  let session = null;

  try {
    session = await loginTenantAdmin(api, baseUrl);
    const primaryPageBundle = await createAuthenticatedTenantAdminPage(
      browser,
      session,
    );
    browserContext = primaryPageBundle.context;
    const page = primaryPageBundle.page;
    const collectors = installFailureCollectors(page);
    const uniqueSlug = `playwrighttype${Date.now()}`;
    const uniqueName = `Playwright ${uniqueSlug}`;

    logStep('event-type', 'open event types list');
    const response = await page.goto(
      buildApiUrl(baseUrl, '/admin/events/types'),
      {
        waitUntil: 'domcontentloaded',
      },
    );
    expect(response, 'Event types route response should be available.').not.toBeNull();
    expect(response.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);

    await expect(page.getByText('Tipos de evento')).toBeVisible({
      timeout: appBootTimeoutMs,
    });

    logStep('event-type', 'open create form');
    await page.getByRole('button', { name: 'Criar tipo' }).first().click();
    await expect(page.getByText('Criar tipo de evento')).toBeVisible({
      timeout: appBootTimeoutMs,
    });

    logStep('event-type', `fill form ${uniqueSlug}`);
    const nameField = await fillFlutterTextField(page, 'Nome', uniqueName);
    const slugField = await fillFlutterTextField(page, 'Slug', uniqueSlug);
    await expect(nameField).toHaveValue(uniqueName, {
      timeout: appBootTimeoutMs,
    });
    await expect(slugField).toHaveValue(uniqueSlug, {
      timeout: appBootTimeoutMs,
    });

    const createResponsePromise = page.waitForResponse((candidate) => {
      return (
        candidate.request().method() === 'POST' &&
        candidate.url().includes('/admin/api/v1/event_types')
      );
    });

    logStep('event-type', 'submit create');
    await Promise.all([
      createResponsePromise,
      page.getByRole('button', { name: 'Criar tipo' }).last().click(),
    ]);

    const createResponse = await createResponsePromise;
    expect(
      createResponse.status(),
      'Event type create request must succeed.',
    ).toBe(201);
    const createPayload = await createResponse.json();
    createdEventTypeId = createPayload?.data?.id?.toString() || null;
    logStep('event-type', `created ${createdEventTypeId}`);

    expect(createdEventTypeId, 'Event type create must return an id.').toBeTruthy();

    const verificationResponse = await api.get(
      buildApiUrl(baseUrl, '/admin/api/v1/event_types'),
      {
        headers: authHeaders(session.token),
      },
    );
    expect(
      verificationResponse.status(),
      'Created event type must be queryable after browser submit.',
    ).toBe(200);
    const verificationPayload = await verificationResponse.json();
    const createdRows = Array.isArray(verificationPayload?.data)
        ? verificationPayload.data
        : [];
    expect(
      createdRows.some((row) => row?.id?.toString() === createdEventTypeId),
      'Created event type id must be present in the tenant-admin registry.',
    ).toBeTruthy();

    await assertNoBrowserFailures(collectors);
  } finally {
    if (createdEventTypeId && session?.token) {
      await deleteEventType(api, baseUrl, session.token, createdEventTypeId);
    }
    if (browserContext) {
      await browserContext.close();
    }
    await api.dispose();
  }
});

test('@mutation tenant-admin event type type asset upload persists and renders after edit reopen', async ({
  browser,
}) => {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  let browserContext;
  let verificationContext;
  let createdEventTypeId = null;
  let session = null;

  try {
    session = await loginTenantAdmin(api, baseUrl);
    const uniqueSlug = `playwright-type-asset-${Date.now()}`;
    const uniqueName = `Playwright ${uniqueSlug}`;
    const seededPayload = await createEventTypeWithTypeAsset(
      api,
      baseUrl,
      session.token,
      {
        name: uniqueName,
        slug: uniqueSlug,
      },
    );
    createdEventTypeId = seededPayload?.data?.id?.toString() || null;
    expect(createdEventTypeId, 'Seeded event type must return an id.').toBeTruthy();

    const verificationResponse = await api.get(
      buildApiUrl(baseUrl, '/admin/api/v1/event_types'),
      {
        headers: authHeaders(session.token),
      },
    );
    expect(
      verificationResponse.status(),
      'Seeded event type must be queryable after API creation.',
    ).toBe(200);
    const verificationPayload = await verificationResponse.json();
    const createdRows = Array.isArray(verificationPayload?.data)
      ? verificationPayload.data
      : [];
    const createdRow = createdRows.find(
      (row) => row?.id?.toString() === createdEventTypeId,
    );
    expect(
      createdRow,
      'Seeded event type must be present in the tenant-admin registry.',
    ).toBeTruthy();
    const typeAssetUrl = createdRow?.visual?.image_url?.toString() || '';
    expect(
      typeAssetUrl,
      'Seeded event type must expose the canonical type asset URL.',
    ).toBeTruthy();

    const typeAssetResponse = await api.get(typeAssetUrl, {
      failOnStatusCode: false,
    });
    expect(
      typeAssetResponse.status(),
      'Persisted type asset URL must be readable.',
    ).toBeLessThan(400);
    await disposeApiResponse(typeAssetResponse);

    const primaryPageBundle = await createAuthenticatedTenantAdminPage(
      browser,
      session,
    );
    browserContext = primaryPageBundle.context;
    const page = primaryPageBundle.page;
    const collectors = installFailureCollectors(page);
    const typeAssetStatuses = [];

    page.on('response', (candidate) => {
      if (urlsMatchIgnoringQuery(candidate.url(), typeAssetUrl)) {
        typeAssetStatuses.push(candidate.status());
      }
    });

    const eventTypesUrl = buildApiUrl(baseUrl, '/admin/events/types');
    logStep('event-type-asset', `open event types list ${eventTypesUrl}`);
    const response = await page.goto(eventTypesUrl, {
      waitUntil: 'domcontentloaded',
    });
    expect(response, 'Event types route response should be available.').not.toBeNull();
    expect(response.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);

    await expect(page.getByText('Tipos de evento')).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    const seededTypeButton = page
      .getByRole('button', {
        name: new RegExp(uniqueName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      })
      .first();
    await scrollUntilVisible(
      page,
      seededTypeButton,
      'Expected the seeded event type to appear in the admin event-type list before reopening edit.',
    );
    logStep('event-type-asset', 'open seeded row from list');
    await seededTypeButton.click();
    await expect(page.getByText('Editar tipo de evento')).toBeVisible({
      timeout: appBootTimeoutMs,
    });

    await expect
      .poll(
        async () => {
          if (typeAssetStatuses.some((status) => status === 200)) {
            return true;
          }
          const renderedSources = await page.locator('img').evaluateAll((nodes) =>
            nodes
              .map((node) => node.getAttribute('src') || '')
              .filter((entry) => entry.length > 0),
          );
          return renderedSources.some((entry) =>
            urlsMatchIgnoringQuery(
              entry.startsWith('http') ? entry : resolveAbsoluteUrl(baseUrl, entry),
              typeAssetUrl,
            ),
          );
        },
        {
          timeout: appBootTimeoutMs,
          message:
            'Expected the persisted event-type type asset to be observable after reopening edit, either via network fetch or rendered preview.',
        },
      )
      .toBeTruthy();
    logStep('event-type-asset', 'persisted type asset returned 200 after edit reopen');

    await assertNoBrowserFailures(collectors);
  } finally {
    if (createdEventTypeId && session?.token) {
      await deleteEventType(api, baseUrl, session.token, createdEventTypeId);
    }
    if (browserContext) {
      await browserContext.close().catch(() => {});
    }
    await api.dispose();
  }
});

test('@mutation tenant-admin branding public default image and favicon persist after save and reload', async ({
  browser,
}) => {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  let browserContext;
  let verificationContext;
  let session = null;

  try {
    session = await loginTenantAdmin(api, baseUrl);
    const primaryPageBundle = await createAuthenticatedTenantAdminPage(
      browser,
      session,
    );
    browserContext = primaryPageBundle.context;
    const page = primaryPageBundle.page;
    const collectors = installFailureCollectors(page);
    const visualIdentityUrl = buildApiUrl(baseUrl, '/admin/settings/visual-identity');

    logStep('branding', `open visual identity route ${visualIdentityUrl}`);
    const response = await page.goto(visualIdentityUrl, {
      waitUntil: 'domcontentloaded',
    });
    expect(response, 'Visual identity route response should be available.').not.toBeNull();
    expect(response.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);

    await attachImageFromDevice(page, {
      flow: 'branding',
      buttonName: 'Selecionar imagem de compartilhamento',
      cropTitle: 'Recortar imagem de compartilhamento',
    });

    logStep('branding', 'confirm public default image crop');
    await page.getByRole('button', { name: 'Usar' }).click();
    logStep('branding', 'scroll to favicon field');
    await page.mouse.wheel(0, 1600);
    await page.waitForTimeout(400);

    await attachImageFromDevice(page, {
      flow: 'branding',
      buttonName: /favicon/i,
      cropTitle: null,
      fixturePath: fixtureFaviconPath,
    });

    const saveResponsePromise = page.waitForResponse((candidate) => {
      return (
        candidate.request().method() === 'POST' &&
        candidate.url().includes('/admin/api/v1/branding/update') &&
        candidate.status() < 400
      );
    });

    logStep('branding', 'save branding payload');
    await Promise.all([
      saveResponsePromise,
      page.getByRole('button', { name: 'Salvar Branding' }).first().click(),
    ]);

    const saveResponse = await saveResponsePromise;
    expect(saveResponse.status(), 'Branding save request must succeed.').toBeLessThan(400);

    const environment = await fetchPublicEnvironment(api, baseUrl);
    const publicWebDefaultImageRaw =
      environment?.public_web_metadata?.default_image?.toString() || '';
    expect(
      publicWebDefaultImageRaw,
      'Saved branding must publish a default public image in the environment payload.',
    ).toBeTruthy();
    const publicWebDefaultImageUrl = resolveAbsoluteUrl(
      baseUrl,
      publicWebDefaultImageRaw,
    );
    const faviconUrl = buildApiUrl(baseUrl, '/favicon.ico');

    const publicWebDefaultImageResponse = await api.get(publicWebDefaultImageUrl, {
      failOnStatusCode: false,
    });
    expect(
      publicWebDefaultImageResponse.status(),
      'Published default public image must be readable.',
    ).toBeLessThan(400);
    await disposeApiResponse(publicWebDefaultImageResponse);

    const faviconResponse = await api.get(faviconUrl, {
      failOnStatusCode: false,
    });
    expect(faviconResponse.status(), 'Published favicon route must be readable.').toBeLessThan(400);
    await disposeApiResponse(faviconResponse);

    const verificationBundle = await createAuthenticatedTenantAdminPage(
      browser,
      session,
    );
    verificationContext = verificationBundle.context;
    const verificationPage = verificationBundle.page;
    const verificationCollectors = installFailureCollectors(verificationPage);
    const defaultImageStatuses = [];
    const faviconStatuses = [];

    verificationPage.on('response', (candidate) => {
      if (urlsMatchIgnoringQuery(candidate.url(), publicWebDefaultImageUrl)) {
        defaultImageStatuses.push(candidate.status());
      }
      if (urlsMatchIgnoringQuery(candidate.url(), faviconUrl)) {
        faviconStatuses.push(candidate.status());
      }
    });

    logStep('branding', 'reload visual identity route to validate rendered persisted assets');
    const verificationResponse = await verificationPage.goto(visualIdentityUrl, {
      waitUntil: 'domcontentloaded',
    });
    expect(
      verificationResponse,
      'Visual identity verification response should be available.',
    ).not.toBeNull();
    expect(verificationResponse.status()).toBeLessThan(400);
    await assertAppBooted(verificationPage);
    await enableAccessibilityIfNeeded(verificationPage);

    await expectImagePreviewRenderedOrRequested({
      page: verificationPage,
      expectedUrl: publicWebDefaultImageUrl,
      successfulStatuses: defaultImageStatuses,
      message:
        'Expected the persisted public default image preview to render after reload.',
    });
    await expectImagePreviewRenderedOrRequested({
      page: verificationPage,
      expectedUrl: faviconUrl,
      successfulStatuses: faviconStatuses,
      message: 'Expected the persisted favicon preview to render after reload.',
    });
    logStep('branding', 'persisted default image and favicon returned 200 after reload');

    await assertNoBrowserFailures(collectors);
    await assertNoBrowserFailures(verificationCollectors);
  } finally {
    if (verificationContext) {
      await verificationContext.close().catch(() => {});
    }
    if (browserContext) {
      await browserContext.close().catch(() => {});
    }
    await api.dispose();
  }
});

test.skip('@deferred @mutation tenant-admin profile-type editors preload and preserve allowed taxonomies when saving unrelated visual changes', async ({
  browser,
}) => {
  test.setTimeout(600000);
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  let page = null;
  let collectors = null;
  let browserContext;
  let freshBrowser;
  let session = null;
  let eventTaxonomyAId = null;
  let eventTaxonomyBId = null;
  let profileTaxonomyAId = null;
  let profileTaxonomyBId = null;
  let staticTaxonomyId = null;
  let createdEventTypeId = null;
  let createdProfileType = null;
  let createdStaticType = null;

  try {
    async function rotateFreshTenantAdminPage() {
      if (collectors) {
        await assertNoBrowserFailures(collectors);
        collectors = null;
      }
      if (browserContext) {
        await browserContext.close().catch(() => {});
        browserContext = null;
      }
      if (freshBrowser) {
        await freshBrowser.close().catch(() => {});
        freshBrowser = null;
      }

      const pageBundle = await createFreshAuthenticatedTenantAdminPage(session);
      freshBrowser = pageBundle.browser;
      browserContext = pageBundle.context;
      page = pageBundle.page;
      collectors = installFailureCollectors(page);
      return page;
    }

    session = await loginTenantAdmin(api, baseUrl);
    const unique = Date.now();
    const uniqueSuffix = String(unique).slice(-4);
    const eventTaxonomyA = await createTaxonomy(api, baseUrl, session.token, {
      slug: `hd13-event-a-${unique}`,
      name: `AA EvtA ${uniqueSuffix}`,
      appliesTo: ['event'],
      terms: [{ slug: `term-event-a-${unique}`, name: `Termo A ${uniqueSuffix}` }],
    });
    eventTaxonomyAId = eventTaxonomyA.taxonomyId;
    const eventTaxonomyB = await createTaxonomy(api, baseUrl, session.token, {
      slug: `hd13-event-b-${unique}`,
      name: `AB EvtB ${uniqueSuffix}`,
      appliesTo: ['event'],
      terms: [{ slug: `term-event-b-${unique}`, name: `Termo B ${uniqueSuffix}` }],
    });
    eventTaxonomyBId = eventTaxonomyB.taxonomyId;
    const profileTaxonomyA = await createTaxonomy(api, baseUrl, session.token, {
      slug: `hd13-profile-a-${unique}`,
      name: `AA Perfil A ${uniqueSuffix}`,
      appliesTo: ['account_profile'],
      terms: [{ slug: `term-a-${unique}`, name: `Termo A ${unique}` }],
    });
    profileTaxonomyAId = profileTaxonomyA.taxonomyId;
    const profileTaxonomyB = await createTaxonomy(api, baseUrl, session.token, {
      slug: `hd13-profile-b-${unique}`,
      name: `AB Perfil B ${uniqueSuffix}`,
      appliesTo: ['account_profile'],
      terms: [{ slug: `term-b-${unique}`, name: `Termo B ${unique}` }],
    });
    profileTaxonomyBId = profileTaxonomyB.taxonomyId;
    const staticTaxonomy = await createTaxonomy(api, baseUrl, session.token, {
      slug: `hd13-static-${unique}`,
      name: `AA Ativo ${uniqueSuffix}`,
      appliesTo: ['static_asset'],
      terms: [{ slug: `term-static-${unique}`, name: `Termo Ativo ${unique}` }],
    });
    staticTaxonomyId = staticTaxonomy.taxonomyId;
    await waitForTaxonomyRegistry(api, baseUrl, session.token, [
      eventTaxonomyA.slug,
      eventTaxonomyB.slug,
      profileTaxonomyA.slug,
      profileTaxonomyB.slug,
      staticTaxonomy.slug,
    ]);

    const createdEventType = await createEventType(
      api,
      baseUrl,
      session.token,
      {
        name: `HD13 Evento ${unique}`,
        slug: `hd13-event-${unique}`,
        allowedTaxonomies: [eventTaxonomyA.slug, eventTaxonomyB.slug],
        color: '#9E4B00',
      },
    );
    createdEventTypeId = createdEventType?.data?.id?.toString() || null;
    createdProfileType = await createAccountProfileType(
      api,
      baseUrl,
      session.token,
      {
        type: `hd13-profile-${unique}`,
        label: `HD13 Perfil ${unique}`,
        allowedTaxonomies: [profileTaxonomyA.slug, profileTaxonomyB.slug],
        markerColor: '#B51E5B',
      },
    );
    createdStaticType = await createStaticProfileType(
      api,
      baseUrl,
      session.token,
      {
        type: `hd13-static-${unique}`,
        label: `HD13 Ativo ${unique}`,
        allowedTaxonomies: [staticTaxonomy.slug],
        markerColor: '#1E6FB5',
      },
    );

    await rotateFreshTenantAdminPage();

    const profileTypeKey = createdProfileType?.data?.type?.toString() || '';
    const staticTypeKey = createdStaticType?.data?.type?.toString() || '';
    const eventTypeName = createdEventType?.data?.name?.toString() || '';
    expect(createdEventTypeId, 'Created event type must expose id.').toBeTruthy();
    expect(profileTypeKey, 'Created account profile type must expose type.').toBeTruthy();
    expect(staticTypeKey, 'Created static profile type must expose type.').toBeTruthy();

    const eventTypesUrl = buildApiUrl(baseUrl, '/admin/events/types');
    logStep('type-taxonomies', `open event types route ${eventTypesUrl}`);
    let response = await page.goto(eventTypesUrl, {
      waitUntil: 'domcontentloaded',
    });
    expect(response, 'Event types route response should be available.').not.toBeNull();
    expect(response.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);
    const eventTypeButton = page.getByRole('button', {
      name: new RegExp(eventTypeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    }).first();
    await scrollUntilVisible(
      page,
      eventTypeButton,
      'Expected the created event type to appear in the admin event-type list before validating allowed taxonomies.',
    );
    logStep('type-taxonomies', 'open created event type from list');
    await eventTypeButton.click();
    await expect(page.getByText('Editar tipo de evento')).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    await expect(page.getByText('Taxonomias permitidas')).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    await expectSelectedToggleChip(page, eventTaxonomyA.name);
    await expectSelectedToggleChip(page, eventTaxonomyB.name);
    logStep('type-taxonomies', 'event type preloaded allowed taxonomies confirmed');

    const eventDescriptionUpdate = `Descricao atualizada ${unique}`;
    await fillFlutterTextField(
      page,
      'Descrição (opcional)',
      eventDescriptionUpdate,
    );
    logStep('type-taxonomies', 'save event type with unrelated description change');
    const eventSaveResponsePromise = page.waitForResponse((candidate) => {
      return (
        candidate.request().method() === 'PATCH' &&
        candidate.url().includes(`/admin/api/v1/event_types/${createdEventTypeId}`)
      );
    });
    const visibleButtonTexts = await page.getByRole('button').evaluateAll((nodes) =>
      nodes
        .map((node) => (node.textContent || '').trim())
        .filter((entry) => entry.length > 0),
    );
    logStep(
      'type-taxonomies',
      `visible buttons before event save: ${visibleButtonTexts.join(' | ')}`,
    );
    logStep('type-taxonomies', 'click event type save button');
    await clickSaveChanges(page);
    logStep('type-taxonomies', 'event type save button clicked');
    const eventSaveResponse = await eventSaveResponsePromise;
    expect(eventSaveResponse.status()).toBeLessThan(400);
    const eventSavePayload = await eventSaveResponse.json();
    expect(
      (eventSavePayload?.data?.allowed_taxonomies || []).slice().sort(),
    ).toEqual([eventTaxonomyA.slug, eventTaxonomyB.slug].slice().sort());
    expect(eventSavePayload?.data?.description).toBe(eventDescriptionUpdate);
    logStep('type-taxonomies', 'event type save preserved allowed taxonomies');

    response = await page.goto(eventTypesUrl, {
      waitUntil: 'domcontentloaded',
    });
    expect(response, 'Event types reopen response should be available.').not.toBeNull();
    expect(response.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);
    const reopenedEventTypeButton = page.getByRole('button', {
      name: new RegExp(eventTypeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    }).first();
    await scrollUntilVisible(
      page,
      reopenedEventTypeButton,
      'Expected the created event type to reappear in the admin event-type list before verifying preserved allowed taxonomies.',
    );
    logStep('type-taxonomies', 'reopen event type from list');
    await reopenedEventTypeButton.click();
    await expect(page.getByText('Editar tipo de evento')).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    await scrollUntilVisible(
      page,
      page.getByText('Taxonomias permitidas').first(),
      'Expected the Taxonomias permitidas section to appear after reopening the event type.',
    );
    await expectSelectedToggleChip(page, eventTaxonomyA.name);
    await expectSelectedToggleChip(page, eventTaxonomyB.name);
    logStep('type-taxonomies', 'event type reopen preserved allowed taxonomies');

    await rotateFreshTenantAdminPage();
    const profileEditUrl = buildApiUrl(
      baseUrl,
      `/admin/profile-types/${encodeURIComponent(profileTypeKey)}/edit`,
    );
    logStep('type-taxonomies', `open account profile type route ${profileEditUrl}`);
    response = await page.goto(profileEditUrl, {
      waitUntil: 'domcontentloaded',
    });
    expect(response, 'Account profile type edit response should be available.').not.toBeNull();
    expect(response.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);
    await scrollTenantAdminSheetToTop(page);
    await expect(page.getByText('Taxonomias permitidas')).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    logStep('type-taxonomies', 'profile type edit loaded taxonomy section');

    const profileLabelUpdate = `HD13 Perfil Atualizado ${unique}`;
    await fillFlutterTextField(page, 'Label', profileLabelUpdate);
    logStep('type-taxonomies', 'save profile type with unrelated label change');
    const profileSaveResponsePromise = page.waitForResponse((candidate) => {
      return (
        candidate.request().method() === 'PATCH' &&
        candidate.url().includes(
          `/admin/api/v1/account_profile_types/${encodeURIComponent(
            profileTypeKey,
          )}`,
        )
      );
    });
    logStep('type-taxonomies', 'click profile type save button');
    await clickSaveChanges(page);
    logStep('type-taxonomies', 'profile type save button clicked');
    const profileSaveResponse = await profileSaveResponsePromise;
    expect(profileSaveResponse.status()).toBeLessThan(400);
    const profileSavePayload = await profileSaveResponse.json();
    expect(
      (profileSavePayload?.data?.allowed_taxonomies || []).slice().sort(),
    ).toEqual([profileTaxonomyA.slug, profileTaxonomyB.slug].slice().sort());
    expect(profileSavePayload?.data?.label).toBe(profileLabelUpdate);
    logStep('type-taxonomies', 'profile type save preserved allowed taxonomies');

    response = await page.goto(profileEditUrl, {
      waitUntil: 'domcontentloaded',
    });
    expect(response, 'Account profile type reopen response should be available.').not.toBeNull();
    expect(response.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);
    await scrollTenantAdminSheetToTop(page);
    await expect(page.getByText('Taxonomias permitidas')).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    const profileReadback = await fetchAccountProfileTypeListEntry(
      api,
      baseUrl,
      session.token,
      profileTypeKey,
    );
    expect(
      (profileReadback?.allowed_taxonomies || []).slice().sort(),
      'Account profile type readback must preserve allowed taxonomies after reopen.',
    ).toEqual([profileTaxonomyA.slug, profileTaxonomyB.slug].slice().sort());
    expect(profileReadback?.label).toBe(profileLabelUpdate);
    logStep('type-taxonomies', 'profile type reopen preserved allowed taxonomies');

    await rotateFreshTenantAdminPage();
    const staticEditUrl = buildApiUrl(
      baseUrl,
      `/admin/static_profile_types/${encodeURIComponent(staticTypeKey)}/edit`,
    );
    logStep('type-taxonomies', `open static profile type route ${staticEditUrl}`);
    response = await page.goto(staticEditUrl, {
      waitUntil: 'domcontentloaded',
    });
    expect(response, 'Static profile type edit response should be available.').not.toBeNull();
    expect(response.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);
    await scrollTenantAdminSheetToTop(page);
    await expect(page.getByText('Taxonomias permitidas')).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    logStep('type-taxonomies', 'static type edit loaded taxonomy section');

    const staticLabelUpdate = `HD13 Ativo Atualizado ${unique}`;
    await fillFlutterTextField(page, 'Label', staticLabelUpdate);
    logStep('type-taxonomies', 'save static type with unrelated label change');
    const staticSaveResponsePromise = page.waitForResponse((candidate) => {
      return (
        candidate.request().method() === 'PATCH' &&
        candidate.url().includes(
          `/admin/api/v1/static_profile_types/${encodeURIComponent(
            staticTypeKey,
          )}`,
        )
      );
    });
    logStep('type-taxonomies', 'click static type save button');
    await clickSaveChanges(page);
    logStep('type-taxonomies', 'static type save button clicked');
    const staticSaveResponse = await staticSaveResponsePromise;
    expect(staticSaveResponse.status()).toBeLessThan(400);
    const staticSavePayload = await staticSaveResponse.json();
    expect(staticSavePayload?.data?.allowed_taxonomies || []).toEqual([
      staticTaxonomy.slug,
    ]);
    expect(staticSavePayload?.data?.label).toBe(staticLabelUpdate);
    logStep('type-taxonomies', 'static type save preserved allowed taxonomies');
    expect(staticSavePayload?.data?.visual?.color).toBe('#1E6FB5');

    response = await page.goto(staticEditUrl, {
      waitUntil: 'domcontentloaded',
    });
    expect(response, 'Static profile type reopen response should be available.').not.toBeNull();
    expect(response.status()).toBeLessThan(400);
    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);
    await scrollTenantAdminSheetToTop(page);
    await expect(page.getByText('Taxonomias permitidas')).toBeVisible({
      timeout: appBootTimeoutMs,
    });
    const staticReadback = await fetchStaticProfileTypeListEntry(
      api,
      baseUrl,
      session.token,
      staticTypeKey,
    );
    expect(
      staticReadback?.allowed_taxonomies || [],
      'Static profile type readback must preserve allowed taxonomies after reopen.',
    ).toEqual([staticTaxonomy.slug]);
    expect(staticReadback?.label).toBe(staticLabelUpdate);

    await assertNoBrowserFailures(collectors);
  } finally {
    await deleteEventType(api, baseUrl, session?.token, createdEventTypeId);
    await deleteStaticProfileType(
      api,
      baseUrl,
      session?.token,
      createdStaticType?.data?.type?.toString() || '',
    );
    await deleteAccountProfileType(
      api,
      baseUrl,
      session?.token,
      createdProfileType?.data?.type?.toString() || '',
    );
    await deleteTaxonomy(api, baseUrl, session?.token, eventTaxonomyBId);
    await deleteTaxonomy(api, baseUrl, session?.token, eventTaxonomyAId);
    await deleteTaxonomy(api, baseUrl, session?.token, staticTaxonomyId);
    await deleteTaxonomy(api, baseUrl, session?.token, profileTaxonomyBId);
    await deleteTaxonomy(api, baseUrl, session?.token, profileTaxonomyAId);
    if (browserContext) {
      await browserContext.close().catch(() => {});
    }
    if (freshBrowser) {
      await freshBrowser.close().catch(() => {});
    }
    await api.dispose();
  }
});
