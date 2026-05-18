#!/usr/bin/env bash
set -euo pipefail

required_files=(
  ".gitmodules"
  "docker-compose.yml"
  ".github/scripts/check_promotion_lane.sh"
  ".github/scripts/check_submodule_branch_alignment.sh"
  ".github/scripts/check_web_flutter_metadata.sh"
  ".github/scripts/manage_navigation_host_overrides.sh"
)

for file in "${required_files[@]}"; do
  if [[ ! -f "$file" ]]; then
    echo "ERROR: required file missing: $file" >&2
    exit 1
  fi
done

required_cache_env_markers=(
  "normalize_laravel_cache_env_for_mongo"
  "require_laravel_mongodb_cache_env"
  "CACHE_STORE"
  "CACHE_LIMITER"
  "APP_MAINTENANCE_STORE"
)

for script in .github/scripts/deploy_stage_over_ssh.sh .github/scripts/rollback_over_ssh.sh; do
  for marker in "${required_cache_env_markers[@]}"; do
    if ! grep -Fq "${marker}" "${script}"; then
      echo "ERROR: ${script} missing MongoDB cache env guard marker '${marker}'." >&2
      exit 1
    fi
  done

  for callable_marker in normalize_laravel_cache_env_for_mongo require_laravel_mongodb_cache_env; do
    marker_count="$(grep -Fc "${callable_marker}" "${script}")"
    if (( marker_count < 2 )); then
      echo "ERROR: ${script} must define and call '${callable_marker}'." >&2
      exit 1
    fi
  done
done

required_release_tuple_markers=(
  "ROOT_SHA="
  "WEB_APP_RUNTIME_SHA="
  "DEPLOY_LANE="
  "RECORDED_AT="
)

for marker in "${required_release_tuple_markers[@]}"; do
  if ! grep -Fq "${marker}" .github/scripts/mark_successful_revision_over_ssh.sh; then
    echo "ERROR: mark_successful_revision_over_ssh.sh missing release tuple marker '${marker}'." >&2
    exit 1
  fi
done

required_internal_rollback_markers=(
  "INTERNAL_ROLLBACK_STATUS="
  "INTERNAL_ROLLBACK_TARGET_REVISION="
  "INTERNAL_ROLLBACK_TARGET_WEB_APP_RUNTIME_SHA="
)

for marker in "${required_internal_rollback_markers[@]}"; do
  if ! grep -Fq "${marker}" .github/scripts/deploy_stage_over_ssh.sh; then
    echo "ERROR: deploy_stage_over_ssh.sh missing internal rollback marker '${marker}'." >&2
    exit 1
  fi
done

if ! grep -Fq 'EXPECTED_FLUTTER_SHA' .github/scripts/check_deployed_web_provenance.sh; then
  echo "ERROR: check_deployed_web_provenance.sh must support EXPECTED_FLUTTER_SHA override for rollback proof." >&2
  exit 1
fi

required_workflow_markers=(
  "id: stage_rollback_proof_plan"
  "id: stage_rollback_provenance_check"
  "id: main_rollback_proof_plan"
  "id: main_rollback_provenance_check"
  "id: stage_public_taxonomy_validation_fixture"
  "id: stage_origin_host_overrides"
  "id: stage_rollback_origin_host_overrides"
  "id: main_origin_host_overrides"
  "id: main_rollback_origin_host_overrides"
)

for marker in "${required_workflow_markers[@]}"; do
  if ! grep -Fq "${marker}" .github/workflows/orchestration-ci-cd.yml; then
    echo "ERROR: orchestration-ci-cd.yml missing rollback-proof workflow marker '${marker}'." >&2
    exit 1
  fi
done

fixture_gate_usage_count="$(grep -Fc 'steps.stage_public_taxonomy_validation_fixture.outcome' .github/workflows/orchestration-ci-cd.yml)"
if (( fixture_gate_usage_count < 5 )); then
  echo "ERROR: orchestration-ci-cd.yml must wire stage_public_taxonomy_validation_fixture into stage gating/rollback conditions." >&2
  exit 1
fi

if grep -Fq 'tee -a /etc/hosts' .github/workflows/orchestration-ci-cd.yml; then
  echo "ERROR: orchestration-ci-cd.yml must not mutate /etc/hosts inline; use manage_navigation_host_overrides.sh." >&2
  exit 1
fi

if grep -R -Fq "service may remain degraded" .github/workflows/orchestration-ci-cd.yml .github/scripts/deploy_stage_over_ssh.sh .github/scripts/rollback_over_ssh.sh; then
  echo "ERROR: degraded-state wording still uses 'service may remain degraded'; require explicit incident/degraded contract wording." >&2
  exit 1
fi

worker_block="$(awk '
  /^  worker:/ { in_worker=1; print; next }
  in_worker && /^  [a-zA-Z0-9_-]+:/ { exit }
  in_worker { print }
' docker-compose.yml)"

if [[ -z "$worker_block" ]]; then
  echo "ERROR: docker-compose.yml missing worker service block" >&2
  exit 1
fi

if ! grep -Fq 'command: ["sh", "/var/www/scripts/run_queue_worker.sh"]' <<<"$worker_block"; then
  echo "ERROR: worker service must use /var/www/scripts/run_queue_worker.sh so OTP jobs on queue 'otp' are consumed." >&2
  exit 1
fi

required_submodules=(flutter-app laravel-app web-app)

for submodule in "${required_submodules[@]}"; do
  if ! grep -Eq "path[[:space:]]*=[[:space:]]*$submodule" .gitmodules; then
    echo "ERROR: .gitmodules missing required submodule path '$submodule'" >&2
    exit 1
  fi

  if [[ ! -d "$submodule" ]]; then
    echo "ERROR: expected checkout directory for submodule '$submodule' not found" >&2
    exit 1
  fi
done

echo "OK: CI environment invariants validated."
