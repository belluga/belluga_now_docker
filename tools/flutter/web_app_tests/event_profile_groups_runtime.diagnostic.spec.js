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

test.describe.configure({ timeout: 360000 });

function requireTenantUrl() {
  expect(
    tenantUrl,
    'Missing NAV_TENANT_URL. Event profile group runtime diagnostics require a live tenant URL.',
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

function anonymousFingerprintHash(baseUrl) {
  return crypto
    .createHash('sha256')
    .update(`event-profile-groups-runtime:${baseUrl}`)
    .digest('hex');
}

async function resolveAnonymousIdentityToken(api, baseUrl) {
  if (anonymousIdentityToken) {
    return anonymousIdentityToken;
  }

  const response = await api.post(
    buildUrl(baseUrl, '/api/v1/anonymous/identities'),
    {
      headers: { Accept: 'application/json' },
      data: {
        device_name: 'playwright-event-profile-groups-runtime',
        fingerprint: {
          hash: anonymousFingerprintHash(baseUrl),
          user_agent: 'playwright-event-profile-groups-runtime',
          locale: 'pt-BR',
        },
        metadata: {
          source: 'web_navigation_event_profile_groups_runtime',
        },
      },
    },
  );
  expect(
    [200, 201],
    `Anonymous tenant identity bootstrap must succeed. Status ${response.status()}`,
  ).toContain(response.status());
  const payload = await response.json();
  anonymousIdentityToken = payload?.data?.token?.toString().trim() || '';
  expect(anonymousIdentityToken, 'Anonymous identity bootstrap must return token.')
    .toBeTruthy();
  return anonymousIdentityToken;
}

async function tenantPublicAuthHeaders(api, baseUrl, description) {
  const token = await resolveAnonymousIdentityToken(api, baseUrl);
  expect(token, `${description} requires anonymous bearer token.`).toBeTruthy();
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  };
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

function logDiagnosticStep(message) {
  console.log(`[EVG-RUNTIME] ${message}`);
}

async function assertAppBooted(page) {
  await expect(page.locator('flt-glass-pane')).toHaveCount(1, {
    timeout: appBootTimeoutMs,
  });
  await expect(page.locator('#splash-screen')).toHaveCount(0, {
    timeout: appBootTimeoutMs,
  });
}

async function openAppPath(page, baseUrl, pathName) {
  const response = await page.goto(buildUrl(baseUrl, pathName), {
    waitUntil: 'domcontentloaded',
  });
  expect(response, `Response should be available for ${pathName}.`).not.toBeNull();
  expect(response.status(), `Response should be successful for ${pathName}.`)
    .toBeLessThan(400);
  await assertAppBooted(page);
  await enableAccessibilityIfNeeded(page);
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

async function createAccountProfileType(api, baseUrl, token, type, label, plural) {
  const response = await api.post(
    buildUrl(baseUrl, '/admin/api/v1/account_profile_types'),
    {
      headers: authHeaders(token),
      data: {
        type,
        label,
        labels: {
          singular: label,
          plural,
        },
        allowed_taxonomies: [],
        capabilities: {
          is_queryable: true,
          is_publicly_navigable: false,
          is_favoritable: false,
          is_publicly_discoverable: false,
          is_poi_enabled: false,
          is_reference_location_enabled: false,
          has_avatar: true,
          has_cover: false,
          has_bio: false,
          has_content: false,
          has_taxonomies: false,
          has_events: false,
        },
        visual: {
          mode: 'icon',
          icon: 'store',
          color: '#0F766E',
          icon_color: '#FFFFFF',
        },
      },
    },
  );
  expect(response.status(), `Account profile type ${type} must be created.`)
    .toBe(201);
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
  const response = await api.post(
    buildUrl(baseUrl, '/admin/api/v1/account_onboardings'),
    {
      headers: authHeaders(token),
      data: {
        name,
        ownership_state: 'unmanaged',
        profile_type: profileType,
      },
    },
  );
  expect(response.status(), `Account profile ${name} must be created.`).toBe(201);

  const payload = await response.json();
  const data = payload?.data || {};
  const profile = data?.account_profile || {};
  const id = profile?.id?.toString() || '';
  expect(id, `Account profile ${name} must return id.`).toBeTruthy();
  return {
    id,
    displayName: textValue(profile?.display_name, name),
    slug: profile?.slug?.toString() || '',
  };
}

async function createEventType(api, baseUrl, token, suffix) {
  const response = await api.post(buildUrl(baseUrl, '/admin/api/v1/event_types'), {
    headers: authHeaders(token),
    data: {
      name: `PW EVG Tipo Evento ${suffix}`,
      slug: `pw-evg-tipo-evento-${suffix}`,
      description: 'Playwright event profile group runtime diagnostic type',
    },
  });
  expect(response.status(), 'Diagnostic event type must be created.').toBe(201);
  const payload = await response.json();
  return payload?.data;
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
    expect(response.status(), `Tenant-admin events page ${page} must load.`)
      .toBe(200);
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

  throw new Error(
    `Seeded event ${eventId} was created but was not returned by the tenant-admin events list API.`,
  );
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
  expect(card, `Seeded admin event card "${title}" must be reachable.`)
    .toBeTruthy();
  await card.locator.scrollIntoViewIfNeeded({ timeout: appBootTimeoutMs })
    .catch(() => {});
  await card.locator.click({ timeout: appBootTimeoutMs });
  await expect(page).toHaveURL(/\/admin\/events\/edit/, {
    timeout: appBootTimeoutMs,
  });
  await expect(page.getByText('Editar evento').first()).toBeVisible({
    timeout: appBootTimeoutMs,
  });
}

async function scrollUntilVisible(page, locator, description) {
  const viewport =
    page.viewportSize() ||
    (await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    })));
  await page.mouse.move(viewport.width * 0.55, viewport.height * 0.78);
  for (const direction of [1, -1]) {
    for (let attempt = 0; attempt < 34; attempt += 1) {
      if (await locator.isVisible().catch(() => false)) {
        return;
      }
      await page.mouse.wheel(0, direction * 180);
      await page.waitForTimeout(160);
    }
  }
  throw new Error(description);
}

