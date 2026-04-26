#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const guardScript = path.join(__dirname, 'guard_web_navigation_policy.cjs');
const shardsScript = path.join(__dirname, 'web_navigation_shards.cjs');
const smokeScript = path.join(repoRoot, 'tools', 'flutter', 'run_web_navigation_smoke.sh');
const orchestrationWorkflow = path.join(repoRoot, '.github', 'workflows', 'orchestration-ci-cd.yml');

function run(command, args, env = {}) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      NAV_WEB_TEST_TYPE: 'mutation',
      NAV_DEPLOY_LANE: 'orchestrator',
      NAV_ADMIN_EMAIL: 'policy@example.test',
      NAV_ADMIN_PASSWORD: 'policy-secret',
      ...env,
    },
    encoding: 'utf8',
  });
}

function withTempDir(callback) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'belluga-nav-policy-'));
  try {
    callback(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function assertFailsForSource(name, source, expectedMessage) {
  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, `${name}.spec.js`), source);
    const result = run('node', [guardScript], {
      NAV_WEB_TESTS_DIR: dir,
    });
    assert.notStrictEqual(result.status, 0, `${name} should fail closed`);
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      expectedMessage,
      `${name} should explain the policy violation`,
    );
  });
}

function assertGuardPassesCleanFixture() {
  withTempDir((dir) => {
    fs.writeFileSync(
      path.join(dir, 'clean.spec.js'),
      "async function choose(page) { await page.getByRole('option', { name: 'A' }).click(); }\n",
    );
    const result = run('node', [guardScript], {
      NAV_WEB_TESTS_DIR: dir,
    });
    assert.strictEqual(result.status, 0, result.stderr);
  });
}

function assertShardValidationFails({ manifest, list, shard, expectedMessage }) {
  withTempDir((dir) => {
    const manifestPath = path.join(dir, 'navigation_mutation_shards.json');
    const listPath = path.join(dir, 'selected-tests.txt');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    fs.writeFileSync(listPath, list);

    const result = run('node', [shardsScript, 'validate', 'mutation', shard, listPath], {
      NAV_WEB_SHARD_MANIFEST: manifestPath,
    });
    assert.notStrictEqual(result.status, 0, 'shard validation should fail closed');
    assert.match(`${result.stdout}\n${result.stderr}`, expectedMessage);
  });
}

function assertStageMutationWorkflowSuppliesRuntimeCredentials() {
  const source = fs.readFileSync(orchestrationWorkflow, 'utf8');
  const stepMatch = source.match(
    /- name: Run stage mutation navigation smoke[\s\S]*?run: bash tools\/flutter\/run_web_navigation_smoke\.sh mutation/,
  );
  assert.ok(stepMatch, 'stage mutation navigation smoke step should exist');
  assert.match(
    stepMatch[0],
    /NAV_ADMIN_EMAIL:\s*\$\{\{\s*secrets\.STAGE_NAV_ADMIN_EMAIL\s*\}\}/,
    'stage mutation smoke must supply NAV_ADMIN_EMAIL from stage secret',
  );
  assert.match(
    stepMatch[0],
    /NAV_ADMIN_PASSWORD:\s*\$\{\{\s*secrets\.STAGE_NAV_ADMIN_PASSWORD\s*\}\}/,
    'stage mutation smoke must supply NAV_ADMIN_PASSWORD from stage secret',
  );
}

assertGuardPassesCleanFixture();
assertStageMutationWorkflowSuppliesRuntimeCredentials();

assertFailsForSource(
  'coordinate-click',
  'async function bad(page) { await page.' + 'mouse.' + 'click(12, 24); }\n',
  /mouse\.click coordinate fallbacks/,
);

assertFailsForSource(
  'forced-click',
  "async function bad(button) { await button." + "click({ " + "force: true }); }\n",
  /click\(\{ force: true \}\)/,
);

assertFailsForSource(
  'credential-fallback',
  "const adminEmail = process.env.NAV_ADMIN_EMAIL " + "|| 'admin@example.test';\n",
  /credential fallbacks/,
);

assertFailsForSource(
  'dropdown-text-fallback',
  "async function bad(page, optionText) { await page." + "getByText(optionText).click(); }\n",
  /dropdown selection must use semantic option\/menuitem locators/,
);

assertFailsForSource(
  'dropdown-keyboard-fallback',
  "async function bad(page) { await page." + "keyboard." + "press('ArrowDown'); }\n",
  /dropdown selection must use semantic option\/menuitem locators/,
);

assertFailsForSource(
  'local-dropdown-helper',
  'async ' + 'function ' + 'selectDropdownOption(page) { return page; }\n',
  /dropdown helper logic must be centralized/,
);

const manifest = {
  mutation: {
    shards: {
      alpha: {
        grep_extra: 'alpha',
        expected_titles: ['@mutation alpha path'],
      },
    },
  },
};

const unknownShard = run('node', [shardsScript, 'grep', 'mutation', 'missing'], {
  NAV_WEB_SHARD_MANIFEST: path.join(__dirname, 'navigation_mutation_shards.json'),
});
assert.notStrictEqual(unknownShard.status, 0, 'unknown shard id should fail');
assert.match(`${unknownShard.stdout}\n${unknownShard.stderr}`, /Unknown mutation shard/);

assertShardValidationFails({
  manifest,
  list: '  test › @mutation beta path\n',
  shard: 'alpha',
  expectedMessage: /Missing expected titles/,
});

assertShardValidationFails({
  manifest,
  list: '  test › @mutation alpha path\n  test › @mutation beta path\n',
  shard: 'alpha',
  expectedMessage: /Unexpected selected titles/,
});

const rawGrepResult = run('bash', [smokeScript, 'mutation'], {
  NAV_WEB_GREP_EXTRA: 'manual',
  NAV_WEB_ALLOW_RAW_GREP: '0',
});
assert.notStrictEqual(rawGrepResult.status, 0, 'raw grep should fail without explicit allowance');
assert.match(
  `${rawGrepResult.stdout}\n${rawGrepResult.stderr}`,
  /NAV_WEB_GREP_EXTRA is ad-hoc/,
);

console.log('Navigation harness policy regression tests passed.');
