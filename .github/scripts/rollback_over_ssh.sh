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

echo "INFO: starting rollback on ${remote}:${deploy_path}"

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
ROLLBACK_TARGET_REVISION='${ROLLBACK_TARGET_REVISION:-}'

run_git() {
  GIT_CONFIG_COUNT=1 \
  GIT_CONFIG_KEY_0="url.https://x-access-token:\${SUBMODULES_REPO_TOKEN}@github.com/.insteadOf" \
  GIT_CONFIG_VALUE_0="https://github.com/" \
  git "\$@"
}

if docker compose version >/dev/null 2>&1; then
  DOCKER_COMPOSE=(docker compose)
elif sudo docker compose version >/dev/null 2>&1; then
  DOCKER_COMPOSE=(sudo docker compose)
else
  echo "ERROR: docker compose is unavailable on remote host." >&2
  exit 1
fi

if [[ "${DOCKER_COMPOSE[0]}" == "sudo" ]]; then
  DOCKER_CMD=(sudo docker)
else
  DOCKER_CMD=(docker)
fi

cd "\$DEPLOY_PATH"

target_revision=""
explicit_target="\${ROLLBACK_TARGET_REVISION:-}"
if [[ -n "\$explicit_target" ]]; then
  target_revision="\$(echo "\$explicit_target" | tr -d '[:space:]')"
fi

if [[ -z "\$target_revision" && -f ".last_successful_revision" ]]; then
  target_revision="\$(cat .last_successful_revision | tr -d '[:space:]')"
fi

if [[ -z "\$target_revision" ]]; then
  echo "WARN: rollback target marker missing; falling back to HEAD~1." >&2
  target_revision="\$(git rev-parse HEAD~1)"
fi

if [[ -z "\$target_revision" ]]; then
  echo "ERROR: unable to resolve rollback target revision." >&2
  exit 1
fi

echo "INFO: rollback target revision: \${target_revision}"

run_git fetch --prune origin "\$DEPLOY_BRANCH"
run_git checkout "\$DEPLOY_BRANCH"
run_git reset --hard "\$target_revision"
run_git submodule sync --recursive
run_git submodule update --init --recursive

sync_web_runtime_lane() {
  local lane_ref runtime_web_sha

  lane_ref="origin/\${DEPLOY_LANE}"
  if [[ ! -d "web-app" ]]; then
    echo "ERROR: missing web-app directory after submodule checkout." >&2
    return 1
  fi

  # Keep rollback aligned with lane runtime web source policy.
  run_git -C web-app fetch --prune origin "\${DEPLOY_LANE}"
  run_git -C web-app checkout --detach "\${lane_ref}"

  runtime_web_sha="\$(git -C web-app rev-parse HEAD | tr -d '[:space:]')"
  echo "INFO: rollback runtime web-app lane '\${DEPLOY_LANE}' resolved to \${runtime_web_sha}"
}

if ! sync_web_runtime_lane; then
  echo "ERROR: failed to resolve runtime web-app lane content during rollback." >&2
  exit 1
fi

upsert_env() {
  local key="\$1"
  local value="\$2"

  if grep -q "^\${key}=" .env; then
    sed -i "s#^\${key}=.*#\${key}=\${value}#" .env
  else
    echo "\${key}=\${value}" >> .env
  fi
}

