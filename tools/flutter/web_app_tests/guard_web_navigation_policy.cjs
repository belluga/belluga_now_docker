#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

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

if (suiteType === 'mutation') {
  const adminEmail = (process.env.NAV_ADMIN_EMAIL || '').trim();
  const adminPassword = process.env.NAV_ADMIN_PASSWORD || '';
  if (!adminEmail || !adminPassword) {
    console.error(
      'Hard block: mutation navigation requires NAV_ADMIN_EMAIL and NAV_ADMIN_PASSWORD from the runtime environment. Committed fallbacks are forbidden.',
    );
    process.exit(1);
  }
}

const webTestsDir = process.env.NAV_WEB_TESTS_DIR
  ? path.resolve(process.env.NAV_WEB_TESTS_DIR)
  : __dirname;
const forbiddenCredentialPatterns = [
  /NAV_ADMIN_EMAIL\s*\|\|\s*['"`][^'"`]+['"`]/,
  /NAV_ADMIN_PASSWORD\s*\|\|\s*['"`][^'"`]+['"`]/,
  /process\.env\.NAV_ADMIN_EMAIL\s*\?\?\s*['"`][^'"`]+['"`]/,
  /process\.env\.NAV_ADMIN_PASSWORD\s*\?\?\s*['"`][^'"`]+['"`]/,
  /const\s+admin(?:Email|Password)\s*=\s*['"`][^'"`]+['"`]/i,
];
const credentialViolations = [];
const coordinateClickViolations = [];
const forcedClickViolations = [];
const nonSemanticDropdownViolations = [];
const localDropdownHelperViolations = [];
function scanTestFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanTestFiles(filePath);
      continue;
    }
    if (!entry.isFile() || !/\.(?:js|cjs)$/.test(entry.name)) {
      continue;
    }
    if (filePath === __filename) {
      continue;
    }
    const source = fs.readFileSync(filePath, 'utf8');
    const relativePath = path.relative(webTestsDir, filePath);
    for (const pattern of forbiddenCredentialPatterns) {
      if (pattern.test(source)) {
        credentialViolations.push(relativePath);
        break;
      }
    }
    if (/(?:^|[^\w$])(?:page|\w+(?:\.\w+)*\(\)|\w+(?:\.\w+)*)\.mouse\.click\s*\(/m.test(source)) {
      coordinateClickViolations.push(relativePath);
    }
    if (/\.click\s*\(\s*\{[^}]*force\s*:\s*true/m.test(source)) {
      forcedClickViolations.push(relativePath);
    }
    if (
      /page\.getByText\s*\(\s*optionText/.test(source) ||
      /\bkeyboard\.press\s*\(\s*['"`](?:ArrowDown|Home|End)['"`]\s*\)/.test(source) ||
      /\bfallback(?:ArrowDownCount|SelectFirstOption)\b/.test(source) ||
      /fallback to keyboard selection/i.test(source)
    ) {
      nonSemanticDropdownViolations.push(relativePath);
    }
    if (
      /function\s+selectDropdownOption\b/.test(source) &&
      relativePath !== path.join('support', 'semantic_dropdown.js')
    ) {
      localDropdownHelperViolations.push(relativePath);
    }
  }
}
scanTestFiles(webTestsDir);
if (credentialViolations.length > 0) {
  console.error(
    `Hard block: committed tenant-admin credential fallbacks detected in ${[
      ...new Set(credentialViolations),
    ].join(', ')}.`,
  );
  process.exit(1);
}

if (coordinateClickViolations.length > 0) {
  console.error(
    `Hard block: release-gating web navigation specs must use semantic locators instead of mouse.click coordinate fallbacks in ${[
      ...new Set(coordinateClickViolations),
    ].join(', ')}.`,
  );
  process.exit(1);
}

if (forcedClickViolations.length > 0) {
  console.error(
    `Hard block: release-gating web navigation specs must not bypass browser actionability with click({ force: true }) in ${[
      ...new Set(forcedClickViolations),
    ].join(', ')}.`,
  );
  process.exit(1);
}

if (nonSemanticDropdownViolations.length > 0) {
  console.error(
    `Hard block: release-gating dropdown selection must use semantic option/menuitem locators, not text-click or keyboard fallbacks, in ${[
      ...new Set(nonSemanticDropdownViolations),
    ].join(', ')}.`,
  );
  process.exit(1);
}

if (localDropdownHelperViolations.length > 0) {
  console.error(
    `Hard block: release-gating dropdown helper logic must be centralized in support/semantic_dropdown.js, not redefined locally in ${[
      ...new Set(localDropdownHelperViolations),
    ].join(', ')}.`,
  );
  process.exit(1);
}

console.log(
  `Web navigation policy check passed (lane=${lane}, suite=${suiteType}).`,
);
