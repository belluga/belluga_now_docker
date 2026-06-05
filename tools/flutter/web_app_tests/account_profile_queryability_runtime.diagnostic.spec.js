const { execFileSync } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const { test, expect, request, chromium } = require('@playwright/test');
const { loginTenantAdmin } = require('./support/tenant_admin_auth');
const {
  createAuthenticatedTenantAdminPage,
} = require('./support/tenant_admin_seeded_session');
const {
  cleanupOnboardedAccounts,
} = require('./support/account_onboarding_cleanup');

const tenantUrl = process.env.NAV_TENANT_URL;
const appBootTimeoutMs = 90000;
let anonymousIdentityToken = null;

test.describe.configure({ timeout: 420000 });

function requireTenantUrl() {
  expect(
    tenantUrl,
    'Missing NAV_TENANT_URL. Queryability runtime diagnostics require a live tenant URL.',
  ).toBeTruthy();
  return tenantUrl;
}

function buildUrl(baseUrl, pathName) {
  return new URL(pathName, baseUrl).toString();
}

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function textValue(...values) {
  for (const value of values) {
    const text = value?.toString().trim();
    if (text) {
      return text;
    }
  }
  return '';
}

async function createApiContext(baseUrl) {
  return request.newContext({
    baseURL: baseUrl,
    extraHTTPHeaders: {
      Accept: 'application/json',
    },
    ignoreHTTPSErrors: true,
    timeout: 45000,
  });
}

function logStep(message) {
  console.log(`[QRY-RUNTIME] ${message}`);
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
  const a11yButton = page.getByRole('button', { name: /Enable accessibility/i });

  for (let attempt = 0; attempt < 25; attempt += 1) {
    if ((await page.getByRole('button').count()) > 1) {
      return;
    }

    const placeholderCount = await placeholder.count();
    const a11yCount = await a11yButton.count();
    if (placeholderCount === 0 && a11yCount === 0) {
      return;
    }

    if (placeholderCount > 0) {
      await placeholder.focus();
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
      if ((await page.getByRole('button').count()) > 1) {
        return;
      }
    } else if (a11yCount > 0) {
      await a11yButton.first().click();
      await page.waitForTimeout(300);
      if ((await page.getByRole('button').count()) > 1) {
        return;
      }
    }

    await page.waitForTimeout(200);
  }
}

async function openAppPath(page, baseUrl, pathName) {
  logStep(`goto ${pathName}`);
  const response = await page.goto(buildUrl(baseUrl, pathName), {
    waitUntil: 'domcontentloaded',
  });
  expect(response, `Response should be available for ${pathName}.`).not.toBeNull();
  expect(response.status(), `Response should be successful for ${pathName}.`)
    .toBeLessThan(400);
  logStep(`goto ${pathName} loaded`);
  await assertAppBooted(page);
  logStep(`app booted ${pathName}`);
  await enableAccessibilityIfNeeded(page);
  logStep(`accessibility enabled ${pathName}`);
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
  throw new Error(description);
}

async function anonymousIdentityTokenFor(baseUrl, api) {
  if (anonymousIdentityToken) {
    return anonymousIdentityToken;
  }

  const fingerprintHash = crypto
    .createHash('sha256')
    .update(`queryability-runtime:${baseUrl}`)
    .digest('hex');
  const response = await api.post(
    buildUrl(baseUrl, '/api/v1/anonymous/identities'),
    {
      headers: { Accept: 'application/json' },
      data: {
        device_name: 'playwright-account-profile-queryability-runtime',
        fingerprint: {
          hash: fingerprintHash,
          user_agent: 'playwright-account-profile-queryability-runtime',
          locale: 'pt-BR',
        },
        metadata: {
          source: 'web_navigation_account_profile_queryability_runtime',
        },
      },
    },
  );
  expect([200, 201]).toContain(response.status());
  const payload = await response.json();
  anonymousIdentityToken = payload?.data?.token?.toString().trim() || '';
  expect(anonymousIdentityToken).toBeTruthy();
  return anonymousIdentityToken;
}

