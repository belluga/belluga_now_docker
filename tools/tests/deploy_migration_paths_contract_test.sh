#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOY="$ROOT_DIR/.github/scripts/deploy_stage_over_ssh.sh"
CONFIG="$ROOT_DIR/laravel-app/config/multitenancy.php"

grep -Fq "'landlord_migration_paths'" "$CONFIG"
grep -Fq "packages/belluga/belluga_settings/database/migrations_landlord" "$CONFIG"
grep -Fq 'resolve_migration_path_args landlord_migration_paths' "$DEPLOY"
grep -Fq 'resolve_migration_path_args tenant_migration_paths' "$DEPLOY"
grep -Fq 'refusing a partial migration' "$DEPLOY"
grep -Fq 'ERROR: landlord migrations failed.' "$DEPLOY"
grep -Fq 'ERROR: tenant migrations failed.' "$DEPLOY"

TEST_DIR="$(mktemp -d)"
trap 'rm -rf -- "$TEST_DIR"' EXIT
FUNCTIONS="$TEST_DIR/migration-functions.sh"
MOCK_COMPOSE="$TEST_DIR/mock-compose.sh"
MOCK_LOG="$TEST_DIR/mock-compose.log"

awk '
  /^migration_output_has_fail_marker\(\) \{/ { capture=1 }
  /^prune_docker_artifacts\(\) \{/ { capture=0 }
  capture { print }
' "$DEPLOY" | sed 's/\\\$/$/g' > "$FUNCTIONS"

cat > "$MOCK_COMPOSE" <<'EOF_MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$MOCK_LOG"
last="${!#}"

if [[ "$*" == *'Tenant::query()->count'* ]]; then
  case "$MOCK_MODE" in
    tenant-count-exit)
      printf 'tenant count query failed\n' >&2
      exit 23
      ;;
    tenant-count-empty)
      exit 0
      ;;
    tenant-count-nonnumeric)
      printf 'warning: unavailable\n'
      ;;
    tenant-count-zero)
      printf '0\n'
      ;;
    *)
      printf '1\n'
      ;;
  esac
elif [[ "$last" == 'landlord_migration_paths' ]]; then
  if [[ "$MOCK_MODE" == 'partial-landlord-paths' ]]; then
    printf '%s\n' '--path=database/migrations/landlord'
    exit 23
  fi
  [[ "$MOCK_MODE" == 'missing-landlord-paths' ]] || printf '%s\n' '--path=database/migrations/landlord' '--path=packages/belluga/belluga_settings/database/migrations_landlord'
elif [[ "$last" == 'tenant_migration_paths' ]]; then
  if [[ "$MOCK_MODE" == 'partial-tenant-paths' ]]; then
    printf '%s\n' '--path=database/migrations/tenants'
    exit 23
  fi
  printf '%s\n' '--path=database/migrations/tenants' '--path=packages/belluga/belluga_events/database/migrations'
elif [[ "$*" == *'php artisan migrate --database=landlord'* ]]; then
  if [[ "$MOCK_MODE" == 'landlord-exit' ]]; then
    printf 'landlord migration command failed\n'
    exit 23
  fi
  printf 'landlord migrations completed\n'
elif [[ "$*" == *'php artisan tenants:artisan'* ]]; then
  if [[ "$MOCK_MODE" == 'tenant-fail-marker' ]]; then
    printf 'tenant-1 FAIL\n'
  else
    printf 'tenant migrations completed\n'
  fi
else
  printf 'unexpected mock invocation: %s\n' "$*" >&2
  exit 97
fi
EOF_MOCK
chmod +x "$MOCK_COMPOSE"

# shellcheck source=/dev/null
source "$FUNCTIONS"
DOCKER_COMPOSE=("$MOCK_COMPOSE")
export MOCK_LOG

run_case() {
  local mode="$1" expected_status="$2" expected_output="$3" output status
  : > "$MOCK_LOG"
  export MOCK_MODE="$mode"
  set +e
  output="$(run_migrations 2>&1)"
  status=$?
  set -e
  if [[ "$status" -ne "$expected_status" ]]; then
    printf 'mode %s returned %s, expected %s\n%s\n' "$mode" "$status" "$expected_status" "$output" >&2
    return 1
  fi
  grep -Fq "$expected_output" <<< "$output"
}

run_case success 0 'tenant migrations completed'
grep -Fq -- '--path=packages/belluga/belluga_settings/database/migrations_landlord' "$MOCK_LOG"
grep -Fq -- '--path=packages/belluga/belluga_events/database/migrations' "$MOCK_LOG"

run_case missing-landlord-paths 1 'refusing a partial migration'
if grep -Fq 'php artisan migrate' "$MOCK_LOG"; then
  echo 'missing landlord paths reached migration DDL' >&2
  exit 1
fi

run_case partial-landlord-paths 1 'refusing a partial migration'
if grep -Fq 'php artisan migrate' "$MOCK_LOG"; then
  echo 'partial landlord paths reached migration DDL' >&2
  exit 1
fi

run_case landlord-exit 1 'ERROR: landlord migrations failed.'
if grep -Fq 'php artisan tenants:artisan' "$MOCK_LOG"; then
  echo 'tenant migration ran after landlord failure' >&2
  exit 1
fi

run_case tenant-count-exit 1 'ERROR: unable to resolve tenant count'
run_case tenant-count-empty 1 'ERROR: invalid tenant count'
run_case tenant-count-nonnumeric 1 'ERROR: invalid tenant count'
run_case tenant-count-zero 0 'INFO: no tenants found; skipping tenant migrations.'
if grep -Fq 'php artisan tenants:artisan' "$MOCK_LOG"; then
  echo 'tenant migration ran with an explicit zero tenant count' >&2
  exit 1
fi

run_case partial-tenant-paths 1 'refusing a partial migration'
if grep -Fq 'php artisan tenants:artisan' "$MOCK_LOG"; then
  echo 'partial tenant paths reached tenant migration DDL' >&2
  exit 1
fi

run_case tenant-fail-marker 1 'ERROR: tenant migrations failed.'
printf 'deploy_migration_paths_contract_test: OK\n'
