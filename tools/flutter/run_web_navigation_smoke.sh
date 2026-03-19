#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER_DIR="${SCRIPT_DIR}/web_app_smoke_runner"

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <readonly|mutation>" >&2
  exit 1
fi

SUITE="$1"

case "$SUITE" in
  readonly)
    GREP='@readonly'
    ;;
  mutation)
    GREP='@mutation'
    ;;
  *)
    echo "ERROR: unsupported web navigation suite '${SUITE}'. Expected readonly or mutation." >&2
    exit 1
    ;;
esac

pushd "${RUNNER_DIR}" >/dev/null
export NAV_WEB_TEST_TYPE="${NAV_WEB_TEST_TYPE:-${SUITE}}"
export NAV_DEPLOY_LANE="${NAV_DEPLOY_LANE:-local}"
export NODE_PATH="${RUNNER_DIR}/node_modules${NODE_PATH:+:${NODE_PATH}}"

DEFAULT_OUTPUT_DIR="${RUNNER_DIR}/test-results"

if ! mkdir -p "${DEFAULT_OUTPUT_DIR}" 2>/dev/null || ! touch "${DEFAULT_OUTPUT_DIR}/.write-check" 2>/dev/null; then
  echo "ERROR: ${DEFAULT_OUTPUT_DIR} is not writable. Fix permissions before running web navigation smoke." >&2
  exit 1
fi
rm -f "${DEFAULT_OUTPUT_DIR}/.write-check"

node ../web_app_tests/guard_web_navigation_policy.cjs
npx playwright test \
  --config ./playwright.config.js \
  --grep "${GREP}" \
  --retries=1 \
  --fail-on-flaky-tests \
  --reporter=line \
  --output "${DEFAULT_OUTPUT_DIR}"
popd >/dev/null
