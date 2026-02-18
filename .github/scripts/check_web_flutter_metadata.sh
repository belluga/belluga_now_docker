#!/usr/bin/env bash
set -euo pipefail

TARGET_BRANCH="${1:-${GITHUB_REF_NAME:-}}"
if [[ -z "$TARGET_BRANCH" ]]; then
  echo "ERROR: target branch is required" >&2
  exit 1
fi

METADATA_FILE="web-app/build_metadata.json"
WEB_INDEX_FILE="web-app/index.html"
FLUTTER_LANE_DEFINES_FILE="flutter-app/config/defines/${TARGET_BRANCH}.json"
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

if [[ ! -f "$WEB_INDEX_FILE" ]]; then
  if [[ "$TARGET_BRANCH" == "dev" ]]; then
    echo "WARN: $WEB_INDEX_FILE missing on dev; host injection gate is advisory on dev"
    exit 0
  fi
  echo "ERROR: missing required web entrypoint $WEB_INDEX_FILE on $TARGET_BRANCH" >&2
  exit 1
fi

if [[ ! -f "$FLUTTER_LANE_DEFINES_FILE" ]]; then
  if [[ "$TARGET_BRANCH" == "dev" ]]; then
    echo "WARN: lane defines file missing ($FLUTTER_LANE_DEFINES_FILE) on dev; host injection gate is advisory on dev"
    exit 0
  fi
  echo "ERROR: missing lane defines file $FLUTTER_LANE_DEFINES_FILE" >&2
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

expected_landlord_domain=""
expected_landlord_host_ready=1
if command -v jq >/dev/null 2>&1; then
  expected_landlord_domain="$(jq -r '.LANDLORD_DOMAIN // empty' "$FLUTTER_LANE_DEFINES_FILE")"
else
  expected_landlord_domain="$(sed -n 's/.*"LANDLORD_DOMAIN"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$FLUTTER_LANE_DEFINES_FILE" | head -n1)"
fi

if [[ -z "$expected_landlord_domain" || "$expected_landlord_domain" == "null" ]]; then
  if [[ "$TARGET_BRANCH" == "dev" ]]; then
    echo "WARN: LANDLORD_DOMAIN missing in $FLUTTER_LANE_DEFINES_FILE; host injection gate is advisory on dev"
    expected_landlord_host_ready=0
  else
    echo "ERROR: LANDLORD_DOMAIN missing in $FLUTTER_LANE_DEFINES_FILE" >&2
    exit 1
  fi
fi

expected_landlord_host="$(python3 - <<'PY' "$expected_landlord_domain"
import sys
from urllib.parse import urlparse

domain = (sys.argv[1] or "").strip()
if not domain:
    print("")
    raise SystemExit(0)

parsed = urlparse(domain)
host = (parsed.hostname or "").strip().lower()
print(host)
PY
)"

if [[ -z "$expected_landlord_host" ]]; then
  if [[ "$TARGET_BRANCH" == "dev" ]]; then
    echo "WARN: could not parse landlord host from LANDLORD_DOMAIN='$expected_landlord_domain'; host injection gate is advisory on dev"
    expected_landlord_host_ready=0
  else
    echo "ERROR: could not parse landlord host from LANDLORD_DOMAIN='$expected_landlord_domain'" >&2
    exit 1
  fi
fi

actual_landlord_host="$(python3 - <<'PY' "$WEB_INDEX_FILE"
import re
import sys

path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    html = f.read()

match = re.search(r"window\.__LANDLORD_HOST__\s*=\s*['\"]([^'\"]+)['\"]", html)
print((match.group(1).strip().lower() if match else ""))
PY
)"

if [[ -z "$actual_landlord_host" ]]; then
  if [[ "$TARGET_BRANCH" == "dev" ]]; then
    echo "WARN: missing window.__LANDLORD_HOST__ injection in $WEB_INDEX_FILE; host injection gate is advisory on dev"
  else
    echo "ERROR: missing window.__LANDLORD_HOST__ injection in $WEB_INDEX_FILE for lane '$TARGET_BRANCH'" >&2
    exit 1
  fi
elif [[ -n "$expected_landlord_host" && "$actual_landlord_host" != "$expected_landlord_host" ]]; then
  if [[ "$TARGET_BRANCH" == "dev" ]]; then
    echo "WARN: host injection mismatch on dev: web-app __LANDLORD_HOST__='$actual_landlord_host', expected='$expected_landlord_host'"
  else
    echo "ERROR: host injection mismatch for lane '$TARGET_BRANCH': web-app __LANDLORD_HOST__='$actual_landlord_host', expected '$expected_landlord_host' from $FLUTTER_LANE_DEFINES_FILE" >&2
    exit 1
  fi
elif [[ "$expected_landlord_host_ready" -eq 0 ]]; then
  echo "WARN: skipping strict host match on dev due to missing/invalid LANDLORD_DOMAIN in $FLUTTER_LANE_DEFINES_FILE"
else
  echo "OK: web index __LANDLORD_HOST__ ('$actual_landlord_host') matches expected lane host ('$expected_landlord_host')"
fi

metadata_source_branch=""
if command -v jq >/dev/null 2>&1; then
  metadata_source_branch="$(jq -r '.source_branch // empty' "$METADATA_FILE")"
else
  metadata_source_branch="$(sed -n 's/.*"source_branch"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$METADATA_FILE" | head -n1)"
fi

if [[ -n "$metadata_source_branch" ]]; then
  echo "INFO: build metadata provenance source_branch='$metadata_source_branch' (diagnostic only)"
fi
