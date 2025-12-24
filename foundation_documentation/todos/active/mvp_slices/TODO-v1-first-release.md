# TODO (V1): First Release Delivery Plan (Orchestrator)

**Status legend:** `- [ ] ⚪ Pending` · `- [ ] 🟡 Provisional` · `- [x] ✅ Production‑Ready`.
**Status:** Active  
**Owner:** Delphi + Backend Team  
**Goal:** Ship the first tenant-facing version focused on Events + Invites + Favorites (Artists + Venues) + Map (with Beaches), with Web invite landing + acceptance functional in V1 and a Flutter test foundation that prevents regressions.

---

## References
- Invites contract + limits: `foundation_documentation/modules/invite_and_social_loop_module.md`
- Partner/admin module (draft): `foundation_documentation/modules/partner_admin_module.md`
- Map/POI architecture: `foundation_documentation/modules/map_poi_module.md`
- MVP scope gate (decisions): `foundation_documentation/todos/completed/TODO-mvp-scope-definition.md`
- Roadmap tracking: `foundation_documentation/system_roadmap.md`
- Deferred features: `foundation_documentation/todos/active/TODO-vnext-parking-lot.md`
- Flutter test foundation (baseline): `foundation_documentation/todos/active/mvp_slices/TODO-v1-flutter-test-foundation.md`
- Invites implementation slice: `foundation_documentation/todos/active/mvp_slices/TODO-v1-invites-implementation.md`
- Telemetry + push slice: `foundation_documentation/todos/active/mvp_slices/TODO-v1-telemetry-and-push.md`
- Map slice: `foundation_documentation/todos/active/mvp_slices/TODO-v1-map.md`
- Events/Agenda slice: `foundation_documentation/todos/active/mvp_slices/TODO-v1-events-and-agenda.md`
- Artist favorites/profile slice: `foundation_documentation/todos/active/mvp_slices/TODO-v1-artist-favorites-and-profile.md`
- Tenant/admin area slice: `foundation_documentation/todos/active/mvp_slices/TODO-v1-partner-workspace.md`
- Web-to-app policy slice: `foundation_documentation/todos/active/mvp_slices/TODO-v1-web-to-app-policy.md`

## 0) Scope Boundaries (V1)

### In scope
These are scope descriptors (not tasks).
- Events browsing + event detail
- Invites: send, receive, accept/decline, confirm presence
- Invite crediting selection (“Accept invite from…”, no default)
- Web: invite landing + accept via code (V1 is web functional for these flows)
- Map POIs with categories: `Culture`, `Restaurant`, `Beach`, `Nature`, `Historic` + dynamic `Events`
- StaticAssets (landlord-managed) are POI-enabled sources; Unmanaged accounts are supported for partner creation.
- Favorites: Artists + Venues (favorites remain surfaced in Home)
- Venue profile pages (reduced profile)
- Push notifications (V1 baseline)
- Tracking / product analytics (Mixpanel) integration (V1 baseline)
- Flutter test foundation (unit + contract + minimal widget/integration + network contract checks)

### Out of scope (tracked in `foundation_documentation/todos/active/TODO-vnext-parking-lot.md`)
- Wallet / purchases / premium
- Persistent favorites (backend later; mock can reset on load)
- Full partner profile modules/store for all partner types
- Partner-issued invites + partner invite metrics

---

## 0.1) Orchestration (How We Sequence Work)

### Primary sequencing principle
- Freeze behavior with tests first, then implement features: `foundation_documentation/todos/active/mvp_slices/TODO-v1-flutter-test-foundation.md` is the precondition to reduce regressions and avoid “workaround tests”.
- Scope gate: before executing MVP feature slices, finalize decisions in `foundation_documentation/todos/completed/TODO-mvp-scope-definition.md` to prevent churn and rework.

### Dependency map (high level)
- Core loop: Invites + Agenda → unlock Telemetry/Push.
- Web invite acceptance depends on stable environment resolution + share code contract (and must remain contract-aligned with app invites).
- Map depends on stable event detail routing + time-window settings for event POIs.
- Tenant/admin area depends on account memberships + permissions (credited acceptance semantics for invites remain app-side).

---

## 0.2) Milestones (Each Must Be Manually Testable)

### M0 — Flutter test foundation (precondition)
- TODO: `foundation_documentation/todos/active/mvp_slices/TODO-v1-flutter-test-foundation.md`
- Gate: `fvm flutter test` green (including network contract tests per TODO)
- Manual: compile and run app; smoke routes still open without crashes

