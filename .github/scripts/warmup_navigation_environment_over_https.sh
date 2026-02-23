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

parse_host() {
  local input_url="$1"
  python3 -c 'import sys, urllib.parse; print((urllib.parse.urlparse(sys.argv[1]).hostname or "").strip())' "$input_url"
}

landlord_host="$(parse_host "$NAV_LANDLORD_URL")"
tenant_host="$(parse_host "$NAV_TENANT_URL")"

if [[ -z "$landlord_host" || -z "$tenant_host" ]]; then
  echo "ERROR: could not parse landlord/tenant hosts from navigation URLs." >&2
  exit 1
fi

max_attempts="${NAV_WARMUP_MAX_ATTEMPTS:-12}"
sleep_seconds="${NAV_WARMUP_SLEEP_SECONDS:-5}"

curl_args=(-sS -m 15)
if [[ -n "${NAV_ORIGIN_IP:-}" ]]; then
  echo "INFO: ${lane} warmup routed directly to origin ${NAV_ORIGIN_IP} over HTTP host-header probes."
fi

check_environment() {
  local target_url="$1"
  local target_name="$2"
  local target_host="${3:-}"
  local body_file="/tmp/${lane}_warmup_${target_name}.json"

  for attempt in $(seq 1 "$max_attempts"); do
    request_args=("${curl_args[@]}")
    if [[ -n "${target_host}" ]]; then
      request_args+=(-H "Host: ${target_host}")
    fi

    status="$(
      curl "${request_args[@]}" -o "$body_file" -w '%{http_code}' "${target_url}" || true
    )"
    if [[ "$status" == "200" ]]; then
      echo "INFO: ${lane} warmup ${target_name} succeeded (attempt ${attempt}/${max_attempts})."
      return 0
    fi

    echo "WARN: ${lane} warmup ${target_name} attempt ${attempt}/${max_attempts} returned HTTP ${status}."
    if [[ "$attempt" -lt "$max_attempts" ]]; then
      sleep "$sleep_seconds"
    fi
  done

  echo "ERROR: ${lane} warmup ${target_name} failed after ${max_attempts} attempts (${target_url})." >&2
  cat "$body_file" >&2 || true
  return 1
}

landlord_environment_host=""
tenant_environment_host=""
if [[ -n "${NAV_ORIGIN_IP:-}" ]]; then
  landlord_environment_url="http://${NAV_ORIGIN_IP}/api/v1/environment"
  tenant_environment_url="http://${NAV_ORIGIN_IP}/api/v1/environment"
  landlord_environment_host="${landlord_host}"
  tenant_environment_host="${tenant_host}"
else
  landlord_environment_url="${NAV_LANDLORD_URL%/}/api/v1/environment"
  tenant_environment_url="${NAV_TENANT_URL%/}/api/v1/environment"
fi

check_environment "$landlord_environment_url" "landlord_environment" "${landlord_environment_host}"
check_environment "$tenant_environment_url" "tenant_environment" "${tenant_environment_host}"

echo "INFO: ${lane} navigation environment warmup completed successfully."
