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
WEB_APP_TESTS_SOURCE_DIR="${REPO_ROOT}/tools/flutter/web_app_tests"
DEFAULT_DEFINES_FILE="${FLUTTER_APP_DIR}/config/defines/dev.json"
FLUTTER_DART_DEFINE_FILE="${FLUTTER_DART_DEFINE_FILE:-}"
LANDLORD_DOMAIN_INPUT="${LANDLORD_DOMAIN:-${NAV_LANDLORD_URL:-}}"

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
build_args=(build web --release --no-tree-shake-icons -o "${TMP_DIR}")

if [[ -z "${FLUTTER_DART_DEFINE_FILE}" && -f "${DEFAULT_DEFINES_FILE}" ]]; then
  FLUTTER_DART_DEFINE_FILE="${DEFAULT_DEFINES_FILE}"
fi

if [[ -n "${FLUTTER_DART_DEFINE_FILE}" ]]; then
  if [[ ! -f "${FLUTTER_DART_DEFINE_FILE}" ]]; then
    echo "ERROR: FLUTTER_DART_DEFINE_FILE not found: ${FLUTTER_DART_DEFINE_FILE}" >&2
    exit 1
  fi

  build_args+=("--dart-define-from-file=${FLUTTER_DART_DEFINE_FILE}")
fi

"${FLUTTER_CMD[@]}" "${build_args[@]}"

if [[ -z "${LANDLORD_DOMAIN_INPUT}" && -f "${FLUTTER_DART_DEFINE_FILE}" ]]; then
  LANDLORD_DOMAIN_INPUT="$(python3 -c 'import json,sys; data=json.load(open(sys.argv[1], encoding="utf-8")); print((data.get("LANDLORD_DOMAIN") or "").strip())' "${FLUTTER_DART_DEFINE_FILE}")"
fi

if [[ -z "${LANDLORD_DOMAIN_INPUT}" ]]; then
  echo "ERROR: LANDLORD_DOMAIN is required for web host injection. Set LANDLORD_DOMAIN or NAV_LANDLORD_URL." >&2
  exit 1
fi

landlord_host="$(python3 -c 'import sys; from urllib.parse import urlparse; p=urlparse(sys.argv[1]); assert p.scheme and p.netloc and p.hostname; print(p.hostname.lower())' "${LANDLORD_DOMAIN_INPUT}")"

if [[ ! "${landlord_host}" =~ ^[a-z0-9.-]+$ ]]; then
  echo "ERROR: invalid landlord host parsed from LANDLORD_DOMAIN (${LANDLORD_DOMAIN_INPUT}): ${landlord_host}" >&2
  exit 1
fi

short_sha="$(git rev-parse --short HEAD)"
python3 -c 'import sys,re,json; path=sys.argv[1]; host=sys.argv[2]; sha=sys.argv[3]; marker="<!-- DELPHI_INJECT__LANDLORD_HOST__ -->"; inject=f"<script>window.__LANDLORD_HOST__ = {json.dumps(host)}; window.__WEB_BUILD_SHA__ = {json.dumps(sha)};</script>"; s=open(path,"r",encoding="utf-8").read(); s=s.replace(marker,inject,1) if marker in s else re.sub(r"(<head[^>]*>)", lambda m: m.group(1)+"\n  "+inject, s, count=1, flags=re.I); open(path,"w",encoding="utf-8").write(s)' "${TMP_DIR}/index.html" "${landlord_host}" "${short_sha}"

if ! grep -Fq 'window.__LANDLORD_HOST__ = "' "${TMP_DIR}/index.html"; then
  echo "ERROR: __LANDLORD_HOST__ injection missing or malformed in generated index.html." >&2
  exit 1
fi

if grep -Fq 'window.__LANDLORD_HOST__ = \"' "${TMP_DIR}/index.html"; then
  echo "ERROR: __LANDLORD_HOST__ injection contains escaped quotes (\\\"); expected plain JS quotes." >&2
  exit 1
fi
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

# Tests in web-app are derived from source files in this repository.
if [[ -d "${WEB_APP_TESTS_SOURCE_DIR}" ]]; then
  mkdir -p "${OUTPUT_DIR}/tests"
  rsync -a --delete "${WEB_APP_TESTS_SOURCE_DIR}/" "${OUTPUT_DIR}/tests/"
fi

chmod -R a+rX "${OUTPUT_DIR}"

echo "Flutter web bundle synced safely at: ${OUTPUT_DIR}"