read_env_value() {
  local key="\$1"
  local raw

  raw="\$(grep -E "^\${key}=" .env | tail -n 1 || true)"
  raw="\${raw#\${key}=}"
  raw="\$(printf '%s' "\${raw}" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  raw="\${raw%\"}"
  raw="\${raw#\"}"
  raw="\${raw%\'}"
  raw="\${raw#\'}"
  printf '%s' "\${raw}"
}

normalize_queue_env_for_mongo() {
  local db_connection queue_connection db_queue_connection

  db_connection="\$(read_env_value DB_CONNECTION)"
  db_connection="\$(printf '%s' "\${db_connection}" | tr '[:upper:]' '[:lower:]')"
  queue_connection="\$(read_env_value QUEUE_CONNECTION)"
  queue_connection="\$(printf '%s' "\${queue_connection}" | tr '[:upper:]' '[:lower:]')"
  db_queue_connection="\$(read_env_value DB_QUEUE_CONNECTION)"
  db_queue_connection="\$(printf '%s' "\${db_queue_connection}" | tr '[:upper:]' '[:lower:]')"

  case "\${db_connection}" in
    mongodb*|landlord|tenant)
      if [[ -z "\${queue_connection}" ]]; then
        upsert_env QUEUE_CONNECTION mongodb
        echo "INFO: rollback normalized QUEUE_CONNECTION=mongodb (DB_CONNECTION=\${db_connection})."
        return 0
      fi

      if [[ "\${queue_connection}" == "database" ]] && [[ -z "\${db_queue_connection}" || "\${db_queue_connection}" == "mongodb" || "\${db_queue_connection}" == "landlord" || "\${db_queue_connection}" == "tenant" ]]; then
        upsert_env QUEUE_CONNECTION mongodb
        echo "WARN: rollback normalized QUEUE_CONNECTION=database to mongodb because DB_QUEUE_CONNECTION was unsafe for Mongo primary connection."
      fi
      ;;
  esac
}

ensure_laravel_app_env() {
  if [[ -f "laravel-app/.env" ]]; then
    return 0
  fi

  if [[ -f "laravel-app/.env.example" ]]; then
    cp laravel-app/.env.example laravel-app/.env
    echo "INFO: rollback bootstrap laravel-app/.env from laravel-app/.env.example."
    return 0
  fi

  echo "ERROR: missing both laravel-app/.env and laravel-app/.env.example during rollback." >&2
  return 1
}

upsert_laravel_env() {
  local key="\$1"
  local value="\$2"
  local env_file="laravel-app/.env"

  if grep -q "^\${key}=" "\${env_file}"; then
    sed -i "s#^\${key}=.*#\${key}=\${value}#" "\${env_file}"
  else
    echo "\${key}=\${value}" >> "\${env_file}"
  fi
}

read_laravel_env_value() {
  local key="\$1"
  local env_file="laravel-app/.env"
  local raw

  raw="\$(grep -E "^\${key}=" "\${env_file}" | tail -n 1 || true)"
  raw="\${raw#\${key}=}"
  raw="\$(printf '%s' "\${raw}" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  raw="\${raw%\"}"
  raw="\${raw#\"}"
  raw="\${raw%\'}"
  raw="\${raw#\'}"
  printf '%s' "\${raw}"
}

normalize_laravel_queue_env_for_mongo() {
  local db_connection queue_connection db_queue_connection

  db_connection="\$(read_laravel_env_value DB_CONNECTION)"
  db_connection="\$(printf '%s' "\${db_connection}" | tr '[:upper:]' '[:lower:]')"
  queue_connection="\$(read_laravel_env_value QUEUE_CONNECTION)"
  queue_connection="\$(printf '%s' "\${queue_connection}" | tr '[:upper:]' '[:lower:]')"
  db_queue_connection="\$(read_laravel_env_value DB_QUEUE_CONNECTION)"
  db_queue_connection="\$(printf '%s' "\${db_queue_connection}" | tr '[:upper:]' '[:lower:]')"

  case "\${db_connection}" in
    mongodb*|landlord|tenant)
      if [[ -z "\${queue_connection}" ]]; then
        upsert_laravel_env QUEUE_CONNECTION mongodb
        echo "INFO: rollback normalized laravel-app/.env to QUEUE_CONNECTION=mongodb (DB_CONNECTION=\${db_connection})."
        return 0
      fi

      if [[ "\${queue_connection}" == "database" ]] && [[ -z "\${db_queue_connection}" || "\${db_queue_connection}" == "mongodb" || "\${db_queue_connection}" == "landlord" || "\${db_queue_connection}" == "tenant" ]]; then
        upsert_laravel_env QUEUE_CONNECTION mongodb
        echo "WARN: rollback normalized laravel-app/.env QUEUE_CONNECTION=database to mongodb because DB_QUEUE_CONNECTION was unsafe for Mongo primary connection."
      fi
      ;;
  esac
}

