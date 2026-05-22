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

require_env APP_IMAGE
require_env WORKER_IMAGE
require_env SCHEDULER_IMAGE
require_env NGINX_IMAGE

require_immutable_image_ref() {
  local name="$1"
  local value="${!name:-}"

  if [[ -z "${value}" ]]; then
    echo "ERROR: ${name} is required before recording a protected successful release tuple." >&2
    exit 1
  fi
  if [[ "${value}" != ghcr.io/*@sha256:* ]]; then
    echo "ERROR: ${name} must be an immutable GHCR digest reference (received '${value}')." >&2
    exit 1
  fi
  if [[ "${value}" == *":latest"* ]]; then
    echo "ERROR: ${name} must not use mutable ':latest' image authority." >&2
    exit 1
  fi
}

image_digest() {
  local image_ref="$1"
  local digest="${image_ref##*@}"
  if ! [[ "${digest}" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    echo "ERROR: image ref '${image_ref}' does not contain a valid sha256 digest." >&2
    exit 1
  fi
  printf '%s' "${digest}"
}

for image_var in APP_IMAGE WORKER_IMAGE SCHEDULER_IMAGE NGINX_IMAGE; do
  require_immutable_image_ref "${image_var}"
done

app_image_digest="$(image_digest "${APP_IMAGE}")"
worker_image_digest="$(image_digest "${WORKER_IMAGE}")"
scheduler_image_digest="$(image_digest "${SCHEDULER_IMAGE}")"
nginx_image_digest="$(image_digest "${NGINX_IMAGE}")"

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
APP_IMAGE='${APP_IMAGE}'
APP_IMAGE_DIGEST='${app_image_digest}'
WORKER_IMAGE='${WORKER_IMAGE}'
WORKER_IMAGE_DIGEST='${worker_image_digest}'
SCHEDULER_IMAGE='${SCHEDULER_IMAGE}'
SCHEDULER_IMAGE_DIGEST='${scheduler_image_digest}'
NGINX_IMAGE='${NGINX_IMAGE}'
NGINX_IMAGE_DIGEST='${nginx_image_digest}'

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
WEB_APP_RUNTIME_AUTHORITY=lane-resolved-sha
RUNTIME_TOPOLOGY_VERSION=web-app-lane-sha-v1
DEPLOY_LANE=\${deploy_lane}
APP_IMAGE=\${APP_IMAGE}
APP_IMAGE_DIGEST=\${APP_IMAGE_DIGEST}
WORKER_IMAGE=\${WORKER_IMAGE}
WORKER_IMAGE_DIGEST=\${WORKER_IMAGE_DIGEST}
SCHEDULER_IMAGE=\${SCHEDULER_IMAGE}
SCHEDULER_IMAGE_DIGEST=\${SCHEDULER_IMAGE_DIGEST}
NGINX_IMAGE=\${NGINX_IMAGE}
NGINX_IMAGE_DIGEST=\${NGINX_IMAGE_DIGEST}
IMAGE_AUTHORITY=ghcr-digest-v1
RECORDED_AT=\${recorded_at}
EOF_TUPLE

echo "INFO: recorded last successful release tuple:"
echo "INFO:   ROOT_SHA=\${current_revision}"
echo "INFO:   WEB_APP_RUNTIME_SHA=\${current_web_runtime_sha}"
echo "INFO:   WEB_APP_RUNTIME_AUTHORITY=lane-resolved-sha"
echo "INFO:   RUNTIME_TOPOLOGY_VERSION=web-app-lane-sha-v1"
echo "INFO:   DEPLOY_LANE=\${deploy_lane}"
echo "INFO:   APP_IMAGE=\${APP_IMAGE}"
echo "INFO:   WORKER_IMAGE=\${WORKER_IMAGE}"
echo "INFO:   SCHEDULER_IMAGE=\${SCHEDULER_IMAGE}"
echo "INFO:   NGINX_IMAGE=\${NGINX_IMAGE}"
echo "INFO:   IMAGE_AUTHORITY=ghcr-digest-v1"
echo "INFO:   RECORDED_AT=\${recorded_at}"
EOF_REMOTE
