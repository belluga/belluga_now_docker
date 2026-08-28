#!/usr/bin/env bash
set -euo pipefail
umask 077
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
repo="$tmp/repo"; mkdir "$repo"; git -C "$repo" init -q; git -C "$repo" config user.email test@example.test; git -C "$repo" config user.name Test
printf 'baseline\n' >"$repo/tracked"; git -C "$repo" add tracked; git -C "$repo" commit -qm baseline
actual="$tmp/actual.json"; manifest="$tmp/manifest.json"
run_id=runtime-contract-001; lane=event-web; platform=web; build=abcdef123456-7890abcdefff
write_actual() {
  python3 - "$actual" "$run_id" "$lane" "$platform" "$build" <<'PY'
import json,sys
path,run_id,lane,platform,build=sys.argv[1:]
value={'schema_version':2,'lane':lane,'run_id':run_id,'served_build_fingerprint':build,'target_base_url':'https://tenant.test','tenant_id':'tenant.test','fixture_ids':['fixture-1'],'platform':platform,'runtime_identity':'playwright-chromium','backend_identity':'https://tenant.test','steps':['toolbar_authoring','delta_or_html','backend_readback','public_render','anchor_tap','tap_outcome'],'lifecycle':{'started_at':'2026-01-01T00:00:00Z','completed_at':'2026-01-01T00:01:00Z','cleanup_completed_at':'2026-01-01T00:02:00Z','cleanup_succeeded':True},'tap_outcome':{'status':'opened','target_urls':['https://example.test/path?a=1&refresh=2&tokenized=3#section=details&authentic=true']}}
with open(path,'w') as stream: json.dump(value,stream,sort_keys=True)
PY
}
write_actual
cmd=(bash "$root/tools/ci/record_rich_text_runtime_manifest.sh")
args=(--manifest "$manifest" --actual-run "$actual" --root-repository "$repo" --laravel-repository "$repo" --flutter-repository "$repo" --expected-run-id "$run_id" --expected-lane "$lane" --expected-platform "$platform" --expected-build-fingerprint "$build")
"${cmd[@]}" --record-new "${args[@]}"
"${cmd[@]}" --validate-existing "${args[@]}"
[[ "$(stat -c %a "$manifest")" == 600 ]]

expect_fail() { set +e; "$@" >/dev/null 2>&1; local result=$?; set -e; [[ $result -ne 0 ]]; }
expect_fail "${cmd[@]}" --record-new "${args[@]}"
expect_fail "${cmd[@]}" --validate-existing --manifest "$tmp/missing.json" "${args[@]:2}"

# A byte change must invalidate the manifest even when porcelain remains simply M.
printf 'first dirty bytes\n' >"$repo/tracked"
dirty_manifest="$tmp/dirty-manifest.json"
dirty_args=(--manifest "$dirty_manifest" --actual-run "$actual" --root-repository "$repo" --laravel-repository "$repo" --flutter-repository "$repo" --expected-run-id "$run_id" --expected-lane "$lane" --expected-platform "$platform" --expected-build-fingerprint "$build")
"${cmd[@]}" --record-new "${dirty_args[@]}"
printf 'second dirty bytes\n' >"$repo/tracked"
expect_fail "${cmd[@]}" --validate-existing "${dirty_args[@]}"
git -C "$repo" checkout -q -- tracked

