#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=tools/submodules/_common.sh
source "$script_dir/_common.sh"

require_git_repo
ensure_submodules_present
print_submodule_state

