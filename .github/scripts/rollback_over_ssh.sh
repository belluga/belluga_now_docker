#!/usr/bin/env bash
set -euo pipefail

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "ERROR: required environment variable '$name' is missing." >&2
    exit 1
  fi
}

require_env GITHUB_REPOSITORY
require_env GITHUB_REF_NAME
require_env SUBMODULES_REPO_TOKEN
require_env GHCR_USERNAME
require_env GHCR_TOKEN

deploy_lane="${DEPLOY_LANE:-stage}"
if [[ "${deploy_lane}" != "stage" && "${deploy_lane}" != "main" ]]; then
  echo "ERROR: DEPLOY_LANE must be 'stage' or 'main' (received '${deploy_lane}')." >&2
  exit 1
fi

deploy_ssh_host="${DEPLOY_SSH_HOST:-${STAGE_SSH_HOST:-}}"
deploy_ssh_port="${DEPLOY_SSH_PORT:-${STAGE_SSH_PORT:-}}"
deploy_ssh_user="${DEPLOY_SSH_USER:-${STAGE_SSH_USER:-}}"
deploy_path="${DEPLOY_PATH:-${STAGE_DEPLOY_PATH:-}}"
deploy_ssh_key_path="${DEPLOY_SSH_KEY_PATH:-${STAGE_SSH_KEY_PATH:-}}"
deploy_nginx_port_80="${DEPLOY_NGINX_HOST_PORT_80:-${STAGE_NGINX_HOST_PORT_80:-80}}"
deploy_nginx_port_443="${DEPLOY_NGINX_HOST_PORT_443:-${STAGE_NGINX_HOST_PORT_443:-443}}"
deploy_health_host="${DEPLOY_HEALTH_HOST:-}"
deploy_min_free_gb="${DEPLOY_MIN_FREE_GB:-4}"