async function tenantPublicAuthHeaders(api, baseUrl) {
  const token = await anonymousIdentityTokenFor(baseUrl, api);
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

async function createAccountProfileType(
  api,
  baseUrl,
  token,
  {
    type,
    label,
    capabilities = {},
    allowedTaxonomies = [],
    color = '#0F766E',
  },
) {
  const response = await api.post(
    buildUrl(baseUrl, '/admin/api/v1/account_profile_types'),
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
        capabilities: {
          is_queryable: true,
          is_publicly_discoverable: false,
          is_publicly_navigable: false,
          is_poi_enabled: false,
          is_reference_location_enabled: false,
          is_favoritable: false,
          has_avatar: true,
          has_cover: false,
          has_bio: false,
          has_content: false,
          has_taxonomies: false,
          has_events: false,
          has_nested_profile_groups: false,
          ...capabilities,
        },
        poi_visual: {
          mode: 'icon',
          icon: 'place',
          color,
          icon_color: '#FFFFFF',
        },
      },
    },
  );
  expect(response.status(), `Account profile type ${type} must be created.`).toBe(201);
  const payload = await response.json();
  return payload?.data || {};
}

async function deleteAccountProfileType(api, baseUrl, token, type) {
  if (!type) {
    return;
  }
  await api.delete(
    buildUrl(baseUrl, `/admin/api/v1/account_profile_types/${encodeURIComponent(type)}`),
    {
      headers: authHeaders(token),
      failOnStatusCode: false,
      timeout: 15000,
    },
  );
}

async function createAccountProfile(api, baseUrl, token, profileType, name) {
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
    buildUrl(baseUrl, '/admin/api/v1/account_onboardings'),
    {
      headers: authHeaders(token),
      data: payload,
    },
  );
  expect(response.status(), `Account profile ${name} must be created.`).toBe(201);
  const created = await response.json();
  const account = created?.data?.account || {};
  const profile = created?.data?.account_profile || {};
  return {
    id: profile?.id?.toString() || '',
    displayName: textValue(profile?.display_name, name),
    accountSlug: account?.slug?.toString() || '',
    profileSlug: profile?.slug?.toString() || '',
  };
}

async function createEventType(api, baseUrl, token, suffix) {
  const response = await api.post(
    buildUrl(baseUrl, '/admin/api/v1/event_types'),
    {
      headers: authHeaders(token),
      data: {
        name: `PW QRY Event Type ${suffix}`,
        slug: `pw-qry-event-type-${suffix}`,
        description: 'Playwright queryability runtime diagnostic type',
      },
    },
  );
  expect(response.status()).toBe(201);
  const payload = await response.json();
  return payload?.data || {};
}

async function deleteEvent(api, baseUrl, token, eventId) {
  if (!eventId) {
    return;
  }
  await api.delete(buildUrl(baseUrl, `/admin/api/v1/events/${eventId}`), {
    headers: authHeaders(token),
    failOnStatusCode: false,
    timeout: 15000,
  });
}

function futureWindow(daysFromNow, hourOffset = 0) {
  const start = new Date(
    Date.now() + daysFromNow * 24 * 60 * 60 * 1000 + hourOffset * 60 * 60 * 1000,
  );
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  return {
    date_time_start: start.toISOString(),
    date_time_end: end.toISOString(),
  };
}

async function createDiagnosticEvent(
  api,
  baseUrl,
  token,
  {
    title,
    eventType,
    host,
    eventParties = [],
    profileGroups = undefined,
    occurrences = undefined,
    daysFromNow,
  },
) {
  const resolvedOccurrences = Array.isArray(occurrences)
    ? occurrences
    : [futureWindow(daysFromNow)];
  const response = await api.post(buildUrl(baseUrl, '/admin/api/v1/events'), {
    headers: authHeaders(token),
    data: {
      title,
      content: `<p>${title} validates queryability runtime behavior.</p>`,
      type: {
        id: eventType.id,
        name: eventType.name,
        slug: eventType.slug,
        description: eventType.description || 'Diagnostic event type',
      },
      location: {
        mode: 'physical',
      },
      place_ref: {
        type: 'account_profile',
        id: host.id,
      },
      event_parties: eventParties.map((profile) => ({
        party_ref_id: profile.id,
      })),
      occurrences: resolvedOccurrences,
      publication: {
        status: 'published',
        publish_at: new Date(Date.now() - 60 * 1000).toISOString(),
      },
      ...(profileGroups === undefined ? {} : { profile_groups: profileGroups }),
    },
  });
  const responseBody = await response.json().catch(async () => ({
    raw: await response.text().catch(() => ''),
  }));
  expect(
    response.status(),
    `Diagnostic event ${title} must be created. Response: ${JSON.stringify(responseBody)}`,
  ).toBe(201);
  return responseBody?.data || {};
}

