#!/usr/bin/env node

const suiteType = (process.env.NAV_WEB_TEST_TYPE || '').trim().toLowerCase();
const lane =
  (process.env.NAV_DEPLOY_LANE ||
    process.env.DEPLOY_LANE ||
    process.env.GITHUB_REF_NAME ||
    'local')
    .trim()
    .toLowerCase();

const allowedSuiteTypes = new Set(['readonly', 'mutation']);

if (!allowedSuiteTypes.has(suiteType)) {
  console.error(
    `Invalid NAV_WEB_TEST_TYPE "${process.env.NAV_WEB_TEST_TYPE ?? ''}". ` +
      'Expected one of: readonly, mutation.',
  );
  process.exit(1);
}

if (suiteType === 'mutation' && lane === 'main') {
  console.error(
    'Hard block: web mutation suite is forbidden on main lane by policy.',
  );
  process.exit(1);
}

console.log(
  `Web navigation policy check passed (lane=${lane}, suite=${suiteType}).`,
);
