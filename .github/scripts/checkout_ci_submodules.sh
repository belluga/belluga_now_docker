#!/usr/bin/env bash
set -euo pipefail

FOUNDATION_DOCS_BRANCH="${FOUNDATION_DOCS_BRANCH:-main}"
SUBMODULE_PATHS="${SUBMODULE_PATHS:-}"

submodule_paths=()
if [[ -n "${SUBMODULE_PATHS}" ]]; then
  # Space-delimited paths keep the workflow contract readable and deterministic.
  read -r -a submodule_paths <<<"${SUBMODULE_PATHS}"
fi

git submodule sync --recursive
if [[ "${#submodule_paths[@]}" -gt 0 ]]; then
  git submodule update --init --recursive "${submodule_paths[@]}"
else
  git submodule update --init --recursive
fi

if [[ ! -d "foundation_documentation/.git" && ! -f "foundation_documentation/.git" ]]; then
  echo "INFO: foundation_documentation submodule is not initialized; skipping canonical branch alignment."
  exit 0
fi

git -C foundation_documentation fetch origin "${FOUNDATION_DOCS_BRANCH}" --quiet
git -C foundation_documentation checkout --detach "origin/${FOUNDATION_DOCS_BRANCH}" --quiet

echo "OK: foundation_documentation aligned to origin/${FOUNDATION_DOCS_BRANCH} for CI authority."