if [[ -f ".env" ]]; then
  upsert_env NGINX_HOST_PORT_80 "\$DEPLOY_NGINX_HOST_PORT_80"
  upsert_env NGINX_HOST_PORT_443 "\$DEPLOY_NGINX_HOST_PORT_443"
  normalize_queue_env_for_mongo
fi

if ! ensure_laravel_app_env; then
  exit 1
fi
normalize_laravel_queue_env_for_mongo

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

  host="\${source#*://}"
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

prune_docker_artifacts() {
  local prune_window="168h"

  echo "INFO: running post-success Docker cleanup (window: \${prune_window})..."
  if ! "\${DOCKER_CMD[@]}" builder prune -af --filter "until=\${prune_window}"; then
    echo "WARN: docker builder prune failed; continuing without blocking rollback." >&2
  fi

  if ! "\${DOCKER_CMD[@]}" image prune -af --filter "until=\${prune_window}"; then
    echo "WARN: docker image prune failed; continuing without blocking rollback." >&2
  fi
}

"\${DOCKER_COMPOSE[@]}" up -d --build --remove-orphans
"\${DOCKER_COMPOSE[@]}" ps

health_host="\$(resolve_health_host)"
health_url="http://127.0.0.1:\${DEPLOY_NGINX_HOST_PORT_80}/api/v1/initialize"
root_health_url="http://127.0.0.1:\${DEPLOY_NGINX_HOST_PORT_80}/"

echo "INFO: waiting for rollback health at \${health_url} (Host: \${health_host})"
for attempt in \$(seq 1 24); do
  if [[ "\${attempt}" == "1" ]]; then
    printf 'INFO: rollback probe host=%q url=%q\n' "\${health_host}" "\${health_url}"
  fi

  curl_cmd=(
    curl
    -sS
    --max-time 5
    -H "Host: \${health_host}"
    -o /tmp/rollback_health_response.json
    -w '%{http_code}'
    "\${health_url}"
  )
  status="\$("\${curl_cmd[@]}" || true)"

  if [[ "\${status}" == "200" || "\${status}" == "403" ]]; then
    echo "INFO: rollback health check passed with HTTP \${status}."
    response_body="\$(cat /tmp/rollback_health_response.json 2>/dev/null || true)"
    if [[ -n "\${response_body}" ]]; then
      echo "INFO: rollback readiness response: \${response_body}"
    fi
    prune_docker_artifacts
    exit 0
  fi

  # Older rollback targets may not expose /api/v1/initialize.
  # In rollback mode only, accept 404 there if landlord root is healthy.
  if [[ "\${status}" == "404" ]]; then
    root_status="$(
      curl -sS --max-time 5 \
        -H "Host: \${health_host}" \
        -o /tmp/rollback_root_health_response.html \
        -w '%{http_code}' \
        "\${root_health_url}" || true
    )"

    if [[ "\${root_status}" == "200" || "\${root_status}" == "301" || "\${root_status}" == "302" ]]; then
      echo "WARN: rollback target returned 404 on /api/v1/initialize; accepting root health HTTP \${root_status} at \${root_health_url}."
      prune_docker_artifacts
      exit 0
    fi
  fi

  echo "INFO: rollback readiness attempt \${attempt}/24 failed (HTTP \${status:-unknown}); retrying in 5s..."
  sleep 5
done

echo "ERROR: rollback deployed but health check did not pass." >&2
"\${DOCKER_COMPOSE[@]}" ps || true
"\${DOCKER_COMPOSE[@]}" logs --tail=200 app worker scheduler nginx || true
exit 1
EOF_REMOTE
