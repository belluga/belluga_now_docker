#!/usr/bin/env node

const assert = require('assert');

const {
  buildAccountSlugIndexById,
  readAccountIdFromProfileRecord,
  readCanonicalAccountSlugFromAccountRow,
  readCanonicalAccountSlugFromProfileDetail,
  resolveAccountSlugFromIndexByProfileRecord,
} = require('./support/public_taxonomy_cleanup_resolution');

function assertAccountRowsBuildCanonicalSlugIndex() {
  const accountSlugById = buildAccountSlugIndexById([
    { id: 'account-1', slug: 'primary-host' },
    { id: 'account-2', account: { slug: 'related-host' } },
    { id: 'account-3', slug: '   ' },
    { slug: 'missing-id' },
  ]);

  assert.strictEqual(accountSlugById.get('account-1'), 'primary-host');
  assert.strictEqual(accountSlugById.get('account-2'), 'related-host');
  assert.strictEqual(accountSlugById.has('account-3'), false);
}

function assertProfileRecordAccountIdFallbackUsesCanonicalAccountIndex() {
  const accountSlugById = buildAccountSlugIndexById([
    { id: 'account-42', slug: 'fixture-account-slug' },
  ]);

  assert.strictEqual(
    resolveAccountSlugFromIndexByProfileRecord(accountSlugById, {
      id: 'profile-42',
      account_id: 'account-42',
    }),
    'fixture-account-slug',
  );
}

function assertNestedProfileAccountIdFallbackUsesCanonicalAccountIndex() {
  const accountSlugById = buildAccountSlugIndexById([
    { id: 'account-84', slug: 'restored-stage-account' },
  ]);

  assert.strictEqual(
    resolveAccountSlugFromIndexByProfileRecord(accountSlugById, {
      account_profile: {
        account: {
          id: 'account-84',
        },
      },
    }),
    'restored-stage-account',
  );
}

function assertCanonicalReadersPreserveExplicitSlugContracts() {
  assert.strictEqual(
    readCanonicalAccountSlugFromAccountRow({
      account: { slug: 'nested-account-slug' },
    }),
    'nested-account-slug',
  );
  assert.strictEqual(
    readCanonicalAccountSlugFromProfileDetail({
      account_profile: {
        account: {
          slug: 'detail-account-slug',
        },
      },
    }),
    'detail-account-slug',
  );
  assert.strictEqual(
    readAccountIdFromProfileRecord({
      account_profile: {
        account_id: 'account-168',
      },
    }),
    'account-168',
  );
}

assertAccountRowsBuildCanonicalSlugIndex();
assertProfileRecordAccountIdFallbackUsesCanonicalAccountIndex();
assertNestedProfileAccountIdFallbackUsesCanonicalAccountIndex();
assertCanonicalReadersPreserveExplicitSlugContracts();

console.log('Public taxonomy cleanup resolution contract tests passed.');
