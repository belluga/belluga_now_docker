# Title
Align runtime Docker/NGINX configs with upstream/with-webapp

## Context
We want belluga_now_docker to match the upstream/with-webapp runtime behavior for Laravel container setup and local NGINX routing, while preserving the current web-app submodule flow.

## Scope
- [x] Align `docker/laravel-app/Dockerfile` with upstream/with-webapp (restore GD libs, gosu, UID/GID handling, build-time cache perms).
- [x] Align `docker/laravel-app/entrypoint.sh` with upstream/with-webapp (UID/GID mapping, storage dirs, storage:link, env-based cache handling).
- [x] Align `docker/nginx/local.conf.template` with upstream/with-webapp.
- [x] Remove `/initialize` route alias to match upstream exactly.

## Out of Scope
- [ ] No changes to `docker-compose.yml`.
- [ ] No changes to production NGINX config.
- [ ] No changes inside submodules.

## Decisions
- [x] Drop `/initialize` alias to align with upstream/with-webapp.

## Questions To Close
- [x] No, remove `/initialize` for full alignment.

## Definition of Done
- [x] Dockerfile and entrypoint match upstream/with-webapp behavior.
- [x] local NGINX config matches upstream, with explicit decision on `/initialize`.
- [x] `bash scripts/verify_environment.sh` passes.

## Outcomes
- Synced `docker/laravel-app/Dockerfile`, `docker/laravel-app/entrypoint.sh`, and `docker/nginx/local.conf.template` from `upstream/with-webapp`.
- Verified `bash scripts/verify_environment.sh` passes.

## Commands (Run Locally)
- `bash scripts/verify_environment.sh`

## Files Expected (Optional)
- `docker/laravel-app/Dockerfile`
- `docker/laravel-app/entrypoint.sh`
- `docker/nginx/local.conf.template`
