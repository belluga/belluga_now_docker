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
const verifyEnvironmentCiScript = path.join(repoRoot, '.github', 'scripts', 'verify_environment_ci.sh');
const directPlaywrightContractProbe = path.join(
  repoRoot,
  'tools',
  'flutter',
  'web_app_smoke_runner',
  'scripts',
  'probe_playwright_suite_contract.js',
);
const localNavigationEnvExample = path.join(repoRoot, '.env.local.navigation.example');
const orchestrationWorkflow = path.join(repoRoot, '.github', 'workflows', 'orchestration-ci-cd.yml');
const rootReadme = path.join(repoRoot, 'README.md');
const inviteFallbackReadonlySpec = path.join(
  repoRoot,
  'tools',
  'flutter',
  'web_app_tests',
  'invite_not_found_event_fallback.readonly.spec.js',
);
const {
  filterOwnedEventRows,
  filterOwnedProfileRows,
  fixture: stageTaxonomyFixture,
  runKey: stageTaxonomyRunKey,
  sanitizeRunId,
  shouldContinuePagedFetch,
} = require('./support/public_taxonomy_validation_fixture_contract');

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
    return callback(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function spawnSmokeScriptForPolicyTest(suite, env) {
  const source = fs.readFileSync(smokeScript, 'utf8');
  const harnessSelfTestInvocation =
    /run_with_timeout "web navigation harness policy self-test" "\$\{PRECHECK_TIMEOUT_SECONDS\}" \\\n\s*bash -lc "set -euo pipefail; node \.\.\/web_app_tests\/navigation_harness_policy_test\.cjs 2>&1 \| tee \\"\$\{DEFAULT_OUTPUT_DIR\}\/policy-harness\.log\\""/m;
  assert.match(
    source,
    harnessSelfTestInvocation,
    'runner must invoke the navigation harness policy test directly',
  );
  const rewritten = source.replace(
    harnessSelfTestInvocation,
    ': # stripped during navigation_harness_policy_test self-execution',
  );
  assert.notStrictEqual(
    rewritten,
    source,
    'policy self-test runner copy must remove the recursive harness-policy invocation',
  );

  const tempSmokeScript = path.join(
    path.dirname(smokeScript),
    `.navigation_harness_policy_probe_${process.pid}_${Date.now()}.sh`,
  );
  try {
    fs.writeFileSync(tempSmokeScript, rewritten, { mode: 0o755 });
    fs.chmodSync(tempSmokeScript, 0o755);
    const isolatedEnv = {
      ...process.env,
    };
    for (const key of [
      'NAV_LOCAL_ENV_FILE',
      'NAV_WEB_TEST_TYPE',
      'NAV_DEPLOY_LANE',
      'NAV_ADMIN_EMAIL',
      'NAV_ADMIN_PASSWORD',
      'NAV_LANDLORD_URL',
      'NAV_TENANT_URL',
      'NAV_WEB_SHARD',
      'NAV_WEB_ALLOW_NONLOCAL_MUTATION_HOSTS',
      'NAV_RUNTIME_DB_MUTATION_ALLOWED',
      'NAV_INVITE_FALLBACK_EVENT_SLUG',
      'NAV_INVITE_FALLBACK_OCCURRENCE_ID',
      'NAV_INVITE_FALLBACK_EVENT_TITLE',
      'NAV_TEST_RUN_ID',
      'NAV_WEB_OUTPUT_DIR',
      'DEPLOY_LANE',
      'GITHUB_REF_NAME',
    ]) {
      delete isolatedEnv[key];
    }
    Object.assign(isolatedEnv, env);
    if (!isolatedEnv.NAV_WEB_OUTPUT_DIR) {
      isolatedEnv.NAV_WEB_OUTPUT_DIR = path.join(
        os.tmpdir(),
        `belluga-nav-policy-output-${process.pid}-${Date.now()}-${suite}`,
      );
    }
    return spawnSync('bash', [tempSmokeScript, suite], {
      cwd: repoRoot,
      env: isolatedEnv,
      encoding: 'utf8',
    });
  } finally {
    fs.rmSync(tempSmokeScript, { force: true });
  }
}

function directPlaywrightEnv(overrides = {}) {
  const env = {
    ...process.env,
  };
  for (const key of [
    'NAV_LOCAL_ENV_FILE',
    'NAV_WEB_TEST_TYPE',
    'NAV_DEPLOY_LANE',
    'NAV_ADMIN_EMAIL',
    'NAV_ADMIN_PASSWORD',
    'NAV_LANDLORD_URL',
    'NAV_TENANT_URL',
    'NAV_WEB_SHARD',
    'NAV_WEB_ALLOW_NONLOCAL_MUTATION_HOSTS',
    'NAV_RUNTIME_DB_MUTATION_ALLOWED',
    'NAV_INVITE_FALLBACK_EVENT_SLUG',
    'NAV_INVITE_FALLBACK_OCCURRENCE_ID',
    'NAV_INVITE_FALLBACK_EVENT_TITLE',
    'NAV_TEST_RUN_ID',
    'NAV_WEB_OUTPUT_DIR',
    'DEPLOY_LANE',
    'GITHUB_REF_NAME',
  ]) {
    delete env[key];
  }

  return {
    ...env,
    ...overrides,
  };
}

function spawnDirectPlaywrightContractProbe(args, env) {
  return spawnSync('node', [directPlaywrightContractProbe, ...args], {
    cwd: path.join(repoRoot, 'tools', 'flutter', 'web_app_smoke_runner'),
    env: directPlaywrightEnv(env),
    encoding: 'utf8',
  });
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

function assertDiagnosticValidationFails({ manifest, list, expectedMessage }) {
  withTempDir((dir) => {
    const manifestPath = path.join(dir, 'navigation_mutation_shards.json');
    const listPath = path.join(dir, 'selected-tests.txt');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    fs.writeFileSync(listPath, list);

    const result = run('node', [shardsScript, 'validate', 'diagnostic', 'all', listPath], {
      NAV_WEB_SHARD_MANIFEST: manifestPath,
    });
    assert.notStrictEqual(result.status, 0, 'diagnostic validation should fail closed');
    assert.match(`${result.stdout}\n${result.stderr}`, expectedMessage);
  });
}

function assertReadonlyValidationFails({ manifest, list, expectedMessage }) {
  withTempDir((dir) => {
    const manifestPath = path.join(dir, 'navigation_mutation_shards.json');
    const listPath = path.join(dir, 'selected-tests.txt');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    fs.writeFileSync(listPath, list);

    const result = run('node', [shardsScript, 'validate', 'readonly', 'all', listPath], {
      NAV_WEB_SHARD_MANIFEST: manifestPath,
    });
    assert.notStrictEqual(result.status, 0, 'readonly validation should fail closed');
    assert.match(`${result.stdout}\n${result.stderr}`, expectedMessage);
  });
}

function assertStageMutationWorkflowSuppliesRuntimeCredentials() {
  const source = fs.readFileSync(orchestrationWorkflow, 'utf8');
  const assertStageRunIdIsolation = (stepSource, label) => {
    assert.match(
      stepSource,
      /NAV_TEST_RUN_ID:\s*stage-\$\{\{\s*github\.run_id\s*\}\}-\$\{\{\s*github\.run_attempt\s*\}\}/,
      `${label} must namespace NAV_TEST_RUN_ID by GitHub run id and attempt`,
    );
    assert.doesNotMatch(
      stepSource,
      /NAV_TEST_RUN_ID:\s*['"]?stage['"]?\s*(?:#.*)?$/m,
      `${label} must not reuse a static stage run id`,
    );
  };
  const fixtureStepMatch = source.match(
    /- name: Ensure stage public taxonomy validation fixture[\s\S]*?run: node \.\.\/web_app_tests\/ensure_public_taxonomy_validation_fixture\.cjs/,
  );
  assert.ok(fixtureStepMatch, 'stage public taxonomy validation fixture step should exist');
  assertStageRunIdIsolation(
    fixtureStepMatch[0],
    'stage public taxonomy fixture',
  );
  assert.match(
    fixtureStepMatch[0],
    /NAV_DEPLOY_LANE:\s*stage/,
    'stage public taxonomy fixture must declare NAV_DEPLOY_LANE=stage explicitly',
  );
  assert.match(
    fixtureStepMatch[0],
    /NAV_WEB_ALLOW_NONLOCAL_MUTATION_HOSTS:\s*['"]?1['"]?/,
    'stage public taxonomy fixture must opt into non-local mutation hosts explicitly',
  );

  const cleanupStepMatch = source.match(
    /- name: Clean up stage public taxonomy validation fixture[\s\S]*?run: node \.\.\/web_app_tests\/ensure_public_taxonomy_validation_fixture\.cjs/,
  );
  assert.ok(cleanupStepMatch, 'stage public taxonomy validation fixture cleanup step should exist');
  assertStageRunIdIsolation(
    cleanupStepMatch[0],
    'stage public taxonomy fixture cleanup',
  );

  const stepMatch = source.match(
    /- name: Run stage mutation navigation smoke[\s\S]*?run: bash tools\/flutter\/run_web_navigation_smoke\.sh mutation/,
  );
  assert.ok(stepMatch, 'stage mutation navigation smoke step should exist');
  assertStageRunIdIsolation(
    stepMatch[0],
    'stage mutation smoke',
  );
  assert.match(
    stepMatch[0],
    /NAV_ADMIN_EMAIL:\s*\$\{\{\s*vars\.STAGE_NAV_ADMIN_EMAIL\s*\}\}/,
    'stage mutation smoke must supply NAV_ADMIN_EMAIL from stage variable',
  );
  assert.match(
    stepMatch[0],
    /NAV_ADMIN_PASSWORD:\s*\$\{\{\s*secrets\.STAGE_NAV_ADMIN_PASSWORD\s*\}\}/,
    'stage mutation smoke must supply NAV_ADMIN_PASSWORD from stage secret',
  );
  assert.match(
    stepMatch[0],
    /NAV_WEB_ALLOW_NONLOCAL_MUTATION_HOSTS:\s*['"]?1['"]?/,
    'stage mutation smoke must opt into non-local mutation hosts explicitly',
  );

  const readonlyStepMatch = source.match(
    /- name: Run stage real navigation smoke[\s\S]*?run: bash tools\/flutter\/run_web_navigation_smoke\.sh readonly/,
  );
  assert.ok(readonlyStepMatch, 'stage readonly navigation smoke step should exist');
  assertStageRunIdIsolation(
    readonlyStepMatch[0],
    'stage readonly smoke',
  );
  assert.match(
    readonlyStepMatch[0],
    /NAV_PUBLIC_TAXONOMY_MANAGED_FIXTURE:\s*['"]?1['"]?/,
    'stage readonly smoke must opt into the managed taxonomy fixture explicitly',
  );
  assert.doesNotMatch(
    readonlyStepMatch[0],
    /NAV_INVITE_FALLBACK_EVENT_(?:SLUG|TITLE)|NAV_INVITE_FALLBACK_OCCURRENCE_ID/,
    'stage readonly smoke must not wire a published recoverable invite event fixture implicitly',
  );

  const rollbackReadonlyStepMatch = source.match(
    /- name: Run restored stage readonly navigation smoke[\s\S]*?restored_navigation_workspace[\s\S]*?run_web_navigation_smoke\.sh" readonly/,
  );
  assert.ok(
    rollbackReadonlyStepMatch,
    'restored stage readonly navigation smoke step should exist',
  );
  assertStageRunIdIsolation(
    rollbackReadonlyStepMatch[0],
    'restored stage readonly smoke',
  );
  assert.match(
    rollbackReadonlyStepMatch[0],
    /NAV_PUBLIC_TAXONOMY_MANAGED_FIXTURE:\s*['"]?1['"]?/,
    'restored stage readonly smoke must opt into the managed taxonomy fixture explicitly',
  );
  assert.doesNotMatch(
    rollbackReadonlyStepMatch[0],
    /NAV_INVITE_FALLBACK_EVENT_(?:SLUG|TITLE)|NAV_INVITE_FALLBACK_OCCURRENCE_ID/,
    'restored stage readonly smoke must not wire a published recoverable invite event fixture implicitly',
  );

  const productionReadonlyStepMatch = source.match(
    /- name: Run production real navigation smoke[\s\S]*?run: bash tools\/flutter\/run_web_navigation_smoke\.sh readonly/,
  );
  assert.ok(
    productionReadonlyStepMatch,
    'production readonly navigation smoke step should exist',
  );
  assert.doesNotMatch(
    productionReadonlyStepMatch[0],
    /NAV_PUBLIC_TAXONOMY_MANAGED_FIXTURE:\s*['"]?1['"]?/,
    'production readonly smoke must not implicitly opt into the stage-managed taxonomy fixture',
  );
  assert.doesNotMatch(
    productionReadonlyStepMatch[0],
    /NAV_INVITE_FALLBACK_EVENT_(?:SLUG|TITLE)|NAV_INVITE_FALLBACK_OCCURRENCE_ID/,
    'production readonly smoke must not wire a published recoverable invite event fixture implicitly',
  );

  const rollbackMutationStepMatch = source.match(
    /- name: Run restored stage mutation navigation smoke[\s\S]*?restored_navigation_workspace[\s\S]*?run_web_navigation_smoke\.sh" mutation/,
  );
  assert.ok(
    rollbackMutationStepMatch,
    'restored stage mutation navigation smoke step should exist',
  );
  assertStageRunIdIsolation(
    rollbackMutationStepMatch[0],
    'restored stage mutation smoke',
  );

  const rollbackCleanupStepMatch = source.match(
    /- name: Clean up restored stage public taxonomy validation fixture[\s\S]*?working-directory:\s*\$\{\{ steps\.stage_rollback_proof_plan\.outputs\.restored_navigation_workspace \}\}\/tools\/flutter\/web_app_smoke_runner[\s\S]*?run: node \.\.\/web_app_tests\/ensure_public_taxonomy_validation_fixture\.cjs/,
  );
  assert.ok(
    rollbackCleanupStepMatch,
    'restored stage public taxonomy validation fixture cleanup step should exist',
  );
  assertStageRunIdIsolation(
    rollbackCleanupStepMatch[0],
    'restored stage public taxonomy fixture cleanup',
  );
}

function assertStageWorkflowIntentionallyOmitsDiagnosticSuite() {
  const source = fs.readFileSync(orchestrationWorkflow, 'utf8');
  assert.doesNotMatch(
    source,
    /run:\s*bash tools\/flutter\/run_web_navigation_smoke\.sh diagnostic/,
    'stage workflow must not invoke the diagnostic suite because diagnostics are local-only by policy',
  );
}

function assertPublishedLaneProofRemainsPipelineOnly() {
  const readmeSource = fs.readFileSync(rootReadme, 'utf8');
  assert.match(
    readmeSource,
    /Pipeline Stage\/Main Proof/,
    'root README must describe published stage\/main proof as a pipeline-only surface',
  );
  assert.match(
    readmeSource,
    /`CI Equivalent` remains current-branch local product proof on the authoritative branch\s+under evaluation and should resolve through local\/dev topology\./,
    'root README must keep CI Equivalent local and current-branch scoped',
  );
  assert.match(
    readmeSource,
    /Published `stage` and `main` proof exist only in the pipeline\./,
    'root README must state explicitly that published lanes are pipeline-only',
  );
  assert.match(
    readmeSource,
    /run_reconcile_validation\.sh`: package reconciliation against the principal checkout\./,
    'root README must keep reconcile validation distinct from published-lane proof',
  );
  assert.match(
    readmeSource,
    /GitHub Actions `\.github\/workflows\/orchestration-ci-cd\.yml` stage\/main jobs: published lane proof only\./,
    'root README must point published-lane proof at the workflow, not a local runner',
  );
  assert.doesNotMatch(
    readmeSource,
    /run_stage_published_validation\.sh/,
    'root README must not advertise a local published-stage validation runner',
  );
  assert.doesNotMatch(
    readmeSource,
    /### Published Stage(?:-Equivalent)? Validation/,
    'root README must not restore the old local published-stage heading in either its exact or shortened form',
  );

  const verifySource = fs.readFileSync(verifyEnvironmentCiScript, 'utf8');
  assert.match(
    verifySource,
    /grep -Eq '### Published Stage\(-Equivalent\)\? Validation' README\.md/,
    'verify_environment_ci must reject both historical published-stage heading variants in README',
  );
  assert.match(
    verifySource,
    /\[\[ -e \.github\/scripts\/run_stage_published_validation\.sh \]\]/,
    'verify_environment_ci must fail if a local published-stage runner is reintroduced',
  );
  assert.match(
    verifySource,
    /\[\[ -e \.github\/scripts\/run_stage_ci_equivalent\.sh \]\]/,
    'verify_environment_ci must fail if the legacy stage CI-equivalent misnomer is reintroduced',
  );
  const workflowSource = fs.readFileSync(orchestrationWorkflow, 'utf8');
  assert.doesNotMatch(
    workflowSource,
    /run:\s*bash \.github\/scripts\/run_stage_published_validation\.sh/,
    'pipeline must own published-lane proof directly instead of delegating to a local convenience runner',
  );

  assert.ok(
    !fs.existsSync(path.join(repoRoot, '.github', 'scripts', 'run_stage_published_validation.sh')),
    'local published-stage validation runner must not exist after the hard cutoff',
  );
  assert.ok(
    !fs.existsSync(path.join(repoRoot, '.github', 'scripts', 'run_stage_ci_equivalent.sh')),
    'legacy run_stage_ci_equivalent.sh path must not exist after the hard cutoff',
  );
}

function assertLocalNavigationEnvAutomationIsSafe() {
  const gitignore = fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf8');
  assert.match(
    gitignore,
    /^\.env\.local\.navigation$/m,
    'local navigation env file must be gitignored',
  );

  const example = fs.readFileSync(localNavigationEnvExample, 'utf8');
  assert.match(example, /^# NAV_LANDLORD_URL=http:\/\/localhost$/m);
  assert.match(example, /^# NAV_TENANT_URL=http:\/\/localhost$/m);
  assert.match(example, /^NAV_DEPLOY_LANE=local$/m);
  assert.match(
    example,
    /^# Diagnostic suite still requires NAV_DEPLOY_LANE and NAV_RUNTIME_DB_MUTATION_ALLOWED in the shell environment\.$/m,
  );
  assert.match(example, /^# Required for mutation and diagnostic navigation smoke\.$/m);
  assert.match(example, /^# NAV_ADMIN_EMAIL=$/m);
  assert.match(example, /^# NAV_ADMIN_PASSWORD=$/m);
  assert.match(example, /^# NAV_RUNTIME_DB_MUTATION_ALLOWED=1$/m);
  assert.doesNotMatch(
    example,
    /https:\/\/(?:belluga\.space|guarappari\.belluga\.space)/,
    'example file must not ship shared/public navigation hosts as defaults',
  );
}

function assertInviteRecoverableFallbackPublishedSmokeIsRemoved() {
  const source = fs.readFileSync(inviteFallbackReadonlySpec, 'utf8');
  assert.match(
    source,
    /@readonly invite not-found without recoverable fallback lands safely on home/,
    'invite fallback readonly spec must keep the irrecoverable-home proof',
  );
  assert.doesNotMatch(
    source,
    /@readonly invite not-found with canonical fallback query lands on the target event/,
    'invite fallback readonly spec must not keep the published recoverable-event proof',
  );
  assert.doesNotMatch(
    source,
    /pw-event-share-boundary-store-release-5|PW-READONLY-INVITE-FALLBACK/,
    'invite fallback readonly spec must not hardcode a published recoverable invite event fixture',
  );
}

function assertReadonlyFavoriteSpecMessageMatchesSuite() {
  const source = fs.readFileSync(
    path.join(__dirname, 'favorite_auth_gate_runtime.readonly.spec.js'),
    'utf8',
  );
  assert.match(
    source,
    /Favorite auth gate readonly runtime proof requires a live tenant URL/,
    'readonly favorite runtime proof should use the readonly wording',
  );
  assert.doesNotMatch(
    source,
    /Favorite auth gate runtime diagnostics require a live tenant URL/,
    'readonly favorite runtime proof must not keep diagnostic wording',
  );
}

function assertRunnerAlwaysExecutesHarnessPolicyTest() {
  const source = fs.readFileSync(smokeScript, 'utf8');
  assert.match(
    source,
    /navigation_harness_policy_test\.cjs/,
    'runner must execute the navigation harness policy test on every canonical run',
  );
  assert.doesNotMatch(
    source,
    /NAV_SKIP_HARNESS_POLICY_TEST/,
    'runner must not expose a public harness-policy skip flag',
  );
}

function assertSmokeRunnerIsolatesOutputsPerInvocation() {
  const source = fs.readFileSync(smokeScript, 'utf8');
  assert.match(
    source,
    /DEFAULT_OUTPUT_DIR="\$\{NAV_WEB_OUTPUT_DIR:-\$\{RUNNER_DIR\}\/test-results\/\$\{NAV_TEST_RUN_ID\}\/\$\{SUITE\}\}"/,
    'runner must isolate smoke outputs by run id and suite unless NAV_WEB_OUTPUT_DIR is provided explicitly',
  );
}

function assertWorkflowTimeoutsCoverWrapperBudgets() {
  const source = fs.readFileSync(orchestrationWorkflow, 'utf8');
  const assertStepTimeoutAtLeast = (stepName, minimumMinutes) => {
    const escapedStepName = stepName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const block = source.match(
      new RegExp(`- name: ${escapedStepName}[\\s\\S]*?timeout-minutes:\\s*(\\d+)`),
    );
    assert.ok(block, `${stepName} should declare timeout-minutes explicitly`);
    assert.ok(
      Number(block[1]) >= minimumMinutes,
      `${stepName} must leave margin above the wrapper budget`,
    );
  };

  assertStepTimeoutAtLeast('Run stage real navigation smoke', 25);
  assertStepTimeoutAtLeast('Run restored stage readonly navigation smoke', 25);
  assertStepTimeoutAtLeast('Run production real navigation smoke', 25);
  assertStepTimeoutAtLeast('Run restored production readonly navigation smoke', 25);
  assertStepTimeoutAtLeast('Run stage mutation navigation smoke', 35);
  assertStepTimeoutAtLeast('Run restored stage mutation navigation smoke', 35);
}

function assertLocalDiagnosticMutationHelperUsesExplicitArtisanCommand() {
  const helperPath = path.join(__dirname, 'support', 'local_docker_artisan.js');
  const source = fs.readFileSync(helperPath, 'utf8');
  assert.match(
    source,
    /'php',\s*'artisan',/,
    'local diagnostic helper must invoke an explicit artisan command',
  );
  assert.doesNotMatch(
    source,
    /'tinker'|--execute|base64_decode|eval\(/,
    'local diagnostic helper must not shell through artisan tinker or arbitrary eval',
  );
  assert.strictEqual(
    fs.existsSync(path.join(__dirname, 'support', 'local_docker_tinker.js')),
    false,
    'legacy local docker tinker helper must be removed once explicit artisan commands exist',
  );
}

function withEnv(overrides, callback) {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value == null) {
      delete process.env[key];
      continue;
    }
    process.env[key] = value;
  }

  try {
    callback();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value == null) {
        delete process.env[key];
        continue;
      }
      process.env[key] = value;
    }
  }
}

function assertLocalDiagnosticMutationHelperRequiresExplicitNonLocalOptIn() {
  const helperPath = path.join(__dirname, 'support', 'local_docker_artisan.js');
  delete require.cache[require.resolve(helperPath)];
  const helper = require(helperPath);

  withEnv(
    {
      NAV_WEB_TEST_TYPE: 'diagnostic',
      NAV_DEPLOY_LANE: 'local',
      NAV_RUNTIME_DB_MUTATION_ALLOWED: '1',
      NAV_TENANT_URL: 'https://guarappari.belluga.space',
      NAV_DIAGNOSTIC_LOCAL_ALLOWED_TENANT_HOSTS: null,
      NAV_WEB_LOCAL_MUTATION_ALLOWED_HOSTS: null,
      NAV_WEB_ALLOW_NONLOCAL_MUTATION_HOSTS: null,
    },
    () => {
      assert.throws(
        () => helper.requireLocalDiagnosticContract(),
        /without explicit local allowlist or NAV_WEB_ALLOW_NONLOCAL_MUTATION_HOSTS=1/,
        'diagnostic local docker helper must fail closed for non-local hosts without explicit opt-in',
      );
    },
  );

  withEnv(
    {
      NAV_WEB_TEST_TYPE: 'diagnostic',
      NAV_DEPLOY_LANE: 'local',
      NAV_RUNTIME_DB_MUTATION_ALLOWED: '1',
      NAV_TENANT_URL: 'https://guarappari.belluga.space',
      NAV_DIAGNOSTIC_LOCAL_ALLOWED_TENANT_HOSTS: null,
      NAV_WEB_LOCAL_MUTATION_ALLOWED_HOSTS: null,
      NAV_WEB_ALLOW_NONLOCAL_MUTATION_HOSTS: '1',
    },
    () => {
      assert.doesNotThrow(
        () => helper.requireLocalDiagnosticContract(),
        'diagnostic local docker helper must accept explicit non-local mutation opt-in for local belluga-space runtimes',
      );
    },
  );
}

function assertScriptStartupGuard(scriptRelativePath, env, expectedMessage) {
  const result = spawnSync(
    'node',
    [path.join(repoRoot, scriptRelativePath)],
    {
      cwd: repoRoot,
      env: directPlaywrightEnv(env),
      encoding: 'utf8',
    },
  );
  assert.notStrictEqual(result.status, 0, `${scriptRelativePath} should fail closed`);
  assert.match(`${result.stdout}\n${result.stderr}`, expectedMessage);
}

function assertFixtureBootstrapRequiresExplicitMutationContract() {
  assertScriptStartupGuard(
    path.join('tools', 'flutter', 'web_app_tests', 'ensure_public_taxonomy_validation_fixture.cjs'),
    {
      NAV_DEPLOY_LANE: 'stage',
      NAV_TEST_RUN_ID: 'policy-stage-host-contract',
      NAV_TENANT_URL: 'https://guarappari.belluga.space',
      NAV_ADMIN_EMAIL: 'policy@example.test',
      NAV_ADMIN_PASSWORD: 'policy-secret',
    },
    /refuses non-local target host .*NAV_WEB_ALLOW_NONLOCAL_MUTATION_HOSTS=1/,
  );
}

function assertFixtureBootstrapRequiresExplicitRunIdOnStage() {
  assertScriptStartupGuard(
    path.join('tools', 'flutter', 'web_app_tests', 'ensure_public_taxonomy_validation_fixture.cjs'),
    {
      NAV_DEPLOY_LANE: 'stage',
      NAV_TENANT_URL: 'https://guarappari.belluga.space',
      NAV_ADMIN_EMAIL: 'policy@example.test',
      NAV_ADMIN_PASSWORD: 'policy-secret',
      NAV_WEB_ALLOW_NONLOCAL_MUTATION_HOSTS: '1',
    },
    /require explicit NAV_TEST_RUN_ID/,
  );
}

function listWebNavigationSources(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listWebNavigationSources(entryPath);
    }
    if (!/\.(?:cjs|js)$/.test(entry.name)) {
      return [];
    }
    return [entryPath];
  });
}

function assertAdminSessionSecretsAreDerivedFromLogin() {
  const forbiddenPattern =
    /NAV_ADMIN_(?:TOKEN|USER_ID)|requireSeededLandlordSession/;
  for (const sourcePath of listWebNavigationSources(__dirname)) {
    if (sourcePath === __filename) {
      continue;
    }
    const source = fs.readFileSync(sourcePath, 'utf8');
    assert.doesNotMatch(
      source,
      forbiddenPattern,
      `${path.relative(repoRoot, sourcePath)} must derive admin token/user id from runtime login instead of fixed env vars`,
    );
  }
}

function assertSmokeRunnerLoadsLocalNavigationEnv() {
  withTempDir((dir) => {
    const envFile = path.join(dir, '.env.local.navigation');
    fs.writeFileSync(
      envFile,
      [
        'NAV_LANDLORD_URL=http://localhost',
        'NAV_TENANT_URL=http://localhost',
        'NAV_DEPLOY_LANE=local',
        'PLAYWRIGHT_IGNORE_HTTPS_ERRORS=true',
        'NAV_ADMIN_EMAIL=policy@example.test',
        'NAV_ADMIN_PASSWORD=policy-secret',
        '',
      ].join('\n'),
      { mode: 0o600 },
    );

    const env = {
      NAV_LOCAL_ENV_FILE: envFile,
      NAV_WEB_TEST_TYPE: 'mutation',
      NAV_DEPLOY_LANE: 'orchestrator',
      NAV_WEB_SHARD: 'missing',
    };
    delete env.NAV_ADMIN_EMAIL;
    delete env.NAV_ADMIN_PASSWORD;

    const result = spawnSmokeScriptForPolicyTest('mutation', env);
    assert.notStrictEqual(result.status, 0, 'unknown shard should fail after env loads');
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /Unknown mutation shard/,
      'local navigation env should satisfy credential guard before shard validation fails',
    );
  });
}

function assertSmokeRunnerPreservesExplicitNonLocalOptIn() {
  withTempDir((dir) => {
    const envFile = path.join(dir, '.env.local.navigation');
    fs.writeFileSync(
      envFile,
      [
        'NAV_LANDLORD_URL=https://belluga.space',
        'NAV_TENANT_URL=https://guarappari.belluga.space',
        'NAV_DEPLOY_LANE=dev',
        'NAV_WEB_ALLOW_NONLOCAL_MUTATION_HOSTS=0',
        'NAV_ADMIN_EMAIL=policy@example.test',
        'NAV_ADMIN_PASSWORD=policy-secret',
        '',
      ].join('\n'),
    );

    const result = spawnSmokeScriptForPolicyTest(
      'mutation',
      {
        NAV_LOCAL_ENV_FILE: envFile,
        NAV_WEB_TEST_TYPE: 'mutation',
        NAV_DEPLOY_LANE: 'dev',
        NAV_WEB_ALLOW_NONLOCAL_MUTATION_HOSTS: '1',
        NAV_WEB_SHARD: 'missing',
        PLAYWRIGHT_IGNORE_HTTPS_ERRORS: 'true',
      },
    );
    assert.notStrictEqual(
      result.status,
      0,
      'unknown shard should still fail after preserving explicit non-local mutation opt-in',
    );
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /Unknown mutation shard/,
      'explicit shell opt-in must win over env-file stale values so validation reaches shard selection',
    );
  });
}

function assertRunWithTimeoutPropagatesWrappedExitStatus() {
  const source = fs.readFileSync(smokeScript, 'utf8');
  const match = source.match(/run_with_timeout\(\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'run_with_timeout helper should exist in smoke runner');

  const result = spawnSync(
    'bash',
    [
      '-lc',
      [
        'set -euo pipefail',
        match[0],
        'set +e',
        "( run_with_timeout 'timeout-case' 1 bash -lc 'sleep 2' )",
        'timeout_status=$?',
        "( run_with_timeout 'failing-case' 1 bash -lc 'exit 42' )",
        'failing_status=$?',
        'set -e',
        'printf "timeout=%s\\nfailing=%s\\n" "$timeout_status" "$failing_status"',
        '[[ "$timeout_status" -eq 124 ]]',
        '[[ "$failing_status" -eq 42 ]]',
      ].join('\n'),
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    },
  );

  assert.strictEqual(
    result.status,
    0,
    `run_with_timeout should preserve wrapped failure statuses.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
}

function assertDiagnosticSuiteRequiresExplicitLocalMutationContract() {
  const isolatedEnvFile = path.join(
    os.tmpdir(),
    `belluga-nav-policy-missing-${process.pid}-${Date.now()}.env`,
  );
  const env = {
    NAV_LOCAL_ENV_FILE: isolatedEnvFile,
    NAV_WEB_TEST_TYPE: 'diagnostic',
    NAV_TENANT_URL: 'https://guarappari.belluga.space',
    PLAYWRIGHT_IGNORE_HTTPS_ERRORS: 'true',
  };
  delete env.NAV_DEPLOY_LANE;
  delete env.NAV_RUNTIME_DB_MUTATION_ALLOWED;

  let result = spawnSmokeScriptForPolicyTest('diagnostic', env);
  assert.notStrictEqual(result.status, 0, 'diagnostic must require explicit local lane');
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /diagnostic suite requires an explicit NAV_DEPLOY_LANE=local contract/,
  );

  result = spawnSmokeScriptForPolicyTest(
    'diagnostic',
    {
      ...env,
      NAV_DEPLOY_LANE: 'local',
    },
  );
  assert.notStrictEqual(result.status, 0, 'diagnostic must require explicit db-mutation opt-in');
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /diagnostic suite requires explicit NAV_RUNTIME_DB_MUTATION_ALLOWED=1/,
  );
}

function assertDiagnosticSuiteRejectsEnvFileOnlyContract() {
  withTempDir((dir) => {
    const envFile = path.join(dir, '.env.local.navigation');
    fs.writeFileSync(
      envFile,
      [
        'NAV_DEPLOY_LANE=local',
        'NAV_RUNTIME_DB_MUTATION_ALLOWED=1',
        'NAV_TENANT_URL=https://guarappari.belluga.space',
        'NAV_ADMIN_EMAIL=policy@example.test',
        'NAV_ADMIN_PASSWORD=policy-secret',
        '',
      ].join('\n'),
    );
    const result = spawnSmokeScriptForPolicyTest(
      'diagnostic',
      {
        NAV_LOCAL_ENV_FILE: envFile,
        NAV_WEB_TEST_TYPE: 'diagnostic',
        PLAYWRIGHT_IGNORE_HTTPS_ERRORS: 'true',
      },
    );
    assert.notStrictEqual(result.status, 0, 'diagnostic must not accept env-file-only mutation contracts');
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /diagnostic suite requires an explicit NAV_DEPLOY_LANE=local contract/,
    );
  });
}

function assertNonLocalMutationHostsRequireExplicitOptIn() {
  withTempDir((dir) => {
    const envFile = path.join(dir, '.env.local.navigation');
    fs.writeFileSync(
      envFile,
      [
        'NAV_LANDLORD_URL=https://belluga.space',
        'NAV_TENANT_URL=https://guarappari.belluga.space',
        'NAV_ADMIN_EMAIL=policy@example.test',
        'NAV_ADMIN_PASSWORD=policy-secret',
        '',
      ].join('\n'),
    );

    const blocked = spawnSmokeScriptForPolicyTest(
      'mutation',
      {
        NAV_LOCAL_ENV_FILE: envFile,
        NAV_WEB_TEST_TYPE: 'mutation',
        NAV_DEPLOY_LANE: 'dev',
        NAV_WEB_SHARD: 'missing',
        PLAYWRIGHT_IGNORE_HTTPS_ERRORS: 'true',
      },
    );
    assert.notStrictEqual(blocked.status, 0, 'non-local mutation hosts must fail closed');
    assert.match(
      `${blocked.stdout}\n${blocked.stderr}`,
      /refuses non-local host .*NAV_WEB_ALLOW_NONLOCAL_MUTATION_HOSTS=1/,
    );

    const allowed = spawnSmokeScriptForPolicyTest(
      'mutation',
      {
        NAV_LOCAL_ENV_FILE: envFile,
        NAV_WEB_TEST_TYPE: 'mutation',
        NAV_DEPLOY_LANE: 'dev',
        NAV_WEB_SHARD: 'missing',
        PLAYWRIGHT_IGNORE_HTTPS_ERRORS: 'true',
        NAV_WEB_ALLOW_NONLOCAL_MUTATION_HOSTS: '1',
      },
    );
    assert.notStrictEqual(allowed.status, 0, 'unknown shard should still fail after explicit host opt-in');
    assert.match(
      `${allowed.stdout}\n${allowed.stderr}`,
      /Unknown mutation shard/,
    );
  });
}

function assertMutationSuiteRequiresExplicitLaneForNonLocalHosts() {
  const isolatedEnvFile = path.join(
    os.tmpdir(),
    `belluga-nav-policy-mutation-lane-${process.pid}-${Date.now()}.env`,
  );
  const result = spawnSmokeScriptForPolicyTest(
    'mutation',
    {
      NAV_LOCAL_ENV_FILE: isolatedEnvFile,
      NAV_WEB_TEST_TYPE: 'mutation',
      NAV_LANDLORD_URL: 'https://belluga.space',
      NAV_TENANT_URL: 'https://guarappari.belluga.space',
      NAV_ADMIN_EMAIL: 'policy@example.test',
      NAV_ADMIN_PASSWORD: 'policy-secret',
      NAV_WEB_ALLOW_NONLOCAL_MUTATION_HOSTS: '1',
      PLAYWRIGHT_IGNORE_HTTPS_ERRORS: 'true',
      NAV_WEB_SHARD: 'missing',
    },
  );
  assert.notStrictEqual(
    result.status,
    0,
    'mutation must require explicit lane when targeting non-local hosts',
  );
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /mutation suite requires an explicit NAV_DEPLOY_LANE contract when targeting non-local hosts or opting into non-local mutation hosts/,
  );
}

function assertMutationSuiteRejectsBlankExplicitLaneForNonLocalHosts() {
  const isolatedEnvFile = path.join(
    os.tmpdir(),
    `belluga-nav-policy-mutation-blank-lane-${process.pid}-${Date.now()}.env`,
  );
  const result = spawnSmokeScriptForPolicyTest(
    'mutation',
    {
      NAV_LOCAL_ENV_FILE: isolatedEnvFile,
      NAV_WEB_TEST_TYPE: 'mutation',
      NAV_DEPLOY_LANE: '',
      NAV_LANDLORD_URL: 'https://belluga.space',
      NAV_TENANT_URL: 'https://guarappari.belluga.space',
      NAV_ADMIN_EMAIL: 'policy@example.test',
      NAV_ADMIN_PASSWORD: 'policy-secret',
      NAV_WEB_ALLOW_NONLOCAL_MUTATION_HOSTS: '1',
      PLAYWRIGHT_IGNORE_HTTPS_ERRORS: 'true',
      NAV_WEB_SHARD: 'missing',
    },
  );
  assert.notStrictEqual(
    result.status,
    0,
    'blank mutation lane must not satisfy the explicit non-local mutation contract',
  );
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /mutation suite requires an explicit NAV_DEPLOY_LANE contract when targeting non-local hosts or opting into non-local mutation hosts/,
  );
}

function assertSmokeRunnerRejectsSuiteTypeMismatch() {
  const result = spawnSmokeScriptForPolicyTest(
    'mutation',
    {
      NAV_WEB_TEST_TYPE: 'readonly',
      NAV_DEPLOY_LANE: 'dev',
      NAV_WEB_SHARD: 'missing',
      NAV_ADMIN_EMAIL: 'policy@example.test',
      NAV_ADMIN_PASSWORD: 'policy-secret',
      NAV_LANDLORD_URL: 'http://localhost',
      NAV_TENANT_URL: 'http://localhost',
      PLAYWRIGHT_IGNORE_HTTPS_ERRORS: 'true',
    },
  );
  assert.notStrictEqual(
    result.status,
    0,
    'smoke runner must reject caller-supplied suite/env mismatches',
  );
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /NAV_WEB_TEST_TYPE=readonly does not match requested suite 'mutation'/,
  );
}

function assertDirectPlaywrightMutationFailsClosedOnMain() {
  const result = spawnDirectPlaywrightContractProbe(
    ['test', '--config', './playwright.config.js', '--grep', '@mutation', '--list'],
    {
      NAV_WEB_TEST_TYPE: 'mutation',
      NAV_DEPLOY_LANE: 'main',
      NAV_TENANT_URL: 'https://guarappari.belluga.space',
      NAV_ADMIN_EMAIL: 'policy@example.test',
      NAV_ADMIN_PASSWORD: 'policy-secret',
      NAV_WEB_ALLOW_NONLOCAL_MUTATION_HOSTS: '1',
    },
  );
  assert.notStrictEqual(
    result.status,
    0,
    'direct Playwright mutation listing on main must fail closed',
  );
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /mutation suite is forbidden on main lane by policy/,
  );
}

function assertDirectPlaywrightMutationRequiresExplicitLaneForNonLocalHosts() {
  const result = spawnDirectPlaywrightContractProbe(
    ['test', '--config', './playwright.config.js', '--grep', '@mutation', '--list'],
    {
      NAV_WEB_TEST_TYPE: 'mutation',
      GITHUB_REF_NAME: 'stage',
      NAV_TENANT_URL: 'https://guarappari.belluga.space',
      NAV_ADMIN_EMAIL: 'policy@example.test',
      NAV_ADMIN_PASSWORD: 'policy-secret',
      NAV_WEB_ALLOW_NONLOCAL_MUTATION_HOSTS: '1',
    },
  );
  assert.notStrictEqual(
    result.status,
    0,
    'direct Playwright mutation listing without explicit lane must fail closed',
  );
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /mutation suite requires explicit NAV_DEPLOY_LANE when targeting non-local hosts or opting into non-local mutation hosts/,
  );
}

function assertDirectPlaywrightMutationRejectsDeployLaneOnlyForNonLocalHosts() {
  const result = spawnDirectPlaywrightContractProbe(
    ['test', '--config', './playwright.config.js', '--grep', '@mutation', '--list'],
    {
      NAV_WEB_TEST_TYPE: 'mutation',
      DEPLOY_LANE: 'stage',
      NAV_TENANT_URL: 'https://guarappari.belluga.space',
      NAV_ADMIN_EMAIL: 'policy@example.test',
      NAV_ADMIN_PASSWORD: 'policy-secret',
      NAV_WEB_ALLOW_NONLOCAL_MUTATION_HOSTS: '1',
    },
  );
  assert.notStrictEqual(
    result.status,
    0,
    'DEPLOY_LANE-only mutation listing must not satisfy the explicit lane contract',
  );
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /mutation suite requires explicit NAV_DEPLOY_LANE when targeting non-local hosts or opting into non-local mutation hosts/,
  );
}

