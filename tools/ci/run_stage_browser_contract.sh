#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FLUTTER_DIR="${ROOT_DIR}/flutter-app"
WEB_DIR="${ROOT_DIR}/web-app"
SMOKE_RUNNER_DIR="${ROOT_DIR}/tools/flutter/web_app_smoke_runner"
LOCAL_NAV_ENV_FILE="${NAV_LOCAL_ENV_FILE:-${ROOT_DIR}/.env.local.navigation}"

readonly LOCAL_BUILD_LANE="dev"
readonly REQUIRED_NODE_MAJOR="${REQUIRED_NODE_MAJOR:-24}"
readonly CONTRACT_STATE_HASH="$(printf '%s' "${ROOT_DIR}" | sha256sum | awk '{print substr($1,1,16)}')"
readonly CONTRACT_STATE_DIR="${TMPDIR:-/tmp}/belluga-stage-browser-contract-${CONTRACT_STATE_HASH}"
readonly LOCAL_PUBLIC_RUN_ID_FILE="${CONTRACT_STATE_DIR}/local-public.run-id"
readonly LOCAL_PUBLIC_LOOPBACK_BRIDGE_PID_FILE="${CONTRACT_STATE_DIR}/local-public.loopback-bridge.pid"
readonly LOCAL_PUBLIC_LOOPBACK_BRIDGE_LOG_FILE="${CONTRACT_STATE_DIR}/local-public.loopback-bridge.log"
readonly LOCAL_PUBLIC_LOOPBACK_BRIDGE_SCRIPT="${ROOT_DIR}/tools/ci/manage_local_navigation_loopback_bridge.py"

FULL_SEQUENCE_ACTIVE=0
FULL_SEQUENCE_FIXTURE_ENSURED=0
FULL_SEQUENCE_HOST_OVERRIDES_RESET=0
FULL_SEQUENCE_HOST_OVERRIDES_APPLIED=0
FULL_SEQUENCE_TARGET=""

list_required_node_candidates() {
  local version_dir=""

  for version_dir in \
    "${HOME}/.nvm/versions/node"/v"${REQUIRED_NODE_MAJOR}".*/bin \
    "${HOME}/.local/share/mise/installs/node"/"${REQUIRED_NODE_MAJOR}".*/bin \
    "${HOME}/.volta/tools/image/node"/"${REQUIRED_NODE_MAJOR}".*/bin; do
    if [[ -x "${version_dir}/node" ]]; then
      printf '%s\n' "${version_dir}"
    fi
  done | sort -Vu
}

ensure_required_node_runtime() {
  local node_version=""
  local node_major=""
  local candidate_dir=""

  if ! command -v node >/dev/null 2>&1; then
    for candidate_dir in $(list_required_node_candidates); do
      PATH="${candidate_dir}:${PATH}"
      export PATH
      break
    done
  fi

  if ! command -v node >/dev/null 2>&1; then
    echo "ERROR: node is required for the stage browser contract." >&2
    exit 1
  fi

  node_version="$(node --version 2>/dev/null | tr -d '\r\n' || true)"
  node_major="${node_version#v}"
  node_major="${node_major%%.*}"

  if [[ -z "${node_major}" || "${node_major}" != "${REQUIRED_NODE_MAJOR}" ]]; then
    while IFS= read -r candidate_dir; do
      PATH="${candidate_dir}:${PATH}"
      export PATH
      hash -r
      node_version="$(node --version 2>/dev/null | tr -d '\r\n' || true)"
      node_major="${node_version#v}"
      node_major="${node_major%%.*}"
      if [[ -n "${node_major}" && "${node_major}" == "${REQUIRED_NODE_MAJOR}" ]]; then
        return 0
      fi
    done < <(list_required_node_candidates)
  else
    return 0
  fi

  echo "ERROR: stage browser contract requires Node major ${REQUIRED_NODE_MAJOR} to match the protected pipeline (found ${node_version:-<missing>})." >&2
  exit 1
}

