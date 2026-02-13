#!/usr/bin/env bash
set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: gh CLI is required." >&2
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "ERROR: git is required." >&2
  exit 1
fi

if [[ -z "${GH_TOKEN:-}" ]]; then
  echo "ERROR: GH_TOKEN is required." >&2
  exit 1
fi

SOURCE_REPO="${SOURCE_REPO:-${1:-}}"
HEAD_BRANCH="${HEAD_BRANCH:-${2:-}}"
BASE_BRANCH="${BASE_BRANCH:-${3:-}}"
EXPECTED_SHA="${EXPECTED_SHA:-${4:-}}"

if [[ -z "${SOURCE_REPO}" || -z "${HEAD_BRANCH}" || -z "${BASE_BRANCH}" || -z "${EXPECTED_SHA}" ]]; then
  echo "ERROR: usage: SOURCE_REPO=<owner/repo> HEAD_BRANCH=<dev|stage> BASE_BRANCH=<stage|main> EXPECTED_SHA=<sha> $0" >&2
  exit 1
fi

case "${HEAD_BRANCH}->${BASE_BRANCH}" in
  "dev->stage"|"stage->main") ;;
  *)
    echo "ERROR: invalid lane mapping '${HEAD_BRANCH}->${BASE_BRANCH}'." >&2
    exit 1
    ;;
esac

if [[ ! "${EXPECTED_SHA}" =~ ^[0-9a-fA-F]{40}$ ]]; then
  echo "ERROR: EXPECTED_SHA must be a full 40-char git SHA." >&2
  exit 1
fi

EXPECTED_SHA="$(printf '%s' "${EXPECTED_SHA}" | tr '[:upper:]' '[:lower:]')"
SHORT_SHA="$(echo "${EXPECTED_SHA}" | cut -c1-12)"

tmp_dir="$(mktemp -d)"
cleanup() { rm -rf "${tmp_dir}"; }
trap cleanup EXIT

repo_dir="${tmp_dir}/repo"
repo_url="https://x-access-token:${GH_TOKEN}@github.com/${SOURCE_REPO}.git"

git clone --quiet --filter=blob:none --no-checkout "${repo_url}" "${repo_dir}"
cd "${repo_dir}"

git fetch origin --prune --quiet "${HEAD_BRANCH}" "${BASE_BRANCH}" stage main || true
git fetch origin --quiet "${EXPECTED_SHA}" || true

if ! git cat-file -e "${EXPECTED_SHA}^{commit}" 2>/dev/null; then
  echo "ERROR: expected SHA ${EXPECTED_SHA} not found in ${SOURCE_REPO}." >&2
  exit 1
fi

is_sha_on_remote_branch() {
  local branch="$1"
  if ! git rev-parse --verify "origin/${branch}" >/dev/null 2>&1; then
    return 1
  fi
  git merge-base --is-ancestor "${EXPECTED_SHA}" "origin/${branch}"
}

find_existing_lane_pr_number() {
  local repo_slug="$1"
  local base_branch="$2"
  local head_branch="$3"
  local repo_owner="${repo_slug%%/*}"

  gh pr list \
    --repo "${repo_slug}" \
    --state open \
    --base "${base_branch}" \
    --json number,headRefName,headRepositoryOwner \
    --jq ".[] | select(.headRefName == \"${head_branch}\" and .headRepositoryOwner.login == \"${repo_owner}\") | .number" \
    | head -n1
}

already_promoted_noop=0
if [[ "${BASE_BRANCH}" == "stage" ]]; then
  if is_sha_on_remote_branch "stage" || is_sha_on_remote_branch "main"; then
    already_promoted_noop=1
  fi
else
  if is_sha_on_remote_branch "main"; then
    already_promoted_noop=1
  fi
fi

if [[ "${already_promoted_noop}" -eq 1 ]]; then
  echo "INFO: ${SOURCE_REPO}@${EXPECTED_SHA} already present on ${BASE_BRANCH} (or advanced lane). Marking no-op."
  exit 0
fi

if ! is_sha_on_remote_branch "${HEAD_BRANCH}"; then
  echo "ERROR: expected SHA ${EXPECTED_SHA} is not on source lane ${SOURCE_REPO}:${HEAD_BRANCH}." >&2
  exit 1
fi

source_lane_tip="$(git rev-parse --verify "origin/${HEAD_BRANCH}" 2>/dev/null || true)"
if [[ -z "${source_lane_tip}" ]]; then
  echo "ERROR: unable to resolve source lane tip for ${SOURCE_REPO}:${HEAD_BRANCH}." >&2
  exit 1
fi
source_lane_tip="$(printf '%s' "${source_lane_tip}" | tr '[:upper:]' '[:lower:]')"

if [[ "${EXPECTED_SHA}" != "${source_lane_tip}" ]]; then
  echo "ERROR: expected SHA ${EXPECTED_SHA} is not the current tip of ${SOURCE_REPO}:${HEAD_BRANCH} (${source_lane_tip})." >&2
  echo "ERROR: lane promotion requires exact source-lane tip, unless already-promoted no-op applies." >&2
  exit 1
fi

existing_pr_number="$(find_existing_lane_pr_number "${SOURCE_REPO}" "${BASE_BRANCH}" "${HEAD_BRANCH}")"

title="chore(lane): promote ${HEAD_BRANCH} -> ${BASE_BRANCH} (${SHORT_SHA})"
body=$'Automated lane promotion PR (exact SHA lock requested by belluga_now_docker).\n\n'"- Source lane: ${HEAD_BRANCH}"$'\n'"- Target lane: ${BASE_BRANCH}"$'\n'"- Expected SHA: ${EXPECTED_SHA}"$'\n\n'"<!-- ORCHESTRATOR_EXPECTED_SHA:${EXPECTED_SHA} -->"$'\n'

if [[ -n "${existing_pr_number}" ]]; then
  gh pr edit "${existing_pr_number}" --repo "${SOURCE_REPO}" --title "${title}" --body "${body}"
  echo "INFO: updated PR #${existing_pr_number} in ${SOURCE_REPO} (${HEAD_BRANCH} -> ${BASE_BRANCH}) with expected SHA lock."
  exit 0
fi

pr_url="$(
  gh pr create \
    --repo "${SOURCE_REPO}" \
    --base "${BASE_BRANCH}" \
    --head "${HEAD_BRANCH}" \
    --title "${title}" \
    --body "${body}"
)"

pr_number="$(gh pr view "${pr_url}" --repo "${SOURCE_REPO}" --json number --jq '.number')"
echo "INFO: created PR #${pr_number} in ${SOURCE_REPO} (${HEAD_BRANCH} -> ${BASE_BRANCH}) with expected SHA lock."
