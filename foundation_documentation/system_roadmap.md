# Documentation: System Roadmap
**Version:** 1.0

## 1. Roadmap Overview

This roadmap enumerates the foundational milestones for the Belluga ecosystem. It aligns mocked implementations with the definitive architecture to guarantee a seamless transition toward production services.

## 2. Current Milestones

| Workstream | Milestone | Description | Target | Status | Owner |
|------------|-----------|-------------|--------|--------|-------|
| Flutter Client Experience | FCX-01 | Bootstrap DI container, theming, and StreamValue-based controller scaffolding. | 2025-02-28 | In Progress | Delphi |
| Flutter Client Experience | FCX-02 | Wire mocked repositories and services to tenant home, agenda, invites, and map controllers. | 2025-03-05 | Planned | Delphi |
| Flutter Client Experience | FCX-03 | Implement analytics instrumentation (logs, metrics, tracing) for prototype flows. | 2025-03-12 | Planned | Delphi |
| Flutter Client Experience | FCX-04 | Author operational runbook for prototype bootstrapping and mock backend rotation. | 2025-03-19 | Planned | Delphi |
| Flutter Client Experience | FCX-05 | Add location permission guard + permission screen for geo-dependent routes (map/nearby). | 2025-03-26 | Planned | Delphi |

## 3. API Endpoint Tracking

| Endpoint | Module | Description | Current Status | Notes |
|----------|--------|-------------|----------------|-------|
| `/v1/anonymous/identities` | MOD-101 | Anonymous identity bootstrap (Sanctum token issuance for web/app guest flows). | Implemented | Unauthenticated route returns `{user_id, identity_state, token, abilities, expires_at?}`; abilities/TTL controlled by `tenant.anonymous_access_policy`. |
| `/v1/app/home-overview` | MOD-201 | Tenant home composition payload. | Mocked | Mock backend returns schema-aligned snapshot. |
| `/v1/app/invites` | MOD-201 | Invite feed and referral graph. | Mocked | Prioritizes nearest events; enforces 1 invite per person/event; limits pending invites by role. |
| `/v1/app/invites/settings` | MOD-201 | Backend-owned invite quotas, anti-spam limits, and UX messaging settings. | Planned | Backend enforces over-quota responses (`429`) and returns reset metadata; Flutter fetches for messaging/UX. |
| `/v1/app/invites/share` | MOD-201 | External share codes for event invites (new user install/signup attribution). | Planned | Anyone who can invite can generate; resolves to `inviter_principal` (user or partner) + `event_id`; includes `/consume` to bind attribution post-install. |
| `/v1/app/agenda` | MOD-201 | Paged agenda feed with event tags/thumb type, artist genres, invite filters, search, past-only toggle. | Defined | Request: `page`, `page_size`, `past_only`, `search`, `invite_filter` (none/invites_and_confirmed/confirmed_only). Response: items with `tags[]` (or artist-genre fallback), `thumb {url,type background|flyer}`, single `venue`, optional `artists[]` (may be empty, each with `genres[]`), `is_confirmed`, `total_confirmed`, invites/friends for halos; `has_more` flag. |
| `/v1/app/map/pois` | MOD-201 | Map POIs and live offers (GeoQuery-backed). | Defined | Backend must use MongoDB GeoQuery (`$geoNear`/`$geoWithin`) with viewport + optional origin/radius; Flutter must gate map routes behind location permission and pass bounds/origin params. |
| `/v1/app/map/filters` | MOD-201 | Map filter discovery (categories/tags). | Planned | Required to remove hardcoded filter catalogs from mocks. |
| `/v1/app/profile` | MOD-201 | Profile summary and role claims. | Defined | Mock payload authoring queued in FCX-02. |
| `/v1/app/onboarding/context` | MOD-201 | Dynamic onboarding strings and branding. | Defined | Requires content modeling before mocking. |
| `/v1/app/partners/discovery` | MOD-201 | Partner discovery cards with engagement metrics and invite counts. | Mocked | Needs DTO/value-object mapping and shared prototype data for Laravel alignment. |
| `/v1/app/events/{event_id}/check-in` | MOD-201 | Presence confirmation with geofence/QR/staff methods. | Mocked | Partner-defined radius; QR optional; accepted without check-in becomes no-show. |
| `/v1/app/missions` | MOD-201 | Partner-created missions with metric targets and rewards. | Defined | Metrics selectable per mission; partner dashboard must show rankings/progress. |
| `/v1/app/partner-links` | MOD-201 | Partner ↔ curador/pessoa linkage. | Defined | Bidirectional proposals; statuses pending/accepted; monthly proof-of-presence window. |
| `/v1/app/discover/people` | MOD-201 | People/Influencer row ordered by monthly Social Score. | Defined | Prefer verified on ties; respects privacy by anonymizing friends-only profiles. |
| `/v1/app/discover/curator-content` | MOD-201 | Curator-produced content for “Veja isso…” row. | Defined | Ordered by latest published (future: most viewed); links to partner/event. |
| `/v1/app/contacts/import` | MOD-201 | Hashed contact import for friend suggestions and invite matching. | Planned | Accepts salted hashes only; no raw PII stored. |

