#!/usr/bin/env bash
set -euo pipefail

TARGET_BRANCH="${1:-${GITHUB_REF_NAME:-}}"
if [[ -z "$TARGET_BRANCH" ]]; then
  echo "ERROR: target branch is required" >&2
  exit 1
fi

SUBMODULES=(flutter-app laravel-app)
PR_HEAD_BRANCH="${GITHUB_HEAD_REF:-}"
PR_BASE_BRANCH="${GITHUB_BASE_REF:-}"
GH_TOKEN="${GH_TOKEN:-}"
declare -A FETCHED_REMOTE_BRANCHES

ensure_remote_branch_fetched() {
  local submodule="$1"
  local branch="$2"

  if [[ -z "$branch" ]]; then
    return 1
  fi

  local key="${submodule}:${branch}"
  if [[ -n "${FETCHED_REMOTE_BRANCHES[$key]:-}" ]]; then
    return 0
  fi

  if ! git -C "$submodule" fetch origin "$branch" --quiet; then
    return 1
  fi

  FETCHED_REMOTE_BRANCHES["$key"]=1
}

remote_branch_exists() {
  local submodule="$1"
  local branch="$2"

  if [[ -z "$branch" ]]; then
    return 1
  fi

  git -C "$submodule" ls-remote --exit-code --heads origin "$branch" >/dev/null 2>&1
}

is_pinned_on_remote_branch() {
  local submodule="$1"
  local pinned_sha="$2"
  local branch="$3"

  if [[ -z "$branch" ]]; then
    return 1
  fi

  if ! ensure_remote_branch_fetched "$submodule" "$branch"; then
    return 1
  fi

  if ! git -C "$submodule" rev-parse --verify "origin/$branch" >/dev/null 2>&1; then
    return 1
  fi

  git -C "$submodule" merge-base --is-ancestor "$pinned_sha" "origin/$branch"
}

parse_repo_slug_from_url() {
  local url="$1"
  url="${url#git@github.com:}"
  url="${url#ssh://git@github.com/}"
  url="${url#https://github.com/}"
  url="${url#http://github.com/}"
  url="${url%.git}"
  printf '%s\n' "${url}"
}

find_promotion_pr_url() {
  local repo_slug="$1"
  local head_branch="$2"
  local base_branch="$3"

  if [[ -z "$repo_slug" || -z "$head_branch" || -z "$base_branch" ]]; then
    return 1
  fi

  if [[ -z "$GH_TOKEN" ]] || ! command -v gh >/dev/null 2>&1; then
    return 1
  fi

  local pr_number=""
  pr_number="$(
    GH_TOKEN="$GH_TOKEN" gh pr list \
      --repo "$repo_slug" \
      --state open \
      --base "$base_branch" \
      --json number,headRefName \
      --jq ".[] | select(.headRefName == \"${head_branch}\") | .number" \
      | head -n1
  )"

  if [[ -z "$pr_number" ]]; then
    return 1
  fi

  GH_TOKEN="$GH_TOKEN" gh pr view "$pr_number" --repo "$repo_slug" --json url --jq '.url'
}

is_pinned_on_any_lane() {
  local submodule="$1"
  local pinned_sha="$2"
  local lane="$3"
  is_pinned_on_remote_branch "$submodule" "$pinned_sha" "$lane"
}

overall_failed=0

