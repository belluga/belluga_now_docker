# TODO (V1): Convert `web-app/` to a git submodule (belluga_now_web)

**Status:** Completed  
**Owner:** Delphi + DevOps  
**Goal:** Ensure `web-app/` is tracked as a proper git submodule pointing to `https://github.com/belluga/belluga_now_web` (instead of an untracked local build output directory), so working trees stay clean and updates are reproducible via build scripts.

---

## Context
- In `belluga_now_docker/`, `web-app/` currently contains built web artifacts and shows up as untracked (`?? web-app/`).
- The repo’s `.gitmodules` currently defines only `flutter-app` and `laravel-app`.
- The intended source repo for `web-app/` is: `https://github.com/belluga/belluga_now_web`.

---

## Scope
- Remove the current `web-app/` directory contents from the environment repo (they are build outputs and can be regenerated).
- Add `web-app` as a git submodule:
  - Update `.gitmodules`
  - Initialize/update the submodule
- Keep `web-app/` out of the root repo’s tracked file list (only the gitlink should be tracked).

## Out of Scope
- Changing the build process itself (only make the source location correct).
- Modifying the `web-app` submodule repo contents.

---

## Outcome
- `web-app/` is now a git submodule pointing to `https://github.com/belluga/belluga_now_web.git` (branch `main`).
- The upstream repo was empty; an initial commit was created in `belluga_now_web` to allow submodule pinning.
- Validation:
  - `git submodule status --recursive` shows `web-app` initialized.
  - `git status --porcelain=v1` no longer shows `?? web-app/`.

---

## Decisions
- Prefer submodule tracking for `web-app/` to avoid committing build outputs.
- If any local build artifacts must exist, they belong in the submodule’s own ignored paths or in a separate build output directory (not tracked by the environment repo).

---

## Definition of Done
- `git status` in `belluga_now_docker/` no longer shows `?? web-app/`.
- `.gitmodules` includes `web-app` pointing to `https://github.com/belluga/belluga_now_web`.
- `git submodule status --recursive` shows `web-app` initialized.

---

## Validation Steps
- `git submodule status --recursive`
- `git status --porcelain=v1` (no untracked `web-app/`)
- (Optional) run the existing web build script to confirm outputs regenerate as expected.
