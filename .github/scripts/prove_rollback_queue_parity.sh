#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ROLLBACK_SCRIPT="${ROOT_DIR}/.github/scripts/rollback_remote.sh"

extract_function() {
  local function_name="$1"

  awk -v function_name="${function_name}" '
    $0 ~ "^" function_name "\\(\\) \\{" { in_function = 1 }
    in_function { print }
    in_function && $0 == "}" { exit }
  ' "${ROLLBACK_SCRIPT}"
}

materialize_function_library() {
  local library_path="$1"
  local function_name=""

  : > "${library_path}"
  for function_name in \
    upsert_env \
    read_env_value \
    read_laravel_env_value \
    upsert_laravel_env \
    normalize_queue_env_for_mongo \
    normalize_laravel_queue_env_for_mongo; do
    if ! extract_function "${function_name}" >> "${library_path}"; then
      echo "ERROR: failed to extract ${function_name}() from rollback_remote.sh." >&2
      exit 1
    fi
    printf '\n' >> "${library_path}"
  done
}

read_file_env_value() {
  local file_path="$1"
  local key="$2"

  python3 - "${file_path}" "${key}" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
key = sys.argv[2]
prefix = key + "="
for line in path.read_text().splitlines():
    if line.startswith(prefix):
        print(line[len(prefix):])
        break
PY
}

run_case() {
  local case_id="$1"
  local root_queue_connection="$2"
  local root_db_queue_connection="$3"
  local laravel_queue_connection="$4"
  local scratch_dir=""
  local helper_library=""
  local root_queue_after=""
  local laravel_queue_after=""

  scratch_dir="$(mktemp -d)"
  helper_library="${scratch_dir}/rollback_remote_functions.sh"
  trap 'rm -rf "${scratch_dir}"' RETURN

  mkdir -p "${scratch_dir}/laravel-app"
  cat > "${scratch_dir}/.env" <<EOF
DB_CONNECTION=mongodb
QUEUE_CONNECTION=${root_queue_connection}
DB_QUEUE_CONNECTION=${root_db_queue_connection}
EOF

  cat > "${scratch_dir}/laravel-app/.env" <<EOF
DB_CONNECTION=mongodb
QUEUE_CONNECTION=${laravel_queue_connection}
QUEUE_FAILED_DRIVER=database
EOF

  materialize_function_library "${helper_library}"

  (
    cd "${scratch_dir}"
    # shellcheck disable=SC1090
    source "${helper_library}"
    normalize_queue_env_for_mongo
    normalize_laravel_queue_env_for_mongo
  )

  root_queue_after="$(read_file_env_value "${scratch_dir}/.env" QUEUE_CONNECTION)"
  laravel_queue_after="$(read_file_env_value "${scratch_dir}/laravel-app/.env" QUEUE_CONNECTION)"

  if [[ "${root_queue_after}" != "mongodb" ]]; then
    echo "ERROR: ${case_id} left root .env QUEUE_CONNECTION=${root_queue_after:-<empty>} instead of mongodb." >&2
    exit 1
  fi

  if [[ "${laravel_queue_after}" != "mongodb" ]]; then
    echo "ERROR: ${case_id} left laravel-app/.env QUEUE_CONNECTION=${laravel_queue_after:-<empty>} instead of mongodb." >&2
    exit 1
  fi

  trap - RETURN
  rm -rf "${scratch_dir}"
}

run_case "CASE-EMPTY-QUEUE" "" "" ""
run_case "CASE-DATABASE-QUEUE" "database" "tenant" "database"

echo "OK: rollback queue parity proof passed."
