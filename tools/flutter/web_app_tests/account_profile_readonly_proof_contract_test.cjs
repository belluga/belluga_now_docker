#!/usr/bin/env node

'use strict';

const assert = require('assert');
const {
  accountProfileBrowserHeroOracle,
  canonicalPublicVisibleName,
  classifyAccountProfileProofObservation,
  exactAccountProfileNamePattern,
  evaluateAccountProfileHydrationWait,
  readAccountProfileDetailResponse,
  rectangleIntersectsViewport,
  resolveAccountProfileProofSubject,
  selectDeterministicPublicProfileRow,
  validateAccountProfileDetailPayload,
} = require('./support/account_profile_readonly_proof_contract');

const taxonomyFree = { slug: 'zeta-place', display_name: 'Zeta Place' };
const generic = { slug: 'alpha-place', display_name: 'Alpha Place' };

assert.strictEqual(
  selectDeterministicPublicProfileRow([taxonomyFree, generic]),
  generic,
  'selection must be deterministic without requiring taxonomy or optional sections',
);
assert.strictEqual(selectDeterministicPublicProfileRow([]), null);
assert.strictEqual(selectDeterministicPublicProfileRow(null), null);
assert.strictEqual(
  selectDeterministicPublicProfileRow([{ display_name: 'Missing slug' }, null]),
  null,
);
assert.strictEqual(
  selectDeterministicPublicProfileRow([{ slug: 'missing-name' }]),
  null,
);
for (const invalidIdentity of [123, true, ['profile'], { toString: () => 'profile' }]) {
  assert.strictEqual(
    selectDeterministicPublicProfileRow([
      { slug: invalidIdentity, display_name: 'Valid Name' },
      { slug: 'valid-slug', display_name: invalidIdentity },
    ]),
    null,
    'catalog selection must reject non-string identity fields',
  );
}
assert.strictEqual(canonicalPublicVisibleName({ slug: 'slug-only' }), '');
assert.strictEqual(canonicalPublicVisibleName({ display_name: '  AG  ' }), '');
assert.strictEqual(canonicalPublicVisibleName({ display_name: '  AGLA  ' }), 'AGLA');
assert.strictEqual(exactAccountProfileNamePattern('AGLA').test('AGLA'), true);
assert.strictEqual(
  exactAccountProfileNamePattern('AGLA').test('Agla'),
  false,
  'canonical hero matching must preserve display-name case',
);
assert.strictEqual(
  rectangleIntersectsViewport(
    { x: 10, y: 10, width: 100, height: 40 },
    { width: 390, height: 844 },
  ),
  true,
);
assert.strictEqual(
  rectangleIntersectsViewport(
    { x: 10, y: -100, width: 100, height: 40 },
    { width: 390, height: 844 },
  ),
  false,
  'an off-screen original hero must not prove post-scroll readability',
);
assert.strictEqual(
  rectangleIntersectsViewport(
    { x: 10, y: 500, width: 100, height: 40 },
    { width: 390, height: 844 },
    { maxYRatio: 0.3 },
  ),
  false,
  'content below the sticky-title region must not prove post-scroll readability',
);

assert.strictEqual(
  validateAccountProfileDetailPayload(generic, generic.slug),
  generic,
);
assert.throws(
  () => validateAccountProfileDetailPayload(null, generic.slug),
  /must be an object/,
);
assert.throws(
  () => validateAccountProfileDetailPayload({ display_name: 'Missing slug' }),
  /slug must be a string/,
);
assert.throws(
  () => validateAccountProfileDetailPayload(generic, 'different-slug'),
  /slug mismatch/,
);
for (const displayName of ['   ', 'AB', 'x'.repeat(256)]) {
  assert.throws(
    () => validateAccountProfileDetailPayload({ slug: 'invalid-name', display_name: displayName }),
    /display_name must contain 3\.\.255 Unicode code points/,
  );
}
for (const invalidIdentity of [123, true, ['profile'], { toString: () => 'profile' }]) {
  assert.throws(
    () => validateAccountProfileDetailPayload({
      slug: invalidIdentity,
      display_name: 'Valid Name',
    }),
    /slug must be a string/,
  );
  assert.throws(
    () => validateAccountProfileDetailPayload({
      slug: 'valid-slug',
      display_name: invalidIdentity,
    }),
    /display_name must be a string/,
  );
  assert.throws(
    () => accountProfileBrowserHeroOracle('valid-slug', {
      slug: 'valid-slug',
      display_name: invalidIdentity,
    }),
    /display_name must be a string/,
    'browser hero oracle must reject non-string display names',
  );
}

