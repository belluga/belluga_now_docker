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

## 3. API Endpoint Tracking

| Endpoint | Module | Description | Current Status | Notes |
|----------|--------|-------------|----------------|-------|
| `/v1/app/home-overview` | MOD-201 | Tenant home composition payload. | Mocked | Mock backend returns schema-aligned snapshot. |
| `/v1/app/invites` | MOD-201 | Invite feed and referral graph. | Mocked | Controller simulates pagination locally. |
| `/v1/app/agenda` | MOD-201 | Agenda and schedulable actions. | Mocked | Generates multi-day samples for testing UI. |
| `/v1/app/map/pois` | MOD-201 | Map POIs and live offers. | Mocked | WebSocket mock emits move/offer events. |
| `/v1/app/profile` | MOD-201 | Profile summary and role claims. | Defined | Mock payload authoring queued in FCX-02. |
| `/v1/app/onboarding/context` | MOD-201 | Dynamic onboarding strings and branding. | Defined | Requires content modeling before mocking. |

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

**Initial stance (Launch):** All high-value actions (invite acceptance, booking confirmation, task completion) require the native app. Web landing pages act as promotional bridges: they show invite/event context, collect minimal telemetry, and deep link into the app or app store. This ensures onboarding, location services, and push reminders operate within a single client. We will instrument web clicks to understand drop-off and tune the deep-link funnel.

**Future consideration:** Revisit after Phase 8 once viral loops and partner analytics are stable. At that time we can evaluate a lightweight web confirmation flow for specific tenants or campaigns, balancing lower friction against the need to keep Task & Reminder and map experiences consistent. Any shift will require the invite, onboarding, and task modules to expose parallel web APIs with equivalent security guarantees.
