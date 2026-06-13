#!/usr/bin/env bash
set -euo pipefail

resolve_playwright_browser_path() {
  if [[ -n "${PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:-}" ]]; then
    if [[ -x "${PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}" ]]; then
      printf '%s\n' "${PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}"
      return 0
    fi

    echo "ERROR: PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH is set but not executable: ${PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}" >&2
    return 1
  fi

  local candidate=""
  for candidate in \
    /usr/bin/google-chrome \
    /usr/bin/google-chrome-stable \
    /usr/bin/chromium-browser \
    /usr/bin/chromium
  do
    if [[ -x "${candidate}" ]]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done

  local command_candidate=""
  for command_candidate in \
    google-chrome \
    google-chrome-stable \
    chromium-browser \
    chromium
  do
    if command -v "${command_candidate}" >/dev/null 2>&1; then
      command -v "${command_candidate}"
      return 0
    fi
  done

  echo "ERROR: could not find a system Chrome/Chromium executable for Playwright." >&2
  return 1
}

export_playwright_browser_path() {
  local resolved_path=""
  resolved_path="$(resolve_playwright_browser_path)"
  export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="${resolved_path}"
  echo "INFO: using local Chromium executable for Playwright -> ${PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  export_playwright_browser_path
  "${PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}" --version
fi
