#!/usr/bin/env node

// This is intentionally a separate mutation-capable lifecycle step. The
// NAV-APD-AGENDA browser test only reads the exported fixture contract.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { requirePlaywrightTest } = require('./support/playwright_runtime');
const { request } = requirePlaywrightTest();
const { loginTenantAdmin } = require('./support/tenant_admin_auth');
const { cleanupOnboardedAccounts } = require('./support/account_onboarding_cleanup');
const { requireLiveMutationContract } = require('./support/live_navigation_mutation_contract');
const {
  buildAccountProfileAgendaFixtureFingerprint,
} = require('./support/account_profile_agenda_readonly_fixture_contract');

requireLiveMutationContract({
  scriptLabel: 'Account Profile Agenda readonly fixture bootstrap',
  allowedLanes: ['local'],
  requireRuntimeMutationFlag: true,
});

const timezoneId = 'America/Sao_Paulo';
const tenantUrl = (process.env.NAV_TENANT_URL || '').trim();
const action = (process.env.NAV_ACCOUNT_PROFILE_AGENDA_FIXTURE_ACTION || 'ensure')
  .toString()
  .trim()
  .toLowerCase();
const deployedSourceRevision = (
  process.env.NAV_ACCOUNT_PROFILE_AGENDA_DEPLOYED_SOURCE_REVISION || ''
).trim();
const runKey = sanitizeRunId(process.env.NAV_TEST_RUN_ID);

if (runKey === 'default') {
  throw new Error(
    'Account Profile Agenda fixture requires explicit NAV_TEST_RUN_ID; refusing an ambient fixture namespace.',
  );
}

if (action === 'ensure' && !deployedSourceRevision) {
  throw new Error(
    'Account Profile Agenda fixture requires NAV_ACCOUNT_PROFILE_AGENDA_DEPLOYED_SOURCE_REVISION so readonly evidence is tied to the deployed source.',
  );
}

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

function requireValue(value, message) {
  assert.ok(value?.toString().trim(), message);
  return value.toString().trim();
}

function buildUrl(baseUrl, pathName) {
  return new URL(pathName, baseUrl).toString();
}

function authHeaders(token) {
  return { Accept: 'application/json', Authorization: `Bearer ${token}` };
}

function stateFilePath() {
  const host = sanitizeRunId(new URL(tenantUrl).host);
  return path.join(os.tmpdir(), `belluga-apd-agenda-fixture-${host}-${runKey}.json`);
}

function envFilePath() {
  const explicit = (process.env.NAV_ACCOUNT_PROFILE_AGENDA_FIXTURE_ENV_FILE || '').trim();
  return explicit || path.join(os.tmpdir(), `belluga-apd-agenda-fixture-${runKey}.env`);
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(stateFilePath(), 'utf8'));
  } catch (_) {
    return {};
  }
}

