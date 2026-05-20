#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "${script_dir}/../.." && pwd)"

lane="${1:-promotion}"
lane_tag="$(printf '%s' "${lane}" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9._-' '-')"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required for promotion runtime preflight builds." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: docker daemon is not reachable for promotion runtime preflight builds." >&2
  exit 1
fi

preflight_docker_config="$(mktemp -d)"
trap 'rm -rf "${preflight_docker_config}"' EXIT
printf '{"auths":{}}\n' > "${preflight_docker_config}/config.json"
export DOCKER_CONFIG="${preflight_docker_config}"

laravel_tag="belluga-preflight-laravel-runtime-deps:${lane_tag}"
nginx_tag="belluga-preflight-nginx:${lane_tag}"

echo "INFO: building pinned Laravel runtime dependency stage for lane '${lane}'..."
DOCKER_BUILDKIT=1 BUILDKIT_PROGRESS=plain docker build \
  --pull \
  --target runtime-deps \
  -f "${repo_root}/docker/laravel-app/Dockerfile" \
  -t "${laravel_tag}" \
  "${repo_root}"

echo "INFO: building pinned nginx runtime image for lane '${lane}'..."
DOCKER_BUILDKIT=1 BUILDKIT_PROGRESS=plain docker build \
  --pull \
  -f "${repo_root}/docker/nginx/Dockerfile" \
  -t "${nginx_tag}" \
  "${repo_root}/docker/nginx"

echo "OK: promotion runtime preflight builds passed for lane '${lane}'."
