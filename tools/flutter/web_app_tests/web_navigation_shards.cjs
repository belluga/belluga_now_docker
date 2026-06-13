#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const [, , command, suite, shardOrAll, listPath] = process.argv;
const manifestPath = process.env.NAV_WEB_SHARD_MANIFEST
  ? path.resolve(process.env.NAV_WEB_SHARD_MANIFEST)
  : path.join(__dirname, 'navigation_mutation_shards.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

function mutationManifest() {
  const mutation = manifest.mutation;
  if (!mutation || !mutation.shards) {
    throw new Error('Missing mutation shard manifest.');
  }
  return mutation;
}

function suiteManifest(suiteName) {
  const suiteManifestValue = manifest[suiteName];
  if (!suiteManifestValue) {
    throw new Error(`Missing ${suiteName} suite manifest.`);
  }
  return suiteManifestValue;
}

function shardFor(id) {
  const shard = mutationManifest().shards[id];
  if (!shard) {
    const names = Object.keys(mutationManifest().shards).sort().join(', ');
    throw new Error(`Unknown mutation shard "${id}". Expected one of: ${names}`);
  }
  return shard;
}

function expectedTitles(id) {
  if (!id || id === 'all') {
    return [
      ...new Set(
        Object.values(mutationManifest().shards).flatMap(
          (shard) => shard.expected_titles || [],
        ),
      ),
    ].sort();
  }
  return [...(shardFor(id).expected_titles || [])].sort();
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
    if (suite !== 'mutation') {
      throw new Error('Shard grep selection is only defined for mutation suite.');
    }
    process.stdout.write(shardFor(shardOrAll).grep_extra || '');
    process.exit(0);
  }

  if (command === 'validate') {
    if (!listPath) {
      throw new Error('Missing Playwright --list output path.');
    }

    const expected = suite === 'mutation'
      ? expectedTitles(shardOrAll)
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
      suite === 'mutation'
        ? `Validated mutation shard "${shardOrAll || 'all'}" selects ${actual.length} expected test(s).`
        : `Validated ${suite} suite selects ${actual.length} expected test(s).`,
    );
    for (const title of actual) {
      console.log(`- ${title}`);
    }
    process.exit(0);
  }

  throw new Error(`Unknown command "${command}". Expected grep or validate.`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
