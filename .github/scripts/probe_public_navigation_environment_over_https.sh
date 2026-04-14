#!/usr/bin/env bash
set -euo pipefail

lane="${1:-}"
if [[ -z "$lane" ]]; then
  echo "Usage: $0 <lane>" >&2
  exit 1
fi

required_envs=(NAV_LANDLORD_URL NAV_TENANT_URL)
for env_name in "${required_envs[@]}"; do
  if [[ -z "${!env_name:-}" ]]; then
    echo "ERROR: missing required env ${env_name}." >&2
    exit 1
  fi
done

if [[ -n "${NAV_ORIGIN_IP:-}" ]]; then
  echo "INFO: NAV_ORIGIN_IP is set but ignored for public-edge probe (${NAV_ORIGIN_IP})."
fi

max_attempts="${NAV_PUBLIC_EDGE_MAX_ATTEMPTS:-6}"
sleep_seconds="${NAV_PUBLIC_EDGE_SLEEP_SECONDS:-5}"

probe_environment() {
  local target_url="$1"
  local target_name="$2"
  local expected_type="$3"
  local body_file="/tmp/${lane}_public_edge_${target_name}.json"

  for attempt in $(seq 1 "$max_attempts"); do
    status="$(
      curl -sS -m 20 \
        -H 'Accept: application/json' \
        -H 'Cache-Control: no-cache, no-store, max-age=0' \
        -H 'Pragma: no-cache' \
        -o "$body_file" \
        -w '%{http_code}' \
        "$target_url" || true
    )"

    if [[ "$status" =~ ^2[0-9][0-9]$ ]]; then
      response_type="$(
        python3 - <<'PY' "$body_file"
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
raw = path.read_text(encoding="utf-8")

try:
    payload = json.loads(raw)
except Exception:
    print("")
    raise SystemExit(0)

type_value = ""
if isinstance(payload, dict):
    if isinstance(payload.get("type"), str):
        type_value = payload.get("type", "")
    elif isinstance(payload.get("data"), dict) and isinstance(payload["data"].get("type"), str):
        type_value = payload["data"].get("type", "")

print(type_value.strip().lower())
PY
      )"

      if [[ "$response_type" == "$expected_type" ]]; then
        echo "INFO: ${lane} public-edge ${target_name} succeeded (attempt ${attempt}/${max_attempts}) with type=${response_type}."
        return 0
      fi

      echo "WARN: ${lane} public-edge ${target_name} returned HTTP ${status} with unexpected type '${response_type}' (expected '${expected_type}') on attempt ${attempt}/${max_attempts}."
    else
      echo "WARN: ${lane} public-edge ${target_name} attempt ${attempt}/${max_attempts} returned HTTP ${status}."
    fi

    if [[ "$attempt" -lt "$max_attempts" ]]; then
      sleep "$sleep_seconds"
    fi
  done

  echo "ERROR: ${lane} public-edge ${target_name} probe failed after ${max_attempts} attempts (${target_url})." >&2
  cat "$body_file" >&2 || true
  return 1
}

probe_binary_contract() {
  local target_url="$1"
  local target_name="$2"
  local body_file="/tmp/${lane}_public_edge_${target_name}.bin"
  local headers_file="/tmp/${lane}_public_edge_${target_name}.headers"
  local status content_type html_fallback

  for attempt in $(seq 1 "$max_attempts"); do
    status="$(
      curl -sS -m 20 \
        -H 'Cache-Control: no-cache, no-store, max-age=0' \
        -H 'Pragma: no-cache' \
        -D "$headers_file" \
        -o "$body_file" \
        -w '%{http_code}' \
        "$target_url" || true
    )"

    if [[ "$status" =~ ^2[0-9][0-9]$ ]]; then
      content_type="$(
        python3 - <<'PY' "$headers_file"
import sys
from pathlib import Path

headers = Path(sys.argv[1]).read_text(encoding="utf-8", errors="ignore").splitlines()
for line in headers:
    if line.lower().startswith("content-type:"):
        print(line.split(":", 1)[1].strip().lower())
        raise SystemExit(0)
print("")
PY
      )"

      html_fallback="$(
        python3 - <<'PY' "$body_file"
import sys
from pathlib import Path

preview = Path(sys.argv[1]).read_bytes()[:512].decode("utf-8", errors="ignore").lower()
markers = ("<!doctype html", "<html", "<head", "<body")
print("true" if any(marker in preview for marker in markers) else "false")
PY
      )"

      if [[ ( "$content_type" == image/* || "$content_type" == application/octet-stream* ) && "$html_fallback" != "true" ]]; then
        echo "INFO: ${lane} public-edge ${target_name} succeeded (attempt ${attempt}/${max_attempts}) with content-type=${content_type}."
        return 0
      fi

      echo "WARN: ${lane} public-edge ${target_name} returned HTTP ${status} with content-type='${content_type}' html_fallback=${html_fallback} on attempt ${attempt}/${max_attempts}."
    else
      echo "WARN: ${lane} public-edge ${target_name} attempt ${attempt}/${max_attempts} returned HTTP ${status}."
    fi

    if [[ "$attempt" -lt "$max_attempts" ]]; then
      sleep "$sleep_seconds"
    fi
  done

  echo "ERROR: ${lane} public-edge ${target_name} probe failed after ${max_attempts} attempts (${target_url})." >&2
  cat "$headers_file" >&2 || true
  python3 - <<'PY' "$body_file" >&2
import sys
from pathlib import Path

preview = Path(sys.argv[1]).read_bytes()[:256].decode("utf-8", errors="ignore")
print(preview)
PY
  return 1
}

landlord_environment_url="${NAV_LANDLORD_URL%/}/api/v1/environment"
tenant_environment_url="${NAV_TENANT_URL%/}/api/v1/environment"
landlord_favicon_url="${NAV_LANDLORD_URL%/}/favicon.ico"
tenant_favicon_url="${NAV_TENANT_URL%/}/favicon.ico"

probe_environment "$landlord_environment_url" "landlord_environment" "landlord"
probe_environment "$tenant_environment_url" "tenant_environment" "tenant"
probe_binary_contract "$landlord_favicon_url" "landlord_favicon"
probe_binary_contract "$tenant_favicon_url" "tenant_favicon"

echo "INFO: ${lane} public-edge environment and branding probes completed successfully."
