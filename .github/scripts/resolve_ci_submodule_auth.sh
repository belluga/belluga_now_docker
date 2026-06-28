#!/usr/bin/env bash
set -euo pipefail

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

token_can_read_repo() {
  local token="$1"
  local repo="$2"

  if [[ -z "$token" || -z "$repo" ]]; then
    return 1
  fi

  local remote_url
  remote_url="https://x-access-token:${token}@github.com/${repo}.git"
  git ls-remote "$remote_url" HEAD >/dev/null 2>&1
}

write_output() {
  local key="$1"
  local value="$2"

  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    printf '%s=%s\n' "$key" "$value" >>"$GITHUB_OUTPUT"
  else
    printf '%s=%s\n' "$key" "$value"
  fi
}

submodule_token="${SUBMODULES_REPO_TOKEN:-}"
if [[ -z "$submodule_token" ]]; then
  submodule_token="${WEB_APP_REPO_TOKEN:-}"
fi

web_repo_token="${WEB_APP_REPO_TOKEN:-}"
if [[ -z "$web_repo_token" ]]; then
  web_repo_token="$submodule_token"
fi

web_repo_slug=""
if [[ -n "${WEB_APP_REPO:-}" ]]; then
  web_repo_slug="$(normalize_repo_slug "${WEB_APP_REPO:-}" || true)"
fi

if [[ -n "$web_repo_slug" && -n "$web_repo_token" ]]; then
  if ! token_can_read_repo "$web_repo_token" "$web_repo_slug"; then
    if [[ -n "$submodule_token" && "$submodule_token" != "$web_repo_token" ]] && token_can_read_repo "$submodule_token" "$web_repo_slug"; then
      echo "INFO: WEB_APP_REPO_TOKEN cannot read ${web_repo_slug}; falling back to the working submodule token."
      web_repo_token="$submodule_token"
    else
      echo "WARN: selected web-app token cannot read ${web_repo_slug}; downstream protected web runtime checks may fail."
    fi
  fi
fi

if [[ -n "$submodule_token" ]]; then
  echo "::add-mask::$submodule_token"
  if [[ -n "$web_repo_token" && "$web_repo_token" != "$submodule_token" ]]; then
    echo "::add-mask::$web_repo_token"
  fi
  write_output "has_token" "true"
  write_output "token" "$submodule_token"
  write_output "submodule_token" "$submodule_token"
  write_output "web_repo_token" "$web_repo_token"
else
  write_output "has_token" "false"
fi
