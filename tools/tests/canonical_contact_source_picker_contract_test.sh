#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GUARD="$ROOT_DIR/tools/contact_channels/verify_canonical_contact_source_picker_contract.py"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

python3 "$GUARD" --repo "$ROOT_DIR" >"$TMP_DIR/pass.log"
grep -Fq 'Overall outcome: go' "$TMP_DIR/pass.log"

required_paths=(
  'flutter-app/lib/presentation/tenant_admin/account_profiles/controllers/tenant_admin_account_profiles_controller.dart'
  'flutter-app/lib/infrastructure/repositories/tenant_admin/tenant_admin_account_profiles_repository.dart'
  'flutter-app/lib/domain/repositories/tenant_admin_account_profiles_repository_contract.dart'
  'flutter-app/lib/infrastructure/dal/dao/tenant_admin/tenant_admin_account_profiles_request_encoder.dart'
  'laravel-app/app/Application/Shared/Query/AbstractQueryService.php'
  'laravel-app/routes/api/tenant_api_v1.php'
  'laravel-app/app/Http/Api/v1/Controllers/AccountProfilesController.php'
  'laravel-app/app/Application/AccountProfiles/AccountProfileQueryService.php'
  'laravel-app/app/Application/AccountProfiles/AccountProfileTypeSetProvider.php'
  'laravel-app/app/Models/Tenants/TenantProfileType.php'
  'laravel-app/app/Models/Tenants/AccountProfile.php'
  'laravel-app/database/migrations/tenants/2026_07_21_000100_rebuild_contact_source_candidate_index_for_name_search.php'
)

for relative_path in "${required_paths[@]}"; do
  mkdir -p "$(dirname "$TMP_DIR/$relative_path")"
  cp "$ROOT_DIR/$relative_path" "$TMP_DIR/$relative_path"
done

copy_required_paths() {
  local target_dir="$1"
  for relative_path in "${required_paths[@]}"; do
    mkdir -p "$(dirname "$target_dir/$relative_path")"
    cp "$ROOT_DIR/$relative_path" "$target_dir/$relative_path"
  done
}

python3 - "$TMP_DIR/flutter-app/lib/presentation/tenant_admin/account_profiles/controllers/tenant_admin_account_profiles_controller.dart" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
source = path.read_text(encoding="utf-8")
source = source.replace(
    "contactChannelsEnabledOnly: true",
    "contactChannelsEnabledOnly: false",
    1,
)
path.write_text(source, encoding="utf-8")
PY

if python3 "$GUARD" --repo "$TMP_DIR" >"$TMP_DIR/fail.log" 2>&1; then
  cat "$TMP_DIR/fail.log"
  printf 'expected guard to reject missing canonical contact-source filter\n' >&2
  exit 1
fi

grep -Fq 'missing required fragment `contactChannelsEnabledOnly: true`' "$TMP_DIR/fail.log"
grep -Fq 'Overall outcome: no-go' "$TMP_DIR/fail.log"

EXCLUDE_FIXTURE="$(mktemp -d "$TMP_DIR/exclude-fixture-XXXXXX")"
copy_required_paths "$EXCLUDE_FIXTURE"
python3 - "$EXCLUDE_FIXTURE/flutter-app/lib/presentation/tenant_admin/account_profiles/controllers/tenant_admin_account_profiles_controller.dart" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
source = path.read_text(encoding="utf-8")
source = source.replace(
    "excludeAccountProfileId: _contactSourceCandidatesExcludeProfileId,",
    "excludeAccountProfileId: null,",
    1,
)
path.write_text(source, encoding="utf-8")
PY

if python3 "$GUARD" --repo "$EXCLUDE_FIXTURE" >"$TMP_DIR/exclude-fail.log" 2>&1; then
  cat "$TMP_DIR/exclude-fail.log"
  printf 'expected guard to reject missing current-profile exclusion chain\n' >&2
  exit 1
fi

grep -Fq 'missing required fragment `excludeAccountProfileId: _contactSourceCandidatesExcludeProfileId`' "$TMP_DIR/exclude-fail.log"
grep -Fq 'Overall outcome: no-go' "$TMP_DIR/exclude-fail.log"

MIGRATION_FIXTURE="$(mktemp -d "$TMP_DIR/migration-fixture-XXXXXX")"
copy_required_paths "$MIGRATION_FIXTURE"
python3 - "$MIGRATION_FIXTURE/laravel-app/database/migrations/tenants/2026_07_21_000100_rebuild_contact_source_candidate_index_for_name_search.php" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
source = path.read_text(encoding="utf-8")
source = source.replace(
    "        'name_search_key' => 1,\n",
    "",
    1,
)
path.write_text(source, encoding="utf-8")
PY

if python3 "$GUARD" --repo "$MIGRATION_FIXTURE" >"$TMP_DIR/migration-fail.log" 2>&1; then
  cat "$TMP_DIR/migration-fail.log"
  printf 'expected guard to reject missing canonical candidate index authority\n' >&2
  exit 1
fi

grep -Fq "missing required fragment \`'name_search_key' => 1,\`" "$TMP_DIR/migration-fail.log"
grep -Fq 'Overall outcome: no-go' "$TMP_DIR/migration-fail.log"

ROUTE_FIXTURE="$(mktemp -d "$TMP_DIR/route-fixture-XXXXXX")"
copy_required_paths "$ROUTE_FIXTURE"
python3 - "$ROUTE_FIXTURE/laravel-app/routes/api/tenant_api_v1.php" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
source = path.read_text(encoding="utf-8")
source += "\nRoute::get('/contact_sources', [AccountProfilesController::class, 'contactSourceCandidates']);\n"
path.write_text(source, encoding="utf-8")
PY

if python3 "$GUARD" --repo "$ROUTE_FIXTURE" >"$TMP_DIR/route-fail.log" 2>&1; then
  cat "$TMP_DIR/route-fail.log"
  printf 'expected guard to reject resurrected dedicated contact_sources route\n' >&2
  exit 1
fi

grep -Fq "forbidden fragment present \`Route::get('/contact_sources'\`" "$TMP_DIR/route-fail.log"
grep -Fq 'Overall outcome: no-go' "$TMP_DIR/route-fail.log"

printf 'canonical_contact_source_picker_contract_test: OK\n'
