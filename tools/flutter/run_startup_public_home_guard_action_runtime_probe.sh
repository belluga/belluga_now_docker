#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
RUNNER_DIR="${SCRIPT_DIR}/web_app_smoke_runner"
ENV_FILE="${NAV_LOCAL_ENV_FILE:-${REPO_ROOT}/.env.local.navigation}"

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

if [[ -z "${PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:-}" ]]; then
  for candidate in \
    /usr/bin/google-chrome \
    /usr/bin/google-chrome-stable \
    /usr/bin/chromium-browser \
    /usr/bin/chromium
  do
    if [[ -x "${candidate}" ]]; then
      export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="${candidate}"
      break
    fi
  done
fi

if [[ -z "${NAV_TENANT_URL:-}" ]]; then
  echo "ERROR: NAV_TENANT_URL is required." >&2
  exit 1
fi

cd "${RUNNER_DIR}"
node scripts/probe_startup_public_home_guard_action_runtime.js