### M1 — Core loop contracts + mock fidelity
- TODOs: `foundation_documentation/todos/active/mvp_slices/TODO-v1-invites-implementation.md`, `foundation_documentation/todos/active/mvp_slices/TODO-v1-events-and-agenda.md` (refinement + mock-first)
- Gate: DTO/fixture contract tests updated; no mock drift from docs
- Manual: browse events → open event detail → start invite flow (mock-backed)

### M2 — Web functional (invite landing + accept via code)
- TODOs: `foundation_documentation/todos/active/mvp_slices/TODO-v1-web-to-app-policy.md` + web slices in `foundation_documentation/todos/active/mvp_slices/TODO-v1-invites-implementation.md`
- Gate: web acceptance works against contract-faithful mock server endpoints
- Manual: open tenant subdomain → invite landing → accept → verify result state

### M3 — Telemetry + push baseline
- TODO: `foundation_documentation/todos/active/mvp_slices/TODO-v1-telemetry-and-push.md`
- Gate: analytics taxonomy + push routing validated (no double-counting)
- Manual: invite received routes correctly; Mixpanel shows funnel events

### M4 — Map V1
- TODO: `foundation_documentation/todos/active/mvp_slices/TODO-v1-map.md`
- Gate: map payload contract tests; stacking behavior stable
- Manual: beaches/nature visible; event POIs show; stacks show `+N`

### M5 — Artist favorites/profile V1
- TODO: `foundation_documentation/todos/active/mvp_slices/TODO-v1-artist-favorites-and-profile.md`
- Gate: favorites gating tests (artist-only) remain green
- Manual: favorites strip works; artist profile uses reduced tabs

### M6 — Tenant/Admin area V1 minimum
- TODO: `foundation_documentation/todos/active/mvp_slices/TODO-v1-partner-workspace.md`
- Gate: tenant/admin authorization enforced
- Manual: tenant admin can manage accounts, assets, events, and branding

---

## 1) Domain/Contract Decisions (Must Hold)

### 1.1 Invites (anti-gaming + monetization-safe)
- Uniqueness: forbid duplicate invite key `(tenant_id, event_id, receiver_user_id, inviter_principal.kind, inviter_principal.id)` → respond `already_invited`.
- Credited acceptance: exactly one `credited_acceptance=true` per `(receiver_user_id, event_id)`; others become `closed_duplicate`.
- No default inviter selection in UI; user must pick who to credit before accepting.
- Inviter principal is union `{kind:user|partner, id}`; partner-issued invites are deferred in MVP.

### 1.2 Canonical IDs
- Events and participants always reference stable `partner_id` (create partners upfront with Tiny Free when needed).
- Never rely on name-only references except as display fallbacks.

### 1.3 Metrics access boundary
- Partner invite metrics are deferred in MVP.

---

## 2) Backend Deliverables

### 2.1 Invite Settings (backend-owned + enforced)
- [ ] ⚪ Implement endpoint: `GET /api/v1/invites/settings`
- [ ] ⚪ Enforce limits on invite creation and return:
  - [ ] ⚪ `429` with structured payload when over quota/rate-limited
  - [ ] ⚪ reset metadata (`resets_at`) and “which limit” identifier
- [ ] ⚪ Make settings tenant-configurable (no app release required to tune)

Suggested defaults (override per tenant + plan):
- `max_invites_per_event_per_inviter = 300`
- `max_invites_per_day_per_partner = 500` (Tiny Free: `50–100`)
- `max_invites_per_day_per_user_actor = 100`
- `max_pending_invites_per_invitee = 20`
- `max_invites_to_same_invitee_per_30d = 10`
- suppression: per-partner blocklist + per-user opt-out

### 2.2 Account memberships
- [ ] ⚪ Implement account memberships (draft spec in `foundation_documentation/modules/partner_admin_module.md`)

### 2.3 Event invite metrics (partner-facing)
- (Deferred to VNext)

### 2.4 Push notifications (baseline)
- [ ] ⚪ Implement device registration endpoint (exact naming TBD):
  - [ ] ⚪ `POST /api/v1/push/register` with `{ device_id, platform, push_token }`
  - [ ] ⚪ Optional `DELETE /api/v1/push/unregister`
