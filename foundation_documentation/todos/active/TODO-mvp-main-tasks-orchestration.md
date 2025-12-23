# MVP Main TODO List (What We Are Shipping)

**Purpose:** Print-friendly checklist focused on **WHAT** we will deliver in MVP (not implementation details).

---

## Cross-Team Gate (Must Do First)
- [ ] ⚪ Finalize `foundation_documentation/endpoints_mvp_contracts.md` **together** (Frontend + Backend).

**scope:** Finalize MVP endpoint schemas in `foundation_documentation/endpoints_mvp_contracts.md`, including removing `/onboarding/context` and documenting `/environment` as the onboarding/branding source.  
**out_of_scope:** Laravel/Flutter implementation, non‑MVP endpoints, DB schema changes.  
**definition_of_done:** No `TBD` for MVP endpoints; `/onboarding/context` removed; `/environment` clearly defined as branding source; roadmap endpoint list updated accordingly.  
**validation_steps:** Manual check against `foundation_documentation/system_roadmap.md` + `foundation_documentation/endpoints_mvp_contracts.md` for consistency.

---

## Backend Contract Execution (Mock → Prod on Same Routes)
**Approach:** implement mock responses on **production routes**, then replace internals with real DB logic.  
**Status legend:** `- [ ] ⚪ Pending` · `- [ ] 🟡 Provisional` · `- [x] ✅ Production‑Ready`.

**Route status tracking (MVP endpoints):**
- [ ] ⚪ `POST /anonymous/identities`
- [ ] ⚪ `GET /home-overview`
- [ ] ⚪ `GET /profile`
- [ ] ⚪ `GET /onboarding/context`
- [ ] ⚪ `GET /invites`
- [ ] ⚪ `GET /invites/settings`
- [ ] ⚪ `POST /invites/share`
- [ ] ⚪ `POST /invites/share/{code}/accept`
- [ ] ⚪ `GET /agenda`
- [ ] ⚪ `GET /events/{event_id}`
- [ ] ⚪ `POST /events/{event_id}/check-in`
- [ ] ⚪ `GET /map/pois`
- [ ] ⚪ `GET /map/filters`
- [ ] ⚪ `POST /push/register`
- [ ] ⚪ `GET /accounts`
- [ ] ⚪ `POST /accounts`
- [ ] ⚪ `PATCH /accounts/{account_id}`
- [ ] ⚪ `GET /assets`
- [ ] ⚪ `POST /assets`
- [ ] ⚪ `PATCH /assets/{asset_id}`
- [ ] ⚪ `GET /events`
- [ ] ⚪ `POST /events`
- [ ] ⚪ `PATCH /events/{event_id}`
- [ ] ⚪ `POST /branding/update`

**Backend testing expectations:**
- [ ] ⚪ Contract tests assert schema for each endpoint.
- [ ] ⚪ Query/filter tests (cursor, filters, distance) pass for mocks.
- [ ] ⚪ Add unhappy-path tests when moving endpoints to production-ready.

---

## Frontend TODO (Flutter/Web)
- [ ] ⚪ Events browsing, event detail, and presence confirmation.
- [ ] ⚪ Invites between users (send/receive/accept/decline) with credited acceptance selection.
- [ ] ⚪ Favorites for **Artists + Venues**, shown on Home and opening reduced profiles.
- [ ] ⚪ Reduced Artist profile (tabs: `Sobre` if bio exists, `Eventos`).
- [ ] ⚪ Reduced Venue profile (tabs: `Sobre` if bio exists, `Como Chegar`, `Eventos`).
- [ ] ⚪ Event Detail sections:
  - [ ] ⚪ `Como Chegar` with map + route CTA only.
  - [ ] ⚪ `O Local` with venue details + CTA to open venue profile.
  - [ ] ⚪ Artists: single artist as compact detail block + CTA; multiple artists as cards/list + CTA.
- [ ] ⚪ Map with POIs:
  - [ ] ⚪ Static POIs for Culture, Beach, Nature, Historic, Restaurant.
  - [ ] ⚪ Event POIs (time-anchored).
  - [ ] ⚪ POI tap opens its own detail (route/path or model reference).
- [ ] ⚪ Push notifications baseline (invite received + event reminder).
- [ ] ⚪ Telemetry (Mixpanel) baseline funnels and identifiers.
- [ ] ⚪ Define trigger moments for telemetry events (when each event fires).

---

