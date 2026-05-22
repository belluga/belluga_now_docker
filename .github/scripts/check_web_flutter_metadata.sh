#!/usr/bin/env bash
set -euo pipefail

TARGET_BRANCH="${1:-${GITHUB_REF_NAME:-}}"
if [[ -z "$TARGET_BRANCH" ]]; then
  echo "ERROR: target branch is required" >&2
  exit 1
fi

case "$TARGET_BRANCH" in
  dev|stage|main) ;;
  *)
    echo "ERROR: unsupported lane '$TARGET_BRANCH'. Expected dev|stage|main." >&2
    exit 1
    ;;
esac

is_dev_lane=0
if [[ "$TARGET_BRANCH" == "dev" ]]; then
  is_dev_lane=1
fi

FLUTTER_LANE_DEFINES_PATH="config/defines/${TARGET_BRANCH}.json"
FLUTTER_SHA="$(git ls-tree HEAD flutter-app | awk '{print $3}')"
if [[ -z "$FLUTTER_SHA" ]]; then
  echo "ERROR: failed to resolve pinned flutter-app SHA" >&2
  exit 1
fi

FLUTTER_SUBMODULE_GIT_DIR="$(git rev-parse --git-common-dir)/modules/flutter-app"

parse_repo_slug_from_url() {
  local url="$1"
  url="${url#git@github.com:}"
  url="${url#ssh://git@github.com/}"
  url="${url#https://github.com/}"
  url="${url#http://github.com/}"
  url="${url%.git}"
  printf '%s\n' "${url}"
}

