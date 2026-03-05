#!/usr/bin/env bash
set -euo pipefail

lane="${1:-${NAV_DEPLOY_LANE:-}}"
if [[ -z "${lane}" ]]; then
  echo "ERROR: usage: $0 <stage|main>" >&2
  exit 1
fi

case "${lane}" in
  stage|main)
    ;;
  *)
    echo "ERROR: unsupported lane '${lane}'. Allowed lanes: stage, main." >&2
    exit 1
    ;;
esac

defines_file="flutter-app/config/defines/${lane}.json"
if [[ ! -f "${defines_file}" ]]; then
  echo "ERROR: lane defines file not found for '${lane}': ${defines_file}" >&2
  exit 1
fi

read_landlord_from_lane_file() {
  local file_path="$1"
  python3 - "$file_path" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
data = json.loads(path.read_text(encoding="utf-8"))
value = data.get("LANDLORD_DOMAIN", "")
if isinstance(value, str):
    print(value.strip())
else:
    print("")
PY
}

normalize_url() {
  local input="$1"
  python3 - "$input" <<'PY'
import sys
import urllib.parse

raw = (sys.argv[1] or "").strip()
if not raw:
    print("")
    raise SystemExit(0)

parsed = urllib.parse.urlparse(raw)
if not parsed.scheme and parsed.netloc:
    # Rare form like //example.com
    parsed = urllib.parse.urlparse(f"https:{raw}")
elif not parsed.scheme:
    parsed = urllib.parse.urlparse(f"https://{raw}")

if parsed.scheme not in {"http", "https"}:
    raise SystemExit(2)
if not parsed.hostname:
    raise SystemExit(3)
if parsed.username or parsed.password:
    raise SystemExit(4)

port = f":{parsed.port}" if parsed.port is not None else ""
print(f"{parsed.scheme}://{parsed.hostname}{port}")
PY
}

parse_host() {
  local input="$1"
  python3 - "$input" <<'PY'
import sys
import urllib.parse

parsed = urllib.parse.urlparse(sys.argv[1])
print((parsed.hostname or "").strip().lower())
PY
}

is_local_host() {
  local host="$1"
  [[ "${host}" == "belluga.space" || "${host}" == *.belluga.space ]]
}

landlord_raw="$(read_landlord_from_lane_file "${defines_file}")"
if [[ -z "${landlord_raw}" ]]; then
  echo "ERROR: LANDLORD_DOMAIN is missing in ${defines_file}." >&2
  exit 1
fi

if ! landlord_url="$(normalize_url "${landlord_raw}")"; then
  echo "ERROR: invalid LANDLORD_DOMAIN in ${defines_file}: ${landlord_raw}" >&2
  exit 1
fi

tenant_raw="${NAV_TENANT_URL_INPUT:-}"
if [[ -z "${tenant_raw}" ]]; then
  echo "ERROR: NAV_TENANT_URL_INPUT is required for lane '${lane}'." >&2
  exit 1
fi

if ! tenant_url="$(normalize_url "${tenant_raw}")"; then
  echo "ERROR: invalid tenant navigation URL for lane '${lane}': ${tenant_raw}" >&2
  exit 1
fi

landlord_host="$(parse_host "${landlord_url}")"
tenant_host="$(parse_host "${tenant_url}")"
if [[ -z "${landlord_host}" || -z "${tenant_host}" ]]; then
  echo "ERROR: failed to parse landlord/tenant hosts for lane '${lane}'." >&2
  exit 1
fi

if is_local_host "${landlord_host}" || is_local_host "${tenant_host}"; then
  echo "ERROR: lane '${lane}' cannot use local belluga.space hosts. landlord=${landlord_host} tenant=${tenant_host}" >&2
  exit 1
fi

landlord_input="${NAV_LANDLORD_URL_INPUT:-}"
if [[ -n "${landlord_input}" ]]; then
  if ! landlord_input_norm="$(normalize_url "${landlord_input}")"; then
    echo "ERROR: invalid NAV_LANDLORD_URL_INPUT for lane '${lane}': ${landlord_input}" >&2
    exit 1
  fi
  if [[ "${landlord_input_norm}" != "${landlord_url}" ]]; then
    echo "ERROR: landlord URL mismatch for lane '${lane}'." >&2
    echo "  lane file (${defines_file}): ${landlord_url}" >&2
    echo "  workflow input:          ${landlord_input_norm}" >&2
    exit 1
  fi
fi

echo "INFO: resolved lane '${lane}' navigation targets:"
echo "INFO:   landlord=${landlord_url} (${landlord_host})"
echo "INFO:   tenant=${tenant_url} (${tenant_host})"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    echo "landlord_url=${landlord_url}"
    echo "tenant_url=${tenant_url}"
    echo "landlord_host=${landlord_host}"
    echo "tenant_host=${tenant_host}"
  } >> "${GITHUB_OUTPUT}"
fi
