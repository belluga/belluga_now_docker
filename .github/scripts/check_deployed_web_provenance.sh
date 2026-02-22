#!/usr/bin/env bash
set -euo pipefail

lane="${1:-${DEPLOY_LANE:-}}"
if [[ -z "${lane}" ]]; then
  echo "ERROR: usage: DEPLOY_LANE=<stage|main> NAV_LANDLORD_URL=<url> [NAV_ORIGIN_IP=<ip>] $0 [lane]" >&2
  exit 1
fi

nav_landlord_url="${NAV_LANDLORD_URL:-}"
if [[ -z "${nav_landlord_url}" ]]; then
  echo "ERROR: NAV_LANDLORD_URL is required." >&2
  exit 1
fi

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
expected_flutter_sha="$(git -C "${repo_root}/flutter-app" rev-parse HEAD 2>/dev/null | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]' || true)"
expected_web_sha="$(git -C "${repo_root}/web-app" rev-parse HEAD 2>/dev/null | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]' || true)"

if [[ -z "${expected_flutter_sha}" ]]; then
  echo "ERROR: could not resolve expected flutter-app SHA from checked out submodules." >&2
  exit 1
fi

sha_matches() {
  local expected="$1"
  local actual="$2"
  [[ "${expected}" == "${actual}" ]] && return 0
  [[ "${expected}" == "${actual}"* ]] && return 0
  [[ "${actual}" == "${expected}"* ]] && return 0
  return 1
}

landlord="${nav_landlord_url%/}"
landlord_host="$(python3 -c 'import sys, urllib.parse; print((urllib.parse.urlparse(sys.argv[1]).hostname or "").strip())' "${landlord}")"
if [[ -z "${landlord_host}" ]]; then
  echo "ERROR: could not parse landlord host from NAV_LANDLORD_URL='${nav_landlord_url}'." >&2
  exit 1
fi

metadata_file="/tmp/${lane}_deployed_build_metadata.json"
cache_key="${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}-$(date +%s)"
metadata_url="${landlord}/build_metadata.json?_ci_probe=${cache_key}"

curl_args=(
  -sS
  -m 20
  -H "Accept: application/json"
  -H "Cache-Control: no-cache, no-store, max-age=0"
  -H "Pragma: no-cache"
)

if [[ -n "${NAV_ORIGIN_IP:-}" ]]; then
  curl_args+=(--resolve "${landlord_host}:443:${NAV_ORIGIN_IP}" --insecure)
  echo "INFO: validating deployed web provenance via origin ${NAV_ORIGIN_IP} (host ${landlord_host})."
else
  echo "INFO: validating deployed web provenance via public DNS (host ${landlord_host})."
fi

status="$(curl "${curl_args[@]}" -o "${metadata_file}" -w '%{http_code}' "${metadata_url}")"
if [[ ! "${status}" =~ ^[0-9]+$ ]]; then
  echo "ERROR: invalid HTTP status while reading deployed build metadata: '${status}'." >&2
  exit 1
fi

if (( status >= 400 )); then
  echo "ERROR: could not fetch deployed build metadata (${metadata_url}); HTTP ${status}." >&2
  cat "${metadata_file}" >&2 || true
  exit 1
fi

actual_flutter_sha="$(
  python3 - <<'PY' "${metadata_file}"
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
raw = path.read_text(encoding="utf-8")
payload = json.loads(raw)
value = str(payload.get("flutter_git_sha") or "").strip().lower()
print(value)
PY
)"
actual_flutter_sha="$(echo "${actual_flutter_sha}" | tr -d '[:space:]')"

source_branch="$(
  python3 - <<'PY' "${metadata_file}"
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
raw = path.read_text(encoding="utf-8")
payload = json.loads(raw)
value = str(payload.get("source_branch") or "").strip()
print(value)
PY
)"
source_branch="$(echo "${source_branch}" | tr -d '[:space:]')"

if [[ -z "${actual_flutter_sha}" ]]; then
  echo "ERROR: deployed build metadata is missing 'flutter_git_sha' (${metadata_url})." >&2
  cat "${metadata_file}" >&2 || true
  exit 1
fi

if ! sha_matches "${expected_flutter_sha}" "${actual_flutter_sha}"; then
  echo "ERROR: deployed flutter sha mismatch for lane '${lane}'." >&2
  echo "Expected flutter-app gitlink: ${expected_flutter_sha}" >&2
  echo "Actual deployed build_metadata.flutter_git_sha: ${actual_flutter_sha}" >&2
  if [[ -n "${expected_web_sha}" ]]; then
    echo "Expected web-app gitlink (diagnostic): ${expected_web_sha}" >&2
  fi
  if [[ -n "${source_branch}" ]]; then
    echo "Deployed build_metadata.source_branch: ${source_branch}" >&2
  fi
  echo "Metadata URL: ${metadata_url}" >&2
  cat "${metadata_file}" >&2 || true
  exit 1
fi

echo "OK: deployed flutter sha matches expected lane gitlink for '${lane}'."
echo "Expected flutter-app gitlink: ${expected_flutter_sha}"
echo "Deployed build_metadata.flutter_git_sha: ${actual_flutter_sha}"
if [[ -n "${source_branch}" ]]; then
  echo "Deployed build_metadata.source_branch: ${source_branch}"
fi
if [[ -n "${expected_web_sha}" ]]; then
  echo "Expected web-app gitlink (diagnostic): ${expected_web_sha}"
fi
