#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GUARD="$ROOT_DIR/tools/contact_channels/verify_canonical_contact_source_picker_contract.py"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

python3 "$GUARD" --repo "$ROOT_DIR" >"$TMP_DIR/pass.log"
grep -Fq 'Overall outcome: go' "$TMP_DIR/pass.log"

required_paths=(
  'flutter-app/lib/domain/tenant_admin/tenant_admin_account_profile_candidate_scope.dart'
  'flutter-app/lib/infrastructure/repositories/tenant_admin/tenant_admin_account_profiles_repository.dart'
  'flutter-app/lib/presentation/tenant_admin/account_profiles/screens/tenant_admin_account_profile_create_screen.dart'
  'flutter-app/lib/presentation/tenant_admin/account_profiles/screens/tenant_admin_account_profile_edit_screen.dart'
  'laravel-app/routes/api/tenant_api_v1.php'
  'laravel-app/app/Http/Api/v1/Requests/AccountProfileCandidatesRequest.php'
  'laravel-app/app/Application/AccountProfiles/AccountProfileCandidateDiscoveryService.php'
)

copy_required_paths() {
  local target_dir="$1"
  for relative_path in "${required_paths[@]}"; do
    mkdir -p "$(dirname "$target_dir/$relative_path")"
    cp "$ROOT_DIR/$relative_path" "$target_dir/$relative_path"
  done
}

assert_rejected() {
  local fixture_dir="$1"
  local expected="$2"
  local output="$3"

  if python3 "$GUARD" --repo "$fixture_dir" >"$output" 2>&1; then
    cat "$output"
    printf 'expected guard to reject drifted candidate contract\n' >&2
    exit 1
  fi

  grep -Fq "$expected" "$output"
  grep -Fq 'Overall outcome: no-go' "$output"
}

FLUTTER_CONSUMER_FIXTURE="$TMP_DIR/flutter-consumer"
copy_required_paths "$FLUTTER_CONSUMER_FIXTURE"
sed -i \
  '0,/\.contactCapable/s//.queryable/' \
  "$FLUTTER_CONSUMER_FIXTURE/flutter-app/lib/presentation/tenant_admin/account_profiles/screens/tenant_admin_account_profile_create_screen.dart"
assert_rejected \
  "$FLUTTER_CONSUMER_FIXTURE" \
  'missing required contract `createCandidatePickerSession(scope:TenantAdminAccountProfileCandidateScope.contactCapable,maxSelections:1`' \
  "$TMP_DIR/flutter-consumer.log"

FLUTTER_TRANSPORT_FIXTURE="$TMP_DIR/flutter-transport"
copy_required_paths "$FLUTTER_TRANSPORT_FIXTURE"
sed -i \
  "s#/v1/account_profiles/candidates#/v1/account_profiles#" \
  "$FLUTTER_TRANSPORT_FIXTURE/flutter-app/lib/infrastructure/repositories/tenant_admin/tenant_admin_account_profiles_repository.dart"
assert_rejected \
  "$FLUTTER_TRANSPORT_FIXTURE" \
  "missing required fragment \`'\$_apiBaseUrl/v1/account_profiles/candidates'\`" \
  "$TMP_DIR/flutter-transport.log"

LARAVEL_SCOPE_FIXTURE="$TMP_DIR/laravel-scope"
copy_required_paths "$LARAVEL_SCOPE_FIXTURE"
sed -i \
  "s/public const SCOPE_CONTACT_CAPABLE = 'contact_capable'/public const SCOPE_CONTACT_CAPABLE = 'contact_source'/" \
  "$LARAVEL_SCOPE_FIXTURE/laravel-app/app/Application/AccountProfiles/AccountProfileCandidateDiscoveryService.php"
assert_rejected \
  "$LARAVEL_SCOPE_FIXTURE" \
  "missing required fragment \`public const SCOPE_CONTACT_CAPABLE = 'contact_capable'\`" \
  "$TMP_DIR/laravel-scope.log"

PARALLEL_ROUTE_FIXTURE="$TMP_DIR/parallel-route"
copy_required_paths "$PARALLEL_ROUTE_FIXTURE"
printf '%s\n' \
  "Route::get('/contact_sources', [AccountProfilesController::class, 'candidates']);" \
  >>"$PARALLEL_ROUTE_FIXTURE/laravel-app/routes/api/tenant_api_v1.php"
assert_rejected \
  "$PARALLEL_ROUTE_FIXTURE" \
  "forbidden fragment present \`Route::get('/contact_sources'\`" \
  "$TMP_DIR/parallel-route.log"

printf 'canonical_contact_source_picker_contract_test: OK\n'