mutate_and_reject() {
  local expression="$1"
  mutation_index=$((mutation_index + 1))
  local rejected_manifest="$tmp/rejected-manifest-$mutation_index.json"
  write_actual
  python3 - "$actual" "$expression" <<'PY'
import json,sys
path,expression=sys.argv[1:]; value=json.load(open(path)); exec(expression,{}, {'v':value}); json.dump(value,open(path,'w'),sort_keys=True)
PY
  local rejected_args=(--manifest "$rejected_manifest" --actual-run "$actual" --root-repository "$repo" --laravel-repository "$repo" --flutter-repository "$repo" --expected-run-id "$run_id" --expected-lane "$lane" --expected-platform "$platform" --expected-build-fingerprint "$build")
  expect_fail "${cmd[@]}" --record-new "${rejected_args[@]}"
  [[ ! -e "$rejected_manifest" ]]
}
mutation_index=0
mutate_and_reject "v['extra']='closed-schema'"
mutate_and_reject "del v['runtime_identity']"
mutate_and_reject "v['run_id']='wrong-nonce'"
mutate_and_reject "v['lane']='account-profile-web'"
mutate_and_reject "v['platform']='android'"
mutate_and_reject "v['served_build_fingerprint']='unknown'"
mutate_and_reject "v['lifecycle']['cleanup_succeeded']=False"
mutate_and_reject "v['lifecycle']['cleanup_completed_at']='2025-12-31T23:59:00Z'"
mutate_and_reject "v['tap_outcome']['target_urls']=['https://user:pass@example.test/path']"
mutate_and_reject "v['target_base_url']='https://tenant.test/path?token=secret'"
mutate_and_reject "v['target_base_url']='https://tenant.test/path#fragment'"
mutate_and_reject "v['backend_identity']='https://tenant.test/runtime?key=secret'"
mutate_and_reject "v['backend_identity']='https://tenant.test/runtime#fragment'"
mutate_and_reject "v['runtime_identity']='https://runtime.test/engine?mode=web'"
mutate_and_reject "v['runtime_identity']='https://runtime.test/engine#fragment'"
mutate_and_reject "v['tap_outcome']['target_urls']=['https://example.test/path?sig=forbidden']"
mutate_and_reject "v['tap_outcome']['target_urls']=['https://example.test/path?signature=forbidden']"
mutate_and_reject "v['tap_outcome']['target_urls']=['https://example.test/path?access%5Ftoken=forbidden']"
mutate_and_reject "v['tap_outcome']['target_urls']=['https://example.test/path?token=forbidden']"
mutate_and_reject "v['tap_outcome']['target_urls']=['https://example.test/path?key=forbidden']"
mutate_and_reject "v['tap_outcome']['target_urls']=['https://example.test/path?secret=forbidden']"
mutate_and_reject "v['tap_outcome']['target_urls']=['https://example.test/path?filter%5Btoken%5D=forbidden']"
mutate_and_reject "v['tap_outcome']['target_urls']=['https://example.test/path?password=forbidden']"
mutate_and_reject "v['tap_outcome']['target_urls']=['https://example.test/path?authorization=forbidden']"
mutate_and_reject "v['tap_outcome']['target_urls']=['https://example.test/path?accessToken=forbidden']"
mutate_and_reject "v['tap_outcome']['target_urls']=['https://example.test/path?refreshToken=forbidden']"
mutate_and_reject "v['tap_outcome']['target_urls']=['https://example.test/path?secretKey=forbidden']"
mutate_and_reject "v['tap_outcome']['target_urls']=['https://example.test/path?authToken=forbidden']"
mutate_and_reject "v['tap_outcome']['target_urls']=['https://example.test/path?filter%5Bpassword%5D=forbidden']"
mutate_and_reject "v['tap_outcome']['target_urls']=['https://example.test/path?filter%5BrefreshToken%5D=forbidden']"
mutate_and_reject "v['tap_outcome']['target_urls']=['https://example.test/path#token=forbidden']"
mutate_and_reject "v['tap_outcome']['target_urls']=['https://example.test/path#filter%5Bauthorization%5D=forbidden']"
mutate_and_reject "v['tap_outcome']['target_urls']=['https://example.test/path#secretKey=forbidden']"
mutate_and_reject "v['tap_outcome']['target_urls']=['https://example.test/path#filter%5BauthToken%5D=forbidden']"
mutate_and_reject "v['tap_outcome']['target_urls']=['https://%65xample.test/path']"
mutate_and_reject "v['tap_outcome']['target_urls']=['https://example.test:080/path']"
mutate_and_reject "v['tap_outcome']['nested']={'secret_token':'forbidden'}"
mutate_and_reject "v['fixture_ids']=['fixture\\u0001control']"
mutate_and_reject "v['steps']=v['steps'][:-1]"
write_actual
expect_fail "${cmd[@]}" --validate-existing "${args[@]/$build/unknown}"

