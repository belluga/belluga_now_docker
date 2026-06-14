function textValue(...values) {
  for (const value of values) {
    const text = value?.toString().trim();
    if (text) {
      return text;
    }
  }
  return '';
}

function profileTypeValue(row) {
  return textValue(row?.profile_type, row?.type);
}

function agendaOccurrences(row) {
  return Array.isArray(row?.agenda_occurrences) ? row.agenda_occurrences : [];
}

function locationPayload(row) {
  return row?.location || row?.poi || row?.map_poi || null;
}

function hasNestedProfileGroups(row) {
  const groups = Array.isArray(row?.nested_profile_groups)
    ? row.nested_profile_groups
    : [];
  return groups.length > 0;
}

function isMinimalNoSections(row) {
  const about = textValue(row?.bio, row?.content, row?.description);
  return !about
    && agendaOccurrences(row).length === 0
    && locationPayload(row) == null
    && !hasNestedProfileGroups(row);
}

function buildFavoritableProfileTypes(profileTypes) {
  const favoritableTypes = new Set();
  const rows = Array.isArray(profileTypes) ? profileTypes : [];

  for (const row of rows) {
    const type = profileTypeValue(row);
    if (!type) {
      continue;
    }
    if (row?.capabilities?.is_favoritable === true) {
      favoritableTypes.add(type);
    }
  }

  return favoritableTypes;
}

function isFavoritableProfile(profile, favoritableTypes) {
  const type = profileTypeValue(profile);
  return Boolean(type) && favoritableTypes.has(type);
}

async function selectMinimalEmptyStateCandidate(rows, hydrate, favoritableTypes) {
  let genericCandidate = null;

  for (const row of rows) {
    const hydrated = await hydrate(row);
    if (!isMinimalNoSections(hydrated)) {
      continue;
    }

    if (isFavoritableProfile(hydrated, favoritableTypes)) {
      return {
        profile: hydrated,
        variant: 'favorite-empty-state',
      };
    }

    if (!genericCandidate) {
      genericCandidate = hydrated;
    }
  }

  if (!genericCandidate) {
    return null;
  }

  return {
    profile: genericCandidate,
    variant: 'generic-empty-state',
  };
}

function buildMinimalEmptyStateExpectation(candidate) {
  if (!candidate?.profile) {
    return null;
  }

  const profileName = textValue(
    candidate.profile?.display_name,
    candidate.profile?.name,
  );
  const favoriteHeading = profileName
    ? `Favorite para ser avisado das novidades sobre ${profileName}.`
    : null;

  if (candidate.variant === 'favorite-empty-state') {
    return {
      visibleLabel: favoriteHeading,
      hiddenLabel: 'Mais sobre este perfil',
      assertionLabel: 'Account Profile favorite empty state',
    };
  }

  return {
    visibleLabel: 'Mais sobre este perfil',
    hiddenLabel: favoriteHeading,
    assertionLabel: 'Account Profile generic empty state',
  };
}

module.exports = {
  agendaOccurrences,
  buildFavoritableProfileTypes,
  buildMinimalEmptyStateExpectation,
  isMinimalNoSections,
  locationPayload,
  selectMinimalEmptyStateCandidate,
};
