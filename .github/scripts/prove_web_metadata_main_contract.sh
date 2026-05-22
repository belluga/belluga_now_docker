#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
check_metadata_script="${repo_root}/.github/scripts/check_web_flutter_metadata.sh"
check_deployed_script="${repo_root}/.github/scripts/check_deployed_web_provenance.sh"

if [[ ! -f "${check_metadata_script}" ]]; then
  echo "ERROR: check_web_flutter_metadata.sh is required for the web metadata contract proof." >&2
  exit 1
fi

if [[ ! -f "${check_deployed_script}" ]]; then
  echo "ERROR: check_deployed_web_provenance.sh is required for the deployed provenance contract proof." >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: python3 is required for the web metadata contract proof." >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "ERROR: curl is required for the deployed provenance contract proof." >&2
  exit 1
fi

scratch_dir="$(mktemp -d)"
server_pid=""
real_git="$(command -v git)"
fake_bin="${scratch_dir}/fake-bin"

mkdir -p "${fake_bin}"

cat >"${fake_bin}/git" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "ls-remote" && "${2:-}" == https://x-access-token:*@github.com/proof/web.git ]]; then
  lane_ref="${3:-}"
  lane="${lane_ref#refs/heads/}"
  if [[ -z "${PROOF_WEB_REPO_PATH:-}" || -z "${REAL_GIT:-}" ]]; then
    exit 1
  fi
  sha="$("${REAL_GIT}" -C "${PROOF_WEB_REPO_PATH}" rev-parse HEAD)"
  printf '%s\trefs/heads/%s\n' "${sha}" "${lane}"
  exit 0
fi

exec "${REAL_GIT:-git}" "$@"
SH

cat >"${fake_bin}/gh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "api" && "${2:-}" == repos/proof/web/contents/* ]]; then
  endpoint="${2}"
  file_path="${endpoint#repos/proof/web/contents/}"
  ref="${file_path#*\?ref=}"
  file_path="${file_path%%\?ref=*}"
  if [[ -z "${PROOF_WEB_REPO_PATH:-}" || -z "${REAL_GIT:-}" ]]; then
    exit 1
  fi
  "${REAL_GIT}" -C "${PROOF_WEB_REPO_PATH}" show "${ref}:${file_path}" | base64 -w 0
  printf '\n'
  exit 0
fi

exit 1
SH

chmod +x "${fake_bin}/git" "${fake_bin}/gh"

cleanup() {
  if [[ -n "${server_pid}" ]]; then
    kill "${server_pid}" 2>/dev/null || true
    wait "${server_pid}" 2>/dev/null || true
  fi

  rm -rf "${scratch_dir}"
}

trap cleanup EXIT

git_commit_all() {
  local target_dir="$1"
  local message="$2"

  git -C "${target_dir}" add -A
  git -C "${target_dir}" \
    -c user.name="Belluga CI Proof" \
    -c user.email="ci-proof@belluga.local" \
    commit -q -m "${message}"
}

write_flutter_repo() {
  local target_dir="$1"
  local main_host="$2"
  local stage_host="$3"

  mkdir -p "${target_dir}/config/defines"
  git -C "${target_dir}" init -q

  printf '{ "LANDLORD_DOMAIN": "https://%s" }\n' "${main_host}" >"${target_dir}/config/defines/main.json"
  printf '{ "LANDLORD_DOMAIN": "https://%s" }\n' "${stage_host}" >"${target_dir}/config/defines/stage.json"
  printf '{ "LANDLORD_DOMAIN": "https://dev.%s" }\n' "${stage_host}" >"${target_dir}/config/defines/dev.json"

  git_commit_all "${target_dir}" "seed flutter lane defines"
}

