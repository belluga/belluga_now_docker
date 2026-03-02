const { test, expect } = require('@playwright/test');

const landlordUrl = process.env.NAV_LANDLORD_URL;
const tenantUrl = process.env.NAV_TENANT_URL;
const adminEmail = process.env.LANDLORD_ADMIN_EMAIL || 'admin@bellugasolutions.com.br';
const adminPassword = process.env.LANDLORD_ADMIN_PASSWORD || '765432e1';

if (!landlordUrl || !tenantUrl) {
  throw new Error('Missing NAV_LANDLORD_URL/NAV_TENANT_URL.');
}

function installFailureCollectors(page) {
  const runtimeErrors = [];
  const failedRequests = [];
  const consoleErrors = [];

  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('requestfailed', (request) => {
    const failureText = request.failure()?.errorText || 'unknown';
    if (failureText === 'net::ERR_ABORTED') return;
    failedRequests.push(`${request.method()} ${request.url()} (${failureText})`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  return { runtimeErrors, failedRequests, consoleErrors };
}

async function assertAppBooted(page) {
  await expect(page.locator('body')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('script[src*="main.dart.js"]')).toHaveCount(1);
  await expect(page.locator('flt-glass-pane')).toHaveCount(1, { timeout: 90000 });
  await expect(page.locator('#splash-screen')).toHaveCount(0, { timeout: 90000 });
}

async function ensureSemanticsEnabled(page) {
  await page.evaluate(() => {
    const el = document.querySelector('[aria-label="Enable accessibility"]');
    if (!el) return;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    if (typeof el.click === 'function') {
      el.click();
    }
  });
}

async function loginAsAdminIfNeeded(page) {
  const openLoginButton = page.getByRole('button', { name: 'Entrar como Admin' }).first();
  const accessAdminButton = page.getByRole('button', { name: 'Acessar área admin' }).first();

  if (await accessAdminButton.isVisible().catch(() => false)) {
    await accessAdminButton.click();
    return;
  }

  await openLoginButton.first().click();
  await expect(page.getByText('Entrar como Admin')).toBeVisible({ timeout: 20000 });

  const emailField = page.getByRole('textbox', { name: 'E-mail' }).first();
  const passwordField = page.getByRole('textbox', { name: 'Senha' }).first();
  const submitButton = page.getByRole('button', { name: 'Entrar' }).last();
  const loginErrorText = page.getByText('Falha ao entrar').first();
  const dismissButton = page.getByRole('button', { name: 'Dismiss' }).first();

  await expect(emailField).toBeVisible({ timeout: 10000 });
  await emailField.fill(adminEmail);
  await passwordField.fill(adminPassword);
  await submitButton.click();
  await dismissButton.waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});

  const transitionedToAdmin = await page
    .waitForURL((url) => url.pathname.startsWith('/admin'), { timeout: 8000 })
    .then(() => true)
    .catch(() => false);

  const canAccessAdmin = await accessAdminButton.isVisible().catch(() => false);
  const loginFailed = await loginErrorText.isVisible().catch(() => false);

  if ((!(canAccessAdmin || transitionedToAdmin)) || loginFailed) {
    throw new Error('Landlord login did not establish session on this domain.');
  }

  if (canAccessAdmin && !transitionedToAdmin) {
    await accessAdminButton.click();
  }
}

async function pickTenantGuarapari(page) {
  const gateTitle = page.getByText('Selecionar tenant').first();
  if (!(await gateTitle.isVisible().catch(() => false))) {
    return;
  }

  const guarappariByName = page.getByText(/Guarappari/i).first();

  if (!(await guarappariByName.isVisible().catch(() => false))) {
    throw new Error('Guarappari tenant option not found in tenant selection gate.');
  }
  await guarappariByName.click();
}

async function openEventsScreen(page) {
  const eventsNav = page.getByText('Eventos');
  await expect(eventsNav.first()).toBeVisible({ timeout: 45000 });
  await eventsNav.first().click();
  await expect(page.getByLabel('Buscar eventos')).toBeVisible({ timeout: 30000 });
}

async function openEventTypesScreen(page) {
  const typesButton = page.getByRole('button', { name: /Tipos de evento|Tipos/i });
  await expect(typesButton.first()).toBeVisible({ timeout: 30000 });
  await typesButton.first().click();
  await expect(page.getByText('Tipos de evento')).toBeVisible({ timeout: 30000 });
}

async function ensureAbsentType(page) {
  const absentTypeText = page.getByText(/^Absent$/i);
  if ((await absentTypeText.count()) > 0) {
    return;
  }

  const createTypeButton = page.getByRole('button', { name: /Criar tipo/i });
  await expect(createTypeButton.first()).toBeVisible({ timeout: 20000 });
  await createTypeButton.first().click();

  await expect(page.getByText('Criar tipo de evento')).toBeVisible({ timeout: 20000 });
  await page.getByLabel('Nome').fill('Absent');
  await page.getByLabel('Slug').fill('absent');
  await page.getByLabel('Descrição (opcional)').fill('Created by E2E UI flow.');

  await page.getByRole('button', { name: 'Criar tipo' }).click();
  await expect(page.getByText('Tipos de evento')).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(/^Absent$/i)).toBeVisible({ timeout: 30000 });
}

