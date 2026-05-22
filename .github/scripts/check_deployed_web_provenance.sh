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
expected_flutter_sha_override="$(printf '%s' "${EXPECTED_FLUTTER_SHA:-}" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"
expected_flutter_sha_source="local-checkout"
if [[ -n "${expected_flutter_sha_override}" ]]; then
  expected_flutter_sha="${expected_flutter_sha_override}"
  expected_web_sha=""
  expected_flutter_sha_source="override"
else
  expected_flutter_sha="$(git -C "${repo_root}/flutter-app" rev-parse HEAD 2>/dev/null | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]' || true)"
  expected_web_sha="$(git -C "${repo_root}/web-app" rev-parse HEAD 2>/dev/null | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]' || true)"
fi

if [[ -z "${expected_flutter_sha}" ]]; then
  if [[ "${expected_flutter_sha_source}" == "override" ]]; then
    echo "ERROR: EXPECTED_FLUTTER_SHA override was provided but empty after normalization." >&2
  else
    echo "ERROR: could not resolve expected flutter-app SHA from checked out submodules." >&2
  fi
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
probe_base_url="${landlord}"

curl_args=(
  -sS
  -m 20
  -H "Accept: application/json"
  -H "Cache-Control: no-cache, no-store, max-age=0"
  -H "Pragma: no-cache"
)

provenance_max_attempts="${NAV_PROVENANCE_MAX_ATTEMPTS:-3}"
provenance_sleep_seconds="${NAV_PROVENANCE_SLEEP_SECONDS:-5}"
validation_max_attempts="${NAV_PROVENANCE_VALIDATION_MAX_ATTEMPTS:-6}"
validation_sleep_seconds="${NAV_PROVENANCE_VALIDATION_SLEEP_SECONDS:-5}"

if [[ -n "${NAV_ORIGIN_IP:-}" ]]; then
  probe_base_url="http://${NAV_ORIGIN_IP}"
  curl_args+=(-H "Host: ${landlord_host}")
  echo "INFO: validating deployed web provenance via origin ${NAV_ORIGIN_IP} over HTTP host-header probe (host ${landlord_host})."
else
  echo "INFO: validating deployed web provenance via public DNS (host ${landlord_host})."
fi

metadata_url="${probe_base_url}/build_metadata.json?_ci_probe=${cache_key}"
fetch_with_retries() {
  local url="$1"
  local output_file="$2"
  local label="$3"
  local status=""
  local attempt

  for attempt in $(seq 1 "${provenance_max_attempts}"); do
    if status="$(curl "${curl_args[@]}" -o "${output_file}" -w '%{http_code}' "${url}")"; then
      printf '%s' "${status}"
      return 0
    fi

    if [[ "${attempt}" -lt "${provenance_max_attempts}" ]]; then
      echo "WARN: ${label} fetch attempt ${attempt}/${provenance_max_attempts} failed; retrying in ${provenance_sleep_seconds}s..." >&2
      sleep "${provenance_sleep_seconds}"
    fi
  done

  echo "ERROR: ${label} fetch failed after ${provenance_max_attempts} attempt(s)." >&2
  return 1
}

