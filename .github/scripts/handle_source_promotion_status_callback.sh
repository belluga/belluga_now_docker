#!/usr/bin/env bash
set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: GitHub CLI (gh) is required." >&2
  exit 1
fi

if [[ -z "${GH_TOKEN:-}" ]]; then
  echo "ERROR: GH_TOKEN is required." >&2
  exit 1
fi

SOURCE_REPO="${CALLBACK_SOURCE_REPO:-}"
HEAD_BRANCH="${CALLBACK_HEAD_BRANCH:-}"
BASE_BRANCH="${CALLBACK_BASE_BRANCH:-}"
CALLBACK_RESULT="${CALLBACK_RESULT:-unknown}"
SOURCE_PR_NUMBER="${CALLBACK_SOURCE_PR_NUMBER:-}"
SOURCE_PR_URL="${CALLBACK_SOURCE_PR_URL:-}"
SUBMODULES_REPO_TOKEN="${SUBMODULES_REPO_TOKEN:-}"
WEB_APP_REPO_TOKEN="${WEB_APP_REPO_TOKEN:-}"

if [[ -z "${SOURCE_REPO}" || -z "${HEAD_BRANCH}" || -z "${BASE_BRANCH}" ]]; then
  echo "ERROR: callback payload is missing source_repo/head/base." >&2
  exit 1
fi

case "${HEAD_BRANCH}->${BASE_BRANCH}" in
  "dev->stage"|"stage->main") ;;
  *)
    echo "INFO: skipping callback for non-promotion mapping '${HEAD_BRANCH}->${BASE_BRANCH}'."
    exit 0
    ;;
esac

parse_repo_slug_from_url() {
  local url="$1"
  url="${url#git@github.com:}"
  url="${url#ssh://git@github.com/}"
  url="${url#https://github.com/}"
  url="${url#http://github.com/}"
  url="${url%.git}"
  printf '%s\n' "${url}"
}

ensure_submodules_initialized_for_readiness() {
  local required_submodules=(flutter-app web-app laravel-app)
  local submodule
  local all_initialized="true"

  for submodule in "${required_submodules[@]}"; do
    if [[ ! -d "${submodule}/.git" && ! -f "${submodule}/.git" ]]; then
      all_initialized="false"
      break
    fi
  done

  if [[ "${all_initialized}" == "true" ]]; then
    return 0
  fi

  local token="${SUBMODULES_REPO_TOKEN}"
  if [[ -z "${token}" ]]; then
    token="${WEB_APP_REPO_TOKEN}"
  fi

  if [[ -z "${token}" ]]; then
    echo "INFO: submodules are not initialized and no submodule token is available; skipping readiness check."
    return 1
  fi

  echo "::add-mask::${token}"
  git config --global url."https://x-access-token:${token}@github.com/".insteadOf "https://github.com/"
  git submodule sync --recursive
  git submodule update --init --recursive
}

allowed_source_repos=()
while IFS= read -r submodule_key; do
  submodule_url="$(git config -f .gitmodules --get "${submodule_key}" || true)"
  if [[ -z "${submodule_url}" ]]; then
    continue
  fi
  allowed_source_repos+=("$(parse_repo_slug_from_url "${submodule_url}")")
done < <(git config -f .gitmodules --name-only --get-regexp '^submodule\..*\.url$' || true)

is_allowed="false"
for repo in "${allowed_source_repos[@]}"; do
  if [[ "${repo}" == "${SOURCE_REPO}" ]]; then
    is_allowed="true"
    break
  fi
done

if [[ "${is_allowed}" != "true" ]]; then
  echo "INFO: ignoring callback from non-submodule repository '${SOURCE_REPO}'."
  exit 0
fi

