#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${GH_TOKEN:-}" ]]; then
  echo "ERROR: GH_TOKEN is required." >&2
  exit 1
fi

HEAD_BRANCH="${GITHUB_HEAD_REF:-}"
BASE_BRANCH="${GITHUB_BASE_REF:-}"

if [[ -z "${HEAD_BRANCH}" || -z "${BASE_BRANCH}" ]]; then
  echo "ERROR: prepare_source_promotion_prs.sh must run on pull_request context with head/base refs." >&2
  exit 1
fi

case "${HEAD_BRANCH}->${BASE_BRANCH}" in
  "dev->stage"|"stage->main") ;;
  *)
    echo "INFO: skipping source promotion PR preparation for non-promotion mapping '${HEAD_BRANCH}->${BASE_BRANCH}'."
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

SUBMODULES=(flutter-app web-app laravel-app)

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

  echo "INFO: preparing source PR for ${submodule}: ${source_repo} (${HEAD_BRANCH}->${BASE_BRANCH}, sha=${expected_sha})"
  SOURCE_REPO="${source_repo}" \
  HEAD_BRANCH="${HEAD_BRANCH}" \
  BASE_BRANCH="${BASE_BRANCH}" \
  EXPECTED_SHA="${expected_sha}" \
  GH_TOKEN="${GH_TOKEN}" \
    bash .github/scripts/upsert_source_promotion_pr.sh
done

echo "INFO: source promotion PR preparation complete."
