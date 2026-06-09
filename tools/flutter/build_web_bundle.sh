#!/usr/bin/env bash
set -euo pipefail

SCRIPT_SOURCE="${BASH_SOURCE[0]}"
if command -v readlink >/dev/null 2>&1; then
  SCRIPT_SOURCE="$(readlink -f "${SCRIPT_SOURCE}")"
fi
SCRIPT_DIR="$(cd -- "$(dirname -- "${SCRIPT_SOURCE}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
CANONICAL_SCRIPT="${REPO_ROOT}/delphi-ai/scripts/flutter/build_web.sh"

if [[ ! -f "${CANONICAL_SCRIPT}" ]]; then
  echo "ERROR: canonical Delphi Flutter web build script not found at ${CANONICAL_SCRIPT}." >&2
  exit 1
fi

normalize_lane_signal() {
  local signal="$1"

  signal="${signal#refs/heads/}"
  signal="${signal#refs/remotes/}"
  signal="${signal#origin/}"
  signal="${signal##*/}"
  signal="${signal,,}"
  printf '%s\n' "${signal}"
}

resolve_legacy_lane() {
  local signal lane

  for signal in \
    "${FLUTTER_WEB_LANE:-}" \
    "${DEPLOY_LANE:-}" \
    "${TARGET_BRANCH:-}" \
    "${GITHUB_REF_NAME:-}"; do
    [[ -n "${signal}" ]] || continue
    lane="$(normalize_lane_signal "${signal}")"
    case "${lane}" in
      dev|stage|main)
        printf '%s\n' "${lane}"
        return 0
        ;;
    esac
  done
  return 1
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  exec bash "${CANONICAL_SCRIPT}" "$@"
fi

output_arg="${1:-${REPO_ROOT}/web-app}"
remaining_args=()
if [[ $# -gt 0 && "${1:-}" != --* ]]; then
  shift
fi
remaining_args=("$@")

if [[ ${#remaining_args[@]} -gt 0 && "${remaining_args[0]}" != --* ]]; then
  exec bash "${CANONICAL_SCRIPT}" "${output_arg}" "${remaining_args[@]}"
fi

if ! legacy_lane="$(resolve_legacy_lane)"; then
  cat >&2 <<'EOF'
ERROR: build_web_bundle.sh could not resolve the target lane.
Provide the lane explicitly as the second positional argument or set one of:
  FLUTTER_WEB_LANE
  DEPLOY_LANE
  TARGET_BRANCH
  GITHUB_REF_NAME

Examples:
  ./tools/flutter/build_web_bundle.sh ./web-app dev
  FLUTTER_WEB_LANE=dev ./tools/flutter/build_web_bundle.sh
EOF
  exit 64
fi
exec bash "${CANONICAL_SCRIPT}" "${output_arg}" "${legacy_lane}" "${remaining_args[@]}"