if [[ "${GITHUB_REPOSITORY:-}" != */* ]]; then
  echo "ERROR: invalid GITHUB_REPOSITORY '${GITHUB_REPOSITORY:-}'." >&2
  exit 1
fi

promotion_pr_number="$(
  gh pr list \
    --repo "${GITHUB_REPOSITORY}" \
    --state open \
    --base "${BASE_BRANCH}" \
    --json number,headRefName \
    --jq ".[] | select(.headRefName == \"${HEAD_BRANCH}\") | .number" \
    | head -n1
)"

if [[ -z "${promotion_pr_number}" ]]; then
  echo "INFO: no open docker promotion PR found for ${HEAD_BRANCH}->${BASE_BRANCH}; nothing to rerun."
  exit 0
fi

promotion_pr_url="$(
  gh pr view "${promotion_pr_number}" --repo "${GITHUB_REPOSITORY}" --json url --jq '.url'
)"
promotion_pr_head_sha="$(
  gh pr view "${promotion_pr_number}" --repo "${GITHUB_REPOSITORY}" --json headRefOid --jq '.headRefOid'
)"

echo "INFO: callback received from ${SOURCE_REPO} result=${CALLBACK_RESULT} source_pr=${SOURCE_PR_NUMBER:-n/a} url=${SOURCE_PR_URL:-n/a}"
echo "INFO: targeting docker PR #${promotion_pr_number} (${promotion_pr_url}) head=${promotion_pr_head_sha}"

fetch_matching_run_json() {
  local runs_json
  runs_json="$(
    gh api "repos/${GITHUB_REPOSITORY}/actions/workflows/orchestration-ci-cd.yml/runs?event=pull_request&branch=${HEAD_BRANCH}&per_page=50"
  )"

  printf '%s' "${runs_json}" | jq -c --arg sha "${promotion_pr_head_sha}" --argjson pr "${promotion_pr_number}" '
    [
      .workflow_runs[]
      | select(
          .head_sha == $sha
          and (((.pull_requests // []) | map(.number) | index($pr)) != null)
        )
    ]
    | sort_by(.created_at)
    | last
  '
}

selected_run_json=''
run_id=''
run_status=''
run_conclusion=''
run_url=''

lookup_timeout="${CALLBACK_RUN_LOOKUP_TIMEOUT_SECONDS:-120}"
lookup_interval="${CALLBACK_RUN_LOOKUP_INTERVAL_SECONDS:-5}"
lookup_deadline=$((SECONDS + lookup_timeout))

while (( SECONDS < lookup_deadline )); do
  selected_run_json="$(fetch_matching_run_json)"
  run_id="$(printf '%s' "${selected_run_json}" | jq -r '.id // empty')"
  run_status="$(printf '%s' "${selected_run_json}" | jq -r '.status // empty')"
  run_conclusion="$(printf '%s' "${selected_run_json}" | jq -r '.conclusion // empty')"
  run_url="$(printf '%s' "${selected_run_json}" | jq -r '.html_url // empty')"

  if [[ -n "${run_id}" ]]; then
    break
  fi

  sleep "${lookup_interval}"
done

if [[ -z "${run_id}" ]]; then
  echo "INFO: no matching orchestration pull_request run yet for docker PR #${promotion_pr_number}; skipping callback rerun."
  exit 0
fi

wait_timeout="${CALLBACK_WAIT_FOR_RUN_COMPLETION_SECONDS:-900}"
wait_interval="${CALLBACK_WAIT_FOR_RUN_COMPLETION_INTERVAL_SECONDS:-10}"
wait_deadline=$((SECONDS + wait_timeout))

while [[ "${run_status}" != "completed" ]] && (( SECONDS < wait_deadline )); do
  echo "INFO: orchestration run ${run_id} is '${run_status}'. Waiting for completion before rerun decision."
  sleep "${wait_interval}"

  run_json="$(gh api "repos/${GITHUB_REPOSITORY}/actions/runs/${run_id}")"
  run_status="$(printf '%s' "${run_json}" | jq -r '.status // empty')"
  run_conclusion="$(printf '%s' "${run_json}" | jq -r '.conclusion // empty')"
  run_url="$(printf '%s' "${run_json}" | jq -r '.html_url // empty')"
done

if [[ "${run_status}" != "completed" ]]; then
  echo "INFO: orchestration run ${run_id} is still '${run_status}' after wait timeout; skipping callback rerun."
  echo "INFO: run URL: ${run_url}"
  exit 0
fi

if [[ "${run_conclusion}" == "success" ]]; then
  echo "INFO: orchestration run ${run_id} already succeeded; rerun is not required."
  echo "INFO: run URL: ${run_url}"
  exit 0
fi

normalized_callback_result="$(printf '%s' "${CALLBACK_RESULT}" | tr '[:upper:]' '[:lower:]')"
if [[ "${normalized_callback_result}" != "success" ]]; then
  echo "INFO: callback result is '${CALLBACK_RESULT}' (non-success); skipping rerun."
  echo "INFO: run URL: ${run_url}"
  exit 0
fi

if ! ensure_submodules_initialized_for_readiness; then
  echo "INFO: skipping rerun because readiness check prerequisites are unavailable."
  echo "INFO: run URL: ${run_url}"
  exit 0
fi

ready_log="$(mktemp)"
if ! GITHUB_HEAD_REF="${HEAD_BRANCH}" GITHUB_BASE_REF="${BASE_BRANCH}" GH_TOKEN="${GH_TOKEN}" \
  bash .github/scripts/check_source_promotion_prs_ready.sh >"${ready_log}" 2>&1; then
  echo "INFO: source promotion PRs are not fully merge-ready yet; skipping rerun."
  sed 's/^/INFO: readiness -> /' "${ready_log}"
  rm -f "${ready_log}"
  exit 0
fi
rm -f "${ready_log}"

echo "INFO: rerunning orchestration run ${run_id} (conclusion=${run_conclusion:-none})."
gh api --method POST "repos/${GITHUB_REPOSITORY}/actions/runs/${run_id}/rerun" >/dev/null
echo "INFO: rerun requested successfully for docker PR #${promotion_pr_number}."
