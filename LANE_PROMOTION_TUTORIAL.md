# Lane Promotion Tutorial (Docker Single-Gate)

## Purpose
This document explains the official CI/CD promotion flow across `dev`, `stage`, and `main`, and the expected daily workflow for Flutter and Laravel engineers.

## Core Model
1. `belluga_now_docker` is the single promotion gate.
2. Promotion is SHA-pinned (exact submodule commits).
3. Source repos (`belluga_now_front`, `belluga_now_web`, `belluga_now_backend`) do not auto-promote lanes by themselves.
4. Valid lane transitions:
   - `dev -> stage`
   - `stage -> main`

## Repositories and Roles
1. `belluga_now_front`: Flutter source.
2. `belluga_now_web`: published web bundle.
3. `belluga_now_backend`: Laravel source.
4. `belluga_now_docker`: orchestrator, submodule pins, deployments.

## End-to-End Flow

### 1. Build a candidate on `dev`
1. Flutter and/or Laravel changes are merged to `dev` in their own repos.
2. Flutter publish flow updates `web:dev` with compiled artifacts.
3. Web/Laravel dispatch submodule sync to `docker`.
4. `docker:dev` receives sync PR(s) updating pinned SHAs.
5. Merge sync PR(s) to establish the exact candidate snapshot in `docker:dev`.

### 2. Promote `dev -> stage`
1. Open PR in `docker`: `dev -> stage`.
2. Docker preflight validates:
   - lane policy
   - branch/SHA alignment
   - web/flutter metadata compatibility
   - exact-SHA CI status
3. Docker opens/updates source promotion PRs (`dev -> stage`) in:
   - front
   - web
   - backend
4. Source PRs run checks.
5. Callback from source repos reruns docker checks automatically when appropriate.
6. Merge docker promotion PR when checks are green.
7. On `docker:stage` push:
   - source PRs are auto-merged (exact SHA + green checks, or no-op when already promoted)
   - stage deploy runs

### 3. Promote `stage -> main`
1. Open PR in `docker`: `stage -> main`.
2. Same validation and source PR preparation pattern.
3. Merge docker promotion PR when green.
4. On `docker:main` push:
   - source PRs are auto-merged (exact SHA + green checks, or no-op)
   - production deploy runs

## Expected Daily Workflow

### Flutter Engineer (day-to-day)
1. Work in `belluga_now_front` feature branch.
2. Open PR to `front:dev`; ensure Flutter checks are green.
3. After merge to `front:dev`, monitor web publish PR in `belluga_now_web:dev`.
4. Ensure web publish PR checks pass and merge (or auto-merge, if configured).
5. Confirm docker sync PR updates:
   - `web-app` gitlink
   - `flutter-app` gitlink matching `web` metadata (`flutter_git_sha`)
6. Do not open direct lane promotion PRs in front/web for stage/main manually.
7. Promotion to stage/main is triggered from docker PRs only.

### Laravel Engineer (day-to-day)
1. Work in `belluga_now_backend` feature branch.
2. Open PR to `backend:dev`; ensure backend tests are green.
3. After merge to `backend:dev`, confirm docker sync PR updates `laravel-app` gitlink on `docker:dev`.
4. Merge sync PR so docker candidate snapshot is current.
5. Do not manually promote backend lanes directly to stage/main outside docker orchestration.
6. For release, follow docker promotion PR flow.

## What to Check Before Opening Docker Promotion PR
1. `docker:dev` (or `docker:stage`) contains the intended SHAs.
2. No stale/conflicted submodule sync PR remains open for the same lane.
3. Front/web/backend lane heads are healthy (no known failing mandatory checks).

## What to Check Before Merging Docker Promotion PR
1. Docker PR preflight is green.
2. Source promotion PRs were created/updated with expected SHA lock.
3. Source promotion PRs are merge-ready (`CLEAN`).

## Operational Guardrails
1. No temporary `bot/promote-*` branches as promotion source to stage/main.
2. Promotion merge strategy keeps exact SHA history (`merge`, not squash/rebase for source promotion execution).
3. Already-promoted SHA on target/advanced lane is valid no-op success.
4. If a source promotion PR fails, docker promotion remains blocked until source checks are green.

## Quick Troubleshooting
1. Docker preflight fails on source PR readiness:
   - open source PR
   - inspect failing check
   - fix in source repo, push, wait callback/recheck
2. Source PR is `DIRTY`:
   - resolve conflict in source repo branch path (`dev->stage` or `stage->main`)
3. SHA alignment errors:
   - verify pinned SHA in docker submodule entry
   - verify SHA exists in allowed source lane(s)

## Minimal Promotion Checklist
1. Merge submodule sync PR(s) into `docker` source lane.
2. Open docker promotion PR (`dev->stage` or `stage->main`).
3. Wait source PR checks + docker preflight.
4. Merge docker promotion PR.
5. Confirm push run:
   - `Promote Source Repos (Post-Merge)` success
   - `Deploy Stage` or `Deploy Production` success
