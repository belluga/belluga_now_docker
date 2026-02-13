#!/usr/bin/env bash
set -euo pipefail

TARGET_BRANCH="${1:-${GITHUB_REF_NAME:-}}"
if [[ -z "$TARGET_BRANCH" ]]; then
  echo "ERROR: target branch is required" >&2
  exit 1
fi

SUBMODULES=(flutter-app laravel-app web-app)
PR_HEAD_BRANCH="${GITHUB_HEAD_REF:-}"
PR_BASE_BRANCH="${GITHUB_BASE_REF:-}"

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

  if [[ "${GITHUB_EVENT_NAME:-}" == "pull_request" ]]; then
    case "${PR_HEAD_BRANCH}->${PR_BASE_BRANCH}" in
      # Promotion PR: source lane is dev; if already promoted to stage/main, it is a no-op and should pass.
      "dev->stage")
        expected_branches=("dev" "stage" "main")
        ;;
      # Promotion PR: source lane is stage; if already promoted to main, it is a no-op and should pass.
      "stage->main")
        expected_branches=("stage" "main")
        ;;
      # Lane-scoped bot sync into stage/main should validate against the target lane (plus no-op allowance for stage->main).
      "bot/submodule-sync-stage->stage")
        expected_branches=("stage" "main")
        ;;
      "bot/submodule-sync-main->main")
        expected_branches=("main")
        ;;
      # For normal integration PRs (typically into dev), keep target-lane validation and allow PR-head fallback.
      *)
        expected_branches=("$TARGET_BRANCH")
        if [[ "$TARGET_BRANCH" == "dev" ]] && ! remote_branch_exists "$submodule" "dev"; then
          expected_branches+=("main")
        fi
        if [[ "$TARGET_BRANCH" == "dev" && -n "$PR_HEAD_BRANCH" && "$PR_HEAD_BRANCH" != "$TARGET_BRANCH" ]]; then
          source_fallback_branch="$PR_HEAD_BRANCH"
        fi
        ;;
    esac
  else
    # Push/workflow validation stays lane-based.
    expected_branches=("$TARGET_BRANCH")
    if [[ "$TARGET_BRANCH" == "dev" ]] && ! remote_branch_exists "$submodule" "dev"; then
      expected_branches+=("main")
    fi
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

  if [[ "$pr_head_fallback_checked" -eq 1 ]]; then
    echo "ERROR: $submodule pinned SHA $pinned_sha is neither on expected lanes (${expected_branches[*]}) nor origin/$source_fallback_branch" >&2
  else
    echo "ERROR: $submodule pinned SHA $pinned_sha is not on expected lanes (${expected_branches[*]})" >&2
  fi
  exit 1
done