async function assertAdminGroupEditor(page, expectedGroups) {
  await scrollUntilVisible(
    page,
    page.getByText('Abas de perfis relacionados').first(),
    'Expected tenant-admin related-profile groups section to be visible.',
  );
  await expect(page.getByText('Abas de perfis relacionados').first())
    .toBeVisible({ timeout: appBootTimeoutMs });
  for (const group of expectedGroups) {
    const groupSemantic = page
      .getByLabel(
        new RegExp(
          `Grupo ${escapeRegExp(group.label)}; ${group.selectedCount} item\\(s\\) selecionado\\(s\\)`,
          'i',
        ),
      )
      .first();
    await scrollUntilVisible(
      page,
      groupSemantic,
      `Expected tenant-admin semantic group "${group.label}" to be visible.`,
    );
    await expect(groupSemantic).toBeVisible({ timeout: appBootTimeoutMs });
  }
}

async function fetchPhysicalHostCandidates(api, baseUrl, token) {
  const url = new URL(buildUrl(baseUrl, '/admin/api/v1/events/account_profile_candidates'));
  url.searchParams.set('type', 'physical_host');
  url.searchParams.set('page', '1');
  url.searchParams.set('page_size', '20');
  const response = await api.get(url.toString(), {
    headers: authHeaders(token),
  });
  expect(response.status(), 'Physical host candidates must load.').toBe(200);
  const payload = await response.json();
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return rows.filter((row) => row?.id?.toString().trim());
}

