#!/usr/bin/env bash
set -euo pipefail

TARGET_BRANCH="${1:-${GITHUB_REF_NAME:-}}"
if [[ -z "$TARGET_BRANCH" ]]; then
  echo "ERROR: target branch is required" >&2
  exit 1
fi

METADATA_FILE="web-app/build_metadata.json"
FLUTTER_SHA="$(git ls-tree HEAD flutter-app | awk '{print $3}')"
if [[ -z "$FLUTTER_SHA" ]]; then
  echo "ERROR: failed to resolve pinned flutter-app SHA" >&2
  exit 1
fi

if [[ ! -f "$METADATA_FILE" ]]; then
  if [[ "$TARGET_BRANCH" == "dev" ]]; then
    echo "WARN: $METADATA_FILE missing on dev; compatibility metadata gate is advisory on dev"
    exit 0
  fi
  echo "ERROR: missing required metadata file $METADATA_FILE on $TARGET_BRANCH" >&2
  exit 1
fi

metadata_sha=""
if command -v jq >/dev/null 2>&1; then
  metadata_sha="$(jq -r '.flutter_git_sha // empty' "$METADATA_FILE")"
else
  metadata_sha="$(sed -n 's/.*"flutter_git_sha"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$METADATA_FILE" | head -n1)"
fi

if [[ -z "$metadata_sha" ]]; then
  echo "ERROR: flutter_git_sha not found in $METADATA_FILE" >&2
  exit 1
fi

if [[ "$FLUTTER_SHA" == "$metadata_sha" || "$FLUTTER_SHA" == "$metadata_sha"* || "$metadata_sha" == "$FLUTTER_SHA"* ]]; then
  echo "OK: web metadata flutter_git_sha ($metadata_sha) matches pinned flutter-app SHA ($FLUTTER_SHA)"
else
  echo "ERROR: metadata mismatch. web-app flutter_git_sha=$metadata_sha, pinned flutter-app SHA=$FLUTTER_SHA" >&2
  exit 1
fi