function assertDirectPlaywrightMutationRejectsBlankExplicitLaneForNonLocalHosts() {
  const result = spawnDirectPlaywrightContractProbe(
    ['test', '--config', './playwright.config.js', '--grep', '@mutation', '--list'],
    {
      NAV_WEB_TEST_TYPE: 'mutation',
      NAV_DEPLOY_LANE: '   ',
      NAV_TENANT_URL: 'https://guarappari.belluga.space',
      NAV_ADMIN_EMAIL: 'policy@example.test',
      NAV_ADMIN_PASSWORD: 'policy-secret',
      NAV_WEB_ALLOW_NONLOCAL_MUTATION_HOSTS: '1',
    },
  );
  assert.notStrictEqual(
    result.status,
    0,
    'direct Playwright mutation listing with blank explicit lane must fail closed',
  );
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /mutation suite requires explicit NAV_DEPLOY_LANE when targeting non-local hosts or opting into non-local mutation hosts/,
  );
}

function assertDirectPlaywrightMutationRejectsGrepSubset() {
  const result = spawnDirectPlaywrightContractProbe(
    [
      'test',
      '--config',
      './playwright.config.js',
      '--grep',
      '@mutation.*directions brand',
      '--list',
    ],
    {
      NAV_WEB_TEST_TYPE: 'mutation',
      NAV_DEPLOY_LANE: 'stage',
      NAV_TENANT_URL: 'https://guarappari.belluga.space',
      NAV_ADMIN_EMAIL: 'policy@example.test',
      NAV_ADMIN_PASSWORD: 'policy-secret',
      NAV_WEB_ALLOW_NONLOCAL_MUTATION_HOSTS: '1',
    },
  );
  assert.notStrictEqual(
    result.status,
    0,
    'direct Playwright mutation listing must reject same-suite grep narrowing',
  );
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /mutation suite refuses narrowed grep selector .*canonical suite coverage must match an approved manifest shard or the full suite marker/,
  );
}

