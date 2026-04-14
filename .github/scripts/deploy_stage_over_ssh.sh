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
deploy_min_free_gb="${DEPLOY_MIN_FREE_GB:-4}"

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

if ! [[ "${deploy_min_free_gb}" =~ ^[0-9]+$ ]] || (( deploy_min_free_gb < 1 )); then
  echo "ERROR: DEPLOY_MIN_FREE_GB must be a positive integer (received '${deploy_min_free_gb}')." >&2
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
remote_success_marker="__REMOTE_DEPLOY_SUCCESS__"
remote_deploy_log="$(mktemp)"

cleanup_remote_deploy_log() {
  rm -f "${remote_deploy_log}"
}

trap cleanup_remote_deploy_log EXIT

echo "INFO: Starting ${deploy_lane} deploy to ${remote}:${deploy_path}"

set +e
ssh "${ssh_opts[@]}" "${remote}" "bash -se" <<EOF_REMOTE | tee "${remote_deploy_log}"
set -euo pipefail

DEPLOY_PATH='${deploy_path}'
GITHUB_REPOSITORY='${GITHUB_REPOSITORY}'
DEPLOY_BRANCH='${GITHUB_REF_NAME}'
DEPLOY_LANE='${deploy_lane}'
SUBMODULES_REPO_TOKEN='${SUBMODULES_REPO_TOKEN}'
DEPLOY_NGINX_HOST_PORT_80='${deploy_nginx_port_80}'
DEPLOY_NGINX_HOST_PORT_443='${deploy_nginx_port_443}'
DEPLOY_HEALTH_HOST_RAW='${deploy_health_host}'
DEPLOY_MIN_FREE_GB='${deploy_min_free_gb}'

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

DEPLOY_RUNTIME_MUTATED=0

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
  echo "ERROR: missing .env in deploy path. ${deploy_lane} deploys must use the pre-provisioned environment config already present on the host; do not bootstrap from .env.example." >&2
  exit 1
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

normalize_log_stack_channels() {
  local raw_value="\$1"
  local token normalized=()
  local has_mongodb=0
  local has_stderr=0

  IFS=',' read -r -a tokens <<< "\${raw_value}"
  for token in "\${tokens[@]}"; do
    token="\$(printf '%s' "\${token}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
    if [[ -z "\${token}" || "\${token}" == "single" || "\${token}" == "daily" ]]; then
      continue
    fi
    case "\${token}" in
      mongodb)
        has_mongodb=1
        ;;
      stderr)
        has_stderr=1
        ;;
    esac
    normalized+=("\${token}")
  done

  if [[ "\${has_mongodb}" == "0" ]]; then
    normalized+=("mongodb")
  fi
  if [[ "\${has_stderr}" == "0" ]]; then
    normalized+=("stderr")
  fi

  (IFS=','; printf '%s' "\${normalized[*]}")
}

