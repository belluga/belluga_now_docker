# TODO (V1): Web-to-App Promotion Policy + Tracking

**Status:** Active  
**Owners:** Delphi (Product/Flutter) + Backend Team + Web Team  
**Goal:** Define what is allowed on web vs app-only in V1, and instrument it to validate conversion assumptions.

---

## References
- `foundation_documentation/system_roadmap.md` (Web-to-App Promotion Policy section)
- `foundation_documentation/todos/active/TODO-v1-first-release.md`
- `foundation_documentation/todos/active/TODO-v1-invites-implementation.md` (share codes + attribution)

---

## A) V1 Policy (Initial Stance)

### Web (Unauthenticated) is allowed for (read-only + promotion)
- [ ] Event landing page (read-only): title, date/time, venue name, artists names, hero media
- [ ] Invite landing page (read-only): “You were invited by …” context + event summary
- [ ] Web unauth surfaces may mint a backend-issued anonymous Sanctum token via `POST /v1/anonymous/identities` to call allowed endpoints
- [ ] Install/Open-App CTA (deep link) that preserves attribution code
- [ ] V1 exception: allow invite acceptance only from invite landing reached via a single `code` (credited to that code’s inviter principal)
- [ ] V1 exception: allow re-share only the same event after acceptance (external share only), backend rate-limited
- [ ] Map browsing (read-only): allow web navigation on map for discovery (no favorites, no check-in)

### Web (Authenticated) is allowed for (partner workspace)
- [ ] Partner Workspace: event creation + management
- [ ] Partner Workspace: memberships/team management
- [ ] Partner Workspace: invite metrics dashboards

### App-only for V1 (tenant conversion + trust actions)
- [ ] Accept/Decline invite from agenda surfaces (credited acceptance + anti-gaming); invite landing by `code` is the only web exception
- [ ] Confirm presence / check-in
- [ ] Send invites (user + partner-issued)
- [ ] Favorites (artist favorites)
- [ ] Full map experience (location permission, stacked POI deck UX parity, search/filter); web can browse read-only
- [ ] Any “full map parity” behavior beyond read-only browsing (favorites on map, check-in from map, credited acceptance selection UI)

Rationale: keep high-value actions in the app to ensure identity, location capabilities, push reminders, and consistent attribution.

---

## B) Deep Link / Attribution Requirements

- [ ] Web links must carry a single `code` (invite share code) in the URL
- [ ] If web user is not logged in, web mints/resumes an anonymous identity (`POST /v1/anonymous/identities`) and uses its Sanctum token for landing actions (accept + same-event re-share)
- [ ] Web must redirect to:
  - [ ] App deep link (if installed)
  - [ ] App store (if not installed), preserving the `code` for post-install attribution
- [ ] After install/sign-up, the app must call the backend `consume` endpoint to bind attribution to the new user

---

## C) Tracking (Must-Have)

### Web events (minimum)
- [ ] `web_anonymous_identity_created` (properties: `tenant_id`, `identity_state`, `expires_at?`, `abilities_count`)
- [ ] `web_invite_landing_opened` (properties: `tenant_id`, `code`, `event_id`, `inviter_kind`, `inviter_id`)
- [ ] `web_event_landing_opened` (same)
- [ ] `web_open_app_clicked`
- [ ] `web_install_clicked`
- [ ] `web_invite_accepted` (invite landing only; properties include `code`, `event_id`, `inviter_kind/id`)
- [ ] `web_event_reshared` (same-event only; properties include `event_id`, `channel`)

### App events (minimum)
- [ ] `app_first_open_with_code`
- [ ] `app_attribution_consumed`
- [ ] `app_signup_completed` (if applicable)
- [ ] `invite_accepted` / `invite_declined`
- [ ] `event_confirmed_presence`

### KPIs to monitor
- [ ] Landing → Install rate
- [ ] Install → Signup rate
- [ ] Signup → Invite acceptance rate
- [ ] Invite acceptance → Presence confirmation rate
- [ ] Web-accept share rate (accepted → reshare) and downstream installs

---

## D) Guardrails

- [ ] If we later allow web acceptance, it must still enforce:
  - [ ] credited acceptance selection
  - [ ] anti-spam limits
  - [ ] identity binding (account creation)
  - [ ] fraud checks
