#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
emit_script="${repo_root}/.github/scripts/emit_flutter_release_tag.sh"
readiness_script="${repo_root}/.github/scripts/verify_flutter_release_repo_token_readiness.sh"
workflow_file="${repo_root}/.github/workflows/orchestration-ci-cd.yml"

if [[ ! -f "${emit_script}" ]]; then
  echo "ERROR: emit_flutter_release_tag.sh is required for the flutter release tag contract proof." >&2
  exit 1
fi

if [[ ! -f "${readiness_script}" ]]; then
  echo "ERROR: verify_flutter_release_repo_token_readiness.sh is required for the flutter release tag readiness proof." >&2
  exit 1
fi

if [[ ! -f "${workflow_file}" ]]; then
  echo "ERROR: orchestration-ci-cd.yml is required for the flutter release tag workflow proof." >&2
  exit 1
fi

preflight_job="$(awk '
  /^  preflight:$/ { in_block=1 }
  in_block && /^  [A-Za-z0-9_-]+:$/ && $0 !~ /^  preflight:$/ { exit }
  in_block { print }
' "${workflow_file}")"

if [[ -z "${preflight_job}" ]]; then
  echo "ERROR: orchestration-ci-cd.yml must define the preflight job that gates main-lane readiness." >&2
  exit 1
fi

emit_flutter_release_tag_job="$(awk '
  /^  emit_flutter_release_tag:$/ { in_block=1 }
  in_block && /^  [A-Za-z0-9_-]+:$/ && $0 !~ /^  emit_flutter_release_tag:$/ { exit }
  in_block { print }
' "${workflow_file}")"

if [[ -z "${emit_flutter_release_tag_job}" ]]; then
  echo "ERROR: orchestration-ci-cd.yml must define an emit_flutter_release_tag post-main job." >&2
  exit 1
fi

if ! grep -Fq "cancel-in-progress: \${{ github.event_name != 'push' || github.ref_name != 'main' }}" "${workflow_file}"; then
  echo "ERROR: main push runs must serialize instead of canceling in-progress post-main tag emission." >&2
  exit 1
fi

if ! grep -Fq 'FLUTTER_RELEASE_REPO_TOKEN: ${{ secrets.FLUTTER_RELEASE_REPO_TOKEN }}' <<<"${emit_flutter_release_tag_job}"; then
  echo "ERROR: emit_flutter_release_tag must require the dedicated FLUTTER_RELEASE_REPO_TOKEN secret." >&2
  exit 1
fi

if ! grep -Fq 'Verify flutter release tag secret readiness' <<<"${preflight_job}" || ! grep -Fq 'bash .github/scripts/verify_flutter_release_repo_token_readiness.sh' <<<"${preflight_job}"; then
  echo "ERROR: preflight must verify FLUTTER_RELEASE_REPO_TOKEN readiness before main can be declared clean." >&2
  exit 1
fi

if ! grep -Fq "github.base_ref == 'main'" <<<"${preflight_job}" || ! grep -Fq "github.ref_name == 'main'" <<<"${preflight_job}"; then
  echo "ERROR: preflight readiness check must stay scoped to main-lane PR/push events." >&2
  exit 1
fi

if ! grep -Fq "github.event_name == 'push'" <<<"${emit_flutter_release_tag_job}" || ! grep -Fq "needs.deploy_main.result == 'success'" <<<"${emit_flutter_release_tag_job}"; then
  echo "ERROR: emit_flutter_release_tag must remain gated on authoritative post-main push success." >&2
  exit 1
fi

if grep -Fq 'SUBMODULES_REPO_TOKEN:' <<<"${emit_flutter_release_tag_job}" || grep -Fq 'WEB_APP_REPO_TOKEN:' <<<"${emit_flutter_release_tag_job}"; then
  echo "ERROR: emit_flutter_release_tag must not fall back to the legacy submodule/web-app tokens." >&2
  exit 1
fi

if ! grep -Fq 'SUBMODULE_PATHS: flutter-app' <<<"${emit_flutter_release_tag_job}"; then
  echo "ERROR: emit_flutter_release_tag must scope submodule checkout to flutter-app only." >&2
  exit 1
fi

if ! grep -Fq 'bash .github/scripts/verify_flutter_release_repo_token_readiness.sh' <<<"${emit_flutter_release_tag_job}"; then
  echo "ERROR: emit_flutter_release_tag must use the canonical flutter release token readiness helper." >&2
  exit 1
fi

if ! grep -Fq 'Set FLUTTER_RELEASE_REPO_TOKEN in this repository secrets with flutter-app read access and flutter-app tag write access.' "${readiness_script}"; then
  echo "ERROR: readiness script must document the dedicated flutter-app read/tag-write secret contract explicitly." >&2
  exit 1
fi

if ! grep -Fq "This must be green before a Docker main promotion can be declared clean." "${readiness_script}"; then
  echo "ERROR: readiness script must explain that main promotion cleanliness depends on FLUTTER_RELEASE_REPO_TOKEN readiness." >&2
  exit 1
fi

scratch_dir="$(mktemp -d)"

cleanup() {
  rm -rf "${scratch_dir}"
}

trap cleanup EXIT

git_commit_all() {
  local target_dir="$1"
  local message="$2"

  git -C "${target_dir}" add -A
  git -C "${target_dir}" \
    -c user.name="Belluga CI Proof" \
    -c user.email="ci-proof@belluga.local" \
    commit -q -m "${message}"
}

