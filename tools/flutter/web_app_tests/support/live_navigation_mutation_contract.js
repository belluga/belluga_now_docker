const fs = require('fs');
const path = require('path');

const suiteKinds = ['readonly', 'mutation', 'diagnostic'];

function normalizedLocalHosts() {
  return (
    process.env.NAV_WEB_LOCAL_MUTATION_ALLOWED_HOSTS ||
    'localhost,127.0.0.1,::1'
  )
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function readUrlHost(rawValue, label) {
  const value = rawValue?.toString().trim();
  if (!value) {
    return '';
  }

  try {
    return new URL(value).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch (error) {
    throw new Error(`${label} must be a valid absolute URL.`);
  }
}

function readHost(rawValue) {
  return rawValue?.toString().trim().toLowerCase().replace(/^\[|\]$/g, '') || '';
}

function requireExplicitNonLocalMutationOptIn({
  scriptLabel,
  urlEnvNames = [],
  hostEnvNames = [],
}) {
  const allowedHosts = normalizedLocalHosts();
  const allowNonLocal =
    process.env.NAV_WEB_ALLOW_NONLOCAL_MUTATION_HOSTS?.toString().trim() === '1';
  const discoveredHosts = [];

  for (const envName of urlEnvNames) {
    const host = readUrlHost(process.env[envName], envName);
    if (host) {
      discoveredHosts.push({ host, source: envName });
    }
  }

  for (const envName of hostEnvNames) {
    const host = readHost(process.env[envName]);
    if (host) {
      discoveredHosts.push({ host, source: envName });
    }
  }

  for (const { host, source } of discoveredHosts) {
    if (allowedHosts.includes(host)) {
      continue;
    }
    if (!allowNonLocal) {
      throw new Error(
        `${scriptLabel} refuses non-local target host "${host}" from ${source} without explicit NAV_WEB_ALLOW_NONLOCAL_MUTATION_HOSTS=1.`,
      );
    }
  }
}

function requireLiveMutationContract({
  scriptLabel,
  allowedLanes,
  urlEnvNames = ['NAV_TENANT_URL'],
  hostEnvNames = [],
  requireAdminCredentials = true,
  requireRuntimeMutationFlag = false,
}) {
  const deployLane = process.env.NAV_DEPLOY_LANE?.toString().trim() || '';
  if (!allowedLanes.includes(deployLane)) {
    throw new Error(
      `${scriptLabel} is restricted to NAV_DEPLOY_LANE=${allowedLanes.join('|')}.`,
    );
  }

  if (requireAdminCredentials) {
    const email = process.env.NAV_ADMIN_EMAIL?.toString().trim() || '';
    const password = process.env.NAV_ADMIN_PASSWORD?.toString().trim() || '';
    if (!email || !password) {
      throw new Error(
        `${scriptLabel} requires NAV_ADMIN_EMAIL and NAV_ADMIN_PASSWORD.`,
      );
    }
  }

  if (requireRuntimeMutationFlag) {
    if (process.env.NAV_RUNTIME_DB_MUTATION_ALLOWED !== '1') {
      throw new Error(
        `${scriptLabel} requires explicit NAV_RUNTIME_DB_MUTATION_ALLOWED=1.`,
      );
    }
  }

  requireExplicitNonLocalMutationOptIn({
    scriptLabel,
    urlEnvNames,
    hostEnvNames,
  });
}

function resolveLane() {
  return (
    process.env.NAV_DEPLOY_LANE ||
    process.env.DEPLOY_LANE ||
    process.env.GITHUB_REF_NAME ||
    'local'
  )
    .toString()
    .trim()
    .toLowerCase();
}

function resolveExplicitNavLane() {
  return (process.env.NAV_DEPLOY_LANE || '')
    .toString()
    .trim()
    .toLowerCase();
}

function resolveSuiteType() {
  return (process.env.NAV_WEB_TEST_TYPE || '')
    .toString()
    .trim()
    .toLowerCase();
}

function expectedSuiteMarker(suiteType) {
  // Fixture-owned readonly tests are deliberately outside the full readonly
  // package. They are selected by their approved manifest shard instead.
  return suiteType === 'readonly' ? '@readonly(?:\\s|$)' : `@${suiteType}`;
}

function allowedFullSuiteGrepValues(suiteType) {
  // Playwright combines CLI grep with the config grep. Keep the legacy
  // @readonly CLI spelling admissible for direct config probes; the config
  // still contributes the boundary-aware full-suite selector.
  return suiteType === 'readonly'
    ? [expectedSuiteMarker(suiteType), '@readonly']
    : [expectedSuiteMarker(suiteType)];
}

function allowedCanonicalShardedGrepValues(suiteType) {
  const manifestPath = path.resolve(__dirname, '..', 'navigation_mutation_shards.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const shards = manifest?.[suiteType]?.shards || {};
  return Object.values(shards)
    .map((shard) => {
      const explicit = shard?.grep?.toString().trim();
      if (explicit) {
        return explicit;
      }
      const grepExtra = shard?.grep_extra?.toString().trim();
      return grepExtra ? `${expectedSuiteMarker(suiteType)}.*${grepExtra}` : '';
    })
    .filter(Boolean);
}

function canonicalShardForGrep(suiteType, grep) {
  const manifestPath = path.resolve(__dirname, '..', 'navigation_mutation_shards.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const shards = manifest?.[suiteType]?.shards || {};
  for (const shard of Object.values(shards)) {
    const explicit = shard?.grep?.toString().trim();
    const fallback = shard?.grep_extra?.toString().trim();
    const selector = explicit || (fallback ? `${expectedSuiteMarker(suiteType)}.*${fallback}` : '');
    if (selector === grep) {
      return shard;
    }
  }
  return null;
}

function assertCanonicalShardRuntimeContract(suiteType, grep) {
  const shard = canonicalShardForGrep(suiteType, grep);
  if (!shard) {
    return;
  }
  const allowedLanes = Array.isArray(shard.allowed_lanes) ? shard.allowed_lanes : [];
  const lane = resolveLane();
  if (allowedLanes.length > 0 && !allowedLanes.includes(lane)) {
    throw new Error(
      `Playwright web navigation ${suiteType} shard is restricted to NAV_DEPLOY_LANE=${allowedLanes.join('|')}.`,
    );
  }
  for (const name of Array.isArray(shard.required_env) ? shard.required_env : []) {
    if (!process.env[name]?.toString().trim()) {
      throw new Error(
        `Playwright web navigation ${suiteType} shard requires ${name}; no ambient fixture fallback is allowed.`,
      );
    }
  }
  const requiredValues = shard.required_env_values || {};
  for (const [name, expected] of Object.entries(requiredValues)) {
    const actual = process.env[name]?.toString().trim() || '';
    if (actual !== expected) {
      throw new Error(
        `Playwright web navigation ${suiteType} shard requires ${name}=${expected}; no ambient fixture fallback is allowed.`,
      );
    }
  }
}

function extractSuiteMarkers(source) {
  const markers = new Set();
  const titleRegex = /test\(\s*(['"`])([\s\S]*?)\1/g;
  let match;
  while ((match = titleRegex.exec(source))) {
    const title = match[2];
    const tagMatches = title.match(/@(readonly|mutation|diagnostic)\b/g) || [];
    for (const tag of tagMatches) {
      markers.add(tag.slice(1));
    }
  }
  return markers;
}

function parsePlaywrightCliContext(argv = process.argv.slice(2)) {
  const args = [...argv];
  const testIndex = args.indexOf('test');
  const relevantArgs = testIndex >= 0 ? args.slice(testIndex + 1) : args;
  const grepValues = [];
  const grepInvertValues = [];
  const selectorPaths = [];
  const optionsWithValues = new Set([
    '--config',
    '--grep',
    '-g',
    '--grep-invert',
    '--project',
    '--workers',
    '-j',
    '--output',
    '--reporter',
    '--retries',
    '--timeout',
  ]);

  for (let index = 0; index < relevantArgs.length; index += 1) {
    const arg = relevantArgs[index];
    if (!arg) {
      continue;
    }

    if (arg === '--grep' || arg === '-g') {
      const nextValue = relevantArgs[index + 1];
      if (nextValue) {
        grepValues.push(nextValue);
        index += 1;
      }
      continue;
    }

    if (arg.startsWith('--grep=')) {
      grepValues.push(arg.slice('--grep='.length));
      continue;
    }

    if (arg === '--grep-invert') {
      const nextValue = relevantArgs[index + 1];
      if (nextValue) {
        grepInvertValues.push(nextValue);
        index += 1;
      }
      continue;
    }

    if (arg.startsWith('--grep-invert=')) {
      grepInvertValues.push(arg.slice('--grep-invert='.length));
      continue;
    }

    if (optionsWithValues.has(arg)) {
      index += 1;
      continue;
    }

    if (arg.startsWith('--')) {
      continue;
    }

    selectorPaths.push(arg);
  }

  return {
    grepValues,
    grepInvertValues,
    selectorPaths,
  };
}

function assertGrepValuesCompatibleWithSuite(suiteType, grepValues) {
  if (grepValues.length === 0) {
    return;
  }

  const expectedMarker = expectedSuiteMarker(suiteType);
  const joined = grepValues.join(' ');
  if (grepValues.length !== 1) {
    throw new Error(
      `Playwright web navigation ${suiteType} suite refuses multiple grep selectors because canonical suite coverage must stay deterministic. Received "${joined}".`,
    );
  }
  const normalized = grepValues[0].toString().trim();
  const allowedShards = allowedCanonicalShardedGrepValues(suiteType);
  const allowedFull = allowedFullSuiteGrepValues(suiteType);
  if (
    !joined.includes(expectedMarker) &&
    !(suiteType === 'readonly' && joined.includes('@readonly')) &&
    !allowedShards.includes(normalized)
  ) {
    throw new Error(
      `Playwright web navigation ${suiteType} suite requires grep selectors to include ${expectedMarker}. Received "${joined}".`,
    );
  }

  for (const otherSuite of suiteKinds) {
    if (otherSuite === suiteType) {
      continue;
    }
    if (joined.includes(expectedSuiteMarker(otherSuite))) {
      throw new Error(
        `Playwright web navigation ${suiteType} suite refuses grep selectors that target @${otherSuite}. Received "${joined}".`,
      );
    }
  }

  if (['mutation', 'readonly'].includes(suiteType)) {
    if (allowedFull.includes(normalized)) {
      return;
    }
    if (allowedShards.includes(normalized)) {
      assertCanonicalShardRuntimeContract(suiteType, normalized);
      return;
    }
    throw new Error(
      `Playwright web navigation ${suiteType} suite refuses narrowed grep selector "${normalized}" because canonical suite coverage must match an approved manifest shard or the full suite marker.`,
    );
  }

  if (!allowedFull.includes(normalized)) {
    throw new Error(
      `Playwright web navigation ${suiteType} suite refuses narrowed grep selector "${normalized}" because canonical suite coverage must not be trimmed by ad-hoc grep filters.`,
    );
  }
}

function assertGrepInvertValuesCompatibleWithSuite(suiteType, grepInvertValues) {
  if (grepInvertValues.length === 0) {
    return;
  }

  const joined = grepInvertValues.join(' ');
  throw new Error(
    `Playwright web navigation ${suiteType} suite refuses grep-invert selectors because they can trim canonical suite coverage. Received "${joined}".`,
  );
}

function assertExplicitSelectorsCompatibleWithSuite(suiteType, selectorPaths) {
  for (const selectorPath of selectorPaths) {
    throw new Error(
      `Playwright web navigation ${suiteType} suite refuses explicit selector "${selectorPath}" because canonical suite coverage must be selected by the runner/manifest, not by ad-hoc file paths.`,
    );
  }
}

function hasExplicitLaneContract() {
  return Boolean(process.env.NAV_DEPLOY_LANE?.toString().trim());
}

function requiresExplicitLaneForNonLocalTargets() {
  const allowNonLocal =
    process.env.NAV_WEB_ALLOW_NONLOCAL_MUTATION_HOSTS?.toString().trim() === '1';
  if (allowNonLocal) {
    return true;
  }

  const allowedHosts = normalizedLocalHosts();
  const discoveredHosts = [];
  for (const envName of ['NAV_LANDLORD_URL', 'NAV_TENANT_URL']) {
    const host = readUrlHost(process.env[envName], envName);
    if (host) {
      discoveredHosts.push(host);
    }
  }

  return discoveredHosts.some((host) => !allowedHosts.includes(host));
}

function requirePlaywrightSuiteContract() {
  const suiteType = resolveSuiteType();
  if (!suiteKinds.includes(suiteType)) {
    throw new Error(
      `Playwright web navigation suite requires explicit NAV_WEB_TEST_TYPE=readonly|mutation|diagnostic. Received "${process.env.NAV_WEB_TEST_TYPE ?? ''}".`,
    );
  }
  const cliContext = parsePlaywrightCliContext();
  assertGrepValuesCompatibleWithSuite(suiteType, cliContext.grepValues);
  assertGrepInvertValuesCompatibleWithSuite(
    suiteType,
    cliContext.grepInvertValues,
  );
  assertExplicitSelectorsCompatibleWithSuite(suiteType, cliContext.selectorPaths);

  const lane = resolveLane();
  if (
    suiteType === 'mutation' &&
    requiresExplicitLaneForNonLocalTargets() &&
    !hasExplicitLaneContract()
  ) {
    throw new Error(
      'Playwright web navigation mutation suite requires explicit NAV_DEPLOY_LANE when targeting non-local hosts or opting into non-local mutation hosts.',
    );
  }
  if (suiteType === 'mutation' && lane === 'main') {
    throw new Error(
      'Playwright web navigation mutation suite is forbidden on main lane by policy.',
    );
  }
  if (suiteType === 'diagnostic' && !resolveExplicitNavLane()) {
    throw new Error(
      'Playwright web navigation diagnostic suite requires explicit NAV_DEPLOY_LANE=local.',
    );
  }
  if (suiteType === 'diagnostic' && lane !== 'local') {
    throw new Error(
      'Playwright web navigation diagnostic suite is restricted to NAV_DEPLOY_LANE=local.',
    );
  }

  if (suiteType === 'mutation' || suiteType === 'diagnostic') {
    const email = process.env.NAV_ADMIN_EMAIL?.toString().trim() || '';
    const password = process.env.NAV_ADMIN_PASSWORD?.toString().trim() || '';
    if (!email || !password) {
      throw new Error(
        `Playwright web navigation ${suiteType} suite requires NAV_ADMIN_EMAIL and NAV_ADMIN_PASSWORD.`,
      );
    }

    if (
      suiteType === 'diagnostic' &&
      process.env.NAV_RUNTIME_DB_MUTATION_ALLOWED !== '1'
    ) {
      throw new Error(
        'Playwright web navigation diagnostic suite requires explicit NAV_RUNTIME_DB_MUTATION_ALLOWED=1.',
      );
    }

    requireExplicitNonLocalMutationOptIn({
      scriptLabel: `Playwright web navigation ${suiteType} suite`,
      urlEnvNames: ['NAV_LANDLORD_URL', 'NAV_TENANT_URL'],
    });
  }

  return suiteType;
}

function buildSuiteGrep(suiteType) {
  const { grepValues } = parsePlaywrightCliContext();
  const requested = grepValues.length === 1 ? grepValues[0].toString().trim() : '';
  if (allowedCanonicalShardedGrepValues(suiteType).includes(requested)) {
    // A fixture-owned shard has a deliberately disjoint marker. Let its
    // admitted selector replace (rather than intersect with) the full-suite
    // selector after requirePlaywrightSuiteContract has validated the lane and
    // required environment contract.
    return new RegExp(requested);
  }
  return new RegExp(expectedSuiteMarker(suiteType));
}

module.exports = {
  buildSuiteGrep,
  requireLiveMutationContract,
  requirePlaywrightSuiteContract,
};
