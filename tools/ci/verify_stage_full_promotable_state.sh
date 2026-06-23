#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEFAULT_BASE_REF="${STAGE_FULL_PROMOTION_BASE_REF:-origin/dev}"

detect_governing_todo() {
  local root_branch="$1"
  if [[ ! "${root_branch}" =~ ^v.+-rc$ ]]; then
    return 1
  fi

  local package_version="${root_branch%-rc}"
  local todo_path="${ROOT_DIR}/foundation_documentation/todos/promotion_lane/${package_version}/TODO-${package_version}-release-package.md"
  if [[ ! -f "${todo_path}" ]]; then
    return 1
  fi

  printf '%s\n' "${todo_path}"
}

ensure_clean_repo() {
  local repo_path="$1"
  local repo_label="$2"
  local status_output=""
  status_output="$(git -C "${repo_path}" status --short)"
  if [[ -n "${status_output}" ]]; then
    echo "ERROR: stage-full promotable-state validation requires a clean worktree for ${repo_label}." >&2
    printf '%s\n' "${status_output}" >&2
    exit 1
  fi
}

run_source_authority() {
  local repo_selector="$1"
  local repo_key="$2"
  local source_branch="$3"
  local governing_todo="$4"

  python3 "${ROOT_DIR}/delphi-ai/tools/github_promotion_source_authority_guard.py" \
    --repo "${repo_selector}" \
    --source-ref "${source_branch}" \
    --governing-todo "${governing_todo}" \
    --repo-key "${repo_key}"
}

run_source_preflight() {
  local repo_workdir="$1"
  local repo_key="$2"
  local source_branch="$3"
  local governing_todo="$4"

  (
    cd "${repo_workdir}"
    bash "${ROOT_DIR}/delphi-ai/tools/github_stage_promotion_preflight.sh" \
    --source "${source_branch}" \
    --base "${DEFAULT_BASE_REF}" \
    --governing-todo "${governing_todo}" \
    --repo-key "${repo_key}"
  )
}

main() {
  local root_branch=""
  root_branch="$(git -C "${ROOT_DIR}" branch --show-current)"

  echo "INFO: stage-full promotable-state validation starting."
  echo "INFO: root branch under evaluation: ${root_branch:-<detached>}."

  local governing_todo=""
  governing_todo="$(detect_governing_todo "${root_branch}" || true)"
  if [[ -z "${governing_todo}" ]]; then
    echo "INFO: no package-governed *-rc promotion packet matched the current branch; skipping promotable-state guard for stage-full."
    exit 0
  fi

  echo "INFO: using governing package TODO: ${governing_todo#${ROOT_DIR}/}"

  local repo_path=""
  local repo_selector=""
  local repo_key=""
  local repo_label=""
  local source_branch=""

  for repo_key in root flutter-app laravel-app; do
    case "${repo_key}" in
      root)
        repo_path="${ROOT_DIR}"
        repo_selector="."
        repo_label="root"
        ;;
      flutter-app|laravel-app)
        repo_path="${ROOT_DIR}/${repo_key}"
        repo_selector="${repo_key}"
        repo_label="${repo_key}"
        ;;
    esac

    source_branch="$(git -C "${repo_path}" branch --show-current)"
    echo "INFO: promotable-state validating ${repo_label} on branch ${source_branch:-<detached>}."
    ensure_clean_repo "${repo_path}" "${repo_label}"
    run_source_authority "${repo_selector}" "${repo_key}" "${source_branch}" "${governing_todo}"
    run_source_preflight "${repo_path}" "${repo_key}" "${source_branch}" "${governing_todo}"
  done

  echo "OK: stage-full promotable-state validation passed."
}

main "$@"