function occurrenceIdAt(event, index) {
  const occurrenceId = event?.occurrences?.[index]?.occurrence_id?.toString() || '';
  expect(occurrenceId).toBeTruthy();
  return occurrenceId;
}

function eventRoutePath(event, occurrenceIndex = 0) {
  const routeRef = textValue(event?.slug, event?.event_id);
  expect(routeRef).toBeTruthy();
  return `/agenda/evento/${routeRef}?occurrence=${occurrenceIdAt(event, occurrenceIndex)}`;
}

async function fetchPublicEvent(api, baseUrl, event, occurrenceIndex = 0) {
  const routeRef = textValue(event?.slug, event?.event_id);
  const url = new URL(buildUrl(baseUrl, `/api/v1/events/${routeRef}`));
  url.searchParams.set('occurrence', occurrenceIdAt(event, occurrenceIndex));
  const response = await api.get(url.toString(), {
    headers: await tenantPublicAuthHeaders(api, baseUrl),
  });
  expect(response.status()).toBe(200);
  const payload = await response.json();
  return payload?.data || {};
}

async function locateAdminEventListPlacement(api, baseUrl, token, eventId) {
  for (let page = 1; page <= 10; page += 1) {
    const url = new URL(buildUrl(baseUrl, '/admin/api/v1/events'));
    url.searchParams.set('page', page.toString());
    url.searchParams.set('page_size', '20');
    url.searchParams.set('temporal', 'now,future');
    const response = await api.get(url.toString(), {
      headers: authHeaders(token),
    });
    expect(response.status()).toBe(200);
    const payload = await response.json();
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    const index = rows.findIndex((row) => row?.event_id?.toString() === eventId);
    if (index >= 0) {
      return { page, index };
    }
    if (rows.length === 0) {
      break;
    }
  }
  throw new Error(`Seeded event ${eventId} not found in tenant-admin list.`);
}

async function fetchRelatedProfileCandidates(api, baseUrl, token, search) {
  const url = new URL(buildUrl(baseUrl, '/admin/api/v1/events/account_profile_candidates'));
  url.searchParams.set('type', 'related_account_profile');
  url.searchParams.set('page', '1');
  url.searchParams.set('page_size', '50');
  if (search) {
    url.searchParams.set('search', search);
  }
  const response = await api.get(url.toString(), {
    headers: authHeaders(token),
  });
  expect(response.status(), 'Related account-profile candidates must load.').toBe(200);
  const payload = await response.json();
  return Array.isArray(payload?.data) ? payload.data : [];
}

async function scrollToSeededEventCard(page, title, expectedApiPage) {
  const titlePattern = new RegExp(escapeRegExp(title), 'i');
  const semanticCard = page
    .getByRole('button', {
      name: new RegExp(`Editar evento\\s+${escapeRegExp(title)}`, 'i'),
    })
    .first();
  const candidates = [
    semanticCard,
    page.getByRole('group', { name: titlePattern }).first(),
    page.getByLabel(titlePattern).first(),
    page.getByText(titlePattern).first(),
  ];
  const listAnchors = page.getByRole('button', { name: /^Editar evento / });
  const maxAttempts = Math.max(24, expectedApiPage * 18);
  const viewport =
    page.viewportSize() ||
    (await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    })));
  await page.mouse.move(viewport.width * 0.55, viewport.height * 0.78);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    for (const [index, candidate] of candidates.entries()) {
      if (await candidate.isVisible().catch(() => false)) {
        return {
          locator: candidate,
          isAccessibleEditButton: index === 0,
        };
      }
    }
    const anchorCount = await listAnchors.count().catch(() => 0);
    if (anchorCount > 0) {
      await listAnchors.nth(Math.max(anchorCount - 1, 0)).hover().catch(() => {});
    }
    await page.mouse.wheel(0, 320);
    await page.waitForTimeout(400);
  }
  return null;
}

