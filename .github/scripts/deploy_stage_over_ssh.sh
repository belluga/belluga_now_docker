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

if [[ "\${DOCKER_COMPOSE[0]}" == "sudo" ]]; then
  DOCKER_CMD=(sudo docker)
else
  DOCKER_CMD=(docker)
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

sync_web_runtime_lane() {
  local lane_ref runtime_web_sha

  lane_ref="origin/\${DEPLOY_LANE}"
  if [[ ! -d "web-app" ]]; then
    echo "ERROR: missing web-app directory after submodule checkout." >&2
    return 1
  fi

  # Web is a lane-derived runtime artifact. Always deploy from lane branch
  # instead of relying on promotable web gitlink contracts.
  run_git -C web-app fetch --prune origin "\${DEPLOY_LANE}"
  run_git -C web-app checkout --detach "\${lane_ref}"

  runtime_web_sha="\$(git -C web-app rev-parse HEAD | tr -d '[:space:]')"
  echo "INFO: runtime web-app lane '\${DEPLOY_LANE}' resolved to \${runtime_web_sha}"
}

if ! sync_web_runtime_lane; then
  echo "ERROR: failed to resolve runtime web-app lane content." >&2
  exit 1
fi

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
        echo "INFO: queue env normalized to QUEUE_CONNECTION=mongodb (DB_CONNECTION=\${db_connection})."
        return 0
      fi

      if [[ "\${queue_connection}" == "database" ]] && [[ -z "\${db_queue_connection}" || "\${db_queue_connection}" == "mongodb" || "\${db_queue_connection}" == "landlord" || "\${db_queue_connection}" == "tenant" ]]; then
        upsert_env QUEUE_CONNECTION mongodb
        echo "WARN: normalized QUEUE_CONNECTION=database to mongodb because DB_QUEUE_CONNECTION was unsafe for Mongo primary connection."
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
    echo "INFO: bootstrap laravel-app/.env from laravel-app/.env.example on first deploy."
    return 0
  fi

  echo "ERROR: missing both laravel-app/.env and laravel-app/.env.example." >&2
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
        echo "INFO: laravel-app/.env normalized to QUEUE_CONNECTION=mongodb (DB_CONNECTION=\${db_connection})."
        return 0
      fi

      if [[ "\${queue_connection}" == "database" ]] && [[ -z "\${db_queue_connection}" || "\${db_queue_connection}" == "mongodb" || "\${db_queue_connection}" == "landlord" || "\${db_queue_connection}" == "tenant" ]]; then
        upsert_laravel_env QUEUE_CONNECTION mongodb
        echo "WARN: laravel-app/.env normalized QUEUE_CONNECTION=database to mongodb because DB_QUEUE_CONNECTION was unsafe for Mongo primary connection."
      fi
      ;;
  esac
}

upsert_env NGINX_HOST_PORT_80 "\$DEPLOY_NGINX_HOST_PORT_80"
upsert_env NGINX_HOST_PORT_443 "\$DEPLOY_NGINX_HOST_PORT_443"
normalize_queue_env_for_mongo

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

wait_for_laravel_artisan() {
  # Entry-point may still be running composer/install/caches on fresh deploys.
  # We wait for artisan to become available before running migrations.
  for attempt in \$(seq 1 30); do
    if "\${DOCKER_COMPOSE[@]}" exec -T app php artisan --version >/dev/null 2>&1; then
      return 0
    fi
    if [[ "\$attempt" == "1" ]]; then
      echo "INFO: waiting for Laravel artisan to become available..."
    fi
    sleep 2
  done
  echo "ERROR: Laravel artisan did not become available in time." >&2
  "\${DOCKER_COMPOSE[@]}" ps || true
  "\${DOCKER_COMPOSE[@]}" logs --tail=200 app || true
  return 1
}

