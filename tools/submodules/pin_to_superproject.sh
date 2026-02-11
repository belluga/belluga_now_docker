#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=tools/submodules/_common.sh
source "$script_dir/_common.sh"

require_git_repo
ensure_submodules_present

# Safety: never override local edits.
ensure_submodules_clean

root="$(repo_root)"

echo "Pinning submodules to the exact SHAs recorded by the superproject (non-destructive)..."
echo "NOTE: This does NOT use --force and will refuse to proceed if any submodule is dirty."
echo

git -C "$root" submodule sync --recursive
git -C "$root" submodule update --init --recursive

echo
echo "Result:"
git -C "$root" submodule status

echo
echo "OK: submodules pinned. If you now want convenience lane tracking, run:"
echo "  tools/submodules/track_lanes.sh <dev|stage|main>"