usage() {
  cat >&2 <<'EOF'
Usage:
  bash tools/ci/run_stage_browser_contract.sh <local-public|stage> <step>

Targets:
  local-public   Canonical local-public CI Equivalent browser contract surface.
  stage          Published stage pipeline browser contract surface.

Steps:
  build
  install-deps
  verify-browser
  probe-public-edge
  warmup
  provenance
  fixture-ensure
  host-overrides-apply
  readonly
  mutation
  fixture-cleanup
  host-overrides-reset
  full
EOF
}

ensure_contract_state_dir() {
  mkdir -p "${CONTRACT_STATE_DIR}"
}

clear_contract_run_id_state() {
  rm -f "${LOCAL_PUBLIC_RUN_ID_FILE}"
}

persist_contract_run_id() {
  ensure_contract_state_dir
  printf '%s\n' "${NAV_TEST_RUN_ID}" > "${LOCAL_PUBLIC_RUN_ID_FILE}"
}

read_persisted_contract_run_id() {
  if [[ ! -f "${LOCAL_PUBLIC_RUN_ID_FILE}" ]]; then
    return 1
  fi

  local persisted_run_id=""
  persisted_run_id="$(tr -d '\r\n[:space:]' < "${LOCAL_PUBLIC_RUN_ID_FILE}")"
  if [[ -z "${persisted_run_id}" ]]; then
    return 1
  fi

  printf '%s\n' "${persisted_run_id}"
}

is_loopback_origin_ip() {
  case "${NAV_ORIGIN_IP:-}" in
    127.0.0.1|localhost)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

manage_local_public_loopback_bridge() {
  local action="$1"
  ensure_contract_state_dir
  sudo python3 "${LOCAL_PUBLIC_LOOPBACK_BRIDGE_SCRIPT}" \
    "${action}" \
    "${LOCAL_PUBLIC_LOOPBACK_BRIDGE_PID_FILE}" \
    "${LOCAL_PUBLIC_LOOPBACK_BRIDGE_LOG_FILE}"
}

ensure_local_public_loopback_bridge() {
  local target="$1"
  if [[ "${target}" != "local-public" ]]; then
    return 0
  fi
  if ! is_loopback_origin_ip; then
    return 0
  fi
  manage_local_public_loopback_bridge start
}

reset_local_public_loopback_bridge() {
  local target="$1"
  if [[ "${target}" != "local-public" ]]; then
    return 0
  fi
  sudo python3 "${LOCAL_PUBLIC_LOOPBACK_BRIDGE_SCRIPT}" \
    stop \
    "${LOCAL_PUBLIC_LOOPBACK_BRIDGE_PID_FILE}" \
    "${LOCAL_PUBLIC_LOOPBACK_BRIDGE_LOG_FILE}"
}

load_local_public_navigation_env() {
  if [[ ! -f "${LOCAL_NAV_ENV_FILE}" ]]; then
    return 0
  fi

  set -a
  # shellcheck disable=SC1090
  source "${LOCAL_NAV_ENV_FILE}"
  set +a
}

parse_host_from_url() {
  local input_url="$1"
  python3 -c 'import sys, urllib.parse; print((urllib.parse.urlparse(sys.argv[1]).hostname or "").strip().lower())' "${input_url}"
}

read_index_runtime_marker() {
  local index_path="$1"
  local marker="$2"

  python3 - "${index_path}" "${marker}" <<'PY'
import re
import sys
from pathlib import Path

index_path = Path(sys.argv[1])
marker = sys.argv[2]
patterns = {
    "build_sha": r'window\.__WEB_BUILD_SHA__\s*=\s*"([^"]+)"',
    "landlord_host": r'window\.__LANDLORD_HOST__\s*=\s*"([^"]+)"',
}

pattern = patterns.get(marker)
if pattern is None:
    raise SystemExit(1)

text = index_path.read_text(encoding="utf-8")
match = re.search(pattern, text)
if match:
    print(match.group(1).strip())
PY
}