function assertIpv6LoopbackCountsAsLocalHostForRunner() {
  const isolatedEnvFile = path.join(
    os.tmpdir(),
    `belluga-nav-policy-ipv6-runner-${process.pid}-${Date.now()}.env`,
  );
  const result = spawnSmokeScriptForPolicyTest(
    'mutation',
    {
      NAV_LOCAL_ENV_FILE: isolatedEnvFile,
      NAV_WEB_TEST_TYPE: 'mutation',
      NAV_LANDLORD_URL: 'http://[::1]',
      NAV_TENANT_URL: 'http://[::1]',
      NAV_ADMIN_EMAIL: 'policy@example.test',
      NAV_ADMIN_PASSWORD: 'policy-secret',
      PLAYWRIGHT_IGNORE_HTTPS_ERRORS: 'true',
      NAV_WEB_SHARD: 'missing',
    },
  );
  assert.notStrictEqual(
    result.status,
    0,
    'IPv6 loopback runner probe should still fail on the synthetic missing shard',
  );
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /Unknown mutation shard/,
  );
  assert.doesNotMatch(
    `${result.stdout}\n${result.stderr}`,
    /refuses non-local host|requires an explicit NAV_DEPLOY_LANE contract/,
  );
}

function assertIpv6LoopbackCountsAsLocalHostForDirectPlaywright() {
  const result = spawnDirectPlaywrightContractProbe(
    ['test', '--config', './playwright.config.js', '--grep', '@mutation', '--list'],
    {
      NAV_WEB_TEST_TYPE: 'mutation',
      NAV_LANDLORD_URL: 'http://[::1]',
      NAV_TENANT_URL: 'http://[::1]',
      NAV_ADMIN_EMAIL: 'policy@example.test',
      NAV_ADMIN_PASSWORD: 'policy-secret',
    },
  );
  assert.strictEqual(
    result.status,
    0,
    `direct Playwright mutation listing should treat IPv6 loopback as local.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
}

function assertDirectPlaywrightReadonlyRejectsMutationSpec() {
  const result = spawnDirectPlaywrightContractProbe(
    [
      'test',
      path.join('..', 'web_app_tests', 'directions_brand_visual.spec.js'),
      '--config',
      './playwright.config.js',
      '--list',
    ],
    {
      NAV_WEB_TEST_TYPE: 'readonly',
      NAV_DEPLOY_LANE: 'main',
      NAV_TENANT_URL: 'https://guarappari.belluga.space',
    },
  );
  assert.notStrictEqual(
    result.status,
    0,
    'direct Playwright readonly listing must reject explicit mutation-tagged specs',
  );
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /readonly suite refuses explicit selector .*directions_brand_visual\.spec\.js.*canonical suite coverage must be selected by the runner\/manifest/,
  );
}

function assertDirectPlaywrightReadonlyRejectsReadonlySpecSubset() {
  const result = spawnDirectPlaywrightContractProbe(
    [
      'test',
      path.join('..', 'web_app_tests', 'favorite_auth_gate_runtime.readonly.spec.js'),
      '--config',
      './playwright.config.js',
      '--list',
    ],
    {
      NAV_WEB_TEST_TYPE: 'readonly',
      NAV_DEPLOY_LANE: 'main',
      NAV_TENANT_URL: 'https://guarappari.belluga.space',
    },
  );
  assert.notStrictEqual(
    result.status,
    0,
    'direct Playwright readonly listing must reject same-suite explicit spec subsets',
  );
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /readonly suite refuses explicit selector .*favorite_auth_gate_runtime\.readonly\.spec\.js.*canonical suite coverage must be selected by the runner\/manifest/,
  );
}

function assertDirectPlaywrightReadonlyRejectsTestDirRelativeSpecSelector() {
  const result = spawnDirectPlaywrightContractProbe(
    [
      'test',
      'favorite_auth_gate_runtime.readonly.spec.js',
      '--config',
      './playwright.config.js',
      '--list',
    ],
    {
      NAV_WEB_TEST_TYPE: 'readonly',
      NAV_DEPLOY_LANE: 'main',
      NAV_TENANT_URL: 'https://guarappari.belluga.space',
    },
  );
  assert.notStrictEqual(
    result.status,
    0,
    'direct Playwright readonly listing must reject testDir-relative spec selectors',
  );
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /readonly suite refuses explicit selector .*favorite_auth_gate_runtime\.readonly\.spec\.js.*canonical suite coverage must be selected by the runner\/manifest/,
  );
}

function assertDirectPlaywrightReadonlyRejectsDirectorySelector() {
  const result = spawnDirectPlaywrightContractProbe(
    [
      'test',
      '../web_app_tests',
      '--config',
      './playwright.config.js',
      '--grep',
      '@readonly',
      '--list',
    ],
    {
      NAV_WEB_TEST_TYPE: 'readonly',
      NAV_DEPLOY_LANE: 'main',
      NAV_TENANT_URL: 'https://guarappari.belluga.space',
    },
  );
  assert.notStrictEqual(
    result.status,
    0,
    'direct Playwright readonly listing must reject directory selectors',
  );
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /readonly suite refuses explicit selector .*web_app_tests.*canonical suite coverage must be selected by the runner\/manifest/,
  );
}

function assertDirectPlaywrightReadonlyRejectsMutationGrep() {
  const result = spawnDirectPlaywrightContractProbe(
    ['test', '--config', './playwright.config.js', '--grep', '@mutation', '--list'],
    {
      NAV_WEB_TEST_TYPE: 'readonly',
      NAV_DEPLOY_LANE: 'main',
      NAV_TENANT_URL: 'https://guarappari.belluga.space',
    },
  );
  assert.notStrictEqual(
    result.status,
    0,
    'direct Playwright readonly listing must reject foreign grep selectors',
  );
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /readonly suite requires grep selectors to include @readonly|readonly suite refuses grep selectors that target @mutation/,
  );
}

function assertDirectPlaywrightReadonlyRejectsGrepInvertSuiteTrim() {
  const result = spawnDirectPlaywrightContractProbe(
    [
      'test',
      '--config',
      './playwright.config.js',
      '--grep',
      '@readonly',
      '--grep-invert',
      'taxonomy display snapshots',
      '--list',
    ],
    {
      NAV_WEB_TEST_TYPE: 'readonly',
      NAV_DEPLOY_LANE: 'main',
      NAV_TENANT_URL: 'https://guarappari.belluga.space',
    },
  );
  assert.notStrictEqual(
    result.status,
    0,
    'direct Playwright readonly listing must reject grep-invert suite trimming',
  );
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /readonly suite refuses grep-invert selectors because they can trim canonical suite coverage/,
  );
}

function assertDirectPlaywrightReadonlyRejectsGrepSubset() {
  const result = spawnDirectPlaywrightContractProbe(
    [
      'test',
      '--config',
      './playwright.config.js',
      '--grep',
      '@readonly.*taxonomy display snapshots',
      '--list',
    ],
    {
      NAV_WEB_TEST_TYPE: 'readonly',
      NAV_DEPLOY_LANE: 'main',
      NAV_TENANT_URL: 'https://guarappari.belluga.space',
    },
  );
  assert.notStrictEqual(
    result.status,
    0,
    'direct Playwright readonly listing must reject same-suite grep narrowing',
  );
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /readonly suite refuses narrowed grep selector .*canonical suite coverage must not be trimmed by ad-hoc grep filters/,
  );
}

function assertStageFixtureOwnedFiltersUseCanonicalKeysOnly() {
  const ownedEvents = filterOwnedEventRows([
    {
      id: 'foreign-type-only',
      title: 'Foreign visible title',
      slug: 'foreign-visible-title',
      type: { slug: stageTaxonomyFixture.eventTypeSlug },
    },
    {
      id: 'owned-event-by-title',
      title: stageTaxonomyFixture.eventTitle,
      slug: 'different-stage-fixture-route',
      type: { slug: 'foreign_event_type' },
    },
    {
      id: 'owned-event-by-slug',
      title: 'Foreign visible title',
      slug: stageTaxonomyFixture.eventSlug,
      type: { slug: 'foreign_event_type' },
    },
    {
      id: 'owned-event-by-suffixed-slug',
      title: 'Foreign visible title',
      slug: `${stageTaxonomyFixture.eventSlug}-rollback-proof`,
      type: { slug: 'foreign_event_type' },
    },
  ]);
  assert.deepStrictEqual(
    ownedEvents.map((row) => row.id).sort(),
    ['owned-event-by-slug', 'owned-event-by-suffixed-slug'],
    'stage fixture cleanup must identify the current run by canonical event slug anchors only, including backend-generated suffixes, never by mutable title or foreign type.',
  );

  const ownedProfiles = filterOwnedProfileRows([
    {
      id: 'foreign-display-name',
      display_name: `Foreign ${stageTaxonomyFixture.profileName}`,
      slug: 'foreign-display-name',
      profile_type: 'foreign_profile_type',
    },
    {
      id: 'owned-profile-by-slug',
      display_name: 'Another visible name',
      slug: stageTaxonomyFixture.profileSlug,
      profile_type: 'foreign_profile_type',
    },
    {
      id: 'owned-profile-by-related-slug',
      display_name: 'Another visible name',
      slug: stageTaxonomyFixture.relatedProfileSlug,
      profile_type: 'foreign_profile_type',
    },
    {
      id: 'owned-profile-by-suffixed-slug',
      display_name: 'Another visible name',
      slug: `${stageTaxonomyFixture.profileSlug}-rollback-proof`,
      profile_type: 'foreign_profile_type',
    },
    {
      id: 'owned-profile-by-related-suffixed-slug',
      display_name: 'Another visible name',
      slug: `${stageTaxonomyFixture.relatedProfileSlug}-rollback-proof`,
      profile_type: 'foreign_profile_type',
    },
    {
      id: 'owned-profile-by-display-name',
      display_name: stageTaxonomyFixture.relatedProfileName,
      slug: 'different-related-profile-slug',
      profile_type: 'foreign_profile_type',
    },
    {
      id: 'owned-profile-by-type',
      display_name: 'Another visible name',
      slug: 'another-slug',
      profile_type: stageTaxonomyFixture.profileType,
    },
  ]);
  assert.deepStrictEqual(
    ownedProfiles.map((row) => row.id).sort(),
    [
      'owned-profile-by-related-slug',
      'owned-profile-by-related-suffixed-slug',
      'owned-profile-by-slug',
      'owned-profile-by-suffixed-slug',
    ],
    'stage fixture cleanup must identify the current run by canonical profile slug anchors only, including backend-generated suffixes, never by mutable display name or profile type.',
  );
}

function assertStageFixtureRunIdIsolation() {
  assert.strictEqual(
    sanitizeRunId(' Stage Run 42 / Alpha '),
    'stage-run-42-alpha',
    'stage fixture run-id sanitizer must normalize mixed punctuation and whitespace',
  );
  assert.ok(
    stageTaxonomyFixture.taxonomySlug.endsWith(`_${stageTaxonomyRunKey}`),
    'stage fixture taxonomy slug must include the sanitized run key',
  );
  assert.ok(
    stageTaxonomyFixture.eventTypeSlug.endsWith(`_${stageTaxonomyRunKey}`),
    'stage fixture event type slug must include the sanitized run key',
  );
  assert.match(
    stageTaxonomyFixture.eventSlug,
    new RegExp(`-${stageTaxonomyRunKey}$`),
    'stage fixture event slug must include the sanitized run key',
  );
  assert.match(
    stageTaxonomyFixture.profileSlug,
    new RegExp(`-${stageTaxonomyRunKey}$`),
    'stage fixture profile slug must include the sanitized run key',
  );
}

function assertStageFixturePaginationHelperIsExhaustive() {
  assert.strictEqual(
    shouldContinuePagedFetch({
      payload: { last_page: 3 },
      pageRows: [{ id: 1 }],
      pageNumber: 1,
      pageSize: 50,
    }),
    true,
    'pagination helper must continue when last_page reports more pages',
  );
  assert.strictEqual(
    shouldContinuePagedFetch({
      payload: { last_page: 3 },
      pageRows: [{ id: 1 }],
      pageNumber: 3,
      pageSize: 50,
    }),
    false,
    'pagination helper must stop at the reported last page',
  );
  assert.strictEqual(
    shouldContinuePagedFetch({
      payload: { next_page_url: 'https://example.test/page/2' },
      pageRows: [{ id: 1 }],
      pageNumber: 1,
      pageSize: 50,
    }),
    true,
    'pagination helper must continue when next_page_url exists',
  );
  assert.throws(
    () => shouldContinuePagedFetch({
      payload: {},
      pageRows: new Array(50).fill({ id: 1 }),
      pageNumber: 1,
      pageSize: 50,
    }),
    /Canonical pagination metadata is missing/,
    'pagination helper must throw when canonical pagination metadata is absent on a full page',
  );
  assert.strictEqual(
    shouldContinuePagedFetch({
      payload: {},
      pageRows: new Array(49).fill({ id: 1 }),
      pageNumber: 1,
      pageSize: 50,
    }),
    false,
    'pagination helper must stop when canonical pagination metadata is absent',
  );
}

function collectTaggedTitles(tag) {
  const sourcesRoot = path.join(repoRoot, 'tools', 'flutter', 'web_app_tests');
  const titles = [];
  const titleRegex = /test\(\s*(['"`])([\s\S]*?)\1/g;

  for (const sourcePath of listWebNavigationSources(sourcesRoot)) {
    const source = fs.readFileSync(sourcePath, 'utf8');
    let match;
    while ((match = titleRegex.exec(source))) {
      if (match[2].includes(tag)) {
        titles.push(match[2]);
      }
    }
  }

  return titles.sort();
}

