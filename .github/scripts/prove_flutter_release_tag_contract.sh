#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
emit_script="${repo_root}/.github/scripts/emit_flutter_release_tag.sh"
workflow_file="${repo_root}/.github/workflows/orchestration-ci-cd.yml"

if [[ ! -f "${emit_script}" ]]; then
  echo "ERROR: emit_flutter_release_tag.sh is required for the flutter release tag contract proof." >&2
  exit 1
fi

if [[ ! -f "${workflow_file}" ]]; then
  echo "ERROR: orchestration-ci-cd.yml is required for the flutter release tag workflow proof." >&2
  exit 1
fi

if ! grep -Fq "cancel-in-progress: \${{ github.event_name != 'push' || github.ref_name != 'main' }}" "${workflow_file}"; then
  echo "ERROR: main push runs must serialize instead of canceling in-progress post-main tag emission." >&2
  exit 1
fi

if ! grep -Fq 'FLUTTER_RELEASE_REPO_TOKEN: ${{ secrets.FLUTTER_RELEASE_REPO_TOKEN }}' "${workflow_file}"; then
  echo "ERROR: emit_flutter_release_tag must require the dedicated FLUTTER_RELEASE_REPO_TOKEN secret." >&2
  exit 1
fi

if ! grep -Fq 'Set FLUTTER_RELEASE_REPO_TOKEN in this repository secrets with write access to the flutter-app repository tags.' "${workflow_file}"; then
  echo "ERROR: emit_flutter_release_tag must document the dedicated flutter-app tag write secret contract explicitly." >&2
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
