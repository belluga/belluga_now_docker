#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
RUNNER_DIR="${SCRIPT_DIR}/web_app_smoke_runner"

load_optional_local_navigation_env() {
  local env_file="${NAV_LOCAL_ENV_FILE:-${REPO_ROOT}/.env.local.navigation}"
  if [[ ! -f "${env_file}" ]]; then
    return 0
  fi

  local preserve_keys=(
    NAV_LANDLORD_URL
    NAV_TENANT_URL
    NAV_DEPLOY_LANE
    PLAYWRIGHT_IGNORE_HTTPS_ERRORS
    NAV_WEB_WORKERS
    NAV_WEB_SHARD
    NAV_WEB_GREP_EXTRA
    NAV_WEB_ALLOW_RAW_GREP
    NAV_ADMIN_EMAIL
    NAV_ADMIN_PASSWORD
  )
  local preserved_names=()
  local key

  for key in "${preserve_keys[@]}"; do
    if [[ -v "${key}" ]]; then
      preserved_names+=("${key}")
      printf -v "__preserved_${key}" '%s' "${!key}"
    fi
  done

  set -a
  # shellcheck disable=SC1090
  source "${env_file}"
  set +a

  local preserved_var
  for key in "${preserved_names[@]}"; do
    preserved_var="__preserved_${key}"
    export "${key}=${!preserved_var}"
    unset "${preserved_var}"
  done
}

load_optional_local_navigation_env

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

if [[ -n "${NAV_WEB_GREP_EXTRA:-}" ]]; then
  if [[ "${NAV_WEB_ALLOW_RAW_GREP:-0}" != "1" ]]; then
    echo "ERROR: NAV_WEB_GREP_EXTRA is ad-hoc and cannot be used for release-gating evidence. Use NAV_WEB_SHARD for deterministic mutation shards." >&2
    exit 1
  fi
  GREP="${GREP}.*${NAV_WEB_GREP_EXTRA}"
fi

pushd "${RUNNER_DIR}" >/dev/null
export NAV_WEB_TEST_TYPE="${NAV_WEB_TEST_TYPE:-${SUITE}}"
export NAV_DEPLOY_LANE="${NAV_DEPLOY_LANE:-local}"
export NODE_PATH="${RUNNER_DIR}/node_modules${NODE_PATH:+:${NODE_PATH}}"

DEFAULT_OUTPUT_DIR="${RUNNER_DIR}/test-results"
WEB_WORKERS="${NAV_WEB_WORKERS:-}"
if [[ -z "${WEB_WORKERS}" && "${SUITE}" == "mutation" ]]; then
  WEB_WORKERS=1
fi

if ! mkdir -p "${DEFAULT_OUTPUT_DIR}" 2>/dev/null || ! touch "${DEFAULT_OUTPUT_DIR}/.write-check" 2>/dev/null; then
  echo "ERROR: ${DEFAULT_OUTPUT_DIR} is not writable. Fix permissions before running web navigation smoke." >&2
  exit 1
fi
rm -f "${DEFAULT_OUTPUT_DIR}/.write-check"
find "${DEFAULT_OUTPUT_DIR}" -mindepth 1 -maxdepth 1 -exec rm -rf {} +

WORKER_ARGS=()
if [[ -n "${WEB_WORKERS}" ]]; then
  WORKER_ARGS=(--workers "${WEB_WORKERS}")
fi

node ../web_app_tests/guard_web_navigation_policy.cjs
if [[ -n "${NAV_WEB_SHARD:-}" ]]; then
  if [[ "${SUITE}" != "mutation" ]]; then
    echo "ERROR: NAV_WEB_SHARD is only supported for the mutation suite." >&2
    exit 1
  fi
  SHARD_GREP_EXTRA="$(node ../web_app_tests/web_navigation_shards.cjs grep "${SUITE}" "${NAV_WEB_SHARD}")"
  GREP="${GREP}.*${SHARD_GREP_EXTRA}"
fi

LIST_OUTPUT="${DEFAULT_OUTPUT_DIR}/selected-tests.txt"
npx playwright test \
  --config ./playwright.config.js \
  --grep "${GREP}" \
  --list \
  --reporter=line | tee "${LIST_OUTPUT}"

if [[ "${SUITE}" == "mutation" && "${NAV_WEB_ALLOW_RAW_GREP:-0}" != "1" ]]; then
  node ../web_app_tests/web_navigation_shards.cjs validate "${SUITE}" "${NAV_WEB_SHARD:-all}" "${LIST_OUTPUT}"
fi

npx playwright test \
  --config ./playwright.config.js \
  --grep "${GREP}" \
  --retries=0 \
  --fail-on-flaky-tests \
  "${WORKER_ARGS[@]}" \
  --reporter=line \
  --output "${DEFAULT_OUTPUT_DIR}"
popd >/dev/null
