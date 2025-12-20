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
  - Sponsors (remain)
  - Historic attractions / churches (decision needed: how we model + filter)

### 2.2 Admin/Workspace MVP (authenticated)
- Flows to add/edit/delete:
  - Events
  - Artists and venues (as partner “free accounts”)
  - Static POIs (beaches/nature/culture/historic/restaurants/sponsors)
- Permission boundaries:
  - Artist/Venue profiles can delete their own profile and events related to them.
  - Admin/landlord can create partners and can create events “on behalf of” other partners.
- Audit trail required for all write actions (create/update/delete):
  - Who performed the action (user id)
  - Which partner was affected
  - When it happened
  - “On behalf of” context (landlord override)

### 2.3 Unclaimed partners + hidden claim
- Team creates “free accounts” that are initially **unclaimed**.
- Claim flow must be hidden in UI for now.
- API-only: we can link an existing/new user to the partner and resolve the unclaimed status.

---

## 3) Open Decisions (Must Answer)

### D1) POI taxonomy + filters (Map)
1. **Culture**: Should this be strictly “Centros Culturais” only (e.g., Vila Verde, Casa Sinestésica)?
2. **Historic / churches**:
   - Option A: treat as **Culture** (broader umbrella) using tags like `historical`, `church`, `heritage`.
   - Option B: treat as **Attraction** with tags (`historical`, `church`) and keep “Culture” strict.
   - Option C: create a dedicated “Historic” filter label (UI-only grouping) without expanding enums.

**Recommendation:** Choose **Option C** for UX clarity *without* expanding enums:
- Keep backend enum/categories coarse (no new enum values in V1/MVP).
- Add a “Histórico” filter in UI that maps to categories `{monument, church, attraction}` and/or tags `{historical, heritage}`.
- Keep “Cultura” filter mapping to `{culture}` (centros culturais), with optional tags for subtypes.

**Decision (MVP):** Churches are included **only** when they have historical relevance, and they live under the **Histórico** grouping (along with monuments and other historic attractions). We do **not** list “churches” as a standalone public category/filter.

3. **Nature**: Confirm Nature includes parks/ecological areas; define required tags (e.g., `park`, `trail`, `waterfall`) and whether nature POIs must always include coordinates + a short description.
4. **Restaurants**: Clarify whether food POIs are always `restaurant` category, or if some should be `attraction` with `food` tag.
5. **Sponsors**: Confirm sponsor POIs are static and always visible, or visibility is tenant-configurable.

### D2) Reduced profiles (Artist + Venue)
1. Define “reduced Artist profile” modules (tabs/sections) for MVP.
2. Define “reduced Venue profile” modules (tabs/sections) for MVP.
3. Define cross-link rules:
   - Event detail links to venue + artists
   - Map POI links to venue/restaurant vs static POI detail

**MVP Decision (no tech debt):** Implement reduced profiles strictly via the existing `PartnerProfileConfig` / `ProfileModuleId` composition (no new screen or parallel profile system). The fixed header/taxonomy (name/type/tagline/badges/hero) remains above tabs.

**Artist (`PartnerType.artist`)**
- Tab `Sobre` (conditional, **must be first when present**): `ProfileModuleId.richText` **only if** the partner has a non-empty bio/description.
- Tab `Eventos` (always): `ProfileModuleId.agendaCarousel` (or `ProfileModuleId.agendaList` if we standardize on list).
- Exclusions (MVP): `externalLinks`, `musicPlayer`, `productGrid`, and any commerce/store modules.

**Venue (`PartnerType.venue`)**
- Tab `Sobre` (conditional, **must be first when present**): `ProfileModuleId.richText` **only if** the partner has a non-empty bio/description.
- Tab `Como Chegar` (always): `ProfileModuleId.locationInfo` with:
  - a map preview, and
  - a primary action that opens route/navigation.
- Tab `Eventos` (always): `ProfileModuleId.agendaList`.
- Exclusions (MVP): `externalLinks`, `supportedEntities`, and any commerce/store modules.

### D3) Unclaimed partner model
1. What fields represent unclaimed status? (e.g., `is_claimed`, `claimed_at`, `claimed_by_user_id`).
2. How do we model ownership vs membership? (recommend: `partner_memberships` becomes the source of truth; claim sets an `owner` membership + marks partner as claimed).
3. How does “link user to partner” work for MVP? (existing user vs new user creation).

### D4) Admin/workspace permissions + audit
1. Minimum permission flags for MVP:
   - `can_manage_events`
   - `can_manage_partner_profile`
   - `can_manage_pois`
   - `can_delete_partner` (only for own partner)
2. Audit log storage:
   - Do we use a single `action_audit_log` collection (recommended) or per-entity audit fields only?
3. “Act on behalf of” semantics:
   - When landlord creates/edits an event for a partner, what exact fields do we store? (recommend: `issued_by_user_id` pattern, plus `acting_partner_id`).

### D5) MVP scope boundary vs V1 scope
Confirm what we *must* include in MVP versus defer:
- Invites (full credited acceptance, quotas, share codes) — required now or defer?
- Push + telemetry — required now or defer?
- Partner invite metrics — required now or defer?

---

## 4) Proposed TODO changes after decisions are made

After we answer D1–D5, we will:
1. Update `TODO-v1-map.md` to explicitly match the agreed POI taxonomy + filter mapping.
2. Add a new TODO for “Venue reduced profile”.
3. Add a new TODO for “Admin/workspace CRUD + audit + unclaimed partner lifecycle”.
4. Update `TODO-v1-first-release.md` to reflect the MVP boundary (and move non-MVP items to `TODO-vnext-parking-lot.md`).

---

## 5) Definition of Done (for this TODO)
- All decisions D1–D5 answered and documented in this file.
- A “MVP checklist” exists (single source of truth) and links to the execution TODOs.
- Any non-MVP items explicitly deferred and referenced in `TODO-vnext-parking-lot.md`.