for submodule in "${SUBMODULES[@]}"; do
  if [[ ! -d "$submodule/.git" && ! -f "$submodule/.git" ]]; then
    echo "ERROR: submodule '$submodule' is not initialized" >&2
    exit 1
  fi

  pinned_sha="$(git ls-tree HEAD "$submodule" | awk '{print $3}')"
  if [[ -z "$pinned_sha" ]]; then
    echo "ERROR: failed to resolve pinned SHA for '$submodule'" >&2
    exit 1
  fi

  expected_branches=()
  source_fallback_branch=""
  source_repo=""
  source_repo_display=""
  submodule_url="$(git config -f .gitmodules --get "submodule.${submodule}.url" || true)"
  if [[ -n "$submodule_url" ]]; then
    source_repo="$(parse_repo_slug_from_url "$submodule_url")"
  fi
  if [[ -n "$source_repo" ]]; then
    source_repo_display="$source_repo"
  else
    source_repo_display="${submodule} (repo slug unresolved from .gitmodules)"
  fi

  if [[ "${GITHUB_EVENT_NAME:-}" == "pull_request" ]]; then
    case "${PR_HEAD_BRANCH}->${PR_BASE_BRANCH}" in
      # Docker promotion PR is only mergeable after source repos are already promoted.
      "dev->stage")
        expected_branches=("stage" "main")
        ;;
      "stage->main")
        expected_branches=("main")
        ;;
      # For dev integration PRs, tolerate commits already promoted in forward lanes.
      *)
        if [[ "$TARGET_BRANCH" == "dev" ]]; then
          expected_branches=("dev" "stage" "main")
        else
          expected_branches=("$TARGET_BRANCH")
        fi
        if [[ "$TARGET_BRANCH" == "dev" && -n "$PR_HEAD_BRANCH" && "$PR_HEAD_BRANCH" != "$TARGET_BRANCH" ]]; then
          source_fallback_branch="$PR_HEAD_BRANCH"
        fi
        ;;
    esac
  else
    # Push/workflow validation is strict on target lanes.
    case "$TARGET_BRANCH" in
      stage)
        expected_branches=("stage" "main")
        ;;
      main)
        expected_branches=("main")
        ;;
      *)
        if [[ "$TARGET_BRANCH" == "dev" ]]; then
          expected_branches=("dev" "stage" "main")
        else
          expected_branches=("$TARGET_BRANCH")
        fi
        ;;
    esac
  fi

  found_on_expected=0
  for expected_branch in "${expected_branches[@]}"; do
    if is_pinned_on_remote_branch "$submodule" "$pinned_sha" "$expected_branch"; then
      echo "OK: $submodule pinned SHA $pinned_sha is on origin/$expected_branch"
      found_on_expected=1
      break
    fi
  done
  if [[ "$found_on_expected" -eq 1 ]]; then
    continue
  fi

  # For dev integration PRs, allow the submodule commit to come from the PR head branch
  # only when that branch also exists in the submodule repository.
  pr_head_fallback_checked=0
  if [[ -n "$source_fallback_branch" ]]; then
    if remote_branch_exists "$submodule" "$source_fallback_branch"; then
      pr_head_fallback_checked=1
      if is_pinned_on_remote_branch "$submodule" "$pinned_sha" "$source_fallback_branch"; then
        echo "OK: $submodule pinned SHA $pinned_sha is on origin/$source_fallback_branch (dev PR head fallback)"
        continue
      fi
    fi
  fi

  found_on_lanes=()
  for lane in dev stage main; do
    if is_pinned_on_any_lane "$submodule" "$pinned_sha" "$lane"; then
      found_on_lanes+=("$lane")
    fi
  done

  found_summary="none"
  if [[ ${#found_on_lanes[@]} -gt 0 ]]; then
    found_summary="${found_on_lanes[*]}"
  fi

  if [[ "$pr_head_fallback_checked" -eq 1 ]]; then
    echo "ERROR: [$submodule] pinned SHA $pinned_sha is neither on required lanes (${expected_branches[*]}) nor origin/$source_fallback_branch." >&2
  else
    echo "ERROR: [$submodule] pinned SHA $pinned_sha is not on required lanes (${expected_branches[*]}). Found on lanes: ${found_summary}." >&2
  fi

  if [[ "${GITHUB_EVENT_NAME:-}" == "pull_request" ]]; then
    case "${PR_HEAD_BRANCH}->${PR_BASE_BRANCH}" in
      "dev->stage"|"stage->main")
        pr_url="$(find_promotion_pr_url "$source_repo" "$PR_HEAD_BRANCH" "$PR_BASE_BRANCH" || true)"
        if [[ -n "$pr_url" ]]; then
          echo "ERROR: [$submodule] Awaiting source promotion merge (${PR_HEAD_BRANCH}->${PR_BASE_BRANCH}) in ${source_repo_display}: ${pr_url}" >&2
        else
          echo "ERROR: [$submodule] Awaiting source promotion merge (${PR_HEAD_BRANCH}->${PR_BASE_BRANCH}) in ${source_repo_display}. Open/merge the source PR for this lane mapping." >&2
        fi
        ;;
    esac
  fi

  overall_failed=1
done

if [[ "$overall_failed" -ne 0 ]]; then
  exit 1
fi
