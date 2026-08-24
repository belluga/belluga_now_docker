function requiredText(name) {
  const value = process.env[name]?.toString().trim() || '';
  if (!value) {
    throw new Error(
      `Missing ${name}. The Account Profile Agenda readonly fixture must be supplied by the managed runtime.`,
    );
  }
  return value;
}

function requiredJsonArray(name, { minimumLength = 1 } = {}) {
  const raw = requiredText(name);
  let value;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `${name} must be a JSON array: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!Array.isArray(value) || value.length < minimumLength) {
    throw new Error(
      `${name} must be a JSON array with at least ${minimumLength} item(s).`,
    );
  }
  const normalized = value.map((entry) => entry?.toString().trim() || '');
  if (normalized.some((entry) => !entry)) {
    throw new Error(`${name} must not contain blank values.`);
  }
  return Object.freeze(normalized);
}

function loadAccountProfileAgendaReadonlyFixture() {
  if ((process.env.NAV_ACCOUNT_PROFILE_AGENDA_READONLY_FIXTURE || '').trim() !== '1') {
    throw new Error(
      'NAV_ACCOUNT_PROFILE_AGENDA_READONLY_FIXTURE=1 is required; the browser proof never falls back to an arbitrary public profile.',
    );
  }

  const occurrenceIds = requiredJsonArray(
    'NAV_ACCOUNT_PROFILE_AGENDA_OCCURRENCE_IDS',
    { minimumLength: 2 },
  );
  const eventTitles = requiredJsonArray(
    'NAV_ACCOUNT_PROFILE_AGENDA_EVENT_TITLES',
    { minimumLength: occurrenceIds.length },
  );
  const dateLabels = requiredJsonArray(
    'NAV_ACCOUNT_PROFILE_AGENDA_DATE_LABELS',
    { minimumLength: 2 },
  );
  if (eventTitles.length !== occurrenceIds.length) {
    throw new Error(
      'NAV_ACCOUNT_PROFILE_AGENDA_EVENT_TITLES must align one-to-one with occurrence ids.',
    );
  }

  const fixture = {
    profileSlug: requiredText('NAV_ACCOUNT_PROFILE_AGENDA_PROFILE_SLUG'),
    occurrenceIds,
    eventTitles,
    dateLabels,
    timezoneId: requiredText('NAV_ACCOUNT_PROFILE_AGENDA_TIMEZONE'),
    navigationEventSlug: requiredText(
      'NAV_ACCOUNT_PROFILE_AGENDA_NAVIGATION_EVENT_SLUG',
    ),
    navigationOccurrenceId: requiredText(
      'NAV_ACCOUNT_PROFILE_AGENDA_NAVIGATION_OCCURRENCE_ID',
    ),
    sourceRevision: requiredText(
      'NAV_ACCOUNT_PROFILE_AGENDA_FIXTURE_SOURCE_REVISION',
    ),
  };

  if (fixture.timezoneId !== 'America/Sao_Paulo') {
    throw new Error(
      `NAV_ACCOUNT_PROFILE_AGENDA_TIMEZONE must be America/Sao_Paulo, received ${fixture.timezoneId}.`,
    );
  }
  if (!fixture.occurrenceIds.includes(fixture.navigationOccurrenceId)) {
    throw new Error(
      'NAV_ACCOUNT_PROFILE_AGENDA_NAVIGATION_OCCURRENCE_ID must be one of the declared occurrence ids.',
    );
  }

  const deployedRevision =
    process.env.NAV_ACCOUNT_PROFILE_AGENDA_DEPLOYED_SOURCE_REVISION?.toString().trim();
  if (deployedRevision && deployedRevision !== fixture.sourceRevision) {
    throw new Error(
      `Managed Account Profile Agenda fixture revision ${fixture.sourceRevision} does not match deployed source revision ${deployedRevision}.`,
    );
  }

  return Object.freeze(fixture);
}

module.exports = {
  loadAccountProfileAgendaReadonlyFixture,
};