## 4. Risk & Mitigation Log

| ID | Risk | Impact | Mitigation |
|----|------|--------|------------|
| R-201-01 | Mock payload drift from backend contract. | UI regressions when real API arrives. | Maintain contract tests and share DTO schemas with backend team. |
| R-201-02 | Controller lifecycle leaks degrade performance. | Memory growth and navigation instability. | Enforce disposal patterns and add integration tests covering scope teardown. |

## 5. Flutter Experience Future Phases

These roadmap phases extend the Flutter persona track and remain aligned with the platform-wide milestones above. Each phase is expressed as a target-state capability so downstream modules can scope their dependencies early.

- **Phase 6 – User Personalization / Favorites:** establish persistent bookmarking across POIs and events, wired to authenticated tenants so saved items hydrate the invite loop, agenda, and partner insights.
- **Phase 6.1 – Remote Onboarding Experience:** deliver a geo-aware entry path for out-of-city visitors by defaulting map focus to the tenant-configured hub, prioritizing lodging/hosting templates, and emitting “potential visitor” analytics events.
- **Phase 7 – Offline Reliability:** design “forever cache” strategies (tiles, POI snapshots, invite context) to keep the app responsive in low-connectivity regions while respecting data-expiry policies.
- **Phase 8 – Gamification Spine:** standardize ranking schemas (global invites, partner-specific ladders, custom rank labels) and UI hooks so each module can project consistent reward states.
- **Phase 9 – Invite Flow Evolution:** finalize the Tinder-style invite carousel, WhatsApp/in-app share contracts, and the analytics wiring that feeds the Phase 8 ranking services.
- **Phase 10 – Tenant Home & Global Aggregations:** converge backend-driven home composition with multi-source data (offers, agenda, social actions) to give partners a single payload to target experiments.
- **Phase 11 – Invite Status & Privacy Controls:** attach invite-state halos to schedule cards, surface modal drill-downs, and enforce privacy toggles so invitees govern their exposure.
- **Phase 12 – Partner (Landlord) Workspace:** scope the business-facing module where partners manage POIs, campaigns, promotions, and telemetry with the same backend contracts used by the tenant app.
- **Phase 13 – Profile, Global Search, and Notifications:** expand user settings/privacy, add cross-surface search, and align push topics with the backend FCM contract so experiences feel continuous.

## 6. Web-to-App Promotion Policy

**Initial stance (V1):** Web is a promotional/preview surface; the app owns conversion and trust actions.

**Web allowed (V1):**
- Event landing (read-only): title, date/time, venue name, artists names, hero media.
- Invite landing (read-only): “You were invited by …” context + event summary.
- Map browsing (read-only) for discovery; guide users into app for confirmations.
- Install / Open-App CTAs that preserve the invite share code for attribution.
- Invite acceptance is allowed only from invite landing reached via a single `code` (narrow V1 exception); credited to that code’s inviter principal.
- Web “unauthenticated” surfaces may mint a backend-issued anonymous Sanctum token via `/v1/anonymous/identities` to call allowed endpoints.

**Web authenticated allowed (V1):**
- Partner Workspace: event creation and management, memberships/team management, invite metrics dashboards.

**App-only (V1):**
- Accept/Decline invite from agenda surfaces (credited acceptance selection + anti-gaming + quota enforcement).
- Confirm presence / check-in.
- Send invites (user + partner-issued).
- Favorites and trust actions (check-in, credited acceptance selection).

**Attribution requirement:** External share links carry a single `code` that resolves `{ tenant_id, event_id, inviter_principal }`. Web must preserve this `code` through install and the app must call a backend `consume` endpoint post-install/post-signup to bind attribution.

**Tracking mandate (V1):** Instrument web → install → signup → acceptance → presence funnel to validate whether web-only actions should be expanded later. Use Mixpanel (client) and/or server-side events, but align naming to avoid double-counting.

**Future consideration:** Revisit after Phase 8 once viral loops and partner analytics are stable. At that time we can evaluate a lightweight web confirmation flow for specific tenants or campaigns, balancing lower friction against the need to keep Task & Reminder and map experiences consistent. Any shift will require the invite, onboarding, and task modules to expose parallel web APIs with equivalent security guarantees.