async function openSeededEventFromAdminList(page, baseUrl, title, placement) {
  await openAppPath(page, baseUrl, '/admin/events');
  const card = await scrollToSeededEventCard(page, title, placement.page);
  expect(card, `Seeded admin event card "${title}" must be reachable.`).toBeTruthy();
  await card.locator.scrollIntoViewIfNeeded({ timeout: appBootTimeoutMs }).catch(() => {});
  await card.locator.click({ timeout: appBootTimeoutMs });
  await expect(page).toHaveURL(/\/admin\/events\/edit/, {
    timeout: appBootTimeoutMs,
  });
  await expect(page.getByText('Editar evento').first()).toBeVisible({
    timeout: appBootTimeoutMs,
  });
}

async function openPublicEventDetail(page, baseUrl, event, occurrenceIndex = 0) {
  logStep(`open public detail ${eventRoutePath(event, occurrenceIndex)}`);
  const response = await page.goto(buildUrl(baseUrl, eventRoutePath(event, occurrenceIndex)), {
    waitUntil: 'domcontentloaded',
  });
  expect(response).not.toBeNull();
  expect(response.status()).toBeLessThan(400);
  await assertAppBooted(page);
  await enableAccessibilityIfNeeded(page);
  await expect(
    page.getByText(textValue(event?.title)).first(),
  ).toBeVisible({ timeout: appBootTimeoutMs });
  logStep('public detail visible');
}

async function clickTab(page, label) {
  logStep(`click tab ${label}`);
  const roleTab = page.getByRole('button', {
    name: new RegExp(`^${escapeRegExp(label)}$`, 'i'),
  }).first();
  if (await roleTab.isVisible().catch(() => false)) {
    await roleTab.click({ timeout: appBootTimeoutMs });
    logStep(`tab ${label} clicked via role button`);
    return;
  }

  const textTab = page.getByText(new RegExp(`^${escapeRegExp(label)}$`, 'i')).first();
  await expect(textTab, `Tab ${label} must be visible.`).toBeVisible({
    timeout: appBootTimeoutMs,
  });
  await textTab.click({ timeout: appBootTimeoutMs });
  logStep(`tab ${label} clicked via text`);
}

async function fillFlutterTextFieldByLocator(page, field, value, label) {
  await field.scrollIntoViewIfNeeded().catch(() => {});
  await expect(field).toBeVisible({ timeout: appBootTimeoutMs });

  let lastValue = '';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await field.click();
    const selectAll = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
    await page.keyboard.press(selectAll);
    await page.keyboard.press('Backspace');
    await page.keyboard.type(value, { delay: 5 });

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
            message: `Expected Flutter text field "${label}" to retain input.`,
          },
        )
        .toBe(value);
      return;
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
    `Flutter text field "${label}" did not retain "${value}" before submit; last value was "${lastValue}".`,
  );
}

function staleMutationGuard() {
  if (process.env.NAV_RUNTIME_DB_MUTATION_ALLOWED !== '1') {
    throw new Error(
      'NAV_RUNTIME_DB_MUTATION_ALLOWED=1 is required for the stale-reference diagnostic.',
    );
  }
}

