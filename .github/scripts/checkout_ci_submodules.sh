#!/usr/bin/env bash
set -euo pipefail

FOUNDATION_DOCS_BRANCH="${FOUNDATION_DOCS_BRANCH:-main}"

git submodule sync --recursive
git submodule update --init --recursive

if [[ ! -d "foundation_documentation/.git" && ! -f "foundation_documentation/.git" ]]; then
  echo "INFO: foundation_documentation submodule is not initialized; skipping canonical branch alignment."
  exit 0
fi

git -C foundation_documentation fetch origin "${FOUNDATION_DOCS_BRANCH}" --quiet
git -C foundation_documentation checkout --detach "origin/${FOUNDATION_DOCS_BRANCH}" --quiet

echo "OK: foundation_documentation aligned to origin/${FOUNDATION_DOCS_BRANCH} for CI authority."