normalize_logging_env() {
  local normalized_stack retention

  upsert_env LOG_CHANNEL stack
  normalized_stack="\$(normalize_log_stack_channels "\$(read_env_value LOG_STACK)")"
  upsert_env LOG_STACK "\${normalized_stack}"

  retention="\$(read_env_value LOG_MONGODB_RETENTION_DAYS)"
  if ! [[ "\${retention}" =~ ^[0-9]+$ ]] || (( retention < 1 )) || (( retention > 30 )); then
    upsert_env LOG_MONGODB_RETENTION_DAYS 14
    echo "WARN: normalized LOG_MONGODB_RETENTION_DAYS to 14."
  fi
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

  echo "ERROR: missing laravel-app/.env. ${deploy_lane} deploys must use the pre-provisioned Laravel environment config already present on the host; do not bootstrap from laravel-app/.env.example." >&2
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

require_laravel_env_value() {
  local key="\$1"
  local value

  value="\$(read_laravel_env_value "\${key}")"
  if [[ -z "\${value}" ]]; then
    echo "ERROR: laravel-app/.env is missing required key '\${key}'. ${deploy_lane} deploys must use an explicitly provisioned environment file, not implicit defaults." >&2
    return 1
  fi
}

normalize_laravel_logging_env() {
  local normalized_stack retention

  upsert_laravel_env LOG_CHANNEL stack
  normalized_stack="\$(normalize_log_stack_channels "\$(read_laravel_env_value LOG_STACK)")"
  upsert_laravel_env LOG_STACK "\${normalized_stack}"

  retention="\$(read_laravel_env_value LOG_MONGODB_RETENTION_DAYS)"
  if ! [[ "\${retention}" =~ ^[0-9]+$ ]] || (( retention < 1 )) || (( retention > 30 )); then
    upsert_laravel_env LOG_MONGODB_RETENTION_DAYS 14
    echo "WARN: normalized laravel-app LOG_MONGODB_RETENTION_DAYS to 14."
  fi
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
normalize_logging_env
normalize_queue_env_for_mongo

if ! ensure_laravel_app_env; then
  exit 1
fi
require_laravel_env_value APP_URL
require_laravel_env_value TRUSTED_PROXIES
normalize_laravel_logging_env
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
  for attempt in \$(seq 1 120); do
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

clear_disk_log_files() {
  echo "INFO: truncating laravel disk logs to protect stage/main disk space..."
  if ! "\${DOCKER_COMPOSE[@]}" exec -T app sh -lc 'mkdir -p /var/www/storage/logs && : > /var/www/storage/logs/laravel.log && find /var/www/storage/logs -maxdepth 1 -type f -name "laravel-*.log" -delete'; then
    echo "ERROR: failed to truncate laravel disk logs." >&2
    return 1
  fi
}

best_effort_clear_disk_log_files() {
  echo "INFO: running best-effort Laravel disk log cleanup before rebuild..."
  if "\${DOCKER_COMPOSE[@]}" exec -T app sh -lc 'mkdir -p /var/www/storage/logs && : > /var/www/storage/logs/laravel.log && find /var/www/storage/logs -maxdepth 1 -type f -name "laravel-*.log" -delete' >/dev/null 2>&1; then
    echo "INFO: pre-build Laravel log cleanup completed via running app container."
    return 0
  fi

  echo "WARN: running app container was unavailable for pre-build log cleanup; continuing with Docker prune only." >&2
  return 0
}

best_effort_clear_laravel_composer_cache() {
  local cache_dir="laravel-app/.composer/cache"
  local before_kib after_kib reclaimed_kib

  if [[ ! -d "\${cache_dir}" ]]; then
    echo "INFO: laravel composer cache directory '\${cache_dir}' is absent; skipping."
    return 0
  fi

  before_kib="\$(du -sk "\${cache_dir}" 2>/dev/null | awk '{print \$1}')"
  before_kib="\${before_kib:-0}"

  if ! find "\${cache_dir}" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + >/dev/null 2>&1; then
    if command -v sudo >/dev/null 2>&1; then
      if ! sudo find "\${cache_dir}" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + >/dev/null 2>&1; then
        echo "WARN: failed to clear \${cache_dir} even with sudo; continuing." >&2
        return 0
      fi
    else
      echo "WARN: failed to clear \${cache_dir} and sudo is unavailable; continuing." >&2
      return 0
    fi
  fi

  after_kib="\$(du -sk "\${cache_dir}" 2>/dev/null | awk '{print \$1}')"
  after_kib="\${after_kib:-0}"
  reclaimed_kib=\$(( before_kib - after_kib ))
  if (( reclaimed_kib < 0 )); then
    reclaimed_kib=0
  fi
  echo "INFO: pre-build composer cache cleanup reclaimed \${reclaimed_kib} KiB from \${cache_dir}."
  return 0
}

collect_disk_budget_paths() {
  local docker_root_dir

  docker_root_dir="$("\${DOCKER_CMD[@]}" info --format '{{.DockerRootDir}}' 2>/dev/null | tr -d '\r' || true)"

  {
    printf '/\n'
    if [[ -n "\${docker_root_dir}" && -e "\${docker_root_dir}" ]]; then
      printf '%s\n' "\${docker_root_dir}"
    fi
    if [[ -d /var/lib/containerd ]]; then
      printf '/var/lib/containerd\n'
    fi
  } | awk 'NF && !seen[\$0]++'
}

get_free_kib_for_path() {
  local path="\$1"
  df -Pk "\${path}" 2>/dev/null | awk 'NR==2 {print \$4}'
}

print_disk_snapshot() {
  local label="\$1"
  local -a paths=()
  local path

  while IFS= read -r path; do
    [[ -n "\${path}" ]] && paths+=("\${path}")
  done < <(collect_disk_budget_paths)

  echo "INFO: disk snapshot (\${label})"
  if [[ "\${#paths[@]}" -gt 0 ]]; then
    df -h "\${paths[@]}" || true
  fi
  "\${DOCKER_CMD[@]}" system df || true
}

ensure_disk_budget() {
  local phase="\$1"
  local required_kib worst_free_kib=-1 worst_path="" path free_kib

  required_kib=\$(( DEPLOY_MIN_FREE_GB * 1024 * 1024 ))

  while IFS= read -r path; do
    [[ -n "\${path}" ]] || continue
    free_kib="\$(get_free_kib_for_path "\${path}")"
    if ! [[ "\${free_kib}" =~ ^[0-9]+$ ]]; then
      echo "WARN: unable to resolve free disk for path '\${path}' during \${phase} budget check." >&2
      continue
    fi

    if (( worst_free_kib == -1 || free_kib < worst_free_kib )); then
      worst_free_kib="\${free_kib}"
      worst_path="\${path}"
    fi
  done < <(collect_disk_budget_paths)

  if [[ -z "\${worst_path}" ]]; then
    echo "ERROR: unable to determine free disk budget for \${phase}." >&2
    print_disk_snapshot "\${phase}-disk-budget-indeterminate"
    return 1
  fi

  echo "INFO: disk budget check for \${phase}: path=\${worst_path} free_kib=\${worst_free_kib} required_kib=\${required_kib}"
  if (( worst_free_kib < required_kib )); then
    echo "ERROR: insufficient disk budget for \${phase}; need at least \${DEPLOY_MIN_FREE_GB} GiB free after cleanup." >&2
    print_disk_snapshot "\${phase}-disk-budget-failed"
    return 1
  fi

  return 0
}

prebuild_cleanup_and_budget_gate() {
  local phase="\$1"

  print_disk_snapshot "before-\${phase}-cleanup"
  best_effort_clear_disk_log_files || true
  best_effort_clear_laravel_composer_cache || true

  if ! "\${DOCKER_CMD[@]}" container prune -f; then
    echo "WARN: docker container prune failed during \${phase} cleanup; continuing." >&2
  fi

  if ! "\${DOCKER_CMD[@]}" builder prune -af; then
    echo "WARN: docker builder prune failed during \${phase} cleanup; continuing." >&2
  fi

  if ! "\${DOCKER_CMD[@]}" image prune -af; then
    echo "WARN: docker image prune failed during \${phase} cleanup; continuing." >&2
  fi

  print_disk_snapshot "after-\${phase}-cleanup"
  ensure_disk_budget "\${phase}"
}

migration_output_has_fail_marker() {
  local output="\$1"
  printf '%s\n' "\${output}" | grep -Eq '[[:space:]]FAIL$|^ERROR:'
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

  local landlord_output landlord_status
  echo "INFO: running landlord migrations..."
  set +e
  landlord_output="\$("\${DOCKER_COMPOSE[@]}" exec -T app php artisan migrate --database=landlord --path=database/migrations/landlord --force 2>&1)"
  landlord_status=\$?
  set -e
  printf '%s\n' "\${landlord_output}"
  if [[ "\${landlord_status}" -ne 0 ]] || migration_output_has_fail_marker "\${landlord_output}"; then
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

  local tenant_output tenant_status
  echo "INFO: running tenant migrations for \${tenant_count} tenants..."
  echo "INFO: tenant migration path args: \${tenant_migration_paths}"
  set +e
  tenant_output="\$("\${DOCKER_COMPOSE[@]}" exec -T app php artisan tenants:artisan "migrate --database=tenant \${tenant_migration_paths} --force" 2>&1)"
  tenant_status=\$?
  set -e
  printf '%s\n' "\${tenant_output}"
  if [[ "\${tenant_status}" -ne 0 ]] || migration_output_has_fail_marker "\${tenant_output}"; then
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

start_core_runtime_services() {
  echo "INFO: starting core runtime services (app, nginx)..."
  if ! "\${DOCKER_COMPOSE[@]}" build app worker scheduler nginx; then
    echo "ERROR: docker compose build failed for runtime services." >&2
    return 1
  fi

  if ! "\${DOCKER_COMPOSE[@]}" stop worker scheduler >/dev/null 2>&1; then
    echo "WARN: failed to stop existing worker/scheduler containers; continuing." >&2
  fi
  if ! "\${DOCKER_COMPOSE[@]}" rm -f worker scheduler >/dev/null 2>&1; then
    echo "WARN: failed to remove existing worker/scheduler containers; continuing." >&2
  fi

  if ! "\${DOCKER_COMPOSE[@]}" up -d --no-build --remove-orphans app nginx; then
    echo "ERROR: docker compose up failed for core runtime services." >&2
    return 1
  fi
  if ! "\${DOCKER_COMPOSE[@]}" restart nginx; then
    echo "ERROR: nginx restart failed after app replacement." >&2
    return 1
  fi
  "\${DOCKER_COMPOSE[@]}" ps
}

start_async_runtime_services() {
  echo "INFO: starting async runtime services (worker, scheduler)..."
  if ! "\${DOCKER_COMPOSE[@]}" up -d --no-build worker; then
    echo "ERROR: docker compose up failed for worker service." >&2
    return 1
  fi
  if ! "\${DOCKER_COMPOSE[@]}" up -d --no-build scheduler; then
    echo "ERROR: docker compose up failed for async runtime services." >&2
    return 1
  fi
  "\${DOCKER_COMPOSE[@]}" ps
}

deploy_and_check_health() {
  local health_host health_url status body

  DEPLOY_RUNTIME_MUTATED=0
  if ! prebuild_cleanup_and_budget_gate "\${DEPLOY_LANE}-deploy"; then
    return 1
  fi

  DEPLOY_RUNTIME_MUTATED=1
  if ! start_core_runtime_services; then
    return 1
  fi

  if ! wait_for_laravel_artisan; then
    return 1
  fi
  if ! clear_disk_log_files; then
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

  for attempt in \$(seq 1 60); do
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
      if ! start_async_runtime_services; then
        return 1
      fi
      return 0
    fi

    echo "INFO: readiness attempt \${attempt}/60 failed (HTTP \${status:-unknown}); retrying in 5s..."
    sleep 5
  done

  return 1
}

if deploy_and_check_health; then
  prune_docker_artifacts
  echo "INFO: \$DEPLOY_LANE deploy completed successfully."
  echo "INFO: last successful revision marker will be updated only after navigation smoke passes."
  echo "${remote_success_marker}"
  exit 0
fi

echo "ERROR: deploy finished but application is not healthy." >&2
"\${DOCKER_COMPOSE[@]}" ps || true
"\${DOCKER_COMPOSE[@]}" logs --tail=200 app worker scheduler nginx || true

if [[ -n "\$previous_revision" ]]; then
  if [[ "\${DEPLOY_RUNTIME_MUTATED}" != "1" ]]; then
    echo "WARN: deploy failed before runtime mutation; skipping internal rollback rebuild." >&2
    exit 1
  fi

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
ssh_status=${PIPESTATUS[0]}
tee_status=${PIPESTATUS[1]}
set -e

if [[ "${tee_status}" -ne 0 ]]; then
  echo "ERROR: failed to persist remote ${deploy_lane} deploy log locally." >&2
  exit "${tee_status}"
fi

if [[ "${ssh_status}" -ne 0 ]]; then
  echo "ERROR: remote ${deploy_lane} deploy over SSH exited with status ${ssh_status}." >&2
  exit "${ssh_status}"
fi

if ! grep -qx "${remote_success_marker}" "${remote_deploy_log}"; then
  echo "ERROR: remote ${deploy_lane} deploy did not emit the success marker; refusing to continue with stale runtime evidence." >&2
  exit 1
fi
