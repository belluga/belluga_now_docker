#!/usr/bin/env bash
set -euo pipefail

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "ERROR: required environment variable '$name' is missing on rollback remote." >&2
    exit 1
  fi
}

for required in \
  DEPLOY_PATH \
  GITHUB_REPOSITORY \
  DEPLOY_BRANCH \
  DEPLOY_LANE \
  SUBMODULES_REPO_TOKEN \
  GHCR_USERNAME \
  GHCR_TOKEN \
  DEPLOY_NGINX_HOST_PORT_80 \
  DEPLOY_NGINX_HOST_PORT_443 \
  DEPLOY_MIN_FREE_GB; do
  require_env "$required"
done

require_protected_health_host() {
  local source host

  source="${DEPLOY_HEALTH_HOST_RAW:-}"
  source="$(printf '%s' "$source" | tr -d '\r')"
  source="${source%%$'\n'*}"
  source="${source#"${source%%[![:space:]]*}"}"
  source="${source%"${source##*[![:space:]]}"}"

  if [[ -z "$source" ]]; then
    echo "ERROR: DEPLOY_HEALTH_HOST is required for protected ${DEPLOY_LANE} rollbacks. Define the canonical ${DEPLOY_LANE} lane landlord URL/host for this lane; implicit fallback to APP_URL or localhost is forbidden." >&2
    exit 1
  fi

  source="${source#http://}"
  source="${source#https://}"
  source="${source%%/*}"
  source="${source%%:*}"

  host="$(printf '%s' "$source" | tr -d '\r\n' | xargs)"
  if ! [[ "$host" =~ ^[A-Za-z0-9.-]+$ ]]; then
    echo "ERROR: invalid health host '$host' resolved from DEPLOY_HEALTH_HOST. Define the canonical ${DEPLOY_LANE} lane landlord URL/host explicitly; implicit fallback is forbidden." >&2
    exit 1
  fi

  printf '%s' "$host"
}

PROTECTED_HEALTH_HOST="$(require_protected_health_host)"

run_git() {
  GIT_CONFIG_COUNT=1 \
  GIT_CONFIG_KEY_0="url.https://x-access-token:${SUBMODULES_REPO_TOKEN}@github.com/.insteadOf" \
  GIT_CONFIG_VALUE_0="https://github.com/" \
  git "$@"
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

require_immutable_image_ref() {
  local name="$1"
  local value="${!name:-}"

  if [[ -z "${value}" ]]; then
    echo "ERROR: ${name} is required for protected ${DEPLOY_LANE} rollback." >&2
    return 1
  fi
  if [[ "${value}" != ghcr.io/*@sha256:* ]]; then
    echo "ERROR: ${name} must be an immutable GHCR digest reference (received '${value}')." >&2
    return 1
  fi
  if [[ "${value}" == *":latest"* ]]; then
    echo "ERROR: ${name} must not use mutable ':latest' image authority." >&2
    return 1
  fi
}

login_to_ghcr() {
  if [[ -z "${GHCR_USERNAME:-}" || -z "${GHCR_TOKEN:-}" ]]; then
    echo "ERROR: GHCR_USERNAME and GHCR_TOKEN are required for protected ${DEPLOY_LANE} rollback image pulls." >&2
    return 1
  fi

  printf '%s' "${GHCR_TOKEN}" | "${DOCKER_CMD[@]}" login ghcr.io -u "${GHCR_USERNAME}" --password-stdin >/dev/null
}

pull_runtime_images() {
  local image seen_images=" "
  login_to_ghcr

  for image in "${APP_IMAGE}" "${WORKER_IMAGE}" "${SCHEDULER_IMAGE}" "${NGINX_IMAGE}"; do
    case "${seen_images}" in
      *" ${image} "*)
        continue
        ;;
    esac
    seen_images+="${image} "
    echo "INFO: pulling rollback immutable runtime image ${image}"
    "${DOCKER_CMD[@]}" pull "${image}"
  done
}

cd "$DEPLOY_PATH"

target_revision=""
target_web_runtime_sha=""
target_app_image=""
target_worker_image=""
target_scheduler_image=""
target_nginx_image=""
marker_root_sha=""
marker_web_runtime_sha=""
marker_app_image=""
marker_worker_image=""
marker_scheduler_image=""
marker_nginx_image=""
explicit_target="${ROLLBACK_TARGET_REVISION:-}"
if [[ -n "$explicit_target" ]]; then
  target_revision="$(echo "$explicit_target" | tr -d '[:space:]')"
fi

if [[ -f ".last_successful_revision" ]]; then
  marker_content="$(tr -d '\r' < .last_successful_revision)"
  if printf '%s\n' "${marker_content}" | grep -Eq '^[0-9a-fA-F]{40}$'; then
    marker_root_sha="$(printf '%s' "${marker_content}" | tr -d '[:space:]')"
  else
    marker_root_sha="$(printf '%s\n' "${marker_content}" | sed -n 's/^ROOT_SHA=//p' | head -n 1 | tr -d '[:space:]')"
    marker_web_runtime_sha="$(printf '%s\n' "${marker_content}" | sed -n 's/^WEB_APP_RUNTIME_SHA=//p' | head -n 1 | tr -d '[:space:]')"
    marker_app_image="$(printf '%s\n' "${marker_content}" | sed -n 's/^APP_IMAGE=//p' | head -n 1 | tr -d '[:space:]')"
    marker_worker_image="$(printf '%s\n' "${marker_content}" | sed -n 's/^WORKER_IMAGE=//p' | head -n 1 | tr -d '[:space:]')"
    marker_scheduler_image="$(printf '%s\n' "${marker_content}" | sed -n 's/^SCHEDULER_IMAGE=//p' | head -n 1 | tr -d '[:space:]')"
    marker_nginx_image="$(printf '%s\n' "${marker_content}" | sed -n 's/^NGINX_IMAGE=//p' | head -n 1 | tr -d '[:space:]')"
  fi
fi

if [[ -z "$target_revision" ]]; then
  target_revision="${marker_root_sha}"
fi

if [[ -z "$target_revision" || -z "${marker_root_sha}" || "$target_revision" != "$marker_root_sha" ]]; then
  echo "ERROR: unable to resolve rollback target from a trusted complete successful-release tuple; protected rollback will not fall back to explicit revisions or host state." >&2
  exit 1
fi

target_web_runtime_sha="${marker_web_runtime_sha}"
target_app_image="${marker_app_image}"
target_worker_image="${marker_worker_image}"
target_scheduler_image="${marker_scheduler_image}"
target_nginx_image="${marker_nginx_image}"

if [[ -z "${target_web_runtime_sha}" ]]; then
  echo "ERROR: successful-release tuple is missing WEB_APP_RUNTIME_SHA; protected rollback will not fall back to gitlinks." >&2
  exit 1
fi

for image_value_name in target_app_image target_worker_image target_scheduler_image target_nginx_image; do
  if [[ -z "${!image_value_name:-}" ]]; then
    echo "ERROR: successful-release tuple is missing ${image_value_name}; protected rollback will not fall back to host-local builds." >&2
    exit 1
  fi
done

APP_IMAGE="${target_app_image}"
WORKER_IMAGE="${target_worker_image}"
SCHEDULER_IMAGE="${target_scheduler_image}"
NGINX_IMAGE="${target_nginx_image}"

echo "INFO: rollback target revision: ${target_revision}"
echo "INFO: rollback target web-app runtime SHA: ${target_web_runtime_sha}"

for image_var in APP_IMAGE WORKER_IMAGE SCHEDULER_IMAGE NGINX_IMAGE; do
  require_immutable_image_ref "${image_var}"
done

run_git fetch --prune origin "$DEPLOY_BRANCH"
run_git checkout "$DEPLOY_BRANCH"
run_git reset --hard "$target_revision"
run_git submodule sync --recursive
run_git submodule update --init --recursive

checkout_web_runtime_ref() {
  local target_ref="$1"
  local target_label="$2"
  local runtime_web_sha
  if [[ ! -d "web-app" ]]; then
    echo "ERROR: missing web-app directory after submodule checkout." >&2
    return 1
  fi

  if [[ "${target_ref}" == origin/* ]]; then
    run_git -C web-app fetch --prune origin "${target_ref#origin/}"
  else
    run_git -C web-app fetch --prune origin "${target_ref}" || true
  fi
  run_git -C web-app checkout --detach "${target_ref}"

  runtime_web_sha="$(git -C web-app rev-parse HEAD | tr -d '[:space:]')"
  echo "INFO: rollback runtime web-app ${target_label} resolved to ${runtime_web_sha}"
}

if ! checkout_web_runtime_ref "${target_web_runtime_sha}" "target '${target_web_runtime_sha}'"; then
  echo "ERROR: failed to resolve runtime web-app content during rollback." >&2
  exit 1
fi

upsert_env() {
  local key="$1"
  local value="$2"

  python3 - "$key" "$value" <<'PY'
import pathlib
import sys

key = sys.argv[1]
value = sys.argv[2]
path = pathlib.Path(".env")
lines = path.read_text().splitlines()
prefix = key + "="
updated = False
new_lines = []
for line in lines:
    if line.startswith(prefix):
        new_lines.append(prefix + value)
        updated = True
    else:
        new_lines.append(line)
if not updated:
    new_lines.append(prefix + value)
path.write_text("\n".join(new_lines) + "\n")
PY
}

write_runtime_image_env() {
  upsert_env APP_IMAGE "${APP_IMAGE}"
  upsert_env WORKER_IMAGE "${WORKER_IMAGE}"
  upsert_env SCHEDULER_IMAGE "${SCHEDULER_IMAGE}"
  upsert_env NGINX_IMAGE "${NGINX_IMAGE}"
}

read_env_value() {
  local key="$1"
  python3 - "$key" <<'PY'
import pathlib
import sys

key = sys.argv[1]
path = pathlib.Path(".env")
if not path.exists():
    sys.exit(1)

prefix = key + "="
for line in path.read_text().splitlines():
    if line.startswith(prefix):
        print(line[len(prefix):])
        break
PY
}

read_laravel_env_value() {
  local key="$1"
  python3 - "$key" <<'PY'
import pathlib
import sys

key = sys.argv[1]
path = pathlib.Path("laravel-app/.env")
if not path.exists():
    sys.exit(1)

prefix = key + "="
for line in path.read_text().splitlines():
    if line.startswith(prefix):
        print(line[len(prefix):])
        break
PY
}

upsert_laravel_env() {
  local key="$1"
  local value="$2"

  python3 - "$key" "$value" <<'PY'
import pathlib
import sys

key = sys.argv[1]
value = sys.argv[2]
path = pathlib.Path("laravel-app/.env")
if not path.exists():
    raise SystemExit("laravel-app/.env is missing")

lines = path.read_text().splitlines()
prefix = key + "="
updated = False
new_lines = []
for line in lines:
    if line.startswith(prefix):
        new_lines.append(prefix + value)
        updated = True
    else:
        new_lines.append(line)
if not updated:
    new_lines.append(prefix + value)
path.write_text("\n".join(new_lines) + "\n")
PY
}

require_laravel_env_value() {
  local key="$1"
  local value
  value="$(read_laravel_env_value "$key" || true)"
  if [[ -z "${value}" ]]; then
    echo "ERROR: laravel-app/.env is missing required ${key} during rollback." >&2
    return 1
  fi
}

ensure_laravel_app_env() {
  if [[ ! -f "laravel-app/.env" ]]; then
    echo "ERROR: missing laravel-app/.env during rollback. ${DEPLOY_LANE} rollback must use the environment config already provisioned on the host; do not bootstrap from examples." >&2
    return 1
  fi
}

normalize_queue_env_for_mongo() {
  local db_connection queue_connection db_queue_connection
  db_connection="$(read_env_value DB_CONNECTION)"
  db_connection="$(printf '%s' "${db_connection}" | tr '[:upper:]' '[:lower:]')"
  queue_connection="$(read_env_value QUEUE_CONNECTION)"
  queue_connection="$(printf '%s' "${queue_connection}" | tr '[:upper:]' '[:lower:]')"
  db_queue_connection="$(read_env_value DB_QUEUE_CONNECTION)"
  db_queue_connection="$(printf '%s' "${db_queue_connection}" | tr '[:upper:]' '[:lower:]')"

  case "${db_connection}" in
    mongodb*|landlord|tenant)
      if [[ -z "${queue_connection}" ]]; then
        upsert_env QUEUE_CONNECTION mongodb
        echo "INFO: rollback normalized root .env QUEUE_CONNECTION to mongodb (DB_CONNECTION=${db_connection})."
        return 0
      fi

      case "${queue_connection}" in
        mongodb*|landlord|tenant)
          upsert_env QUEUE_CONNECTION mongodb
          ;;
        database)
          if [[ -z "${db_queue_connection}" || "${db_queue_connection}" == "mongodb" || "${db_queue_connection}" == "landlord" || "${db_queue_connection}" == "tenant" ]]; then
            upsert_env QUEUE_CONNECTION mongodb
            echo "WARN: rollback normalized root .env QUEUE_CONNECTION=database to mongodb because DB_QUEUE_CONNECTION was unsafe for Mongo primary connection."
          fi
          ;;
      esac
      ;;
  esac
}

normalize_laravel_queue_env_for_mongo() {
  local db_connection queue_connection failed_driver

  db_connection="$(read_laravel_env_value DB_CONNECTION)"
  db_connection="$(printf '%s' "${db_connection}" | tr '[:upper:]' '[:lower:]')"
  queue_connection="$(read_laravel_env_value QUEUE_CONNECTION)"
  queue_connection="$(printf '%s' "${queue_connection}" | tr '[:upper:]' '[:lower:]')"
  failed_driver="$(read_laravel_env_value QUEUE_FAILED_DRIVER)"
  failed_driver="$(printf '%s' "${failed_driver}" | tr '[:upper:]' '[:lower:]')"

  case "${db_connection}" in
    mongodb*|landlord|tenant)
      if [[ -z "${queue_connection}" || "${queue_connection}" == "database" ]]; then
        upsert_laravel_env QUEUE_CONNECTION mongodb
        echo "WARN: rollback normalized laravel-app/.env QUEUE_CONNECTION=${queue_connection:-<empty>} to mongodb because DB_CONNECTION=${db_connection}."
      fi
      if [[ -z "${failed_driver}" || "${failed_driver}" == "database" ]]; then
        upsert_laravel_env QUEUE_FAILED_DRIVER mongodb
        echo "WARN: rollback normalized laravel-app/.env QUEUE_FAILED_DRIVER=${failed_driver:-<empty>} to mongodb because DB_CONNECTION=${db_connection}."
      fi
      ;;
  esac
}

normalize_laravel_cache_env_for_mongo() {
  local db_connection cache_store cache_limiter maintenance_store

  db_connection="$(read_laravel_env_value DB_CONNECTION)"
  db_connection="$(printf '%s' "${db_connection}" | tr '[:upper:]' '[:lower:]')"
  cache_store="$(read_laravel_env_value CACHE_STORE)"
  cache_store="$(printf '%s' "${cache_store}" | tr '[:upper:]' '[:lower:]')"
  cache_limiter="$(read_laravel_env_value CACHE_LIMITER)"
  cache_limiter="$(printf '%s' "${cache_limiter}" | tr '[:upper:]' '[:lower:]')"
  maintenance_store="$(read_laravel_env_value APP_MAINTENANCE_STORE)"
  maintenance_store="$(printf '%s' "${maintenance_store}" | tr '[:upper:]' '[:lower:]')"

  case "${db_connection}" in
    mongodb*|landlord|tenant)
      if [[ -z "${cache_store}" || "${cache_store}" == "database" ]]; then
        upsert_laravel_env CACHE_STORE mongodb
        echo "WARN: rollback normalized laravel-app/.env CACHE_STORE=${cache_store:-<empty>} to mongodb because DB_CONNECTION=${db_connection}."
      fi

      if [[ -z "${cache_limiter}" || "${cache_limiter}" == "database" ]]; then
        upsert_laravel_env CACHE_LIMITER mongodb
        echo "WARN: rollback normalized laravel-app/.env CACHE_LIMITER=${cache_limiter:-<empty>} to mongodb because DB_CONNECTION=${db_connection}."
      fi

      if [[ -z "${maintenance_store}" || "${maintenance_store}" == "database" ]]; then
        upsert_laravel_env APP_MAINTENANCE_STORE mongodb
        echo "WARN: rollback normalized laravel-app/.env APP_MAINTENANCE_STORE=${maintenance_store:-<empty>} to mongodb because DB_CONNECTION=${db_connection}."
      fi
      ;;
  esac
}

require_laravel_mongodb_cache_env() {
  local db_connection key value

  db_connection="$(read_laravel_env_value DB_CONNECTION)"
  db_connection="$(printf '%s' "${db_connection}" | tr '[:upper:]' '[:lower:]')"
  case "${db_connection}" in
    mongodb*|landlord|tenant)
      ;;
    *)
      return 0
      ;;
  esac

  for key in CACHE_STORE CACHE_LIMITER APP_MAINTENANCE_STORE; do
    value="$(read_laravel_env_value "${key}")"
    value="$(printf '%s' "${value}" | tr '[:upper:]' '[:lower:]')"
    if [[ "${value}" != "mongodb" ]]; then
      echo "ERROR: laravel-app/.env must end rollback with ${key}=mongodb for MongoDB lanes (found '${value:-<empty>}')." >&2
      return 1
    fi
  done
}

if [[ ! -f ".env" ]]; then
  echo "ERROR: missing .env during rollback. ${DEPLOY_LANE} rollback must use the environment config already provisioned on the host; do not bootstrap from .env.example." >&2
  exit 1
fi

upsert_env NGINX_HOST_PORT_80 "$DEPLOY_NGINX_HOST_PORT_80"
upsert_env NGINX_HOST_PORT_443 "$DEPLOY_NGINX_HOST_PORT_443"
write_runtime_image_env
normalize_queue_env_for_mongo

if ! ensure_laravel_app_env; then
  exit 1
fi
require_laravel_env_value APP_URL
require_laravel_env_value TRUSTED_PROXIES
normalize_laravel_queue_env_for_mongo
normalize_laravel_cache_env_for_mongo
require_laravel_mongodb_cache_env

resolve_health_host() {
  printf '%s' "$PROTECTED_HEALTH_HOST"
}

best_effort_clear_disk_log_files() {
  if [[ ! -d "laravel-app/storage/logs" ]]; then
    return 0
  fi

  if find laravel-app/storage/logs -type f -name '*.log' -delete 2>/dev/null; then
    echo "INFO: rollback disk log cleanup deleted Laravel log files."
    return 0
  fi

  echo "WARN: rollback disk log cleanup could not delete Laravel log files directly; continuing." >&2
  return 0
}

best_effort_clear_laravel_composer_cache() {
  local cache_dir="laravel-app/.composer/cache"
  if [[ ! -d "${cache_dir}" ]]; then
    return 0
  fi

  local reclaimed_kib=0
  reclaimed_kib="$(du -sk "${cache_dir}" 2>/dev/null | awk '{print $1}' || echo 0)"
  rm -rf "${cache_dir}"/* 2>/dev/null || true
  echo "INFO: pre-rollback composer cache cleanup reclaimed ${reclaimed_kib} KiB from ${cache_dir}."
}

print_disk_snapshot() {
  local label="$1"

  echo "INFO: disk snapshot (${label})"
  df -h /
  "${DOCKER_CMD[@]}" system df || true
}

ensure_disk_budget() {
  local phase="$1"
  local free_kib required_kib

  free_kib="$(df -Pk / | awk 'NR==2 {print $4}')"
  required_kib="$(( DEPLOY_MIN_FREE_GB * 1024 * 1024 ))"
  echo "INFO: disk budget check for ${phase}: path=/ free_kib=${free_kib} required_kib=${required_kib}"

  if [[ -z "${free_kib}" ]] || ! [[ "${free_kib}" =~ ^[0-9]+$ ]]; then
    echo "ERROR: unable to determine available disk space for ${phase}." >&2
    print_disk_snapshot "${phase}-disk-budget-failed"
    return 1
  fi

  if (( free_kib < required_kib )); then
    echo "ERROR: ${phase} requires at least ${DEPLOY_MIN_FREE_GB} GiB free on / before Docker rebuilds." >&2
    print_disk_snapshot "${phase}-disk-budget-failed"
    return 1
  fi

  return 0
}

prebuild_cleanup_and_budget_gate() {
  local phase="$1"

  print_disk_snapshot "before-${phase}-cleanup"
  best_effort_clear_disk_log_files || true
  best_effort_clear_laravel_composer_cache || true

  if ! "${DOCKER_CMD[@]}" container prune -f; then
    echo "WARN: docker container prune failed during ${phase} cleanup; continuing." >&2
  fi

  if ! "${DOCKER_CMD[@]}" builder prune -af; then
    echo "WARN: docker builder prune failed during ${phase} cleanup; continuing." >&2
  fi

  if ! "${DOCKER_CMD[@]}" image prune -af; then
    echo "WARN: docker image prune failed during ${phase} cleanup; continuing." >&2
  fi

  print_disk_snapshot "after-${phase}-cleanup"
  ensure_disk_budget "${phase}"
}

prune_docker_artifacts() {
  local prune_window="168h"

  echo "INFO: running post-success Docker cleanup (window: ${prune_window})..."
  if ! "${DOCKER_CMD[@]}" builder prune -af --filter "until=${prune_window}"; then
    echo "WARN: docker builder prune failed; continuing without blocking rollback." >&2
  fi

  if ! "${DOCKER_CMD[@]}" image prune -af --filter "until=${prune_window}"; then
    echo "WARN: docker image prune failed; continuing without blocking rollback." >&2
  fi
}

wait_for_laravel_artisan() {
  for attempt in $(seq 1 30); do
    if "${DOCKER_COMPOSE[@]}" exec -T app php artisan --version >/dev/null 2>&1; then
      return 0
    fi
    if [[ "$attempt" == "1" ]]; then
      echo "INFO: waiting for rollback Laravel artisan to become available..."
    fi
    sleep 2
  done
  echo "ERROR: rollback Laravel artisan did not become available in time." >&2
  "${DOCKER_COMPOSE[@]}" ps || true
  "${DOCKER_COMPOSE[@]}" logs --tail=200 app || true
  return 1
}

start_core_runtime_services() {
  echo "INFO: starting rollback core runtime services (app, nginx) from immutable GHCR digests..."
  pull_runtime_images

  if ! "${DOCKER_COMPOSE[@]}" stop worker scheduler >/dev/null 2>&1; then
    echo "WARN: failed to stop existing rollback worker/scheduler containers; continuing." >&2
  fi
  if ! "${DOCKER_COMPOSE[@]}" rm -f worker scheduler >/dev/null 2>&1; then
    echo "WARN: failed to remove existing rollback worker/scheduler containers; continuing." >&2
  fi

  if ! "${DOCKER_COMPOSE[@]}" up -d --no-build --remove-orphans app nginx; then
    echo "ERROR: docker compose up failed for rollback core runtime services." >&2
    return 1
  fi
  if ! "${DOCKER_COMPOSE[@]}" restart nginx; then
    echo "ERROR: nginx restart failed after rollback app replacement." >&2
    return 1
  fi
  "${DOCKER_COMPOSE[@]}" ps
}

start_async_runtime_services() {
  echo "INFO: starting rollback async runtime services (worker, scheduler)..."
  if ! "${DOCKER_COMPOSE[@]}" up -d --no-build worker; then
    echo "ERROR: docker compose up failed for rollback worker service." >&2
    return 1
  fi
  if ! "${DOCKER_COMPOSE[@]}" up -d --no-build scheduler; then
    echo "ERROR: docker compose up failed for rollback scheduler service." >&2
    return 1
  fi
  "${DOCKER_COMPOSE[@]}" ps
}

if ! prebuild_cleanup_and_budget_gate "${DEPLOY_LANE}-rollback"; then
  exit 1
fi

if ! start_core_runtime_services; then
  exit 1
fi

if ! wait_for_laravel_artisan; then
  exit 1
fi

health_host="$(resolve_health_host)"
health_url="http://127.0.0.1:${DEPLOY_NGINX_HOST_PORT_80}/api/v1/initialize"
root_health_url="http://127.0.0.1:${DEPLOY_NGINX_HOST_PORT_80}/"

echo "INFO: waiting for rollback health at ${health_url} (Host: ${health_host})"
for attempt in $(seq 1 60); do
  if [[ "${attempt}" == "1" ]]; then
    printf 'INFO: rollback probe host=%q url=%q\n' "${health_host}" "${health_url}"
  fi

  curl_cmd=(
    curl
    -sS
    --max-time 5
    -H "Host: ${health_host}"
    -o /tmp/rollback_health_response.json
    -w '%{http_code}'
    "${health_url}"
  )
  status="$("${curl_cmd[@]}" || true)"

  if [[ "${status}" == "200" || "${status}" == "403" ]]; then
    echo "INFO: rollback health check passed with HTTP ${status}."
    response_body="$(cat /tmp/rollback_health_response.json 2>/dev/null || true)"
    if [[ -n "${response_body}" ]]; then
      echo "INFO: rollback readiness response: ${response_body}"
    fi
    if ! start_async_runtime_services; then
      exit 1
    fi
    prune_docker_artifacts
    exit 0
  fi

  if [[ "${status}" == "404" ]]; then
    root_status="$(
      curl -sS --max-time 5 \
        -H "Host: ${health_host}" \
        -o /tmp/rollback_root_health_response.html \
        -w '%{http_code}' \
        "${root_health_url}" || true
    )"

    if [[ "${root_status}" == "200" || "${root_status}" == "301" || "${root_status}" == "302" ]]; then
      echo "WARN: rollback target returned 404 on /api/v1/initialize; accepting root health HTTP ${root_status} at ${root_health_url}."
      if ! start_async_runtime_services; then
        exit 1
      fi
      prune_docker_artifacts
      exit 0
    fi
  fi

  echo "INFO: rollback readiness attempt ${attempt}/60 failed (HTTP ${status:-unknown}); retrying in 5s..."
  sleep 5
done

echo "ERROR: rollback deployed but health check did not pass." >&2
"${DOCKER_COMPOSE[@]}" ps || true
"${DOCKER_COMPOSE[@]}" logs --tail=200 app worker scheduler nginx || true
exit 1
