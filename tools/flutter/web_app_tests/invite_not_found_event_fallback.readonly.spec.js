const { test, expect } = require('@playwright/test');

const tenantUrl = process.env.NAV_TENANT_URL;
const appBootTimeoutMs = 120000;
const knownBrokenInviteCode = '7A9SCU6U4H';
const recoverableFallback = {
  eventSlug: 'pw-event-share-boundary-store-release-5',
  occurrenceId: '6a17bada93ba592fce055f5d',
  eventTitle: 'PW Event Share Boundary Store Release',
};

test.describe.configure({ timeout: 300000 });

function requireTenantUrl() {
  expect(
    tenantUrl,
    'Missing NAV_TENANT_URL. Invite fallback readonly proof requires a live tenant URL.',
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

function attachInvitePreviewCapture(page, inviteCode) {
  const statuses = [];
  const pathSuffix = `/api/v1/invites/share/${inviteCode}`;
  const onResponse = (response) => {
    const url = response.url();
    if (!url.includes(pathSuffix)) {
      return;
    }
    statuses.push(response.status());
  };
  page.on('response', onResponse);
  return {
    snapshot() {
      return [...statuses];
    },
    dispose() {
      page.off('response', onResponse);
    },
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
  const onPopup = (popup) => {
    popupUrls.push(popup.url());
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
    },
  };
}

function attachPageErrorCapture(page) {
  const pageErrors = [];
  page.on('pageerror', (error) => {
    pageErrors.push(error?.message || String(error));
  });
  return () => [...pageErrors];
}

async function gotoInvite(page, baseUrl, invitePath) {
  const response = await page.goto(buildUrl(baseUrl, invitePath), {
    waitUntil: 'domcontentloaded',
    timeout: appBootTimeoutMs,
  });
  expect(response, `Response should be available for ${invitePath}`).not.toBeNull();
  expect(response.status(), `HTML bootstrap should load for ${invitePath}`).toBeLessThan(400);
  await assertAppBooted(page);
  await enableAccessibilityIfNeeded(page);
}

async function waitForPathname(page, expectedPathname) {
  await expect
    .poll(
      () => {
        try {
          return new URL(page.url()).pathname;
        } catch (_) {
          return '';
        }
      },
      {
        timeout: appBootTimeoutMs,
        message: `Expected browser pathname to become ${expectedPathname}.`,
      },
    )
    .toBe(expectedPathname);
}

async function waitForOccurrence(page, occurrenceId) {
  await expect
    .poll(
      () => {
        try {
          return new URL(page.url()).searchParams.get('occurrence');
        } catch (_) {
          return null;
        }
      },
      {
        timeout: appBootTimeoutMs,
        message: `Expected browser occurrence query to become ${occurrenceId}.`,
      },
    )
    .toBe(occurrenceId);
}

async function expectAnyVisibleText(page, candidates, label) {
  await expect
    .poll(
      async () => {
        for (const candidate of candidates) {
          const locator = page.getByText(candidate, { exact: false }).first();
          if ((await locator.count()) > 0 && (await locator.isVisible())) {
            return candidate;
          }
        }
        return '';
      },
      {
        timeout: appBootTimeoutMs,
        message: label,
      },
    )
    .not.toBe('');
}

function expectNoPromotionBoundary(promotionSignals, label) {
  const snapshot = promotionSignals.snapshot();
  expect(
    snapshot.currentUrl,
    `${label}: current URL must not move to a promotion or auth boundary.`,
  ).not.toMatch(/\/(open-app|baixe-o-app|auth\/login)\b/);
  expect(
    snapshot.openAppUrls,
    `${label}: runtime must not request /open-app.`,
  ).toEqual([]);
  expect(
    snapshot.popupUrls,
    `${label}: runtime must not open promotion popups.`,
  ).toEqual([]);
}

test('@readonly invite not-found without recoverable fallback lands safely on home', async ({
  page,
}) => {
  const baseUrl = requireTenantUrl();
  const previewCapture = attachInvitePreviewCapture(page, knownBrokenInviteCode);
  const promotionSignals = attachPromotionSignalCapture(page);
  const readPageErrors = attachPageErrorCapture(page);

  try {
    await gotoInvite(page, baseUrl, `/invite?code=${encodeURIComponent(knownBrokenInviteCode)}`);
    await waitForPathname(page, '/');
    await expectAnyVisibleText(
      page,
      ['Agenda', 'Descubra', 'Usar minha localização', 'Continuar sem localização'],
      'Irrecoverable invite fallback must render the public home surface instead of a blank state.',
    );

    expect(
      previewCapture.snapshot(),
      'The known broken invite code must still reproduce an unavailable preview response.',
    ).toContain(404);
    expectNoPromotionBoundary(
      promotionSignals,
      'Irrecoverable invite fallback',
    );
    expect(
      readPageErrors(),
      'Irrecoverable invite fallback must not throw page-level runtime exceptions.',
    ).toEqual([]);
  } finally {
    previewCapture.dispose();
    promotionSignals.dispose();
  }
});

test('@readonly invite not-found with canonical fallback query lands on the target event', async ({
  page,
}) => {
  const baseUrl = requireTenantUrl();
  const syntheticBrokenCode = 'PW-READONLY-INVITE-FALLBACK';
  const previewCapture = attachInvitePreviewCapture(page, syntheticBrokenCode);
  const promotionSignals = attachPromotionSignalCapture(page);
  const readPageErrors = attachPageErrorCapture(page);
  const fallbackPath = `/agenda/evento/${recoverableFallback.eventSlug}?occurrence=${recoverableFallback.occurrenceId}`;
  const invitePath =
    `/invite?code=${encodeURIComponent(syntheticBrokenCode)}`
    + `&fallback=${encodeURIComponent(fallbackPath)}`;

  try {
    await gotoInvite(page, baseUrl, invitePath);
    await waitForPathname(page, `/agenda/evento/${recoverableFallback.eventSlug}`);
    await waitForOccurrence(page, recoverableFallback.occurrenceId);
    await expect(
      page.getByText(recoverableFallback.eventTitle, { exact: false }).first(),
    ).toBeVisible({
      timeout: appBootTimeoutMs,
    });

    expect(
      previewCapture.snapshot(),
      'The controlled broken invite code must still hit the unavailable preview path before event fallback.',
    ).toContain(404);
    expectNoPromotionBoundary(
      promotionSignals,
      'Recoverable invite fallback',
    );
    expect(
      readPageErrors(),
      'Recoverable invite fallback must not throw page-level runtime exceptions.',
    ).toEqual([]);
  } finally {
    previewCapture.dispose();
    promotionSignals.dispose();
  }
});
