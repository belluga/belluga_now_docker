const { test, expect } = require('@playwright/test');
const {
  bootstrapInviteFixture,
  cleanupInviteFixture,
  requireStageInviteSupportConfig,
} = require('./invite_stage_support.cjs');

const appBootTimeoutMs = 90000;

test.describe.configure({ timeout: 240000 });

async function assertAppBooted(page) {
  await expect(page.locator('script[src*="main.dart.js"]')).toHaveCount(1, {
    timeout: appBootTimeoutMs,
  });
  await expect(page.locator('flt-glass-pane')).toHaveCount(1, {
    timeout: appBootTimeoutMs,
  });
  await expect(page.locator('#splash-screen')).toHaveCount(0, {
    timeout: appBootTimeoutMs,
  });
}

async function enableAccessibilityIfNeeded(page) {
  const a11yButton = page.getByRole('button', { name: /Enable accessibility/i });
  if ((await a11yButton.count()) > 0) {
    const placeholder = page
      .locator('flt-semantics-placeholder[aria-label="Enable accessibility"]')
      .first();
    await placeholder.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
  }
}

function extractRedirectTarget(location) {
  const direct = new URL(location.href).searchParams.get('redirect');
  if (direct) {
    return direct;
  }

  const hash = location.hash || '';
  const queryIndex = hash.indexOf('?');
  if (queryIndex < 0) {
    return null;
  }

  return new URLSearchParams(hash.slice(queryIndex + 1)).get('redirect');
}

function isAuthLoginLocation(location) {
  return (
    location.pathname.startsWith('/auth/login') ||
    location.hash.startsWith('#/auth/login') ||
    location.hash.includes('/auth/login?')
  );
}

test('@mutation anonymous invite preview preserves share code in auth redirect', async ({
  page,
  request,
}) => {
  requireStageInviteSupportConfig();
  let fixture = null;

  try {
    fixture = await bootstrapInviteFixture(request, 'accept_pending');

    const response = await page.goto(fixture.inviteUrl, {
      waitUntil: 'domcontentloaded',
    });
    expect(response, 'Invite preview response should be available').not.toBeNull();
    expect(response.status(), 'Invite preview response should be successful').toBeLessThan(400);

    await assertAppBooted(page);
    await enableAccessibilityIfNeeded(page);

    const authButton = page.getByRole('button', {
      name: /Entre para Aceitar ou Recusar/i,
    });
    await expect(authButton).toBeVisible({ timeout: appBootTimeoutMs });
    await authButton.click();

    await page.waitForFunction(() => {
      const current = {
        href: window.location.href,
        pathname: window.location.pathname,
        hash: window.location.hash,
      };
      return (
        current.pathname.startsWith('/auth/login') ||
        current.hash.startsWith('#/auth/login') ||
        current.hash.includes('/auth/login?')
      );
    });

    const location = await page.evaluate(() => ({
      href: window.location.href,
      pathname: window.location.pathname,
      hash: window.location.hash,
    }));

    expect(
      isAuthLoginLocation(location),
      `Expected auth login route after invite CTA, got ${location.href}`,
    ).toBeTruthy();

    const redirectTarget = extractRedirectTarget(location);
    expect(redirectTarget, 'Auth redirect must preserve the original invite path.').toBeTruthy();
    expect(decodeURIComponent(redirectTarget), 'Redirect must preserve invite share code.').toBe(
      `/invite?code=${fixture.shareCode}`,
    );
  } finally {
    await cleanupInviteFixture(request, fixture?.runId);
  }
});
