#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: prepare_navigation_workspace_from_revision.sh --revision <git-revision> --output-dir <path>

Materialize a temporary worktree for a specific git revision so rollback proof
can execute the restored tuple's own checks instead of the candidate revision's
newer harness.

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

cleanup_prepared_workspace() {
  git -C "$repo_root" worktree remove --force "$OUTPUT_DIR" >/dev/null 2>&1 || true
  rm -rf "$OUTPUT_DIR"
}

policy_test="tools/flutter/web_app_tests/navigation_harness_policy_test.cjs"
required_paths=(
  "tools/flutter/run_web_navigation_smoke.sh"
  "tools/flutter/resolve_playwright_browser.sh"
  "tools/flutter/web_app_smoke_runner/package.json"
  "tools/flutter/web_app_smoke_runner/package-lock.json"
  "${policy_test}"
)

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

worktree_log="$(mktemp)"
submodule_log="$(mktemp)"
policy_log="$(mktemp)"
trap 'rm -f "$worktree_log" "$submodule_log" "$policy_log"' EXIT

if ! git -C "$repo_root" worktree add --detach --force "$OUTPUT_DIR" "$REVISION" >"$worktree_log" 2>&1; then
  cat "$worktree_log" >&2 || true
  cleanup_prepared_workspace
  die "unable to materialize worktree for revision '${REVISION}'"
fi

if ! git -C "$OUTPUT_DIR" submodule sync --recursive >"$submodule_log" 2>&1; then
  cat "$submodule_log" >&2 || true
  cleanup_prepared_workspace
  die "unable to sync submodules for restored revision '${REVISION}'"
fi

if ! git -C "$OUTPUT_DIR" submodule update --init --recursive >>"$submodule_log" 2>&1; then
  cat "$submodule_log" >&2 || true
  cleanup_prepared_workspace
  die "unable to materialize submodules for restored revision '${REVISION}'"
fi

missing_paths=()
for path in "${required_paths[@]}"; do
  if [ ! -e "${OUTPUT_DIR}/${path}" ]; then
    missing_paths+=("${path}")
  fi
done

if [ "${#missing_paths[@]}" -gt 0 ]; then
  printf 'INFO: revision %s does not expose the canonical navigation workspace surface required for restored-check rollback proof.\n' "$REVISION" >&2
  for path in "${missing_paths[@]}"; do
    printf 'INFO: missing path in restored revision workspace: %s\n' "$path" >&2
  done
  cleanup_prepared_workspace
  exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  cleanup_prepared_workspace
  die "node is required to validate the restored navigation harness policy"
fi

if ! (
  cd "$OUTPUT_DIR"
  node "$policy_test" >"$policy_log" 2>&1
); then
  printf 'INFO: revision %s failed its canonical navigation harness policy self-test inside the restored workspace.\n' "$REVISION" >&2
  cat "$policy_log" >&2 || true
  cleanup_prepared_workspace
  exit 2
fi

printf 'INFO: prepared navigation workspace from revision %s at %s\n' "$REVISION" "$OUTPUT_DIR"
