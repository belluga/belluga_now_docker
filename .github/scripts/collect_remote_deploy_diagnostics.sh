#!/usr/bin/env bash
set -euo pipefail

output_file="${OUTPUT_FILE:-/tmp/deploy_diagnostics.txt}"
mkdir -p "$(dirname "${output_file}")"

required_vars=(
  DEPLOY_SSH_HOST
  DEPLOY_SSH_PORT
  DEPLOY_SSH_USER
  DEPLOY_PATH
  DEPLOY_SSH_KEY_PATH
)

missing=()
for var_name in "${required_vars[@]}"; do
  if [[ -z "${!var_name:-}" ]]; then
    missing+=("${var_name}")
  fi
done

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "ERROR: missing required env vars: ${missing[*]}" >&2
  exit 1
fi

{
  echo "=== Deploy Diagnostics ==="
  echo "timestamp_utc=$(date -u +%FT%TZ)"
  echo "lane=${DEPLOY_LANE:-unknown}"
  echo "runner_repo=${GITHUB_REPOSITORY:-unknown}"
  echo "runner_ref=${GITHUB_REF_NAME:-unknown}"
  echo "runner_sha=${GITHUB_SHA:-unknown}"
  echo "deploy_host=${DEPLOY_SSH_HOST}"
  echo "deploy_port=${DEPLOY_SSH_PORT}"
  echo "deploy_path=${DEPLOY_PATH}"
  echo

  echo "=== Local Expected SHAs ==="
  echo "local_flutter_gitlink=$(git -C flutter-app rev-parse HEAD 2>/dev/null || echo unknown)"
  echo "local_web_gitlink=$(git -C web-app rev-parse HEAD 2>/dev/null || echo unknown)"
  echo

  echo "=== Remote Repository Snapshot ==="
} > "${output_file}"

set +e
ssh -p "${DEPLOY_SSH_PORT}" -i "${DEPLOY_SSH_KEY_PATH}" \
  -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
  "${DEPLOY_SSH_USER}@${DEPLOY_SSH_HOST}" "DEPLOY_PATH='${DEPLOY_PATH}' bash -s" >> "${output_file}" 2>&1 <<'REMOTE'
set -euo pipefail

echo "remote_timestamp_utc=$(date -u +%FT%TZ)"
if [[ ! -d "${DEPLOY_PATH}/.git" ]]; then
  echo "remote_repo_state=missing_git_directory"
  exit 0
fi

cd "${DEPLOY_PATH}"
echo "remote_repo_head=$(git rev-parse HEAD 2>/dev/null || true)"
echo "remote_repo_branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
echo "remote_last_successful_revision=$(cat .last_successful_revision 2>/dev/null || true)"
echo "remote_flutter_gitlink=$(git submodule status -- flutter-app 2>/dev/null | awk '{print $1}' | tr -d '+-' || true)"
echo "remote_web_gitlink=$(git submodule status -- web-app 2>/dev/null | awk '{print $1}' | tr -d '+-' || true)"
if [[ -f web-app/build_metadata.json ]]; then
  echo "remote_web_build_metadata_json_start"
  cat web-app/build_metadata.json
  echo
  echo "remote_web_build_metadata_json_end"
fi
REMOTE
remote_exit=$?
set -e

{
  echo
  echo "remote_snapshot_exit_code=${remote_exit}"
  echo
  echo "=== Live Endpoint Snapshot ==="
} >> "${output_file}"

if [[ -n "${NAV_LANDLORD_URL:-}" ]]; then
  landlord="${NAV_LANDLORD_URL%/}"
  host="$(python3 -c 'import sys, urllib.parse; print((urllib.parse.urlparse(sys.argv[1]).hostname or "").strip())' "${landlord}")"
  curl_args=(-sS -m 15 -H "Cache-Control: no-cache, no-store, max-age=0" -H "Pragma: no-cache")

  if [[ -n "${NAV_ORIGIN_IP:-}" && -n "${host}" ]]; then
    curl_args+=(--resolve "${host}:443:${NAV_ORIGIN_IP}" --insecure)
  fi

  for endpoint in "/build_metadata.json" "/api/v1/environment" "/api/v1/initialize"; do
    url="${landlord}${endpoint}?_ci_diag=$(date +%s)"
    body_file="/tmp/diag$(echo "${endpoint}" | tr '/.' '__').txt"
    status="$(curl "${curl_args[@]}" -o "${body_file}" -w '%{http_code}' "${url}" 2>> "${output_file}" || true)"
    {
      echo "--- ${endpoint} ---"
      echo "url=${url}"
      echo "status=${status}"
      echo "body_start"
      sed -n '1,80p' "${body_file}" 2>/dev/null || true
      echo
      echo "body_end"
      echo
    } >> "${output_file}"
  done
else
  echo "NAV_LANDLORD_URL is empty; skipped live endpoint snapshot." >> "${output_file}"
fi

echo "INFO: diagnostics written to ${output_file}"