async function navigateBackToEvents(page) {
  // Re-open events route explicitly to avoid relying on header/back semantics.
  await page.goto(new URL('/admin', tenantUrl).toString(), {
    waitUntil: 'domcontentloaded',
  });
  await assertAppBooted(page);
  await ensureSemanticsEnabled(page);
  await loginAsAdminIfNeeded(page);
  await openEventsScreen(page);
}

async function openCreateEventForm(page) {
  const createButtons = [
    page.getByRole('button', { name: /Novo evento/i }),
    page.locator('[data-testid="tenant-admin-events-create-fab"]'),
  ];

  let opened = false;
  for (const button of createButtons) {
    if ((await button.count()) > 0) {
      await button.first().click();
      opened = true;
      break;
    }
  }

  if (!opened) {
    throw new Error('Could not find Novo evento button/FAB.');
  }

  await expect(page.getByText('Criar evento')).toBeVisible({ timeout: 30000 });
}

async function fillRequiredEventFields(page, eventTitle) {
  await page.getByLabel('Título').fill(eventTitle);
  await page.getByLabel('Descrição').fill('Created by full E2E UI flow test.');

  const typeField = page.getByLabel('Tipo');
  if ((await typeField.count()) > 0) {
    await typeField.first().click();
    const absentOption = page.getByText(/^Absent$/i);
    if ((await absentOption.count()) > 0) {
      await absentOption.first().click();
    }
  }

  // Fill start datetime via input value; submit parser accepts "YYYY-MM-DD HH:mm".
  const startAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  const startText = `${startAt.getFullYear()}-${pad(startAt.getMonth() + 1)}-${pad(startAt.getDate())} ${pad(startAt.getHours())}:${pad(startAt.getMinutes())}`;

  await page.evaluate((value) => {
    const input = Array.from(document.querySelectorAll('input')).find((el) => {
      const label = el.getAttribute('aria-label') || '';
      return label.includes('Início');
    });
    if (!input) return;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, startText);

  const modeField = page.getByLabel('Modo');
  await modeField.first().click();
  const onlineOption = page.getByText(/^Online$/i);
  await expect(onlineOption.first()).toBeVisible({ timeout: 10000 });
  await onlineOption.first().click();

  await page.getByLabel('URL online').fill('https://meet.example.org/e2e-room');
}

test('E2E UI flow: login, pick Guarappari, create type if absent, create event', async ({ page }) => {
  const collectors = installFailureCollectors(page);
  const unique = Date.now();
  const eventTitle = `E2E UI Event ${unique}`;

  await page.goto(new URL('/', landlordUrl).toString(), {
    waitUntil: 'domcontentloaded',
  });
  await assertAppBooted(page);
  await ensureSemanticsEnabled(page);

  await loginAsAdminIfNeeded(page);
  await pickTenantGuarapari(page);

  // Tenant selection in landlord env redirects to tenant domain.
  await page.waitForURL((url) => url.hostname.includes('guarappari'), {
    timeout: 60000,
  });

  await assertAppBooted(page);
  await ensureSemanticsEnabled(page);
  // Without cross-domain token bridge, tenant domain requires fresh landlord login.
  await loginAsAdminIfNeeded(page);
  await page.goto(new URL('/admin', tenantUrl).toString(), {
    waitUntil: 'domcontentloaded',
  });
  await assertAppBooted(page);
  await ensureSemanticsEnabled(page);
  await loginAsAdminIfNeeded(page);
  await page.waitForURL(
    (url) => url.hostname.includes('guarappari') && url.pathname.startsWith('/admin'),
    { timeout: 60000 }
  );

  await openEventsScreen(page);
  await openEventTypesScreen(page);
  await ensureAbsentType(page);
  await navigateBackToEvents(page);

  await openCreateEventForm(page);
  await fillRequiredEventFields(page, eventTitle);

  await page.getByRole('button', { name: 'Criar evento' }).click();

  await expect(page.getByLabel('Buscar eventos')).toBeVisible({ timeout: 45000 });
  await page.getByLabel('Buscar eventos').fill(eventTitle);
  await page.getByLabel('Buscar eventos').press('Enter');
  await expect(page.getByText(eventTitle)).toBeVisible({ timeout: 45000 });

  expect(
    collectors.runtimeErrors,
    `Unexpected runtime errors:\n${collectors.runtimeErrors.join('\n')}`
  ).toEqual([]);
  expect(
    collectors.failedRequests,
    `Failed requests:\n${collectors.failedRequests.join('\n')}`
  ).toEqual([]);
  expect(
    collectors.consoleErrors.filter((line) => !/favicon|manifest/i.test(line)),
    `Console errors:\n${collectors.consoleErrors.join('\n')}`
  ).toEqual([]);
});
