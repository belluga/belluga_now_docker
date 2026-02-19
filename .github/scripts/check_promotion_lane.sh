#!/usr/bin/env bash
set -euo pipefail

if [[ "${GITHUB_EVENT_NAME:-}" != "pull_request" ]]; then
  echo "SKIP: promotion lane policy applies only to pull_request events."
  exit 0
fi

BASE_REF="${GITHUB_BASE_REF:-}"
HEAD_REF="${GITHUB_HEAD_REF:-}"

if [[ -z "$BASE_REF" || -z "$HEAD_REF" ]]; then
  echo "ERROR: missing pull request branch context (base/head)." >&2
  exit 1
fi

case "$BASE_REF" in
  stage)
    if [[ "$HEAD_REF" != "dev" && "$HEAD_REF" != bot/submodule-sync-stage-* ]]; then
      echo "ERROR: only 'dev' or 'bot/submodule-sync-stage-*' is allowed to open PRs into 'stage' (received '$HEAD_REF' -> '$BASE_REF')." >&2
      exit 1
    fi
    ;;
  main)
    if [[ "$HEAD_REF" != "stage" && "$HEAD_REF" != bot/submodule-sync-main-* ]]; then
      echo "ERROR: only 'stage' or 'bot/submodule-sync-main-*' is allowed to open PRs into 'main' (received '$HEAD_REF' -> '$BASE_REF')." >&2
      exit 1
    fi
    ;;
  dev)
    echo "OK: '$HEAD_REF' -> '$BASE_REF' allowed for development integration."
    ;;
  *)
    echo "ERROR: unsupported base branch '$BASE_REF'. Allowed bases: dev, stage, main." >&2
    exit 1
    ;;
esac

echo "OK: lane promotion policy passed for '$HEAD_REF' -> '$BASE_REF'."
