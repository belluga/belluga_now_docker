#!/usr/bin/env bash
set -euo pipefail

SCRIPT_SOURCE="${BASH_SOURCE[0]}"
if command -v readlink >/dev/null 2>&1; then
  SCRIPT_SOURCE="$(readlink -f "${SCRIPT_SOURCE}")"
fi
SCRIPT_DIR="$(cd -- "$(dirname -- "${SCRIPT_SOURCE}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"

FLUTTER_APP_DIR="${REPO_ROOT}/flutter-app"
OUTPUT_DIR="${1:-${REPO_ROOT}/web-app}"

if [[ ! -f "${FLUTTER_APP_DIR}/pubspec.yaml" ]]; then
  echo "ERROR: flutter-app submodule not found at ${FLUTTER_APP_DIR}." >&2
  exit 1
fi

if command -v fvm >/dev/null 2>&1; then
  FLUTTER_CMD=(fvm flutter)
elif command -v flutter >/dev/null 2>&1; then
  FLUTTER_CMD=(flutter)
else
  echo "ERROR: neither 'fvm' nor 'flutter' command is available." >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

pushd "${FLUTTER_APP_DIR}" >/dev/null
"${FLUTTER_CMD[@]}" pub get
"${FLUTTER_CMD[@]}" build web --release --no-tree-shake-icons -o "${TMP_DIR}"
popd >/dev/null

# Served by backend and should not live in web-app submodule.
rm -f "${TMP_DIR}/favicon.ico" "${TMP_DIR}/manifest.json" "${TMP_DIR}/.last_build_id"
rm -rf "${TMP_DIR}/icons"

mkdir -p "${OUTPUT_DIR}"

# Keep repository governance files while replacing only generated bundle assets.
rsync -a --delete \
  --exclude '.git' --exclude '.git/' --exclude '.gitmodules' --exclude '.last_build_id' \
  --filter='P .github/' \
  --filter='P .gitignore' \
  --filter='P package.json' \
  --filter='P package-lock.json' \
  --filter='P playwright.config.js' \
  --filter='P tests/' \
  "${TMP_DIR}/" "${OUTPUT_DIR}/"

chmod -R a+rX "${OUTPUT_DIR}"

echo "Flutter web bundle synced safely at: ${OUTPUT_DIR}"
