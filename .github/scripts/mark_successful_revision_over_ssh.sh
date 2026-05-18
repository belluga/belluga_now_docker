#!/usr/bin/env bash
set -euo pipefail

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "ERROR: required environment variable '$name' is missing." >&2
    exit 1
  fi
}

deploy_ssh_host="${DEPLOY_SSH_HOST:-${STAGE_SSH_HOST:-}}"
deploy_ssh_port="${DEPLOY_SSH_PORT:-${STAGE_SSH_PORT:-}}"
deploy_ssh_user="${DEPLOY_SSH_USER:-${STAGE_SSH_USER:-}}"
deploy_path="${DEPLOY_PATH:-${STAGE_DEPLOY_PATH:-}}"
deploy_ssh_key_path="${DEPLOY_SSH_KEY_PATH:-${STAGE_SSH_KEY_PATH:-}}"

require_env deploy_ssh_host
require_env deploy_ssh_port
require_env deploy_ssh_user
require_env deploy_path
require_env deploy_ssh_key_path

if [[ "${deploy_ssh_key_path}" == "~/"* ]]; then
  deploy_ssh_key_path="${HOME}/${deploy_ssh_key_path#\~/}"
fi

if [[ ! -f "${deploy_ssh_key_path}" ]]; then
  echo "ERROR: SSH key file not found at '${deploy_ssh_key_path}'." >&2
  exit 1
fi

remote="${deploy_ssh_user}@${deploy_ssh_host}"
ssh_opts=(
  -p "${deploy_ssh_port}"
  -i "${deploy_ssh_key_path}"
  -o BatchMode=yes
  -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=yes
)

echo "INFO: marking successful revision on ${remote}:${deploy_path}"

ssh "${ssh_opts[@]}" "${remote}" "bash -se" <<EOF_REMOTE
set -euo pipefail

DEPLOY_PATH='${deploy_path}'
DEPLOY_LANE_INPUT='${DEPLOY_LANE:-}'

if [[ ! -d "\${DEPLOY_PATH}/.git" ]]; then
  echo "ERROR: deploy path '\${DEPLOY_PATH}' is not a git repository." >&2
  exit 1
fi

cd "\${DEPLOY_PATH}"
current_revision="\$(git rev-parse HEAD)"
if [[ ! -d "web-app" ]]; then
  echo "ERROR: missing web-app directory in deploy path; cannot record successful release tuple." >&2
  exit 1
fi

current_web_runtime_sha="\$(git -C web-app rev-parse HEAD | tr -d '[:space:]')"
if [[ -z "\${current_web_runtime_sha}" ]]; then
  echo "ERROR: could not resolve current web-app runtime SHA." >&2
  exit 1
fi

deploy_lane="\${DEPLOY_LANE_INPUT}"
if [[ -z "\${deploy_lane}" ]]; then
  deploy_lane="\$(git rev-parse --abbrev-ref HEAD | tr -d '[:space:]')"
fi

recorded_at="\$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cat > .last_successful_revision <<EOF_TUPLE
ROOT_SHA=\${current_revision}
WEB_APP_RUNTIME_SHA=\${current_web_runtime_sha}
DEPLOY_LANE=\${deploy_lane}
RECORDED_AT=\${recorded_at}
EOF_TUPLE

echo "INFO: recorded last successful release tuple:"
echo "INFO:   ROOT_SHA=\${current_revision}"
echo "INFO:   WEB_APP_RUNTIME_SHA=\${current_web_runtime_sha}"
echo "INFO:   DEPLOY_LANE=\${deploy_lane}"
echo "INFO:   RECORDED_AT=\${recorded_at}"
EOF_REMOTE
