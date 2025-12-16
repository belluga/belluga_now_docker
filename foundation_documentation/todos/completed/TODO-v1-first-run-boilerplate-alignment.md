# TODO (V1): First run checklist + boilerplate alignment notes

**Status:** Completed  
**Owner:** Delphi + DevOps  
**Goal:** Ensure this project stays aligned with the Docker boilerplate and that first-run validation catches common drift (NGINX `/storage` routing, env hygiene, and optional local Mongo profile).

---

## What we standardized (baseline expectations)
- **NGINX `/storage/` alias correctness:** use `try_files $request_filename =404;` inside `location ^~ /storage/ { alias ... }` to avoid false 404s.
- **Env hygiene:** `.env` and `.env.testing` are local-only and must be ignored; repo should only contain sanitized examples (`.env.example`, `.env.testing.example` if applicable).
- **Optional local DB:** the boilerplate supports an opt-in local Mongo replica set via Compose profile `local-db` (Atlas remains the default).

---

## First run checklist (do this once per machine)
1) **Verify Delphi context**
   - Run: `bash delphi-ai/tools/verify_context.sh`
2) **Confirm env files are local-only**
   - Ensure `.env` and `.env.testing` are in `.gitignore` and not tracked.
   - Keep secrets only in local files; commit only example files.
3) **Submodules**
   - Run: `git submodule sync --recursive && git submodule update --init --recursive`
4) **Compose sanity**
   - Run: `docker compose config`
   - If using local Mongo: `docker compose --profile local-db config`
5) **Run stack**
   - Default (Atlas): `docker compose up -d`
   - Local Mongo (opt-in): `COMPOSE_PROFILES=local-db docker compose up -d`
6) **Storage assets routing sanity (if app serves files)**
   - After NGINX is up, validate a known asset under `/storage/...` returns `200` and an unknown one returns `404`.

---

## Outcome
- Converted the checklist into deterministic guardrails in `scripts/verify_environment.sh` (web-app submodule, `/storage` routing, env hygiene, compose config).
- Local Mongo profile validation remains supported via `docker compose --profile local-db config` and optional DB URI hints.
- This TODO is now archived; future “always run” requirements should go into `scripts/verify_environment.sh` (and optionally into the readiness workflow), not a persistent TODO.

---

## Boilerplate inheritance workflow (preferred over copy/paste)
This repo is expected to be a fork of the Docker boilerplate environment. Prefer syncing from the boilerplate upstream instead of manually applying diffs.

Suggested commands (adjust branch names as needed):
```bash
git remote add upstream <BOILERPLATE_GIT_URL>  # once
git fetch upstream
git merge upstream/main
```

If this repo has heavy divergence, do a targeted reconciliation (keep local `.env*` untracked; preserve `.gitmodules` URLs for project-specific submodules).
