#!/usr/bin/env bash
set -euo pipefail

if [[ "${GITHUB_EVENT_NAME:-}" != "pull_request" ]]; then
  echo "SKIP: submodule gitlink guardrail applies only to pull_request events."
  exit 0
fi

base_ref="${GITHUB_BASE_REF:-}"
head_ref="${GITHUB_HEAD_REF:-}"

if [[ -z "${base_ref}" || -z "${head_ref}" ]]; then
  echo "ERROR: missing pull request branch context (base/head)." >&2
  exit 1
fi

if [[ "${base_ref}" != "dev" ]]; then
  echo "INFO: submodule gitlink guardrail skipped for base '${base_ref}' (enforced only on dev)."
  exit 0
fi

allowed_head="${ALLOWED_SUBMODULE_GITLINK_HEAD:-bot/next-version}"
protected_gitlinks=(flutter-app laravel-app web-app)

if ! git rev-parse --verify "origin/${base_ref}" >/dev/null 2>&1; then
  git fetch origin "${base_ref}" --quiet
fi

mapfile -t changed_gitlinks < <(
  git diff --name-only --ignore-submodules=none "origin/${base_ref}...HEAD" -- "${protected_gitlinks[@]}" \
    | sed '/^$/d'
)

if [[ "${#changed_gitlinks[@]}" -eq 0 ]]; then
  echo "OK: no protected submodule gitlink changes detected for '${head_ref}' -> '${base_ref}'."
  exit 0
fi

if [[ "${head_ref}" == "${allowed_head}" ]]; then
  echo "OK: protected submodule gitlink changes are allowed from '${allowed_head}'."
  printf 'INFO: changed gitlinks:\n'
  printf ' - %s\n' "${changed_gitlinks[@]}"
  exit 0
fi

echo "ERROR: protected submodule gitlink changes are allowed only from '${allowed_head}' when targeting '${base_ref}'." >&2
echo "ERROR: PR '${head_ref}' -> '${base_ref}' changed:" >&2
printf ' - %s\n' "${changed_gitlinks[@]}" >&2
echo "ERROR: move these gitlink updates to '${allowed_head}' or remove them from this PR." >&2
exit 1
