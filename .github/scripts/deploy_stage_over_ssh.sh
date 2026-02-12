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

if [[ -z "${deploy_ssh_host}" || -z "${deploy_ssh_port}" || -z "${deploy_ssh_user}" || -z "${deploy_path}" || -z "${deploy_ssh_key_path}" ]]; then
  echo "ERROR: missing deploy SSH config. Set DEPLOY_SSH_HOST/PORT/USER/PATH/KEY_PATH (or legacy STAGE_* equivalents)." >&2
  exit 1
fi

for port_var in deploy_nginx_port_80 deploy_nginx_port_443; do
  port_value="${!port_var}"
  if ! [[ "${port_value}" =~ ^[0-9]+$ ]] || (( port_value < 1 || port_value > 65535 )); then
    echo "ERROR: ${port_var} must be a numeric TCP port between 1 and 65535 (received '${port_value}')." >&2
    exit 1
  fi
done

# Normalize "~" because env vars are not shell-expanded automatically.
if [[ "${deploy_ssh_key_path}" == "~/"* ]]; then
  deploy_ssh_key_path="${HOME}/${deploy_ssh_key_path#\~/}"
fi

if [[ "${GITHUB_REF_NAME}" != "${deploy_lane}" ]]; then
  echo "ERROR: deploy script expects branch '${deploy_lane}' (received '${GITHUB_REF_NAME}')." >&2
  exit 1
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

echo "INFO: Starting ${deploy_lane} deploy to ${remote}:${deploy_path}"

ssh "${ssh_opts[@]}" "${remote}" "bash -se" <<EOF_REMOTE
set -euo pipefail

DEPLOY_PATH='${deploy_path}'
GITHUB_REPOSITORY='${GITHUB_REPOSITORY}'
DEPLOY_BRANCH='${GITHUB_REF_NAME}'
DEPLOY_LANE='${deploy_lane}'
SUBMODULES_REPO_TOKEN='${SUBMODULES_REPO_TOKEN}'
DEPLOY_NGINX_HOST_PORT_80='${deploy_nginx_port_80}'
DEPLOY_NGINX_HOST_PORT_443='${deploy_nginx_port_443}'
DEPLOY_HEALTH_HOST_RAW='${deploy_health_host}'

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

mkdir -p "\$DEPLOY_PATH"

if [[ ! -d "\$DEPLOY_PATH/.git" ]]; then
  run_git clone --recurse-submodules "https://github.com/\$GITHUB_REPOSITORY.git" "\$DEPLOY_PATH"
fi

cd "\$DEPLOY_PATH"
previous_revision=""
if git rev-parse --verify HEAD >/dev/null 2>&1; then
  previous_revision="\$(git rev-parse HEAD)"
fi

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

# Cleanup from prior malformed upsert runs.
sed -i '/^\${key}=\${value}$/d' .env || true

upsert_env() {
  local key="\$1"
  local value="\$2"

  if grep -q "^\${key}=" .env; then
    sed -i "s#^\${key}=.*#\${key}=\${value}#" .env
  else
    echo "\${key}=\${value}" >> .env
  fi
}

upsert_env NGINX_HOST_PORT_80 "\$DEPLOY_NGINX_HOST_PORT_80"
upsert_env NGINX_HOST_PORT_443 "\$DEPLOY_NGINX_HOST_PORT_443"

resolve_health_host() {
  local app_url_line source host

  source="\${DEPLOY_HEALTH_HOST_RAW:-}"
  if [[ -z "\$source" ]]; then
    app_url_line="\$(grep '^APP_URL=' .env | tail -n 1 || true)"
    source="\${app_url_line#APP_URL=}"
  fi

  source="\$(printf '%s' "\$source" | tr -d '\r')"
  source="\${source%%\$'\\n'*}"
  source="\${source#\"\${source%%[![:space:]]*}\"}"
  source="\${source%\"\${source##*[![:space:]]}\"}"

  if [[ "\$source" == *\"://\"* ]]; then
    host="\$(
      python3 - "\$source" <<'PY'
import sys
from urllib.parse import urlparse

parsed = urlparse(sys.argv[1].strip())
print((parsed.hostname or "").strip())
PY
    )"
  else
    host="\$source"
  fi

  host="\${host%%/*}"
  host="\${host%%:*}"
  host="\$(printf '%s' "\$host" | tr -d '\r\n' | xargs)"

  if [[ -z "\$host" ]]; then
    host="localhost"
  fi

  if ! [[ "\$host" =~ ^[A-Za-z0-9.-]+$ ]]; then
    echo "ERROR: invalid health host '\$host' resolved from DEPLOY_HEALTH_HOST/APP_URL." >&2
    return 1
  fi

  echo "\$host"
}

deploy_and_check_health() {
  local health_host health_url status body

  "\${DOCKER_COMPOSE[@]}" up -d --build --remove-orphans
  "\${DOCKER_COMPOSE[@]}" ps

  # Validate runtime readiness without requiring initialized domain data.
  # /api/v1/initialize is expected to return:
  # - 200 (already initialized) or
  # - 403 (not initialized yet)
  health_host="\$(resolve_health_host)"
  health_url="http://127.0.0.1:\${DEPLOY_NGINX_HOST_PORT_80}/api/v1/initialize"
  echo "INFO: waiting for application readiness at \${health_url} (Host: \${health_host})"

  for attempt in \$(seq 1 24); do
    status="\$(
      curl -sS --max-time 5 \
        -H \"Host: \${health_host}\" \
        -o /tmp/deploy_health_response.json \
        -w '%{http_code}' \
        \"\${health_url}\" || true
    )"

    if [[ "\${status}" == "200" || "\${status}" == "403" ]]; then
      body="\$(cat /tmp/deploy_health_response.json 2>/dev/null || true)"
      echo "INFO: readiness check passed with HTTP \${status}."
      if [[ -n "\${body}" ]]; then
        echo "INFO: readiness response: \${body}"
      fi
      return 0
    fi

    echo "INFO: readiness attempt \${attempt}/24 failed (HTTP \${status:-unknown}); retrying in 5s..."
    sleep 5
  done

  return 1
}

if deploy_and_check_health; then
  echo "INFO: \$DEPLOY_LANE deploy completed successfully."
  echo "INFO: last successful revision marker will be updated only after navigation smoke passes."
  exit 0
fi

echo "ERROR: deploy finished but application is not healthy." >&2
"\${DOCKER_COMPOSE[@]}" ps || true
"\${DOCKER_COMPOSE[@]}" logs --tail=200 app worker scheduler nginx || true

if [[ -n "\$previous_revision" ]]; then
  echo "INFO: attempting rollback to previous revision \${previous_revision}..."
  run_git reset --hard "\${previous_revision}"
  run_git submodule sync --recursive
  run_git submodule update --init --recursive

  if deploy_and_check_health; then
    echo "INFO: rollback succeeded; previous version restored."
  else
    echo "ERROR: rollback failed; service may be degraded." >&2
    "\${DOCKER_COMPOSE[@]}" ps || true
    "\${DOCKER_COMPOSE[@]}" logs --tail=200 app worker scheduler nginx || true
  fi
else
  echo "WARN: previous revision not found; rollback skipped." >&2
fi

exit 1
EOF_REMOTE