configure_target_env() {
  local target="$1"

  case "${target}" in
    local-public)
      load_local_public_navigation_env
      export NAV_DEPLOY_LANE="local"
      ;;
    stage)
      export NAV_DEPLOY_LANE="${NAV_DEPLOY_LANE:-stage}"
      ;;
    *)
      echo "ERROR: unsupported contract target '${target}'." >&2
      exit 2
      ;;
  esac

  export NAV_WEB_WORKERS="${NAV_WEB_WORKERS:-1}"

  if [[ -n "${NAV_LANDLORD_URL:-}" ]]; then
    export NAV_EXPECTED_LANDLORD_HOST="${NAV_EXPECTED_LANDLORD_HOST:-$(parse_host_from_url "${NAV_LANDLORD_URL}")}"
  fi

  if [[ "${target}" == "local-public" && -f "${WEB_DIR}/index.html" ]]; then
    export NAV_EXPECTED_WEB_BUILD_SHA="${NAV_EXPECTED_WEB_BUILD_SHA:-$(read_index_runtime_marker "${WEB_DIR}/index.html" build_sha || true)}"
  fi

  if [[ -n "${NAV_ORIGIN_IP:-}" ]]; then
    export PLAYWRIGHT_IGNORE_HTTPS_ERRORS="${PLAYWRIGHT_IGNORE_HTTPS_ERRORS:-true}"
  else
    export PLAYWRIGHT_IGNORE_HTTPS_ERRORS="${PLAYWRIGHT_IGNORE_HTTPS_ERRORS:-false}"
  fi
}

ensure_landlord_url() {
  if [[ -z "${NAV_LANDLORD_URL:-}" ]]; then
    echo "ERROR: NAV_LANDLORD_URL is required for this stage browser contract step." >&2
    exit 1
  fi
}

ensure_tenant_url() {
  if [[ -z "${NAV_TENANT_URL:-}" ]]; then
    echo "ERROR: NAV_TENANT_URL is required for this stage browser contract step." >&2
    exit 1
  fi
}

ensure_navigation_urls() {
  ensure_landlord_url
  ensure_tenant_url
}

ensure_contract_run_id() {
  local target="$1"
  local persisted_run_id=""

  if [[ -n "${NAV_TEST_RUN_ID:-}" ]]; then
    if [[ "${target}" == "local-public" ]]; then
      persist_contract_run_id
    fi
    return 0
  fi

  if [[ "${target}" == "local-public" ]]; then
    persisted_run_id="$(read_persisted_contract_run_id || true)"
    if [[ -n "${persisted_run_id}" ]]; then
      export NAV_TEST_RUN_ID="${persisted_run_id}"
      return 0
    fi
  fi

  export NAV_TEST_RUN_ID="stage-full-local-$(date -u +%Y%m%dT%H%M%SZ)-$$"

  if [[ "${target}" == "local-public" ]]; then
    persist_contract_run_id
  fi
}

require_mutation_credentials() {
  if [[ -n "${NAV_ADMIN_EMAIL:-}" && -n "${NAV_ADMIN_PASSWORD:-}" ]]; then
    return 0
  fi

  if [[ ! -f "${LOCAL_NAV_ENV_FILE}" ]]; then
    echo "ERROR: mutation contract requires NAV_ADMIN_EMAIL/NAV_ADMIN_PASSWORD in the shell or ${LOCAL_NAV_ENV_FILE}." >&2
    exit 1
  fi

  load_local_public_navigation_env

  if [[ -z "${NAV_ADMIN_EMAIL:-}" || -z "${NAV_ADMIN_PASSWORD:-}" ]]; then
    echo "ERROR: ${LOCAL_NAV_ENV_FILE} must define NAV_ADMIN_EMAIL and NAV_ADMIN_PASSWORD for the local-public stage browser contract." >&2
    exit 1
  fi
}

run_local_public_build() {
  clear_contract_run_id_state
  (
    cd "${FLUTTER_DIR}"
    CLEAN_OUTPUT=1 BUILD_HEARTBEAT_SECONDS="${BUILD_HEARTBEAT_SECONDS:-30}" \
      bash scripts/build_web.sh ../web-app "${LOCAL_BUILD_LANE}" --clean-output
  )
}