- [ ] ⚪ Send notifications (minimum):
  - [ ] ⚪ New invite received
  - [ ] ⚪ Invite status change (accepted/declined) when relevant
  - [ ] ⚪ Event reminder for confirmed attendance (or delegate to Task/Reminder service)
- [ ] ⚪ Make notification policies tenant-configurable (no app release required)

### 2.5 Tracking / Analytics (Mixpanel)
- [ ] ⚪ Provide a stable event taxonomy and required properties (tenant-aware)
- [ ] ⚪ If backend emits events too, align naming/ownership to avoid double-counting

---

## 3) Flutter Deliverables

### 3.1 Tenant: Invites UX
- [ ] ⚪ Replace “who invited me” modal with:
  - [ ] ⚪ “Escolher convite para aceitar” → opens selector list of inviters
  - [ ] ⚪ no default; CTA disabled until selection is made
  - [ ] ⚪ accept credits selected inviter and updates UI state
- [ ] ⚪ Ensure UI shows “já convidado” when backend returns `already_invited`
- [ ] ⚪ Expose invite metrics counters (sent/accepted/confirmed) in Profile and Menu hero, wired to the correct repositories

### 3.2 Tenant: Favorites (Artists + Venues)
- [ ] ⚪ Keep favorites displayed in Home
- [ ] ⚪ Clicking an artist favorite opens the existing Partner Detail base page with reduced tabs (artist config)
- [ ] ⚪ Clicking a venue favorite opens the existing Partner Detail base page with reduced tabs (venue config)
- [ ] ⚪ Enforce “favoritable” for artists + venues only in the mock repository path until backend sends capabilities

### 3.3 Tenant: Map
- [ ] ⚪ Keep POI categories coarse; use tags for subcategories
- [ ] ⚪ Ensure Beaches are included and filterable (already present in mock POI DB)
- [ ] ⚪ Ensure dynamic Event POIs are visible and remain distinct from static POIs

### 3.5 Push notifications (baseline)
- [ ] ⚪ Register device token on startup/login and handle token rotation
- [ ] ⚪ Deep link routing (at minimum: open invite/event detail)
- [ ] ⚪ Respect tenant settings for notification categories (best-effort client gating; backend remains authoritative)

### 3.6 Tracking / Analytics (Mixpanel)
- [ ] ⚪ Initialize Mixpanel with tenant/app keys from backend bootstrap (preferred) or environment config
- [ ] ⚪ Track critical funnel events (minimum):
  - [ ] ⚪ `invite_received`, `invite_opened`, `invite_accept_selected_inviter`, `invite_accepted`, `invite_declined`
  - [ ] ⚪ `event_opened`, `event_confirmed_presence`
  - [ ] ⚪ `favorite_artist_toggled`, `map_opened`, `poi_opened`
- [ ] ⚪ Ensure every event includes: `tenant_id`, `event_id` (when applicable), `inviter_kind/id` (when applicable), `partner_id` (when applicable)

### 3.4 Tenant/Admin area (V1 minimum pages)
- [ ] ⚪ Tenant/Admin Home
- [ ] ⚪ Accounts management
- [ ] ⚪ Assets management (StaticAssets)
- [ ] ⚪ Events management
- [ ] ⚪ Tenant branding management (About/logo/icon/colors)
- [ ] ⚪ Plan/Limits read-only view (uses invite settings payload + partner plan payload)

---

## 4) Acceptance Criteria (V1)

- [ ] ⚪ Invites cannot be duplicated by same inviter for same receiver+event (`already_invited`)
- [ ] ⚪ Accepting an invite requires explicit inviter selection; only one credited acceptance per receiver+event
- [ ] ⚪ Map supports the agreed categories and shows beaches + events
- [ ] ⚪ Favorites support artists + venues and route to reduced profiles
- [ ] ⚪ No Wallet/Purchases/Premium surfaces ship in V1 (tracked as deferred)
- [ ] ⚪ Push notifications work end-to-end for invite received at minimum, including deep link routing
- [ ] ⚪ Mixpanel captures the invite funnel and event funnel with consistent identifiers

---

## 5) Global Validation Checklist (Run Every Milestone)
- Tests: `cd flutter-app && fvm flutter test`
- Manual: `flutter run` (emulator/device) and verify the milestone’s manual checklist
- Web: verify `/environment` on root and tenant subdomain, plus fixed branding paths (`/logo-*.png`, `/icon-*.png`, `/manifest.json`, `/favicon.ico`)