function assertCheckedInManifestMatchesCurrentSpecTitles() {
  const checkedInManifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'navigation_mutation_shards.json'), 'utf8'),
  );

  const readonlyActual = collectTaggedTitles('@readonly');
  const readonlyExpected = [...checkedInManifest.readonly.expected_titles].sort();
  assert.deepStrictEqual(
    readonlyActual,
    readonlyExpected,
    'checked-in readonly manifest must match current @readonly spec titles exactly',
  );

  const diagnosticActual = collectTaggedTitles('@diagnostic');
  const diagnosticExpected = [...checkedInManifest.diagnostic.expected_titles].sort();
  assert.deepStrictEqual(
    diagnosticActual,
    diagnosticExpected,
    'checked-in diagnostic manifest must match current @diagnostic spec titles exactly',
  );

  const mutationActual = collectTaggedTitles('@mutation');
  const mutationExpected = Object.values(checkedInManifest.mutation.shards)
    .flatMap((shard) => shard.expected_titles || [])
    .sort();
  assert.deepStrictEqual(
    mutationActual,
    mutationExpected,
    'checked-in mutation shard manifest must cover current @mutation spec titles exactly once',
  );

  for (const [shardName, shard] of Object.entries(checkedInManifest.mutation.shards)) {
    const shardRegex = new RegExp(shard.grep_extra);
    const selected = mutationActual.filter((title) => shardRegex.test(title)).sort();
    const expected = [...(shard.expected_titles || [])].sort();
    assert.deepStrictEqual(
      selected,
      expected,
      `mutation shard "${shardName}" grep_extra must select exactly its expected titles`,
    );
  }
}