function mutateEventWithStaleProfileReference({
  tenantId,
  eventId,
  staleProfileId,
}) {
  staleMutationGuard();
  const script = `
    $tenant = \\\\App\\\\Models\\\\Landlord\\\\Tenant::query()
      ->where('_id', '${tenantId}')
      ->firstOrFail();
    $tenant->makeCurrent();
    $event = \\\\Belluga\\\\Events\\\\Models\\\\Tenants\\\\Event::query()
      ->where('_id', '${eventId}')
      ->firstOrFail();

    $eventParties = $event->event_parties ?? [];
    if ($eventParties instanceof \\\\MongoDB\\\\Model\\\\BSONArray || $eventParties instanceof \\\\MongoDB\\\\Model\\\\BSONDocument) {
      $eventParties = $eventParties->getArrayCopy();
    }
    $eventParties = array_values(array_map(static function ($row) {
      if ($row instanceof \\\\MongoDB\\\\Model\\\\BSONArray || $row instanceof \\\\MongoDB\\\\Model\\\\BSONDocument) {
        $row = $row->getArrayCopy();
      }
      return is_array($row) ? $row : [];
    }, is_array($eventParties) ? $eventParties : []));
    $hasParty = false;
    foreach ($eventParties as $row) {
      if (($row['party_ref_id'] ?? null) === '${staleProfileId}') {
        $hasParty = true;
        break;
      }
    }
    if (!$hasParty) {
      $eventParties[] = ['party_ref_id' => '${staleProfileId}'];
    }
    $event->event_parties = $eventParties;

    $groups = $event->profile_groups ?? [];
    if ($groups instanceof \\\\MongoDB\\\\Model\\\\BSONArray || $groups instanceof \\\\MongoDB\\\\Model\\\\BSONDocument) {
      $groups = $groups->getArrayCopy();
    }
    $groups = array_values(array_map(static function ($group) {
      if ($group instanceof \\\\MongoDB\\\\Model\\\\BSONArray || $group instanceof \\\\MongoDB\\\\Model\\\\BSONDocument) {
        $group = $group->getArrayCopy();
      }
      return is_array($group) ? $group : [];
    }, is_array($groups) ? $groups : []));
    if (!isset($groups[0])) {
      throw new \\\\RuntimeException('Missing first profile group for stale-reference mutation.');
    }
    $memberIds = $groups[0]['account_profile_ids'] ?? [];
    if ($memberIds instanceof \\\\MongoDB\\\\Model\\\\BSONArray || $memberIds instanceof \\\\MongoDB\\\\Model\\\\BSONDocument) {
      $memberIds = $memberIds->getArrayCopy();
    }
    $memberIds = array_values(is_array($memberIds) ? $memberIds : []);
    if (!in_array('${staleProfileId}', $memberIds, true)) {
      $memberIds[] = '${staleProfileId}';
    }
    $groups[0]['account_profile_ids'] = $memberIds;
    $event->profile_groups = $groups;
    $event->save();
  `;
  const encoded = Buffer.from(script).toString('base64');
  const repoRoot = path.resolve(__dirname, '..', '..');
  execFileSync(
    'docker',
    [
      'exec',
      'belluga_now_docker-app-1',
      'php',
      'artisan',
      'tinker',
      '--execute',
      `eval(base64_decode('${encoded}'));`,
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: 'ignore',
      timeout: 30000,
    },
  );
}