write_web_repo() {
  local target_dir="$1"
  local metadata_flutter_sha="$2"
  local source_branch="$3"
  local injected_host="$4"

  mkdir -p "${target_dir}"
  git -C "${target_dir}" init -q

  printf '{"flutter_git_sha":"%s","source_branch":"%s","build_time_utc":"2026-05-22T00:00:00Z"}\n' \
    "${metadata_flutter_sha}" \
    "${source_branch}" \
    >"${target_dir}/build_metadata.json"
  printf '<!doctype html><script>window.__LANDLORD_HOST__ = "%s";</script>\n' \
    "${injected_host}" \
    >"${target_dir}/index.html"

  git_commit_all "${target_dir}" "seed web build artifact"
}

prepare_root_case() {
  local case_name="$1"
  local metadata_flutter_sha="$2"
  local source_branch="$3"
  local injected_host="$4"
  local case_dir="${scratch_dir}/${case_name}"
  local root_dir="${case_dir}/root"
  local flutter_repo="${case_dir}/flutter-src"
  local web_repo="${case_dir}/web-src"

  mkdir -p "${case_dir}" "${root_dir}"
  write_flutter_repo "${flutter_repo}" "main.example.test" "stage.example.test"
  write_web_repo "${web_repo}" "${metadata_flutter_sha}" "${source_branch}" "${injected_host}"

  git -C "${root_dir}" init -q
  git -C "${root_dir}" -c protocol.file.allow=always submodule add -q "${flutter_repo}" flutter-app
  git -C "${root_dir}" -c protocol.file.allow=always submodule add -q "${web_repo}" web-app
  git_commit_all "${root_dir}" "seed root gitlinks"

  printf '%s\n' "${root_dir}"
}

prepare_root_case_with_real_flutter_sha() {
  local case_name="$1"
  local source_branch="$2"
  local injected_host="$3"
  local case_dir="${scratch_dir}/${case_name}"
  local root_dir="${case_dir}/root"
  local flutter_repo="${case_dir}/flutter-src"
  local web_repo="${case_dir}/web-src"
  local flutter_sha=""

  mkdir -p "${case_dir}" "${root_dir}"
  write_flutter_repo "${flutter_repo}" "main.example.test" "stage.example.test"
  flutter_sha="$(git -C "${flutter_repo}" rev-parse HEAD)"
  write_web_repo "${web_repo}" "${flutter_sha}" "${source_branch}" "${injected_host}"

  git -C "${root_dir}" init -q
  git -C "${root_dir}" -c protocol.file.allow=always submodule add -q "${flutter_repo}" flutter-app
  git -C "${root_dir}" -c protocol.file.allow=always submodule add -q "${web_repo}" web-app
  git_commit_all "${root_dir}" "seed root gitlinks"

  printf '%s\n' "${root_dir}"
}

prepare_root_descendant_case() {
  local case_name="$1"
  local source_branch="$2"
  local injected_host="$3"
  local case_dir="${scratch_dir}/${case_name}"
  local root_dir="${case_dir}/root"
  local flutter_repo="${case_dir}/flutter-src"
  local web_repo="${case_dir}/web-src"
  local pinned_flutter_sha=""
  local descendant_flutter_sha=""

  mkdir -p "${case_dir}" "${root_dir}"
  write_flutter_repo "${flutter_repo}" "main.example.test" "stage.example.test"
  pinned_flutter_sha="$(git -C "${flutter_repo}" rev-parse HEAD)"

  printf 'descendant\n' >"${flutter_repo}/descendant-marker.txt"
  git_commit_all "${flutter_repo}" "create descendant flutter build source"
  descendant_flutter_sha="$(git -C "${flutter_repo}" rev-parse --short HEAD)"

  write_web_repo "${web_repo}" "${descendant_flutter_sha}" "${source_branch}" "${injected_host}"

  git -C "${root_dir}" init -q
  git -C "${root_dir}" -c protocol.file.allow=always submodule add -q "${flutter_repo}" flutter-app
  git -C "${root_dir}/flutter-app" checkout -q "${pinned_flutter_sha}"
  git -C "${root_dir}" -c protocol.file.allow=always submodule add -q "${web_repo}" web-app
  git_commit_all "${root_dir}" "seed root gitlinks"

  printf '%s\n' "${root_dir}"
}

