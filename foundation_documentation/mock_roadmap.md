# Mock Implementation Roadmap

This document tracks the staged rollout of the Flutter mock environment so every feature remains demoable while backend services are in flight. The goal is to keep mock payloads realistic, contract-driven, and documented alongside the screen specs and prototype data.

---

## Guiding Principles

- **One Mock Backend:** Route every feature through the shared `MockBackend` wrapper, avoiding ad-hoc registrations in modules.
- **Build for the Future:** Keep mock payloads aligned with the v1.1 data contracts described in the module and screen documents, even if certain UI elements stay hidden behind debug toggles.
- **Single Source of Truth:** Update `foundation_documentation/screens/prototype_data.md` whenever a new mock dataset is introduced so QA, design, and engineering reference the same payloads.
- **Navigable Deliverables:** Each phase ends with a demonstrable set of screens reachable via the running app, giving stakeholders a verifiable checkpoint.

---

## Phase Plan

1. **Schedule & Invite Readiness**
   - Extend `MockBackend` to expose the schedule contract instead of relying on manual registrations in `ModuleSettings`.
   - Ensure `MockScheduleBackend` covers all scenarios in `screens/modulo_agenda.md` (multi-day events, invite statuses, friend list).
   - Mock invite privacy/status permutations ahead of backend parity.

2. **Tenant Landing Experiences**
   - Feed the tenant home, item landing, and partner landing pages with data-driven mocks that satisfy `home.md`, `ItemLandingPage.md`, and `PartnerLandingPage.md`.
   - Eliminate hardcoded copy; surface CTAs and labels through mock responses.

3. **Onboarding & Account Utilities**
   - Wire the initialization, login, recovery, and profile flows to realistic mock repositories.
   - Keep mocked user/account data consistent with `modulo_onboarding.md` and `modulo_perfil_e_utilidades.md`.

4. **Promoter, Store, and Guides Modules**
   - Provide mock dashboards, KPIs, and inventories for promoter and commerce experiences (`modulo_promoter_plataforma.md`, `modulo_promoter_bi.md`, `modulo_loja.md`, `modulo_guias_e_experiencias.md`).
   - Reuse `prototype_data.md` structures to guarantee consistency across flows.

5. **Map & POI Enhancements (Deferred)**
   - Finish the Map & POI roadmap from `modules/map_poi_module.md` once the earlier phases are stable.
   - Implement queued visual stacking, filtering UI, and WebSocket event handling on top of the high-fidelity mock services.

---

## Verifiable Checkpoints

Each checkpoint represents a demoable milestone with clickable screens in the running app.

- **CP1 – Agenda & Invite Mock**
  - Route: `/agenda`
  - Expected: Multi-day schedule, invite avatar halos, mock friend checklist per `modulo_agenda.md`.

- **CP2 – Tenant Home Experience**
  - Route: `/`
  - Expected: Hero cards, upcoming events, and CTAs populated from mock payloads defined in `home.md`.

- **CP3 – Item Landing Page**
  - Route: `/item/:id`
  - Expected: Item detail layout with mocked gallery, CTAs, and action flows.

- **CP4 – Partner Landing Page**
  - Route: `/landlord/:id`
  - Expected: Partner profile, offers, and schedule blocks matching `PartnerLandingPage.md`.

- **CP5 – Onboarding & Account Utilities**
  - Routes: `/init`, `/login`, `/recover_password`, `/profile`
  - Expected: Auth and onboarding journeys driven entirely by mock data.

- **CP6 – Promoter & Store Modules**
  - Routes: `/promoter`, `/loja`, `/guias`
  - Expected: Commerce and promoter dashboards presenting mock analytics and inventory.

---

## Next Steps

The active focus is **CP1 – Agenda & Invite Mock**. Upcoming work includes:

- Updating backend registrations so the schedule feature pulls from `MockBackend`.
- Verifying mocked event data covers every state described in the agenda screen spec.
- Ensuring invite flows expose friend selections and status halos for demo purposes.

Progress for each checkpoint should be recorded here alongside the corresponding Git commits or PR references.
