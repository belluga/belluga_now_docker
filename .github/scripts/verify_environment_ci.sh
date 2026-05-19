#!/usr/bin/env bash
set -euo pipefail

required_files=(
  ".gitmodules"
  "docker-compose.yml"
  ".github/scripts/check_promotion_lane.sh"
  ".github/scripts/check_submodule_branch_alignment.sh"
  ".github/scripts/check_web_flutter_metadata.sh"
  ".github/scripts/manage_navigation_host_overrides.sh"
  ".github/scripts/rollback_remote.sh"
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

for script in .github/scripts/deploy_stage_over_ssh.sh .github/scripts/rollback_remote.sh; do
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

if ! grep -Fq '.github/scripts/rollback_remote.sh' .github/scripts/rollback_over_ssh.sh; then
  echo "ERROR: rollback_over_ssh.sh must ship and execute .github/scripts/rollback_remote.sh instead of embedding the remote body inline." >&2
  exit 1
fi

if grep -Fq '<<EOF_REMOTE' .github/scripts/rollback_over_ssh.sh; then
  echo "ERROR: rollback_over_ssh.sh must not embed the remote rollback body via inline EOF_REMOTE heredoc." >&2
  exit 1
fi

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
  "DEPLOY_RUNTIME_MUTATED="
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

if ! grep -Fq 'echo "runtime_mutated=${runtime_mutated_output}"' .github/scripts/deploy_stage_over_ssh.sh; then
  echo "ERROR: deploy_stage_over_ssh.sh must export runtime_mutated to GITHUB_OUTPUT for workflow rollback classification." >&2
  exit 1
fi

required_live_marker_emissions=(
  'DEPLOY_RUNTIME_MUTATED=1'
  'internal_rollback_status="attempting"'
  'emit_remote_deploy_state_markers'
)

for marker in "${required_live_marker_emissions[@]}"; do
  if ! grep -Fq "${marker}" .github/scripts/deploy_stage_over_ssh.sh; then
    echo "ERROR: deploy_stage_over_ssh.sh must persist live deploy-state evidence for marker '${marker}'." >&2
    exit 1
  fi
done

if ! grep -Fq 'ConnectTimeout=5 -o ConnectionAttempts=1' .github/workflows/orchestration-ci-cd.yml; then
  echo "ERROR: orchestration-ci-cd.yml must bound direct SSH capture steps with connect timeouts." >&2
  exit 1
fi

if ! grep -Fq 'ServerAliveInterval=15 -o ServerAliveCountMax=4 -o TCPKeepAlive=yes' .github/workflows/orchestration-ci-cd.yml; then
  echo "ERROR: orchestration-ci-cd.yml must add SSH keepalive options to direct remote capture steps." >&2
  exit 1
fi

if ! grep -Fq 'ConnectTimeout=5 -o ConnectionAttempts=1' .github/scripts/collect_remote_deploy_diagnostics.sh; then
  echo "ERROR: collect_remote_deploy_diagnostics.sh must bound SSH diagnostics with connect timeouts." >&2
  exit 1
fi

if ! grep -Fq 'ServerAliveInterval=15 -o ServerAliveCountMax=4 -o TCPKeepAlive=yes' .github/scripts/collect_remote_deploy_diagnostics.sh; then
  echo "ERROR: collect_remote_deploy_diagnostics.sh must add SSH keepalive options for long remote diagnostics." >&2
  exit 1
fi

required_remote_transport_markers=(
  'ConnectTimeout=5'
  'ConnectionAttempts=3'
  'ServerAliveInterval=15'
  'ServerAliveCountMax=40'
  'TCPKeepAlive=yes'
)

for script in .github/scripts/deploy_stage_over_ssh.sh .github/scripts/rollback_over_ssh.sh; do
  for marker in "${required_remote_transport_markers[@]}"; do
    if ! grep -Fq "${marker}" "${script}"; then
      echo "ERROR: ${script} must carry the full remote SSH transport hardening marker '${marker}'." >&2
      exit 1
    fi
  done
done

required_compose_build_markers=(
  'run_compose_build()'
  'COMPOSE_BAKE=false'
  'DOCKER_BUILDKIT=1'
  'BUILDKIT_PROGRESS=plain'
)

for marker in "${required_compose_build_markers[@]}"; do
  if ! grep -Fq "${marker}" .github/scripts/deploy_stage_over_ssh.sh; then
    echo "ERROR: deploy_stage_over_ssh.sh must preserve long-build progress marker '${marker}'." >&2
    exit 1
  fi
  if ! grep -Fq "${marker}" .github/scripts/rollback_remote.sh; then
    echo "ERROR: rollback_remote.sh must preserve long-build progress marker '${marker}'." >&2
    exit 1
  fi
done

if ! grep -Fq 'copy_remote_script()' .github/scripts/rollback_over_ssh.sh; then
  echo "ERROR: rollback_over_ssh.sh must wrap remote script transfer in a retry helper before remote execution." >&2
  exit 1
fi

if rg -n 'uses:\\s+actions/checkout@v4\\b' .github/workflows >/dev/null 2>&1; then
  echo "ERROR: workflows still reference deprecated actions/checkout@v4 runtime." >&2
  exit 1
fi

if rg -n 'uses:\\s+actions/setup-node@v4\\b' .github/workflows >/dev/null 2>&1; then
  echo "ERROR: workflows still reference deprecated actions/setup-node@v4 runtime." >&2
  exit 1
fi

if rg -n 'uses:\\s+actions/upload-artifact@v4\\b' .github/workflows >/dev/null 2>&1; then
  echo "ERROR: workflows still reference deprecated actions/upload-artifact@v4 runtime." >&2
  exit 1
fi

if rg -n "node-version:\\s*'20'\\b" .github/workflows >/dev/null 2>&1; then
  echo "ERROR: workflows still pin Node 20 for CI browser/navigation execution." >&2
  exit 1
fi

if ! grep -Fq 'EXPECTED_FLUTTER_SHA' .github/scripts/check_deployed_web_provenance.sh; then
  echo "ERROR: check_deployed_web_provenance.sh must support EXPECTED_FLUTTER_SHA override for rollback proof." >&2
  exit 1
fi

required_navigation_timeout_markers=(
  'run_with_timeout'
  'timeout --foreground'
  'NAV_WEB_LIST_TIMEOUT_SECONDS'
  'NAV_WEB_SUITE_TIMEOUT_SECONDS'
  'web navigation smoke (${SUITE})'
)

for marker in "${required_navigation_timeout_markers[@]}"; do
  if ! grep -Fq "${marker}" tools/flutter/run_web_navigation_smoke.sh; then
    echo "ERROR: run_web_navigation_smoke.sh missing deterministic timeout marker '${marker}'." >&2
    exit 1
  fi
done

required_navigation_timeout_steps=(
  'id: stage_navigation_smoke'
  'id: stage_navigation_mutation_smoke'
  'id: stage_rollback_navigation_smoke'
  'id: stage_rollback_navigation_mutation_smoke'
  'id: production_navigation_smoke'
  'id: main_rollback_navigation_smoke'
)

for marker in "${required_navigation_timeout_steps[@]}"; do
  if ! awk -v marker="${marker}" '
    index($0, marker) { in_block=1; next }
    in_block && /^      - name:/ { exit found ? 0 : 1 }
    in_block && /timeout-minutes:/ { found=1 }
    END { exit found ? 0 : 1 }
  ' .github/workflows/orchestration-ci-cd.yml; then
    echo "ERROR: orchestration-ci-cd.yml block '${marker}' must declare timeout-minutes as a smoke-suite backstop." >&2
    exit 1
  fi
done

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

required_runtime_mutation_workflow_markers=(
  "steps.stage_deploy_remote.outputs.runtime_mutated"
  "steps.main_deploy_remote.outputs.runtime_mutated"
)

for marker in "${required_runtime_mutation_workflow_markers[@]}"; do
  if ! grep -Fq "${marker}" .github/workflows/orchestration-ci-cd.yml; then
    echo "ERROR: orchestration-ci-cd.yml missing runtime mutation recovery marker '${marker}'." >&2
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

if grep -R -Fq "service may remain degraded" .github/workflows/orchestration-ci-cd.yml .github/scripts/deploy_stage_over_ssh.sh .github/scripts/rollback_over_ssh.sh .github/scripts/rollback_remote.sh; then
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

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node is required to run lightweight navigation harness policy regressions." >&2
  exit 1
fi

node --test tools/flutter/web_app_tests/navigation_harness_policy_test.cjs >/dev/null

echo "OK: CI environment invariants validated."
