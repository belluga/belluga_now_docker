#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FLUTTER_DIR="${ROOT_DIR}/flutter-app"

define_file="${STAGE_INVITE_DEFINE_FILE:-config/defines/stage.json}"
output_dir="${STAGE_INVITE_OUTPUT_DIR:-${ROOT_DIR}/foundation_documentation/artifacts/tmp/stage-invite-compatibility}"
package_name="${STAGE_INVITE_PACKAGE_NAME:-com.guarappari.app}"
device="${STAGE_INVITE_DEVICE:-linux}"

if [[ -z "${STAGE_TENANT_URL:-}" ]]; then
  echo "ERROR: missing STAGE_TENANT_URL for stage invite compatibility." >&2
  exit 1
fi

if [[ -z "${STAGE_INVITE_TEST_SUPPORT_SECRET:-}" ]]; then
  echo "ERROR: missing STAGE_INVITE_TEST_SUPPORT_SECRET for stage invite compatibility." >&2
  exit 1
fi

mkdir -p "${output_dir}"

pushd "${FLUTTER_DIR}" >/dev/null
export PATH="${HOME}/.pub-cache/bin:${PATH}"

echo "Running stage invite compatibility suite"
echo "  Tenant URL: ${STAGE_TENANT_URL}"
echo "  Defines: ${define_file}"
echo "  Output dir: ${output_dir}"
echo "  Device: ${device}"

flutter_cmd=(
  fvm flutter test
  integration_test/feature_invite_stage_compatibility_test.dart
  -d "${device}"
  -r compact
  --dart-define-from-file="${define_file}"
  --dart-define="STAGE_TENANT_URL=${STAGE_TENANT_URL}"
  --dart-define="STAGE_INVITE_TEST_SUPPORT_SECRET=${STAGE_INVITE_TEST_SUPPORT_SECRET}"
  --dart-define="STAGE_INVITE_PACKAGE_NAME=${package_name}"
)

if [[ "${device}" == "linux" && -z "${DISPLAY:-}" ]]; then
  if ! command -v xvfb-run >/dev/null 2>&1; then
    echo "ERROR: xvfb-run is required for headless linux stage invite compatibility runs." >&2
    exit 1
  fi
  flutter_cmd=(xvfb-run -a "${flutter_cmd[@]}")
fi

"${flutter_cmd[@]}" 2>&1 | tee "${output_dir}/flutter-stage-invite-compatibility.log"

popd >/dev/null
