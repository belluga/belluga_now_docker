function sanitizeRunId(raw) {
  return (raw || 'default')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/^-+|-+$/g, '') || 'default';
}

const managedFixtureEnabled =
  (process.env.NAV_PUBLIC_TAXONOMY_MANAGED_FIXTURE || '').toString().trim() === '1';
const deployLane = (process.env.NAV_DEPLOY_LANE || '').toString().trim().toLowerCase();
const requiresExplicitRunId =
  managedFixtureEnabled || deployLane === 'dev' || deployLane === 'stage';
const runKey = sanitizeRunId(process.env.NAV_TEST_RUN_ID);
const isPlaywrightListProbe = process.argv.includes('--list');
if (requiresExplicitRunId && runKey === 'default' && !isPlaywrightListProbe) {
  throw new Error(
    'Managed public taxonomy fixtures on dev/stage require explicit NAV_TEST_RUN_ID; the default run key is forbidden.',
  );
}

const fixture = {
  taxonomySlug: `stage_validation_profile_style_${runKey}`,
  taxonomyName: `Stage Validation Profile Style ${runKey}`,
  taxonomyTermSlug: `golden_hour_${runKey}`,
  taxonomyTermLabel: `Golden Hour ${runKey}`,
  profileType: `stage-validation-public-profile-${runKey}`,
  profileTypeLabel: `Stage Validation Public Profile ${runKey}`,
  profileName: `Stage Validation Public Profile ${runKey}`,
  profileSlug: `stage-validation-public-profile-${runKey}`,
  relatedProfileName: `Stage Validation Related Profile ${runKey}`,
  relatedProfileSlug: `stage-validation-related-profile-${runKey}`,
  eventTypeSlug: `stage_validation_public_event_type_${runKey}`,
  eventTypeName: `Stage Validation Public Event Type ${runKey}`,
  eventTitle: `Stage Validation Public Event ${runKey}`,
  eventSlug: `stage-validation-public-event-${runKey}`,
  location: {
    lat: -20.671339,
    lng: -40.495395,
  },
};

function paginationLastPage(payload) {
  const rawValue = payload?.last_page ?? null;
  const value = Number(rawValue);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function paginationNextPageUrl(payload) {
  const value = payload?.next_page_url ?? null;
  const text = value?.toString().trim();
  return text || null;
}

function rowFingerprint(row) {
  return JSON.stringify({
    id: row?.id ?? null,
    eventId: row?.event_id ?? null,
    slug: row?.slug ?? null,
    type: row?.type ?? null,
    profileType: row?.profile_type ?? null,
    title: row?.title ?? null,
  });
}

function shouldContinuePagedFetch({ payload, pageRows, pageNumber, pageSize }) {
  const lastPage = paginationLastPage(payload);
  if (lastPage != null) {
    return pageNumber < lastPage;
  }

  if (typeof payload?.has_more === 'boolean') {
    return payload.has_more;
  }

  const nextPageUrl = paginationNextPageUrl(payload);
  if (nextPageUrl) {
    return true;
  }

  if (Array.isArray(pageRows) && pageRows.length >= pageSize) {
    throw new Error(
      `Canonical pagination metadata is missing on a full page (${pageNumber}) for the managed public taxonomy fixture contract.`,
    );
  }

  return false;
}

function withManagedFixtureRunKeyScope(seed) {
  const normalizedSeed = seed?.toString().trim();
  if (!normalizedSeed) {
    throw new Error('Managed public taxonomy fixture fingerprint seed requires a non-empty value.');
  }

  if (!managedFixtureEnabled) {
    return normalizedSeed;
  }

  return `${normalizedSeed}:${runKey}`;
}

function matchesCanonicalManagedSlug(actualSlug, canonicalSlug) {
  const actual = actualSlug?.toString().trim();
  const canonical = canonicalSlug?.toString().trim();
  if (!actual || !canonical) {
    return false;
  }

  return actual === canonical || actual.startsWith(`${canonical}-`);
}

function filterOwnedEventRows(rows) {
  return rows.filter((row) => {
    const slug = row?.slug?.toString().trim();
    return matchesCanonicalManagedSlug(slug, fixture.eventSlug);
  });
}

function filterOwnedProfileRows(rows) {
  return rows.filter((row) => {
    const slug = row?.slug?.toString().trim();
    return matchesCanonicalManagedSlug(slug, fixture.profileSlug)
      || matchesCanonicalManagedSlug(slug, fixture.relatedProfileSlug);
  });
}

module.exports = {
  fixture,
  filterOwnedEventRows,
  filterOwnedProfileRows,
  managedFixtureEnabled,
  matchesCanonicalManagedSlug,
  requiresExplicitRunId,
  paginationLastPage,
  paginationNextPageUrl,
  rowFingerprint,
  runKey,
  sanitizeRunId,
  shouldContinuePagedFetch,
  withManagedFixtureRunKeyScope,
};