async function resolvePoiCapableProfileType(api, baseUrl, token, suffix) {
  const response = await api.get(
    buildUrl(baseUrl, '/admin/api/v1/account_profile_types'),
    { headers: authHeaders(token) },
  );
  expect(response.status(), 'Account profile type catalog must load.').toBe(200);
  const payload = await response.json();
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const existing = rows.find(
    (row) =>
      row?.capabilities?.is_poi_enabled === true &&
      row?.capabilities?.is_reference_location_enabled === true,
  );
  if (existing?.type) {
    return existing.type;
  }

  const type = `pw_evg_host_${suffix}`;
  const createResponse = await api.post(
    buildUrl(baseUrl, '/admin/api/v1/account_profile_types'),
    {
      headers: authHeaders(token),
      data: {
        type,
        label: `PW EVG Host ${suffix}`,
        labels: {
          singular: `PW EVG Host ${suffix}`,
          plural: `PW EVG Hosts ${suffix}`,
        },
        allowed_taxonomies: [],
        capabilities: {
          is_queryable: true,
          is_publicly_navigable: false,
          is_favoritable: false,
          is_publicly_discoverable: false,
          is_poi_enabled: true,
          is_reference_location_enabled: true,
          has_avatar: true,
          has_cover: false,
          has_bio: false,
          has_content: false,
          has_taxonomies: false,
          has_events: false,
        },
        visual: {
          mode: 'icon',
          icon: 'store',
          color: '#2563EB',
          icon_color: '#FFFFFF',
        },
      },
    },
  );
  expect(createResponse.status(), 'POI-capable host type seed must succeed.')
    .toBe(201);
  return type;
}

async function createPhysicalHost(api, baseUrl, token, suffix) {
  const existing = await fetchPhysicalHostCandidates(api, baseUrl, token);
  if (existing[0]?.id) {
    return {
      id: existing[0].id.toString(),
      displayName: textValue(existing[0].display_name, existing[0].name),
    };
  }

  const profileType = await resolvePoiCapableProfileType(api, baseUrl, token, suffix);
  const response = await api.post(
    buildUrl(baseUrl, '/admin/api/v1/account_onboardings'),
    {
      headers: authHeaders(token),
      data: {
        name: `PW EVG Host ${suffix}`,
        ownership_state: 'unmanaged',
        profile_type: profileType,
        location: {
          lat: -20.671339,
          lng: -40.495395,
        },
      },
    },
  );
  expect(response.status(), 'Physical host seed must succeed.').toBe(201);
  const payload = await response.json();
  const profile = payload?.data?.account_profile || {};
  return {
    id: profile?.id?.toString() || '',
    displayName: textValue(profile?.display_name, `PW EVG Host ${suffix}`),
  };
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
    eventParties,
    profileGroups = undefined,
    occurrenceParties = undefined,
    occurrences = undefined,
    daysFromNow,
  },
) {
  const resolvedOccurrences = Array.isArray(occurrences)
    ? occurrences
    : [futureWindow(daysFromNow)];
  if (occurrenceParties !== undefined && !Array.isArray(occurrences)) {
    resolvedOccurrences[0].event_parties = occurrenceParties.map((profile) => ({
      party_ref_id: profile.id,
    }));
  }

  const data = {
    title,
    content: `<p>${title} validates event profile group runtime behavior.</p>`,
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
  };
  if (profileGroups !== undefined) {
    data.profile_groups = profileGroups;
  }

  const response = await api.post(buildUrl(baseUrl, '/admin/api/v1/events'), {
    headers: authHeaders(token),
    data,
  });
  const responseBody = await response.json().catch(async () => ({
    raw: await response.text().catch(() => ''),
  }));
  expect(
    response.status(),
    `Diagnostic event ${title} must be created. Response: ${JSON.stringify(responseBody)}`,
  ).toBe(201);
  return responseBody?.data;
}

function firstOccurrenceId(event) {
  return occurrenceIdAt(event, 0);
}

function occurrenceIdAt(event, index) {
  const occurrenceId = event?.occurrences?.[index]?.occurrence_id?.toString() || '';
  expect(occurrenceId, `Diagnostic event must expose occurrence id at index ${index}.`)
    .toBeTruthy();
  return occurrenceId;
}

function eventRoutePath(event, occurrenceIndex = 0) {
  const routeRef = textValue(event?.slug, event?.event_id);
  expect(routeRef, 'Diagnostic event must expose slug or event id.').toBeTruthy();
  return `/agenda/evento/${routeRef}?occurrence=${occurrenceIdAt(event, occurrenceIndex)}`;
}

async function fetchPublicEvent(api, baseUrl, event, occurrenceIndex = 0) {
  const routeRef = textValue(event?.slug, event?.event_id);
  const url = new URL(buildUrl(baseUrl, `/api/v1/events/${routeRef}`));
  url.searchParams.set('occurrence', occurrenceIdAt(event, occurrenceIndex));
  const response = await api.get(url.toString(), {
    headers: await tenantPublicAuthHeaders(api, baseUrl, 'Public event API detail'),
  });
  expect(response.status(), 'Public event API detail must load.').toBe(200);
  const payload = await response.json();
  return payload?.data || {};
}