create_case() {
  local case_name="$1"
  local pubspec_body="$2"
  local case_dir="${scratch_dir}/${case_name}"
  local flutter_remote="${case_dir}/flutter-remote.git"
  local flutter_work="${case_dir}/flutter-work"
  local root_dir="${case_dir}/root"

  mkdir -p "${case_dir}" "${root_dir}"
  git init -q --bare "${flutter_remote}"
  git clone -q "${flutter_remote}" "${flutter_work}"
  git -C "${flutter_work}" checkout -q -b main

  printf '%s\n' "${pubspec_body}" >"${flutter_work}/pubspec.yaml"
  git_commit_all "${flutter_work}" "seed flutter source"
  git -C "${flutter_work}" push -q -u origin main

  git -C "${root_dir}" init -q
  git -C "${root_dir}" checkout -q -b main
  git -C "${root_dir}" -c protocol.file.allow=always submodule add -q -b main "${flutter_remote}" flutter-app
  git_commit_all "${root_dir}" "seed root gitlink"

  printf '%s\n%s\n%s\n' "${root_dir}" "${flutter_work}" "${flutter_remote}"
}

run_success_case() {
  local root_dir="$1"
  local output_file="$2"

  if ! (cd "${root_dir}" && bash "${emit_script}") >"${output_file}" 2>&1; then
    echo "ERROR: expected flutter release tag proof case to pass." >&2
    cat "${output_file}" >&2 || true
    exit 1
  fi
}

run_failure_case() {
  local root_dir="$1"
  local output_file="$2"
  local expected_error="$3"
  local status=0

  set +e
  (cd "${root_dir}" && bash "${emit_script}") >"${output_file}" 2>&1
  status=$?
  set -e

  if [[ "${status}" -eq 0 ]]; then
    echo "ERROR: expected flutter release tag proof case to fail." >&2
    cat "${output_file}" >&2 || true
    exit 1
  fi

  if ! grep -Fq "${expected_error}" "${output_file}"; then
    echo "ERROR: flutter release tag proof case failed for the wrong reason." >&2
    cat "${output_file}" >&2 || true
    exit 1
  fi
}

positive_case_info="$(create_case "positive" $'name: proof_app\nversion: 0.2.2+10')"
positive_root_dir="$(printf '%s\n' "${positive_case_info}" | sed -n '1p')"
positive_flutter_work="$(printf '%s\n' "${positive_case_info}" | sed -n '2p')"
positive_flutter_remote="$(printf '%s\n' "${positive_case_info}" | sed -n '3p')"
positive_output="${scratch_dir}/positive.out"

run_success_case "${positive_root_dir}" "${positive_output}"

expected_tag_target="$(git -C "${positive_flutter_work}" rev-parse HEAD | tr -d '[:space:]')"
actual_tag_target="$(git --git-dir "${positive_flutter_remote}" rev-parse --verify "refs/tags/v0.2.2+10^{commit}" | tr -d '[:space:]')"
if [[ "${expected_tag_target}" != "${actual_tag_target}" ]]; then
  echo "ERROR: positive proof case created the wrong tag target." >&2
  cat "${positive_output}" >&2 || true
  exit 1
fi

run_success_case "${positive_root_dir}" "${positive_output}"
if ! grep -Fq "explicit no-op" "${positive_output}"; then
  echo "ERROR: same-SHA rerun must no-op explicitly." >&2
  cat "${positive_output}" >&2 || true
  exit 1
fi

gitlink_mismatch_case_info="$(create_case "gitlink-mismatch" $'name: proof_app\nversion: 0.2.2+10')"
gitlink_mismatch_root_dir="$(printf '%s\n' "${gitlink_mismatch_case_info}" | sed -n '1p')"
gitlink_mismatch_flutter_work="$(printf '%s\n' "${gitlink_mismatch_case_info}" | sed -n '2p')"
printf 'mismatch\n' >"${gitlink_mismatch_flutter_work}/mismatch.txt"
git_commit_all "${gitlink_mismatch_flutter_work}" "create gitlink mismatch descendant"
git -C "${gitlink_mismatch_flutter_work}" push -q origin main
git -C "${gitlink_mismatch_root_dir}/flutter-app" fetch -q origin main
git -C "${gitlink_mismatch_root_dir}/flutter-app" checkout -q origin/main

gitlink_mismatch_output="${scratch_dir}/gitlink-mismatch.out"
run_failure_case \
  "${gitlink_mismatch_root_dir}" \
  "${gitlink_mismatch_output}" \
  "does not match root gitlink"

printf 'collision\n' >"${positive_flutter_work}/collision.txt"
git_commit_all "${positive_flutter_work}" "create same-version descendant"
git -C "${positive_flutter_work}" push -q origin main
git -C "${positive_root_dir}/flutter-app" fetch -q origin main
git -C "${positive_root_dir}/flutter-app" checkout -q origin/main
git_commit_all "${positive_root_dir}" "advance flutter gitlink without version bump"

collision_output="${scratch_dir}/collision.out"
run_failure_case \
  "${positive_root_dir}" \
  "${collision_output}" \
  "already exists on"

missing_version_case_info="$(create_case "missing-version" 'name: proof_app')"
missing_version_root_dir="$(printf '%s\n' "${missing_version_case_info}" | sed -n '1p')"
missing_version_output="${scratch_dir}/missing-version.out"
run_failure_case \
  "${missing_version_root_dir}" \
  "${missing_version_output}" \
  "could not resolve one unambiguous Flutter version tuple"

echo "OK: flutter release tag contract proof passed."
