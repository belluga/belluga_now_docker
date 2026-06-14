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

  local repo_root
  repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
  cd "$repo_root"

  local nav_test_run_id
  nav_test_run_id="${NAV_TEST_RUN_ID:-stage-local-$(date +%Y%m%d%H%M%S)-$$}"
  local node_path
  node_path="${NODE_PATH:-$repo_root/tools/flutter/web_app_smoke_runner/node_modules}"
  local allow_nonlocal_mutation_hosts
  allow_nonlocal_mutation_hosts="${NAV_WEB_ALLOW_NONLOCAL_MUTATION_HOSTS:-1}"

  local targets_output
  local host_override_output
  targets_output="$(mktemp)"
  host_override_output="$(mktemp)"
  local fixture_prepared=0
  local host_override_applied=0
  local managed_playwright_ignore_https_errors="${PLAYWRIGHT_IGNORE_HTTPS_ERRORS:-false}"

  cleanup() {
    local exit_code=$?

    if [[ "$fixture_prepared" -eq 1 ]]; then
      (
        cd "$repo_root/tools/flutter/web_app_smoke_runner"
        NODE_PATH="$node_path" \
        NAV_DEPLOY_LANE=stage \
        NAV_PUBLIC_TAXONOMY_FIXTURE_ACTION=cleanup \
        NAV_TEST_RUN_ID="$nav_test_run_id" \
        NAV_TENANT_URL="$NAV_TENANT_URL" \
        NAV_ADMIN_EMAIL="$NAV_ADMIN_EMAIL" \
        NAV_ADMIN_PASSWORD="$NAV_ADMIN_PASSWORD" \
        NAV_WEB_ALLOW_NONLOCAL_MUTATION_HOSTS="$allow_nonlocal_mutation_hosts" \
        node ../web_app_tests/ensure_public_taxonomy_validation_fixture.cjs
      ) || true
    fi

    if [[ "$host_override_applied" -eq 1 ]]; then
      bash "$repo_root/.github/scripts/manage_navigation_host_overrides.sh" reset || true
    fi

    rm -f "$targets_output" "$host_override_output"
    exit "$exit_code"
  }
  trap cleanup EXIT

  echo "INFO: running root workflow invariants before stage-equivalent smoke."
  bash "$repo_root/.github/scripts/verify_environment_ci.sh"

  echo "INFO: resolving explicit stage navigation targets."
  GITHUB_OUTPUT="$targets_output" \
  NAV_TENANT_URL_INPUT="$NAV_TENANT_URL_INPUT" \
  NAV_LANDLORD_URL_INPUT="${NAV_LANDLORD_URL_INPUT:-}" \
  bash "$repo_root/.github/scripts/resolve_lane_navigation_targets.sh" stage
  load_github_output_file "$targets_output"

  export NAV_DEPLOY_LANE=stage
  export NAV_TEST_RUN_ID="$nav_test_run_id"
  export NAV_LANDLORD_URL="$landlord_url"
  export NAV_TENANT_URL="$tenant_url"

  echo "INFO: probing published stage public edge."
  bash "$repo_root/.github/scripts/probe_public_navigation_environment_over_https.sh" stage

  echo "INFO: validating deployed stage provenance."
  DEPLOY_LANE=stage \
  NAV_LANDLORD_URL="$NAV_LANDLORD_URL" \
  NAV_ORIGIN_IP="${NAV_ORIGIN_IP:-}" \
  bash "$repo_root/.github/scripts/check_deployed_web_provenance.sh" stage

  if [[ -n "${NAV_ORIGIN_IP:-}" ]]; then
    echo "INFO: applying temporary navigation host overrides for origin-targeted smoke."
    GITHUB_OUTPUT="$host_override_output" \
    NAV_LANDLORD_URL="$NAV_LANDLORD_URL" \
    NAV_TENANT_URL="$NAV_TENANT_URL" \
    NAV_ORIGIN_IP="$NAV_ORIGIN_IP" \
    bash "$repo_root/.github/scripts/manage_navigation_host_overrides.sh" apply
    load_github_output_file "$host_override_output"
    managed_playwright_ignore_https_errors="${playwright_ignore_https_errors:-$managed_playwright_ignore_https_errors}"
    host_override_applied=1
  fi

  echo "INFO: ensuring managed public taxonomy validation fixture."
  (
    cd "$repo_root/tools/flutter/web_app_smoke_runner"
    NODE_PATH="$node_path" \
    NAV_DEPLOY_LANE=stage \
    NAV_TEST_RUN_ID="$nav_test_run_id" \
    NAV_TENANT_URL="$NAV_TENANT_URL" \
    NAV_ADMIN_EMAIL="$NAV_ADMIN_EMAIL" \
    NAV_ADMIN_PASSWORD="$NAV_ADMIN_PASSWORD" \
    NAV_WEB_ALLOW_NONLOCAL_MUTATION_HOSTS="$allow_nonlocal_mutation_hosts" \
    node ../web_app_tests/ensure_public_taxonomy_validation_fixture.cjs
  )
  fixture_prepared=1

  echo "INFO: running stage readonly navigation smoke."
  NAV_DEPLOY_LANE=stage \
  NAV_TEST_RUN_ID="$nav_test_run_id" \
  NAV_PUBLIC_TAXONOMY_MANAGED_FIXTURE=1 \
  NAV_WEB_TEST_TYPE=readonly \
  NAV_LANDLORD_URL="$NAV_LANDLORD_URL" \
  NAV_TENANT_URL="$NAV_TENANT_URL" \
  PLAYWRIGHT_IGNORE_HTTPS_ERRORS="$managed_playwright_ignore_https_errors" \
  bash "$repo_root/tools/flutter/run_web_navigation_smoke.sh" readonly

  echo "INFO: running stage mutation navigation smoke."
  NAV_DEPLOY_LANE=stage \
  NAV_TEST_RUN_ID="$nav_test_run_id" \
  NAV_WEB_TEST_TYPE=mutation \
  NAV_LANDLORD_URL="$NAV_LANDLORD_URL" \
  NAV_TENANT_URL="$NAV_TENANT_URL" \
  PLAYWRIGHT_IGNORE_HTTPS_ERRORS="$managed_playwright_ignore_https_errors" \
  NAV_ADMIN_EMAIL="$NAV_ADMIN_EMAIL" \
  NAV_ADMIN_PASSWORD="$NAV_ADMIN_PASSWORD" \
  NAV_WEB_ALLOW_NONLOCAL_MUTATION_HOSTS="$allow_nonlocal_mutation_hosts" \
  bash "$repo_root/tools/flutter/run_web_navigation_smoke.sh" mutation

  echo "INFO: stage-equivalent local validation completed successfully."
}

main "$@"
