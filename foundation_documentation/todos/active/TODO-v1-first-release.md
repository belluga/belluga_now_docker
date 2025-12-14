# TODO (V1): First Release Delivery Plan

**Status:** Active  
**Owner:** Delphi + Backend Team  
**Goal:** Ship the first tenant-facing version focused on Events + Invites + Artist Favorites + Map (with Beaches).

---

## References
- Invites contract + limits: `foundation_documentation/modules/invite_and_social_loop_module.md`
- Partner workspace + memberships (draft): `foundation_documentation/modules/partner_admin_module.md`
- Roadmap tracking: `foundation_documentation/system_roadmap.md`
- Deferred features: `foundation_documentation/todos/active/TODO-vnext-parking-lot.md`
- Invites implementation slice: `foundation_documentation/todos/active/TODO-v1-invites-implementation.md`
- Telemetry + push slice: `foundation_documentation/todos/active/TODO-v1-telemetry-and-push.md`
- Map slice: `foundation_documentation/todos/active/TODO-v1-map.md`
- Events/Agenda slice: `foundation_documentation/todos/active/TODO-v1-events-and-agenda.md`
- Artist favorites/profile slice: `foundation_documentation/todos/active/TODO-v1-artist-favorites-and-profile.md`
- Partner workspace slice: `foundation_documentation/todos/active/TODO-v1-partner-workspace.md`
- Web-to-app policy slice: `foundation_documentation/todos/active/TODO-v1-web-to-app-policy.md`

## 0) Scope Boundaries (V1)

### In scope
These are scope descriptors (not tasks).
- Events browsing + event detail
- Invites: send, receive, accept/decline, confirm presence
- Invite crediting selection (“Accept invite from…”, no default)
- Partner-issued invites (Artist/Venue/Creator) with `issued_by_user_id` audit
- Partner event invite metrics (for the event host/managing partner)
- Map POIs with categories: `Culture`, `Sponsor`, `Restaurant`, `Beach`, `Nature` + dynamic `Events`
- Artist favorites only (favorites remain surfaced in Home)
- Push notifications (V1 baseline)
- Tracking / product analytics (Mixpanel) integration (V1 baseline)

### Out of scope (tracked in `foundation_documentation/todos/active/TODO-vnext-parking-lot.md`)
- Wallet / purchases / premium
- Venue favorites + venue detail pages
- Persistent favorites (backend later; mock can reset on load)
- Full partner profile modules/store for all partner types

---

## 1) Domain/Contract Decisions (Must Hold)

### 1.1 Invites (anti-gaming + monetization-safe)
- Uniqueness: forbid duplicate invite key `(tenant_id, event_id, receiver_user_id, inviter_principal.kind, inviter_principal.id)` → respond `already_invited`.
- Credited acceptance: exactly one `credited_acceptance=true` per `(receiver_user_id, event_id)`; others become `closed_duplicate`.
- No default inviter selection in UI; user must pick who to credit before accepting.
- Inviter principal is union `{kind:user|partner, id}`; partner-issued invites also record `issued_by_user_id`.

### 1.2 Canonical IDs
- Events and participants always reference stable `partner_id` (create partners upfront with Tiny Free when needed).
- Never rely on name-only references except as display fallbacks.

### 1.3 Metrics access boundary
- Event invite metrics visible only to users who are members of the event’s host/managing partner and have `can_view_metrics=true`.

---

## 2) Backend Deliverables

### 2.1 Invite Settings (backend-owned + enforced)
- [ ] Implement endpoint: `GET /v1/app/invites/settings`
- [ ] Enforce limits on invite creation and return:
  - [ ] `429` with structured payload when over quota/rate-limited
  - [ ] reset metadata (`resets_at`) and “which limit” identifier
- [ ] Make settings tenant-configurable (no app release required to tune)

Suggested defaults (override per tenant + plan):
- `max_invites_per_event_per_inviter = 300`
- `max_invites_per_day_per_partner = 500` (Tiny Free: `50–100`)
- `max_invites_per_day_per_user_actor = 100`
- `max_pending_invites_per_invitee = 20`
- `max_invites_to_same_invitee_per_30d = 10`
- suppression: per-partner blocklist + per-user opt-out

