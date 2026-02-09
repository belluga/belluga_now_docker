#!/usr/bin/env bash
set -euo pipefail

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "ERROR: required environment variable '$name' is missing." >&2
    exit 1
  fi
}

require_env STAGE_SSH_HOST
require_env STAGE_SSH_PORT
require_env STAGE_SSH_USER
require_env STAGE_DEPLOY_PATH
require_env GITHUB_REPOSITORY
require_env GITHUB_REF_NAME
require_env STAGE_SSH_KEY_PATH

# Normalize "~" because env vars are not shell-expanded automatically.
if [[ "${STAGE_SSH_KEY_PATH}" == "~/"* ]]; then
  STAGE_SSH_KEY_PATH="${HOME}/${STAGE_SSH_KEY_PATH#\~/}"
fi

if [[ "${GITHUB_REF_NAME}" != "stage" ]]; then
  echo "ERROR: deploy_stage_over_ssh.sh must run on branch 'stage' (received '${GITHUB_REF_NAME}')." >&2
  exit 1
fi

if [[ ! -f "${STAGE_SSH_KEY_PATH}" ]]; then
  echo "ERROR: SSH key file not found at '${STAGE_SSH_KEY_PATH}'." >&2
  exit 1
fi

if [[ -z "${SUBMODULES_REPO_TOKEN:-}" ]]; then
  echo "ERROR: SUBMODULES_REPO_TOKEN is required to fetch private submodules on the server." >&2
  exit 1
fi

remote="${STAGE_SSH_USER}@${STAGE_SSH_HOST}"
ssh_opts=(
  -p "${STAGE_SSH_PORT}"
  -i "${STAGE_SSH_KEY_PATH}"
  -o BatchMode=yes
  -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=yes
)

echo "INFO: Starting stage deploy to ${remote}:${STAGE_DEPLOY_PATH}"

ssh "${ssh_opts[@]}" "${remote}" "bash -se" <<EOF_REMOTE
set -euo pipefail

STAGE_DEPLOY_PATH='${STAGE_DEPLOY_PATH}'
GITHUB_REPOSITORY='${GITHUB_REPOSITORY}'
DEPLOY_BRANCH='${GITHUB_REF_NAME}'
SUBMODULES_REPO_TOKEN='${SUBMODULES_REPO_TOKEN}'

run_git() {
  GIT_CONFIG_COUNT=1 \
  GIT_CONFIG_KEY_0="url.https://x-access-token:\${SUBMODULES_REPO_TOKEN}@github.com/.insteadOf" \
  GIT_CONFIG_VALUE_0="https://github.com/" \
  git "\$@"
}

if ! command -v git >/dev/null 2>&1; then
  echo "ERROR: git is not installed on remote host." >&2
  exit 1
fi

if docker compose version >/dev/null 2>&1; then
  DOCKER_COMPOSE=(docker compose)
elif sudo docker compose version >/dev/null 2>&1; then
  DOCKER_COMPOSE=(sudo docker compose)
else
  echo "ERROR: docker compose is unavailable on remote host." >&2
  exit 1
fi

mkdir -p "\$STAGE_DEPLOY_PATH"

if [[ ! -d "\$STAGE_DEPLOY_PATH/.git" ]]; then
  run_git clone --recurse-submodules "https://github.com/\$GITHUB_REPOSITORY.git" "\$STAGE_DEPLOY_PATH"
fi

cd "\$STAGE_DEPLOY_PATH"
run_git fetch --prune origin "\$DEPLOY_BRANCH"
run_git checkout "\$DEPLOY_BRANCH"
run_git reset --hard "origin/\$DEPLOY_BRANCH"
run_git submodule sync --recursive
run_git submodule update --init --recursive

"\${DOCKER_COMPOSE[@]}" up -d --build --remove-orphans
"\${DOCKER_COMPOSE[@]}" ps

echo "INFO: Stage deploy completed successfully."
EOF_REMOTE
