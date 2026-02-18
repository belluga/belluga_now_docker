#!/usr/bin/env bash
set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: gh CLI is required." >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is required." >&2
  exit 1
fi

if [[ -z "${GH_TOKEN:-}" ]]; then
  echo "ERROR: GH_TOKEN is required." >&2
  exit 1
fi

TARGET_BRANCH="${GITHUB_REF_NAME:-}"
if [[ -z "${TARGET_BRANCH}" ]]; then
  echo "ERROR: GITHUB_REF_NAME is required." >&2
  exit 1
fi

case "${TARGET_BRANCH}" in
  stage)
    HEAD_BRANCH="dev"
    ;;
  main)
    HEAD_BRANCH="stage"
    ;;
  *)
    echo "INFO: skipping source promotion execution for non-promotion target '${TARGET_BRANCH}'."
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

assert_sha_green_ci() {
  local repo_slug="$1"
  local sha="$2"

  workflow_runs_json="$(gh api -H "Accept: application/vnd.github+json" "repos/${repo_slug}/actions/runs?head_sha=${sha}&per_page=100")"
  commit_status_json="$(gh api -H "Accept: application/vnd.github+json" "repos/${repo_slug}/commits/${sha}/status")"

  workflow_runs_total="$(jq '[.workflow_runs[]?] | length' <<<"${workflow_runs_json}")"
  workflow_runs_pending_count="$(jq '[.workflow_runs[]? | select(.status != "completed")] | length' <<<"${workflow_runs_json}")"
  workflow_runs_success_count="$(jq '[.workflow_runs[]? | select(.status == "completed" and .conclusion == "success")] | length' <<<"${workflow_runs_json}")"
  workflow_runs_failing_count="$(jq '[.workflow_runs[]? | select(.status == "completed" and (.conclusion == "failure" or .conclusion == "timed_out" or .conclusion == "cancelled" or .conclusion == "action_required" or .conclusion == "stale"))] | length' <<<"${workflow_runs_json}")"

  status_contexts_total="$(jq '[.statuses[]?] | length' <<<"${commit_status_json}")"
  status_state="$(jq -r '.state // "unknown"' <<<"${commit_status_json}")"

  if [[ "${workflow_runs_pending_count}" -gt 0 ]]; then
    echo "ERROR: ${repo_slug}@${sha} has pending workflow runs." >&2
    return 1
  fi

  if [[ "${workflow_runs_failing_count}" -gt 0 ]]; then
    echo "ERROR: ${repo_slug}@${sha} has failing workflow runs." >&2
    return 1
  fi

  if [[ "${status_contexts_total}" -gt 0 && "${status_state}" != "success" ]]; then
    echo "ERROR: ${repo_slug}@${sha} combined commit status is '${status_state}' (expected success)." >&2
    return 1
  fi

  if [[ "${workflow_runs_total}" -eq 0 && "${status_contexts_total}" -eq 0 ]]; then
    echo "ERROR: ${repo_slug}@${sha} has no CI evidence." >&2
    return 1
  fi

  if [[ "${workflow_runs_total}" -gt 0 && "${workflow_runs_success_count}" -eq 0 ]]; then
    echo "ERROR: ${repo_slug}@${sha} has workflow runs but none with success conclusion." >&2
    return 1
  fi

  if [[ "${workflow_runs_total}" -eq 0 && "${status_state}" != "success" ]]; then
    echo "ERROR: ${repo_slug}@${sha} has no workflow runs and commit status is not success." >&2
    return 1
  fi
}

is_sha_on_remote_branch() {
  local submodule="$1"
  local sha="$2"
  local branch="$3"

  if ! git -C "${submodule}" rev-parse --verify "origin/${branch}" >/dev/null 2>&1; then
    return 1
  fi

  git -C "${submodule}" merge-base --is-ancestor "${sha}" "origin/${branch}"
}

find_existing_lane_pr_number() {
  local repo_slug="$1"
  local base_branch="$2"
  local head_branch="$3"

  gh pr list \
    --repo "${repo_slug}" \
    --state open \
    --base "${base_branch}" \
    --json number,headRefName \
    --jq ".[] | select(.headRefName == \"${head_branch}\") | .number" \
    | head -n1
}

# Source promotion applies only to true source repos.
# web-app is a derived artifact generated from flutter-app per lane.
SUBMODULES=(flutter-app laravel-app)

