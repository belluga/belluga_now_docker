#!/usr/bin/env node

const assert = require('assert');

const {
  cleanupOnboardedAccount,
  cleanupOnboardedAccounts,
  runCleanupPreservingPrimaryError,
} = require('./support/account_onboarding_cleanup');

function response(status) {
  return {
    status: () => status,
  };
}

function fakeApi({ deleteStatuses, getStatuses }) {
  let deleteIndex = 0;
  let getIndex = 0;

  return {
    async delete() {
      const status = deleteStatuses[Math.min(deleteIndex, deleteStatuses.length - 1)];
      deleteIndex += 1;
      return response(status);
    },
    async get() {
      const status = getStatuses[Math.min(getIndex, getStatuses.length - 1)];
      getIndex += 1;
      return response(status);
    },
  };
}

async function assertDefaultStrictThrowsWhenCleanupCannotRemoveAccount() {
  const api = fakeApi({
    deleteStatuses: [500, 500, 500],
    getStatuses: [200, 200, 200],
  });

  await assert.rejects(
    cleanupOnboardedAccount(api, 'https://example.test', 'token', 'stuck-account'),
    /Cleanup did not remove onboarded account stuck-account\./,
  );
}

async function assertExplicitNonStrictReturnsFalse() {
  const api = fakeApi({
    deleteStatuses: [500, 500, 500],
    getStatuses: [200, 200, 200],
  });

  const result = await cleanupOnboardedAccount(
    api,
    'https://example.test',
    'token',
    'stuck-account',
    { strict: false },
  );

  assert.strictEqual(result, false);
}

async function assertProbeFailureDoesNotMasqueradeAsPresentAccount() {
  const api = fakeApi({
    deleteStatuses: [204],
    getStatuses: [500],
  });

  await assert.rejects(
    cleanupOnboardedAccount(api, 'https://example.test', 'token', 'probe-failure'),
    /probe for probe-failure returned HTTP 500\./,
  );
}

async function assertBlankSlugFailsClosedInStrictMode() {
  const api = fakeApi({
    deleteStatuses: [204],
    getStatuses: [404],
  });

  await assert.rejects(
    cleanupOnboardedAccount(api, 'https://example.test', 'token', '   '),
    /Cleanup requires a canonical account slug\./,
  );
}

async function assertBatchCleanupAggregatesAllFailures() {
  const api = fakeApi({
    deleteStatuses: [500, 500, 500, 500, 500],
    getStatuses: [200, 200, 200, 200, 200],
  });

  await assert.rejects(
    cleanupOnboardedAccounts(
      api,
      'https://example.test',
      'token',
      ['first-account', 'second-account'],
      { maxAttempts: 1 },
    ),
    (error) =>
      error instanceof AggregateError
      && error.errors.length === 2,
  );
}

async function assertCleanupFailureIsSurfacedAlongsidePrimaryFailure() {
  const primaryError = new Error('primary failure');
  await assert.rejects(
    runCleanupPreservingPrimaryError(primaryError, async () => {
      throw new Error('cleanup failure');
    }),
    (error) =>
      error instanceof AggregateError
      && error.errors.length === 2
      && error.errors[0] === primaryError,
  );
}

(async () => {
  await assertDefaultStrictThrowsWhenCleanupCannotRemoveAccount();
  await assertExplicitNonStrictReturnsFalse();
  await assertProbeFailureDoesNotMasqueradeAsPresentAccount();
  await assertBlankSlugFailsClosedInStrictMode();
  await assertBatchCleanupAggregatesAllFailures();
  await assertCleanupFailureIsSurfacedAlongsidePrimaryFailure();
  console.log('Account onboarding cleanup contract tests passed.');
})().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
