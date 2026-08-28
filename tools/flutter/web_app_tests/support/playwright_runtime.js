const path = require('path');
const { createRequire } = require('module');

const runnerPackage = path.resolve(
  __dirname,
  '..',
  '..',
  'web_app_smoke_runner',
  'package.json',
);

function requirePlaywrightTest() {
  try {
    return createRequire(runnerPackage)('@playwright/test');
  } catch (error) {
    throw new Error(
      `Canonical Playwright runtime is unavailable at ${runnerPackage}. ` +
        'Install the dependencies in tools/flutter/web_app_smoke_runner before running a standalone web fixture. ' +
        `Original error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

module.exports = {
  requirePlaywrightTest,
  runnerPackage,
};
