const crypto = require('crypto');
const { test, expect } = require('@playwright/test');

const tenantUrl = process.env.NAV_TENANT_URL;
const appBootTimeoutMs = 90000;
const publicListPageSize = 50;
const publicListMaxPages = 25;

test.describe.configure({ timeout: 300000 });

function requireTenantUrl() {
  expect(
    tenantUrl,
    'Missing NAV_TENANT_URL. Taxonomy display snapshot runtime suite requires a live tenant URL.',
  ).toBeTruthy();
  return tenantUrl;
}

function buildApiUrl(baseUrl, pathName, searchParams = {}) {
  const url = new URL(pathName, baseUrl);
  for (const [key, value] of Object.entries(searchParams)) {
    if (value != null && value !== '') {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

function isApplicationApiRequest(rawUrl) {
  const parsed = parseApplicationUrl(rawUrl);
  return parsed != null && parsed.pathname.includes('/api/');
}

function isApplicationRequest(rawUrl) {
  return parseApplicationUrl(rawUrl) != null;
}

function parseApplicationUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (_) {
    return null;
  }

  const appHosts = [tenantUrl, process.env.NAV_LANDLORD_URL]
    .filter(Boolean)
    .map((value) => new URL(value).host);

  return appHosts.includes(parsed.host) ? parsed : null;
}

function isIgnorableOptionalMediaResponse(rawUrl) {
  const parsed = parseApplicationUrl(rawUrl);
  return parsed != null && parsed.pathname.startsWith('/api/v1/media/');
}

function installFailureCollectors(page) {
  const runtimeErrors = [];
  const failedRequests = [];
  const errorResponses = [];
  const consoleErrors = [];
  const mutatingApiRequests = [];

  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('request', (request) => {
    const method = (request.method() || '').toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return;
    }
    const url = request.url();
    if (url.includes('/api/v1/anonymous/identities')) {
      return;
    }
    if (isApplicationApiRequest(url)) {
      mutatingApiRequests.push(`${method} ${url}`);
    }
  });
  page.on('requestfailed', (request) => {
    const failureText = request.failure()?.errorText || 'unknown';
    if (failureText !== 'net::ERR_ABORTED') {
      failedRequests.push(`${request.method()} ${request.url()} (${failureText})`);
    }
  });
  page.on('response', (response) => {
    const status = response.status();
    if (
      status >= 400 &&
      isApplicationRequest(response.url()) &&
      !isIgnorableOptionalMediaResponse(response.url())
    ) {
      errorResponses.push(`${status} ${response.request().method()} ${response.url()}`);
    }
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const text = message.text();
      if (!/^Failed to load resource: the server responded with a status of 404/i.test(text)) {
        consoleErrors.push(text);
      }
    }
  });

  return {
    runtimeErrors,
    failedRequests,
    errorResponses,
    consoleErrors,
    mutatingApiRequests,
  };
}

async function assertNoBrowserFailures(collectors) {
  expect(
    collectors.runtimeErrors,
    `Unexpected runtime errors:\n${collectors.runtimeErrors.join('\n')}`,
  ).toEqual([]);
  expect(
    collectors.failedRequests,
    `Unexpected failed requests:\n${collectors.failedRequests.join('\n')}`,
  ).toEqual([]);
  expect(
    collectors.errorResponses,
    `Unexpected failed API responses:\n${collectors.errorResponses.join('\n')}`,
  ).toEqual([]);
  expect(
    collectors.consoleErrors,
    `Unexpected console errors:\n${collectors.consoleErrors.join('\n')}`,
  ).toEqual([]);
  expect(
    collectors.mutatingApiRequests,
    `Readonly taxonomy snapshot flow must not issue mutating API requests:\n${collectors.mutatingApiRequests.join('\n')}`,
  ).toEqual([]);
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

async function continueWithoutLocationIfPrompted(page) {
  const continueButton = page.getByRole('button', {
    name: /Continuar sem localizacao|Continuar sem localização/i,
  });

  await continueButton.first().waitFor({
    state: 'visible',
    timeout: 15000,
  }).catch(() => null);

  if ((await continueButton.count()) === 0) {
    return;
  }

  await continueButton.first().click();
  await expect(continueButton).toHaveCount(0, { timeout: appBootTimeoutMs });
  await assertAppBooted(page);
  await enableAccessibilityIfNeeded(page);
}

async function fetchJson(page, url, description) {
  const response = await page.request.get(url, {
    headers: await tenantPublicAuthHeaders(page, description),
  });
  expect(
    response.status(),
    `${description} must return HTTP 2xx: ${url}`,
  ).toBeLessThan(300);
  return response.json();
}

async function fetchPagedRows(
  page,
  pathName,
  description,
  { maxPages = publicListMaxPages } = {},
) {
  const baseUrl = requireTenantUrl();
  const rows = [];
  const pageSummaries = [];

  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    const payload = await fetchJson(
      page,
      buildApiUrl(baseUrl, pathName, {
        page: pageNumber,
        per_page: publicListPageSize,
      }),
      `${description} page ${pageNumber}`,
    );
    const pageRows = payloadRows(payload);
    rows.push(...pageRows);
    pageSummaries.push({
      page: pageNumber,
      count: pageRows.length,
      currentPage: payload?.current_page ?? null,
      lastPage: payload?.last_page ?? null,
      nextPageUrl: payload?.next_page_url ?? null,
    });

    const lastPage = Number(payload?.last_page);
    if (Number.isFinite(lastPage) && pageNumber >= lastPage) {
      break;
    }
    if (payload?.next_page_url == null && pageRows.length === 0) {
      break;
    }
  }

  return { rows, pageSummaries };
}

