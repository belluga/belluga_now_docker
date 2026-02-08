#!/usr/bin/env bash
set -euo pipefail

TARGET_BRANCH="${1:-${GITHUB_REF_NAME:-}}"
if [[ -z "$TARGET_BRANCH" ]]; then
  echo "ERROR: target branch is required" >&2
  exit 1
fi

SUBMODULES=(flutter-app laravel-app web-app)

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

  if ! git -C "$submodule" fetch origin "$expected_branch" --quiet; then
    echo "ERROR: failed to fetch origin/$expected_branch for '$submodule'" >&2
    exit 1
  fi

  if ! git -C "$submodule" rev-parse --verify "origin/$expected_branch" >/dev/null 2>&1; then
    echo "ERROR: '$submodule' does not have branch 'origin/$expected_branch'" >&2
    exit 1
  fi

  if git -C "$submodule" merge-base --is-ancestor "$pinned_sha" "origin/$expected_branch"; then
    echo "OK: $submodule pinned SHA $pinned_sha is on origin/$expected_branch"
  else
    echo "ERROR: $submodule pinned SHA $pinned_sha is not on origin/$expected_branch" >&2
    exit 1
  fi
done
