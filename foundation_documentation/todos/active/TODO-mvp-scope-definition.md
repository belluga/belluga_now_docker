# TODO (MVP): Scope Definition + Open Decisions

**Owners:** Delphi + Time Produto + Backend + Flutter + Web  
**Status:** Active  
**Goal:** Lock the MVP scope (what ships / what is deferred) and document the decisions needed before execution begins.

---

## 1) Why this TODO exists

We are targeting an MVP that can be shipped ASAP. Our current V1 TODO set is strong for tenant consumption (events/invites/map), but it is missing or under-specifying key MVP needs:
- Reduced profiles for **Artists** and **Venues** (not just artists).
- Map POI coverage rules for **Culture**, **Historic/Churches**, **Nature**, **Restaurants**, **Sponsors**.
- Admin/landlord + partner workspace flows to create/edit/delete **events**, **artists/venues**, and **POIs**.
- “Free/unclaimed” partner accounts and a hidden claim process (API-only for now).
- Audit requirements: “who edited what” and “acting on behalf of” semantics.

This TODO is the “gate” for scope clarity: we answer the questions below, then we refine/adjust the execution TODOs (`TODO-v1-*`) accordingly.

---

## 2) MVP Requirements (Target State)

### 2.1 Tenant (public-facing) MVP
- Reduced profiles:
  - Artist reduced profile (already tracked in `TODO-v1-artist-favorites-and-profile.md`)
  - Venue reduced profile (missing; must be defined)
- Map POIs:
  - Beaches
  - Nature attractions (e.g., ecological parks)
  - Restaurants
  - Culture centers (e.g., Vila Verde, Centro Cultural Casa Sinestésica)
  - Sponsors (deferred to VNext)
  - Historic attractions / churches (decision needed: how we model + filter)

### 2.2 Admin/Workspace MVP (authenticated)
- Flows to add/edit/delete:
  - Events
  - Artists and venues (as partner “free accounts”)
  - Static POIs (beaches/nature/culture/historic/restaurants)
- Permission boundaries:
  - Artist/Venue profiles can delete their own profile and events related to them.
  - Admin/landlord can create partners and can create events “on behalf of” other partners.
- Audit trail required for all write actions (create/update/delete):
  - Who performed the action (user id)
  - Which partner was affected
  - When it happened
  - “On behalf of” context (landlord override)

### 2.3 Unmanaged accounts + hidden manage flow
- Team creates “free accounts” that are initially **Unmanaged**.
- Manage flow must be hidden in UI for now.
- API-only: we can link an existing/new user to the account and resolve the unmanaged status.

---

## 3) Decision Register (Explicit)

### D1) POI taxonomy + filters (Map)
**Decided (MVP)**
- **Culture** is strictly “Centros Culturais” (e.g., Vila Verde, Casa Sinestésica).
- **Historic** is a UI grouping that includes historically relevant churches + monuments + historic attractions; **no standalone “churches”** category.
- **Nature** includes ecological parks and other natural attractions.
- Sponsors are **deferred** from MVP (see VNext).
- **StaticAsset** is the source entity for non-partner assets; POI is a projection (same pattern as Partner/Event).
- Partner/StaticAsset create/update/delete triggers a POI projection job (create/update/remove in `map_pois`).
- StaticAssets are landlord-managed (app owner/admin); AccountUsers have read-only access.
- `map_pois` is a projection store; map queries read `map_pois` directly (no aggregation at query time).
- POI-enabled sources: `StaticAsset` (yes), `Event` (yes), `Account`/Partner (conditional).
- Restaurants always use `restaurant` category; cuisine details are tags (no `attraction` + `food` workaround).
- Nature assets require `name`; `description` and `thumbnail` are optional.
- Use **Unmanaged** state to represent accounts with no responsible user; compute/update the flag on relevant writes (account save + membership/user attach/detach).
- Use a shared POI projection hook (e.g., Laravel trait `HasPoiProjection`) to trigger `map_pois` upsert/remove on save/delete for POI-enabled sources.