## Backend TODO (Laravel/API)
- [ ] ⚪ Accounts can be created without users (Unmanaged state).
- [ ] ⚪ Unmanaged accounts become managed by linking/creating a user and granting access.
- [ ] ⚪ StaticAssets exist as non-partner sources for POIs (landlord-managed; account users read-only).
- [ ] ⚪ POI projection:
  - [ ] ⚪ `map_pois` is the projection store for map queries.
  - [ ] ⚪ Projection updates on create/update/delete of POI-enabled sources (StaticAsset, Event, conditional Account).
- [ ] ⚪ Landlord permissions (Sanctum abilities) are app-wide (not admin-only):
  - [ ] ⚪ `can_create_partners`
  - [ ] ⚪ `can_delete_partners`
  - [ ] ⚪ `can_view_partners`
  - [ ] ⚪ `can_manage_partner_all`
  - [ ] ⚪ `can_manage_partner_unmanaged`
  - [ ] ⚪ `can_manage_assets`
- [ ] ⚪ Account user permissions (Sanctum abilities):
  - [ ] ⚪ `can_manage_details`
  - [ ] ⚪ `can_manage_events`
- [ ] ⚪ Audit coverage:
  - [ ] ⚪ `created_by` / `updated_by` + `*_by_type` on entities.
  - [ ] ⚪ `action_audit_log` for all create/update/delete actions (single collection, not capped).

---

## Web + Distribution (Frontend)
- [ ] ⚪ Web invite landing + acceptance via code.
- [ ] ⚪ Web-to-app attribution preserved (code carried through to app).
- [ ] ⚪ Invite share links carry the `code` as a GET parameter.

---

## Frontend Tasks (Flutter/Web)
- [ ] ⚪ Orchestrator: `foundation_documentation/todos/active/mvp_slices/TODO-v1-first-release.md`
- [ ] ⚪ Test foundation: `foundation_documentation/todos/active/mvp_slices/TODO-v1-flutter-test-foundation.md`
- [ ] ⚪ Events & Agenda: `foundation_documentation/todos/active/mvp_slices/TODO-v1-events-and-agenda.md`
- [ ] ⚪ Invites (Flutter): `foundation_documentation/todos/active/mvp_slices/TODO-v1-invites-implementation.md`
- [ ] ⚪ Map: `foundation_documentation/todos/active/mvp_slices/TODO-v1-map.md`
- [ ] ⚪ Artist profile + favorites: `foundation_documentation/todos/active/mvp_slices/TODO-v1-artist-favorites-and-profile.md`
- [ ] ⚪ Venue profile: `foundation_documentation/todos/active/mvp_slices/TODO-v1-venue-profile.md`
- [ ] ⚪ Tenant/Admin area: `foundation_documentation/todos/active/mvp_slices/TODO-v1-partner-workspace.md`
- [ ] ⚪ Web-to-app policy: `foundation_documentation/todos/active/mvp_slices/TODO-v1-web-to-app-policy.md`
- [ ] ⚪ Telemetry + push: `foundation_documentation/todos/active/mvp_slices/TODO-v1-telemetry-and-push.md`
- [ ] ⚪ UI/UX polish: `foundation_documentation/todos/active/mvp_slices/TODO-mvp-ui-polish.md`

---

## Backend Tasks
- [ ] ⚪ Orchestrator: `foundation_documentation/todos/active/mvp_slices/TODO-v1-first-release.md`
- [ ] ⚪ Invites (API): `foundation_documentation/todos/active/mvp_slices/TODO-v1-invites-implementation.md`
- [ ] ⚪ Events & Agenda (API): `foundation_documentation/todos/active/mvp_slices/TODO-v1-events-and-agenda.md`
- [ ] ⚪ Map/POI projection: `foundation_documentation/todos/active/mvp_slices/TODO-v1-map.md`
- [ ] ⚪ Telemetry + push: `foundation_documentation/todos/active/mvp_slices/TODO-v1-telemetry-and-push.md`
- [ ] ⚪ Tenant/Admin area (accounts/assets/branding): `foundation_documentation/todos/active/mvp_slices/TODO-v1-partner-workspace.md`

---

## Explicitly Deferred (VNext)
- [ ] ⚪ Sponsors as POIs (multi-location/moving model needed).
- [ ] ⚪ Partner-issued invites + partner invite metrics.
- [ ] ⚪ Full partner profile modules beyond reduced tabs.
- [ ] ⚪ Backend-persistent favorites.
