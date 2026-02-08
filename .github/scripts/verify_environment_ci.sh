#!/usr/bin/env bash
set -euo pipefail

required_files=(
  ".gitmodules"
  "docker-compose.yml"
  ".github/scripts/check_promotion_lane.sh"
  ".github/scripts/check_submodule_branch_alignment.sh"
  ".github/scripts/check_web_flutter_metadata.sh"
)

for file in "${required_files[@]}"; do
  if [[ ! -f "$file" ]]; then
    echo "ERROR: required file missing: $file" >&2
    exit 1
  fi
done

required_submodules=(flutter-app laravel-app web-app)

for submodule in "${required_submodules[@]}"; do
  if ! grep -Eq "path[[:space:]]*=[[:space:]]*$submodule" .gitmodules; then
    echo "ERROR: .gitmodules missing required submodule path '$submodule'" >&2
    exit 1
  fi

  if [[ ! -d "$submodule" ]]; then
    echo "ERROR: expected checkout directory for submodule '$submodule' not found" >&2
    exit 1
  fi
done

echo "OK: CI environment invariants validated."
