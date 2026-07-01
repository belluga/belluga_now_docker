#!/usr/bin/env bash
set -euo pipefail

readiness_context="${FLUTTER_RELEASE_REPO_TOKEN_READINESS_CONTEXT:-the flutter-app release tag workflow}"
token="${FLUTTER_RELEASE_REPO_TOKEN:-}"

if [[ -n "${token}" ]]; then
  echo "OK: FLUTTER_RELEASE_REPO_TOKEN is present for ${readiness_context}."
  exit 0
fi

echo "ERROR: missing required FLUTTER_RELEASE_REPO_TOKEN secret for flutter-app tag checkout/push." >&2
echo "Set FLUTTER_RELEASE_REPO_TOKEN in this repository secrets with flutter-app read access and flutter-app tag write access." >&2
echo "This must be green before a Docker main promotion can be declared clean." >&2
exit 1