run_metadata_success() {
  local case_name="$1"
  local target_lane="$2"
  local root_dir="$3"
  local output_file="${scratch_dir}/${case_name}.out"
  local web_repo_path=""

  web_repo_path="$(git -C "${root_dir}" config -f .gitmodules --get submodule.web-app.url)"

  if ! (cd "${root_dir}" && PATH="${fake_bin}:${PATH}" REAL_GIT="${real_git}" PROOF_WEB_REPO_PATH="${web_repo_path}" WEB_APP_REPO="proof/web" GH_TOKEN="proof-token" bash "${check_metadata_script}" "${target_lane}") >"${output_file}" 2>&1; then
    echo "ERROR: expected web metadata contract case '${case_name}' to pass." >&2
    cat "${output_file}" >&2 || true
    exit 1
  fi
}

run_metadata_failure() {
  local case_name="$1"
  local target_lane="$2"
  local root_dir="$3"
  local expected_error="$4"
  local output_file="${scratch_dir}/${case_name}.out"
  local status=0
  local web_repo_path=""

  web_repo_path="$(git -C "${root_dir}" config -f .gitmodules --get submodule.web-app.url)"

  set +e
  (cd "${root_dir}" && PATH="${fake_bin}:${PATH}" REAL_GIT="${real_git}" PROOF_WEB_REPO_PATH="${web_repo_path}" WEB_APP_REPO="proof/web" GH_TOKEN="proof-token" bash "${check_metadata_script}" "${target_lane}") >"${output_file}" 2>&1
  status=$?
  set -e

  if [[ "${status}" -eq 0 ]]; then
    echo "ERROR: expected web metadata contract case '${case_name}' to fail." >&2
    cat "${output_file}" >&2 || true
    exit 1
  fi

  if ! grep -Fq "${expected_error}" "${output_file}"; then
    echo "ERROR: web metadata contract case '${case_name}' failed for the wrong reason." >&2
    cat "${output_file}" >&2 || true
    exit 1
  fi
}

start_static_server() {
  local serve_dir="$1"
  local port_file="$2"

  python3 - <<'PY' "${serve_dir}" "${port_file}" &
import http.server
import os
import socketserver
import sys
from pathlib import Path

serve_dir = sys.argv[1]
port_file = Path(sys.argv[2])
os.chdir(serve_dir)

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        return

class ReusableServer(socketserver.TCPServer):
    allow_reuse_address = True

with ReusableServer(("127.0.0.1", 0), QuietHandler) as httpd:
    port_file.write_text(str(httpd.server_address[1]), encoding="utf-8")
    httpd.serve_forever()
PY
  server_pid="$!"

  for _ in $(seq 1 50); do
    if [[ -s "${port_file}" ]]; then
      return
    fi
    sleep 0.1
  done

  echo "ERROR: local deployed provenance test server did not start." >&2
  exit 1
}

stop_static_server() {
  if [[ -n "${server_pid}" ]]; then
    kill "${server_pid}" 2>/dev/null || true
    wait "${server_pid}" 2>/dev/null || true
    server_pid=""
  fi
}