assertGuardPassesCleanFixture();
assertStageMutationWorkflowSuppliesRuntimeCredentials();
assertStageWorkflowIntentionallyOmitsDiagnosticSuite();
assertPublishedLaneProofRemainsPipelineOnly();
assertLocalNavigationEnvAutomationIsSafe();
assertInviteRecoverableFallbackPublishedSmokeIsRemoved();
assertReadonlyFavoriteSpecMessageMatchesSuite();
assertRunnerAlwaysExecutesHarnessPolicyTest();
assertSmokeRunnerIsolatesOutputsPerInvocation();
assertWorkflowTimeoutsCoverWrapperBudgets();
assertLocalDiagnosticMutationHelperUsesExplicitArtisanCommand();
assertAdminSessionSecretsAreDerivedFromLogin();
assertSmokeRunnerLoadsLocalNavigationEnv();
assertSmokeRunnerPreservesExplicitNonLocalOptIn();
assertRunWithTimeoutPropagatesWrappedExitStatus();
assertDiagnosticSuiteRequiresExplicitLocalMutationContract();
assertDiagnosticSuiteRejectsEnvFileOnlyContract();
assertNonLocalMutationHostsRequireExplicitOptIn();
assertMutationSuiteRequiresExplicitLaneForNonLocalHosts();
assertMutationSuiteRejectsBlankExplicitLaneForNonLocalHosts();
assertSmokeRunnerRejectsSuiteTypeMismatch();
assertDirectPlaywrightMutationFailsClosedOnMain();
assertDirectPlaywrightMutationRequiresExplicitLaneForNonLocalHosts();
assertDirectPlaywrightMutationRejectsDeployLaneOnlyForNonLocalHosts();
assertDirectPlaywrightMutationRejectsBlankExplicitLaneForNonLocalHosts();
assertDirectPlaywrightMutationRejectsGrepSubset();
assertIpv6LoopbackCountsAsLocalHostForRunner();
assertIpv6LoopbackCountsAsLocalHostForDirectPlaywright();
assertDirectPlaywrightReadonlyRejectsMutationSpec();
assertDirectPlaywrightReadonlyRejectsReadonlySpecSubset();
assertDirectPlaywrightReadonlyRejectsTestDirRelativeSpecSelector();
assertDirectPlaywrightReadonlyRejectsDirectorySelector();
assertDirectPlaywrightReadonlyRejectsMutationGrep();
assertDirectPlaywrightReadonlyRejectsGrepSubset();
assertDirectPlaywrightReadonlyRejectsGrepInvertSuiteTrim();
assertFixtureBootstrapRequiresExplicitMutationContract();
assertFixtureBootstrapRequiresExplicitRunIdOnStage();
assertLocalDiagnosticMutationHelperRequiresExplicitNonLocalOptIn();
assertStageFixtureOwnedFiltersUseCanonicalKeysOnly();
assertStageFixtureRunIdIsolation();
assertStageFixturePaginationHelperIsExhaustive();
assertCheckedInManifestMatchesCurrentSpecTitles();
assertAccountOnboardingCleanupContractPasses();
assertPublicTaxonomyCleanupResolutionContractPasses();

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
  'credential-destructure-fallback',
  "const { NAV_ADMIN_" + "EMAIL = 'admin@example.test' } = process" + ".env;\n",
  /credential fallbacks/,
);

