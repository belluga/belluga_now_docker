#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
RUNNER_DIR="${SCRIPT_DIR}/web_app_smoke_runner"
ENV_FILE="${NAV_LOCAL_ENV_FILE:-${REPO_ROOT}/.env.local.navigation}"

load_optional_local_navigation_env() {
  if [[ ! -f "${ENV_FILE}" ]]; then
    return 0
  fi

  local preserve_keys=(
    NAV_TENANT_URL
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    PLAYWRIGHT_IGNORE_HTTPS_ERRORS
  )
  local preserved_names=()
  local key=""

  for key in "${preserve_keys[@]}"; do
    if [[ -v "${key}" ]]; then
      preserved_names+=("${key}")
      printf -v "__preserved_${key}" '%s' "${!key}"
    fi
  done

  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a

  local preserved_var=""
  for key in "${preserved_names[@]}"; do
    preserved_var="__preserved_${key}"
    export "${key}=${!preserved_var}"
    unset "${preserved_var}"
  done
}

load_optional_local_navigation_env

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
node scripts/probe_map_permission_grant_runtime.js
