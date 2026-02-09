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

stage_nginx_port_80="${STAGE_NGINX_HOST_PORT_80:-80}"
stage_nginx_port_443="${STAGE_NGINX_HOST_PORT_443:-443}"

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
STAGE_NGINX_HOST_PORT_80='${stage_nginx_port_80}'
STAGE_NGINX_HOST_PORT_443='${stage_nginx_port_443}'

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

if [[ ! -f ".env" ]]; then
  if [[ -f ".env.example" ]]; then
    cp .env.example .env
    echo "INFO: bootstrap .env from .env.example on first deploy."
  else
    echo "ERROR: missing both .env and .env.example in deploy path." >&2
    exit 1
  fi
fi

upsert_env() {
  local key="\$1"
  local value="\$2"

  if grep -q "^\\\${key}=" .env; then
    sed -i "s#^\\\${key}=.*#\\\${key}=\\\${value}#" .env
  else
    echo "\\\${key}=\\\${value}" >> .env
  fi
}

upsert_env NGINX_HOST_PORT_80 "\$STAGE_NGINX_HOST_PORT_80"
upsert_env NGINX_HOST_PORT_443 "\$STAGE_NGINX_HOST_PORT_443"

"\${DOCKER_COMPOSE[@]}" up -d --build --remove-orphans
"\${DOCKER_COMPOSE[@]}" ps

# Validate runtime health before declaring deploy success.
health_url="http://127.0.0.1:\${STAGE_NGINX_HOST_PORT_80}/api/v1/environment"
echo "INFO: waiting for application health at \${health_url}"

for attempt in \$(seq 1 24); do
  if curl -fsS --max-time 5 "\${health_url}" >/dev/null 2>&1; then
    echo "INFO: stage health check passed."
    echo "INFO: Stage deploy completed successfully."
    exit 0
  fi

  echo "INFO: health check attempt \${attempt}/24 failed; retrying in 5s..."
  sleep 5
done

echo "ERROR: stage deploy finished but application is not healthy." >&2
"\${DOCKER_COMPOSE[@]}" ps || true
"\${DOCKER_COMPOSE[@]}" logs --tail=200 app worker scheduler nginx || true
exit 1
EOF_REMOTE