install_navigation_deps() {
  ensure_required_node_runtime

  (
    cd "${SMOKE_RUNNER_DIR}"
    npm ci
  )
}

verify_playwright_browser() {
  bash "${ROOT_DIR}/tools/flutter/resolve_playwright_browser.sh"
}

probe_public_edge() {
  local label="$1"
  ensure_navigation_urls
  bash "${ROOT_DIR}/.github/scripts/probe_public_navigation_environment_over_https.sh" "${label}"
}

warmup_environment() {
  local target="$1"
  local label="$2"
  ensure_navigation_urls
  ensure_local_public_loopback_bridge "${target}"
  bash "${ROOT_DIR}/.github/scripts/warmup_navigation_environment_over_https.sh" "${label}"
}

assert_served_main_dart_sha_matches_local() {
  local target_url="$1"
  local label="$2"
  local local_sha=""
  local served_sha=""

  local_sha="$(sha256sum "${WEB_DIR}/main.dart.js" | awk '{print $1}')"
  served_sha="$(curl -ks "${target_url%/}/main.dart.js" | sha256sum | awk '{print $1}')"

  if [[ -z "${local_sha}" || -z "${served_sha}" || "${local_sha}" != "${served_sha}" ]]; then
    echo "ERROR: served main.dart.js SHA mismatch for ${label}." >&2
    echo "  local : ${local_sha:-<missing>}" >&2
    echo "  served: ${served_sha:-<missing>}" >&2
    echo "  url   : ${target_url%/}/main.dart.js" >&2
    exit 1
  fi
}

assert_served_index_runtime_markers_match_local() {
  local landlord_url="${NAV_LANDLORD_URL%/}"
  local served_index=""
  local served_build_sha=""
  local served_landlord_host=""
  local local_build_sha=""
  local local_landlord_host=""
  local expected_landlord_host=""

  served_index="$(mktemp)"
  curl -ks "${landlord_url}/index.html" > "${served_index}"

  served_build_sha="$(read_index_runtime_marker "${served_index}" build_sha || true)"
  served_landlord_host="$(read_index_runtime_marker "${served_index}" landlord_host || true)"
  local_build_sha="$(read_index_runtime_marker "${WEB_DIR}/index.html" build_sha || true)"
  local_landlord_host="$(read_index_runtime_marker "${WEB_DIR}/index.html" landlord_host || true)"
  expected_landlord_host="$(parse_host_from_url "${NAV_LANDLORD_URL}")"

  rm -f "${served_index}"

  if [[ -z "${served_build_sha}" || -z "${local_build_sha}" || "${served_build_sha}" != "${local_build_sha}" ]]; then
    echo "ERROR: served index build SHA does not match the current local-public web build." >&2
    echo "  local : ${local_build_sha:-<missing>}" >&2
    echo "  served: ${served_build_sha:-<missing>}" >&2
    exit 1
  fi

  if [[ -z "${served_landlord_host}" || "${served_landlord_host}" != "${expected_landlord_host}" || "${local_landlord_host}" != "${expected_landlord_host}" ]]; then
    echo "ERROR: served index landlord-host marker does not match the canonical local-public landlord host." >&2
    echo "  expected: ${expected_landlord_host}" >&2
    echo "  local   : ${local_landlord_host:-<missing>}" >&2
    echo "  served  : ${served_landlord_host:-<missing>}" >&2
    exit 1
  fi
}

check_local_public_provenance() {
  ensure_landlord_url
  ensure_local_public_loopback_bridge local-public
  LANDLORD_DOMAIN="${NAV_LANDLORD_URL}" DEPLOY_LANE="${LOCAL_BUILD_LANE}" \
    bash "${ROOT_DIR}/.github/scripts/check_deployed_web_provenance.sh" "${LOCAL_BUILD_LANE}"
}

check_stage_provenance() {
  ensure_landlord_url
  DEPLOY_LANE=stage bash "${ROOT_DIR}/.github/scripts/check_deployed_web_provenance.sh" stage
}