### D2) Reduced profiles (Artist + Venue)
**Decided (MVP)**
- **No tech debt**: implement reduced profiles via existing `PartnerProfileConfig` / `ProfileModuleId` (no parallel system).
- Header/taxonomy remains **above** tabs.
- Bio is optional; if present, show **Sobre** and it is **always the first tab**.

**Artist (`PartnerType.artist`)**
- Tabs: `Sobre` (conditional) + `Eventos` (always).
- `Sobre` uses `ProfileModuleId.richText` only when bio exists.
- `Eventos` uses `ProfileModuleId.agendaCarousel` (or `ProfileModuleId.agendaList` if we standardize).
- Exclusions: `externalLinks`, `musicPlayer`, `productGrid`, commerce/store modules.

**Venue (`PartnerType.venue`)**
- Tabs: `Sobre` (conditional) + `Como Chegar` (always) + `Eventos` (always).
- `Como Chegar` uses `ProfileModuleId.locationInfo` with map preview + route action.
- `Eventos` uses `ProfileModuleId.agendaList`.
- Exclusions: `externalLinks`, `supportedEntities`, commerce/store modules.

**Decided (MVP)**
- Event detail:
  - `Como Chegar` shows map + route CTA only.
  - `O Local` shows venue details + CTA to open the venue profile.
- Artists section:
  - Single artist → compact detail block + CTA to open artist profile.
  - Multiple artists → list/cards with CTA to open artist profile (quick actions allowed on cards).

- POI tap opens its own detail using a direct route/path or model reference.

### D3) Unmanaged account model
**Decided (MVP)**
- Use only `is_managed` as the Unmanaged flag (no `managed_at`/`managed_by_user_id`).
- Account-based memberships; no owner role.

- Manage flow: create user (if needed) and grant access to the Account.

### D4) Admin/workspace permissions + audit
**Decided (MVP)**
- Permissions enforced via Sanctum abilities.
- Landlord abilities:
  - `can_create_partners`
  - `can_delete_partners`
  - `can_view_partners`
  - `can_manage_partner_all`
  - `can_manage_partner_unmanaged`
  - `can_manage_assets`
- Account user abilities:
  - `can_manage_details`
  - `can_manage_events`
- Audit:
  - Use a single `action_audit_log` collection for all managed objects (create/update/delete).
  - Do **not** use capped collection in MVP (avoid truncation).
  - Keep `created_by` / `updated_by` + `*_by_type` on entities for quick attribution.
  - Audit log stores `actor_type`, `actor_id`, `entity_type`, `entity_id`, `action`, `created_at`, and optional `acting_account_id` when acting on behalf.

### D5) MVP scope boundary vs V1 scope
**Decided (MVP)**
- Telemetry (Mixpanel) is included in MVP scope (not deferred).
- Invites from other users are included in MVP.
- Push notifications are included in MVP.
- Partner invite metrics are deferred (see VNext).

---

## 4) Proposed TODO changes after decisions are made

After we answer D1–D5, we will:
- [ ] Update `TODO-v1-map.md` to explicitly match the agreed POI taxonomy + filter mapping.
- [ ] Add a new TODO for “Venue reduced profile”.
- [ ] Add a new TODO for “Admin/workspace CRUD + audit + unclaimed partner lifecycle”.
- [ ] Update `TODO-v1-first-release.md` to reflect the MVP boundary (and move non-MVP items to `TODO-vnext-parking-lot.md`).

---

## 5) Definition of Done (for this TODO)
- [ ] All decisions D1–D5 answered and documented in this file.
- [ ] A “MVP checklist” exists (single source of truth) and links to the execution TODOs.
- [ ] Any non-MVP items explicitly deferred and referenced in `TODO-vnext-parking-lot.md`.