async function openEventDetail(page, baseUrl, event, occurrenceIndex = 0) {
  const response = await page.goto(buildUrl(baseUrl, eventRoutePath(event, occurrenceIndex)), {
    waitUntil: 'domcontentloaded',
  });
  expect(response, 'Public event detail response must exist.').not.toBeNull();
  expect(response.status(), 'Public event detail route must be successful.')
    .toBeLessThan(400);
  await assertAppBooted(page);
  await enableAccessibilityIfNeeded(page);
  await expect(page.getByText(textValue(event?.title)).first()).toBeVisible({
    timeout: appBootTimeoutMs,
  });
}

async function expectVisibleText(page, value, label = value) {
  await expect(
    page.getByText(new RegExp(escapeRegExp(value), 'i')).first(),
    label,
  ).toBeVisible({ timeout: appBootTimeoutMs });
}

async function expectTextAbsent(page, value, label = value) {
  await expect(
    page.getByText(new RegExp(escapeRegExp(value), 'i')),
    label,
  ).toHaveCount(0);
}

async function clickTab(page, label) {
  const roleTab = page.getByRole('button', {
    name: new RegExp(`^${escapeRegExp(label)}$`, 'i'),
  }).first();
  if (await roleTab.isVisible().catch(() => false)) {
    await roleTab.click();
    return;
  }

  const textTab = page.getByText(new RegExp(`^${escapeRegExp(label)}$`, 'i')).first();
  await expect(textTab, `Tab ${label} must be visible.`).toBeVisible({
    timeout: appBootTimeoutMs,
  });
  await textTab.click();
}

async function openOccurrenceFromPublicRoute(page, baseUrl, event, occurrenceIndex) {
  const expectedOccurrenceId = occurrenceIdAt(event, occurrenceIndex);
  logDiagnosticStep(`opening occurrence ${expectedOccurrenceId} at index ${occurrenceIndex}`);
  await openEventDetail(page, baseUrl, event, occurrenceIndex);
  await clickTab(page, 'Programação');
  await page.waitForFunction(
    ({ occurrenceId }) =>
      window.location.href.includes(`occurrence=${encodeURIComponent(occurrenceId)}`),
    { occurrenceId: expectedOccurrenceId },
    { timeout: appBootTimeoutMs },
  );
  await assertAppBooted(page);
  await enableAccessibilityIfNeeded(page);
}

async function assertTabMembers(page, tabLabel, expectedNames) {
  await clickTab(page, tabLabel);
  for (const name of expectedNames) {
    await expectVisibleText(page, name, `Expected member ${name} in ${tabLabel}.`);
  }
}

async function deleteEvent(api, baseUrl, token, event) {
  const eventId = event?.event_id?.toString() || '';
  if (!eventId) {
    return;
  }
  await api.delete(buildUrl(baseUrl, `/admin/api/v1/events/${eventId}`), {
    headers: authHeaders(token),
    failOnStatusCode: false,
    timeout: 15000,
  });
}

