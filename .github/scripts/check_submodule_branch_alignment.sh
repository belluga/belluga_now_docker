#!/usr/bin/env bash
set -euo pipefail

TARGET_BRANCH="${1:-${GITHUB_REF_NAME:-}}"
if [[ -z "$TARGET_BRANCH" ]]; then
  echo "ERROR: target branch is required" >&2
  exit 1
fi

SUBMODULES=(flutter-app laravel-app web-app)
PR_HEAD_BRANCH="${GITHUB_HEAD_REF:-}"

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

  expected_branch="$TARGET_BRANCH"
  if is_pinned_on_remote_branch "$submodule" "$pinned_sha" "$expected_branch"; then
    echo "OK: $submodule pinned SHA $pinned_sha is on origin/$expected_branch"
    continue
  fi

  # For dev PR validation, allow the submodule commit to come from the PR head branch
  # so cross-repo CI branches can be validated before merging into dev.
  if [[ "$TARGET_BRANCH" == "dev" && -n "$PR_HEAD_BRANCH" && "$PR_HEAD_BRANCH" != "$expected_branch" ]]; then
    if is_pinned_on_remote_branch "$submodule" "$pinned_sha" "$PR_HEAD_BRANCH"; then
      echo "OK: $submodule pinned SHA $pinned_sha is on origin/$PR_HEAD_BRANCH (dev PR head fallback)"
      continue
    fi
  fi

  if [[ "$TARGET_BRANCH" == "dev" && -n "$PR_HEAD_BRANCH" && "$PR_HEAD_BRANCH" != "$expected_branch" ]]; then
    echo "ERROR: $submodule pinned SHA $pinned_sha is neither on origin/$expected_branch nor origin/$PR_HEAD_BRANCH" >&2
  else
    echo "ERROR: $submodule pinned SHA $pinned_sha is not on origin/$expected_branch" >&2
  fi
  exit 1
done
