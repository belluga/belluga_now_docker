#!/usr/bin/env bash
set -euo pipefail
umask 077
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
lane="${RICH_TEXT_RUNTIME_LANE:?}"; out="${RICH_TEXT_RUNTIME_OUTPUT_DIR:?}"; run_id="${RICH_TEXT_RUNTIME_RUN_ID:-rt-$(date +%s)-$$}"
# The evidence directory is caller-relative by contract.  Make that contract
# independent of the Web/Flutter runners, both of which intentionally change
# their working directory before they emit actual-run.json.
if [[ "$out" != /* ]]; then
 out="$PWD/$out"
fi
[[ ! -L "$out" ]] || { echo 'ERROR: runtime output directory cannot be a symlink' >&2; exit 1; }
mkdir -p -m 700 "$out"
[[ -d "$out" && ! -L "$out" ]] || { echo 'ERROR: runtime output must be a real directory' >&2; exit 1; }
actual="$out/actual-run.json"; [[ ! -e "$actual" && ! -L "$actual" && ! -e "$out/manifest.json" && ! -L "$out/manifest.json" ]] || { echo 'ERROR: lane output already exists' >&2; exit 1; }
case "$lane" in
 event-web) shard=event-rich-text;; account-profile-web) shard=apd-rich-text;; android) shard=android;; *) echo 'ERROR: unsupported rich-text runtime lane' >&2; exit 2;; esac
if [[ "$lane" == android ]]; then
 [[ -n "${ADB_DEVICE:-}" && -n "${RICH_TEXT_BUILD_FINGERPRINT:-}" && "${RICH_TEXT_INTEGRATION_TARGET:-}" == integration_test/rich_text_https_links_real_backend_test.dart ]] || { echo 'ERROR: Android lane requires device, fingerprint and exact target' >&2; exit 1; }
 expected_platform=android
 expected_build="$RICH_TEXT_BUILD_FINGERPRINT"
 export RICH_TEXT_RUNTIME_RUN_ID="$run_id" RICH_TEXT_RUNTIME_OUTPUT_DIR="$out"
 (cd "$root/flutter-app" && fvm flutter test "${RICH_TEXT_INTEGRATION_TARGET}")
else
 [[ -n "${NAV_TENANT_URL:-}" && -n "${NAV_LANDLORD_URL:-}" && -n "${NAV_DEPLOY_LANE:-}" && -n "${NAV_ADMIN_EMAIL:-}" && -n "${NAV_ADMIN_PASSWORD:-}" ]] || { echo 'ERROR: web lane requires explicit live mutation credentials' >&2; exit 1; }
 expected_platform=web
 expected_build="$(sed -n 's/.*window.__WEB_BUILD_SHA__ = "\([0-9a-f-]*\)".*/\1/p' "$root/web-app/index.html" | head -n 1)"
 [[ -n "$expected_build" && "$expected_build" != unknown ]] || { echo 'ERROR: local Web build fingerprint is absent or unknown' >&2; exit 1; }
 export RICH_TEXT_RUNTIME_RUN_ID="$run_id" RICH_TEXT_RUNTIME_OUTPUT_DIR="$out" NAV_WEB_SHARD="$shard"
 bash "$root/tools/flutter/run_web_navigation_smoke.sh" mutation
fi
[[ -f "$actual" ]] || { echo 'ERROR: source runtime target did not emit actual-run.json' >&2; exit 1; }
manifest_args=(--manifest "$out/manifest.json" --actual-run "$actual" --root-repository "$root" --laravel-repository "$root/laravel-app" --flutter-repository "$root/flutter-app" --expected-run-id "$run_id" --expected-lane "$lane" --expected-platform "$expected_platform" --expected-build-fingerprint "$expected_build")
bash "$root/tools/ci/record_rich_text_runtime_manifest.sh" --record-new "${manifest_args[@]}"
bash "$root/tools/ci/record_rich_text_runtime_manifest.sh" --validate-existing "${manifest_args[@]}"
