#!/usr/bin/env bash
set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: GitHub CLI (gh) is required." >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is required." >&2
  exit 1
fi

if [[ -z "${GH_TOKEN:-}" ]]; then
  echo "ERROR: GH_TOKEN is required to query submodule CI status." >&2
  exit 1
fi

SUBMODULES=(flutter-app laravel-app web-app)

parse_repo_slug_from_url() {
  local url="$1"

  url="${url#git@github.com:}"
  url="${url#ssh://git@github.com/}"
  url="${url#https://github.com/}"
  url="${url#http://github.com/}"
  url="${url%.git}"

  if [[ "$url" != */* ]]; then
    return 1
  fi

  printf '%s\n' "$url"
}

api_get() {
  local path="$1"
  local response
  local exit_code

  set +e
  response="$(gh api -H "Accept: application/vnd.github+json" "$path" 2>&1)"
  exit_code=$?
  set -e

  if [[ "$exit_code" -ne 0 ]]; then
    echo "ERROR: GitHub API request failed for '$path': $response" >&2
    return 1
  fi

  printf '%s\n' "$response"
}

for submodule in "${SUBMODULES[@]}"; do
  pinned_sha="$(git ls-tree HEAD "$submodule" | awk '{print $3}')"
  if [[ -z "$pinned_sha" ]]; then
    echo "ERROR: failed to resolve pinned SHA for '$submodule'" >&2
    exit 1
  fi

  submodule_url="$(git config -f .gitmodules --get "submodule.${submodule}.url" || true)"
  if [[ -z "$submodule_url" ]]; then
    echo "ERROR: missing .gitmodules URL for '$submodule'" >&2
    exit 1
  fi

  repo_slug="$(parse_repo_slug_from_url "$submodule_url" || true)"
  if [[ -z "$repo_slug" ]]; then
    echo "ERROR: could not parse GitHub repository slug from '$submodule_url' for '$submodule'" >&2
    exit 1
  fi

  echo "INFO: validating CI status for $submodule ($repo_slug@$pinned_sha)"

  workflow_runs_json="$(api_get "repos/${repo_slug}/actions/runs?head_sha=${pinned_sha}&per_page=100")"
  commit_status_json="$(api_get "repos/${repo_slug}/commits/${pinned_sha}/status")"

  # Only consider lane publication evidence for a pinned SHA.
  # PR/concurrency-related failures on the same SHA should not block promotions.
  relevant_runs_json="$(
    jq '[
      .workflow_runs[]?
      | select((.event // "") == "push" or (.event // "") == "workflow_dispatch" or (.event // "") == "repository_dispatch")
    ]' <<<"$workflow_runs_json"
  )"

  # Evaluate only the latest run per workflow to avoid blocking on stale failures
  # when a newer rerun/workflow-dispatch already passed for the same SHA.
  latest_relevant_runs_json="$(
    jq '
      sort_by(.created_at // .updated_at // "")
      | reverse
      | unique_by((.workflow_id // .name // "unknown") | tostring)
    ' <<<"$relevant_runs_json"
  )"

  workflow_runs_total="$(jq 'length' <<<"$latest_relevant_runs_json")"
  workflow_runs_success_count="$(jq '[.[] | select(.status == "completed" and .conclusion == "success")] | length' <<<"$latest_relevant_runs_json")"
  workflow_runs_pending_count="$(jq '[.[] | select(.status != "completed")] | length' <<<"$latest_relevant_runs_json")"
  workflow_runs_failing_count="$(jq '[.[] | select(.status == "completed" and (.conclusion == "failure" or .conclusion == "timed_out" or .conclusion == "action_required"))] | length' <<<"$latest_relevant_runs_json")"

  status_contexts_total="$(jq '[.statuses[]?] | length' <<<"$commit_status_json")"
  status_state="$(jq -r '.state // "unknown"' <<<"$commit_status_json")"

  if [[ "$workflow_runs_pending_count" -gt 0 ]]; then
    echo "ERROR: $submodule has pending workflow runs for pinned SHA $pinned_sha." >&2
    exit 1
  fi

  if [[ "$workflow_runs_failing_count" -gt 0 ]]; then
    echo "ERROR: $submodule has failing workflow runs for pinned SHA $pinned_sha:" >&2
    jq -r '.[] | select(.status == "completed" and (.conclusion == "failure" or .conclusion == "timed_out" or .conclusion == "action_required")) | "- \(.name) [event=\(.event), branch=\(.head_branch // "n/a"), run_id=\(.id)]: \(.conclusion)"' <<<"$latest_relevant_runs_json" >&2
    exit 1
  fi

  # Commit statuses aggregate heterogeneous contexts and can remain non-success
  # after a green rerun. Use them only when there are no relevant workflow runs.
  if [[ "$workflow_runs_total" -eq 0 && "$status_contexts_total" -gt 0 && "$status_state" != "success" ]]; then
    echo "ERROR: $submodule commit status is '$status_state' for pinned SHA $pinned_sha (expected 'success')." >&2
    exit 1
  fi

  if [[ "$workflow_runs_total" -eq 0 && "$status_contexts_total" -eq 0 ]]; then
    echo "ERROR: $submodule has no CI evidence (no workflow runs/status contexts) for pinned SHA $pinned_sha." >&2
    exit 1
  fi

  if [[ "$workflow_runs_total" -gt 0 && "$workflow_runs_success_count" -eq 0 ]]; then
    echo "ERROR: $submodule has workflow runs but none concluded with success for pinned SHA $pinned_sha." >&2
    exit 1
  fi

  if [[ "$workflow_runs_total" -eq 0 && "$status_state" != "success" ]]; then
    echo "ERROR: $submodule has no workflow runs and commit status is '$status_state' for pinned SHA $pinned_sha." >&2
    exit 1
  fi

  echo "OK: $submodule pinned SHA $pinned_sha has green CI (workflow-runs/status) on $repo_slug"
done
