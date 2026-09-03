#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const [, , command, suite, shardOrAll, listPath] = process.argv;
const manifestPath = process.env.NAV_WEB_SHARD_MANIFEST
  ? path.resolve(process.env.NAV_WEB_SHARD_MANIFEST)
  : path.join(__dirname, 'navigation_mutation_shards.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

function suiteManifest(suiteName) {
  const suiteManifestValue = manifest[suiteName];
  if (!suiteManifestValue) {
    throw new Error(`Missing ${suiteName} suite manifest.`);
  }
  return suiteManifestValue;
}

function shardedSuiteManifest(suiteName) {
  const suiteValue = suiteManifest(suiteName);
  if (!suiteValue.shards) {
    throw new Error(`Missing ${suiteName} shard manifest.`);
  }
  return suiteValue;
}

function shardFor(suiteName, id) {
  const suiteValue = shardedSuiteManifest(suiteName);
  const shard = suiteValue.shards[id];
  if (!shard) {
    const names = Object.keys(suiteValue.shards).sort().join(', ');
    throw new Error(`Unknown ${suiteName} shard "${id}". Expected one of: ${names}`);
  }
  return shard;
}

function suiteGrep(suiteName) {
  return suiteName === 'readonly' ? '@readonly(?:\\s|$)' : `@${suiteName}`;
}

function shardGrep(suiteName, id) {
  const shard = shardFor(suiteName, id);
  const explicit = shard.grep?.toString().trim();
  if (explicit) {
    return explicit;
  }
  const grepExtra = shard.grep_extra?.toString().trim();
  if (!grepExtra) {
    throw new Error(`Missing ${suiteName} shard grep selector for "${id}".`);
  }
  return `${suiteGrep(suiteName)}.*${grepExtra}`;
}

function assertShardRuntimeContract(suiteName, id) {
  const shard = shardFor(suiteName, id);
  const lane = (process.env.NAV_DEPLOY_LANE || 'local').trim().toLowerCase();
  const allowedLanes = Array.isArray(shard.allowed_lanes) ? shard.allowed_lanes : [];
  if (allowedLanes.length > 0 && !allowedLanes.includes(lane)) {
    throw new Error(
      `${suiteName} shard "${id}" is restricted to NAV_DEPLOY_LANE=${allowedLanes.join('|')}.`,
    );
  }
  for (const name of Array.isArray(shard.required_env) ? shard.required_env : []) {
    if (!process.env[name]?.toString().trim()) {
      throw new Error(
        `${suiteName} shard "${id}" requires ${name}; no ambient fixture fallback is allowed.`,
      );
    }
  }
  const requiredValues = shard.required_env_values || {};
  for (const [name, expected] of Object.entries(requiredValues)) {
    const actual = process.env[name]?.toString().trim() || '';
    if (actual !== expected) {
      throw new Error(
        `${suiteName} shard "${id}" requires ${name}=${expected}; no ambient fixture fallback is allowed.`,
      );
    }
  }
}

function expectedShardedTitles(suiteName, id) {
  const suiteValue = shardedSuiteManifest(suiteName);
  if (!id || id === 'all') {
    return [
      ...new Set(
        Object.values(suiteValue.shards).flatMap(
          (shard) => shard.expected_titles || [],
        ),
      ),
    ].sort();
  }
  return [...(shardFor(suiteName, id).expected_titles || [])].sort();
}

function expectedSuiteTitles(suiteName) {
  const suiteValue = suiteManifest(suiteName);
  const titles = Array.isArray(suiteValue.expected_titles)
    ? suiteValue.expected_titles
    : [];
  if (titles.length === 0) {
    throw new Error(`Missing expected titles for ${suiteName} suite.`);
  }
  return [...titles].sort();
}

function parseListedTitles(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  return source
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/›\s*(.+)$/);
      return match ? match[1].trim() : null;
    })
    .filter(Boolean)
    .sort();
}

function assertExecutedRun(outputPath) {
  const output = fs.readFileSync(outputPath, 'utf8');
  const skipped = output.match(/\b(\d+)\s+skipped\b/gi) || [];
  if (skipped.length > 0) {
    throw new Error(
      `Web navigation run reported skipped test(s): ${skipped.join(', ')}. Release shards require every selected test to execute.`,
    );
  }
}

function countTitles(titles) {
  const counts = new Map();
  for (const title of titles) {
    counts.set(title, (counts.get(title) || 0) + 1);
  }
  return counts;
}

function expandDiff(expectedCounts, actualCounts, mode) {
  const rows = [];
  const titleUniverse = new Set([
    ...expectedCounts.keys(),
    ...actualCounts.keys(),
  ]);

  for (const title of [...titleUniverse].sort()) {
    const expectedCount = expectedCounts.get(title) || 0;
    const actualCount = actualCounts.get(title) || 0;
    const diff =
      mode === 'missing'
        ? expectedCount - actualCount
        : actualCount - expectedCount;
    for (let index = 0; index < diff; index += 1) {
      rows.push(title);
    }
  }

  return rows;
}

try {
  if (command === 'grep') {
    if (!['mutation', 'readonly'].includes(suite)) {
      throw new Error('Shard grep selection is only defined for mutation or readonly suites.');
    }
    process.stdout.write(shardGrep(suite, shardOrAll));
    process.exit(0);
  }

  if (command === 'assert-runtime') {
    if (!['mutation', 'readonly'].includes(suite)) {
      throw new Error('Shard runtime contracts are only defined for mutation or readonly suites.');
    }
    assertShardRuntimeContract(suite, shardOrAll);
    process.exit(0);
  }

  if (command === 'validate') {
    if (!listPath) {
      throw new Error('Missing Playwright --list output path.');
    }

    const expected = suite === 'mutation'
      ? expectedShardedTitles(suite, shardOrAll)
      : suite === 'readonly' && shardOrAll && shardOrAll !== 'all'
        ? expectedShardedTitles(suite, shardOrAll)
        : expectedSuiteTitles(suite);
    const actual = parseListedTitles(listPath);
    const expectedCounts = countTitles(expected);
    const actualCounts = countTitles(actual);
    const missing = expandDiff(expectedCounts, actualCounts, 'missing');
    const unexpected = expandDiff(expectedCounts, actualCounts, 'unexpected');

    if (missing.length || unexpected.length) {
      console.error(`Web navigation ${suite} selection mismatch.`);
      if (missing.length) {
        console.error(`Missing expected titles:\n- ${missing.join('\n- ')}`);
      }
      if (unexpected.length) {
        console.error(`Unexpected selected titles:\n- ${unexpected.join('\n- ')}`);
      }
      process.exit(1);
    }

    console.log(
      ['mutation', 'readonly'].includes(suite)
        ? `Validated ${suite} shard "${shardOrAll || 'all'}" selects ${actual.length} expected test(s).`
        : `Validated ${suite} suite selects ${actual.length} expected test(s).`,
    );
    for (const title of actual) {
      console.log(`- ${title}`);
    }
    process.exit(0);
  }

  if (command === 'assert-executed') {
    if (!listPath) {
      throw new Error('Missing Playwright run output path.');
    }
    assertExecutedRun(listPath);
    console.log(`Validated ${suite} run executed without skipped test(s).`);
    process.exit(0);
  }

  throw new Error(
    `Unknown command "${command}". Expected grep, assert-runtime, validate or assert-executed.`,
  );
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
