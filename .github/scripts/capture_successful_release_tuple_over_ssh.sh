#!/usr/bin/env bash
set -euo pipefail

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "ERROR: required environment variable '${name}' is missing." >&2
    exit 1
  fi
}

for required in DEPLOY_SSH_HOST DEPLOY_SSH_PORT DEPLOY_SSH_USER DEPLOY_PATH DEPLOY_SSH_KEY_PATH DEPLOY_LANE; do
  require_env "${required}"
done

if [[ "${DEPLOY_SSH_KEY_PATH}" == "~/"* ]]; then
  DEPLOY_SSH_KEY_PATH="${HOME}/${DEPLOY_SSH_KEY_PATH#\~/}"
fi

if [[ ! -f "${DEPLOY_SSH_KEY_PATH}" ]]; then
  echo "ERROR: SSH key file not found at '${DEPLOY_SSH_KEY_PATH}'." >&2
  exit 1
fi

remote_output="$(
  ssh -p "${DEPLOY_SSH_PORT}" -i "${DEPLOY_SSH_KEY_PATH}" \
    -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
    -o ConnectTimeout=5 -o ConnectionAttempts=1 \
    -o ServerAliveInterval=15 -o ServerAliveCountMax=4 -o TCPKeepAlive=yes \
    "${DEPLOY_SSH_USER}@${DEPLOY_SSH_HOST}" "DEPLOY_PATH='${DEPLOY_PATH}' bash -s" <<'REMOTE'
set -euo pipefail

emit_empty() {
  printf 'trusted_tuple_present=false\n'
  printf 'complete_image_tuple_present=false\n'
}

if [[ ! -d "${DEPLOY_PATH}/.git" ]]; then
  emit_empty
  exit 0
fi

cd "${DEPLOY_PATH}"
if [[ ! -f ".last_successful_revision" ]]; then
  emit_empty
  exit 0
fi

marker="$(tr -d '\r' < .last_successful_revision)"
if printf '%s\n' "${marker}" | grep -Eq '^[0-9a-fA-F]{40}$'; then
  printf 'trusted_tuple_present=false\n'
  printf 'complete_image_tuple_present=false\n'
  printf 'legacy_marker=true\n'
  printf 'target=%s\n' "$(printf '%s' "${marker}" | tr -d '[:space:]')"
  exit 0
fi

field() {
  local key="$1"
  printf '%s\n' "${marker}" | sed -n "s/^${key}=//p" | head -n 1 | tr -d '[:space:]'
}

root_sha="$(field ROOT_SHA)"
web_sha="$(field WEB_APP_RUNTIME_SHA)"
app_image="$(field APP_IMAGE)"
worker_image="$(field WORKER_IMAGE)"
scheduler_image="$(field SCHEDULER_IMAGE)"
nginx_image="$(field NGINX_IMAGE)"

trusted=false
if [[ -n "${root_sha}" && -n "${web_sha}" ]]; then
  trusted=true
fi

complete_images=false
if [[ -n "${app_image}" && -n "${worker_image}" && -n "${scheduler_image}" && -n "${nginx_image}" ]]; then
  complete_images=true
fi

printf 'trusted_tuple_present=%s\n' "${trusted}"
printf 'complete_image_tuple_present=%s\n' "${complete_images}"
printf 'target=%s\n' "${root_sha}"
printf 'web_app_runtime_sha=%s\n' "${web_sha}"
printf 'app_image=%s\n' "${app_image}"
printf 'worker_image=%s\n' "${worker_image}"
printf 'scheduler_image=%s\n' "${scheduler_image}"
printf 'nginx_image=%s\n' "${nginx_image}"
REMOTE
)"

value_for() {
  local key="$1"
  printf '%s\n' "${remote_output}" | sed -n "s/^${key}=//p" | head -n 1 | tr -d '[:space:]'
}

trusted_tuple_present="$(value_for trusted_tuple_present)"
complete_image_tuple_present="$(value_for complete_image_tuple_present)"
target="$(value_for target)"
web_app_runtime_sha="$(value_for web_app_runtime_sha)"
app_image="$(value_for app_image)"
worker_image="$(value_for worker_image)"
scheduler_image="$(value_for scheduler_image)"
nginx_image="$(value_for nginx_image)"

{
  echo "trusted_tuple_present=${trusted_tuple_present:-false}"
  echo "complete_image_tuple_present=${complete_image_tuple_present:-false}"
  if [[ -n "${target}" ]]; then
    echo "revision=${target}"
  fi
  if [[ -n "${web_app_runtime_sha}" ]]; then
    echo "web_app_runtime_sha=${web_app_runtime_sha}"
  fi
  if [[ -n "${app_image}" ]]; then
    echo "app_image=${app_image}"
  fi
  if [[ -n "${worker_image}" ]]; then
    echo "worker_image=${worker_image}"
  fi
  if [[ -n "${scheduler_image}" ]]; then
    echo "scheduler_image=${scheduler_image}"
  fi
  if [[ -n "${nginx_image}" ]]; then
    echo "nginx_image=${nginx_image}"
  fi
} >> "${GITHUB_OUTPUT:-/dev/null}"

if [[ -n "${target}" ]]; then
  echo "INFO: ${DEPLOY_LANE} rollback target revision captured: ${target}"
else
  echo "INFO: ${DEPLOY_LANE} rollback target revision unavailable."
fi
echo "INFO: ${DEPLOY_LANE} trusted tuple present: ${trusted_tuple_present:-false}; complete image tuple present: ${complete_image_tuple_present:-false}"
