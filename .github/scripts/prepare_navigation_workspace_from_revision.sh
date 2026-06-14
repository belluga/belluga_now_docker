#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: prepare_navigation_workspace_from_revision.sh --revision <git-revision> --output-dir <path>

Materialize the canonical Flutter web navigation runner from a specific git
revision into a temporary workspace so rollback proof can execute the restored
tuple's own checks instead of the candidate revision's newer harness.

Exit codes:
  0  workspace prepared
  2  revision does not contain the canonical navigation workspace surface
  1  operational error
EOF
}

die() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

REVISION=""
OUTPUT_DIR=""

while [ $# -gt 0 ]; do
  case "$1" in
    --revision)
      [ $# -ge 2 ] || die "missing value for --revision"
      REVISION="$2"
      shift 2
      ;;
    --output-dir)
      [ $# -ge 2 ] || die "missing value for --output-dir"
      OUTPUT_DIR="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

[ -n "$REVISION" ] || die "--revision is required"
[ -n "$OUTPUT_DIR" ] || die "--output-dir is required"

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$repo_root" ] || die "current directory is not inside a git repository"

if ! git -C "$repo_root" rev-parse --verify "${REVISION}^{commit}" >/dev/null 2>&1; then
  die "unable to resolve revision '${REVISION}'"
fi

required_paths=(
  "tools/flutter/run_web_navigation_smoke.sh"
  "tools/flutter/resolve_playwright_browser.sh"
  "tools/flutter/web_app_smoke_runner/package.json"
  "tools/flutter/web_app_smoke_runner/package-lock.json"
  "tools/flutter/web_app_tests"
)

missing_paths=()
for path in "${required_paths[@]}"; do
  if ! git -C "$repo_root" cat-file -e "${REVISION}:${path}" 2>/dev/null; then
    missing_paths+=("${path}")
  fi
done

if [ "${#missing_paths[@]}" -gt 0 ]; then
  printf 'INFO: revision %s does not expose the canonical navigation workspace surface required for restored-check rollback proof.\n' "$REVISION" >&2
  for path in "${missing_paths[@]}"; do
    printf 'INFO: missing path in restored revision: %s\n' "$path" >&2
  done
  exit 2
fi

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

git -C "$repo_root" archive "$REVISION" tools/flutter | tar -x -C "$OUTPUT_DIR"

printf 'INFO: prepared navigation workspace from revision %s at %s\n' "$REVISION" "$OUTPUT_DIR"