run_deployed_case() {
  local case_name="$1"
  local metadata_flutter_sha="$2"
  local expected_flutter_sha="$3"
  local source_branch="$4"
  local injected_host="$5"
  local expected_status="$6"
  local expected_error="${7:-}"
  local case_dir="${scratch_dir}/deployed-${case_name}"
  local root_dir="${case_dir}/root"
  local serve_dir="${case_dir}/serve"
  local port_file="${case_dir}/port"
  local output_file="${case_dir}/out"
  local status=0
  local port=""

  mkdir -p "${root_dir}/flutter-app/config/defines" "${serve_dir}"
  git -C "${root_dir}" init -q
  printf '{ "LANDLORD_DOMAIN": "https://main.example.test" }\n' >"${root_dir}/flutter-app/config/defines/main.json"
  printf '{"flutter_git_sha":"%s","source_branch":"%s","build_time_utc":"2026-05-22T00:00:00Z"}\n' \
    "${metadata_flutter_sha}" \
    "${source_branch}" \
    >"${serve_dir}/build_metadata.json"
  printf '<!doctype html><script>window.__LANDLORD_HOST__ = "%s";</script>\n' \
    "${injected_host}" \
    >"${serve_dir}/index.html"

  start_static_server "${serve_dir}" "${port_file}"
  port="$(<"${port_file}")"

  set +e
  (
    cd "${root_dir}"
    NAV_LANDLORD_URL="http://127.0.0.1:${port}" \
      EXPECTED_FLUTTER_SHA="${expected_flutter_sha}" \
      NAV_PROVENANCE_MAX_ATTEMPTS=1 \
      NAV_PROVENANCE_VALIDATION_MAX_ATTEMPTS=1 \
      bash "${check_deployed_script}" main
  ) >"${output_file}" 2>&1
  status=$?
  set -e

  stop_static_server

  if [[ "${expected_status}" == "success" && "${status}" -ne 0 ]]; then
    echo "ERROR: expected deployed provenance case '${case_name}' to pass." >&2
    cat "${output_file}" >&2 || true
    exit 1
  fi

  if [[ "${expected_status}" == "failure" ]]; then
    if [[ "${status}" -eq 0 ]]; then
      echo "ERROR: expected deployed provenance case '${case_name}' to fail." >&2
      cat "${output_file}" >&2 || true
      exit 1
    fi

    if ! grep -Fq "${expected_error}" "${output_file}"; then
      echo "ERROR: deployed provenance case '${case_name}' failed for the wrong reason." >&2
      cat "${output_file}" >&2 || true
      exit 1
    fi
  fi
}

main_ok_root="$(prepare_root_case_with_real_flutter_sha "main-source-branch-stage-ok" "stage" "main.example.test")"
run_metadata_success "main-source-branch-stage-ok" "main" "${main_ok_root}"

main_descendant_root="$(prepare_root_descendant_case "main-descendant-source-branch-stage-ok" "stage" "main.example.test")"
run_metadata_success "main-descendant-source-branch-stage-ok" "main" "${main_descendant_root}"

stage_mismatch_root="$(prepare_root_case_with_real_flutter_sha "stage-source-branch-main-fails" "main" "stage.example.test")"
run_metadata_failure \
  "stage-source-branch-main-fails" \
  "stage" \
  "${stage_mismatch_root}" \
  "ERROR: metadata source_branch mismatch for lane 'stage'"

host_mismatch_root="$(prepare_root_case_with_real_flutter_sha "main-host-mismatch-fails" "stage" "wrong.example.test")"
run_metadata_failure \
  "main-host-mismatch-fails" \
  "main" \
  "${host_mismatch_root}" \
  "ERROR: host injection mismatch for lane 'main'"

sha_mismatch_root="$(prepare_root_case "main-sha-mismatch-fails" "0000000000000000000000000000000000000000" "stage" "main.example.test")"
run_metadata_failure \
  "main-sha-mismatch-fails" \
  "main" \
  "${sha_mismatch_root}" \
  "ERROR: metadata mismatch on lane 'main'"

deployed_expected_sha="1111111111111111111111111111111111111111"
run_deployed_case \
  "main-source-branch-stage-ok" \
  "${deployed_expected_sha}" \
  "${deployed_expected_sha}" \
  "stage" \
  "main.example.test" \
  "success"
run_deployed_case \
  "main-host-mismatch-fails" \
  "${deployed_expected_sha}" \
  "${deployed_expected_sha}" \
  "stage" \
  "wrong.example.test" \
  "failure" \
  "ERROR: deployed landlord host mismatch for lane 'main'"
run_deployed_case \
  "main-sha-mismatch-fails" \
  "2222222222222222222222222222222222222222" \
  "${deployed_expected_sha}" \
  "stage" \
  "main.example.test" \
  "failure" \
  "ERROR: deployed flutter sha mismatch for lane 'main'"

echo "OK: web metadata main contract proof passed."