for submodule in "${SUBMODULES[@]}"; do
  expected_sha="$(git ls-tree HEAD "${submodule}" | awk '{print $3}')"
  if [[ -z "${expected_sha}" ]]; then
    echo "ERROR: failed to resolve pinned SHA for '${submodule}'." >&2
    exit 1
  fi

  submodule_url="$(git config -f .gitmodules --get "submodule.${submodule}.url" || true)"
  if [[ -z "${submodule_url}" ]]; then
    echo "ERROR: missing .gitmodules URL for '${submodule}'." >&2
    exit 1
  fi

  source_repo="$(parse_repo_slug_from_url "${submodule_url}")"
  if [[ "${source_repo}" != */* ]]; then
    echo "ERROR: invalid repository slug '${source_repo}' parsed from '${submodule_url}'." >&2
    exit 1
  fi

  git -C "${submodule}" fetch origin --prune --quiet || true

  no_op=0
  if [[ "${TARGET_BRANCH}" == "stage" ]]; then
    if is_sha_on_remote_branch "${submodule}" "${expected_sha}" "stage" || is_sha_on_remote_branch "${submodule}" "${expected_sha}" "main"; then
      no_op=1
    fi
  else
    if is_sha_on_remote_branch "${submodule}" "${expected_sha}" "main"; then
      no_op=1
    fi
  fi

  if [[ "${no_op}" -eq 1 ]]; then
    echo "INFO: ${submodule} (${source_repo}@${expected_sha}) already promoted on ${TARGET_BRANCH} (or advanced lane). No-op success."
    continue
  fi

  pr_number="$(find_existing_lane_pr_number "${source_repo}" "${TARGET_BRANCH}" "${HEAD_BRANCH}")"
  if [[ -z "${pr_number}" ]]; then
    echo "ERROR: missing source promotion PR in ${source_repo} for ${HEAD_BRANCH} -> ${TARGET_BRANCH}." >&2
    exit 1
  fi

  pr_expected_sha="$(
    gh pr view "${pr_number}" --repo "${source_repo}" --json body \
      --jq '.body // ""' \
      | sed -n 's/^- Expected SHA:[[:space:]]*//p' \
      | head -n1 \
      | tr -d '\r' \
      | tr '[:upper:]' '[:lower:]'
  )"
  if [[ -z "${pr_expected_sha}" ]]; then
    echo "ERROR: PR #${pr_number} in ${source_repo} is missing '- Expected SHA: <sha>' lock metadata." >&2
    exit 1
  fi
  if [[ "${pr_expected_sha}" != "${expected_sha}" ]]; then
    echo "ERROR: PR #${pr_number} in ${source_repo} has expected SHA ${pr_expected_sha}, but docker pins ${expected_sha}." >&2
    exit 1
  fi

  pr_head_sha="$(gh pr view "${pr_number}" --repo "${source_repo}" --json headRefOid --jq '.headRefOid')"
  if ! git -C "${submodule}" cat-file -e "${pr_head_sha}^{commit}" 2>/dev/null; then
    git -C "${submodule}" fetch origin "${pr_head_sha}" --quiet || true
  fi
  if ! git -C "${submodule}" cat-file -e "${pr_head_sha}^{commit}" 2>/dev/null; then
    echo "ERROR: unable to resolve PR head commit ${pr_head_sha} for ${source_repo}." >&2
    exit 1
  fi
  if ! git -C "${submodule}" merge-base --is-ancestor "${expected_sha}" "${pr_head_sha}"; then
    echo "ERROR: PR #${pr_number} in ${source_repo} head ${pr_head_sha} does not contain expected SHA ${expected_sha}." >&2
    exit 1
  fi

  echo "INFO: validating CI for ${source_repo}@${expected_sha} before merge."
  assert_sha_green_ci "${source_repo}" "${expected_sha}"

  echo "INFO: merging source PR #${pr_number} in ${source_repo}."
  if ! gh pr merge "${pr_number}" --repo "${source_repo}" --merge; then
    echo "ERROR: failed to merge source PR #${pr_number} in ${source_repo} with --merge." >&2
    echo "ERROR: exact-SHA promotion forbids squash/rebase because they rewrite commit identity." >&2
    exit 1
  fi

  # Post-merge guard: promoted lane must still contain the exact expected SHA.
  if ! git -C "${submodule}" fetch origin "${TARGET_BRANCH}" --quiet; then
    echo "ERROR: unable to fetch ${source_repo}:${TARGET_BRANCH} for post-merge validation." >&2
    exit 1
  fi
  if ! git -C "${submodule}" merge-base --is-ancestor "${expected_sha}" "origin/${TARGET_BRANCH}"; then
    echo "ERROR: ${source_repo}:${TARGET_BRANCH} does not contain expected SHA ${expected_sha} after merge." >&2
    echo "ERROR: promotion aborted because exact-SHA guarantee was not preserved." >&2
    exit 1
  fi
done

echo "INFO: source promotion execution complete for ${HEAD_BRANCH}->${TARGET_BRANCH}."