validate_deployed_provenance_once() {
  local status=""
  local actual_flutter_sha=""
  local source_branch=""
  local metadata_match_mode=""
  local actual_flutter_full_sha=""
  local lane_defines_file=""
  local expected_landlord_host=""
  local index_status=""
  local actual_landlord_host=""

  status="$(fetch_with_retries "${metadata_url}" "${metadata_file}" "deployed build metadata")"
  if [[ ! "${status}" =~ ^[0-9]+$ ]]; then
    echo "ERROR: invalid HTTP status while reading deployed build metadata: '${status}'." >&2
    return 1
  fi

  if (( status >= 400 )); then
    echo "ERROR: could not fetch deployed build metadata (${metadata_url}); HTTP ${status}." >&2
    cat "${metadata_file}" >&2 || true
    return 1
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
    return 1
  fi

  if [[ "${lane}" == "stage" && -z "${source_branch}" ]]; then
    echo "ERROR: deployed build metadata is missing 'source_branch' (${metadata_url})." >&2
    cat "${metadata_file}" >&2 || true
    return 1
  fi

  if [[ "${lane}" == "stage" && "${source_branch}" != "${lane}" ]]; then
    echo "ERROR: deployed build metadata source branch mismatch for lane '${lane}'." >&2
    echo "Expected build_metadata.source_branch: ${lane}" >&2
    echo "Actual deployed build_metadata.source_branch: ${source_branch}" >&2
    echo "Metadata URL: ${metadata_url}" >&2
    cat "${metadata_file}" >&2 || true
    return 1
  fi

  if [[ "${lane}" == "main" && -z "${source_branch}" ]]; then
    echo "INFO: deployed build metadata source_branch is missing for main; main acceptance uses flutter_git_sha and host compatibility."
  fi

  if [[ "${actual_flutter_sha}" =~ ^[0-9a-f]{40}$ ]]; then
    actual_flutter_full_sha="${actual_flutter_sha}"
  else
    git -C "${repo_root}/flutter-app" fetch origin "${lane}" --quiet || true
    actual_flutter_full_sha="$(git -C "${repo_root}/flutter-app" rev-parse --verify "${actual_flutter_sha}^{commit}" 2>/dev/null | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]' || true)"
  fi

  if sha_matches "${expected_flutter_sha}" "${actual_flutter_sha}"; then
    metadata_match_mode="exact-or-prefix"
  else
    if [[ -n "${actual_flutter_full_sha}" ]]; then
      git -C "${repo_root}/flutter-app" fetch origin "${actual_flutter_full_sha}" --quiet || true
      if git -C "${repo_root}/flutter-app" merge-base --is-ancestor "${expected_flutter_sha}" "${actual_flutter_full_sha}" 2>/dev/null; then
        metadata_match_mode="descendant"
      fi
    fi
  fi

  if [[ -z "${metadata_match_mode}" ]]; then
    echo "ERROR: deployed flutter sha mismatch for lane '${lane}'." >&2
    echo "Expected flutter-app SHA (${expected_flutter_sha_source}): ${expected_flutter_sha}" >&2
    echo "Actual deployed build_metadata.flutter_git_sha: ${actual_flutter_sha}" >&2
    if [[ -n "${expected_web_sha}" ]]; then
      echo "Expected web-app gitlink (diagnostic): ${expected_web_sha}" >&2
    fi
    if [[ -n "${source_branch}" ]]; then
      echo "Deployed build_metadata.source_branch: ${source_branch}" >&2
    fi
    echo "Metadata URL: ${metadata_url}" >&2
    cat "${metadata_file}" >&2 || true
    return 1
  fi

  lane_defines_file="${repo_root}/flutter-app/config/defines/${lane}.json"
  if [[ ! -f "${lane_defines_file}" ]]; then
    echo "ERROR: lane defines file not found for '${lane}': ${lane_defines_file}" >&2
    return 1
  fi

  expected_landlord_host="$(
    python3 - <<'PY' "${lane_defines_file}"
import json
import sys
from urllib.parse import urlparse

with open(sys.argv[1], "r", encoding="utf-8") as fp:
    payload = json.load(fp)

domain = str(payload.get("LANDLORD_DOMAIN") or "").strip()
host = (urlparse(domain).hostname or "").strip().lower()
print(host)
PY
  )"
  expected_landlord_host="$(echo "${expected_landlord_host}" | tr -d '[:space:]')"
  if [[ -z "${expected_landlord_host}" ]]; then
    echo "ERROR: could not resolve expected landlord host from ${lane_defines_file}." >&2
    return 1
  fi

  index_file="/tmp/${lane}_deployed_index.html"
  index_url="${probe_base_url}/index.html?_ci_probe=${cache_key}"
  index_status="$(fetch_with_retries "${index_url}" "${index_file}" "deployed index")"
  if [[ ! "${index_status}" =~ ^[0-9]+$ ]]; then
    echo "ERROR: invalid HTTP status while reading deployed index: '${index_status}'." >&2
    return 1
  fi
  if (( index_status >= 400 )); then
    echo "ERROR: could not fetch deployed index (${index_url}); HTTP ${index_status}." >&2
    cat "${index_file}" >&2 || true
    return 1
  fi

  actual_landlord_host="$(
    python3 - <<'PY' "${index_file}"
import re
import sys

html = open(sys.argv[1], "r", encoding="utf-8").read()
match = re.search(r"window\.__LANDLORD_HOST__\s*=\s*['\"]([^'\"]+)['\"]", html)
print((match.group(1) if match else "").strip().lower())
PY
  )"
  actual_landlord_host="$(echo "${actual_landlord_host}" | tr -d '[:space:]')"
  if [[ -z "${actual_landlord_host}" ]]; then
    echo "ERROR: deployed web index is missing window.__LANDLORD_HOST__ injection (${index_url})." >&2
    return 1
  fi

  if [[ "${actual_landlord_host}" != "${expected_landlord_host}" ]]; then
    echo "ERROR: deployed landlord host mismatch for lane '${lane}'." >&2
    echo "Expected lane host (${lane_defines_file}): ${expected_landlord_host}" >&2
    echo "Actual deployed window.__LANDLORD_HOST__: ${actual_landlord_host}" >&2
    echo "Index URL: ${index_url}" >&2
    return 1
  fi

  echo "OK: deployed flutter sha matches expected lane gitlink for '${lane}' via ${metadata_match_mode}."
  echo "Expected flutter-app SHA (${expected_flutter_sha_source}): ${expected_flutter_sha}"
  echo "Deployed build_metadata.flutter_git_sha: ${actual_flutter_sha}"
  echo "Deployed build_metadata.source_branch: ${source_branch}"
  echo "Expected lane landlord host: ${expected_landlord_host}"
  echo "Deployed window.__LANDLORD_HOST__: ${actual_landlord_host}"
  if [[ -n "${expected_web_sha}" ]]; then
    echo "Expected web-app gitlink (diagnostic): ${expected_web_sha}"
  fi
}

validation_stdout="$(mktemp)"
validation_stderr="$(mktemp)"
cleanup_validation_artifacts() {
  rm -f "${validation_stdout}" "${validation_stderr}"
}
trap cleanup_validation_artifacts EXIT

attempt=1
while (( attempt <= validation_max_attempts )); do
  if validate_deployed_provenance_once >"${validation_stdout}" 2>"${validation_stderr}"; then
    cat "${validation_stdout}"
    exit 0
  fi

  if (( attempt == validation_max_attempts )); then
    cat "${validation_stderr}" >&2 || true
    exit 1
  fi

  echo "WARN: deployed web provenance validation attempt ${attempt}/${validation_max_attempts} did not converge yet; retrying in ${validation_sleep_seconds}s..." >&2
  cat "${validation_stderr}" >&2 || true
  sleep "${validation_sleep_seconds}"
  : > "${validation_stdout}"
  : > "${validation_stderr}"
  (( attempt += 1 ))
done