enforce_public_default_origin_state() {
  local mode="$1"

  ensure_required_node_runtime

  NODE_PATH="${SMOKE_RUNNER_DIR}/node_modules${NODE_PATH:+:${NODE_PATH}}" \
  NAV_PUBLIC_DEFAULT_ORIGIN_MODE="${mode}" \
  NAV_PUBLIC_DEFAULT_ORIGIN_LAT="-20.671339" \
  NAV_PUBLIC_DEFAULT_ORIGIN_LNG="-40.495395" \
  NAV_PUBLIC_DEFAULT_ORIGIN_LABEL="Praia do Morro" \
  ROOT_DIR="${ROOT_DIR}" \
  node <<'EOF'
const { request, expect } = require('@playwright/test');
const { loginTenantAdmin } = require(`${process.env.ROOT_DIR}/tools/flutter/web_app_tests/support/tenant_admin_auth`);

function buildUrl(baseUrl, pathName) {
  return new URL(pathName, baseUrl).toString();
}

function readDefaultOrigin(payload) {
  if (payload?.default_origin && typeof payload.default_origin === 'object') {
    return payload.default_origin;
  }

  return {
    lat: payload?.['default_origin.lat'] ?? null,
    lng: payload?.['default_origin.lng'] ?? null,
    label: payload?.['default_origin.label'] ?? null,
  };
}

(async () => {
  const mode = process.env.NAV_PUBLIC_DEFAULT_ORIGIN_MODE;
  const baseUrl = process.env.NAV_TENANT_URL;
  const managedOrigin = {
    lat: Number(process.env.NAV_PUBLIC_DEFAULT_ORIGIN_LAT),
    lng: Number(process.env.NAV_PUBLIC_DEFAULT_ORIGIN_LNG),
    label: process.env.NAV_PUBLIC_DEFAULT_ORIGIN_LABEL,
  };
  const api = await request.newContext({
    baseURL: baseUrl,
    extraHTTPHeaders: { Accept: 'application/json' },
    ignoreHTTPSErrors: true,
  });

  try {
    const session = await loginTenantAdmin({
      api,
      baseUrl,
      buildUrl,
      deviceName: `stage-browser-contract-default-origin-${mode}`,
    });
    const headers = {
      Accept: 'application/json',
      Authorization: `Bearer ${session.token}`,
    };

    const currentResponse = await api.get(buildUrl(baseUrl, '/admin/api/v1/settings/values'), {
      headers,
    });
    expect(currentResponse.status()).toBe(200);
    const currentPayload = await currentResponse.json();
    const currentOrigin = readDefaultOrigin(currentPayload?.data?.map_ui || {});
    const isManagedOrigin =
      Number(currentOrigin?.lat) === managedOrigin.lat &&
      Number(currentOrigin?.lng) === managedOrigin.lng &&
      (currentOrigin?.label ?? null) === managedOrigin.label;

    let patchData = null;
    if (mode === 'ensure') {
      if (!isManagedOrigin) {
        patchData = {
          'default_origin.lat': managedOrigin.lat,
          'default_origin.lng': managedOrigin.lng,
          'default_origin.label': managedOrigin.label,
        };
      }
    } else if (mode === 'cleanup') {
      if (isManagedOrigin) {
        patchData = {
          'default_origin.lat': null,
          'default_origin.lng': null,
          'default_origin.label': null,
        };
      }
    } else {
      throw new Error(`Unsupported NAV_PUBLIC_DEFAULT_ORIGIN_MODE: ${mode}`);
    }

    if (patchData) {
      const patchResponse = await api.patch(
        buildUrl(baseUrl, '/admin/api/v1/settings/values/map_ui'),
        { headers, data: patchData },
      );
      expect(patchResponse.status()).toBe(200);
    }

    const verifyResponse = await api.get(buildUrl(baseUrl, '/admin/api/v1/settings/values'), {
      headers,
    });
    expect(verifyResponse.status()).toBe(200);
    const verifyPayload = await verifyResponse.json();
    const verifyOrigin = readDefaultOrigin(verifyPayload?.data?.map_ui || {});
    if (mode === 'ensure') {
      expect({
        lat: Number(verifyOrigin?.lat),
        lng: Number(verifyOrigin?.lng),
        label: verifyOrigin?.label ?? null,
      }).toEqual(managedOrigin);
    } else {
      expect(verifyOrigin?.lat ?? null).toBeNull();
      expect(verifyOrigin?.lng ?? null).toBeNull();
      expect(verifyOrigin?.label ?? null).toBeNull();
    }
  } finally {
    await api.dispose();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
EOF
}

fixture_ensure() {
  local target="$1"
  ensure_tenant_url
  ensure_contract_run_id "${target}"
  require_mutation_credentials
  ensure_required_node_runtime
  export NAV_WEB_ALLOW_NONLOCAL_MUTATION_HOSTS=1
  export NODE_PATH="${SMOKE_RUNNER_DIR}/node_modules${NODE_PATH:+:${NODE_PATH}}"

  (
    cd "${SMOKE_RUNNER_DIR}"
    node ../web_app_tests/ensure_public_taxonomy_validation_fixture.cjs
  )

  enforce_public_default_origin_state ensure
}

fixture_cleanup() {
  local target="$1"
  ensure_tenant_url
  ensure_contract_run_id "${target}"
  require_mutation_credentials
  ensure_required_node_runtime
  export NAV_PUBLIC_TAXONOMY_FIXTURE_ACTION=cleanup
  export NAV_WEB_ALLOW_NONLOCAL_MUTATION_HOSTS=1
  export NODE_PATH="${SMOKE_RUNNER_DIR}/node_modules${NODE_PATH:+:${NODE_PATH}}"

  (
    cd "${SMOKE_RUNNER_DIR}"
    node ../web_app_tests/ensure_public_taxonomy_validation_fixture.cjs
  )

  enforce_public_default_origin_state cleanup

  if [[ "${target}" == "local-public" ]]; then
    clear_contract_run_id_state
  fi
}

apply_host_overrides() {
  local target="$1"

  ensure_navigation_urls

  if [[ -z "${NAV_ORIGIN_IP:-}" ]]; then
    echo "ERROR: ${target} host-overrides-apply requires NAV_ORIGIN_IP. Refusing to fall back to public DNS during browser contract execution." >&2
    exit 1
  fi

  ensure_local_public_loopback_bridge "${target}"
  bash "${ROOT_DIR}/.github/scripts/manage_navigation_host_overrides.sh" apply
}

reset_host_overrides() {
  local target="${1:-}"
  reset_local_public_loopback_bridge "${target}"
  bash "${ROOT_DIR}/.github/scripts/manage_navigation_host_overrides.sh" reset
}

run_navigation_smoke() {
  local target="$1"
  local suite="$2"

  ensure_navigation_urls
  ensure_contract_run_id "${target}"
  if [[ "${NAV_STAGE_BROWSER_SKIP_FIXTURE_ENSURE:-0}" == "1" ]]; then
    if [[ -z "${NAV_TEST_RUN_ID:-}" ]]; then
      echo "ERROR: NAV_STAGE_BROWSER_SKIP_FIXTURE_ENSURE=1 requires NAV_TEST_RUN_ID or a persisted local-public run id." >&2
      exit 1
    fi
    echo "INFO: reusing managed fixture run ${NAV_TEST_RUN_ID}; skipping fixture ensure."
  elif (( FULL_SEQUENCE_FIXTURE_ENSURED == 0 )); then
    fixture_ensure "${target}"
  fi
  export NAV_PUBLIC_TAXONOMY_MANAGED_FIXTURE=1

  case "${suite}" in
    readonly)
      ;;
    mutation)
      require_mutation_credentials
      export NAV_WEB_ALLOW_NONLOCAL_MUTATION_HOSTS=1
      ;;
    *)
      echo "ERROR: unsupported stage browser contract suite '${suite}'." >&2
      exit 2
      ;;
  esac

  bash "${ROOT_DIR}/tools/flutter/run_web_navigation_smoke.sh" "${suite}"
}