async function openSelectorAndAssertHiddenAbsent(page, {
  groupLabel,
  hiddenName,
  expectedSelectedCount,
}) {
  const sectionTitle = page.getByText('Abas de perfis relacionados').first();
  logStep('scrolling to related-profile groups section');
  await scrollUntilVisible(
    page,
    sectionTitle,
    'Expected related-profile groups section to be visible before opening the selector.',
  );
  await expect(sectionTitle).toBeVisible({ timeout: appBootTimeoutMs });
  logStep('related-profile groups section visible');

  logStep(`open selector for group ${groupLabel}`);
  const groupContainer = page.getByLabel(
    new RegExp(`Grupo ${escapeRegExp(groupLabel)};`, 'i'),
  ).first();
  logStep(`group locator count ${await groupContainer.count().catch(() => 0)}`);
  await scrollUntilVisible(
    page,
    groupContainer,
    `Expected group ${groupLabel} to be visible before opening selector.`,
  );
  logStep(`group ${groupLabel} visible`);
  logStep(`group text content: ${(await groupContainer.textContent().catch(() => '')) || '<empty>'}`);
  logStep(
    `group button count: ${await groupContainer.getByRole('button').count().catch(() => 0)}`,
  );
  let selectorButton = groupContainer.getByRole('button', {
    name: /\d+\s+perfil\(is\) selecionado\(s\)|perfil\(is\) selecionado\(s\)|Selecionar perfis/i,
  }).first();
  if (!(await selectorButton.isVisible().catch(() => false))) {
    logStep('role-based selector button not visible; falling back to text lookup');
    const globalSelectorText = page.getByText(
      /\d+\s+perfil\(is\) selecionado\(s\)|perfil\(is\) selecionado\(s\)|Selecionar perfis/i,
    );
    logStep(
      `global selector text count: ${await globalSelectorText.count().catch(() => 0)}`,
    );
    selectorButton = globalSelectorText.first();
  }
  await expect(selectorButton).toBeVisible({ timeout: appBootTimeoutMs });
  if (typeof expectedSelectedCount === 'number') {
    await expect(
      selectorButton,
      `Expected ${expectedSelectedCount} visible selected profiles for group ${groupLabel}.`,
    ).toHaveText(
      new RegExp(`^\\s*${expectedSelectedCount}\\s+perfil\\(is\\) selecionado\\(s\\)\\s*$`, 'i'),
      { timeout: appBootTimeoutMs },
    );
  }
  await selectorButton.scrollIntoViewIfNeeded().catch(() => {});
  logStep('selector button visible; clicking');
  await selectorButton.click();

  const searchField = page.getByRole('textbox', { name: 'Buscar perfil' }).last();
  await expect(searchField).toBeVisible({ timeout: appBootTimeoutMs });
  logStep('selector search field visible');

  logStep(`searching hidden profile ${hiddenName}`);
  await fillFlutterTextFieldByLocator(
    page,
    searchField,
    hiddenName,
    'Buscar perfil',
  );
  await expect(page.getByText('Nenhum perfil encontrado.')).toBeVisible({
    timeout: appBootTimeoutMs,
  });
  logStep('empty search result confirmed');
  await expect(
    page.getByText(new RegExp(escapeRegExp(hiddenName), 'i')),
  ).toHaveCount(0);
  logStep('hidden profile text absent after search');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  logStep(`selector for group ${groupLabel} excluded hidden profile`);
}

