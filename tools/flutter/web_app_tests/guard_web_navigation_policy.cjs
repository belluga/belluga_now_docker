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

const allowedSuiteTypes = new Set(['readonly', 'mutation', 'diagnostic']);

if (!allowedSuiteTypes.has(suiteType)) {
  console.error(
    `Invalid NAV_WEB_TEST_TYPE "${process.env.NAV_WEB_TEST_TYPE ?? ''}". ` +
      'Expected one of: readonly, mutation, diagnostic.',
  );
  process.exit(1);
}

if (suiteType === 'mutation' && lane === 'main') {
  console.error(
    'Hard block: web mutation suite is forbidden on main lane by policy.',
  );
  process.exit(1);
}

if (suiteType === 'diagnostic' && lane !== 'local') {
  console.error(
    'Hard block: web diagnostic suite is local-only because runtime mutation diagnostics depend on the local docker stack.',
  );
  process.exit(1);
}

if (suiteType === 'mutation' || suiteType === 'diagnostic') {
  const adminEmail = (process.env.NAV_ADMIN_EMAIL || '').trim();
  const adminPassword = process.env.NAV_ADMIN_PASSWORD || '';
  if (!adminEmail || !adminPassword) {
    console.error(
      `Hard block: ${suiteType} navigation requires NAV_ADMIN_EMAIL and NAV_ADMIN_PASSWORD from the runtime environment. Committed fallbacks are forbidden.`,
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
  /(?:const|let|var)\s*\{[^}]*NAV_ADMIN_EMAIL\s*=\s*['"`][^'"`]+['"`][^}]*\}\s*=\s*process\.env/m,
  /(?:const|let|var)\s*\{[^}]*NAV_ADMIN_PASSWORD\s*=\s*['"`][^'"`]+['"`][^}]*\}\s*=\s*process\.env/m,
  /const\s+admin(?:Email|Password)\s*=\s*['"`][^'"`]+['"`]/i,
];
const credentialViolations = [];
const coordinateClickViolations = [];
const positionClickViolations = [];
const forcedClickViolations = [];
const evaluatedClickViolations = [];
const nonSemanticDropdownViolations = [];
const localDropdownHelperViolations = [];
const localDropdownHelperPattern =
  /\b(?:async\s+)?function\s+selectDropdownOption\b|\b(?:const|let|var)\s+selectDropdownOption\s*=|\b(?:module\.)?exports\.selectDropdownOption\s*=/m;

function findMatchingParenthesis(source, openIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = openIndex; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];

    if (inLineComment) {
      if (current === '\n') {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (current === '*' && next === '/') {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (current === '\\') {
        escaped = true;
        continue;
      }
      if (current === quote) {
        quote = null;
      }
      continue;
    }

    if (current === '/' && next === '/') {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (current === '/' && next === '*') {
      inBlockComment = true;
      index += 1;
      continue;
    }

    if (current === '"' || current === '\'' || current === '`') {
      quote = current;
      continue;
    }

    if (current === '(') {
      depth += 1;
      continue;
    }

    if (current === ')') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function findNextEvaluateCall(source, startIndex) {
  let quote = null;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];

    if (inLineComment) {
      if (current === '\n') {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (current === '*' && next === '/') {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (current === '\\') {
        escaped = true;
        continue;
      }
      if (current === quote) {
        quote = null;
      }
      continue;
    }

    if (current === '/' && next === '/') {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (current === '/' && next === '*') {
      inBlockComment = true;
      index += 1;
      continue;
    }

    if (current === '"' || current === '\'' || current === '`') {
      quote = current;
      continue;
    }

    if (source.startsWith('.evaluate(', index)) {
      return index;
    }
  }

  return -1;
}

function containsEvaluateClickBypass(source) {
  let searchIndex = 0;
  while (searchIndex < source.length) {
    const evaluateIndex = findNextEvaluateCall(source, searchIndex);
    if (evaluateIndex === -1) {
      return false;
    }

    const openIndex = source.indexOf('(', evaluateIndex);
    if (openIndex === -1) {
      return false;
    }

    const closeIndex = findMatchingParenthesis(source, openIndex);
    if (closeIndex === -1) {
      return false;
    }

    const evaluateArgs = source.slice(openIndex + 1, closeIndex);
    if (/(?:=>|function\b)[\s\S]*?\.\s*click\s*\(/m.test(evaluateArgs)) {
      return true;
    }

    searchIndex = closeIndex + 1;
  }

  return false;
}

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
    if (
      filePath === __filename ||
      entry.name === 'navigation_harness_policy_test.cjs'
    ) {
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
    if (/\.click\s*\(\s*\{[\s\S]*?\bposition\s*:/m.test(source)) {
      positionClickViolations.push(relativePath);
    }
    if (/\.click\s*\(\s*\{[^}]*force\s*:\s*true/m.test(source)) {
      forcedClickViolations.push(relativePath);
    }
    if (containsEvaluateClickBypass(source)) {
      evaluatedClickViolations.push(relativePath);
    }
    if (
      /\.getByText\s*\(\s*optionText\s*\)\s*\.click\s*\(/.test(source) ||
      /\bkeyboard\.press\s*\(\s*['"`](?:ArrowDown|Home|End)['"`]\s*\)/.test(source) ||
      /\bfallback(?:ArrowDownCount|SelectFirstOption)\b/.test(source) ||
      /fallback to keyboard selection/i.test(source)
    ) {
      nonSemanticDropdownViolations.push(relativePath);
    }
    if (
      localDropdownHelperPattern.test(source) &&
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

if (positionClickViolations.length > 0) {
  console.error(
    `Hard block: release-gating web navigation specs must not use locator.click({ position: ... }) coordinate targeting in ${[
      ...new Set(positionClickViolations),
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

if (evaluatedClickViolations.length > 0) {
  console.error(
    `Hard block: release-gating web navigation specs must not bypass Playwright actionability with locator.evaluate(...click()) in ${[
      ...new Set(evaluatedClickViolations),
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