cleanup_local_public_browser_state() {
  local cleanup_status=0

  fixture_cleanup local-public || cleanup_status=$?
  reset_host_overrides local-public || cleanup_status=$?

  return "${cleanup_status}"
}

full_sequence_cleanup() {
  local original_status="$1"
  local cleanup_status=0

  if (( FULL_SEQUENCE_ACTIVE == 0 )); then
    return 0
  fi

  if (( FULL_SEQUENCE_FIXTURE_ENSURED != 0 )); then
    fixture_cleanup "${FULL_SEQUENCE_TARGET}" || cleanup_status=$?
  fi

  if (( FULL_SEQUENCE_HOST_OVERRIDES_RESET != 0 || FULL_SEQUENCE_HOST_OVERRIDES_APPLIED != 0 )); then
    reset_host_overrides || cleanup_status=$?
  fi

  if (( original_status == 0 && cleanup_status != 0 )); then
    exit "${cleanup_status}"
  fi
}

run_full_sequence() {
  local target="$1"
  local label=""

  FULL_SEQUENCE_ACTIVE=1
  FULL_SEQUENCE_FIXTURE_ENSURED=0
  FULL_SEQUENCE_HOST_OVERRIDES_RESET=0
  FULL_SEQUENCE_HOST_OVERRIDES_APPLIED=0
  FULL_SEQUENCE_TARGET="${target}"

  case "${target}" in
    local-public)
      label="stage-full"
      reset_host_overrides "${target}"
      FULL_SEQUENCE_HOST_OVERRIDES_RESET=1
      run_local_public_build
      ;;
    stage)
      label="stage"
      reset_host_overrides "${target}"
      FULL_SEQUENCE_HOST_OVERRIDES_RESET=1
      ;;
    *)
      echo "ERROR: unsupported full-sequence target '${target}'." >&2
      exit 2
      ;;
  esac

  install_navigation_deps
  verify_playwright_browser
  probe_public_edge "${label}"
  warmup_environment "${target}" "${label}"

  case "${target}" in
    local-public)
      check_local_public_provenance
      ;;
    stage)
      check_stage_provenance
      ;;
  esac

  fixture_ensure "${target}"
  FULL_SEQUENCE_FIXTURE_ENSURED=1
  apply_host_overrides
  FULL_SEQUENCE_HOST_OVERRIDES_APPLIED=1
  run_navigation_smoke "${target}" readonly
  run_navigation_smoke "${target}" mutation
}

