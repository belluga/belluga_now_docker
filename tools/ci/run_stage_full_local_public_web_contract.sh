#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FLUTTER_DIR="${ROOT_DIR}/flutter-app"
WEB_DIR="${ROOT_DIR}/web-app"
LOCAL_NAV_ENV_FILE="${NAV_LOCAL_ENV_FILE:-${ROOT_DIR}/.env.local.navigation}"

readonly CANONICAL_LANDLORD_URL="https://belluga.space"
readonly CANONICAL_TENANT_URL="https://guarappari.belluga.space"
readonly CANONICAL_LOCAL_LANE="dev"

usage() {
  cat >&2 <<'EOF'
Usage: bash tools/ci/run_stage_full_local_public_web_contract.sh <prepare|readonly|mutation>

The stage-full local-public contract is deterministic:
- landlord URL: https://belluga.space
- tenant URL:   https://guarappari.belluga.space
- lane:         dev

Mutation uses the canonical local-public mutation opt-in and expects
tenant-admin credentials via shell env or .env.local.navigation.
EOF
}

configure_local_public_contract_env() {
  export NAV_LANDLORD_URL="${CANONICAL_LANDLORD_URL}"
  export NAV_TENANT_URL="${CANONICAL_TENANT_URL}"
  export NAV_DEPLOY_LANE="${CANONICAL_LOCAL_LANE}"
  export NAV_WEB_WORKERS="${NAV_WEB_WORKERS:-1}"
  export PLAYWRIGHT_IGNORE_HTTPS_ERRORS="${PLAYWRIGHT_IGNORE_HTTPS_ERRORS:-true}"
}

require_mutation_credentials() {
  if [[ -n "${NAV_ADMIN_EMAIL:-}" && -n "${NAV_ADMIN_PASSWORD:-}" ]]; then
    return 0
  fi

  if [[ ! -f "${LOCAL_NAV_ENV_FILE}" ]]; then
    echo "ERROR: mutation contract requires NAV_ADMIN_EMAIL/NAV_ADMIN_PASSWORD in the shell or ${LOCAL_NAV_ENV_FILE}." >&2
    exit 1
  fi

  if ! grep -Eq '^NAV_ADMIN_EMAIL=' "${LOCAL_NAV_ENV_FILE}"; then
    echo "ERROR: ${LOCAL_NAV_ENV_FILE} must define NAV_ADMIN_EMAIL for the stage-full mutation contract." >&2
    exit 1
  fi

  if ! grep -Eq '^NAV_ADMIN_PASSWORD=' "${LOCAL_NAV_ENV_FILE}"; then
    echo "ERROR: ${LOCAL_NAV_ENV_FILE} must define NAV_ADMIN_PASSWORD for the stage-full mutation contract." >&2
    exit 1
  fi
}

probe_served_bundle_sha() {
  local target_url="$1"
  local label="$2"
  local local_sha served_sha

  local_sha="$(sha256sum "${WEB_DIR}/main.dart.js" | awk '{print $1}')"
  served_sha="$(curl -ks "${target_url%/}/main.dart.js" | sha256sum | awk '{print $1}')"

  if [[ -z "${local_sha}" || -z "${served_sha}" ]]; then
    echo "ERROR: failed to resolve local/served bundle SHA for ${label}." >&2
    exit 1
  fi

  if [[ "${local_sha}" != "${served_sha}" ]]; then
    echo "ERROR: served bundle SHA mismatch for ${label}." >&2
    echo "  local : ${local_sha}" >&2
    echo "  served: ${served_sha}" >&2
    echo "  url   : ${target_url%/}/main.dart.js" >&2
    exit 1
  fi

  echo "INFO: ${label} served bundle SHA matched local build (${local_sha})."
}

run_prepare() {
  configure_local_public_contract_env

  (
    cd "${FLUTTER_DIR}"
    CLEAN_OUTPUT=1 BUILD_HEARTBEAT_SECONDS="${BUILD_HEARTBEAT_SECONDS:-30}" \
      bash scripts/build_web.sh ../web-app "${CANONICAL_LOCAL_LANE}" --clean-output
  )

  bash "${ROOT_DIR}/.github/scripts/warmup_navigation_environment_over_https.sh" stage-full
  bash "${ROOT_DIR}/.github/scripts/probe_public_navigation_environment_over_https.sh" stage-full
  probe_served_bundle_sha "${NAV_LANDLORD_URL}" "landlord"
  probe_served_bundle_sha "${NAV_TENANT_URL}" "tenant"
}

run_navigation_smoke() {
  local suite="$1"
  configure_local_public_contract_env

  case "${suite}" in
    readonly)
      ;;
    mutation)
      export NAV_WEB_ALLOW_NONLOCAL_MUTATION_HOSTS=1
      require_mutation_credentials
      ;;
    *)
      echo "ERROR: unsupported stage-full local-public suite '${suite}'." >&2
      exit 1
      ;;
  esac

  bash "${ROOT_DIR}/tools/flutter/run_web_navigation_smoke.sh" "${suite}"
}

main() {
  if [[ $# -ne 1 ]]; then
    usage
    exit 1
  fi

  case "$1" in
    prepare)
      run_prepare
      ;;
    readonly)
      run_navigation_smoke readonly
      ;;
    mutation)
      run_navigation_smoke mutation
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"