function mutateEventProfileGroupsDirectly({ tenantId, eventId, profileIdToAppend }) {
  if (process.env.NAV_RUNTIME_DB_MUTATION_ALLOWED !== '1') {
    throw new Error(
      'NAV_RUNTIME_DB_MUTATION_ALLOWED=1 is required for the historical-inconsistency diagnostic.',
    );
  }

  const script = `
    $tenant = \\\\App\\\\Models\\\\Landlord\\\\Tenant::query()
      ->where('_id', '${tenantId}')
      ->firstOrFail();
    $tenant->makeCurrent();
    $event = \\\\Belluga\\\\Events\\\\Models\\\\Tenants\\\\Event::query()
      ->where('_id', '${eventId}')
      ->firstOrFail();
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
      throw new \\\\RuntimeException('Missing first profile group for diagnostic mutation.');
    }
    $memberIds = $groups[0]['account_profile_ids'] ?? [];
    if ($memberIds instanceof \\\\MongoDB\\\\Model\\\\BSONArray || $memberIds instanceof \\\\MongoDB\\\\Model\\\\BSONDocument) {
      $memberIds = $memberIds->getArrayCopy();
    }
    $memberIds = array_values(is_array($memberIds) ? $memberIds : []);
    if (!in_array('${profileIdToAppend}', $memberIds, true)) {
      $memberIds[] = '${profileIdToAppend}';
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

test('@mutation @diagnostic EVG-RUNTIME admin/public event groups honor saved groups, legacy fallback, and invalid historical data', async () => {
  const baseUrl = requireTenantUrl();
  const api = await createApiContext(baseUrl);
  const createdEvents = [];
  const createdAccountSlugs = [];
  const createdProfileTypes = [];
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  });

  try {
    const environmentResponse = await api.get(buildUrl(baseUrl, '/api/v1/environment'));
    expect(environmentResponse.status(), 'Tenant environment must load.').toBe(200);
    const environment = await environmentResponse.json();
    const tenantId = environment?.tenant_id?.toString() || '';
    expect(tenantId, 'Tenant environment must expose tenant_id.').toBeTruthy();

    const adminSession = await loginTenantAdmin({
      api,
      baseUrl,
      deviceName: 'playwright-event-profile-groups-runtime',
    });
    const { token } = adminSession;

    const suffix = Date.now().toString();
    logDiagnosticStep(`seeding runtime data ${suffix}`);
    const typeA = `pw_evg_alpha_${suffix}`;
    const typeB = `pw_evg_beta_${suffix}`;
    const typeAPlural = `Tipos Alpha ${suffix}`;
    const typeBPlural = `Tipos Beta ${suffix}`;
    await createAccountProfileType(api, baseUrl, token, typeA, `Tipo Alpha ${suffix}`, typeAPlural);
    await createAccountProfileType(api, baseUrl, token, typeB, `Tipo Beta ${suffix}`, typeBPlural);
    createdProfileTypes.push(typeA, typeB);

    const [alphaOne, betaOne, alphaTwo, betaTwo] = await Promise.all([
      createAccountProfile(api, baseUrl, token, typeA, `PW EVG Alpha Um ${suffix}`),
      createAccountProfile(api, baseUrl, token, typeB, `PW EVG Beta Um ${suffix}`),
      createAccountProfile(api, baseUrl, token, typeA, `PW EVG Alpha Dois ${suffix}`),
      createAccountProfile(api, baseUrl, token, typeB, `PW EVG Beta Dois ${suffix}`),
    ]);
    createdAccountSlugs.push(
      alphaOne.slug,
      betaOne.slug,
      alphaTwo.slug,
      betaTwo.slug,
    );
    const host = await createPhysicalHost(api, baseUrl, token, suffix);
    const eventType = await createEventType(api, baseUrl, token, suffix);

    const groupedEvent = await createDiagnosticEvent(api, baseUrl, token, {
      title: `PW EVG Novo Customizado ${suffix}`,
      eventType,
      host,
      eventParties: [alphaOne, betaOne, alphaTwo, betaTwo],
      profileGroups: [
        {
          id: 'bandas-customizadas',
          label: 'Bandas Customizadas',
          order: 0,
          account_profile_ids: [alphaOne.id, betaOne.id],
        },
        {
          id: 'expositores-curados',
          label: 'Expositores Curados',
          order: 1,
          account_profile_ids: [alphaTwo.id, betaTwo.id],
        },
      ],
      daysFromNow: 11,
    });
    createdEvents.push(groupedEvent);
    logDiagnosticStep('created grouped event');

    const legacyEvent = await createDiagnosticEvent(api, baseUrl, token, {
      title: `PW EVG Legado Sem Grupos ${suffix}`,
      eventType,
      host,
      eventParties: [alphaOne, betaOne],
      daysFromNow: 12,
    });
    createdEvents.push(legacyEvent);
    logDiagnosticStep('created legacy fallback event');

    const inconsistentEvent = await createDiagnosticEvent(api, baseUrl, token, {
      title: `PW EVG Historico Inconsistente ${suffix}`,
      eventType,
      host,
      eventParties: [alphaOne],
      profileGroups: [
        {
          id: 'historico-customizado',
          label: 'Historico Customizado',
          order: 0,
          account_profile_ids: [alphaOne.id],
        },
      ],
      daysFromNow: 13,
    });
    createdEvents.push(inconsistentEvent);
    mutateEventProfileGroupsDirectly({
      tenantId,
      eventId: inconsistentEvent.event_id,
      profileIdToAppend: betaOne.id,
    });
    logDiagnosticStep('created and mutated inconsistent event');

    const multiOccurrenceEvent = await createDiagnosticEvent(api, baseUrl, token, {
      title: `PW EVG Multi Ocorrencias ${suffix}`,
      eventType,
      host,
      eventParties: [],
      occurrences: [
        {
          ...futureWindow(14, 0),
          event_parties: [alphaOne, betaOne].map((profile) => ({
            party_ref_id: profile.id,
          })),
          profile_groups: [
            {
              id: 'palco-sexta',
              label: 'Palco Sexta',
              order: 0,
              account_profile_ids: [alphaOne.id, betaOne.id],
            },
          ],
          programming_items: [
            {
              time: '13:00',
              end_time: '13:30',
              title: 'Abertura Palco Sexta',
              account_profile_ids: [alphaOne.id, betaOne.id],
            },
          ],
        },
        {
          ...futureWindow(15, 2),
          event_parties: [alphaTwo, betaTwo].map((profile) => ({
            party_ref_id: profile.id,
          })),
          profile_groups: [
            {
              id: 'palco-sabado',
              label: 'Palco Sabado',
              order: 0,
              account_profile_ids: [alphaTwo.id, betaTwo.id],
            },
          ],
          programming_items: [
            {
              time: '14:00',
              end_time: '14:30',
              title: 'Abertura Palco Sabado',
              account_profile_ids: [alphaTwo.id, betaTwo.id],
            },
          ],
        },
      ],
    });
    createdEvents.push(multiOccurrenceEvent);
    logDiagnosticStep('created multi-occurrence event');

    const overlapEvent = await createDiagnosticEvent(api, baseUrl, token, {
      title: `PW EVG Sobreposicao Explicita ${suffix}`,
      eventType,
      host,
      eventParties: [alphaOne, betaOne],
      profileGroups: [
        {
          id: 'bandas-customizadas',
          label: 'Bandas Customizadas',
          order: 0,
          account_profile_ids: [alphaOne.id, betaOne.id],
        },
      ],
      occurrences: [
        {
          ...futureWindow(16, 0),
        },
        {
          ...futureWindow(17, 2),
          event_parties: [alphaOne, betaOne].map((profile) => ({
            party_ref_id: profile.id,
          })),
          profile_groups: [
            {
              id: 'outro-grupo',
              label: 'Outro Grupo',
              order: 0,
              account_profile_ids: [alphaOne.id, betaOne.id],
            },
          ],
        },
      ],
    });
    createdEvents.push(overlapEvent);
    logDiagnosticStep('created explicit overlap event');

    const groupedApi = await fetchPublicEvent(api, baseUrl, groupedEvent);
    expect(groupedApi.profile_groups.map((group) => group.label)).toEqual([
      'Bandas Customizadas',
      'Expositores Curados',
    ]);
    expect(groupedApi.profile_groups.flatMap((group) => group.profiles.map((profile) => profile.id)))
      .toEqual([alphaOne.id, betaOne.id, alphaTwo.id, betaTwo.id]);

    const legacyApi = await fetchPublicEvent(api, baseUrl, legacyEvent);
    expect(legacyApi.profile_groups.map((group) => group.label).sort()).toEqual([
      typeAPlural,
      typeBPlural,
    ].sort());

    const inconsistentApi = await fetchPublicEvent(api, baseUrl, inconsistentEvent);
    expect(inconsistentApi.profile_groups.map((group) => group.label)).toEqual([
      'Historico Customizado',
    ]);
    expect(inconsistentApi.profile_groups[0].profiles.map((profile) => profile.id))
      .toEqual([alphaOne.id]);

    const multiOccurrenceFirstApi = await fetchPublicEvent(
      api,
      baseUrl,
      multiOccurrenceEvent,
      0,
    );
    expect(multiOccurrenceFirstApi.profile_groups.map((group) => group.label))
      .toEqual(['Palco Sexta', 'Palco Sabado']);
    expect(
      multiOccurrenceFirstApi.profile_groups[0].profiles.map((profile) => profile.id),
    ).toEqual([alphaOne.id, betaOne.id]);
    expect(
      multiOccurrenceFirstApi.profile_groups[1].profiles.map((profile) => profile.id),
    ).toEqual([alphaTwo.id, betaTwo.id]);

    const multiOccurrenceSecondApi = await fetchPublicEvent(
      api,
      baseUrl,
      multiOccurrenceEvent,
      1,
    );
    expect(multiOccurrenceSecondApi.profile_groups.map((group) => group.label))
      .toEqual(['Palco Sexta', 'Palco Sabado']);
    expect(
      multiOccurrenceSecondApi.profile_groups[0].profiles.map((profile) => profile.id),
    ).toEqual([alphaOne.id, betaOne.id]);
    expect(
      multiOccurrenceSecondApi.profile_groups[1].profiles.map((profile) => profile.id),
    ).toEqual([alphaTwo.id, betaTwo.id]);

    const overlapApi = await fetchPublicEvent(
      api,
      baseUrl,
      overlapEvent,
      1,
    );
    expect(overlapApi.profile_groups.map((group) => group.label))
      .toEqual(['Bandas Customizadas', 'Outro Grupo']);
    expect(
      overlapApi.profile_groups[0].profiles.map((profile) => profile.id),
    ).toEqual([alphaOne.id, betaOne.id]);
    expect(
      overlapApi.profile_groups[1].profiles.map((profile) => profile.id),
    ).toEqual([alphaOne.id, betaOne.id]);
    logDiagnosticStep('public API assertions passed');

    const groupedPlacement = await locateAdminEventListPlacement(
      api,
      baseUrl,
      token,
      groupedEvent.event_id,
    );
    const legacyPlacement = await locateAdminEventListPlacement(
      api,
      baseUrl,
      token,
      legacyEvent.event_id,
    );
    const adminRuntime = await createAuthenticatedTenantAdminPage(
      browser,
      adminSession,
    );
    try {
      logDiagnosticStep('admin browser assertions started');
      await openSeededEventFromAdminList(
        adminRuntime.page,
        baseUrl,
        groupedEvent.title,
        groupedPlacement,
      );
      await assertAdminGroupEditor(
        adminRuntime.page,
        [
          { label: 'Bandas Customizadas', selectedCount: 2 },
          { label: 'Expositores Curados', selectedCount: 2 },
        ],
      );

      await openSeededEventFromAdminList(
        adminRuntime.page,
        baseUrl,
        legacyEvent.title,
        legacyPlacement,
      );
      await assertAdminGroupEditor(
        adminRuntime.page,
        [
          { label: typeAPlural, selectedCount: 1 },
          { label: typeBPlural, selectedCount: 1 },
        ],
      );
    } finally {
      await adminRuntime.context.close();
      logDiagnosticStep('admin browser context closed');
    }

    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 430, height: 900 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    try {
      logDiagnosticStep('public browser assertions started');
      await openEventDetail(page, baseUrl, groupedEvent);
      await expectVisibleText(page, 'Bandas Customizadas');
      await expectVisibleText(page, 'Expositores Curados');
      await expectTextAbsent(page, typeAPlural, 'New explicit event must not show type A fallback tab.');
      await expectTextAbsent(page, typeBPlural, 'New explicit event must not show type B fallback tab.');
      await assertTabMembers(page, 'Bandas Customizadas', [
        alphaOne.displayName,
        betaOne.displayName,
      ]);
      await assertTabMembers(page, 'Expositores Curados', [
        alphaTwo.displayName,
        betaTwo.displayName,
      ]);

      await openEventDetail(page, baseUrl, legacyEvent);
      await expectVisibleText(page, typeAPlural);
      await expectVisibleText(page, typeBPlural);
      await expectTextAbsent(page, 'Bandas Customizadas', 'Legacy event must not invent custom group tabs.');
      await expectTextAbsent(page, 'Expositores Curados', 'Legacy event must not invent custom group tabs.');
      await assertTabMembers(page, typeAPlural, [alphaOne.displayName]);
      await assertTabMembers(page, typeBPlural, [betaOne.displayName]);

      await openEventDetail(page, baseUrl, inconsistentEvent);
      await expectVisibleText(page, 'Historico Customizado');
      await expectTextAbsent(page, typeBPlural, 'Invalid historical member must not leak into fallback tab.');
      await assertTabMembers(page, 'Historico Customizado', [alphaOne.displayName]);
      await expectTextAbsent(
        page,
        betaOne.displayName,
        'Profile present only in invalid profile_groups must not render publicly without event_parties.',
      );

      await openEventDetail(page, baseUrl, multiOccurrenceEvent, 0);
      await expectVisibleText(page, 'Palco Sexta');
      await expectVisibleText(page, 'Palco Sabado');
      await assertTabMembers(page, 'Palco Sexta', [
        alphaOne.displayName,
        betaOne.displayName,
      ]);
      await assertTabMembers(page, 'Palco Sabado', [
        alphaTwo.displayName,
        betaTwo.displayName,
      ]);

      await openOccurrenceFromPublicRoute(page, baseUrl, multiOccurrenceEvent, 1);
      await expectVisibleText(page, 'Abertura Palco Sabado');
      await expectTextAbsent(
        page,
        'Abertura Palco Sexta',
        'Switching occurrence must change programming items.',
      );
      await expectVisibleText(page, 'Palco Sexta');
      await expectVisibleText(page, 'Palco Sabado');
      await assertTabMembers(page, 'Palco Sexta', [
        alphaOne.displayName,
        betaOne.displayName,
      ]);
      await assertTabMembers(page, 'Palco Sabado', [
        alphaTwo.displayName,
        betaTwo.displayName,
      ]);

      await openOccurrenceFromPublicRoute(page, baseUrl, multiOccurrenceEvent, 0);
      await expectVisibleText(page, 'Palco Sexta');
      await expectVisibleText(page, 'Palco Sabado');
      await expectVisibleText(page, 'Abertura Palco Sexta');
      await expectTextAbsent(
        page,
        'Abertura Palco Sabado',
        'Switching back must change programming items.',
      );
      await assertTabMembers(page, 'Palco Sexta', [
        alphaOne.displayName,
        betaOne.displayName,
      ]);
      await assertTabMembers(page, 'Palco Sabado', [
        alphaTwo.displayName,
        betaTwo.displayName,
      ]);

      await openEventDetail(page, baseUrl, multiOccurrenceEvent, 1);
      await expectVisibleText(page, 'Palco Sexta');
      await expectVisibleText(page, 'Palco Sabado');
      await assertTabMembers(page, 'Palco Sexta', [
        alphaOne.displayName,
        betaOne.displayName,
      ]);
      await assertTabMembers(page, 'Palco Sabado', [
        alphaTwo.displayName,
        betaTwo.displayName,
      ]);

      await openEventDetail(page, baseUrl, overlapEvent, 1);
      await expectVisibleText(page, 'Bandas Customizadas');
      await expectVisibleText(page, 'Outro Grupo');
      await assertTabMembers(page, 'Bandas Customizadas', [
        alphaOne.displayName,
        betaOne.displayName,
      ]);
      await assertTabMembers(page, 'Outro Grupo', [
        alphaOne.displayName,
        betaOne.displayName,
      ]);
      logDiagnosticStep('public browser assertions passed');
    } finally {
      await context.close();
      logDiagnosticStep('public browser context closed');
    }
  } finally {
    const baseUrl = tenantUrl;
    const cleanupApi = await createApiContext(baseUrl);
    try {
      logDiagnosticStep('cleanup started');
      const { token } = await loginTenantAdmin({
        api: cleanupApi,
        baseUrl,
        deviceName: 'playwright-event-profile-groups-runtime-cleanup',
      });
      for (const event of createdEvents.reverse()) {
        await deleteEvent(cleanupApi, baseUrl, token, event);
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
      logDiagnosticStep('cleanup completed');
    } catch (_) {
      // Diagnostic cleanup is best effort; failing cleanup must not hide the validation result.
      logDiagnosticStep('cleanup skipped after best-effort failure');
    } finally {
      await cleanupApi.dispose();
      await api.dispose();
      logDiagnosticStep('api contexts disposed');
      await browser.close().catch(() => {});
      logDiagnosticStep('standalone browser closed');
    }
  }
  logDiagnosticStep('test function returning');
});