assertFailsForSource(
  'dropdown-text-fallback',
  "async function bad(page, optionText) { await page." + "getByText(optionText).click(); }\n",
  /dropdown selection must use semantic option\/menuitem locators/,
);

assertFailsForSource(
  'dropdown-text-fallback-nonpage',
  "async function bad(menu, optionText) { await menu." +
    "getByText(optionText)" +
    ".click(); }\n",
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

assertFailsForSource(
  'local-dropdown-helper-const',
  'const ' + 'selectDropdown' + 'Option = async page => page;\n',
  /dropdown helper logic must be centralized/,
);

assertFailsForSource(
  'local-dropdown-helper-export',
  'exports.' + 'selectDropdown' + 'Option = async page => page;\n',
  /dropdown helper logic must be centralized/,
);

assertFailsForSource(
  'evaluated-click-bare-arrow',
  'async function bad(button) { await button.' +
    'evaluate(node => node.' +
    'click()); }\n',
  /locator\.evaluate\(\.\.\.click\(\)\)/,
);

assertFailsForSource(
  'evaluated-click-function-callback',
  'async function bad(button) { await button.' +
    'evaluate(function (node) { node' +
    '.' +
    'click(); }); }\n',
  /locator\.evaluate\(\.\.\.click\(\)\)/,
);

assertFailsForSource(
  'evaluated-click-long-body',
  [
    'async function bad(button) {',
    '  await button.evaluate(async (node) => {',
    '    const payload = {',
    "      alpha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',",
    "      beta: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',",
    "      gamma: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',",
    '    };',
    '    await Promise.resolve(payload);',
    '    node' + '.click();',
    '  });',
    '}',
    '',
  ].join('\n'),
  /locator\.evaluate\(\.\.\.click\(\)\)/,
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
  diagnostic: {
    expected_titles: ['@diagnostic alpha path'],
  },
  readonly: {
    expected_titles: ['@readonly alpha path'],
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

assertDiagnosticValidationFails({
  manifest,
  list: '  test › @diagnostic beta path\n',
  expectedMessage: /Missing expected titles/,
});

assertReadonlyValidationFails({
  manifest,
  list: '  test › @readonly beta path\n',
  expectedMessage: /Missing expected titles/,
});

const rawGrepBypassResult = spawnSmokeScriptForPolicyTest(
  'mutation',
  {
    NAV_WEB_TEST_TYPE: 'mutation',
    NAV_DEPLOY_LANE: 'orchestrator',
    NAV_ADMIN_EMAIL: 'policy@example.test',
    NAV_ADMIN_PASSWORD: 'policy-secret',
    NAV_WEB_ALLOW_RAW_GREP: '1',
  },
);
assert.notStrictEqual(rawGrepBypassResult.status, 0, 'raw grep bypass flag must fail closed');
assert.match(
  `${rawGrepBypassResult.stdout}\n${rawGrepBypassResult.stderr}`,
  /NAV_WEB_ALLOW_RAW_GREP is not allowed/,
);

const rawGrepResult = spawnSmokeScriptForPolicyTest(
  'mutation',
  {
    NAV_WEB_TEST_TYPE: 'mutation',
    NAV_DEPLOY_LANE: 'orchestrator',
    NAV_ADMIN_EMAIL: 'policy@example.test',
    NAV_ADMIN_PASSWORD: 'policy-secret',
    NAV_WEB_GREP_EXTRA: 'manual',
  },
);
assert.notStrictEqual(rawGrepResult.status, 0, 'raw grep must fail closed');
assert.match(
  `${rawGrepResult.stdout}\n${rawGrepResult.stderr}`,
  /NAV_WEB_GREP_EXTRA is ad-hoc/,
);

console.log('Navigation harness policy regression tests passed.');
function assertAccountOnboardingCleanupContractPasses() {
  const result = spawnSync(
    'node',
    [path.join(__dirname, 'account_onboarding_cleanup_contract_test.cjs')],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    },
  );
  assert.strictEqual(
    result.status,
    0,
    `account onboarding cleanup contract must pass.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
}

function assertPublicTaxonomyCleanupResolutionContractPasses() {
  const result = spawnSync(
    'node',
    [path.join(__dirname, 'public_taxonomy_cleanup_resolution_contract_test.cjs')],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    },
  );
  assert.strictEqual(
    result.status,
    0,
    `public taxonomy cleanup resolution contract must pass.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
}
