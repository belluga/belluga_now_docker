#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: manage_navigation_host_overrides.sh <apply|reset>

Environment for apply:
  NAV_LANDLORD_URL   Required landlord URL used to resolve the landlord host.
  NAV_TENANT_URL     Required tenant URL used to resolve the tenant host.
  NAV_ORIGIN_IP      Optional origin IP. When empty, apply behaves like reset.

The script manages only its own marked block inside /etc/hosts and emits
playwright_ignore_https_errors=<true|false> through GITHUB_OUTPUT/GITHUB_ENV when
those GitHub Actions files are available.
EOF
}

readonly OVERRIDE_BLOCK_BEGIN="# DELPHI_NAV_HOST_OVERRIDES BEGIN"
readonly OVERRIDE_BLOCK_END="# DELPHI_NAV_HOST_OVERRIDES END"

emit_ignore_https_errors() {
  local value="$1"

  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    echo "playwright_ignore_https_errors=${value}" >> "${GITHUB_OUTPUT}"
  fi

  if [[ -n "${GITHUB_ENV:-}" ]]; then
    echo "PLAYWRIGHT_IGNORE_HTTPS_ERRORS=${value}" >> "${GITHUB_ENV}"
  fi
}

rewrite_hosts_without_managed_block() {
  local temp_file
  temp_file="$(mktemp)"

  sudo awk -v begin="${OVERRIDE_BLOCK_BEGIN}" -v end="${OVERRIDE_BLOCK_END}" '
    $0 == begin { skipping = 1; next }
    $0 == end { skipping = 0; next }
    !skipping { print }
  ' /etc/hosts > "${temp_file}"

  sudo cp "${temp_file}" /etc/hosts
  rm -f "${temp_file}"
}

parse_host_from_url() {
  local input_url="$1"
  python3 -c 'import sys, urllib.parse; print((urllib.parse.urlparse(sys.argv[1]).hostname or "").strip())' "${input_url}"
}

apply_overrides() {
  local landlord_host tenant_host temp_file

  landlord_host="$(parse_host_from_url "${NAV_LANDLORD_URL:-}")"
  tenant_host="$(parse_host_from_url "${NAV_TENANT_URL:-}")"

  if [[ -z "${landlord_host}" || -z "${tenant_host}" ]]; then
    echo "ERROR: could not parse landlord/tenant hosts from NAV_LANDLORD_URL/NAV_TENANT_URL." >&2
    exit 1
  fi

  rewrite_hosts_without_managed_block

  if [[ -z "${NAV_ORIGIN_IP:-}" ]]; then
    emit_ignore_https_errors false
    echo "INFO: no NAV_ORIGIN_IP provided; navigation host overrides cleared and public DNS remains active."
    return
  fi

  temp_file="$(mktemp)"
  {
    echo "${OVERRIDE_BLOCK_BEGIN}"
    echo "${NAV_ORIGIN_IP} ${landlord_host}"
    echo "${NAV_ORIGIN_IP} ${tenant_host}"
    echo "${OVERRIDE_BLOCK_END}"
  } > "${temp_file}"

  sudo tee -a /etc/hosts < "${temp_file}" >/dev/null
  rm -f "${temp_file}"

  emit_ignore_https_errors true
  echo "INFO: navigation host overrides mapped ${landlord_host}/${tenant_host} to ${NAV_ORIGIN_IP}."
}

reset_overrides() {
  rewrite_hosts_without_managed_block
  emit_ignore_https_errors false
  echo "INFO: navigation host overrides cleared from /etc/hosts."
}

main() {
  if [[ $# -ne 1 ]]; then
    usage
    exit 1
  fi

  case "$1" in
    apply)
      apply_overrides
      ;;
    reset)
      reset_overrides
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"
