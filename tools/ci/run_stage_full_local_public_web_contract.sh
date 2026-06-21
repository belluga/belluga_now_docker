#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

usage() {
  cat >&2 <<'EOF'
Usage: bash tools/ci/run_stage_full_local_public_web_contract.sh <prepare|readonly|mutation>

Deprecated compatibility shim.
Use `bash tools/ci/run_stage_browser_contract.sh local-public <step>` instead.
EOF
}

main() {
  if [[ $# -ne 1 ]]; then
    usage
    exit 2
  fi

  case "$1" in
    prepare)
      exec bash "${ROOT_DIR}/tools/ci/run_stage_browser_contract.sh" local-public build
      ;;
    readonly)
      exec bash "${ROOT_DIR}/tools/ci/run_stage_browser_contract.sh" local-public readonly
      ;;
    mutation)
      exec bash "${ROOT_DIR}/tools/ci/run_stage_browser_contract.sh" local-public mutation
      ;;
    *)
      usage
      exit 2
      ;;
  esac
}

main "$@"
