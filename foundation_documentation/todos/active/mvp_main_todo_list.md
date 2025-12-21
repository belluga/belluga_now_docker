# MVP Main TODO List (What We Are Shipping)

**Purpose:** Print-friendly checklist focused on **WHAT** we will deliver in MVP (not implementation details).

---

## Tenant Experience (Public-Facing)
- [ ] Events browsing, event detail, and presence confirmation.
- [ ] Invites between users (send/receive/accept/decline) with credited acceptance selection.
- [ ] Favorites for **Artists + Venues**, shown on Home and opening reduced profiles.
- [ ] Reduced Artist profile (tabs: `Sobre` if bio exists, `Eventos`).
- [ ] Reduced Venue profile (tabs: `Sobre` if bio exists, `Como Chegar`, `Eventos`).
- [ ] Event Detail sections:
  - [ ] `Como Chegar` with map + route CTA only.
  - [ ] `O Local` with venue details + CTA to open venue profile.
  - [ ] Artists: single artist as compact detail block + CTA; multiple artists as cards/list + CTA.
- [ ] Map with POIs:
  - [ ] Static POIs for Culture, Beach, Nature, Historic, Restaurant.
  - [ ] Event POIs (time-anchored).
  - [ ] POI tap opens its own detail (route/path or model reference).
- [ ] Push notifications baseline (invite received + event reminder).
- [ ] Telemetry (Mixpanel) baseline funnels and identifiers.
- [ ] Define trigger moments for telemetry events (when each event fires).

---

## Partner/Account + Admin (Authenticated)
- [ ] Accounts can be created without users (Unmanaged state).
- [ ] Unmanaged accounts become managed by linking/creating a user and granting access.
- [ ] StaticAssets exist as non-partner sources for POIs (landlord-managed; account users read-only).
- [ ] POI projection:
  - [ ] `map_pois` is the projection store for map queries.
  - [ ] Projection updates on create/update/delete of POI-enabled sources (StaticAsset, Event, conditional Account).
- [ ] Landlord permissions (Sanctum abilities) are app-wide (not admin-only):
  - [ ] `can_create_partners`
  - [ ] `can_delete_partners`
  - [ ] `can_view_partners`
  - [ ] `can_manage_partner_all`
  - [ ] `can_manage_partner_unmanaged`
  - [ ] `can_manage_assets`
- [ ] Account user permissions (Sanctum abilities):
  - [ ] `can_manage_details`
  - [ ] `can_manage_events`
- [ ] Audit coverage:
  - [ ] `created_by` / `updated_by` + `*_by_type` on entities.
  - [ ] `action_audit_log` for all create/update/delete actions (single collection, not capped).

---

## Web + Distribution
- [ ] Web invite landing + acceptance via code.
- [ ] Web-to-app attribution preserved (code carried through to app).
- [ ] Invite share links carry the `code` as a GET parameter.

---

## Explicitly Deferred (VNext)
- [ ] Sponsors as POIs (multi-location/moving model needed).
- [ ] Partner-issued invites + partner invite metrics.
- [ ] Full partner profile modules beyond reduced tabs.
- [ ] Backend-persistent favorites.