### 2.2 Partner membership + partner-issued actions
- [ ] Implement `partner_memberships` (draft spec in `foundation_documentation/modules/partner_admin_module.md`)
- [ ] Validate `issued_by_user_id` permissions when sending partner invites

### 2.3 Event invite metrics (partner-facing)
- [ ] Implement endpoint(s) (exact naming TBD by backend team):
  - [ ] `GET /v1/partners/{partner_id}/events/{event_id}/invites/metrics`
  - [ ] `GET /v1/partners/{partner_id}/events/{event_id}/invites` (drill-down)
- [ ] Provide per-inviter principal + per-issuer user aggregates; accepted counts must use `credited_acceptance=true`

### 2.4 Push notifications (baseline)
- [ ] Implement device registration endpoint (exact naming TBD):
  - [ ] `POST /v1/app/push/register` with `{ device_id, platform, push_token }`
  - [ ] Optional `DELETE /v1/app/push/unregister`
- [ ] Send notifications (minimum):
  - [ ] New invite received
  - [ ] Invite status change (accepted/declined) when relevant
  - [ ] Event reminder for confirmed attendance (or delegate to Task/Reminder service)
- [ ] Make notification policies tenant-configurable (no app release required)

### 2.5 Tracking / Analytics (Mixpanel)
- [ ] Provide a stable event taxonomy and required properties (tenant-aware)
- [ ] If backend emits events too, align naming/ownership to avoid double-counting

---

## 3) Flutter Deliverables

### 3.1 Tenant: Invites UX
- [ ] Replace “who invited me” modal with:
  - [ ] “Escolher convite para aceitar” → opens selector list of inviters
  - [ ] no default; CTA disabled until selection is made
  - [ ] accept credits selected inviter and updates UI state
- [ ] Ensure UI shows “já convidado” when backend returns `already_invited`
- [ ] Expose invite metrics counters (sent/accepted/confirmed) in Profile and Menu hero, wired to the correct repositories

### 3.2 Tenant: Favorites (Artist-only)
- [ ] Keep favorites displayed in Home
- [ ] Clicking an artist favorite opens the existing Partner Detail base page with reduced tabs (artist config)
- [ ] Enforce “favoritable” for artists only in the mock repository path until backend sends capabilities

### 3.3 Tenant: Map
- [ ] Keep POI categories coarse; use tags for subcategories
- [ ] Ensure Beaches are included and filterable (already present in mock POI DB)
- [ ] Ensure dynamic Event POIs are visible and remain distinct from static POIs

### 3.5 Push notifications (baseline)
- [ ] Register device token on startup/login and handle token rotation
- [ ] Deep link routing (at minimum: open invite/event detail)
- [ ] Respect tenant settings for notification categories (best-effort client gating; backend remains authoritative)

### 3.6 Tracking / Analytics (Mixpanel)
- [ ] Initialize Mixpanel with tenant/app keys from backend bootstrap (preferred) or environment config
- [ ] Track critical funnel events (minimum):
  - [ ] `invite_received`, `invite_opened`, `invite_accept_selected_inviter`, `invite_accepted`, `invite_declined`
  - [ ] `event_opened`, `event_confirmed_presence`
  - [ ] `favorite_artist_toggled`, `map_opened`, `poi_opened`
- [ ] Ensure every event includes: `tenant_id`, `event_id` (when applicable), `inviter_kind/id` (when applicable), `partner_id` (when applicable)

### 3.4 Partner Workspace (V1 minimum pages)
- [ ] Partner Workspace Home
- [ ] Partner Members
- [ ] Event Invite Metrics view
- [ ] Plan/Limits read-only view (uses invite settings payload + partner plan payload)

---

## 4) Acceptance Criteria (V1)

- [ ] Invites cannot be duplicated by same inviter for same receiver+event (`already_invited`)
- [ ] Accepting an invite requires explicit inviter selection; only one credited acceptance per receiver+event
- [ ] Partner event metrics show credited accepted counts and “issued_by_user_id” breakdown for auditing
- [ ] Map supports the agreed categories and shows beaches + events
- [ ] No Wallet/Purchases/Premium surfaces ship in V1 (tracked as deferred)
- [ ] Push notifications work end-to-end for invite received at minimum, including deep link routing
- [ ] Mixpanel captures the invite funnel and event funnel with consistent identifiers