function writeState(state) {
  fs.writeFileSync(stateFilePath(), `${JSON.stringify(state, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  fs.chmodSync(stateFilePath(), 0o600);
}

function clearFile(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (_) {
    // Missing stale state is already clean.
  }
}

function mergeState(patch) {
  writeState({ ...readState(), ...patch });
}

async function json(response, label, { allowStatuses = [] } = {}) {
  const status = response.status();
  const body = await response.json().catch(async () => ({ raw: await response.text() }));
  assert.ok(
    allowStatuses.includes(status) || (status >= 200 && status < 300),
    `${label} failed with HTTP ${status}: ${JSON.stringify(body)}`,
  );
  return body;
}

async function deleteEvent(api, baseUrl, token, eventId) {
  if (!eventId) return;
  const response = await api.delete(buildUrl(baseUrl, `/admin/api/v1/events/${eventId}`), {
    headers: authHeaders(token),
    failOnStatusCode: false,
  });
  await json(response, `Delete owned Agenda fixture event ${eventId}`, { allowStatuses: [404] });
}

async function forceDeleteProfile(api, baseUrl, token, profileId) {
  if (!profileId) return;
  const response = await api.post(
    buildUrl(baseUrl, `/admin/api/v1/account_profiles/${encodeURIComponent(profileId)}/force_delete`),
    { headers: authHeaders(token), failOnStatusCode: false },
  );
  await json(response, `Force-delete owned Agenda fixture profile ${profileId}`, { allowStatuses: [404] });
}

async function deleteRegistryRow(api, baseUrl, token, pathName, label) {
  if (!pathName) return;
  const response = await api.delete(buildUrl(baseUrl, pathName), {
    headers: authHeaders(token),
    failOnStatusCode: false,
  });
  await json(response, label, { allowStatuses: [404] });
}

async function cleanup(api, baseUrl, token) {
  const state = readState();
  if (Object.keys(state).length > 0) {
    assert.equal(
      state.runKey,
      runKey,
      'Refusing cleanup: persisted Agenda fixture state belongs to a different run namespace.',
    );
    assert.equal(
      state.tenantUrl,
      baseUrl,
      'Refusing cleanup: persisted Agenda fixture state belongs to a different tenant URL.',
    );
  }
  for (const eventId of state.eventIds || []) {
    await deleteEvent(api, baseUrl, token, eventId);
  }
  if (state.accountSlug) {
    await cleanupOnboardedAccounts(api, baseUrl, token, [state.accountSlug], {
      strict: false,
    });
  }
  await forceDeleteProfile(api, baseUrl, token, state.profileId);
  await deleteRegistryRow(
    api,
    baseUrl,
    token,
    state.eventTypeId ? `/admin/api/v1/event_types/${state.eventTypeId}` : '',
    'Delete owned Agenda fixture event type',
  );
  await deleteRegistryRow(
    api,
    baseUrl,
    token,
    state.profileType ? `/admin/api/v1/account_profile_types/${encodeURIComponent(state.profileType)}` : '',
    'Delete owned Agenda fixture account profile type',
  );
  clearFile(stateFilePath());
  clearFile(envFilePath());
}

function fixtureNames() {
  return {
    profileType: `stage-validation-agenda-profile-${runKey}`,
    profileTypeLabel: `Stage Validation Agenda Profile ${runKey}`,
    profileName: `Stage Validation Agenda Profile ${runKey}`,
    profileSlug: `stage-validation-agenda-profile-${runKey}`,
    eventTypeSlug: `stage_validation_agenda_event_${runKey}`,
    eventTypeName: `Stage Validation Agenda Event ${runKey}`,
  };
}

async function createProfileType(api, baseUrl, token, names) {
  const response = await api.post(buildUrl(baseUrl, '/admin/api/v1/account_profile_types'), {
    headers: authHeaders(token),
    data: {
      type: names.profileType,
      label: names.profileTypeLabel,
      labels: { singular: names.profileTypeLabel, plural: `${names.profileTypeLabel}s` },
      allowed_taxonomies: [],
      capabilities: {
        is_favoritable: false,
        is_publicly_discoverable: true,
        is_poi_enabled: true,
        is_reference_location_enabled: true,
        has_taxonomies: false,
        has_bio: false,
        has_content: false,
        has_avatar: false,
        has_cover: false,
        has_events: true,
      },
      visual: { mode: 'icon', icon: 'place', color: '#0F766E', icon_color: '#FFFFFF' },
    },
  });
  await json(response, `Create Agenda fixture profile type ${names.profileType}`);
  mergeState({ profileType: names.profileType });
}

async function createProfile(api, baseUrl, token, names) {
  const response = await api.post(buildUrl(baseUrl, '/admin/api/v1/account_onboardings'), {
    headers: authHeaders(token),
    data: {
      name: names.profileName,
      ownership_state: 'unmanaged',
      profile_type: names.profileType,
      location: { lat: -20.671339, lng: -40.495395 },
    },
  });
  const payload = await json(response, `Create Agenda fixture profile ${names.profileSlug}`);
  const profileId = requireValue(payload?.data?.account_profile?.id, 'Agenda fixture profile must return account_profile.id.');
  const accountSlug = requireValue(payload?.data?.account?.slug, 'Agenda fixture profile must return account.slug.');
  const profileSlug = requireValue(
    payload?.data?.account_profile?.slug || payload?.data?.account?.slug,
    'Agenda fixture profile must return a public slug.',
  );
  assert.ok(
    profileSlug === names.profileSlug || profileSlug.startsWith(`${names.profileSlug}-`),
    `Agenda fixture profile slug must be run-owned. Received ${profileSlug}.`,
  );
  mergeState({ profileId, accountSlug, profileSlug });
  const publish = await api.patch(buildUrl(baseUrl, `/admin/api/v1/accounts/${accountSlug}`), {
    headers: authHeaders(token),
    data: { publication: { status: 'published' } },
  });
  const published = await json(publish, `Publish Agenda fixture account ${accountSlug}`);
  assert.equal(published?.data?.publication?.status, 'published', 'Agenda fixture profile account must be public.');
  return { profileId, profileSlug };
}

async function createEventType(api, baseUrl, token, names) {
  const response = await api.post(buildUrl(baseUrl, '/admin/api/v1/event_types'), {
    headers: authHeaders(token),
    data: {
      name: names.eventTypeName,
      slug: names.eventTypeSlug,
      description: 'Run-owned Account Profile Agenda readonly fixture type.',
      allowed_taxonomies: [],
      visual: { mode: 'icon', icon: 'event', color: '#7C3AED', icon_color: '#FFFFFF' },
    },
  });
  const payload = await json(response, `Create Agenda fixture event type ${names.eventTypeSlug}`);
  const id = requireValue(payload?.data?.id, 'Agenda fixture event type must return id.');
  mergeState({ eventTypeId: id });
  return { id, name: payload?.data?.name || names.eventTypeName, slug: payload?.data?.slug || names.eventTypeSlug };
}

function futureWindows() {
  const localParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezoneId,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).reduce((accumulator, part) => {
    if (part.type !== 'literal') accumulator[part.type] = Number(part.value);
    return accumulator;
  }, {});
  // Sao Paulo is UTC-03:00 without DST. Keep dates well in the future and
  // use 10:00/14:00 local so the grouping proof cannot sit on midnight.
  const firstUtc = Date.UTC(localParts.year, localParts.month - 1, localParts.day + 2, 13, 0, 0);
  return [
    new Date(firstUtc),
    new Date(firstUtc + 4 * 60 * 60 * 1000),
    new Date(firstUtc + 24 * 60 * 60 * 1000),
  ].map((start) => ({ start, end: new Date(start.getTime() + 90 * 60 * 1000) }));
}

function dateLabel(date) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezoneId,
    weekday: 'long', month: 'long', day: 'numeric',
  }).format(date).toUpperCase();
}

async function createEvent(api, baseUrl, token, { eventType, profileId, title, window }) {
  const response = await api.post(buildUrl(baseUrl, '/admin/api/v1/events'), {
    headers: authHeaders(token),
    data: {
      title,
      content: '<p>Run-owned Account Profile Agenda readonly fixture.</p>',
      type: eventType,
      location: { mode: 'physical' },
      place_ref: { type: 'account_profile', id: profileId },
      occurrences: [{ date_time_start: window.start.toISOString(), date_time_end: window.end.toISOString() }],
      publication: { status: 'published', publish_at: new Date(Date.now() - 60 * 1000).toISOString() },
    },
  });
  const payload = await json(response, `Create Agenda fixture event ${title}`);
  const eventId = requireValue(payload?.data?.event_id, `Agenda fixture event ${title} must return event_id.`);
  const eventSlug = requireValue(payload?.data?.slug, `Agenda fixture event ${title} must return slug.`);
  const occurrenceId = requireValue(payload?.data?.occurrences?.[0]?.occurrence_id, `Agenda fixture event ${title} must return occurrence_id.`);
  const state = readState();
  mergeState({ eventIds: [...new Set([...(state.eventIds || []), eventId])] });
  return { eventId, eventSlug, occurrenceId, title, start: window.start };
}

async function resolveAnonymousToken(api, baseUrl) {
  const response = await api.post(buildUrl(baseUrl, '/api/v1/anonymous/identities'), {
    headers: { Accept: 'application/json' },
    data: {
      device_name: 'account-profile-agenda-readonly-fixture',
      fingerprint: {
        hash: buildAccountProfileAgendaFixtureFingerprint({ baseUrl, runKey }),
        user_agent: 'apd-agenda-fixture',
        locale: 'pt-BR',
      },
      metadata: { source: 'account_profile_agenda_readonly_fixture' },
    },
  });
  const payload = await json(response, 'Create anonymous identity for Agenda fixture verification');
  return requireValue(payload?.data?.token, 'Agenda fixture anonymous identity must return a token.');
}

async function verifyFixture(api, baseUrl, profileSlug, events) {
  const token = await resolveAnonymousToken(api, baseUrl);
  let payload = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await api.get(buildUrl(baseUrl, `/api/v1/account_profiles/${profileSlug}`), {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      failOnStatusCode: false,
    });
    if (response.status() === 200) {
      payload = await response.json();
      const rows = payload?.data?.agenda_occurrences || payload?.agenda_occurrences || [];
      const ids = new Set(rows.map((row) => row?.occurrence_id?.toString()));
      if (events.every((event) => ids.has(event.occurrenceId))) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const rows = payload?.data?.agenda_occurrences || payload?.agenda_occurrences || [];
  const ids = new Set(rows.map((row) => row?.occurrence_id?.toString()));
  assert.ok(events.every((event) => ids.has(event.occurrenceId)), 'Public Account Profile Agenda payload must contain every run-owned occurrence before exporting readonly fixture variables.');
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function writeEnvironment(profileSlug, events) {
  const eventTitles = events.map((event) => event.title);
  const occurrenceIds = events.map((event) => event.occurrenceId);
  const dateLabels = [...new Set(events.map((event) => dateLabel(event.start)))];
  assert.equal(dateLabels.length, 2, 'Agenda fixture must prove exactly two local date sections.');
  const values = {
    NAV_ACCOUNT_PROFILE_AGENDA_READONLY_FIXTURE: '1',
    NAV_ACCOUNT_PROFILE_AGENDA_PROFILE_SLUG: profileSlug,
    NAV_ACCOUNT_PROFILE_AGENDA_OCCURRENCE_IDS: JSON.stringify(occurrenceIds),
    NAV_ACCOUNT_PROFILE_AGENDA_EVENT_TITLES: JSON.stringify(eventTitles),
    NAV_ACCOUNT_PROFILE_AGENDA_DATE_LABELS: JSON.stringify(dateLabels),
    NAV_ACCOUNT_PROFILE_AGENDA_TIMEZONE: timezoneId,
    NAV_ACCOUNT_PROFILE_AGENDA_NAVIGATION_EVENT_SLUG: events[0].eventSlug,
    NAV_ACCOUNT_PROFILE_AGENDA_NAVIGATION_OCCURRENCE_ID: events[0].occurrenceId,
    NAV_ACCOUNT_PROFILE_AGENDA_FIXTURE_SOURCE_REVISION: deployedSourceRevision,
    NAV_ACCOUNT_PROFILE_AGENDA_DEPLOYED_SOURCE_REVISION: deployedSourceRevision,
  };
  const source = `${Object.entries(values).map(([key, value]) => `export ${key}=${shellQuote(value)}`).join('\n')}\n`;
  fs.writeFileSync(envFilePath(), source, { encoding: 'utf8', mode: 0o600 });
  fs.chmodSync(envFilePath(), 0o600);
  return envFilePath();
}

async function main() {
  requireValue(tenantUrl, 'Missing NAV_TENANT_URL. Agenda fixture requires a live local tenant URL.');
  const api = await request.newContext({ baseURL: tenantUrl, extraHTTPHeaders: { Accept: 'application/json' }, ignoreHTTPSErrors: true });
  try {
    const session = await loginTenantAdmin({ api, baseUrl: tenantUrl, buildUrl, deviceName: 'account-profile-agenda-readonly-fixture' });
    if (action === 'cleanup') {
      await cleanup(api, tenantUrl, session.token);
      console.error(`INFO: cleaned Account Profile Agenda readonly fixture for ${runKey}.`);
      return;
    }
    assert.equal(action, 'ensure', `Unsupported NAV_ACCOUNT_PROFILE_AGENDA_FIXTURE_ACTION "${action}". Expected ensure or cleanup.`);
    await cleanup(api, tenantUrl, session.token);
    mergeState({ runKey, tenantUrl });
    const names = fixtureNames();
    await createProfileType(api, tenantUrl, session.token, names);
    const profile = await createProfile(api, tenantUrl, session.token, names);
    const eventType = await createEventType(api, tenantUrl, session.token, names);
    const windows = futureWindows();
    const events = [];
    for (const [index, window] of windows.entries()) {
      events.push(await createEvent(api, tenantUrl, session.token, {
        eventType,
        profileId: profile.profileId,
        title: `Stage Validation Agenda ${runKey} ${index + 1}`,
        window,
      }));
    }
    await verifyFixture(api, tenantUrl, profile.profileSlug, events);
    const output = writeEnvironment(profile.profileSlug, events);
    console.error(`INFO: ensured Account Profile Agenda readonly fixture for ${runKey}; source ${output}.`);
  } finally {
    await api.dispose();
  }
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
