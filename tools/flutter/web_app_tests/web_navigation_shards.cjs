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

try {
  if (suite !== 'mutation') {
    throw new Error('Shard manifest is only defined for mutation suite.');
  }

  if (command === 'grep') {
    process.stdout.write(shardFor(shardOrAll).grep_extra || '');
    process.exit(0);
  }

  if (command === 'validate') {
    if (!listPath) {
      throw new Error('Missing Playwright --list output path.');
    }

    const expected = expectedTitles(shardOrAll);
    const actual = parseListedTitles(listPath);
    const missing = expected.filter((title) => !actual.includes(title));
    const unexpected = actual.filter((title) => !expected.includes(title));

    if (missing.length || unexpected.length) {
      console.error('Web navigation mutation shard selection mismatch.');
      if (missing.length) {
        console.error(`Missing expected titles:\n- ${missing.join('\n- ')}`);
      }
      if (unexpected.length) {
        console.error(`Unexpected selected titles:\n- ${unexpected.join('\n- ')}`);
      }
      process.exit(1);
    }

    console.log(
      `Validated mutation shard "${shardOrAll || 'all'}" selects ${actual.length} expected test(s).`,
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