main() {
  if [[ $# -ne 2 ]]; then
    usage
    exit 2
  fi

  local target="$1"
  local step="$2"

  configure_target_env "${target}"

  case "${target}:${step}" in
    local-public:build)
      run_local_public_build
      ;;
    local-public:install-deps|stage:install-deps)
      install_navigation_deps
      ;;
    local-public:verify-browser|stage:verify-browser)
      verify_playwright_browser
      ;;
    local-public:probe-public-edge)
      probe_public_edge stage-full
      ;;
    stage:probe-public-edge)
      probe_public_edge stage
      ;;
    local-public:warmup)
      warmup_environment "${target}" stage-full
      ;;
    stage:warmup)
      warmup_environment "${target}" stage
      ;;
    local-public:provenance)
      check_local_public_provenance
      ;;
    stage:provenance)
      check_stage_provenance
      ;;
    local-public:fixture-ensure|stage:fixture-ensure)
      fixture_ensure "${target}"
      ;;
    local-public:host-overrides-apply|stage:host-overrides-apply)
      apply_host_overrides "${target}"
      ;;
    local-public:readonly|stage:readonly)
      run_navigation_smoke "${target}" readonly
      ;;
    local-public:mutation|stage:mutation)
      run_navigation_smoke "${target}" mutation
      ;;
    local-public:fixture-cleanup|stage:fixture-cleanup)
      fixture_cleanup "${target}"
      ;;
    local-public:host-overrides-reset|stage:host-overrides-reset)
      reset_host_overrides "${target}"
      ;;
    local-public:full|stage:full)
      trap 'full_sequence_cleanup $?' EXIT
      run_full_sequence "${target}"
      ;;
    *)
      usage
      exit 2
      ;;
  esac
}

main "$@"
