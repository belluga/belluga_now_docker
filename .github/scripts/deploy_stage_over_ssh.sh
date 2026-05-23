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
require_env WEB_APP_RUNTIME_SHA
require_env APP_IMAGE
require_env WORKER_IMAGE
require_env SCHEDULER_IMAGE
require_env NGINX_IMAGE
require_env DEPLOY_TRUSTED_TUPLE_PRESENT
require_env GHCR_USERNAME
require_env GHCR_TOKEN

deploy_lane="${DEPLOY_LANE:-stage}"
if [[ "${deploy_lane}" != "stage" && "${deploy_lane}" != "main" ]]; then
  echo "ERROR: DEPLOY_LANE must be 'stage' or 'main' (received '${deploy_lane}')." >&2
  exit 1
fi

require_immutable_image_ref() {
  local name="$1"
  local value="${!name:-}"

  if [[ -z "${value}" ]]; then
    echo "ERROR: ${name} is required for protected ${deploy_lane} deploys." >&2
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

if ! [[ "${WEB_APP_RUNTIME_SHA}" =~ ^[0-9a-fA-F]{40}$ ]]; then
  echo "ERROR: WEB_APP_RUNTIME_SHA must be a 40-character git SHA resolved before protected deploy." >&2
  exit 1
fi
WEB_APP_RUNTIME_SHA="$(printf '%s' "${WEB_APP_RUNTIME_SHA}" | tr '[:upper:]' '[:lower:]')"

if [[ "${DEPLOY_TRUSTED_TUPLE_PRESENT}" != "true" && "${DEPLOY_TRUSTED_TUPLE_PRESENT}" != "false" ]]; then
  echo "ERROR: DEPLOY_TRUSTED_TUPLE_PRESENT must be exactly 'true' or 'false' (received '${DEPLOY_TRUSTED_TUPLE_PRESENT}')." >&2
  exit 1
fi

for image_var in APP_IMAGE WORKER_IMAGE SCHEDULER_IMAGE NGINX_IMAGE; do
  require_immutable_image_ref "${image_var}"
done

deploy_ssh_host="${DEPLOY_SSH_HOST:-${STAGE_SSH_HOST:-}}"
deploy_ssh_port="${DEPLOY_SSH_PORT:-${STAGE_SSH_PORT:-}}"
deploy_ssh_user="${DEPLOY_SSH_USER:-${STAGE_SSH_USER:-}}"
deploy_path="${DEPLOY_PATH:-${STAGE_DEPLOY_PATH:-}}"
deploy_ssh_key_path="${DEPLOY_SSH_KEY_PATH:-${STAGE_SSH_KEY_PATH:-}}"
deploy_nginx_port_80="${DEPLOY_NGINX_HOST_PORT_80:-${STAGE_NGINX_HOST_PORT_80:-80}}"
deploy_nginx_port_443="${DEPLOY_NGINX_HOST_PORT_443:-${STAGE_NGINX_HOST_PORT_443:-443}}"
deploy_health_host="${DEPLOY_HEALTH_HOST:-}"
deploy_min_free_gb="${DEPLOY_MIN_FREE_GB:-4}"

require_protected_health_host() {
  local source host
  source="$(printf '%s' "${deploy_health_host}" | tr -d '\r')"
  source="${source%%$'\n'*}"
  source="${source#"${source%%[![:space:]]*}"}"
  source="${source%"${source##*[![:space:]]}"}"

  if [[ -z "${source}" ]]; then
    echo "ERROR: DEPLOY_HEALTH_HOST is required for protected ${deploy_lane} deploys. Define the canonical ${deploy_lane} lane landlord URL/host for this lane; implicit fallback to APP_URL or localhost is forbidden." >&2
    exit 1
  fi

  host="${source#*://}"
  host="${host%%/*}"
  host="${host%%:*}"
  host="$(printf '%s' "${host}" | tr -d '\r\n' | xargs)"

  if ! [[ "${host}" =~ ^[A-Za-z0-9.-]+$ ]]; then
    echo "ERROR: invalid health host '${host}' resolved from DEPLOY_HEALTH_HOST. Define the canonical ${deploy_lane} lane landlord URL/host explicitly; implicit fallback is forbidden." >&2
    exit 1
  fi

  printf '%s' "${host}"
}

if [[ -z "${deploy_ssh_host}" || -z "${deploy_ssh_port}" || -z "${deploy_ssh_user}" || -z "${deploy_path}" || -z "${deploy_ssh_key_path}" ]]; then
  echo "ERROR: missing deploy SSH config. Set DEPLOY_SSH_HOST/PORT/USER/PATH/KEY_PATH (or legacy STAGE_* equivalents)." >&2
  exit 1
fi

deploy_health_host="$(require_protected_health_host)"

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
  -o ConnectTimeout=5
  -o ConnectionAttempts=3
  -o ServerAliveInterval=15
  -o ServerAliveCountMax=40
  -o TCPKeepAlive=yes
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
WEB_APP_RUNTIME_SHA='${WEB_APP_RUNTIME_SHA}'
APP_IMAGE='${APP_IMAGE}'
WORKER_IMAGE='${WORKER_IMAGE}'
SCHEDULER_IMAGE='${SCHEDULER_IMAGE}'
NGINX_IMAGE='${NGINX_IMAGE}'
DEPLOY_TRUSTED_TUPLE_PRESENT='${DEPLOY_TRUSTED_TUPLE_PRESENT}'
GHCR_USERNAME='${GHCR_USERNAME}'
GHCR_TOKEN='${GHCR_TOKEN}'
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

require_immutable_image_ref() {
  local name="\$1"
  local value="\${!name:-}"

  if [[ -z "\${value}" ]]; then
    echo "ERROR: \${name} is required for protected \${DEPLOY_LANE} deploys." >&2
    return 1
  fi
  if [[ "\${value}" != ghcr.io/*@sha256:* ]]; then
    echo "ERROR: \${name} must be an immutable GHCR digest reference (received '\${value}')." >&2
    return 1
  fi
  if [[ "\${value}" == *":latest"* ]]; then
    echo "ERROR: \${name} must not use mutable ':latest' image authority." >&2
    return 1
  fi
}

image_digest() {
  local image_ref="\$1"
  local digest="\${image_ref##*@}"
  if ! [[ "\${digest}" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    echo "ERROR: image ref '\${image_ref}' does not contain a valid sha256 digest." >&2
    return 1
  fi
  printf '%s' "\${digest}"
}

for image_var in APP_IMAGE WORKER_IMAGE SCHEDULER_IMAGE NGINX_IMAGE; do
  require_immutable_image_ref "\${image_var}"
done

if ! [[ "\${WEB_APP_RUNTIME_SHA}" =~ ^[0-9a-fA-F]{40}$ ]]; then
  echo "ERROR: WEB_APP_RUNTIME_SHA must be a 40-character git SHA resolved before protected deploy." >&2
  exit 1
fi
WEB_APP_RUNTIME_SHA="\$(printf '%s' "\${WEB_APP_RUNTIME_SHA}" | tr '[:upper:]' '[:lower:]')"

DEPLOY_RUNTIME_MUTATED=0
internal_rollback_status="not_attempted"
internal_rollback_target_revision=""
internal_rollback_target_web_runtime_sha=""

mkdir -p "\$DEPLOY_PATH"

if [[ ! -d "\$DEPLOY_PATH/.git" ]]; then
  run_git clone --recurse-submodules "https://github.com/\$GITHUB_REPOSITORY.git" "\$DEPLOY_PATH"
fi

cd "\$DEPLOY_PATH"
previous_revision=""
previous_web_runtime_sha=""
previous_app_image=""
previous_worker_image=""
previous_scheduler_image=""
previous_nginx_image=""
rollback_protection_ref=""
if [[ "\${DEPLOY_TRUSTED_TUPLE_PRESENT}" == "true" && -f ".last_successful_revision" ]]; then
  marker_content="\$(tr -d '\r' < .last_successful_revision)"
  previous_revision="\$(printf '%s\n' "\${marker_content}" | sed -n 's/^ROOT_SHA=//p' | head -n 1 | tr -d '[:space:]')"
  previous_web_runtime_sha="\$(printf '%s\n' "\${marker_content}" | sed -n 's/^WEB_APP_RUNTIME_SHA=//p' | head -n 1 | tr -d '[:space:]')"
  previous_app_image="\$(printf '%s\n' "\${marker_content}" | sed -n 's/^APP_IMAGE=//p' | head -n 1 | tr -d '[:space:]')"
  previous_worker_image="\$(printf '%s\n' "\${marker_content}" | sed -n 's/^WORKER_IMAGE=//p' | head -n 1 | tr -d '[:space:]')"
  previous_scheduler_image="\$(printf '%s\n' "\${marker_content}" | sed -n 's/^SCHEDULER_IMAGE=//p' | head -n 1 | tr -d '[:space:]')"
  previous_nginx_image="\$(printf '%s\n' "\${marker_content}" | sed -n 's/^NGINX_IMAGE=//p' | head -n 1 | tr -d '[:space:]')"
elif [[ "\${DEPLOY_TRUSTED_TUPLE_PRESENT}" != "true" ]]; then
  echo "INFO: no trusted tuple captured before deploy; internal rollback is disabled for this deploy attempt."
fi

cleanup_rollback_protection_ref() {
  if [[ -z "\${rollback_protection_ref:-}" ]]; then
    return 0
  fi

  if ! git rev-parse --git-dir >/dev/null 2>&1; then
    return 0
  fi

  if ! git update-ref -d "\${rollback_protection_ref}" >/dev/null 2>&1; then
    echo "WARN: failed to clear rollback protection ref \${rollback_protection_ref}; continuing." >&2
  fi
}

emit_remote_deploy_state_markers() {
  echo "DEPLOY_RUNTIME_MUTATED=\${DEPLOY_RUNTIME_MUTATED}"
  echo "INTERNAL_ROLLBACK_STATUS=\${internal_rollback_status}"
  if [[ -n "\${internal_rollback_target_revision}" ]]; then
    echo "INTERNAL_ROLLBACK_TARGET_REVISION=\${internal_rollback_target_revision}"
  fi
  if [[ -n "\${internal_rollback_target_web_runtime_sha}" ]]; then
    echo "INTERNAL_ROLLBACK_TARGET_WEB_APP_RUNTIME_SHA=\${internal_rollback_target_web_runtime_sha}"
  fi
}

remote_exit_trap() {
  local exit_code=$?
  cleanup_rollback_protection_ref
  emit_remote_deploy_state_markers
  return "\${exit_code}"
}

trap remote_exit_trap EXIT

if [[ -n "\${previous_revision}" ]]; then
  rollback_protection_ref="refs/delphi/deploy-rollback/\${DEPLOY_BRANCH//\//-}"
  run_git update-ref "\${rollback_protection_ref}" "\${previous_revision}"
  echo "INFO: protected rollback target \${previous_revision} via \${rollback_protection_ref}"
fi

run_git fetch --prune origin "\$DEPLOY_BRANCH"
run_git checkout "\$DEPLOY_BRANCH"
run_git reset --hard "origin/\$DEPLOY_BRANCH"
run_git submodule sync --recursive
run_git submodule update --init --recursive

checkout_web_runtime_ref() {
  local target_ref="\$1"
  local target_label="\$2"
  local runtime_web_sha
  if [[ ! -d "web-app" ]]; then
    echo "ERROR: missing web-app directory after submodule checkout." >&2
    return 1
  fi

  if [[ "\${target_ref}" == origin/* ]]; then
    run_git -C web-app fetch --prune origin "\${target_ref#origin/}"
  else
    run_git -C web-app fetch --prune origin "\${target_ref}" || true
  fi
  run_git -C web-app checkout --detach "\${target_ref}"

  runtime_web_sha="\$(git -C web-app rev-parse HEAD | tr -d '[:space:]')"
  echo "INFO: runtime web-app \${target_label} resolved to \${runtime_web_sha}"
}

current_web_runtime_sha="\${WEB_APP_RUNTIME_SHA}"
if ! checkout_web_runtime_ref "\${current_web_runtime_sha}" "lane-resolved SHA '\${current_web_runtime_sha}'"; then
  echo "ERROR: failed to resolve protected lane web-app runtime content." >&2
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

write_runtime_image_env() {
  upsert_env APP_IMAGE "\${APP_IMAGE}"
  upsert_env WORKER_IMAGE "\${WORKER_IMAGE}"
  upsert_env SCHEDULER_IMAGE "\${SCHEDULER_IMAGE}"
  upsert_env NGINX_IMAGE "\${NGINX_IMAGE}"
}

login_to_ghcr() {
  if [[ -z "\${GHCR_USERNAME:-}" || -z "\${GHCR_TOKEN:-}" ]]; then
    echo "ERROR: GHCR_USERNAME and GHCR_TOKEN are required for protected \${DEPLOY_LANE} runtime image pulls." >&2
    return 1
  fi

  printf '%s' "\${GHCR_TOKEN}" | "\${DOCKER_CMD[@]}" login ghcr.io -u "\${GHCR_USERNAME}" --password-stdin >/dev/null
}

pull_runtime_images() {
  local image seen_images=" "
  login_to_ghcr

  for image in "\${APP_IMAGE}" "\${WORKER_IMAGE}" "\${SCHEDULER_IMAGE}" "\${NGINX_IMAGE}"; do
    case "\${seen_images}" in
      *" \${image} "*)
        continue
        ;;
    esac
    seen_images+="\${image} "
    echo "INFO: pulling immutable runtime image \${image}"
    "\${DOCKER_CMD[@]}" pull "\${image}"
  done
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

normalize_laravel_cache_env_for_mongo() {
  local db_connection cache_store cache_limiter maintenance_store

  db_connection="\$(read_laravel_env_value DB_CONNECTION)"
  db_connection="\$(printf '%s' "\${db_connection}" | tr '[:upper:]' '[:lower:]')"
  cache_store="\$(read_laravel_env_value CACHE_STORE)"
  cache_store="\$(printf '%s' "\${cache_store}" | tr '[:upper:]' '[:lower:]')"
  cache_limiter="\$(read_laravel_env_value CACHE_LIMITER)"
  cache_limiter="\$(printf '%s' "\${cache_limiter}" | tr '[:upper:]' '[:lower:]')"
  maintenance_store="\$(read_laravel_env_value APP_MAINTENANCE_STORE)"
  maintenance_store="\$(printf '%s' "\${maintenance_store}" | tr '[:upper:]' '[:lower:]')"

  case "\${db_connection}" in
    mongodb*|landlord|tenant)
      if [[ -z "\${cache_store}" || "\${cache_store}" == "database" ]]; then
        upsert_laravel_env CACHE_STORE mongodb
        echo "WARN: normalized laravel-app/.env CACHE_STORE=\${cache_store:-<empty>} to mongodb because DB_CONNECTION=\${db_connection}."
      fi

      if [[ -z "\${cache_limiter}" || "\${cache_limiter}" == "database" ]]; then
        upsert_laravel_env CACHE_LIMITER mongodb
        echo "WARN: normalized laravel-app/.env CACHE_LIMITER=\${cache_limiter:-<empty>} to mongodb because DB_CONNECTION=\${db_connection}."
      fi

      if [[ -z "\${maintenance_store}" || "\${maintenance_store}" == "database" ]]; then
        upsert_laravel_env APP_MAINTENANCE_STORE mongodb
        echo "WARN: normalized laravel-app/.env APP_MAINTENANCE_STORE=\${maintenance_store:-<empty>} to mongodb because DB_CONNECTION=\${db_connection}."
      fi
      ;;
  esac
}

require_laravel_mongodb_cache_env() {
  local db_connection key value

  db_connection="\$(read_laravel_env_value DB_CONNECTION)"
  db_connection="\$(printf '%s' "\${db_connection}" | tr '[:upper:]' '[:lower:]')"
  case "\${db_connection}" in
    mongodb*|landlord|tenant)
      ;;
    *)
      return 0
      ;;
  esac

  for key in CACHE_STORE CACHE_LIMITER APP_MAINTENANCE_STORE; do
    value="\$(read_laravel_env_value "\${key}")"
    value="\$(printf '%s' "\${value}" | tr '[:upper:]' '[:lower:]')"
    if [[ "\${value}" != "mongodb" ]]; then
      echo "ERROR: laravel-app/.env must end deploy with \${key}=mongodb for MongoDB lanes (found '\${value:-<empty>}')." >&2
      return 1
    fi
  done
}

upsert_env NGINX_HOST_PORT_80 "\$DEPLOY_NGINX_HOST_PORT_80"
upsert_env NGINX_HOST_PORT_443 "\$DEPLOY_NGINX_HOST_PORT_443"
write_runtime_image_env
normalize_logging_env
normalize_queue_env_for_mongo

if ! ensure_laravel_app_env; then
  exit 1
fi
require_laravel_env_value APP_URL
require_laravel_env_value TRUSTED_PROXIES
normalize_laravel_logging_env
normalize_laravel_queue_env_for_mongo
normalize_laravel_cache_env_for_mongo
require_laravel_mongodb_cache_env

resolve_health_host() {
  local source host

  source="\${DEPLOY_HEALTH_HOST_RAW:-}"
  source="\$(printf '%s' "\$source" | tr -d '\r')"
  source="\${source%%\$'\\n'*}"
  source="\${source#\"\${source%%[![:space:]]*}\"}"
  source="\${source%\"\${source##*[![:space:]]}\"}"

  if [[ -z "\$source" ]]; then
    echo "ERROR: DEPLOY_HEALTH_HOST is required for protected \${DEPLOY_LANE} deploys. Define the canonical \${DEPLOY_LANE} lane landlord URL/host for this lane; implicit fallback to APP_URL or localhost is forbidden." >&2
    return 1
  fi

  host="\${source#*://}"
  host="\${host%%/*}"
  host="\${host%%:*}"
  host="\$(printf '%s' "\$host" | tr -d '\r\n' | xargs)"

  if ! [[ "\$host" =~ ^[A-Za-z0-9.-]+$ ]]; then
    echo "ERROR: invalid health host '\$host' resolved from DEPLOY_HEALTH_HOST. Define the canonical \${DEPLOY_LANE} lane landlord URL/host explicitly; implicit fallback is forbidden." >&2
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

best_effort_compact_git_checkout() {
  local repo_path git_dir before_kib after_kib reclaimed_kib
  local -a repo_paths=(
    "."
    "flutter-app"
    "foundation_documentation"
    "laravel-app"
    "web-app"
  )

  echo "INFO: running best-effort git object compaction before rebuild..."

  for repo_path in "\${repo_paths[@]}"; do
    git_dir="\$(git -C "\${repo_path}" rev-parse --git-dir 2>/dev/null || true)"
    if [[ -z "\${git_dir}" ]]; then
      echo "INFO: skipped git compaction for '\${repo_path}' because the checkout is unavailable."
      continue
    fi
    if [[ "\${git_dir}" != /* ]]; then
      git_dir="\${repo_path}/\${git_dir}"
    fi

    before_kib="\$(du -sk "\${git_dir}" 2>/dev/null | awk '{print \$1}')"
    before_kib="\${before_kib:-0}"

    if ! git -C "\${repo_path}" reflog expire --expire=now --all >/dev/null 2>&1; then
      echo "WARN: git reflog cleanup failed for '\${repo_path}'; continuing." >&2
      continue
    fi

    if ! git -C "\${repo_path}" gc --prune=now >/dev/null 2>&1; then
      echo "WARN: git gc failed for '\${repo_path}'; continuing." >&2
      continue
    fi

    after_kib="\$(du -sk "\${git_dir}" 2>/dev/null | awk '{print \$1}')"
    after_kib="\${after_kib:-0}"
    reclaimed_kib=\$(( before_kib - after_kib ))
    if (( reclaimed_kib < 0 )); then
      reclaimed_kib=0
    fi

    echo "INFO: git compaction reclaimed \${reclaimed_kib} KiB from '\${git_dir}'."
  done
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
  best_effort_compact_git_checkout || true

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
  echo "INFO: starting core runtime services (app, nginx) from immutable GHCR digests..."
  pull_runtime_images

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
  emit_remote_deploy_state_markers
  if ! prebuild_cleanup_and_budget_gate "\${DEPLOY_LANE}-deploy"; then
    return 1
  fi

  DEPLOY_RUNTIME_MUTATED=1
  emit_remote_deploy_state_markers
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
    internal_rollback_status="skipped_pre_mutation"
    emit_remote_deploy_state_markers
    echo "WARN: deploy failed before runtime mutation; skipping internal rollback." >&2
    exit 1
  fi

  for rollback_image_var in previous_app_image previous_worker_image previous_scheduler_image previous_nginx_image; do
    if [[ -z "\${!rollback_image_var:-}" ]]; then
      internal_rollback_status="failure"
      emit_remote_deploy_state_markers
      echo "ERROR: previous successful tuple is missing \${rollback_image_var}; protected rollback cannot fall back to host-local builds." >&2
      exit 1
    fi
  done

  echo "INFO: attempting rollback to previous revision \${previous_revision}..."
  internal_rollback_status="attempting"
  emit_remote_deploy_state_markers
  run_git reset --hard "\${previous_revision}"
  run_git submodule sync --recursive
  run_git submodule update --init --recursive

  rollback_web_runtime_sha="\${previous_web_runtime_sha}"
  if [[ -z "\${rollback_web_runtime_sha}" ]]; then
    internal_rollback_status="failure"
    emit_remote_deploy_state_markers
    echo "ERROR: previous successful tuple is missing WEB_APP_RUNTIME_SHA; protected rollback cannot fall back to gitlinks." >&2
    exit 1
  fi
  if ! checkout_web_runtime_ref "\${rollback_web_runtime_sha}" "rollback target '\${rollback_web_runtime_sha}'"; then
    internal_rollback_status="failure"
    emit_remote_deploy_state_markers
    echo "ERROR: failed to restore rollback web-app runtime content." >&2
    exit 1
  fi

  internal_rollback_target_revision="\${previous_revision}"
  internal_rollback_target_web_runtime_sha="\${rollback_web_runtime_sha}"
  APP_IMAGE="\${previous_app_image}"
  WORKER_IMAGE="\${previous_worker_image}"
  SCHEDULER_IMAGE="\${previous_scheduler_image}"
  NGINX_IMAGE="\${previous_nginx_image}"
  for image_var in APP_IMAGE WORKER_IMAGE SCHEDULER_IMAGE NGINX_IMAGE; do
    require_immutable_image_ref "\${image_var}"
  done
  write_runtime_image_env
  emit_remote_deploy_state_markers

  if deploy_and_check_health; then
    prune_docker_artifacts
    internal_rollback_status="success"
    emit_remote_deploy_state_markers
    echo "INFO: rollback succeeded; previous version restored."
  else
    internal_rollback_status="failure"
    emit_remote_deploy_state_markers
    echo "ERROR: rollback failed; service is in explicit degraded/incident state." >&2
    "\${DOCKER_COMPOSE[@]}" ps || true
    "\${DOCKER_COMPOSE[@]}" logs --tail=200 app worker scheduler nginx || true
  fi
else
  internal_rollback_status="skipped_no_previous_revision"
  emit_remote_deploy_state_markers
  echo "WARN: previous revision not found; rollback skipped." >&2
fi

exit 1
EOF_REMOTE
pipeline_status=("${PIPESTATUS[@]}")
ssh_status=${pipeline_status[0]:-1}
tee_status=${pipeline_status[1]:-1}
set -e

internal_rollback_status="$(
  sed -n 's/^INTERNAL_ROLLBACK_STATUS=//p' "${remote_deploy_log}" | tail -n 1 | tr -d '\r[:space:]'
)"
internal_rollback_target_revision="$(
  sed -n 's/^INTERNAL_ROLLBACK_TARGET_REVISION=//p' "${remote_deploy_log}" | tail -n 1 | tr -d '\r[:space:]'
)"
internal_rollback_target_web_runtime_sha="$(
  sed -n 's/^INTERNAL_ROLLBACK_TARGET_WEB_APP_RUNTIME_SHA=//p' "${remote_deploy_log}" | tail -n 1 | tr -d '\r[:space:]'
)"
runtime_mutated_marker="$(
  sed -n 's/^DEPLOY_RUNTIME_MUTATED=//p' "${remote_deploy_log}" | tail -n 1 | tr -d '\r[:space:]'
)"
runtime_mutated_output=false
if [[ "${runtime_mutated_marker}" == "1" ]]; then
  runtime_mutated_output=true
fi

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    echo "runtime_mutated=${runtime_mutated_output}"
    echo "internal_rollback_status=${internal_rollback_status:-not_attempted}"
    if [[ -n "${internal_rollback_target_revision}" ]]; then
      echo "internal_rollback_target_revision=${internal_rollback_target_revision}"
    fi
    if [[ -n "${internal_rollback_target_web_runtime_sha}" ]]; then
      echo "internal_rollback_target_web_runtime_sha=${internal_rollback_target_web_runtime_sha}"
    fi
  } >> "${GITHUB_OUTPUT}"
fi

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
