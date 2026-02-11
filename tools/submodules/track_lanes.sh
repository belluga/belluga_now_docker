#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=tools/submodules/_common.sh
source "$script_dir/_common.sh"

require_git_repo
ensure_submodules_present

lane="${1:-}"
if [[ -z "$lane" ]]; then
  die "usage: $0 <dev|stage|main>"
fi
case "$lane" in
  dev|stage|main) ;;
  *) die "invalid lane '$lane' (expected: dev, stage, main)" ;;
esac

# Safety: do not stomp on local changes.
ensure_submodules_clean

root="$(repo_root)"

echo "Switching submodules to lane branches (safe; refuses if dirty)..."
echo "  lane: $lane"
echo

switch_to_remote_branch() {
  local sm="$1"
  local branch="$2"

  if ! git -C "$root/$sm" ls-remote --exit-code --heads origin "$branch" >/dev/null 2>&1; then
    echo "SKIP: $sm has no origin/$branch"
    return 0
  fi

git -C "$root/$sm" fetch origin "$branch" --quiet

  if git -C "$root/$sm" rev-parse --verify "$branch" >/dev/null 2>&1; then
    git -C "$root/$sm" switch "$branch" --quiet
  else
    git -C "$root/$sm" switch -c "$branch" --track "origin/$branch" --quiet
  fi

  echo "OK: $sm -> $branch"
}

while IFS= read -r sm; do
  if [[ ! -d "$root/$sm/.git" && ! -f "$root/$sm/.git" ]]; then
    die "submodule '$sm' is not initialized; run tools/submodules/pin_to_superproject.sh first"
  fi

  if [[ "$sm" == "foundation_documentation" ]]; then
    # Lane-agnostic docs repo for now.
    switch_to_remote_branch "$sm" "main"
  else
    switch_to_remote_branch "$sm" "$lane"
  fi
done < <(submodule_paths)

echo
echo "Result:"
print_submodule_state

echo
echo "NOTE: lane tracking is for convenience only. CI/deploy uses the superproject pins."
echo "To return to reproducible pins, run:"
echo "  tools/submodules/pin_to_superproject.sh"

