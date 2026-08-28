#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
RUNNER_DIR="${SCRIPT_DIR}/web_app_smoke_runner"
source "${SCRIPT_DIR}/resolve_playwright_browser.sh"
ORIGINAL_NAV_DEPLOY_LANE_SET=0
if [[ -v NAV_DEPLOY_LANE ]]; then
  if [[ -n "${NAV_DEPLOY_LANE//[[:space:]]/}" ]]; then
    ORIGINAL_NAV_DEPLOY_LANE_SET=1
  fi
fi
ORIGINAL_NAV_RUNTIME_DB_MUTATION_ALLOWED_SET=0
if [[ -v NAV_RUNTIME_DB_MUTATION_ALLOWED ]]; then
  ORIGINAL_NAV_RUNTIME_DB_MUTATION_ALLOWED_SET=1
fi
ORIGINAL_NAV_WEB_ALLOW_NONLOCAL_MUTATION_HOSTS_SET=0
if [[ -v NAV_WEB_ALLOW_NONLOCAL_MUTATION_HOSTS ]]; then
  ORIGINAL_NAV_WEB_ALLOW_NONLOCAL_MUTATION_HOSTS_SET=1
fi

load_optional_local_navigation_env() {
  local env_file="${NAV_LOCAL_ENV_FILE:-${REPO_ROOT}/.env.local.navigation}"
  if [[ ! -f "${env_file}" ]]; then
    return 0
  fi

  local preserve_keys=(
    NAV_LANDLORD_URL
    NAV_TENANT_URL
    NAV_DEPLOY_LANE
    NAV_WEB_ALLOW_NONLOCAL_MUTATION_HOSTS
    PLAYWRIGHT_IGNORE_HTTPS_ERRORS
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    NAV_WEB_WORKERS
    NAV_WEB_SHARD
    NAV_WEB_GREP_EXTRA
    NAV_WEB_ALLOW_RAW_GREP
    NAV_WEB_OUTPUT_DIR
    NAV_ADMIN_EMAIL
    NAV_ADMIN_PASSWORD
    NAV_RUNTIME_DB_MUTATION_ALLOWED
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

  if (( ORIGINAL_NAV_DEPLOY_LANE_SET == 0 )); then
    unset NAV_DEPLOY_LANE
  fi
  if (( ORIGINAL_NAV_RUNTIME_DB_MUTATION_ALLOWED_SET == 0 )); then
    unset NAV_RUNTIME_DB_MUTATION_ALLOWED
  fi
  if (( ORIGINAL_NAV_WEB_ALLOW_NONLOCAL_MUTATION_HOSTS_SET == 0 )); then
    unset NAV_WEB_ALLOW_NONLOCAL_MUTATION_HOSTS
  fi

  local preserved_var
  for key in "${preserved_names[@]}"; do
    preserved_var="__preserved_${key}"
    export "${key}=${!preserved_var}"
    unset "${preserved_var}"
  done
}

load_optional_local_navigation_env

export_playwright_browser_path

require_explicit_nonlocal_mutation_opt_in() {
  local suite="$1"
  if [[ "${suite}" != "mutation" && "${suite}" != "diagnostic" ]]; then
    return 0
  fi

  local allowed_local_hosts="${NAV_WEB_LOCAL_MUTATION_ALLOWED_HOSTS:-localhost,127.0.0.1,::1}"
  local urls=()
  if [[ -n "${NAV_LANDLORD_URL:-}" ]]; then
    urls+=("${NAV_LANDLORD_URL}")
  fi
  if [[ -n "${NAV_TENANT_URL:-}" ]]; then
    urls+=("${NAV_TENANT_URL}")
  fi
  if [[ ${#urls[@]} -eq 0 ]]; then
    return 0
  fi

  local allow_nonlocal="${NAV_WEB_ALLOW_NONLOCAL_MUTATION_HOSTS:-0}"
  local url host is_local
  for url in "${urls[@]}"; do
    host="$(node -p "try { new URL(process.argv[1]).hostname.toLowerCase() } catch (_) { '' }" "${url}")"
    host="${host#[}"
    host="${host%]}"
    if [[ -z "${host}" ]]; then
      echo "ERROR: could not resolve host from navigation URL '${url}'." >&2
      exit 1
    fi

    is_local=0
    IFS=',' read -r -a __allowed_local_hosts <<< "${allowed_local_hosts}"
    local allowed_host
    for allowed_host in "${__allowed_local_hosts[@]}"; do
      allowed_host="$(printf '%s' "${allowed_host}" | tr '[:upper:]' '[:lower:]' | xargs)"
      if [[ -n "${allowed_host}" && "${host}" == "${allowed_host}" ]]; then
        is_local=1
        break
      fi
    done
    unset __allowed_local_hosts

    if (( is_local == 0 )); then
      if (( ORIGINAL_NAV_WEB_ALLOW_NONLOCAL_MUTATION_HOSTS_SET == 0 )) || [[ "${allow_nonlocal}" != "1" ]]; then
        echo "ERROR: ${suite} suite refuses non-local host '${host}' without explicit NAV_WEB_ALLOW_NONLOCAL_MUTATION_HOSTS=1 in the shell environment." >&2
        exit 1
      fi
    fi
  done
}

require_explicit_mutation_lane_contract() {
  local suite="$1"
  if [[ "${suite}" != "mutation" ]]; then
    return 0
  fi
  if (( ORIGINAL_NAV_DEPLOY_LANE_SET != 0 )); then
    return 0
  fi

  local allowed_local_hosts="${NAV_WEB_LOCAL_MUTATION_ALLOWED_HOSTS:-localhost,127.0.0.1,::1}"
  local allow_nonlocal="${NAV_WEB_ALLOW_NONLOCAL_MUTATION_HOSTS:-0}"
  local urls=()
  if [[ -n "${NAV_LANDLORD_URL:-}" ]]; then
    urls+=("${NAV_LANDLORD_URL}")
  fi
  if [[ -n "${NAV_TENANT_URL:-}" ]]; then
    urls+=("${NAV_TENANT_URL}")
  fi

  local requires_explicit_lane=0
  if [[ "${allow_nonlocal}" == "1" ]]; then
    requires_explicit_lane=1
  fi

  local url host is_local
  for url in "${urls[@]}"; do
    host="$(node -p "try { new URL(process.argv[1]).hostname.toLowerCase() } catch (_) { '' }" "${url}")"
    host="${host#[}"
    host="${host%]}"
    if [[ -z "${host}" ]]; then
      echo "ERROR: could not resolve host from navigation URL '${url}'." >&2
      exit 1
    fi

    is_local=0
    IFS=',' read -r -a __allowed_local_hosts <<< "${allowed_local_hosts}"
    local allowed_host
    for allowed_host in "${__allowed_local_hosts[@]}"; do
      allowed_host="$(printf '%s' "${allowed_host}" | tr '[:upper:]' '[:lower:]' | xargs)"
      if [[ -n "${allowed_host}" && "${host}" == "${allowed_host}" ]]; then
        is_local=1
        break
      fi
    done
    unset __allowed_local_hosts

    if (( is_local == 0 )); then
      requires_explicit_lane=1
      break
    fi
  done

  if (( requires_explicit_lane != 0 )); then
    echo "ERROR: mutation suite requires an explicit NAV_DEPLOY_LANE contract when targeting non-local hosts or opting into non-local mutation hosts." >&2
    exit 1
  fi
}

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <readonly|mutation|diagnostic>" >&2
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
  diagnostic)
    GREP='@diagnostic'
    ;;
  *)
    echo "ERROR: unsupported web navigation suite '${SUITE}'. Expected readonly, mutation, or diagnostic." >&2
    exit 1
    ;;
esac

if [[ "${NAV_WEB_ALLOW_RAW_GREP:-0}" == "1" ]]; then
  echo "ERROR: NAV_WEB_ALLOW_RAW_GREP is not allowed in the canonical web navigation runner. Use deterministic suite selection only." >&2
  exit 1
fi

if [[ -n "${NAV_WEB_GREP_EXTRA:-}" ]]; then
  echo "ERROR: NAV_WEB_GREP_EXTRA is ad-hoc and cannot be used for release-gating evidence. Use NAV_WEB_SHARD for deterministic mutation shards." >&2
  exit 1
fi

# Interpret caller-provided relative artifact paths from the repository root,
# before the runner changes its working directory for Playwright execution.
if [[ -n "${NAV_WEB_OUTPUT_DIR:-}" && "${NAV_WEB_OUTPUT_DIR}" != /* ]]; then
  export NAV_WEB_OUTPUT_DIR="${REPO_ROOT}/${NAV_WEB_OUTPUT_DIR}"
fi

pushd "${RUNNER_DIR}" >/dev/null
if [[ -v NAV_WEB_TEST_TYPE && "${NAV_WEB_TEST_TYPE}" != "${SUITE}" ]]; then
  echo "ERROR: NAV_WEB_TEST_TYPE=${NAV_WEB_TEST_TYPE} does not match requested suite '${SUITE}'. The runner is authoritative for suite selection." >&2
  exit 1
fi
export NAV_WEB_TEST_TYPE="${SUITE}"
export NAV_DEPLOY_LANE="${NAV_DEPLOY_LANE:-local}"
export NODE_PATH="${RUNNER_DIR}/node_modules${NODE_PATH:+:${NODE_PATH}}"
export NAV_TEST_RUN_ID="${NAV_TEST_RUN_ID:-nav-${SUITE}-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
if [[ "${SUITE}" == "readonly" || "${SUITE}" == "mutation" ]]; then
  # Release-gating browser suites must fail closed on ambient data-selection
  # fallbacks so local and remote evidence use the same deterministic proof bar.
  export NAV_WEB_POLICY_STRICT_DATA=1
fi

if ! command -v timeout >/dev/null 2>&1; then
  echo "ERROR: GNU timeout is required to enforce deterministic smoke-suite deadlines." >&2
  exit 1
fi

DEFAULT_OUTPUT_DIR="${NAV_WEB_OUTPUT_DIR:-${RUNNER_DIR}/test-results/${NAV_TEST_RUN_ID}/${SUITE}}"
export NAV_DIRECTIONS_BRAND_SCREENSHOT_DIR="${NAV_DIRECTIONS_BRAND_SCREENSHOT_DIR:-${DEFAULT_OUTPUT_DIR}/directions-brand}"
WEB_WORKERS="${NAV_WEB_WORKERS:-}"
if [[ -z "${WEB_WORKERS}" ]]; then
  # Public-tunnel navigation smoke is a deterministic gate, not a load test.
  # Runtime/load behavior belongs in dedicated stress validation.
  WEB_WORKERS=1
fi

if ! mkdir -p "${DEFAULT_OUTPUT_DIR}" 2>/dev/null || ! touch "${DEFAULT_OUTPUT_DIR}/.write-check" 2>/dev/null; then
  echo "ERROR: ${DEFAULT_OUTPUT_DIR} is not writable. Fix permissions before running web navigation smoke." >&2
  exit 1
fi
rm -f "${DEFAULT_OUTPUT_DIR}/.write-check"
find "${DEFAULT_OUTPUT_DIR}" -mindepth 1 -maxdepth 1 -exec rm -rf {} +

require_explicit_mutation_lane_contract "${SUITE}"

if [[ "${SUITE}" == "diagnostic" ]]; then
  if (( ORIGINAL_NAV_DEPLOY_LANE_SET == 0 )); then
    echo "ERROR: diagnostic suite requires an explicit NAV_DEPLOY_LANE=local contract." >&2
    exit 1
  fi
  if [[ "${NAV_DEPLOY_LANE}" != "local" ]]; then
    echo "ERROR: diagnostic suite is restricted to NAV_DEPLOY_LANE=local." >&2
    exit 1
  fi
  if (( ORIGINAL_NAV_RUNTIME_DB_MUTATION_ALLOWED_SET == 0 )); then
    echo "ERROR: diagnostic suite requires explicit NAV_RUNTIME_DB_MUTATION_ALLOWED=1." >&2
    exit 1
  fi
  if [[ "${NAV_RUNTIME_DB_MUTATION_ALLOWED:-}" != "1" ]]; then
    echo "ERROR: diagnostic suite requires explicit NAV_RUNTIME_DB_MUTATION_ALLOWED=1." >&2
    exit 1
  fi
fi

require_explicit_nonlocal_mutation_opt_in "${SUITE}"

WORKER_ARGS=()
if [[ -n "${WEB_WORKERS}" ]]; then
  WORKER_ARGS=(--workers "${WEB_WORKERS}")
fi

LIST_TIMEOUT_SECONDS="${NAV_WEB_LIST_TIMEOUT_SECONDS:-120}"
PRECHECK_TIMEOUT_SECONDS="${NAV_WEB_PRECHECK_TIMEOUT_SECONDS:-180}"
SUITE_TIMEOUT_SECONDS="${NAV_WEB_SUITE_TIMEOUT_SECONDS:-}"
if [[ -z "${SUITE_TIMEOUT_SECONDS}" ]]; then
  if [[ "${SUITE}" == "mutation" ]]; then
    # The authoritative mutation packet now spans 37 real-browser flows,
    # including several long multi-surface admin/public proofs. Keep the
    # wrapper deadline above observed current runtime so false reds come from
    # assertions, not from the shell timeout terminating a progressing run.
    SUITE_TIMEOUT_SECONDS=3600
  elif [[ "${SUITE}" == "diagnostic" ]]; then
    SUITE_TIMEOUT_SECONDS=1200
  else
    # The authoritative readonly packet can validly exceed 15 minutes on a
    # healthy shared local runner after the upstream Flutter workspace contract.
    # Keep the shared deadline above observed stage-full runtime so local and
    # pipeline evidence fail on assertions/hard hangs instead of harness drift.
    SUITE_TIMEOUT_SECONDS=1800
  fi
fi

run_with_timeout() {
  local label="$1"
  local timeout_seconds="$2"
  local status=0
  shift 2

  set +e
  timeout --foreground "${timeout_seconds}s" "$@"
  status=$?
  set -e

  if (( status != 0 )); then
    if (( status == 124 )); then
      echo "ERROR: ${label} exceeded deterministic deadline (${timeout_seconds}s)." >&2
    fi
    return "${status}"
  fi
}

run_with_timeout "web navigation source policy guard" "${PRECHECK_TIMEOUT_SECONDS}" \
  bash -lc "set -euo pipefail; node ../web_app_tests/guard_web_navigation_policy.cjs 2>&1 | tee \"${DEFAULT_OUTPUT_DIR}/policy-guard.log\""
run_with_timeout "web navigation harness policy self-test" "${PRECHECK_TIMEOUT_SECONDS}" \
  bash -lc "set -euo pipefail; node ../web_app_tests/navigation_harness_policy_test.cjs 2>&1 | tee \"${DEFAULT_OUTPUT_DIR}/policy-harness.log\""
if [[ -n "${NAV_WEB_SHARD:-}" ]]; then
  if [[ "${SUITE}" != "mutation" && "${SUITE}" != "readonly" ]]; then
    echo "ERROR: NAV_WEB_SHARD is only supported for the readonly or mutation suites." >&2
    exit 1
  fi
  SHARD_GREP_EXTRA="$(node ../web_app_tests/web_navigation_shards.cjs grep "${SUITE}" "${NAV_WEB_SHARD}")"
  GREP="${GREP}.*${SHARD_GREP_EXTRA}"
fi

PLAYWRIGHT_CLI="./node_modules/playwright/cli.js"
if [[ ! -f "${PLAYWRIGHT_CLI}" ]]; then
  echo "ERROR: expected local Playwright CLI at ${PLAYWRIGHT_CLI}; run browser dependency install first." >&2
  exit 1
fi

LIST_OUTPUT="${DEFAULT_OUTPUT_DIR}/selected-tests.txt"
run_with_timeout "web navigation test selection (${SUITE})" "${LIST_TIMEOUT_SECONDS}" \
  node "${PLAYWRIGHT_CLI}" test \
  --config ./playwright.config.js \
  --grep "${GREP}" \
  --list \
  --reporter=line | tee "${LIST_OUTPUT}"

node ../web_app_tests/web_navigation_shards.cjs validate "${SUITE}" "${NAV_WEB_SHARD:-all}" "${LIST_OUTPUT}"

run_with_timeout "web navigation smoke (${SUITE})" "${SUITE_TIMEOUT_SECONDS}" \
  node "${PLAYWRIGHT_CLI}" test \
  --config ./playwright.config.js \
  --grep "${GREP}" \
  --retries=0 \
  --fail-on-flaky-tests \
  "${WORKER_ARGS[@]}" \
  --reporter=line \
  --output "${DEFAULT_OUTPUT_DIR}"
popd >/dev/null
