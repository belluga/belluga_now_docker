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

repo_owner="${GITHUB_REPOSITORY%%/*}"

promotion_pr_number="$(
  gh pr list \
    --repo "${GITHUB_REPOSITORY}" \
    --state open \
    --base "${BASE_BRANCH}" \
    --json number,headRefName,headRepositoryOwner \
    --jq ".[] | select(.headRefName == \"${HEAD_BRANCH}\" and .headRepositoryOwner.login == \"${repo_owner}\") | .number" \
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

runs_json="$(
  gh api "repos/${GITHUB_REPOSITORY}/actions/workflows/orchestration-ci-cd.yml/runs?event=pull_request&branch=${HEAD_BRANCH}&per_page=50"
)"

selected_run_json="$(
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
)"

run_id="$(printf '%s' "${selected_run_json}" | jq -r '.id // empty')"
run_status="$(printf '%s' "${selected_run_json}" | jq -r '.status // empty')"
run_conclusion="$(printf '%s' "${selected_run_json}" | jq -r '.conclusion // empty')"
run_url="$(printf '%s' "${selected_run_json}" | jq -r '.html_url // empty')"

if [[ -z "${run_id}" ]]; then
  echo "ERROR: unable to find matching orchestration pull_request run for docker PR #${promotion_pr_number}." >&2
  exit 1
fi

if [[ "${run_status}" != "completed" ]]; then
  echo "INFO: orchestration run ${run_id} is currently '${run_status}'. Skipping rerun."
  echo "INFO: run URL: ${run_url}"
  exit 0
fi

echo "INFO: rerunning orchestration run ${run_id} (conclusion=${run_conclusion:-none})."
gh api --method POST "repos/${GITHUB_REPOSITORY}/actions/runs/${run_id}/rerun" >/dev/null
echo "INFO: rerun requested successfully for docker PR #${promotion_pr_number}."
