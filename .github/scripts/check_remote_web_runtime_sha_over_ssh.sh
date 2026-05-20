#!/usr/bin/env bash
set -euo pipefail

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "ERROR: required environment variable '$name' is missing." >&2
    exit 1
  fi
}

normalize_sha() {
  printf '%s' "$1" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]'
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

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

expected_web_runtime_sha="$(normalize_sha "${EXPECTED_WEB_APP_RUNTIME_SHA:-}")"
expected_sha_source="override"
if [[ -z "${expected_web_runtime_sha}" ]]; then
  expected_web_runtime_sha="$(git -C "${repo_root}/web-app" rev-parse HEAD 2>/dev/null | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]' || true)"
  expected_sha_source="local-checkout"
fi

if [[ -z "${expected_web_runtime_sha}" ]]; then
  echo "ERROR: could not resolve expected web-app runtime SHA (${expected_sha_source})." >&2
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

remote_output="$(
  ssh "${ssh_opts[@]}" "${remote}" "bash -se" <<EOF_REMOTE
set -euo pipefail

DEPLOY_PATH='${deploy_path}'

if [[ ! -d "\${DEPLOY_PATH}/.git" ]]; then
  echo "ERROR: deploy path '\${DEPLOY_PATH}' is not a git repository." >&2
  exit 1
fi

cd "\${DEPLOY_PATH}"
if [[ ! -d "web-app" ]]; then
  echo "ERROR: missing web-app directory in deploy path." >&2
  exit 1
fi

printf 'root_sha=%s\n' "\$(git rev-parse HEAD | tr -d '[:space:]')"
printf 'web_runtime_sha=%s\n' "\$(git -C web-app rev-parse HEAD | tr -d '[:space:]')"
EOF_REMOTE
)"

actual_root_sha="$(printf '%s\n' "${remote_output}" | sed -n 's/^root_sha=//p' | head -n 1 | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"
actual_web_runtime_sha="$(printf '%s\n' "${remote_output}" | sed -n 's/^web_runtime_sha=//p' | head -n 1 | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"

if [[ -z "${actual_web_runtime_sha}" ]]; then
  echo "ERROR: remote host did not report a web-app runtime SHA." >&2
  exit 1
fi

if [[ "${actual_web_runtime_sha}" != "${expected_web_runtime_sha}" ]]; then
  echo "ERROR: remote web-app runtime SHA mismatch." >&2
  echo "Expected web-app runtime SHA (${expected_sha_source}): ${expected_web_runtime_sha}" >&2
  echo "Actual remote web-app runtime SHA: ${actual_web_runtime_sha}" >&2
  if [[ -n "${actual_root_sha}" ]]; then
    echo "Remote root revision: ${actual_root_sha}" >&2
  fi
  exit 1
fi

echo "OK: remote web-app runtime SHA matches expected ${expected_sha_source}."
echo "Expected web-app runtime SHA (${expected_sha_source}): ${expected_web_runtime_sha}"
echo "Remote web-app runtime SHA: ${actual_web_runtime_sha}"
if [[ -n "${actual_root_sha}" ]]; then
  echo "Remote root revision: ${actual_root_sha}"
fi
