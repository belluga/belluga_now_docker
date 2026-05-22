#!/usr/bin/env bash
set -euo pipefail

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "ERROR: required environment variable '${name}' is missing." >&2
    exit 1
  fi
}

require_env DEPLOY_LANE
require_env WEB_APP_REPO
require_env GH_TOKEN

if [[ "${DEPLOY_LANE}" != "stage" && "${DEPLOY_LANE}" != "main" ]]; then
  echo "ERROR: DEPLOY_LANE must be 'stage' or 'main' when resolving protected web-app runtime SHA." >&2
  exit 1
fi

repo_slug="$(printf '%s' "${WEB_APP_REPO}" | tr -d '[:space:]')"
if ! [[ "${repo_slug}" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  echo "ERROR: WEB_APP_REPO must be an owner/repo slug; received '${WEB_APP_REPO}'." >&2
  exit 1
fi

remote_url="https://x-access-token:${GH_TOKEN}@github.com/${repo_slug}.git"
runtime_sha="$(git ls-remote "${remote_url}" "refs/heads/${DEPLOY_LANE}" | awk '{print $1}' | head -n 1 | tr -d '[:space:]')"

if ! [[ "${runtime_sha}" =~ ^[0-9a-fA-F]{40}$ ]]; then
  echo "ERROR: unable to resolve web-app runtime SHA from ${repo_slug}@${DEPLOY_LANE}." >&2
  exit 1
fi

runtime_sha="$(printf '%s' "${runtime_sha}" | tr '[:upper:]' '[:lower:]')"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  echo "web_app_runtime_sha=${runtime_sha}" >> "${GITHUB_OUTPUT}"
  echo "web_app_runtime_authority=lane-resolved-sha" >> "${GITHUB_OUTPUT}"
  echo "runtime_topology_version=web-app-lane-sha-v1" >> "${GITHUB_OUTPUT}"
fi

echo "INFO: resolved protected web-app runtime SHA ${runtime_sha} from ${repo_slug}@${DEPLOY_LANE}."
