#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
CANONICAL_SCRIPT="${REPO_ROOT}/delphi-ai/tools/submodule_workspace_pin.sh"

exec bash "${CANONICAL_SCRIPT}" "$@"
