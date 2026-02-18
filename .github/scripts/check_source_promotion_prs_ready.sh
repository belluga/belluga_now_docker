#!/usr/bin/env bash
set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: GitHub CLI (gh) is required." >&2
  exit 1
fi

if [[ -z "${GH_TOKEN:-}" ]]; then
  echo "ERROR: GH_TOKEN is required to query source promotion PR status." >&2
  exit 1
fi

HEAD_BRANCH="${GITHUB_HEAD_REF:-}"
BASE_BRANCH="${GITHUB_BASE_REF:-}"

if [[ -z "${HEAD_BRANCH}" || -z "${BASE_BRANCH}" ]]; then
  echo "ERROR: check_source_promotion_prs_ready.sh must run on pull_request context with head/base refs." >&2
  exit 1
fi

case "${HEAD_BRANCH}->${BASE_BRANCH}" in
  "dev->stage"|"stage->main") ;;
  *)
    echo "INFO: skipping source PR readiness check for non-promotion mapping '${HEAD_BRANCH}->${BASE_BRANCH}'."
    exit 0
    ;;
esac

# Source promotion applies only to true source repos.
# web-app is a derived artifact generated from flutter-app per lane.
SUBMODULES=(flutter-app laravel-app)

parse_repo_slug_from_url() {
  local url="$1"
  url="${url#git@github.com:}"
  url="${url#ssh://git@github.com/}"
  url="${url#https://github.com/}"
  url="${url#http://github.com/}"
  url="${url%.git}"
  printf '%s\n' "${url}"
}

find_existing_lane_pr_number() {
  local repo_slug="$1"
  local base_branch="$2"
  local head_branch="$3"

  gh pr list \
    --repo "${repo_slug}" \
    --state open \
    --base "${base_branch}" \
    --json number,headRefName \
    --jq ".[] | select(.headRefName == \"${head_branch}\") | .number" \
    | head -n1
}

is_pinned_on_remote_branch() {
  local submodule="$1"
  local pinned_sha="$2"
  local branch="$3"

  if [[ -z "$branch" ]]; then
    return 1
  fi

  if ! git -C "$submodule" fetch origin "$branch" --quiet; then
    return 1
  fi

  if ! git -C "$submodule" rev-parse --verify "origin/$branch" >/dev/null 2>&1; then
    return 1
  fi

  git -C "$submodule" merge-base --is-ancestor "$pinned_sha" "origin/$branch"
}

for submodule in "${SUBMODULES[@]}"; do
  if [[ ! -d "$submodule/.git" && ! -f "$submodule/.git" ]]; then
    echo "ERROR: submodule '$submodule' is not initialized." >&2
    exit 1
  fi

  pinned_sha="$(git ls-tree HEAD "$submodule" | awk '{print $3}')"
  if [[ -z "${pinned_sha}" ]]; then
    echo "ERROR: failed to resolve pinned SHA for '${submodule}'." >&2
    exit 1
  fi

  submodule_url="$(git config -f .gitmodules --get "submodule.${submodule}.url" || true)"
  if [[ -z "${submodule_url}" ]]; then
    echo "ERROR: missing .gitmodules URL for '${submodule}'." >&2
    exit 1
  fi

  source_repo="$(parse_repo_slug_from_url "${submodule_url}")"
  if [[ "${source_repo}" != */* ]]; then
    echo "ERROR: invalid repository slug '${source_repo}' parsed from '${submodule_url}'." >&2
    exit 1
  fi

  already_promoted_noop=0
  if [[ "${BASE_BRANCH}" == "stage" ]]; then
    if is_pinned_on_remote_branch "$submodule" "$pinned_sha" "stage" || is_pinned_on_remote_branch "$submodule" "$pinned_sha" "main"; then
      already_promoted_noop=1
    fi
  else
    if is_pinned_on_remote_branch "$submodule" "$pinned_sha" "main"; then
      already_promoted_noop=1
    fi
  fi

  pr_number="$(find_existing_lane_pr_number "${source_repo}" "${BASE_BRANCH}" "${HEAD_BRANCH}")"

  if [[ "${already_promoted_noop}" -eq 1 ]]; then
    if [[ -n "${pr_number}" ]]; then
      echo "INFO: ${submodule} (${source_repo}@${pinned_sha}) is no-op; source PR #${pr_number} exists but is not required."
    else
      echo "INFO: ${submodule} (${source_repo}@${pinned_sha}) already promoted to ${BASE_BRANCH} (or advanced lane). No source PR required."
    fi
    continue
  fi

  if [[ -z "${pr_number}" ]]; then
    echo "ERROR: missing source promotion PR in ${source_repo} for ${HEAD_BRANCH} -> ${BASE_BRANCH}." >&2
    exit 1
  fi

  pr_is_draft="$(
    gh pr view "${pr_number}" --repo "${source_repo}" --json isDraft --jq '.isDraft'
  )"
  pr_merge_state="$(
    gh pr view "${pr_number}" --repo "${source_repo}" --json mergeStateStatus --jq '.mergeStateStatus // "UNKNOWN"'
  )"
  pr_url="$(
    gh pr view "${pr_number}" --repo "${source_repo}" --json url --jq '.url'
  )"

  if [[ "${pr_is_draft}" == "true" ]]; then
    echo "ERROR: source promotion PR #${pr_number} in ${source_repo} is draft (${pr_url})." >&2
    exit 1
  fi

  if [[ "${pr_merge_state}" != "CLEAN" ]]; then
    echo "ERROR: source promotion PR #${pr_number} in ${source_repo} is not merge-ready (mergeStateStatus=${pr_merge_state})." >&2
    echo "ERROR: PR URL: ${pr_url}" >&2
    exit 1
  fi

  echo "OK: source promotion PR #${pr_number} in ${source_repo} is merge-ready (${pr_url})."
done

echo "INFO: all source promotion PRs are merge-ready for ${HEAD_BRANCH}->${BASE_BRANCH}."
