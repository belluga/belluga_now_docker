#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEFAULT_BASE_REF="${STAGE_FULL_PROMOTION_BASE_REF:-origin/dev}"

ensure_principal_checkout() {
  local git_dir=""
  local git_common_dir=""
  local principal_checkout=""

  git_dir="$(
    cd "${ROOT_DIR}" &&
      cd "$(git rev-parse --git-dir)" &&
      pwd
  )"
  git_common_dir="$(
    cd "${ROOT_DIR}" &&
      cd "$(git rev-parse --git-common-dir)" &&
      pwd
  )"

  if [[ "${git_dir}" == "${git_common_dir}" ]]; then
    return 0
  fi

  principal_checkout="$(cd "${git_common_dir}/.." && pwd)"

  echo "ERROR: promotable stage-full must run from the principal checkout." >&2
  echo "ERROR: current checkout: ${ROOT_DIR}" >&2
  echo "ERROR: principal checkout: ${principal_checkout}" >&2
  echo "ERROR: linked worktrees are not allowed for this promotion flow because they can miss principal-only artifacts." >&2
  echo "ERROR: gitlinks are promotion-lane artifacts; do not inspect, realign, or update them manually from a worktree." >&2
  echo "ERROR: recovery action: rerun stage-full from the principal checkout and let the promotion lane own any later gitlink movement." >&2
  exit 1
}

detect_governing_todo() {
  local root_branch="$1"
  local package_version=""
  local candidate_version=""
  local todo_path=""
  local candidates=()
  local todo_roots=()
  local todo_root=""
  if [[ ! "${root_branch}" =~ ^v.+-rc$ ]]; then
    return 1
  fi

  package_version="${root_branch%-rc}"
  candidates=("${package_version}")
  todo_roots=(
    "${ROOT_DIR}/foundation_documentation/todos/promotion_lane"
    "${ROOT_DIR}/foundation_documentation/todos/active"
  )
  if [[ "${package_version}" == *+* ]]; then
    candidate_version="${package_version%%+*}"
    if [[ -n "${candidate_version}" && "${candidate_version}" != "${package_version}" ]]; then
      candidates+=("${candidate_version}")
    fi
  fi

  for todo_root in "${todo_roots[@]}"; do
    for candidate_version in "${candidates[@]}"; do
      todo_path="${todo_root}/${candidate_version}/TODO-${candidate_version}-release-package.md"
      if [[ -f "${todo_path}" ]]; then
        printf '%s\n' "${todo_path}"
        return 0
      fi
    fi
  done

  return 1
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

root_gitlink_matches_base() {
  local submodule_path="$1"
  local head_gitlink_sha=""
  local base_gitlink_sha=""

  head_gitlink_sha="$(git -C "${ROOT_DIR}" rev-parse "HEAD:${submodule_path}" 2>/dev/null | tr -d '[:space:]' || true)"
  base_gitlink_sha="$(git -C "${ROOT_DIR}" rev-parse "${DEFAULT_BASE_REF}:${submodule_path}" 2>/dev/null | tr -d '[:space:]' || true)"

  [[ -n "${head_gitlink_sha}" ]] \
    && [[ -n "${base_gitlink_sha}" ]] \
    && [[ "${head_gitlink_sha}" == "${base_gitlink_sha}" ]]
}

repo_requires_source_preflight() {
  local repo_key="$1"

  case "${repo_key}" in
    root)
      return 0
      ;;
    flutter-app|laravel-app)
      if root_gitlink_matches_base "${repo_key}"; then
        return 1
      fi
      return 0
      ;;
  esac

  return 0
}

main() {
  local root_branch=""
  ensure_principal_checkout
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
    if repo_requires_source_preflight "${repo_key}"; then
      run_source_preflight "${repo_path}" "${repo_key}" "${source_branch}" "${governing_todo}"
      continue
    fi

    echo "INFO: skipping promotable-state source preflight for ${repo_label} because root gitlink matches ${DEFAULT_BASE_REF}; this stage-full rerun is root-only for that repo."
  done

  echo "OK: stage-full promotable-state validation passed."
}

main "$@"
