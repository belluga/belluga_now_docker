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
  'laravel-app/routes/api/tenant_api_v1.php'
  'laravel-app/app/Http/Api/v1/Controllers/AccountProfilesController.php'
  'laravel-app/app/Application/AccountProfiles/AccountProfileQueryService.php'
  'laravel-app/app/Application/AccountProfiles/AccountProfileTypeSetProvider.php'
  'laravel-app/app/Models/Tenants/TenantProfileType.php'
)

for relative_path in "${required_paths[@]}"; do
  mkdir -p "$(dirname "$TMP_DIR/$relative_path")"
  cp "$ROOT_DIR/$relative_path" "$TMP_DIR/$relative_path"
done

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
printf 'canonical_contact_source_picker_contract_test: OK\n'