test('@mutation @diagnostic QRY-RUNTIME admin/public queryability and navigation contract holds', async () => {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  const createdAccountSlugs = [];
  const createdEventIds = [];
  const createdProfileTypes = [];
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  });

  try {
    const environmentResponse = await api.get(buildUrl(baseUrl, '/api/v1/environment'));
    expect(environmentResponse.status()).toBe(200);
    const environment = await environmentResponse.json();
    const tenantId = environment?.tenant_id?.toString() || '';
    expect(tenantId).toBeTruthy();

    const adminSession = await loginTenantAdmin({
      api,
      baseUrl,
      deviceName: 'playwright-account-profile-queryability-runtime',
    });
    const { token } = adminSession;
    const suffix = Date.now().toString();
    logStep(`seeding runtime data ${suffix}`);

    const visibleType = await createAccountProfileType(api, baseUrl, token, {
      type: `pw_qry_visible_${suffix}`,
      label: `PW QRY Visible ${suffix}`,
      capabilities: {
        is_queryable: true,
        is_publicly_discoverable: false,
        is_publicly_navigable: true,
      },
      color: '#2563EB',
    });
    const participantType = await createAccountProfileType(api, baseUrl, token, {
      type: `pw_qry_participant_${suffix}`,
      label: `PW QRY Participant ${suffix}`,
      capabilities: {
        is_queryable: true,
        is_publicly_discoverable: false,
        is_publicly_navigable: false,
      },
      color: '#7C3AED',
    });
    const hiddenType = await createAccountProfileType(api, baseUrl, token, {
      type: `pw_qry_hidden_${suffix}`,
      label: `PW QRY Hidden ${suffix}`,
      capabilities: {
        is_queryable: false,
        is_publicly_discoverable: false,
        is_publicly_navigable: false,
      },
      color: '#B91C1C',
    });
    const parentType = await createAccountProfileType(api, baseUrl, token, {
      type: `pw_qry_parent_${suffix}`,
      label: `PW QRY Parent ${suffix}`,
      capabilities: {
        is_queryable: true,
        is_publicly_discoverable: false,
        is_publicly_navigable: false,
        has_nested_profile_groups: true,
      },
      color: '#0F766E',
    });
    const hostType = await createAccountProfileType(api, baseUrl, token, {
      type: `pw_qry_host_${suffix}`,
      label: `PW QRY Host ${suffix}`,
      capabilities: {
        is_queryable: true,
        is_publicly_discoverable: false,
        is_publicly_navigable: false,
        is_poi_enabled: true,
        is_reference_location_enabled: true,
      },
      color: '#EA580C',
    });
    createdProfileTypes.push(
      visibleType.type,
      participantType.type,
      hiddenType.type,
      parentType.type,
      hostType.type,
    );

    const visibleProfile = await createAccountProfile(
      api,
      baseUrl,
      token,
      visibleType,
      `PW QRY Visible Profile ${suffix}`,
    );
    const participantProfile = await createAccountProfile(
      api,
      baseUrl,
      token,
      participantType,
      `PW QRY Participant Profile ${suffix}`,
    );
    const hiddenProfile = await createAccountProfile(
      api,
      baseUrl,
      token,
      hiddenType,
      `PW QRY Hidden Profile ${suffix}`,
    );
    const parentProfile = await createAccountProfile(
      api,
      baseUrl,
      token,
      parentType,
      `PW QRY Parent Profile ${suffix}`,
    );
    const hostProfile = await createAccountProfile(
      api,
      baseUrl,
      token,
      hostType,
      `PW QRY Host Profile ${suffix}`,
    );
    createdAccountSlugs.push(
      visibleProfile.accountSlug,
      participantProfile.accountSlug,
      hiddenProfile.accountSlug,
      parentProfile.accountSlug,
      hostProfile.accountSlug,
    );

    const eventType = await createEventType(api, baseUrl, token, suffix);
    const publicEvent = await createDiagnosticEvent(api, baseUrl, token, {
      title: `PW QRY Public Event ${suffix}`,
      eventType,
      host: hostProfile,
      eventParties: [visibleProfile, participantProfile],
      profileGroups: [
        {
          id: 'outro-grupo',
          label: 'Outro Grupo',
          order: 0,
          account_profile_ids: [visibleProfile.id, participantProfile.id],
        },
      ],
      daysFromNow: 11,
    });
    createdEventIds.push(publicEvent.event_id);

    mutateEventWithStaleProfileReference({
      tenantId,
      eventId: publicEvent.event_id,
      staleProfileId: hiddenProfile.id,
    });

    const publicPayload = await fetchPublicEvent(api, baseUrl, publicEvent);
    expect(publicPayload.profile_groups.map((group) => group.label)).toEqual([
      'Outro Grupo',
    ]);
    const publicGroupProfiles = publicPayload.profile_groups[0].profiles || [];
    expect(publicGroupProfiles.map((profile) => profile.id)).toEqual([
      visibleProfile.id,
      participantProfile.id,
    ]);
    expect(
      publicGroupProfiles.some((profile) => profile.id === hiddenProfile.id),
    ).toBe(false);
    expect(
      (publicPayload.linked_account_profiles || []).some(
        (profile) => profile.id === hiddenProfile.id,
      ),
    ).toBe(false);

    const visibleProjection = publicGroupProfiles.find(
      (profile) => profile.id === visibleProfile.id,
    );
    const participantProjection = publicGroupProfiles.find(
      (profile) => profile.id === participantProfile.id,
    );
    expect(visibleProjection?.can_open_public_detail).toBe(true);
    expect(visibleProjection?.public_detail_path).toBe(`/parceiro/${visibleProfile.profileSlug}`);
    expect(participantProjection?.can_open_public_detail).toBe(false);
    expect(participantProjection?.public_detail_path ?? null).toBeNull();

    const relatedCandidates = await fetchRelatedProfileCandidates(
      api,
      baseUrl,
      token,
      'PW QRY',
    );
    expect(relatedCandidates.map((profile) => profile.id)).toContain(visibleProfile.id);
    expect(relatedCandidates.map((profile) => profile.id)).toContain(participantProfile.id);
    expect(relatedCandidates.map((profile) => profile.id)).not.toContain(hiddenProfile.id);
    logStep('public API assertions passed');

    const adminReadbackResponse = await api.get(
      buildUrl(baseUrl, `/admin/api/v1/events/${publicEvent.event_id}`),
      {
        headers: authHeaders(token),
      },
    );
    expect(adminReadbackResponse.status(), 'Admin event readback must succeed.').toBe(200);
    const adminReadbackPayload = await adminReadbackResponse.json();
    expect(
      adminReadbackPayload?.data?.profile_groups?.[0]?.account_profile_ids,
      'Admin readback must suppress stale hidden group members in normal edit payload.',
    ).toEqual([visibleProfile.id, participantProfile.id]);

    const adminPlacement = await locateAdminEventListPlacement(
      api,
      baseUrl,
      token,
      publicEvent.event_id,
    );
    const adminRuntime = await createAuthenticatedTenantAdminPage(browser, adminSession);
    try {
      logStep('admin selector assertions started');
      await openSeededEventFromAdminList(
        adminRuntime.page,
        baseUrl,
        publicEvent.title,
        adminPlacement,
      );
      await openSelectorAndAssertHiddenAbsent(adminRuntime.page, {
        groupLabel: 'Outro Grupo',
        hiddenName: hiddenProfile.displayName,
        expectedSelectedCount: 2,
      });
      logStep('admin selector assertions passed');
    } finally {
      await adminRuntime.context.close();
      logStep('admin browser context closed');
    }

    const publicContext = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 430, height: 900 },
      isMobile: true,
      hasTouch: true,
    });
    const publicPage = await publicContext.newPage();
    try {
      logStep('public browser assertions started');
      await openPublicEventDetail(publicPage, baseUrl, publicEvent);
      await clickTab(publicPage, 'Outro Grupo');
      logStep('assert hidden profile absent from public tab');
      await expect(
        publicPage.getByText(new RegExp(escapeRegExp(hiddenProfile.displayName), 'i')),
      ).toHaveCount(0);
      const eventUrl = publicPage.url();
      logStep(`event URL snapshot ${eventUrl}`);

      logStep('click visible public profile card');
      await publicPage
        .getByText(new RegExp(escapeRegExp(visibleProfile.displayName), 'i'))
        .first()
        .click({ timeout: appBootTimeoutMs });
      await expect(publicPage).toHaveURL(
        new RegExp(`/parceiro/${escapeRegExp(visibleProfile.profileSlug)}(?:[/?#]|$)`),
        { timeout: appBootTimeoutMs },
      );
      logStep('visible public profile navigated');

      logStep('go back to event detail');
      await publicPage.goBack({ waitUntil: 'domcontentloaded' });
      await assertAppBooted(publicPage);
      await enableAccessibilityIfNeeded(publicPage);
      logStep('event detail restored after back');
      await clickTab(publicPage, 'Outro Grupo');
      const participantCardText = publicPage
        .getByText(new RegExp(escapeRegExp(participantProfile.displayName), 'i'))
        .first();
      await expect(participantCardText).toBeVisible({ timeout: appBootTimeoutMs });
      logStep('assert non-navigable participant remains on event detail');
      expect(publicPage.url()).toBe(eventUrl);
      await expect(publicPage.getByText('Algo deu errado')).toHaveCount(0);
      logStep('public browser assertions passed');
    } finally {
      await publicContext.close();
      logStep('public browser context closed');
    }
  } finally {
    const cleanupApi = await createApiContext(baseUrl);
    try {
      logStep('cleanup started');
      const { token } = await loginTenantAdmin({
        api: cleanupApi,
        baseUrl,
        deviceName: 'playwright-account-profile-queryability-runtime-cleanup',
      });
      for (const eventId of createdEventIds.reverse()) {
        await deleteEvent(cleanupApi, baseUrl, token, eventId);
      }
      await cleanupOnboardedAccounts(
        cleanupApi,
        baseUrl,
        token,
        createdAccountSlugs.reverse(),
      );
      for (const profileType of createdProfileTypes.reverse()) {
        await deleteAccountProfileType(cleanupApi, baseUrl, token, profileType);
      }
      logStep('cleanup completed');
    } catch (_) {
      logStep('cleanup skipped after best-effort failure');
    } finally {
      await cleanupApi.dispose();
      await api.dispose();
      await browser.close();
      logStep('runtime contexts disposed');
    }
  }
});
