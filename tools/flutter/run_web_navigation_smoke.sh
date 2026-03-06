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
export NODE_PATH="${RUNNER_DIR}/node_modules${NODE_PATH:+:${NODE_PATH}}"
node ../web_app_tests/guard_web_navigation_policy.cjs
npx playwright test --config ./playwright.config.js --grep "${GREP}" --retries=1 --reporter=line
popd >/dev/null
