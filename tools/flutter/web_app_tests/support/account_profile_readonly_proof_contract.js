'use strict';

function textValue(...values) {
  for (const value of values) {
    const text = value?.toString().trim();
    if (text) {
      return text;
    }
  }
  return '';
}

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function escapedPatternValue(value) {
  return stringValue(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function exactAccountProfileNamePattern(name) {
  return new RegExp(`^${escapedPatternValue(name)}$`);
}

function accountProfileSemanticHeroPattern(name) {
  const escaped = escapedPatternValue(name);
  if (!escaped) {
    throw new Error('Account Profile semantic hero requires a non-empty name.');
  }
  return new RegExp(`^${escaped}(?:\\s|$)`);
}

function canonicalPublicVisibleName(
  row,
  { allowSentinel = false } = {},
) {
  const displayName = stringValue(row?.display_name);
  const codePointLength = [...displayName].length;
  if (codePointLength >= 3 && codePointLength <= 255) {
    return displayName;
  }
  return allowSentinel ? 'Perfil indisponível' : '';
}

function selectDeterministicPublicProfileRow(rows) {
  if (!Array.isArray(rows)) {
    return null;
  }

  return rows
    .filter((row) => stringValue(row?.slug) && canonicalPublicVisibleName(row))
    .reduce((selected, row) => {
      if (!selected) {
        return row;
      }
      return stringValue(row.slug).localeCompare(stringValue(selected.slug)) < 0
        ? row
        : selected;
    }, null);
}

async function resolveAccountProfileProofSubject(rows, hydrate) {
  const selected = selectDeterministicPublicProfileRow(rows);
  if (!selected) {
    throw new Error(
      'Account Profile readonly proof requires a public profile with a visible name and slug.',
    );
  }
  if (typeof hydrate !== 'function') {
    throw new Error('Account Profile readonly proof requires a hydration function.');
  }

  const hydrated = await hydrate(selected);
  return validateAccountProfileDetailPayload(hydrated, stringValue(selected.slug));
}

function rectangleIntersectsViewport(
  rectangle,
  viewport,
  { maxYRatio = 1 } = {},
) {
  if (!rectangle || !viewport) {
    return false;
  }
  return rectangle.width > 0
    && rectangle.height > 0
    && rectangle.x < viewport.width
    && rectangle.y < viewport.height * maxYRatio
    && rectangle.x + rectangle.width > 0
    && rectangle.y + rectangle.height > 0;
}

function validateAccountProfileDetailPayload(payload, expectedSlug) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Account Profile detail payload must be an object.');
  }

  if (typeof payload.slug !== 'string') {
    throw new Error('Account Profile detail payload slug must be a string.');
  }
  const slug = stringValue(payload.slug);
  if (!slug) {
    throw new Error('Account Profile detail payload must expose a slug.');
  }
  if (expectedSlug && slug !== expectedSlug) {
    throw new Error(
      `Account Profile detail payload slug mismatch: expected ${expectedSlug}, received ${slug}.`,
    );
  }
  if (typeof payload.display_name !== 'string') {
    throw new Error(
      'Account Profile detail payload display_name must be a string.',
    );
  }
  if (!canonicalPublicVisibleName(payload)) {
    throw new Error(
      'Account Profile detail payload display_name must contain 3..255 Unicode code points.',
    );
  }

  return payload;
}

function accountProfileBrowserHeroOracle(expectedSlug, browserDetailPayload) {
  const validated = validateAccountProfileDetailPayload(
    browserDetailPayload,
    expectedSlug,
  );
  return canonicalPublicVisibleName(validated);
}

function hasCriticalBrowserFailures(summary) {
  return Object.values(summary || {}).some(
    (entries) => Array.isArray(entries) && entries.length > 0,
  );
}

function evaluateAccountProfileHydrationWait({
  response = null,
  waitError = null,
  criticalBrowserFailures = {},
} = {}) {
  if (hasCriticalBrowserFailures(criticalBrowserFailures)) {
    throw new Error(
      `Profile detail browser request failed: ${JSON.stringify(criticalBrowserFailures)}.`,
    );
  }
  if (waitError) {
    throw waitError;
  }
  return response !== null;
}

async function readAccountProfileDetailResponse(response, expectedSlug) {
  if (!response || typeof response.status !== 'function') {
    throw new Error('Profile detail API response must be available.');
  }

  const status = response.status();
  if (status >= 400) {
    throw new Error(`Profile detail API must load successfully; received ${status}.`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error(
      `Profile detail hydration returned a non-JSON payload for ${expectedSlug}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const normalized = payload
    && typeof payload === 'object'
    && Object.prototype.hasOwnProperty.call(payload, 'data')
    ? payload.data
    : payload;
  return validateAccountProfileDetailPayload(normalized, expectedSlug);
}

function classifyAccountProfileProofObservation({
  heroVisible = false,
  terminalErrorText = '',
  criticalBrowserFailures = {},
} = {}) {
  const terminal = textValue(terminalErrorText);
  if (terminal) {
    return { state: 'failure', reason: `terminal UI error: ${terminal}` };
  }
  if (hasCriticalBrowserFailures(criticalBrowserFailures)) {
    return { state: 'failure', reason: 'critical browser failure' };
  }
  return heroVisible
    ? { state: 'success' }
    : { state: 'pending' };
}

module.exports = {
  accountProfileBrowserHeroOracle,
  accountProfileSemanticHeroPattern,
  canonicalPublicVisibleName,
  classifyAccountProfileProofObservation,
  exactAccountProfileNamePattern,
  evaluateAccountProfileHydrationWait,
  readAccountProfileDetailResponse,
  rectangleIntersectsViewport,
  resolveAccountProfileProofSubject,
  selectDeterministicPublicProfileRow,
  validateAccountProfileDetailPayload,
};
