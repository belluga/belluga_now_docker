#!/usr/bin/env bash
set -euo pipefail

temp_artifact_dirs=()

cleanup_temp_artifact_dirs() {
  if ((${#temp_artifact_dirs[@]} == 0)); then
    return
  fi

  rm -rf "${temp_artifact_dirs[@]}"
}

trap cleanup_temp_artifact_dirs EXIT

materialize_submodule_path_from_gitlink() {
  local submodule_path="$1"
  local relative_path="$2"
  local gitlink_sha=""
  local scratch_dir=""

  gitlink_sha="$(git rev-parse "HEAD:${submodule_path}" 2>/dev/null | tr -d '[:space:]' || true)"
  if [[ -z "$gitlink_sha" ]]; then
    echo "ERROR: could not resolve gitlink SHA for submodule '${submodule_path}' from HEAD." >&2
    exit 1
  fi

  if ! git -C "${submodule_path}" cat-file -e "${gitlink_sha}^{commit}" 2>/dev/null; then
    echo "ERROR: submodule '${submodule_path}' is missing gitlink commit ${gitlink_sha} locally; fetch the candidate commit before running verify_environment_ci.sh." >&2
    exit 1
  fi

  scratch_dir="$(mktemp -d)"
  temp_artifact_dirs+=("${scratch_dir}")

  if ! git -C "${submodule_path}" archive "${gitlink_sha}" "${relative_path}" | tar -x -C "${scratch_dir}"; then
    echo "ERROR: failed to materialize '${relative_path}' from submodule '${submodule_path}' at ${gitlink_sha}." >&2
    exit 1
  fi

  printf '%s\n' "${scratch_dir}/${relative_path}"
}

have_rg_binary() {
  [[ "${VERIFY_ENV_FORCE_GREP_FALLBACK:-0}" != "1" ]] && type -P rg >/dev/null 2>&1
}

regex_search_paths() {
  local pattern="$1"
  shift
  local existing_paths=()
  local candidate=""

  for candidate in "$@"; do
    if [[ -e "${candidate}" ]]; then
      existing_paths+=("${candidate}")
    fi
  done

  if ((${#existing_paths[@]} == 0)); then
    return 1
  fi

  if have_rg_binary; then
    rg -nP -- "${pattern}" "${existing_paths[@]}"
    return
  fi

  grep -R -nP --binary-files=without-match -- "${pattern}" "${existing_paths[@]}"
}

regex_search_stream() {
  local pattern="$1"

  if have_rg_binary; then
    rg -nP -- "${pattern}"
    return
  fi

  grep -nP -- "${pattern}"
}

submodule_gitlink_requires_workflow_audit() {
  local submodule_path="$1"
  local base_ref=""

  if [[ "${GITHUB_EVENT_NAME:-}" != "pull_request" ]]; then
    return 0
  fi

  base_ref="${GITHUB_BASE_REF:-}"
  if [[ -z "${base_ref}" ]]; then
    return 0
  fi

  git fetch --no-tags --prune --depth=1 origin "${base_ref}" >/dev/null 2>&1 || true

  if git diff --quiet --ignore-submodules=none "origin/${base_ref}...HEAD" -- "${submodule_path}"; then
    printf 'INFO: skipping workflow runtime audit for unchanged gitlink %s against origin/%s.\n' "${submodule_path}" "${base_ref}"
    return 1
  fi

  return 0
}

required_files=(
  ".gitmodules"
  "docker-compose.yml"
  ".github/scripts/check_promotion_lane.sh"
  ".github/scripts/check_submodule_branch_alignment.sh"
  ".github/scripts/check_web_flutter_metadata.sh"
  ".github/scripts/manage_navigation_host_overrides.sh"
  ".github/scripts/prove_web_metadata_main_contract.sh"
  ".github/scripts/prove_rollback_queue_parity.sh"
  ".github/scripts/capture_successful_release_tuple_over_ssh.sh"
  ".github/scripts/publish_runtime_images_to_ghcr.sh"
  ".github/scripts/resolve_web_app_runtime_sha.sh"
  ".github/scripts/rollback_remote.sh"
)

for file in "${required_files[@]}"; do
  if [[ ! -f "$file" ]]; then
    echo "ERROR: required file missing: $file" >&2
    exit 1
  fi
done

if grep -Fq '${{ secrets.STAGE_NAV_ADMIN_EMAIL }}' .github/workflows/orchestration-ci-cd.yml; then
  echo "ERROR: STAGE_NAV_ADMIN_EMAIL is non-sensitive test identity metadata and must be sourced from vars, not secrets." >&2
  exit 1
fi

if ! grep -Fq 'STAGE_SSH_KNOWN_HOSTS: ${{ secrets.STAGE_SSH_KNOWN_HOSTS }}' .github/workflows/orchestration-ci-cd.yml; then
  echo "ERROR: orchestration workflow must source STAGE_SSH_KNOWN_HOSTS from secrets.STAGE_SSH_KNOWN_HOSTS." >&2
  exit 1
fi

if ! grep -Fq 'MAIN_SSH_KNOWN_HOSTS: ${{ secrets.MAIN_SSH_KNOWN_HOSTS }}' .github/workflows/orchestration-ci-cd.yml; then
  echo "ERROR: orchestration workflow must source MAIN_SSH_KNOWN_HOSTS from secrets.MAIN_SSH_KNOWN_HOSTS." >&2
  exit 1
fi

if ! grep -Fq 'NAV_ADMIN_EMAIL: ${{ vars.STAGE_NAV_ADMIN_EMAIL }}' .github/workflows/orchestration-ci-cd.yml; then
  echo "ERROR: stage navigation workflow must source NAV_ADMIN_EMAIL from vars.STAGE_NAV_ADMIN_EMAIL." >&2
  exit 1
fi

if ! grep -Fq 'NAV_ADMIN_PASSWORD: ${{ secrets.STAGE_NAV_ADMIN_PASSWORD }}' .github/workflows/orchestration-ci-cd.yml; then
  echo "ERROR: stage navigation workflow must keep NAV_ADMIN_PASSWORD sourced from secrets.STAGE_NAV_ADMIN_PASSWORD." >&2
  exit 1
fi

if ! grep -Fq 'packages: write' .github/workflows/orchestration-ci-cd.yml; then
  echo "ERROR: orchestration workflow must grant packages: write for GHCR immutable runtime image publishing." >&2
  exit 1
fi

if ! grep -Fq 'run: bash .github/scripts/resolve_web_app_runtime_sha.sh' .github/workflows/orchestration-ci-cd.yml; then
  echo "ERROR: protected deploy jobs must resolve WEB_APP_RUNTIME_SHA from WEB_APP_REPO + lane before remote mutation." >&2
  exit 1
fi

if ! grep -Fq 'run: bash .github/scripts/publish_runtime_images_to_ghcr.sh' .github/workflows/orchestration-ci-cd.yml; then
  echo "ERROR: protected deploy jobs must publish immutable runtime images to GHCR before remote mutation." >&2
  exit 1
fi

if ! grep -Fq 'WEB_APP_REPO: ${{ vars.WEB_APP_REPO }}' .github/workflows/orchestration-ci-cd.yml; then
  echo "ERROR: protected web runtime resolution must use vars.WEB_APP_REPO." >&2
  exit 1
fi

if ! grep -Fq 'normalize_repo_slug "${WEB_APP_REPO:-}"' .github/scripts/check_web_flutter_metadata.sh; then
  echo "ERROR: check_web_flutter_metadata.sh must require WEB_APP_REPO as the protected web runtime metadata authority." >&2
  exit 1
fi

if ! grep -Fq 'WEB_SHA="$(resolve_lane_web_sha "$web_repo_slug" "$TARGET_BRANCH"' .github/scripts/check_web_flutter_metadata.sh; then
  echo "ERROR: check_web_flutter_metadata.sh must resolve WEB_SHA from WEB_APP_REPO + lane before validating web runtime metadata." >&2
  exit 1
fi

if grep -Fq 'git ls-tree HEAD web-app' .github/scripts/check_web_flutter_metadata.sh; then
  echo "ERROR: check_web_flutter_metadata.sh must not use the root web-app gitlink as protected web runtime authority." >&2
  exit 1
fi

if grep -Fq 'WEB_SUBMODULE_GIT_DIR' .github/scripts/check_web_flutter_metadata.sh; then
  echo "ERROR: check_web_flutter_metadata.sh must not read protected web runtime artifacts from the local web-app submodule object database." >&2
  exit 1
fi

if ! grep -Fq 'FLUTTER_SUBMODULE_GIT_DIR="$(git rev-parse --git-common-dir)/modules/flutter-app"' .github/scripts/check_web_flutter_metadata.sh; then
  echo "ERROR: check_web_flutter_metadata.sh must resolve pinned flutter-app artifacts from the shared submodule object database, not from an incidental worktree state." >&2
  exit 1
fi

if ! grep -Fq 'get_pinned_submodule_file_content "$FLUTTER_SUBMODULE_GIT_DIR" "$FLUTTER_SHA" "$FLUTTER_LANE_DEFINES_PATH"' .github/scripts/check_web_flutter_metadata.sh; then
  echo "ERROR: check_web_flutter_metadata.sh must validate lane defines from the pinned flutter-app gitlink content before consulting any remote fallback." >&2
  exit 1
fi

if ! grep -Fq 'get_remote_file_content "$web_repo_slug" "build_metadata.json" "$WEB_SHA"' .github/scripts/check_web_flutter_metadata.sh; then
  echo "ERROR: check_web_flutter_metadata.sh must load build_metadata.json from the lane-resolved web runtime SHA." >&2
  exit 1
fi

if ! grep -Fq 'get_remote_file_content "$web_repo_slug" "index.html" "$WEB_SHA"' .github/scripts/check_web_flutter_metadata.sh; then
  echo "ERROR: check_web_flutter_metadata.sh must load index.html from the lane-resolved web runtime SHA." >&2
  exit 1
fi

if ! grep -Fq 'get_remote_file_content "$flutter_repo_slug" "$FLUTTER_LANE_DEFINES_PATH" "$FLUTTER_SHA"' .github/scripts/check_web_flutter_metadata.sh; then
  echo "ERROR: check_web_flutter_metadata.sh must fall back to the pinned flutter-app gitlink SHA when loading remote lane defines." >&2
  exit 1
fi

if ! grep -Fq 'FROM php:8.4.10-fpm AS runtime-deps' docker/laravel-app/Dockerfile; then
  echo "ERROR: docker/laravel-app/Dockerfile must expose a runtime-deps stage for deterministic promotion preflight builds." >&2
  exit 1
fi

if ! grep -Fq 'FROM runtime-deps AS builder' docker/laravel-app/Dockerfile; then
  echo "ERROR: docker/laravel-app/Dockerfile must build the runtime image from the pinned runtime-deps stage." >&2
  exit 1
fi

if ! grep -Fq 'libzstd-dev' docker/laravel-app/Dockerfile; then
  echo "ERROR: docker/laravel-app/Dockerfile must install libzstd-dev for pinned mongodb PECL builds." >&2
  exit 1
fi

if ! grep -Fq 'ARG MONGODB_PECL_SHA256=' docker/laravel-app/Dockerfile; then
  echo "ERROR: docker/laravel-app/Dockerfile must pin the mongodb PECL tarball SHA256 for deterministic promotion builds." >&2
  exit 1
fi

if ! grep -Fq 'https://pecl.php.net/get/mongodb-${MONGODB_PECL_VERSION}.tgz' docker/laravel-app/Dockerfile; then
  echo "ERROR: docker/laravel-app/Dockerfile must fetch the pinned mongodb PECL tarball explicitly." >&2
  exit 1
fi

if ! grep -Fq 'sha256sum -c -' docker/laravel-app/Dockerfile; then
  echo "ERROR: docker/laravel-app/Dockerfile must verify the pinned mongodb PECL tarball hash." >&2
  exit 1
fi

if ! grep -Fq "sed -i 's/^#define BSON_HAVE_STRLCPY 1\$/#define BSON_HAVE_STRLCPY 0/'" docker/laravel-app/Dockerfile; then
  echo "ERROR: docker/laravel-app/Dockerfile must patch the bundled libbson strlcpy macro before compiling mongodb." >&2
  exit 1
fi

if ! grep -Fq 'php --ri mongodb >/dev/null' docker/laravel-app/Dockerfile; then
  echo "ERROR: docker/laravel-app/Dockerfile must verify that the compiled mongodb extension loads successfully." >&2
  exit 1
fi

for dockerignore_marker in '**/.env' 'laravel-app/.composer' 'laravel-app/vendor'; do
  if ! grep -Fxq "${dockerignore_marker}" .dockerignore; then
    echo "ERROR: .dockerignore must exclude '${dockerignore_marker}' from promoted runtime image contexts." >&2
    exit 1
  fi
done

for compose_image_ref in \
  'image: ${APP_IMAGE:-belluga-now-app:local}' \
  'image: ${WORKER_IMAGE:-belluga-now-worker:local}' \
  'image: ${SCHEDULER_IMAGE:-belluga-now-scheduler:local}' \
  'image: ${NGINX_IMAGE:-belluga-now-nginx:local}'; do
  if ! grep -Fq "${compose_image_ref}" docker-compose.yml; then
    echo "ERROR: docker-compose.yml must expose runtime image override '${compose_image_ref}'." >&2
    exit 1
  fi
done

if ! grep -Fq -- '--target runtime-deps' .github/scripts/preflight_promotion_runtime_builds.sh; then
  echo "ERROR: preflight_promotion_runtime_builds.sh must build the pinned runtime-deps Docker stage before promotion." >&2
  exit 1
fi

if ! grep -Fq 'belluga-preflight-laravel-runtime:' .github/scripts/preflight_promotion_runtime_builds.sh; then
  echo "ERROR: preflight_promotion_runtime_builds.sh must build the final Laravel runtime image candidate before promotion." >&2
  exit 1
fi

if ! grep -Fq 'docker/nginx/Dockerfile' .github/scripts/preflight_promotion_runtime_builds.sh; then
  echo "ERROR: preflight_promotion_runtime_builds.sh must build the nginx runtime image before promotion." >&2
  exit 1
fi

if ! grep -Fq -- '--pull' .github/scripts/preflight_promotion_runtime_builds.sh; then
  echo "ERROR: preflight_promotion_runtime_builds.sh must refresh base-image drift via docker build --pull." >&2
  exit 1
fi

if ! grep -Fq 'preflight_docker_config="$(mktemp -d)"' .github/scripts/preflight_promotion_runtime_builds.sh; then
  echo "ERROR: preflight_promotion_runtime_builds.sh must isolate Docker credentials via an ephemeral DOCKER_CONFIG." >&2
  exit 1
fi

if ! grep -Fq 'export DOCKER_CONFIG="${preflight_docker_config}"' .github/scripts/preflight_promotion_runtime_builds.sh; then
  echo "ERROR: preflight_promotion_runtime_builds.sh must export the ephemeral DOCKER_CONFIG before public base-image pulls." >&2
  exit 1
fi

if grep -Fq 'get_remote_file_content "$web_repo_slug" "build_metadata.json" "$TARGET_BRANCH"' .github/scripts/check_web_flutter_metadata.sh; then
  echo "ERROR: check_web_flutter_metadata.sh must not load web build metadata through a mutable branch ref; use the lane-resolved WEB_SHA." >&2
  exit 1
fi

if grep -Fq 'get_remote_file_content "$web_repo_slug" "index.html" "$TARGET_BRANCH"' .github/scripts/check_web_flutter_metadata.sh; then
  echo "ERROR: check_web_flutter_metadata.sh must not load web index.html through a mutable branch ref; use the lane-resolved WEB_SHA." >&2
  exit 1
fi

if ! grep -Fq "main acceptance uses flutter_git_sha and host compatibility" .github/scripts/check_web_flutter_metadata.sh; then
  echo "ERROR: check_web_flutter_metadata.sh must keep source_branch diagnostic-only for main while hard-gating flutter_git_sha and host compatibility." >&2
  exit 1
fi

if ! grep -Fq "main acceptance uses flutter_git_sha and host compatibility" .github/scripts/check_deployed_web_provenance.sh; then
  echo "ERROR: check_deployed_web_provenance.sh must keep source_branch diagnostic-only for main while hard-gating deployed flutter_git_sha and host compatibility." >&2
  exit 1
fi

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

if ! grep -Fq 'require_protected_health_host()' .github/scripts/deploy_stage_over_ssh.sh; then
  echo "ERROR: deploy_stage_over_ssh.sh must define require_protected_health_host() for the protected CI path." >&2
  exit 1
fi

if ! grep -Fq 'require_protected_health_host()' .github/scripts/rollback_over_ssh.sh; then
  echo "ERROR: rollback_over_ssh.sh must define require_protected_health_host() for the protected CI path." >&2
  exit 1
fi

if ! grep -Fq 'require_protected_health_host()' .github/scripts/rollback_remote.sh; then
  echo "ERROR: rollback_remote.sh must define require_protected_health_host() for the protected CI path." >&2
  exit 1
fi

if ! grep -Fq 'implicit fallback to APP_URL or localhost is forbidden' .github/scripts/deploy_stage_over_ssh.sh; then
  echo "ERROR: deploy_stage_over_ssh.sh must fail closed with an explicit no-fallback contract message." >&2
  exit 1
fi

if ! grep -Fq 'implicit fallback to APP_URL or localhost is forbidden' .github/scripts/rollback_over_ssh.sh; then
  echo "ERROR: rollback_over_ssh.sh must fail closed with an explicit no-fallback contract message." >&2
  exit 1
fi

if ! grep -Fq 'implicit fallback to APP_URL or localhost is forbidden' .github/scripts/rollback_remote.sh; then
  echo "ERROR: rollback_remote.sh must fail closed with an explicit no-fallback contract message." >&2
  exit 1
fi

if grep -Fq 'source="$(read_laravel_env_value APP_URL)"' .github/scripts/deploy_stage_over_ssh.sh; then
  echo "ERROR: deploy_stage_over_ssh.sh must not derive health host from APP_URL in the protected CI path." >&2
  exit 1
fi

if grep -Fq 'source="$(read_laravel_env_value APP_URL)"' .github/scripts/rollback_remote.sh; then
  echo "ERROR: rollback_remote.sh must not derive health host from APP_URL in the protected CI path." >&2
  exit 1
fi

if grep -Fq 'host="localhost"' .github/scripts/deploy_stage_over_ssh.sh; then
  echo "ERROR: deploy_stage_over_ssh.sh must not fall back to localhost for protected CI health checks." >&2
  exit 1
fi

if grep -Fq 'DEPLOY_HEALTH_HOST_RAW \\' .github/scripts/rollback_remote.sh; then
  echo "ERROR: rollback_remote.sh must not enforce DEPLOY_HEALTH_HOST_RAW through the generic required-env gate; the protected host contract must own that failure." >&2
  exit 1
fi

if ! grep -Fq "invalid health host '\$host' resolved from DEPLOY_HEALTH_HOST" .github/scripts/rollback_remote.sh; then
  echo "ERROR: rollback_remote.sh must reject malformed DEPLOY_HEALTH_HOST values with the explicit protected-path invalid-host message." >&2
  exit 1
fi

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
  "WEB_APP_RUNTIME_AUTHORITY=lane-resolved-sha"
  "RUNTIME_TOPOLOGY_VERSION=web-app-lane-sha-v1"
  "DEPLOY_LANE="
  "APP_IMAGE="
  "APP_IMAGE_DIGEST="
  "WORKER_IMAGE="
  "WORKER_IMAGE_DIGEST="
  "SCHEDULER_IMAGE="
  "SCHEDULER_IMAGE_DIGEST="
  "NGINX_IMAGE="
  "NGINX_IMAGE_DIGEST="
  "IMAGE_AUTHORITY=ghcr-digest-v1"
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
  "DEPLOY_TRUSTED_TUPLE_PRESENT"
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

if ! grep -Fq "trusted_tuple_present='\${trusted_tuple_present:-<empty>}'" .github/scripts/capture_successful_release_tuple_over_ssh.sh; then
  echo "ERROR: capture_successful_release_tuple_over_ssh.sh must reject ambiguous trusted_tuple_present capture output." >&2
  exit 1
fi

if ! grep -Fq "complete_image_tuple_present='\${complete_image_tuple_present:-<empty>}'" .github/scripts/capture_successful_release_tuple_over_ssh.sh; then
  echo "ERROR: capture_successful_release_tuple_over_ssh.sh must reject ambiguous complete_image_tuple_present capture output." >&2
  exit 1
fi

if ! grep -Fq "DEPLOY_LANE='\${DEPLOY_LANE}' bash -s" .github/scripts/capture_successful_release_tuple_over_ssh.sh; then
  echo "ERROR: capture_successful_release_tuple_over_ssh.sh must pass DEPLOY_LANE into remote tuple validation." >&2
  exit 1
fi

if ! grep -Fq 'is_sha()' .github/scripts/capture_successful_release_tuple_over_ssh.sh; then
  echo "ERROR: capture_successful_release_tuple_over_ssh.sh must validate release tuple SHA shape before trusting rollback authority." >&2
  exit 1
fi

if ! grep -Fq 'is_immutable_image()' .github/scripts/capture_successful_release_tuple_over_ssh.sh; then
  echo "ERROR: capture_successful_release_tuple_over_ssh.sh must validate immutable GHCR image refs before trusting rollback authority." >&2
  exit 1
fi

for trusted_capture_marker in \
  'web_authority="$(field WEB_APP_RUNTIME_AUTHORITY)"' \
  'topology_version="$(field RUNTIME_TOPOLOGY_VERSION)"' \
  'deploy_lane="$(field DEPLOY_LANE)"' \
  'image_authority="$(field IMAGE_AUTHORITY)"' \
  '"${web_authority}" == "lane-resolved-sha"' \
  '"${topology_version}" == "web-app-lane-sha-v1"' \
  '"${image_authority}" == "ghcr-digest-v1"' \
  '"${deploy_lane}" == "${DEPLOY_LANE}"' \
  '"${valid_root}" == "true" && "${valid_web}" == "true" && "${valid_authority}" == "true" && "${complete_images}" == "true"'; do
  if ! grep -Fq "${trusted_capture_marker}" .github/scripts/capture_successful_release_tuple_over_ssh.sh; then
    echo "ERROR: capture_successful_release_tuple_over_ssh.sh missing trusted tuple validation marker '${trusted_capture_marker}'." >&2
    exit 1
  fi
done

if ! grep -Fq 'require_env DEPLOY_TRUSTED_TUPLE_PRESENT' .github/scripts/deploy_stage_over_ssh.sh; then
  echo "ERROR: deploy_stage_over_ssh.sh must require pre-captured DEPLOY_TRUSTED_TUPLE_PRESENT before protected deploy." >&2
  exit 1
fi

if ! grep -Fq 'DEPLOY_TRUSTED_TUPLE_PRESENT must be exactly' .github/scripts/deploy_stage_over_ssh.sh; then
  echo "ERROR: deploy_stage_over_ssh.sh must reject ambiguous DEPLOY_TRUSTED_TUPLE_PRESENT values." >&2
  exit 1
fi

if ! grep -Fq 'if [[ "\${DEPLOY_TRUSTED_TUPLE_PRESENT}" == "true" && -f ".last_successful_revision" ]]; then' .github/scripts/deploy_stage_over_ssh.sh; then
  echo "ERROR: deploy_stage_over_ssh.sh must gate internal rollback tuple loading on DEPLOY_TRUSTED_TUPLE_PRESENT == true." >&2
  exit 1
fi

if ! grep -Fq 'internal rollback is disabled for this deploy attempt' .github/scripts/deploy_stage_over_ssh.sh; then
  echo "ERROR: deploy_stage_over_ssh.sh must make no-trusted-tuple internal rollback disablement explicit." >&2
  exit 1
fi

if ! grep -Fq 'DEPLOY_TRUSTED_TUPLE_PRESENT: ${{ steps.stage_rollback_target.outputs.trusted_tuple_present }}' .github/workflows/orchestration-ci-cd.yml; then
  echo "ERROR: stage deploy workflow must pass the captured trusted tuple state into deploy_stage_over_ssh.sh." >&2
  exit 1
fi

if ! grep -Fq 'DEPLOY_TRUSTED_TUPLE_PRESENT: ${{ steps.main_rollback_target.outputs.trusted_tuple_present }}' .github/workflows/orchestration-ci-cd.yml; then
  echo "ERROR: production deploy workflow must pass the captured trusted tuple state into deploy_stage_over_ssh.sh." >&2
  exit 1
fi

for script in .github/scripts/deploy_stage_over_ssh.sh .github/scripts/rollback_remote.sh .github/scripts/mark_successful_revision_over_ssh.sh; do
  if ! grep -Fq 'ghcr.io/*@sha256:*' "${script}"; then
    echo "ERROR: ${script} must require immutable GHCR digest image references." >&2
    exit 1
  fi
  if ! grep -Fq "must not use mutable ':latest' image authority" "${script}"; then
    echo "ERROR: ${script} must reject mutable latest image authority." >&2
    exit 1
  fi
done

if grep -Fq 'docker compose build' .github/scripts/deploy_stage_over_ssh.sh .github/scripts/rollback_remote.sh; then
  echo "ERROR: protected deploy/rollback scripts must not run docker compose build on the target host." >&2
  exit 1
fi

if grep -Fq 'run_compose_build' .github/scripts/deploy_stage_over_ssh.sh .github/scripts/rollback_remote.sh; then
  echo "ERROR: protected deploy/rollback scripts must not retain rollback-time compose build helpers." >&2
  exit 1
fi

if grep -Fq 'git ls-tree "${target_revision}" web-app' .github/workflows/orchestration-ci-cd.yml .github/scripts/rollback_remote.sh; then
  echo "ERROR: protected rollback proof must not fall back to gitlink-derived web-app runtime SHA." >&2
  exit 1
fi

if grep -Fq 'git ls-tree "\${previous_revision}" web-app' .github/scripts/deploy_stage_over_ssh.sh; then
  echo "ERROR: internal rollback must not fall back to gitlink-derived web-app runtime SHA." >&2
  exit 1
fi

if ! grep -Fq 'WEB_APP_RUNTIME_SHA="${WEB_APP_RUNTIME_SHA}"' .github/scripts/deploy_stage_over_ssh.sh && ! grep -Fq 'current_web_runtime_sha="\${WEB_APP_RUNTIME_SHA}"' .github/scripts/deploy_stage_over_ssh.sh; then
  echo "ERROR: deploy_stage_over_ssh.sh must consume the pre-resolved WEB_APP_RUNTIME_SHA instead of root gitlink authority." >&2
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

if ! grep -Fq 'ConnectTimeout=5 -o ConnectionAttempts=1' .github/scripts/capture_successful_release_tuple_over_ssh.sh; then
  echo "ERROR: capture_successful_release_tuple_over_ssh.sh must bound direct SSH capture with connect timeouts." >&2
  exit 1
fi

if ! grep -Fq 'ServerAliveInterval=15 -o ServerAliveCountMax=4 -o TCPKeepAlive=yes' .github/scripts/capture_successful_release_tuple_over_ssh.sh; then
  echo "ERROR: capture_successful_release_tuple_over_ssh.sh must add SSH keepalive options to direct remote capture." >&2
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

if ! grep -Fq 'pull_runtime_images' .github/scripts/deploy_stage_over_ssh.sh; then
  echo "ERROR: deploy_stage_over_ssh.sh must pull immutable runtime images instead of building on the target host." >&2
  exit 1
fi

if ! grep -Fq 'pull_runtime_images' .github/scripts/rollback_remote.sh; then
  echo "ERROR: rollback_remote.sh must pull immutable runtime images instead of building on the target host." >&2
  exit 1
fi

if tail -n +90 .github/scripts/deploy_stage_over_ssh.sh | regex_search_stream '(?<!\\)\$(1|2|@|\*)' >/tmp/deploy_stage_unescaped_positional_refs.txt; then
  echo "ERROR: deploy_stage_over_ssh.sh remote heredoc must not contain unescaped positional parameter references; local shell expansion will break stage deploys under set -u." >&2
  cat /tmp/deploy_stage_unescaped_positional_refs.txt >&2
  rm -f /tmp/deploy_stage_unescaped_positional_refs.txt
  exit 1
fi
rm -f /tmp/deploy_stage_unescaped_positional_refs.txt

if ! grep -Fq 'copy_remote_script()' .github/scripts/rollback_over_ssh.sh; then
  echo "ERROR: rollback_over_ssh.sh must wrap remote script transfer in a retry helper before remote execution." >&2
  exit 1
fi

if regex_search_paths 'uses:\s+actions/checkout@v(4|5)\b' .github/workflows >/dev/null 2>&1; then
  echo "ERROR: workflows still reference a pre-v6 actions/checkout runtime." >&2
  exit 1
fi

if regex_search_paths 'uses:\s+actions/setup-node@v(4|5)\b' .github/workflows >/dev/null 2>&1; then
  echo "ERROR: workflows still reference a pre-v6 actions/setup-node runtime." >&2
  exit 1
fi

if regex_search_paths 'uses:\s+actions/upload-artifact@v(4|5|6)\b' .github/workflows >/dev/null 2>&1; then
  echo "ERROR: workflows still reference a pre-v7 actions/upload-artifact runtime." >&2
  exit 1
fi

submodule_workflow_dirs=()
laravel_workflows_dir=""

if submodule_gitlink_requires_workflow_audit "flutter-app"; then
  submodule_workflow_dirs+=("$(materialize_submodule_path_from_gitlink "flutter-app" ".github/workflows")")
fi

if submodule_gitlink_requires_workflow_audit "laravel-app"; then
  laravel_workflows_dir="$(materialize_submodule_path_from_gitlink "laravel-app" ".github/workflows")"
  submodule_workflow_dirs+=("${laravel_workflows_dir}")
fi

if submodule_gitlink_requires_workflow_audit "web-app"; then
  submodule_workflow_dirs+=("$(materialize_submodule_path_from_gitlink "web-app" ".github/workflows")")
fi

if ((${#submodule_workflow_dirs[@]} > 0)); then
  if regex_search_paths 'uses:\s+actions/checkout@v(4|5)\b' "${submodule_workflow_dirs[@]}" >/dev/null 2>&1; then
    echo "ERROR: submodule workflows still reference a pre-v6 actions/checkout runtime in the HEAD candidate gitlinks." >&2
    exit 1
  fi

  if regex_search_paths 'uses:\s+actions/setup-node@v(4|5)\b' "${submodule_workflow_dirs[@]}" >/dev/null 2>&1; then
    echo "ERROR: submodule workflows still reference a pre-v6 actions/setup-node runtime in the HEAD candidate gitlinks." >&2
    exit 1
  fi

  if regex_search_paths 'uses:\s+actions/upload-artifact@v(4|5|6)\b' "${submodule_workflow_dirs[@]}" >/dev/null 2>&1; then
    echo "ERROR: submodule workflows still reference a pre-v7 actions/upload-artifact runtime in the HEAD candidate gitlinks." >&2
    exit 1
  fi

  if regex_search_paths 'uses:\s+actions/download-artifact@v(4|5|6|7)\b' "${submodule_workflow_dirs[@]}" >/dev/null 2>&1; then
    echo "ERROR: submodule workflows still reference a pre-v8 actions/download-artifact runtime in the HEAD candidate gitlinks." >&2
    exit 1
  fi

  if regex_search_paths 'uses:\s+peter-evans/repository-dispatch@v3\b' "${submodule_workflow_dirs[@]}" >/dev/null 2>&1; then
    echo "ERROR: submodule workflows still reference peter-evans/repository-dispatch@v3, which emits Node 20 deprecation warnings on GitHub-hosted runners." >&2
    exit 1
  fi
fi

if [[ -n "${laravel_workflows_dir}" ]] && regex_search_paths 'uses:\s+actions/cache@v(1|2|3|4)\b' "${laravel_workflows_dir}" >/dev/null 2>&1; then
  echo "ERROR: Laravel submodule workflows still reference a pre-v5 actions/cache runtime in the HEAD candidate gitlinks." >&2
  exit 1
fi

if regex_search_paths "node-version:\s*'20'\b" .github/workflows >/dev/null 2>&1; then
  echo "ERROR: workflows still pin Node 20 for CI browser/navigation execution." >&2
  exit 1
fi

if ((${#submodule_workflow_dirs[@]} > 0)) && regex_search_paths "node-version:\s*'20'\b" "${submodule_workflow_dirs[@]}" >/dev/null 2>&1; then
  echo "ERROR: submodule workflows still pin Node 20 for CI browser/navigation execution in the HEAD candidate gitlinks." >&2
  exit 1
fi

if ! grep -Fq 'EXPECTED_FLUTTER_SHA' .github/scripts/check_deployed_web_provenance.sh; then
  echo "ERROR: check_deployed_web_provenance.sh must support EXPECTED_FLUTTER_SHA override for rollback proof." >&2
  exit 1
fi

if [[ ! -f .github/scripts/check_remote_web_runtime_sha_over_ssh.sh ]]; then
  echo "ERROR: check_remote_web_runtime_sha_over_ssh.sh is required for exact remote web-app runtime validation." >&2
  exit 1
fi

if [[ -e .github/scripts/run_stage_ci_equivalent.sh ]]; then
  echo "ERROR: run_stage_ci_equivalent.sh must not exist. Published-stage proof is a separate surface and the old CI-Equivalent misnomer is hard-blocked." >&2
  exit 1
fi

if [[ -e .github/scripts/run_stage_published_validation.sh ]]; then
  echo "ERROR: run_stage_published_validation.sh must not exist. Published stage/main proof is pipeline-only; local root execution must stay CI Equivalent/reconcile-only." >&2
  exit 1
fi

if grep -Eq '### Published Stage(-Equivalent)? Validation' README.md; then
  echo "ERROR: README must not describe a local published-stage validation workflow. Published stage/main proof is pipeline-only." >&2
  exit 1
fi

if grep -Fq 'run_stage_published_validation.sh' README.md; then
  echo "ERROR: README must not advertise run_stage_published_validation.sh. Published stage/main proof is pipeline-only." >&2
  exit 1
fi

if grep -Fq 'checkout_web_runtime_ref "origin/\${DEPLOY_LANE}"' .github/scripts/deploy_stage_over_ssh.sh; then
  echo "ERROR: deploy_stage_over_ssh.sh must not float web-app runtime content to origin/\${DEPLOY_LANE}." >&2
  exit 1
fi

if ! grep -Fq 'current_web_runtime_sha="\${WEB_APP_RUNTIME_SHA}"' .github/scripts/deploy_stage_over_ssh.sh; then
  echo "ERROR: deploy_stage_over_ssh.sh must use the pre-resolved lane web-app runtime SHA." >&2
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
  "id: stage_rollback_proof_guard"
  "id: stage_rollback_restored_navigation_prep"
  "id: stage_rollback_provenance_check"
  "id: main_rollback_proof_plan"
  "id: main_rollback_proof_guard"
  "id: main_rollback_restored_navigation_prep"
  "id: main_rollback_provenance_check"
  "id: stage_untrusted_bootstrap_block"
  "id: main_untrusted_bootstrap_block"
  "id: stage_public_taxonomy_validation_fixture"
  "id: stage_runtime_web_sha_check"
  "id: stage_rollback_runtime_web_sha_check"
  "id: stage_origin_host_overrides"
  "id: stage_rollback_origin_host_overrides"
  "id: main_runtime_web_sha_check"
  "id: main_rollback_runtime_web_sha_check"
  "id: main_origin_host_overrides"
  "id: main_rollback_origin_host_overrides"
)

for marker in "${required_workflow_markers[@]}"; do
  if ! grep -Fq "${marker}" .github/workflows/orchestration-ci-cd.yml; then
    echo "ERROR: orchestration-ci-cd.yml missing rollback-proof workflow marker '${marker}'." >&2
    exit 1
  fi
done

if [[ ! -x .github/scripts/prepare_navigation_workspace_from_revision.sh ]]; then
  echo "ERROR: prepare_navigation_workspace_from_revision.sh is required for restored-revision rollback proof." >&2
  exit 1
fi

if ! bash -n .github/scripts/prepare_navigation_workspace_from_revision.sh; then
  echo "ERROR: prepare_navigation_workspace_from_revision.sh must remain shell-parseable." >&2
  exit 1
fi

promotion_runtime_preflight_block="$(awk '
  /- name: Validate promotion runtime builds/ { in_block=1 }
  in_block && /^      - name:/ && $0 !~ /Validate promotion runtime builds/ { exit }
  in_block { print }
' .github/workflows/orchestration-ci-cd.yml)"

if [[ -z "${promotion_runtime_preflight_block}" ]]; then
  echo "ERROR: could not locate the promotion runtime preflight build block in orchestration-ci-cd.yml." >&2
  exit 1
fi

if ! grep -Fq ".github/scripts/preflight_promotion_runtime_builds.sh" <<<"${promotion_runtime_preflight_block}"; then
  echo "ERROR: promotion runtime preflight block must execute preflight_promotion_runtime_builds.sh." >&2
  exit 1
fi

if ! grep -Fq "github.base_ref == 'stage' || github.base_ref == 'main'" <<<"${promotion_runtime_preflight_block}"; then
  echo "ERROR: promotion runtime preflight block must run for promotion PRs targeting stage/main." >&2
  exit 1
fi

if ! grep -Fq "github.ref_name == 'stage' || github.ref_name == 'main'" <<<"${promotion_runtime_preflight_block}"; then
  echo "ERROR: promotion runtime preflight block must run for pushes on stage/main." >&2
  exit 1
fi

stage_mark_success_block="$(awk '
  /- name: Mark stage revision as successful after navigation smoke/ { in_block=1 }
  in_block && /^      - name:/ && $0 !~ /Mark stage revision as successful after navigation smoke/ { exit }
  in_block { print }
' .github/workflows/orchestration-ci-cd.yml)"

if [[ -z "${stage_mark_success_block}" ]]; then
  echo "ERROR: could not locate stage success-marking block in orchestration-ci-cd.yml." >&2
  exit 1
fi

mark_success_invocation_count="$(grep -Fc 'run: bash .github/scripts/mark_successful_revision_over_ssh.sh' .github/workflows/orchestration-ci-cd.yml)"
if [[ "${mark_success_invocation_count}" != "2" ]]; then
  echo "ERROR: orchestration-ci-cd.yml must contain exactly two success-marker invocations (stage and production); found ${mark_success_invocation_count}." >&2
  exit 1
fi

if ! grep -Fq "steps.stage_initialize_preflight.outputs.initialized == 'true'" <<<"${stage_mark_success_block}"; then
  echo "ERROR: stage success-marking block must require initialized == true." >&2
  exit 1
fi

stage_mark_success_expected_if="if: steps.stage_initialize_preflight.outputs.initialized == 'true' && (steps.stage_rollback_target.outputs.trusted_tuple_present == 'true' || steps.stage_untrusted_initialized_bootstrap_block.outputs.first_trusted_tuple_bootstrap == 'true') && steps.stage_untrusted_initialized_bootstrap_block.outcome != 'failure' && steps.stage_runtime_web_sha_check.outcome == 'success' && steps.stage_public_edge_environment_probe.outcome == 'success' && steps.stage_provenance_check.outcome == 'success' && steps.stage_public_taxonomy_validation_fixture.outcome == 'success' && steps.stage_navigation_smoke.outcome == 'success' && steps.stage_navigation_mutation_smoke.outcome == 'success' && steps.stage_public_taxonomy_validation_fixture_cleanup.outcome != 'failure'"
stage_mark_success_if_line="$(printf '%s\n' "${stage_mark_success_block}" | sed -n 's/^        if: /if: /p' | head -n 1)"
if [[ "${stage_mark_success_if_line}" != "${stage_mark_success_expected_if}" ]]; then
  echo "ERROR: stage success-marking block must exactly match the allowlisted full-proof success expression." >&2
  exit 1
fi

if ! grep -Fq 'run: bash .github/scripts/mark_successful_revision_over_ssh.sh' <<<"${stage_mark_success_block}"; then
  echo "ERROR: stage success-marking block must be the owner of the stage mark_successful_revision_over_ssh.sh invocation." >&2
  exit 1
fi

if ! grep -Fq "steps.stage_rollback_target.outputs.trusted_tuple_present == 'true' || steps.stage_untrusted_initialized_bootstrap_block.outputs.first_trusted_tuple_bootstrap == 'true'" <<<"${stage_mark_success_block}"; then
  echo "ERROR: stage success-marking block must require either a trusted tuple or the explicit first trusted tuple bootstrap classification before stamping success." >&2
  exit 1
fi

if ! grep -Fq "steps.stage_runtime_web_sha_check.outcome == 'success'" <<<"${stage_mark_success_block}"; then
  echo "ERROR: stage success-marking block must require an exact remote web-app runtime SHA match." >&2
  exit 1
fi

if ! grep -Fq "steps.stage_public_edge_environment_probe.outcome == 'success'" <<<"${stage_mark_success_block}"; then
  echo "ERROR: stage success-marking block must require a successful public-edge probe path." >&2
  exit 1
fi

if ! grep -Fq "steps.stage_provenance_check.outcome == 'success'" <<<"${stage_mark_success_block}"; then
  echo "ERROR: stage success-marking block must require successful provenance proof." >&2
  exit 1
fi

if ! grep -Fq "steps.stage_public_taxonomy_validation_fixture.outcome == 'success'" <<<"${stage_mark_success_block}"; then
  echo "ERROR: stage success-marking block must require a successful public taxonomy validation fixture." >&2
  exit 1
fi

if ! grep -Fq "steps.stage_navigation_smoke.outcome == 'success'" <<<"${stage_mark_success_block}"; then
  echo "ERROR: stage success-marking block must require a successful readonly navigation smoke." >&2
  exit 1
fi

if ! grep -Fq "steps.stage_navigation_mutation_smoke.outcome == 'success'" <<<"${stage_mark_success_block}"; then
  echo "ERROR: stage success-marking block must require a successful mutation navigation smoke." >&2
  exit 1
fi

if ! grep -Fq "steps.stage_public_taxonomy_validation_fixture_cleanup.outcome != 'failure'" <<<"${stage_mark_success_block}"; then
  echo "ERROR: stage success-marking block must require successful or skipped taxonomy fixture cleanup." >&2
  exit 1
fi

stage_initialized_bootstrap_block="$(awk '
  /- name: Classify stage first trusted tuple bootstrap/ { in_block=1 }
  in_block && /^      - name:/ && $0 !~ /Classify stage first trusted tuple bootstrap/ { exit }
  in_block { print }
' .github/workflows/orchestration-ci-cd.yml)"

if [[ -z "${stage_initialized_bootstrap_block}" ]]; then
  echo "ERROR: could not locate initialized stage first trusted tuple bootstrap classification block in orchestration-ci-cd.yml." >&2
  exit 1
fi

if ! grep -Fq "steps.stage_initialize_preflight.outputs.initialized == 'true'" <<<"${stage_initialized_bootstrap_block}"; then
  echo "ERROR: initialized stage bootstrap classification must trigger only on initialized == true." >&2
  exit 1
fi

if ! grep -Fq "steps.stage_rollback_target.outputs.trusted_tuple_present == 'false'" <<<"${stage_initialized_bootstrap_block}"; then
  echo "ERROR: initialized stage bootstrap classification must trigger only on explicit trusted_tuple_present == false." >&2
  exit 1
fi

if ! grep -Fq 'echo "first_trusted_tuple_bootstrap=true" >> "$GITHUB_OUTPUT"' <<<"${stage_initialized_bootstrap_block}"; then
  echo "ERROR: initialized stage bootstrap classification must emit first_trusted_tuple_bootstrap=true." >&2
  exit 1
fi

if grep -Fq 'exit 1' <<<"${stage_initialized_bootstrap_block}"; then
  echo "ERROR: initialized stage bootstrap classification must not fail before the full forward proof contract can run." >&2
  exit 1
fi

if grep -Fq 'continue-on-error: true' <<<"${stage_initialized_bootstrap_block}"; then
  echo "ERROR: initialized stage bootstrap classification must not hide classifier crashes behind continue-on-error." >&2
  exit 1
fi

stage_public_edge_probe_block="$(awk '
  /- name: Probe public stage environment endpoints/ { in_block=1 }
  in_block && /^      - name:/ && $0 !~ /Probe public stage environment endpoints/ { exit }
  in_block { print }
' .github/workflows/orchestration-ci-cd.yml)"

if [[ -z "${stage_public_edge_probe_block}" ]]; then
  echo "ERROR: could not locate stage public-edge probe block in orchestration-ci-cd.yml." >&2
  exit 1
fi

if ! grep -Fq "steps.stage_untrusted_initialized_bootstrap_block.outcome != 'failure'" <<<"${stage_public_edge_probe_block}"; then
  echo "ERROR: stage public-edge probe block must be gated on the initialized bootstrap classification step outcome." >&2
  exit 1
fi

if ! grep -Fq "steps.stage_runtime_web_sha_check.outcome != 'failure'" <<<"${stage_public_edge_probe_block}"; then
  echo "ERROR: stage public-edge probe block must be gated on an exact remote web-app runtime SHA match." >&2
  exit 1
fi

stage_untrusted_bootstrap_block="$(awk '
  /- name: Block stage bootstrap without trusted successful tuple/ { in_block=1 }
  in_block && /^      - name:/ && $0 !~ /Block stage bootstrap without trusted successful tuple/ { exit }
  in_block { print }
' .github/workflows/orchestration-ci-cd.yml)"

if [[ -z "${stage_untrusted_bootstrap_block}" ]]; then
  echo "ERROR: could not locate stage untrusted bootstrap fail-closed block in orchestration-ci-cd.yml." >&2
  exit 1
fi

if ! grep -Fq "steps.stage_rollback_target.outputs.trusted_tuple_present == 'false'" <<<"${stage_untrusted_bootstrap_block}"; then
  echo "ERROR: stage untrusted bootstrap block must trigger only on explicit trusted_tuple_present == false." >&2
  exit 1
fi

main_mark_success_block="$(awk '
  /- name: Mark production revision as successful after navigation smoke/ { in_block=1 }
  in_block && /^      - name:/ && $0 !~ /Mark production revision as successful after navigation smoke/ { exit }
  in_block { print }
' .github/workflows/orchestration-ci-cd.yml)"

if [[ -z "${main_mark_success_block}" ]]; then
  echo "ERROR: could not locate production success-marking block in orchestration-ci-cd.yml." >&2
  exit 1
fi

if ! grep -Fq "steps.main_initialize_preflight.outputs.initialized == 'true'" <<<"${main_mark_success_block}"; then
  echo "ERROR: production success-marking block must require initialized == true." >&2
  exit 1
fi

main_mark_success_expected_if="if: steps.main_initialize_preflight.outputs.initialized == 'true' && (steps.main_rollback_target.outputs.trusted_tuple_present == 'true' || steps.main_untrusted_initialized_bootstrap_block.outputs.first_trusted_tuple_bootstrap == 'true') && steps.main_untrusted_initialized_bootstrap_block.outcome != 'failure' && steps.main_runtime_web_sha_check.outcome == 'success' && steps.main_public_edge_environment_probe.outcome == 'success' && steps.main_provenance_check.outcome == 'success' && steps.main_initial_mutation_guard.outcome == 'success' && steps.production_navigation_smoke.outcome == 'success'"
main_mark_success_if_line="$(printf '%s\n' "${main_mark_success_block}" | sed -n 's/^        if: /if: /p' | head -n 1)"
if [[ "${main_mark_success_if_line}" != "${main_mark_success_expected_if}" ]]; then
  echo "ERROR: production success-marking block must exactly match the allowlisted full-proof success expression." >&2
  exit 1
fi

if ! grep -Fq 'run: bash .github/scripts/mark_successful_revision_over_ssh.sh' <<<"${main_mark_success_block}"; then
  echo "ERROR: production success-marking block must be the owner of the production mark_successful_revision_over_ssh.sh invocation." >&2
  exit 1
fi

if ! grep -Fq "steps.main_rollback_target.outputs.trusted_tuple_present == 'true' || steps.main_untrusted_initialized_bootstrap_block.outputs.first_trusted_tuple_bootstrap == 'true'" <<<"${main_mark_success_block}"; then
  echo "ERROR: production success-marking block must require either a trusted tuple or the explicit first trusted tuple bootstrap classification before stamping success." >&2
  exit 1
fi

if ! grep -Fq "steps.main_runtime_web_sha_check.outcome == 'success'" <<<"${main_mark_success_block}"; then
  echo "ERROR: production success-marking block must require an exact remote web-app runtime SHA match." >&2
  exit 1
fi

if ! grep -Fq "steps.main_public_edge_environment_probe.outcome == 'success'" <<<"${main_mark_success_block}"; then
  echo "ERROR: production success-marking block must require a successful public-edge probe path." >&2
  exit 1
fi

if ! grep -Fq "steps.main_provenance_check.outcome == 'success'" <<<"${main_mark_success_block}"; then
  echo "ERROR: production success-marking block must require successful provenance proof." >&2
  exit 1
fi

if ! grep -Fq "steps.main_initial_mutation_guard.outcome == 'success'" <<<"${main_mark_success_block}"; then
  echo "ERROR: production success-marking block must require the initial main mutation hard-block guard to pass." >&2
  exit 1
fi

if ! grep -Fq "steps.production_navigation_smoke.outcome == 'success'" <<<"${main_mark_success_block}"; then
  echo "ERROR: production success-marking block must require a successful readonly navigation smoke." >&2
  exit 1
fi

main_initialized_bootstrap_block="$(awk '
  /- name: Classify production first trusted tuple bootstrap/ { in_block=1 }
  in_block && /^      - name:/ && $0 !~ /Classify production first trusted tuple bootstrap/ { exit }
  in_block { print }
' .github/workflows/orchestration-ci-cd.yml)"

if [[ -z "${main_initialized_bootstrap_block}" ]]; then
  echo "ERROR: could not locate initialized production first trusted tuple bootstrap classification block in orchestration-ci-cd.yml." >&2
  exit 1
fi

if ! grep -Fq "steps.main_initialize_preflight.outputs.initialized == 'true'" <<<"${main_initialized_bootstrap_block}"; then
  echo "ERROR: initialized production bootstrap classification must trigger only on initialized == true." >&2
  exit 1
fi

if ! grep -Fq "steps.main_rollback_target.outputs.trusted_tuple_present == 'false'" <<<"${main_initialized_bootstrap_block}"; then
  echo "ERROR: initialized production bootstrap classification must trigger only on explicit trusted_tuple_present == false." >&2
  exit 1
fi

if ! grep -Fq 'echo "first_trusted_tuple_bootstrap=true" >> "$GITHUB_OUTPUT"' <<<"${main_initialized_bootstrap_block}"; then
  echo "ERROR: initialized production bootstrap classification must emit first_trusted_tuple_bootstrap=true." >&2
  exit 1
fi

if grep -Fq 'exit 1' <<<"${main_initialized_bootstrap_block}"; then
  echo "ERROR: initialized production bootstrap classification must not fail before the full forward proof contract can run." >&2
  exit 1
fi

if grep -Fq 'continue-on-error: true' <<<"${main_initialized_bootstrap_block}"; then
  echo "ERROR: initialized production bootstrap classification must not hide classifier crashes behind continue-on-error." >&2
  exit 1
fi

main_public_edge_probe_block="$(awk '
  /- name: Probe public production environment endpoints/ { in_block=1 }
  in_block && /^      - name:/ && $0 !~ /Probe public production environment endpoints/ { exit }
  in_block { print }
' .github/workflows/orchestration-ci-cd.yml)"

if [[ -z "${main_public_edge_probe_block}" ]]; then
  echo "ERROR: could not locate production public-edge probe block in orchestration-ci-cd.yml." >&2
  exit 1
fi

if ! grep -Fq "steps.main_untrusted_initialized_bootstrap_block.outcome != 'failure'" <<<"${main_public_edge_probe_block}"; then
  echo "ERROR: production public-edge probe block must be gated on the initialized bootstrap classification step outcome." >&2
  exit 1
fi

if ! grep -Fq "steps.main_runtime_web_sha_check.outcome != 'failure'" <<<"${main_public_edge_probe_block}"; then
  echo "ERROR: production public-edge probe block must be gated on an exact remote web-app runtime SHA match." >&2
  exit 1
fi

main_untrusted_bootstrap_block="$(awk '
  /- name: Block production bootstrap without trusted successful tuple/ { in_block=1 }
  in_block && /^      - name:/ && $0 !~ /Block production bootstrap without trusted successful tuple/ { exit }
  in_block { print }
' .github/workflows/orchestration-ci-cd.yml)"

if [[ -z "${main_untrusted_bootstrap_block}" ]]; then
  echo "ERROR: could not locate production untrusted bootstrap fail-closed block in orchestration-ci-cd.yml." >&2
  exit 1
fi

if ! grep -Fq "steps.main_rollback_target.outputs.trusted_tuple_present == 'false'" <<<"${main_untrusted_bootstrap_block}"; then
  echo "ERROR: production untrusted bootstrap block must trigger only on explicit trusted_tuple_present == false." >&2
  exit 1
fi

main_initial_mutation_guard_block="$(awk '
  /- name: Assert mutation suite is hard-blocked on main/ { in_block=1 }
  in_block && /^      - name:/ && $0 !~ /Assert mutation suite is hard-blocked on main/ { exit }
  in_block { print }
' .github/workflows/orchestration-ci-cd.yml)"

if [[ -z "${main_initial_mutation_guard_block}" ]]; then
  echo "ERROR: could not locate the initial production mutation hard-block guard in orchestration-ci-cd.yml." >&2
  exit 1
fi

if ! grep -Fq "id: main_initial_mutation_guard" <<<"${main_initial_mutation_guard_block}"; then
  echo "ERROR: the initial production mutation hard-block step must expose a stable main_initial_mutation_guard id." >&2
  exit 1
fi

if ! grep -Fq "continue-on-error: true" <<<"${main_initial_mutation_guard_block}"; then
  echo "ERROR: the initial production mutation hard-block step must continue on error so rollback and terminal fail-closed handling can execute." >&2
  exit 1
fi

if ! grep -Fq "steps.main_untrusted_initialized_bootstrap_block.outcome != 'failure'" <<<"${main_initial_mutation_guard_block}"; then
  echo "ERROR: the initial production mutation hard-block step must be gated on the initialized bootstrap classification step outcome." >&2
  exit 1
fi

if ! grep -Fq 'expected_policy_message="Hard block: web mutation suite is forbidden on main lane by policy."' <<<"${main_initial_mutation_guard_block}"; then
  echo "ERROR: the initial production mutation hard-block step must assert the exact expected main-lane policy hard block." >&2
  exit 1
fi

if ! grep -Fq 'PIPESTATUS[0]' <<<"${main_initial_mutation_guard_block}"; then
  echo "ERROR: the initial production mutation hard-block step must capture the runner status through pipefail/PIPESTATUS." >&2
  exit 1
fi

if ! grep -Fq 'not with the expected main-lane policy hard block' <<<"${main_initial_mutation_guard_block}"; then
  echo "ERROR: the initial production mutation hard-block step must fail when the mutation runner exits for an unexpected reason." >&2
  exit 1
fi

main_rollback_mutation_guard_block="$(awk '
  /- name: Assert mutation suite is hard-blocked on production after rollback/ { in_block=1 }
  in_block && /^      - name:/ && $0 !~ /Assert mutation suite is hard-blocked on production after rollback/ { exit }
  in_block { print }
' .github/workflows/orchestration-ci-cd.yml)"

if [[ -z "${main_rollback_mutation_guard_block}" ]]; then
  echo "ERROR: could not locate the production rollback mutation hard-block guard in orchestration-ci-cd.yml." >&2
  exit 1
fi

if ! grep -Fq 'expected_policy_message="Hard block: web mutation suite is forbidden on main lane by policy."' <<<"${main_rollback_mutation_guard_block}"; then
  echo "ERROR: the production rollback mutation hard-block step must assert the exact expected main-lane policy hard block." >&2
  exit 1
fi

if ! grep -Fq 'PIPESTATUS[0]' <<<"${main_rollback_mutation_guard_block}"; then
  echo "ERROR: the production rollback mutation hard-block step must capture the runner status through pipefail/PIPESTATUS." >&2
  exit 1
fi

if ! grep -Fq 'not with the expected main-lane policy hard block' <<<"${main_rollback_mutation_guard_block}"; then
  echo "ERROR: the production rollback mutation hard-block step must fail when the mutation runner exits for an unexpected reason." >&2
  exit 1
fi

stage_rollback_proof_guard_block="$(awk '
  /- name: Guard trusted rollback target for stage rollback proof/ { in_block=1 }
  in_block && /^      - name:/ && $0 !~ /Guard trusted rollback target for stage rollback proof/ { exit }
  in_block { print }
' .github/workflows/orchestration-ci-cd.yml)"

if [[ -z "${stage_rollback_proof_guard_block}" ]]; then
  echo "ERROR: could not locate the stage rollback proof guard block in orchestration-ci-cd.yml." >&2
  exit 1
fi

if ! grep -Fq "steps.stage_rollback_proof_plan.outputs.run == 'true'" <<<"${stage_rollback_proof_guard_block}"; then
  echo "ERROR: the stage rollback proof guard must only run when rollback-proof execution is planned." >&2
  exit 1
fi

if ! grep -Fq "steps.stage_rollback_proof_plan.outputs.trusted_tuple_present" <<<"${stage_rollback_proof_guard_block}"; then
  echo "ERROR: the stage rollback proof guard must validate trusted_tuple_present before trusting the restored target." >&2
  exit 1
fi

if ! grep -Fq "steps.stage_rollback_proof_plan.outputs.target_revision" <<<"${stage_rollback_proof_guard_block}"; then
  echo "ERROR: the stage rollback proof guard must validate the restored target revision." >&2
  exit 1
fi

if ! grep -Fq "steps.stage_rollback_proof_plan.outputs.expected_flutter_sha" <<<"${stage_rollback_proof_guard_block}"; then
  echo "ERROR: the stage rollback proof guard must validate the restored flutter-app SHA." >&2
  exit 1
fi

if ! grep -Fq "steps.stage_rollback_proof_plan.outputs.expected_web_app_runtime_sha" <<<"${stage_rollback_proof_guard_block}"; then
  echo "ERROR: the stage rollback proof guard must validate the restored web-app runtime SHA." >&2
  exit 1
fi

if ! grep -Fq "steps.stage_rollback_target.outputs.revision" <<<"${stage_rollback_proof_guard_block}"; then
  echo "ERROR: the stage rollback proof guard must compare internal rollback restores against the trusted successful-release target revision." >&2
  exit 1
fi

if ! grep -Fq "prepare_navigation_workspace_from_revision.sh" .github/workflows/orchestration-ci-cd.yml; then
  echo "ERROR: stage rollback proof plan must prepare restored navigation checks from the trusted target revision when available." >&2
  exit 1
fi

if ! grep -Fq "restored_navigation_validation_mode" .github/workflows/orchestration-ci-cd.yml; then
  echo "ERROR: rollback proof plan must classify restored navigation validation mode so missing historical checks fall back to basic validation." >&2
  exit 1
fi

main_rollback_proof_guard_block="$(awk '
  /- name: Guard trusted rollback target for production rollback proof/ { in_block=1 }
  in_block && /^      - name:/ && $0 !~ /Guard trusted rollback target for production rollback proof/ { exit }
  in_block { print }
' .github/workflows/orchestration-ci-cd.yml)"

if [[ -z "${main_rollback_proof_guard_block}" ]]; then
  echo "ERROR: could not locate the production rollback proof guard block in orchestration-ci-cd.yml." >&2
  exit 1
fi

if ! grep -Fq "steps.main_rollback_proof_plan.outputs.run == 'true'" <<<"${main_rollback_proof_guard_block}"; then
  echo "ERROR: the production rollback proof guard must only run when rollback-proof execution is planned." >&2
  exit 1
fi

if ! grep -Fq "steps.main_rollback_proof_plan.outputs.trusted_tuple_present" <<<"${main_rollback_proof_guard_block}"; then
  echo "ERROR: the production rollback proof guard must validate trusted_tuple_present before trusting the restored target." >&2
  exit 1
fi

if ! grep -Fq "steps.main_rollback_proof_plan.outputs.target_revision" <<<"${main_rollback_proof_guard_block}"; then
  echo "ERROR: the production rollback proof guard must validate the restored target revision." >&2
  exit 1
fi

if ! grep -Fq "steps.main_rollback_proof_plan.outputs.expected_flutter_sha" <<<"${main_rollback_proof_guard_block}"; then
  echo "ERROR: the production rollback proof guard must validate the restored flutter-app SHA." >&2
  exit 1
fi

if ! grep -Fq "steps.main_rollback_proof_plan.outputs.expected_web_app_runtime_sha" <<<"${main_rollback_proof_guard_block}"; then
  echo "ERROR: the production rollback proof guard must validate the restored web-app runtime SHA." >&2
  exit 1
fi

if ! grep -Fq "steps.main_rollback_target.outputs.revision" <<<"${main_rollback_proof_guard_block}"; then
  echo "ERROR: the production rollback proof guard must compare internal rollback restores against the trusted successful-release target revision." >&2
  exit 1
fi

stage_rollback_navigation_block="$(awk '
  /- name: Run restored stage readonly navigation smoke/ { in_block=1 }
  in_block && /^      - name:/ && $0 !~ /Run restored stage readonly navigation smoke/ { exit }
  in_block { print }
' .github/workflows/orchestration-ci-cd.yml)"

if [[ -z "${stage_rollback_navigation_block}" ]]; then
  echo "ERROR: could not locate restored stage readonly navigation block in orchestration-ci-cd.yml." >&2
  exit 1
fi

if ! grep -Fq "restored_navigation_validation_mode == 'restored-checks'" <<<"${stage_rollback_navigation_block}"; then
  echo "ERROR: restored stage readonly smoke must run only when trusted target navigation checks are available." >&2
  exit 1
fi

if ! grep -Fq "stage_rollback_restored_navigation_prep.outcome != 'failure'" <<<"${stage_rollback_navigation_block}"; then
  echo "ERROR: restored stage readonly smoke must fall back to basic validation when restored navigation workspace preparation fails." >&2
  exit 1
fi

if ! grep -Fq 'steps.stage_rollback_proof_plan.outputs.restored_navigation_workspace' <<<"${stage_rollback_navigation_block}"; then
  echo "ERROR: restored stage readonly smoke must execute from the trusted target revision workspace, not the candidate checkout." >&2
  exit 1
fi

main_rollback_navigation_block="$(awk '
  /- name: Run restored production readonly navigation smoke/ { in_block=1 }
  in_block && /^      - name:/ && $0 !~ /Run restored production readonly navigation smoke/ { exit }
  in_block { print }
' .github/workflows/orchestration-ci-cd.yml)"

if [[ -z "${main_rollback_navigation_block}" ]]; then
  echo "ERROR: could not locate restored production readonly navigation block in orchestration-ci-cd.yml." >&2
  exit 1
fi

if ! grep -Fq "restored_navigation_validation_mode == 'restored-checks'" <<<"${main_rollback_navigation_block}"; then
  echo "ERROR: restored production readonly smoke must run only when trusted target navigation checks are available." >&2
  exit 1
fi

if ! grep -Fq "main_rollback_restored_navigation_prep.outcome != 'failure'" <<<"${main_rollback_navigation_block}"; then
  echo "ERROR: restored production readonly smoke must fall back to basic validation when restored navigation workspace preparation fails." >&2
  exit 1
fi

if ! grep -Fq 'steps.main_rollback_proof_plan.outputs.restored_navigation_workspace' <<<"${main_rollback_navigation_block}"; then
  echo "ERROR: restored production readonly smoke must execute from the trusted target revision workspace, not the candidate checkout." >&2
  exit 1
fi

stage_rollback_block="$(awk '
  /- name: Roll back stage deploy when provenance, preflight, smoke, cleanup, or post-mutation deploy failure requires recovery/ { in_block=1 }
  in_block && /^      - name:/ && $0 !~ /Roll back stage deploy when provenance, preflight, smoke, cleanup, or post-mutation deploy failure requires recovery/ { exit }
  in_block { print }
' .github/workflows/orchestration-ci-cd.yml)"

if [[ -z "${stage_rollback_block}" ]]; then
  echo "ERROR: could not locate stage rollback block in orchestration-ci-cd.yml." >&2
  exit 1
fi

if ! grep -Fq "steps.stage_public_taxonomy_validation_fixture.outcome == 'failure'" <<<"${stage_rollback_block}"; then
  echo "ERROR: stage rollback block must trigger on public taxonomy validation fixture failure." >&2
  exit 1
fi

if ! grep -Fq "steps.stage_runtime_web_sha_check.outcome == 'failure'" <<<"${stage_rollback_block}"; then
  echo "ERROR: stage rollback block must trigger on remote web-app runtime SHA mismatch." >&2
  exit 1
fi

if ! grep -Fq "steps.stage_public_edge_environment_probe.outcome == 'failure'" <<<"${stage_rollback_block}"; then
  echo "ERROR: stage rollback block must trigger on public-edge probe failure." >&2
  exit 1
fi

if ! grep -Fq "steps.stage_provenance_check.outcome == 'failure'" <<<"${stage_rollback_block}"; then
  echo "ERROR: stage rollback block must trigger on provenance failure." >&2
  exit 1
fi

if ! grep -Fq "steps.stage_navigation_smoke.outcome == 'failure'" <<<"${stage_rollback_block}"; then
  echo "ERROR: stage rollback block must trigger on readonly navigation smoke failure." >&2
  exit 1
fi

if ! grep -Fq "steps.stage_navigation_mutation_smoke.outcome == 'failure'" <<<"${stage_rollback_block}"; then
  echo "ERROR: stage rollback block must trigger on mutation navigation smoke failure." >&2
  exit 1
fi

if ! grep -Fq "steps.stage_public_taxonomy_validation_fixture_cleanup.outcome == 'failure'" <<<"${stage_rollback_block}"; then
  echo "ERROR: stage rollback block must trigger on taxonomy fixture cleanup failure." >&2
  exit 1
fi

if ! grep -Fq "steps.stage_rollback_target.outputs.trusted_tuple_present == 'true'" <<<"${stage_rollback_block}"; then
  echo "ERROR: stage rollback block must require an explicit trusted rollback tuple before attempting remote rollback." >&2
  exit 1
fi

if grep -Fq "steps.stage_untrusted_bootstrap_block.outcome == 'failure'" <<<"${stage_rollback_block}"; then
  echo "ERROR: stage rollback block must not attempt rollback on an untrusted bootstrap path with no trusted tuple." >&2
  exit 1
fi

main_rollback_block="$(awk '
  /- name: Roll back production deploy when provenance, preflight, smoke, or post-mutation deploy failure requires recovery/ { in_block=1 }
  in_block && /^      - name:/ && $0 !~ /Roll back production deploy when provenance, preflight, smoke, or post-mutation deploy failure requires recovery/ { exit }
  in_block { print }
' .github/workflows/orchestration-ci-cd.yml)"

if [[ -z "${main_rollback_block}" ]]; then
  echo "ERROR: could not locate production rollback block in orchestration-ci-cd.yml." >&2
  exit 1
fi

if ! grep -Fq "steps.main_rollback_target.outputs.trusted_tuple_present == 'true'" <<<"${main_rollback_block}"; then
  echo "ERROR: production rollback block must require an explicit trusted rollback tuple before attempting remote rollback." >&2
  exit 1
fi

if ! grep -Fq "steps.main_runtime_web_sha_check.outcome == 'failure'" <<<"${main_rollback_block}"; then
  echo "ERROR: production rollback block must trigger on remote web-app runtime SHA mismatch." >&2
  exit 1
fi

if ! grep -Fq "steps.main_public_edge_environment_probe.outcome == 'failure'" <<<"${main_rollback_block}"; then
  echo "ERROR: production rollback block must trigger on public-edge probe failure." >&2
  exit 1
fi

if ! grep -Fq "steps.main_provenance_check.outcome == 'failure'" <<<"${main_rollback_block}"; then
  echo "ERROR: production rollback block must trigger on provenance failure." >&2
  exit 1
fi

if ! grep -Fq "steps.main_initial_mutation_guard.outcome == 'failure'" <<<"${main_rollback_block}"; then
  echo "ERROR: production rollback block must trigger on initial main mutation hard-block failure." >&2
  exit 1
fi

if ! grep -Fq "steps.production_navigation_smoke.outcome == 'failure'" <<<"${main_rollback_block}"; then
  echo "ERROR: production rollback block must trigger on readonly navigation smoke failure." >&2
  exit 1
fi

if grep -Fq "steps.main_untrusted_bootstrap_block.outcome == 'failure'" <<<"${main_rollback_block}"; then
  echo "ERROR: production rollback block must not attempt rollback on an untrusted bootstrap path with no trusted tuple." >&2
  exit 1
fi

stage_final_fail_block="$(awk '
  /- name: Fail stage deploy after rollback/ { in_block=1 }
  in_block && /^  [a-zA-Z0-9_-]+:/ { exit }
  in_block { print }
' .github/workflows/orchestration-ci-cd.yml)"

if [[ -z "${stage_final_fail_block}" ]]; then
  echo "ERROR: could not locate stage terminal fail-closed block in orchestration-ci-cd.yml." >&2
  exit 1
fi

if ! grep -Fq "steps.stage_untrusted_bootstrap_block.outcome == 'failure'" <<<"${stage_final_fail_block}"; then
  echo "ERROR: stage terminal fail-closed block must trigger on the untrusted bootstrap guard." >&2
  exit 1
fi

if ! grep -Fq "steps.stage_runtime_web_sha_check.outcome == 'failure'" <<<"${stage_final_fail_block}"; then
  echo "ERROR: stage terminal fail-closed block must trigger on remote web-app runtime SHA mismatch." >&2
  exit 1
fi

if ! grep -Fq "steps.stage_untrusted_initialized_bootstrap_block.outcome == 'failure'" <<<"${stage_final_fail_block}"; then
  echo "ERROR: stage terminal fail-closed block must trigger on the initialized bootstrap guard." >&2
  exit 1
fi

if ! grep -Fq "steps.stage_public_edge_environment_probe.outcome == 'failure'" <<<"${stage_final_fail_block}"; then
  echo "ERROR: stage terminal fail-closed block must trigger on public-edge probe failure." >&2
  exit 1
fi

if ! grep -Fq "steps.stage_provenance_check.outcome == 'failure'" <<<"${stage_final_fail_block}"; then
  echo "ERROR: stage terminal fail-closed block must trigger on provenance failure." >&2
  exit 1
fi

if ! grep -Fq "steps.stage_public_taxonomy_validation_fixture.outcome == 'failure'" <<<"${stage_final_fail_block}"; then
  echo "ERROR: stage terminal fail-closed block must trigger on public taxonomy validation fixture failure." >&2
  exit 1
fi

if ! grep -Fq "steps.stage_navigation_smoke.outcome == 'failure'" <<<"${stage_final_fail_block}"; then
  echo "ERROR: stage terminal fail-closed block must trigger on readonly navigation smoke failure." >&2
  exit 1
fi

if ! grep -Fq "steps.stage_navigation_mutation_smoke.outcome == 'failure'" <<<"${stage_final_fail_block}"; then
  echo "ERROR: stage terminal fail-closed block must trigger on mutation navigation smoke failure." >&2
  exit 1
fi

if ! grep -Fq "steps.stage_rollback_proof_guard.outcome == 'failure'" <<<"${stage_final_fail_block}"; then
  echo "ERROR: stage terminal fail-closed block must trigger on rollback-proof guard failure." >&2
  exit 1
fi

if ! grep -Fq "steps.stage_rollback_runtime_web_sha_check.outcome == 'failure'" <<<"${stage_final_fail_block}"; then
  echo "ERROR: stage terminal fail-closed block must trigger on rollback-proof web-app runtime SHA mismatch." >&2
  exit 1
fi

if ! grep -Fq "steps.stage_rollback_initialize_preflight.outcome == 'failure'" <<<"${stage_final_fail_block}"; then
  echo "ERROR: stage terminal fail-closed block must trigger on rollback-proof initialize preflight failure." >&2
  exit 1
fi

if ! grep -Fq "steps.stage_rollback_public_edge_environment_probe.outcome == 'failure'" <<<"${stage_final_fail_block}"; then
  echo "ERROR: stage terminal fail-closed block must trigger on rollback-proof public-edge probe failure." >&2
  exit 1
fi

if ! grep -Fq "steps.stage_rollback_provenance_check.outcome == 'failure'" <<<"${stage_final_fail_block}"; then
  echo "ERROR: stage terminal fail-closed block must trigger on rollback-proof provenance failure." >&2
  exit 1
fi

if ! grep -Fq "steps.stage_rollback_navigation_smoke.outcome == 'failure'" <<<"${stage_final_fail_block}"; then
  echo "ERROR: stage terminal fail-closed block must trigger on restored readonly navigation smoke failure." >&2
  exit 1
fi

if ! grep -Fq "steps.stage_rollback_navigation_mutation_smoke.outcome == 'failure'" <<<"${stage_final_fail_block}"; then
  echo "ERROR: stage terminal fail-closed block must trigger on restored mutation navigation smoke failure." >&2
  exit 1
fi

main_final_fail_block="$(awk '
  /- name: Fail production deploy after rollback/ { in_block=1 }
  in_block && /^      - name:/ && $0 !~ /Fail production deploy after rollback/ { exit }
  in_block { print }
' .github/workflows/orchestration-ci-cd.yml)"

if [[ -z "${main_final_fail_block}" ]]; then
  echo "ERROR: could not locate production terminal fail-closed block in orchestration-ci-cd.yml." >&2
  exit 1
fi

if ! grep -Fq "steps.main_untrusted_bootstrap_block.outcome == 'failure'" <<<"${main_final_fail_block}"; then
  echo "ERROR: production terminal fail-closed block must trigger on the untrusted bootstrap guard." >&2
  exit 1
fi

if ! grep -Fq "steps.main_runtime_web_sha_check.outcome == 'failure'" <<<"${main_final_fail_block}"; then
  echo "ERROR: production terminal fail-closed block must trigger on remote web-app runtime SHA mismatch." >&2
  exit 1
fi

if ! grep -Fq "steps.main_untrusted_initialized_bootstrap_block.outcome == 'failure'" <<<"${main_final_fail_block}"; then
  echo "ERROR: production terminal fail-closed block must trigger on the initialized bootstrap guard." >&2
  exit 1
fi

if ! grep -Fq "steps.main_public_edge_environment_probe.outcome == 'failure'" <<<"${main_final_fail_block}"; then
  echo "ERROR: production terminal fail-closed block must trigger on public-edge probe failure." >&2
  exit 1
fi

if ! grep -Fq "steps.main_provenance_check.outcome == 'failure'" <<<"${main_final_fail_block}"; then
  echo "ERROR: production terminal fail-closed block must trigger on provenance failure." >&2
  exit 1
fi

if ! grep -Fq "steps.main_initial_mutation_guard.outcome == 'failure'" <<<"${main_final_fail_block}"; then
  echo "ERROR: production terminal fail-closed block must trigger on initial main mutation hard-block failure." >&2
  exit 1
fi

if ! grep -Fq "steps.production_navigation_smoke.outcome == 'failure'" <<<"${main_final_fail_block}"; then
  echo "ERROR: production terminal fail-closed block must trigger on readonly navigation smoke failure." >&2
  exit 1
fi

if ! grep -Fq "steps.main_rollback_mutation_guard.outcome == 'failure'" <<<"${main_final_fail_block}"; then
  echo "ERROR: production terminal fail-closed block must trigger on rollback-proof mutation hard-block failure." >&2
  exit 1
fi

if ! grep -Fq "steps.main_rollback_proof_guard.outcome == 'failure'" <<<"${main_final_fail_block}"; then
  echo "ERROR: production terminal fail-closed block must trigger on rollback-proof guard failure." >&2
  exit 1
fi

if ! grep -Fq "steps.main_rollback_runtime_web_sha_check.outcome == 'failure'" <<<"${main_final_fail_block}"; then
  echo "ERROR: production terminal fail-closed block must trigger on rollback-proof web-app runtime SHA mismatch." >&2
  exit 1
fi

if ! grep -Fq "steps.main_rollback_initialize_preflight.outcome == 'failure'" <<<"${main_final_fail_block}"; then
  echo "ERROR: production terminal fail-closed block must trigger on rollback-proof initialize preflight failure." >&2
  exit 1
fi

if ! grep -Fq "steps.main_rollback_public_edge_environment_probe.outcome == 'failure'" <<<"${main_final_fail_block}"; then
  echo "ERROR: production terminal fail-closed block must trigger on rollback-proof public-edge probe failure." >&2
  exit 1
fi

if ! grep -Fq "steps.main_rollback_provenance_check.outcome == 'failure'" <<<"${main_final_fail_block}"; then
  echo "ERROR: production terminal fail-closed block must trigger on rollback-proof provenance failure." >&2
  exit 1
fi

if ! grep -Fq "steps.main_rollback_navigation_smoke.outcome == 'failure'" <<<"${main_final_fail_block}"; then
  echo "ERROR: production terminal fail-closed block must trigger on restored readonly navigation smoke failure." >&2
  exit 1
fi

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

bash .github/scripts/prove_web_metadata_main_contract.sh >/dev/null
bash .github/scripts/prove_rollback_queue_parity.sh >/dev/null

echo "OK: CI environment invariants validated."