assert.deepStrictEqual(
  classifyAccountProfileProofObservation({ heroVisible: false }),
  { state: 'pending' },
);
assert.deepStrictEqual(
  classifyAccountProfileProofObservation({ heroVisible: true }),
  { state: 'success' },
);
assert.deepStrictEqual(
  classifyAccountProfileProofObservation({
    heroVisible: true,
    terminalErrorText: 'Não foi possível abrir o perfil',
  }),
  {
    state: 'failure',
    reason: 'terminal UI error: Não foi possível abrir o perfil',
  },
  'terminal UI failure must win even when stale hero text remains visible',
);
assert.deepStrictEqual(
  classifyAccountProfileProofObservation({
    heroVisible: true,
    criticalBrowserFailures: {
      criticalHttpResponses: ['GET /api/v1/account_profiles/example (500)'],
    },
  }),
  { state: 'failure', reason: 'critical browser failure' },
);

assert.strictEqual(evaluateAccountProfileHydrationWait(), false);
assert.strictEqual(
  evaluateAccountProfileHydrationWait({ response: { status: () => 200 } }),
  true,
);
const waitFailure = new Error('detail response wait failed');
assert.throws(
  () => evaluateAccountProfileHydrationWait({ waitError: waitFailure }),
  (error) => error === waitFailure,
);
assert.throws(
  () => evaluateAccountProfileHydrationWait({
    response: { status: () => 200 },
    criticalBrowserFailures: { failedRequests: ['GET /api/v1/account_profiles/example'] },
  }),
  /browser request failed/,
  'critical browser failure must terminate even after a response is visible',
);

async function assertResponseFailures() {
  const okResponse = (payload) => ({
    status: () => 200,
    json: async () => payload,
  });

  assert.strictEqual(
    await readAccountProfileDetailResponse(okResponse({ data: generic }), generic.slug),
    generic,
  );
  const renamedBrowserProfile = {
    slug: generic.slug,
    display_name: 'Browser Response Name',
  };
  const browserObserved = await readAccountProfileDetailResponse(
    okResponse({ data: renamedBrowserProfile }),
    generic.slug,
  );
  assert.strictEqual(
    accountProfileBrowserHeroOracle(generic.slug, browserObserved),
    'Browser Response Name',
    'the browser-observed detail payload must supply the UI name oracle',
  );
  assert.notStrictEqual(
    accountProfileBrowserHeroOracle(generic.slug, browserObserved),
    canonicalPublicVisibleName(generic),
    'a stale setup name must not become the browser hero oracle',
  );
  await assert.rejects(
    () => readAccountProfileDetailResponse({ status: () => 500 }, generic.slug),
    /received 500/,
  );
  await assert.rejects(
    () => readAccountProfileDetailResponse({
      status: () => 200,
      json: async () => { throw new Error('invalid JSON'); },
    }, generic.slug),
    /non-JSON payload.*invalid JSON/,
  );
  await assert.rejects(
    () => readAccountProfileDetailResponse(okResponse({ data: null }), generic.slug),
    /must be an object/,
  );
  await assert.rejects(
    () => readAccountProfileDetailResponse(okResponse({ data: generic }), 'other-slug'),
    /slug mismatch/,
  );
  await assert.rejects(
    () => readAccountProfileDetailResponse(okResponse({
      data: { slug: 123, display_name: 'Valid Name' },
    }), '123'),
    /slug must be a string/,
  );
  await assert.rejects(
    () => readAccountProfileDetailResponse(okResponse({
      data: { slug: 'valid-slug', display_name: ['Valid Name'] },
    }), 'valid-slug'),
    /display_name must be a string/,
  );
  assert.strictEqual(
    await resolveAccountProfileProofSubject([generic], async () => generic),
    generic,
  );
  await assert.rejects(
    () => resolveAccountProfileProofSubject(
      [generic],
      async () => ({ slug: 'different-slug', display_name: 'Different Profile' }),
    ),
    /slug mismatch/,
    'catalog identity must remain bound through setup hydration',
  );
}

assertResponseFailures()
  .then(() => {
    console.log('Account Profile readonly proof contract tests passed.');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
