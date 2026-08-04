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

function fakeApi({
  deleteStatuses = [],
  postStatuses = [],
  getStatuses,
  patchStatuses = [],
}) {
  let deleteIndex = 0;
  let postIndex = 0;
  let getIndex = 0;
  let patchIndex = 0;

  const deleteCalls = [];
  const postCalls = [];
  const patchCalls = [];

  return {
    async delete() {
      const status = deleteStatuses[Math.min(deleteIndex, deleteStatuses.length - 1)];
      deleteIndex += 1;
      deleteCalls.push(status);
      return response(status);
    },
    async post() {
      const status = postStatuses[Math.min(postIndex, postStatuses.length - 1)];
      postIndex += 1;
      postCalls.push(status);
      return response(status);
    },
    async get() {
      const status = getStatuses[Math.min(getIndex, getStatuses.length - 1)];
      getIndex += 1;
      return response(status);
    },
    async patch() {
      const status = patchStatuses[Math.min(patchIndex, patchStatuses.length - 1)];
      patchIndex += 1;
      patchCalls.push(status);
      return response(status);
    },
    stats() {
      return {
        deleteCalls: deleteCalls.slice(),
        postCalls: postCalls.slice(),
        patchCalls: patchCalls.slice(),
      };
    },
  };
}

async function assertDefaultStrictThrowsWhenCleanupCannotRemoveAccount() {
  const api = fakeApi({
    postStatuses: [500, 500, 500],
    getStatuses: [200, 200, 200],
  });

  await assert.rejects(
    cleanupOnboardedAccount(api, 'https://example.test', 'token', 'stuck-account'),
    /Cleanup did not remove onboarded account stuck-account\./,
  );
}

async function assertExplicitNonStrictReturnsFalse() {
  const api = fakeApi({
    postStatuses: [500, 500, 500],
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
    postStatuses: [204],
    getStatuses: [500],
  });

  await assert.rejects(
    cleanupOnboardedAccount(api, 'https://example.test', 'token', 'probe-failure'),
    /probe for probe-failure returned HTTP 500\./,
  );
}

async function assertLegacyTenantOwnedAccountsAreNormalizedBeforeRetryingDelete() {
  const api = fakeApi({
    postStatuses: [422, 204],
    getStatuses: [404],
    patchStatuses: [200],
  });

  await cleanupOnboardedAccount(
    api,
    'https://example.test',
    'token',
    'legacy-tenant-owned-account',
  );

  assert.deepStrictEqual(api.stats(), {
    deleteCalls: [],
    postCalls: [422, 204],
    patchCalls: [200],
  });
}

async function assertBlankSlugFailsClosedInStrictMode() {
  const api = fakeApi({
    postStatuses: [204],
    getStatuses: [404],
  });

  await assert.rejects(
    cleanupOnboardedAccount(api, 'https://example.test', 'token', '   '),
    /Cleanup requires a canonical account slug\./,
  );
}

async function assertBatchCleanupAggregatesAllFailures() {
  const api = fakeApi({
    postStatuses: [500, 500, 500, 500, 500],
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

async function assertDeleteFallbackStillWorksWithoutPost() {
  const api = fakeApi({
    deleteStatuses: [204],
    getStatuses: [404],
  });

  delete api.post;

  await cleanupOnboardedAccount(
    api,
    'https://example.test',
    'token',
    'legacy-delete-only-account',
  );
}

async function assertMissingForceDeleteRouteFallsBackToDelete() {
  const api = fakeApi({
    deleteStatuses: [204],
    postStatuses: [404],
    getStatuses: [200, 404],
  });

  await cleanupOnboardedAccount(
    api,
    'https://example.test',
    'token',
    'missing-force-delete-route-account',
  );

  assert.deepStrictEqual(api.stats(), {
    deleteCalls: [204],
    postCalls: [404],
    patchCalls: [],
  });
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
  await assertLegacyTenantOwnedAccountsAreNormalizedBeforeRetryingDelete();
  await assertBlankSlugFailsClosedInStrictMode();
  await assertBatchCleanupAggregatesAllFailures();
  await assertDeleteFallbackStillWorksWithoutPost();
  await assertMissingForceDeleteRouteFallsBackToDelete();
  await assertCleanupFailureIsSurfacedAlongsidePrimaryFailure();
  console.log('Account onboarding cleanup contract tests passed.');
})().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