normalize_repo_slug() {
  local repo="$1"
  repo="${repo#git@github.com:}"
  repo="${repo#ssh://git@github.com/}"
  repo="${repo#https://github.com/}"
  repo="${repo#http://github.com/}"
  repo="${repo%.git}"
  repo="$(printf '%s' "$repo" | tr -d '[:space:]')"

  if ! [[ "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
    return 1
  fi

  printf '%s\n' "$repo"
}

resolve_lane_web_sha() {
  local repo="$1"
  local lane="$2"

  if [[ -z "${GH_TOKEN:-}" ]]; then
    return 1
  fi

  local remote_url
  remote_url="https://x-access-token:${GH_TOKEN}@github.com/${repo}.git"
  git ls-remote "$remote_url" "refs/heads/${lane}" | awk '{print $1}' | head -n 1 | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]'
}

get_remote_file_content() {
  local repo="$1"
  local file_path="$2"
  local ref="$3"

  if [[ -z "${GH_TOKEN:-}" ]] || ! command -v gh >/dev/null 2>&1; then
    return 1
  fi

  local encoded
  encoded="$(gh api "repos/${repo}/contents/${file_path}?ref=${ref}" --jq '.content' 2>/dev/null || true)"
  if [[ -z "$encoded" || "$encoded" == "null" ]]; then
    return 1
  fi

  printf '%s' "$encoded" | tr -d '\n' | base64 -d 2>/dev/null
}

get_pinned_submodule_file_content() {
  local submodule_git_dir="$1"
  local gitlink_sha="$2"
  local file_path="$3"

  if [[ ! -d "$submodule_git_dir" ]]; then
    return 1
  fi

  if ! git --git-dir "$submodule_git_dir" cat-file -e "${gitlink_sha}^{commit}" 2>/dev/null; then
    return 1
  fi

  git --git-dir "$submodule_git_dir" show "${gitlink_sha}:${file_path}" 2>/dev/null
}

web_repo_slug=""
if ! web_repo_slug="$(normalize_repo_slug "${WEB_APP_REPO:-}")"; then
  if [[ "$is_dev_lane" -eq 1 ]]; then
    echo "WARN: WEB_APP_REPO is required to resolve lane web runtime metadata. Advisory on dev."
    exit 0
  fi
  echo "ERROR: WEB_APP_REPO must be an owner/repo slug for protected web runtime metadata validation." >&2
  exit 1
fi

WEB_SHA="$(resolve_lane_web_sha "$web_repo_slug" "$TARGET_BRANCH" || true)"
if ! [[ "$WEB_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  if [[ "$is_dev_lane" -eq 1 ]]; then
    echo "WARN: failed to resolve web-app SHA from ${web_repo_slug}@${TARGET_BRANCH}. Advisory on dev."
    exit 0
  fi
  echo "ERROR: failed to resolve web-app SHA from ${web_repo_slug}@${TARGET_BRANCH}. Check WEB_APP_REPO, GH_TOKEN, and lane branch existence." >&2
  exit 1
fi

flutter_repo_url="$(git config -f .gitmodules --get submodule.flutter-app.url || true)"
flutter_repo_slug=""
if [[ -n "$flutter_repo_url" ]]; then
  flutter_repo_slug="$(parse_repo_slug_from_url "$flutter_repo_url")"
fi

metadata_content=""
web_index_content=""
source_mode="lane-resolved-web-repo"
flutter_defines_content=""
flutter_defines_mode="pinned-flutter-gitlink-local"

metadata_content="$(get_remote_file_content "$web_repo_slug" "build_metadata.json" "$WEB_SHA" || true)"
web_index_content="$(get_remote_file_content "$web_repo_slug" "index.html" "$WEB_SHA" || true)"
flutter_defines_content="$(get_pinned_submodule_file_content "$FLUTTER_SUBMODULE_GIT_DIR" "$FLUTTER_SHA" "$FLUTTER_LANE_DEFINES_PATH" || true)"

if [[ -z "$flutter_defines_content" ]]; then
  flutter_defines_mode="pinned-flutter-gitlink-remote"
  if [[ -n "$flutter_repo_slug" ]]; then
    flutter_defines_content="$(get_remote_file_content "$flutter_repo_slug" "$FLUTTER_LANE_DEFINES_PATH" "$FLUTTER_SHA" || true)"
  fi
fi

if [[ -z "$metadata_content" ]]; then
  if [[ "$is_dev_lane" -eq 1 ]]; then
    echo "WARN: could not resolve web build_metadata.json for lane '$TARGET_BRANCH' (remote/local). Advisory on dev."
    exit 0
  fi
  echo "ERROR: could not resolve web build_metadata.json for lane '$TARGET_BRANCH' (remote/local)." >&2
  exit 1
fi

if [[ -z "$web_index_content" ]]; then
  if [[ "$is_dev_lane" -eq 1 ]]; then
    echo "WARN: could not resolve web index.html for lane '$TARGET_BRANCH' (remote/local). Advisory on dev."
    exit 0
  fi
  echo "ERROR: could not resolve web index.html for lane '$TARGET_BRANCH' (remote/local)." >&2
  exit 1
fi

if [[ -z "$flutter_defines_content" ]]; then
  if [[ "$is_dev_lane" -eq 1 ]]; then
    echo "WARN: lane defines content missing ($FLUTTER_LANE_DEFINES_PATH at flutter-app gitlink $FLUTTER_SHA). Advisory on dev."
    exit 0
  fi
  echo "ERROR: missing lane defines content $FLUTTER_LANE_DEFINES_PATH at flutter-app gitlink $FLUTTER_SHA" >&2
  exit 1
fi

metadata_sha=""
if command -v jq >/dev/null 2>&1; then
  metadata_sha="$(printf '%s' "$metadata_content" | jq -r '.flutter_git_sha // empty' 2>/dev/null || true)"
else
  metadata_sha="$(printf '%s' "$metadata_content" | sed -n 's/.*"flutter_git_sha"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
fi

if [[ -z "$metadata_sha" ]]; then
  echo "ERROR: flutter_git_sha not found in web build metadata for lane '$TARGET_BRANCH' (mode=$source_mode)." >&2
  exit 1
fi

metadata_source_branch=""
if command -v jq >/dev/null 2>&1; then
  metadata_source_branch="$(printf '%s' "$metadata_content" | jq -r '.source_branch // empty' 2>/dev/null || true)"
else
  metadata_source_branch="$(printf '%s' "$metadata_content" | sed -n 's/.*"source_branch"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
fi

if [[ "$TARGET_BRANCH" == "stage" ]]; then
  if [[ -z "$metadata_source_branch" ]]; then
    echo "ERROR: build metadata missing source_branch for lane '$TARGET_BRANCH'." >&2
    exit 1
  fi
  if [[ "$metadata_source_branch" != "$TARGET_BRANCH" ]]; then
    echo "ERROR: metadata source_branch mismatch for lane '$TARGET_BRANCH': got '$metadata_source_branch'." >&2
    exit 1
  fi
elif [[ "$TARGET_BRANCH" == "main" && -z "$metadata_source_branch" ]]; then
  echo "INFO: build metadata missing source_branch for lane 'main'; main acceptance uses flutter_git_sha and host compatibility."
fi

metadata_match_mode=""
metadata_full_sha=""

if [[ "$FLUTTER_SHA" == "$metadata_sha" || "$FLUTTER_SHA" == "$metadata_sha"* || "$metadata_sha" == "$FLUTTER_SHA"* ]]; then
  metadata_match_mode="exact-or-prefix"
else
  # Stage/main commonly build from lane merge commits (descendants of the pinned source SHA).
  # Accept descendant metadata SHA while still enforcing host compatibility; stage also enforces lane provenance.
  if [[ "$is_dev_lane" -eq 0 ]]; then
    if [[ -d "$FLUTTER_SUBMODULE_GIT_DIR" ]]; then
      metadata_full_sha="$(git --git-dir "$FLUTTER_SUBMODULE_GIT_DIR" rev-parse --verify "${metadata_sha}^{commit}" 2>/dev/null | tr -d '[:space:]' || true)"
    fi

    if [[ -n "$flutter_repo_slug" && -n "${GH_TOKEN:-}" ]] && command -v gh >/dev/null 2>&1; then
      metadata_full_sha="${metadata_full_sha:-$(gh api "repos/${flutter_repo_slug}/commits/${metadata_sha}" --jq '.sha' 2>/dev/null || true)}"
    fi

    if [[ -z "$metadata_full_sha" ]] && [[ "$metadata_sha" =~ ^[0-9a-f]{40}$ ]]; then
      metadata_full_sha="$metadata_sha"
    fi

    if [[ -n "$metadata_full_sha" ]]; then
      if [[ -d "$FLUTTER_SUBMODULE_GIT_DIR" ]]; then
        git --git-dir "$FLUTTER_SUBMODULE_GIT_DIR" fetch origin "$TARGET_BRANCH" --quiet || true
        git --git-dir "$FLUTTER_SUBMODULE_GIT_DIR" fetch origin "$metadata_full_sha" --quiet || true
      fi
      if git --git-dir "$FLUTTER_SUBMODULE_GIT_DIR" merge-base --is-ancestor "$FLUTTER_SHA" "$metadata_full_sha" 2>/dev/null; then
        metadata_match_mode="descendant"
      fi
    fi
  fi
fi

if [[ -z "$metadata_match_mode" ]]; then
  if [[ "$is_dev_lane" -eq 1 ]]; then
    echo "WARN: metadata mismatch on lane '$TARGET_BRANCH'. web flutter_git_sha=$metadata_sha, pinned flutter-app SHA=$FLUTTER_SHA [mode=$source_mode]"
    echo "WARN: continuing on dev (advisory-only gate). stage/main remain strict."
    metadata_match_mode="advisory-dev-mismatch"
  else
    echo "ERROR: metadata mismatch on lane '$TARGET_BRANCH'. web flutter_git_sha=$metadata_sha, pinned flutter-app SHA=$FLUTTER_SHA [mode=$source_mode]" >&2
    exit 1
  fi
fi

if [[ "$metadata_match_mode" == "advisory-dev-mismatch" ]]; then
  echo "INFO: web metadata compatibility gate accepted in advisory mode for lane '$TARGET_BRANCH'."
else
  echo "OK: web metadata flutter_git_sha ($metadata_sha) is compatible with pinned flutter-app SHA ($FLUTTER_SHA) via $metadata_match_mode [mode=$source_mode lane=$TARGET_BRANCH]"
fi
echo "INFO: resolved web-app runtime SHA='$WEB_SHA' from ${web_repo_slug}@${TARGET_BRANCH} [mode=$source_mode]"

expected_landlord_domain=""
expected_landlord_host_ready=1
if command -v jq >/dev/null 2>&1; then
  expected_landlord_domain="$(printf '%s' "$flutter_defines_content" | jq -r '.LANDLORD_DOMAIN // empty' 2>/dev/null || true)"
else
  expected_landlord_domain="$(printf '%s' "$flutter_defines_content" | sed -n 's/.*"LANDLORD_DOMAIN"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
fi

if [[ -z "$expected_landlord_domain" || "$expected_landlord_domain" == "null" ]]; then
  if [[ "$is_dev_lane" -eq 1 ]]; then
    echo "WARN: LANDLORD_DOMAIN missing in $FLUTTER_LANE_DEFINES_PATH [mode=$flutter_defines_mode]. Advisory on dev."
    expected_landlord_host_ready=0
  else
    echo "ERROR: LANDLORD_DOMAIN missing in $FLUTTER_LANE_DEFINES_PATH [mode=$flutter_defines_mode]" >&2
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
  if [[ "$is_dev_lane" -eq 1 ]]; then
    echo "WARN: could not parse landlord host from LANDLORD_DOMAIN='$expected_landlord_domain'. Advisory on dev."
    expected_landlord_host_ready=0
  else
    echo "ERROR: could not parse landlord host from LANDLORD_DOMAIN='$expected_landlord_domain'" >&2
    exit 1
  fi
fi

actual_landlord_host="$(python3 - <<'PY' "$web_index_content"
import re
import sys

html = sys.argv[1]
match = re.search(r"window\.__LANDLORD_HOST__\s*=\s*['\"]([^'\"]+)['\"]", html)
print((match.group(1).strip().lower() if match else ""))
PY
)"

if [[ -z "$actual_landlord_host" ]]; then
  if [[ "$is_dev_lane" -eq 1 ]]; then
    echo "WARN: missing window.__LANDLORD_HOST__ injection on lane '$TARGET_BRANCH'. Advisory on dev."
  else
    echo "ERROR: missing window.__LANDLORD_HOST__ injection for lane '$TARGET_BRANCH'" >&2
    exit 1
  fi
elif [[ -n "$expected_landlord_host" && "$actual_landlord_host" != "$expected_landlord_host" ]]; then
  if [[ "$is_dev_lane" -eq 1 ]]; then
    echo "WARN: host injection mismatch on dev: web-app __LANDLORD_HOST__='$actual_landlord_host', expected='$expected_landlord_host'"
  else
    echo "ERROR: host injection mismatch for lane '$TARGET_BRANCH': web-app __LANDLORD_HOST__='$actual_landlord_host', expected '$expected_landlord_host' from $FLUTTER_LANE_DEFINES_PATH [mode=$flutter_defines_mode]" >&2
    exit 1
  fi
elif [[ "$expected_landlord_host_ready" -eq 0 ]]; then
  echo "WARN: skipping strict host match on dev due to missing/invalid LANDLORD_DOMAIN in $FLUTTER_LANE_DEFINES_PATH [mode=$flutter_defines_mode]"
else
  echo "OK: web index __LANDLORD_HOST__ ('$actual_landlord_host') matches expected lane host ('$expected_landlord_host') [mode=$source_mode lane=$TARGET_BRANCH]"
fi

if [[ -n "$metadata_source_branch" ]]; then
  echo "INFO: build metadata provenance source_branch='$metadata_source_branch' (diagnostic only)"
fi
