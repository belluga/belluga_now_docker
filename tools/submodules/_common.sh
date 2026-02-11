#!/usr/bin/env bash
set -euo pipefail

repo_root() {
  git rev-parse --show-toplevel
}

die() {
  echo "ERROR: $*" >&2
  exit 1
}

require_git_repo() {
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "not inside a git repository"
}

submodule_paths() {
  # Stable order to keep output predictable.
  printf "%s\n" flutter-app laravel-app web-app foundation_documentation
}

ensure_submodules_present() {
  local root
  root="$(repo_root)"

  while IFS= read -r sm; do
    if [[ ! -e "$root/$sm" ]]; then
      die "missing submodule path '$sm' (expected at '$root/$sm')"
    fi
  done < <(submodule_paths)
}

ensure_submodules_clean() {
  local root
  root="$(repo_root)"

  local dirty=0
  while IFS= read -r sm; do
    # Only consider initialized submodules; pin script can init them.
    if [[ ! -d "$root/$sm/.git" && ! -f "$root/$sm/.git" ]]; then
      continue
    fi

    if [[ -n "$(git -C "$root/$sm" status --porcelain=v1)" ]]; then
      echo "DIRTY: $sm" >&2
      git -C "$root/$sm" status --porcelain=v1 >&2
      dirty=1
    fi
  done < <(submodule_paths)

  if [[ "$dirty" -ne 0 ]]; then
    die "refusing to proceed: there are dirty submodules (commit/stash/discard changes first)"
  fi
}

print_submodule_state() {
  local root
  root="$(repo_root)"

  echo "Superproject:"
  echo "  root:   $root"
  echo "  branch: $(git -C "$root" branch --show-current || true)"
  echo "  commit: $(git -C "$root" rev-parse --short HEAD)"
  echo

  echo "Submodule pins (from superproject):"
  # '+' indicates local checkout differs from recorded pin.
  git -C "$root" submodule status || true
  echo

  echo "Submodule working state:"
  while IFS= read -r sm; do
    if [[ ! -d "$root/$sm/.git" && ! -f "$root/$sm/.git" ]]; then
      echo "  - $sm: (not initialized)"
      continue
    fi

    local branch head_short dirty
    branch="$(git -C "$root/$sm" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '(unknown)')"
    head_short="$(git -C "$root/$sm" rev-parse --short HEAD 2>/dev/null || echo '(unknown)')"
    if [[ -n "$(git -C "$root/$sm" status --porcelain=v1)" ]]; then
      dirty="dirty"
    else
      dirty="clean"
    fi

    echo "  - $sm: $branch @ $head_short ($dirty)"
  done < <(submodule_paths)
}