require_protected_health_host() {
  local source host
  source="$(printf '%s' "${deploy_health_host}" | tr -d '\r')"
  source="${source%%$'\n'*}"
  source="${source#"${source%%[![:space:]]*}"}"
  source="${source%"${source##*[![:space:]]}"}"

  if [[ -z "${source}" ]]; then
    echo "ERROR: DEPLOY_HEALTH_HOST is required for protected ${deploy_lane} rollbacks. Define the canonical ${deploy_lane} lane landlord URL/host for this lane; implicit fallback to APP_URL or localhost is forbidden." >&2
    exit 1
  fi

  host="${source#*://}"
  host="${host%%/*}"
  host="${host%%:*}"
  host="$(printf '%s' "${host}" | tr -d '\r\n' | xargs)"

  if ! [[ "${host}" =~ ^[A-Za-z0-9.-]+$ ]]; then
    echo "ERROR: invalid health host '${host}' resolved from DEPLOY_HEALTH_HOST. Define the canonical ${deploy_lane} lane landlord URL/host explicitly; implicit fallback is forbidden." >&2
    exit 1
  fi

  printf '%s' "${host}"
}

if [[ -z "${deploy_ssh_host}" || -z "${deploy_ssh_port}" || -z "${deploy_ssh_user}" || -z "${deploy_path}" || -z "${deploy_ssh_key_path}" ]]; then
  echo "ERROR: missing deploy SSH config. Set DEPLOY_SSH_HOST/PORT/USER/PATH/KEY_PATH (or legacy STAGE_* equivalents)." >&2
  exit 1
fi

deploy_health_host="$(require_protected_health_host)"

for port_var in deploy_nginx_port_80 deploy_nginx_port_443; do
  port_value="${!port_var}"
  if ! [[ "${port_value}" =~ ^[0-9]+$ ]] || (( port_value < 1 || port_value > 65535 )); then
    echo "ERROR: ${port_var} must be a numeric TCP port between 1 and 65535 (received '${port_value}')." >&2
    exit 1
  fi
done

if [[ "${deploy_ssh_key_path}" == "~/"* ]]; then
  deploy_ssh_key_path="${HOME}/${deploy_ssh_key_path#\~/}"
fi

if [[ ! -f "${deploy_ssh_key_path}" ]]; then
  echo "ERROR: SSH key file not found at '${deploy_ssh_key_path}'." >&2
  exit 1
fi

if ! [[ "${deploy_min_free_gb}" =~ ^[0-9]+$ ]] || (( deploy_min_free_gb < 1 )); then
  echo "ERROR: DEPLOY_MIN_FREE_GB must be a positive integer (received '${deploy_min_free_gb}')." >&2
  exit 1
fi

remote_script_local=".github/scripts/rollback_remote.sh"
if [[ ! -f "${remote_script_local}" ]]; then
  echo "ERROR: rollback remote script not found at '${remote_script_local}'." >&2
  exit 1
fi

remote="${deploy_ssh_user}@${deploy_ssh_host}"
ssh_opts=(
  -p "${deploy_ssh_port}"
  -i "${deploy_ssh_key_path}"
  -o BatchMode=yes
  -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=yes
  -o ConnectTimeout=5
  -o ConnectionAttempts=3
  -o ServerAliveInterval=15
  -o ServerAliveCountMax=40
  -o TCPKeepAlive=yes
)
scp_opts=(
  -P "${deploy_ssh_port}"
  -i "${deploy_ssh_key_path}"
  -o BatchMode=yes
  -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=yes
  -o ConnectTimeout=5
  -o ConnectionAttempts=3
  -o ServerAliveInterval=15
  -o ServerAliveCountMax=40
  -o TCPKeepAlive=yes
)

remote_temp_script="/tmp/belluga-rollback-remote-${deploy_lane}-$$.sh"
printf -v remote_temp_script_q '%q' "${remote_temp_script}"
printf -v deploy_path_q '%q' "${deploy_path}"
printf -v github_repository_q '%q' "${GITHUB_REPOSITORY}"
printf -v github_ref_name_q '%q' "${GITHUB_REF_NAME}"
printf -v deploy_lane_q '%q' "${deploy_lane}"
printf -v submodules_repo_token_q '%q' "${SUBMODULES_REPO_TOKEN}"
printf -v ghcr_username_q '%q' "${GHCR_USERNAME}"
printf -v ghcr_token_q '%q' "${GHCR_TOKEN}"
printf -v deploy_nginx_port_80_q '%q' "${deploy_nginx_port_80}"
printf -v deploy_nginx_port_443_q '%q' "${deploy_nginx_port_443}"
printf -v deploy_health_host_q '%q' "${deploy_health_host}"
printf -v deploy_min_free_gb_q '%q' "${deploy_min_free_gb}"
printf -v rollback_target_revision_q '%q' "${ROLLBACK_TARGET_REVISION:-}"

echo "INFO: starting rollback on ${remote}:${deploy_path}"

copy_remote_script() {
  local attempt=1
  local max_attempts=3
  local status=0

  while true; do
    if scp "${scp_opts[@]}" "${remote_script_local}" "${remote}:${remote_temp_script}"; then
      return 0
    fi
    status=$?
    if (( attempt >= max_attempts )); then
      return "${status}"
    fi
    echo "WARN: rollback remote script transfer failed with status ${status}; retrying (${attempt}/${max_attempts})." >&2
    attempt=$((attempt + 1))
    sleep 5
  done
}

copy_remote_script

remote_command="$(cat <<EOF
set -uo pipefail
tmp_script=${remote_temp_script_q}
cleanup() {
  rm -f "\$tmp_script"
}
trap cleanup EXIT
chmod 700 "\$tmp_script"
export DEPLOY_PATH=${deploy_path_q}
export GITHUB_REPOSITORY=${github_repository_q}
export DEPLOY_BRANCH=${github_ref_name_q}
export DEPLOY_LANE=${deploy_lane_q}
export SUBMODULES_REPO_TOKEN=${submodules_repo_token_q}
export GHCR_USERNAME=${ghcr_username_q}
export GHCR_TOKEN=${ghcr_token_q}
export DEPLOY_NGINX_HOST_PORT_80=${deploy_nginx_port_80_q}
export DEPLOY_NGINX_HOST_PORT_443=${deploy_nginx_port_443_q}
export DEPLOY_HEALTH_HOST_RAW=${deploy_health_host_q}
export DEPLOY_MIN_FREE_GB=${deploy_min_free_gb_q}
export ROLLBACK_TARGET_REVISION=${rollback_target_revision_q}
bash "\$tmp_script"
EOF
)"

ssh "${ssh_opts[@]}" "${remote}" "${remote_command}"