symlink_actual="$tmp/symlink-actual.json"; ln -s "$actual" "$symlink_actual"
symlink_args=(--manifest "$tmp/symlink-manifest.json" --actual-run "$symlink_actual" --root-repository "$repo" --laravel-repository "$repo" --flutter-repository "$repo" --expected-run-id "$run_id" --expected-lane "$lane" --expected-platform "$platform" --expected-build-fingerprint "$build")
expect_fail "${cmd[@]}" --record-new "${symlink_args[@]}"
mkdir "$tmp/real-output"; ln -s "$tmp/real-output" "$tmp/output-link"
set +e
RICH_TEXT_RUNTIME_LANE=event-web RICH_TEXT_RUNTIME_OUTPUT_DIR="$tmp/output-link" bash "$root/tools/ci/run_rich_text_runtime_lane.sh" >/dev/null 2>&1; symlink_lane=$?
RICH_TEXT_RUNTIME_LANE=event-web RICH_TEXT_RUNTIME_OUTPUT_DIR="$tmp/lane" bash "$root/tools/ci/run_rich_text_runtime_lane.sh" >/dev/null 2>&1; web=$?
RICH_TEXT_RUNTIME_LANE=android RICH_TEXT_RUNTIME_OUTPUT_DIR="$tmp/android" bash "$root/tools/ci/run_rich_text_runtime_lane.sh" >/dev/null 2>&1; android=$?
set -e
[[ $symlink_lane -ne 0 && $web -ne 0 && $android -ne 0 ]]

# The lane wrapper invokes its Web/Flutter leaf runners from different working
# directories. A caller-relative evidence directory must remain anchored at
# the caller, not at either leaf-runner directory. Stub only those leaf
# commands: no browser, device, runtime target or real credential is involved.
fake_bin="$tmp/fake-bin"; mkdir "$fake_bin"
relative_caller="$tmp/relative-caller"; mkdir "$relative_caller"
relative_output="relative-rich-text-evidence"
cat >"$fake_bin/bash" <<'EOF'
#!/usr/bin/bash
set -euo pipefail
case "${1:-}" in
  */tools/flutter/run_web_navigation_smoke.sh)
    printf '{"stub":true}\n' >"${RICH_TEXT_RUNTIME_OUTPUT_DIR}/actual-run.json"
    ;;
  */tools/ci/record_rich_text_runtime_manifest.sh)
    ;;
  *)
    exec /usr/bin/bash "$@"
    ;;
esac
EOF
chmod 700 "$fake_bin/bash"
(
 cd "$relative_caller"
 PATH="$fake_bin:$PATH" \
 NAV_TENANT_URL='https://tenant.invalid' \
 NAV_LANDLORD_URL='https://landlord.invalid' \
 NAV_DEPLOY_LANE='local' \
 NAV_ADMIN_EMAIL='synthetic@example.invalid' \
 NAV_ADMIN_PASSWORD='synthetic-password' \
 RICH_TEXT_RUNTIME_LANE=event-web \
 RICH_TEXT_RUNTIME_OUTPUT_DIR="$relative_output" \
 RICH_TEXT_RUNTIME_RUN_ID=relative-output-contract \
 /usr/bin/bash "$root/tools/ci/run_rich_text_runtime_lane.sh"
)
[[ -f "$relative_caller/$relative_output/actual-run.json" ]]
[[ ! -e "$root/tools/flutter/web_app_smoke_runner/$relative_output/actual-run.json" ]]
echo 'PASS rich-text runtime manifest v2, fingerprint, secret, lifecycle, atomic-output, and lane fail-closed contract'
