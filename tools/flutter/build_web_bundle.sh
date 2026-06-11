#!/usr/bin/env bash
set -euo pipefail

SCRIPT_SOURCE="${BASH_SOURCE[0]}"
if command -v readlink >/dev/null 2>&1; then
  SCRIPT_SOURCE="$(readlink -f "${SCRIPT_SOURCE}")"
fi
SCRIPT_DIR="$(cd -- "$(dirname -- "${SCRIPT_SOURCE}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
CANONICAL_SCRIPT="${REPO_ROOT}/delphi-ai/scripts/flutter/build_web.sh"
DEFINE_DIR="${REPO_ROOT}/flutter-app/config/defines"

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
    [[ -n "${lane}" ]] || continue
    if [[ -f "${DEFINE_DIR}/${lane}.json" ]]; then
      printf '%s\n' "${lane}"
      return 0
    fi
  done
  return 1
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'EOF'
Usage:
  ./tools/flutter/build_web_bundle.sh [output_dir] [lane] [--no-preserve] [--clean-output]

Wrapper behavior:
  - If [lane] is passed explicitly, it is forwarded to the canonical Flutter build script.
  - If FLUTTER_DART_DEFINE_FILE is set, that explicit define file is used.
  - Otherwise the wrapper resolves the lane from FLUTTER_WEB_LANE, DEPLOY_LANE,
    TARGET_BRANCH, or GITHUB_REF_NAME, as long as flutter-app/config/defines/<lane>.json exists.

Examples:
  ./tools/flutter/build_web_bundle.sh ./web-app dev
  FLUTTER_WEB_LANE=integration.tenant ./tools/flutter/build_web_bundle.sh
  FLUTTER_DART_DEFINE_FILE=/abs/path/to/defines.json ./tools/flutter/build_web_bundle.sh
EOF
  exit 0
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

if [[ -n "${FLUTTER_DART_DEFINE_FILE:-}" ]]; then
  if [[ ! -f "${FLUTTER_DART_DEFINE_FILE}" ]]; then
    echo "Explicit define file not found: ${FLUTTER_DART_DEFINE_FILE}" >&2
    exit 64
  fi
  # Keep the explicit define-file environment authoritative for the canonical
  # builder. The basename lane only preserves the canonical positional shape so
  # downstream option parsing still works when callers pass --clean-output or
  # --no-preserve through this wrapper.
  export FLUTTER_DART_DEFINE_FILE
  define_lane="$(basename "${FLUTTER_DART_DEFINE_FILE}")"
  define_lane="${define_lane%.json}"
  exec bash "${CANONICAL_SCRIPT}" "${output_arg}" "${define_lane}" "${remaining_args[@]}"
fi

if ! legacy_lane="$(resolve_legacy_lane)"; then
  cat >&2 <<'EOF'
ERROR: build_web_bundle.sh could not resolve the target lane.
Provide the lane explicitly as the second positional argument, set FLUTTER_DART_DEFINE_FILE,
or set one of the lane signals that resolves to an existing flutter-app/config/defines/<lane>.json:
  FLUTTER_WEB_LANE
  DEPLOY_LANE
  TARGET_BRANCH
  GITHUB_REF_NAME

Examples:
  ./tools/flutter/build_web_bundle.sh ./web-app dev
  FLUTTER_WEB_LANE=integration.tenant ./tools/flutter/build_web_bundle.sh
  FLUTTER_DART_DEFINE_FILE=/abs/path/to/defines.json ./tools/flutter/build_web_bundle.sh
  FLUTTER_WEB_LANE=dev ./tools/flutter/build_web_bundle.sh
EOF
  exit 64
fi
exec bash "${CANONICAL_SCRIPT}" "${output_arg}" "${legacy_lane}" "${remaining_args[@]}"