run_migrations() {
  resolve_tenant_migration_path_args() {
    local tenant_paths_raw tenant_paths

    tenant_paths_raw="\$(
      "\${DOCKER_COMPOSE[@]}" exec -T app php -r \
        'require "vendor/autoload.php"; \$app=require "bootstrap/app.php"; \$app->make(\Illuminate\Contracts\Console\Kernel::class)->bootstrap(); \$paths=(array) config("multitenancy.tenant_migration_paths", ["database/migrations/tenants"]); \$paths=array_values(array_filter(array_map(static fn(\$path) => trim((string) \$path), \$paths), static fn(\$path) => \$path !== "")); foreach (\$paths as \$path) { echo "--path={\$path}\n"; }' \
        2>/dev/null | tr -d '\r' || true
    )"

    tenant_paths="\$(printf '%s\n' "\${tenant_paths_raw}" | awk 'NF {print \$0}' | paste -sd' ' -)"
    if [[ -z "\${tenant_paths}" ]]; then
      tenant_paths="--path=database/migrations/tenants"
      echo "WARN: unable to resolve multitenancy tenant migration paths; using fallback '\${tenant_paths}'."
    fi

    printf '%s' "\${tenant_paths}"
  }

  echo "INFO: running landlord migrations..."
  if ! "\${DOCKER_COMPOSE[@]}" exec -T app php artisan migrate \
    --database=landlord \
    --path=database/migrations/landlord \
    --force; then
    echo "ERROR: landlord migrations failed." >&2
    return 1
  fi

  # Tenant migrations should not block first deploys before initialization.
  # We detect tenant count via landlord connection and only then run tenants:artisan.
  local tenant_count
  tenant_count="\$(
    "\${DOCKER_COMPOSE[@]}" exec -T app php -r \
      'require "vendor/autoload.php"; \$app=require "bootstrap/app.php"; \$app->make(\Illuminate\Contracts\Console\Kernel::class)->bootstrap(); echo (string) \App\Models\Landlord\Tenant::query()->count();' \
      2>/dev/null | tr -d '\r' | tail -n 1 || true
  )"
  tenant_count="\$(printf '%s' "\${tenant_count}" | tr -dc '0-9')"

  if [[ -z "\${tenant_count}" || "\${tenant_count}" == "0" ]]; then
    echo "INFO: no tenants found; skipping tenant migrations."
    return 0
  fi

  local tenant_migration_paths
  tenant_migration_paths="\$(resolve_tenant_migration_path_args)"

  echo "INFO: running tenant migrations for \${tenant_count} tenants..."
  echo "INFO: tenant migration path args: \${tenant_migration_paths}"
  if ! "\${DOCKER_COMPOSE[@]}" exec -T app php artisan tenants:artisan \
    "migrate --database=tenant \${tenant_migration_paths} --force"; then
    echo "ERROR: tenant migrations failed." >&2
    return 1
  fi
}

prune_docker_artifacts() {
  local prune_window="168h"

  echo "INFO: running post-success Docker cleanup (window: \${prune_window})..."
  if ! "\${DOCKER_CMD[@]}" builder prune -af --filter "until=\${prune_window}"; then
    echo "WARN: docker builder prune failed; continuing without blocking deploy." >&2
  fi

  if ! "\${DOCKER_CMD[@]}" image prune -af --filter "until=\${prune_window}"; then
    echo "WARN: docker image prune failed; continuing without blocking deploy." >&2
  fi
}

deploy_and_check_health() {
  local health_host health_url status body

  if ! "\${DOCKER_COMPOSE[@]}" up -d --build --remove-orphans; then
    echo "ERROR: docker compose up failed." >&2
    return 1
  fi
  "\${DOCKER_COMPOSE[@]}" ps

  if ! wait_for_laravel_artisan; then
    return 1
  fi
  if ! run_migrations; then
    return 1
  fi

  # Validate runtime readiness without requiring initialized domain data.
  # /api/v1/initialize is expected to return:
  # - 200 (already initialized) or
  # - 403 (not initialized yet)
  health_host="\$(resolve_health_host)"
  health_url="http://127.0.0.1:\${DEPLOY_NGINX_HOST_PORT_80}/api/v1/initialize"
  echo "INFO: waiting for application readiness at \${health_url} (Host: \${health_host})"

  for attempt in \$(seq 1 24); do
    if [[ "\${attempt}" == "1" ]]; then
      printf 'INFO: readiness probe host=%q url=%q\n' "\${health_host}" "\${health_url}"
    fi

    curl_cmd=(
      curl
      -sS
      --max-time 5
      -H "Host: \${health_host}"
      -o /tmp/deploy_health_response.json
      -w '%{http_code}'
      "\${health_url}"
    )
    status="\$("\${curl_cmd[@]}" || true)"

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
  prune_docker_artifacts
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
    prune_docker_artifacts
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
