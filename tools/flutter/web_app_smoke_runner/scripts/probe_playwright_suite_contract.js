#!/usr/bin/env node

const path = require('path');

const {
  requirePlaywrightSuiteContract,
} = require('../../web_app_tests/support/live_navigation_mutation_contract');

const probeArgs = process.argv.slice(2);
const originalArgv = process.argv;

try {
  process.argv = [
    process.execPath,
    path.join(__dirname, '..', 'playwright.config.js'),
    ...probeArgs,
  ];
  const suiteType = requirePlaywrightSuiteContract();
  process.stdout.write(`OK: ${suiteType}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
} finally {
  process.argv = originalArgv;
}