let anonymousIdentityToken = null;

function anonymousFingerprintHash(baseUrl) {
  return crypto
    .createHash('sha256')
    .update(`taxonomy-display-snapshots:${baseUrl}`)
    .digest('hex');
}

async function tenantPublicAuthHeaders(page, description) {
  const token = await resolveAnonymousIdentityToken(page);
  expect(token, `${description} requires anonymous tenant bearer token.`).toBeTruthy();

  return {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

async function resolveAnonymousIdentityToken(page) {
  if (anonymousIdentityToken) {
    return anonymousIdentityToken;
  }

  const baseUrl = requireTenantUrl();
  const response = await page.request.post(
    buildApiUrl(baseUrl, '/api/v1/anonymous/identities'),
    {
      headers: { Accept: 'application/json' },
      data: {
        device_name: 'playwright-taxonomy-display-snapshots',
        fingerprint: {
          hash: anonymousFingerprintHash(baseUrl),
          user_agent: 'playwright-taxonomy-display-snapshots',
          locale: 'pt-BR',
        },
        metadata: {
          source: 'web_navigation_taxonomy_display_snapshots',
        },
      },
    },
  );
  expect(
    [200, 201],
    `Anonymous tenant identity bootstrap must succeed before API proof. Status ${response.status()}`,
  ).toContain(response.status());
  const payload = await response.json();
  anonymousIdentityToken = normalizeText(payload?.data?.token);
  expect(
    anonymousIdentityToken,
    'Anonymous tenant identity bootstrap must return data.token.',
  ).toBeTruthy();

  return anonymousIdentityToken;
}

function payloadRows(payload) {
  if (Array.isArray(payload?.data)) {
    return payload.data;
  }
  if (Array.isArray(payload?.items)) {
    return payload.items;
  }
  if (Array.isArray(payload)) {
    return payload;
  }
  return [];
}

function normalizeText(value) {
  return (value || '').toString().trim();
}

function normalizeList(value) {
  return Array.isArray(value) ? value : [];
}

function labelPattern(label) {
  const escaped = normalizeText(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}$`, 'i');
}

function requestContainsFilterValue(url, expectedValue) {
  const normalizedExpected = normalizeText(expectedValue).toLowerCase();
  if (!normalizedExpected) {
    return false;
  }

  const requestUrl = new URL(url);
  for (const [, value] of requestUrl.searchParams.entries()) {
    if (normalizeText(value).toLowerCase().includes(normalizedExpected)) {
      return true;
    }
  }
  return false;
}

function chooseMapCategory(categories) {
  const selected =
    normalizeList(categories).find(
      (category) => normalizeText(category?.query?.source).toLowerCase() === 'event',
    ) ??
    normalizeList(categories).find(
      (category) =>
        normalizeText(category?.label).length > 0 &&
        normalizeText(category?.key).length > 0,
    );
  expect(selected, 'Expected a runtime map filter category').toBeTruthy();
  return selected;
}

function findDisplaySnapshot(terms) {
  if (!Array.isArray(terms)) {
    return null;
  }
  for (const term of terms) {
    if (!term || typeof term !== 'object') {
      continue;
    }
    const value = normalizeText(term.value);
    const name = normalizeText(term.name);
    const label = normalizeText(term.label);
    const display = name || label;
    if (value && display && display !== value) {
      return {
        type: normalizeText(term.type),
        value,
        name,
        label,
        display,
        taxonomyName: normalizeText(term.taxonomy_name),
      };
    }
  }
  return null;
}

function taxonomySnapshotDebug(rows) {
  const samples = [];
  for (const row of rows) {
    const sources = [
      row?.taxonomy_terms,
      row?.venue?.taxonomy_terms,
      ...normalizeList(row?.linked_account_profiles).map(
        (profile) => profile?.taxonomy_terms,
      ),
      ...normalizeList(row?.artists).map((profile) => profile?.taxonomy_terms),
    ];
    for (const terms of sources) {
      if (!Array.isArray(terms)) {
        continue;
      }
      for (const term of terms) {
        if (!term || typeof term !== 'object') {
          continue;
        }
        samples.push({
          type: normalizeText(term.type),
          value: normalizeText(term.value),
          name: normalizeText(term.name),
          label: normalizeText(term.label),
          taxonomy_name: normalizeText(term.taxonomy_name),
        });
        if (samples.length >= 8) {
          return samples;
        }
      }
    }
  }
  return samples;
}

function findAccountProfileCandidate(rows) {
  for (const profile of rows) {
    const snapshot = findDisplaySnapshot(profile?.taxonomy_terms);
    const slug = normalizeText(profile?.slug);
    if (slug && snapshot) {
      return { profile, snapshot, slug };
    }
  }
  return null;
}

function findEventCandidate(rows) {
  for (const event of rows) {
    const snapshot = findDisplaySnapshotInProfiles([
      ...normalizeList(event?.linked_account_profiles),
      ...normalizeList(event?.artists),
    ]);
    const slug = normalizeText(event?.slug);
    if (slug && snapshot) {
      return { event, snapshot, slug };
    }
  }
  return null;
}

function findDisplaySnapshotInProfiles(profiles) {
  for (const profile of profiles) {
    const snapshot = findDisplaySnapshot(profile?.taxonomy_terms);
    if (snapshot) {
      return snapshot;
    }
  }
  return null;
}

async function assertVisibleDisplayLabel(page, display, rawValue, contextLabel) {
  const visibleText = page.getByText(display, { exact: false }).first();
  const escapedDisplay = display.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const semanticLabel = page
    .locator(`[aria-label*="${escapedDisplay}"]`)
    .first();

  await expect
    .poll(
      async () => {
        if ((await visibleText.count()) > 0 && (await visibleText.isVisible())) {
          return true;
        }
        return (await semanticLabel.count()) > 0 && (await semanticLabel.isVisible());
      },
      {
        message: `${contextLabel} must render display label "${display}" as visible text or Flutter semantics`,
        timeout: 30000,
      },
    )
    .toBe(true);
  await expect(
    page.getByText(rawValue, { exact: true }),
    `${contextLabel} must not render raw taxonomy slug "${rawValue}" as visible text`,
  ).toHaveCount(0);
  const escapedRawValue = rawValue.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  await expect(
    page.locator(`[aria-label="${escapedRawValue}"]`),
    `${contextLabel} must not expose raw taxonomy slug "${rawValue}" as standalone semantics`,
  ).toHaveCount(0);
}

test('@readonly taxonomy display snapshots render labels instead of slugs on public runtime routes', async ({
  page,
}) => {
  const baseUrl = requireTenantUrl();
  const collectors = installFailureCollectors(page);

  const accountProfilesPayload = await fetchPagedRows(
    page,
    '/api/v1/account_profiles',
    'Public account profiles list',
  );
  const accountCandidate = findAccountProfileCandidate(accountProfilesPayload.rows);
  expect(
    accountCandidate,
    'Seed/backfill at least one public account profile taxonomy snapshot where name/label differs from value. ' +
      `Pages scanned: ${JSON.stringify(accountProfilesPayload.pageSummaries)}. ` +
      `Snapshot samples: ${JSON.stringify(taxonomySnapshotDebug(accountProfilesPayload.rows))}`,
  ).toBeTruthy();

  const accountDetailPayload = await fetchJson(
    page,
    buildApiUrl(baseUrl, `/api/v1/account_profiles/${accountCandidate.slug}`),
    'Public account profile detail',
  );
  const accountDetail = accountDetailPayload?.data || accountDetailPayload;
  const accountDetailSnapshot = findDisplaySnapshot(accountDetail?.taxonomy_terms);
  expect(accountDetailSnapshot?.display).toBe(accountCandidate.snapshot.display);

  await page.goto(buildApiUrl(baseUrl, `/parceiro/${accountCandidate.slug}`), {
    waitUntil: 'domcontentloaded',
  });
  await assertAppBooted(page);
  await enableAccessibilityIfNeeded(page);
  await assertVisibleDisplayLabel(
    page,
    accountCandidate.snapshot.display,
    accountCandidate.snapshot.value,
    'Public account-profile detail route',
  );

  const eventsPayload = await fetchPagedRows(
    page,
    '/api/v1/events',
    'Public events list',
  );
  const eventCandidate = findEventCandidate(eventsPayload.rows);
  expect(
    eventCandidate,
    'Seed/backfill at least one public event or linked-profile taxonomy snapshot where name/label differs from value. ' +
      `Pages scanned: ${JSON.stringify(eventsPayload.pageSummaries)}. ` +
      `Snapshot samples: ${JSON.stringify(taxonomySnapshotDebug(eventsPayload.rows))}`,
  ).toBeTruthy();

  await page.goto(buildApiUrl(baseUrl, `/agenda/evento/${eventCandidate.slug}`), {
    waitUntil: 'domcontentloaded',
  });
  await assertAppBooted(page);
  await enableAccessibilityIfNeeded(page);
  await assertVisibleDisplayLabel(
    page,
    eventCandidate.snapshot.display,
    eventCandidate.snapshot.value,
    'Public event detail route',
  );

  const mapFiltersPayload = await fetchJson(
    page,
    buildApiUrl(baseUrl, '/api/v1/map/filters'),
    'Public map filter catalog',
  );
  const mapCategories = Array.isArray(mapFiltersPayload?.categories)
    ? mapFiltersPayload.categories
    : [];
  const mapFilterSnapshot = findDisplaySnapshot(mapFiltersPayload?.taxonomy_terms);
  expect(
    mapFilterSnapshot,
    'Seed/backfill at least one Map filter taxonomy snapshot where name/label differs from value. ' +
      `Map taxonomy terms: ${JSON.stringify(mapFiltersPayload?.taxonomy_terms ?? [])}`,
  ).toBeTruthy();
  expect(mapFilterSnapshot.label || mapFilterSnapshot.name).toBe(mapFilterSnapshot.display);
  expect(mapFilterSnapshot.display).not.toBe(mapFilterSnapshot.value);
  expect(
    mapCategories.length,
    'Public map filter catalog must expose primary categories for the current Map surface.',
  ).toBeGreaterThan(0);

  const mapCategory = chooseMapCategory(mapCategories);
  const expectedMapFilter = mapCategory.query?.source
    ? { name: 'source', value: mapCategory.query.source }
    : { name: 'category', value: mapCategory.key };

  await page.goto(buildApiUrl(baseUrl, '/mapa'), { waitUntil: 'domcontentloaded' });
  await assertAppBooted(page);
  await enableAccessibilityIfNeeded(page);
  await continueWithoutLocationIfPrompted(page);
  const filteredMapRequest = page.waitForRequest(
    (request) =>
      request.url().includes('/api/v1/map/pois') &&
      requestContainsFilterValue(request.url(), expectedMapFilter.value),
    { timeout: appBootTimeoutMs },
  );
  const mapFilterButton = page.getByRole('button', {
    name: labelPattern(mapCategory.label),
  });
  await expect(
    mapFilterButton.first(),
    `Map filter UI must expose the primary category label "${mapCategory.label}" as a selectable filter.`,
  ).toBeVisible({ timeout: appBootTimeoutMs });
  await mapFilterButton.first().click();
  const requestSample = await filteredMapRequest;
  expect(
    requestContainsFilterValue(requestSample.url(), expectedMapFilter.value),
    `Map filter request must carry backend query value ${expectedMapFilter.name}=${expectedMapFilter.value}: ${requestSample.url()}`,
  ).toBeTruthy();
  await assertVisibleDisplayLabel(
    page,
    mapCategory.label,
    mapCategory.key,
    'Map filter UI',
  );
  await expect(
    page.getByRole('button', { name: labelPattern(mapFilterSnapshot.display) }),
    `Map filter UI must not expose taxonomy subfilters as clickable buttons: ${mapFilterSnapshot.display}`,
  ).toHaveCount(0, { timeout: appBootTimeoutMs });

  await assertNoBrowserFailures(collectors);
});
