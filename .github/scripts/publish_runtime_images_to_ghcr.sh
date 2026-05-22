#!/usr/bin/env bash
set -euo pipefail

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "ERROR: required environment variable '${name}' is missing." >&2
    exit 1
  fi
}

sanitize_image_component() {
  printf '%s' "$1" |
    tr '[:upper:]' '[:lower:]' |
    sed -E 's/[^a-z0-9._-]+/-/g; s/^-+//; s/-+$//'
}

extract_digest() {
  local image_ref="$1"
  local digest

  digest="$(docker buildx imagetools inspect "${image_ref}" --format '{{.Manifest.Digest}}' | tr -d '\r[:space:]')"
  if ! [[ "${digest}" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    echo "ERROR: unable to resolve immutable digest for ${image_ref}." >&2
    exit 1
  fi

  printf '%s' "${digest}"
}

write_output() {
  local key="$1"
  local value="$2"

  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    printf '%s=%s\n' "${key}" "${value}" >> "${GITHUB_OUTPUT}"
  fi
}

require_env DEPLOY_LANE
require_env GITHUB_REPOSITORY
require_env GITHUB_SHA
require_env GITHUB_RUN_ID
require_env GITHUB_RUN_ATTEMPT
require_env GHCR_USERNAME
require_env GHCR_TOKEN

if [[ "${DEPLOY_LANE}" != "stage" && "${DEPLOY_LANE}" != "main" ]]; then
  echo "ERROR: DEPLOY_LANE must be 'stage' or 'main' for GHCR runtime image publishing." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required to publish runtime images." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: docker daemon is not reachable for runtime image publishing." >&2
  exit 1
fi

if ! docker buildx version >/dev/null 2>&1; then
  echo "ERROR: docker buildx is required to publish runtime images." >&2
  exit 1
fi

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
owner_raw="${GITHUB_REPOSITORY%%/*}"
repo_raw="${GITHUB_REPOSITORY#*/}"
owner="$(sanitize_image_component "${owner_raw}")"
repo="$(sanitize_image_component "${repo_raw}")"

if [[ -z "${owner}" || -z "${repo}" ]]; then
  echo "ERROR: unable to derive valid lowercase GHCR image namespace from GITHUB_REPOSITORY='${GITHUB_REPOSITORY}'." >&2
  exit 1
fi

tag="$(sanitize_image_component "${DEPLOY_LANE}-${GITHUB_SHA}-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}")"
if [[ -z "${tag}" ]]; then
  echo "ERROR: unable to derive immutable image tag." >&2
  exit 1
fi

laravel_image="ghcr.io/${owner}/${repo}-laravel-runtime"
nginx_image="ghcr.io/${owner}/${repo}-nginx"
laravel_tag_ref="${laravel_image}:${tag}"
nginx_tag_ref="${nginx_image}:${tag}"

tmp_docker_config="$(mktemp -d)"
cleanup() {
  rm -rf "${tmp_docker_config}"
}
trap cleanup EXIT
export DOCKER_CONFIG="${tmp_docker_config}"

printf '%s' "${GHCR_TOKEN}" | docker login ghcr.io -u "${GHCR_USERNAME}" --password-stdin >/dev/null

echo "INFO: publishing Laravel runtime image ${laravel_tag_ref}"
DOCKER_BUILDKIT=1 BUILDKIT_PROGRESS=plain docker buildx build \
  --pull \
  --file "${repo_root}/docker/laravel-app/Dockerfile" \
  --label "org.opencontainers.image.source=https://github.com/${GITHUB_REPOSITORY}" \
  --label "org.opencontainers.image.revision=${GITHUB_SHA}" \
  --label "org.opencontainers.image.version=${tag}" \
  --tag "${laravel_tag_ref}" \
  --push \
  "${repo_root}"

laravel_digest="$(extract_digest "${laravel_tag_ref}")"
laravel_digest_ref="${laravel_image}@${laravel_digest}"

echo "INFO: publishing nginx runtime image ${nginx_tag_ref}"
DOCKER_BUILDKIT=1 BUILDKIT_PROGRESS=plain docker buildx build \
  --pull \
  --file "${repo_root}/docker/nginx/Dockerfile" \
  --label "org.opencontainers.image.source=https://github.com/${GITHUB_REPOSITORY}" \
  --label "org.opencontainers.image.revision=${GITHUB_SHA}" \
  --label "org.opencontainers.image.version=${tag}" \
  --tag "${nginx_tag_ref}" \
  --push \
  "${repo_root}/docker/nginx"

nginx_digest="$(extract_digest "${nginx_tag_ref}")"
nginx_digest_ref="${nginx_image}@${nginx_digest}"

write_output app_image "${laravel_digest_ref}"
write_output app_image_digest "${laravel_digest}"
write_output worker_image "${laravel_digest_ref}"
write_output worker_image_digest "${laravel_digest}"
write_output scheduler_image "${laravel_digest_ref}"
write_output scheduler_image_digest "${laravel_digest}"
write_output nginx_image "${nginx_digest_ref}"
write_output nginx_image_digest "${nginx_digest}"
write_output image_authority "ghcr-digest-v1"

echo "INFO: Laravel runtime digest: ${laravel_digest_ref}"
echo "INFO: nginx runtime digest: ${nginx_digest_ref}"
