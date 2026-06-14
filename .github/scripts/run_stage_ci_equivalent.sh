#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  NAV_TENANT_URL_INPUT=https://<tenant-stage-host> \
  NAV_ADMIN_EMAIL=<tenant-admin-email> \
  NAV_ADMIN_PASSWORD=<tenant-admin-password> \
  bash .github/scripts/run_stage_ci_equivalent.sh

Authoritative local stage-equivalent validation for the root repo. This runner:
  1. validates root workflow invariants;
  2. resolves the published stage landlord/tenant targets;
  3. probes the public edge and deployed provenance;
  4. ensures the managed public taxonomy fixture;
  5. runs readonly and mutation navigation smoke against the published stage lane;
  6. cleans up the managed fixture before exit.

Notes:
  - This runner is stage-specific and intentionally does not read .env.local.navigation.
  - Stage target selection must stay explicit so dev/.space cannot masquerade as stage.
  - Optional NAV_ORIGIN_IP enables temporary host overrides for the smoke phase only.
EOF
}

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "ERROR: missing required env ${name}." >&2
    exit 1
  fi
}

load_github_output_file() {
  local file_path="$1"
  set -a
  # shellcheck disable=SC1090
  source "$file_path"
  set +a
}

main() {
  if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    exit 0
  fi

  if [[ $# -ne 0 ]]; then
    usage
    exit 1
  fi

  require_env "NAV_TENANT_URL_INPUT"
  require_env "NAV_ADMIN_EMAIL"
  require_env "NAV_ADMIN_PASSWORD"

  STAGE_EQ_REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
  cd "$STAGE_EQ_REPO_ROOT"

  STAGE_EQ_NAV_TEST_RUN_ID="${NAV_TEST_RUN_ID:-stage-local-$(date +%Y%m%d%H%M%S)-$$}"
  STAGE_EQ_NODE_PATH="${NODE_PATH:-$STAGE_EQ_REPO_ROOT/tools/flutter/web_app_smoke_runner/node_modules}"
  STAGE_EQ_ALLOW_NONLOCAL_MUTATION_HOSTS="${NAV_WEB_ALLOW_NONLOCAL_MUTATION_HOSTS:-1}"

  STAGE_EQ_TARGETS_OUTPUT="$(mktemp)"
  STAGE_EQ_HOST_OVERRIDE_OUTPUT="$(mktemp)"
  STAGE_EQ_FIXTURE_PREPARED=0
  STAGE_EQ_HOST_OVERRIDE_APPLIED=0
  STAGE_EQ_PLAYWRIGHT_IGNORE_HTTPS_ERRORS="${PLAYWRIGHT_IGNORE_HTTPS_ERRORS:-false}"

  cleanup() {
    local exit_code=$?

    if [[ "${STAGE_EQ_FIXTURE_PREPARED:-0}" -eq 1 ]]; then
      (
        cd "$STAGE_EQ_REPO_ROOT/tools/flutter/web_app_smoke_runner"
        NODE_PATH="$STAGE_EQ_NODE_PATH" \
        NAV_DEPLOY_LANE=stage \
        NAV_PUBLIC_TAXONOMY_FIXTURE_ACTION=cleanup \
        NAV_TEST_RUN_ID="$STAGE_EQ_NAV_TEST_RUN_ID" \
        NAV_TENANT_URL="$NAV_TENANT_URL" \
        NAV_ADMIN_EMAIL="$NAV_ADMIN_EMAIL" \
        NAV_ADMIN_PASSWORD="$NAV_ADMIN_PASSWORD" \
        NAV_WEB_ALLOW_NONLOCAL_MUTATION_HOSTS="$STAGE_EQ_ALLOW_NONLOCAL_MUTATION_HOSTS" \
        node ../web_app_tests/ensure_public_taxonomy_validation_fixture.cjs
      ) || true
    fi

    if [[ "${STAGE_EQ_HOST_OVERRIDE_APPLIED:-0}" -eq 1 ]]; then
      bash "$STAGE_EQ_REPO_ROOT/.github/scripts/manage_navigation_host_overrides.sh" reset || true
    fi

    rm -f "${STAGE_EQ_TARGETS_OUTPUT:-}" "${STAGE_EQ_HOST_OVERRIDE_OUTPUT:-}"
    exit "$exit_code"
  }
  trap cleanup EXIT

  echo "INFO: running root workflow invariants before stage-equivalent smoke."
  bash "$STAGE_EQ_REPO_ROOT/.github/scripts/verify_environment_ci.sh"

  echo "INFO: resolving explicit stage navigation targets."
  GITHUB_OUTPUT="$STAGE_EQ_TARGETS_OUTPUT" \
  NAV_TENANT_URL_INPUT="$NAV_TENANT_URL_INPUT" \
  NAV_LANDLORD_URL_INPUT="${NAV_LANDLORD_URL_INPUT:-}" \
  bash "$STAGE_EQ_REPO_ROOT/.github/scripts/resolve_lane_navigation_targets.sh" stage
  load_github_output_file "$STAGE_EQ_TARGETS_OUTPUT"

  export NAV_DEPLOY_LANE=stage
  export NAV_TEST_RUN_ID="$STAGE_EQ_NAV_TEST_RUN_ID"
  export NAV_LANDLORD_URL="$landlord_url"
  export NAV_TENANT_URL="$tenant_url"

  echo "INFO: probing published stage public edge."
  bash "$STAGE_EQ_REPO_ROOT/.github/scripts/probe_public_navigation_environment_over_https.sh" stage

  echo "INFO: validating deployed stage provenance."
  DEPLOY_LANE=stage \
  NAV_LANDLORD_URL="$NAV_LANDLORD_URL" \
  NAV_ORIGIN_IP="${NAV_ORIGIN_IP:-}" \
  bash "$STAGE_EQ_REPO_ROOT/.github/scripts/check_deployed_web_provenance.sh" stage

  if [[ -n "${NAV_ORIGIN_IP:-}" ]]; then
    echo "INFO: applying temporary navigation host overrides for origin-targeted smoke."
    GITHUB_OUTPUT="$STAGE_EQ_HOST_OVERRIDE_OUTPUT" \
    NAV_LANDLORD_URL="$NAV_LANDLORD_URL" \
    NAV_TENANT_URL="$NAV_TENANT_URL" \
    NAV_ORIGIN_IP="$NAV_ORIGIN_IP" \
    bash "$STAGE_EQ_REPO_ROOT/.github/scripts/manage_navigation_host_overrides.sh" apply
    load_github_output_file "$STAGE_EQ_HOST_OVERRIDE_OUTPUT"
    STAGE_EQ_PLAYWRIGHT_IGNORE_HTTPS_ERRORS="${playwright_ignore_https_errors:-$STAGE_EQ_PLAYWRIGHT_IGNORE_HTTPS_ERRORS}"
    STAGE_EQ_HOST_OVERRIDE_APPLIED=1
  fi

  echo "INFO: ensuring managed public taxonomy validation fixture."
  (
    cd "$STAGE_EQ_REPO_ROOT/tools/flutter/web_app_smoke_runner"
    NODE_PATH="$STAGE_EQ_NODE_PATH" \
    NAV_DEPLOY_LANE=stage \
    NAV_TEST_RUN_ID="$STAGE_EQ_NAV_TEST_RUN_ID" \
    NAV_TENANT_URL="$NAV_TENANT_URL" \
    NAV_ADMIN_EMAIL="$NAV_ADMIN_EMAIL" \
    NAV_ADMIN_PASSWORD="$NAV_ADMIN_PASSWORD" \
    NAV_WEB_ALLOW_NONLOCAL_MUTATION_HOSTS="$STAGE_EQ_ALLOW_NONLOCAL_MUTATION_HOSTS" \
    node ../web_app_tests/ensure_public_taxonomy_validation_fixture.cjs
  )
  STAGE_EQ_FIXTURE_PREPARED=1

  echo "INFO: running stage readonly navigation smoke."
  NAV_DEPLOY_LANE=stage \
  NAV_TEST_RUN_ID="$STAGE_EQ_NAV_TEST_RUN_ID" \
  NAV_PUBLIC_TAXONOMY_MANAGED_FIXTURE=1 \
  NAV_WEB_TEST_TYPE=readonly \
  NAV_LANDLORD_URL="$NAV_LANDLORD_URL" \
  NAV_TENANT_URL="$NAV_TENANT_URL" \
  PLAYWRIGHT_IGNORE_HTTPS_ERRORS="$STAGE_EQ_PLAYWRIGHT_IGNORE_HTTPS_ERRORS" \
  bash "$STAGE_EQ_REPO_ROOT/tools/flutter/run_web_navigation_smoke.sh" readonly

  echo "INFO: running stage mutation navigation smoke."
  NAV_DEPLOY_LANE=stage \
  NAV_TEST_RUN_ID="$STAGE_EQ_NAV_TEST_RUN_ID" \
  NAV_WEB_TEST_TYPE=mutation \
  NAV_LANDLORD_URL="$NAV_LANDLORD_URL" \
  NAV_TENANT_URL="$NAV_TENANT_URL" \
  PLAYWRIGHT_IGNORE_HTTPS_ERRORS="$STAGE_EQ_PLAYWRIGHT_IGNORE_HTTPS_ERRORS" \
  NAV_ADMIN_EMAIL="$NAV_ADMIN_EMAIL" \
  NAV_ADMIN_PASSWORD="$NAV_ADMIN_PASSWORD" \
  NAV_WEB_ALLOW_NONLOCAL_MUTATION_HOSTS="$STAGE_EQ_ALLOW_NONLOCAL_MUTATION_HOSTS" \
  bash "$STAGE_EQ_REPO_ROOT/tools/flutter/run_web_navigation_smoke.sh" mutation

  echo "INFO: stage-equivalent local validation completed successfully."
}

main "$@"
