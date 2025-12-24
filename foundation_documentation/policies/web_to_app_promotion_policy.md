# Documentation: Web-to-App Promotion Policy

**Version:** 1.1  
**Date:** December 14, 2025  
**Authors:** Delphi (Belluga Co-Engineering)

## 1. Purpose

This policy captures the rules governing how web surfaces (landing pages, invite links, partner campaigns) promote the native Guar[APP]ari application. It ensures every module (Invite, Onboarding, Task & Reminder, Partner Analytics) follows the same stance when deciding whether high-value actions can occur on the web or must flow through the app.

## 2. Three-Tier Surface Model (V1)

We operate with three explicit tiers:

1. **Web (Unauthenticated):** acquisition and context only (but may use a backend-issued anonymous Sanctum token).
2. **Web (Authenticated):** lightweight account operations + partner workspace operations.
3. **App:** conversion, trust actions, location/push-native flows.

This separation prevents accidental “half-logged-in” behaviors that break attribution, quotas, and gamification metrics.

## 3. V1 Stance (What Each Tier May Do)

### 3.1 Web (Unauthenticated)
- Allowed:
  - event/invite landing (read-only), partner branding, “Open in App / Install” CTA, attribution code preservation.
  - **Invite acceptance from the invite landing only** (see Section 4.1), limited to the invite code context and rate-limited server-side.
  - **Map browsing (read-only):** show POIs/events on a web map to support discovery and guide users into the app for confirmations.
- Not allowed:
  - tenant “agenda-first” acceptance flows (acceptance initiated from the app agenda remains app-only),
  - check-in, favorites, any general-purpose “web social graph”, or “web-native” invite sending beyond same-event re-share after acceptance.

### 3.2 Web (Authenticated)
- Allowed (V1):
  - Account bootstrap/recovery (login/signup/password reset).
  - **Partner Workspace**: event creation and management, partner profile editing, team management, invite metrics dashboards.
  - Map browsing (read-only) is allowed, but remains a non-trust surface.
- Not allowed (V1):
  - Tenant agenda-first conversion/trust actions: accept/decline invites from agenda, check-in, favorites, or any “full map parity” behaviors.

### 3.3 App
- Allowed (V1): all tenant conversion + trust actions:
  - accept/decline invites (credited acceptance selection),
  - confirm presence/check-in,
  - send invites (user + partner-issued),
  - favorites,
  - full map experience (location permission + POI stacking deck),
  - tenant push and deep-link flows.

## 4. Landing + Attribution Rules (V1)

- Web landing pages must preserve the invite share `code` through install/open-app flows.
- Conversions are attributed only when the backend receives the corresponding app events (e.g., share `consume`, invite acceptance, check-in).
- Web-auth partner workspace actions are first-class and tracked separately (do not mix with tenant acquisition funnels).

### 4.0 Sanctum Requirement (Open API Clarification)

“Open API” in this ecosystem means **a single canonical API surface** shared by web/app clients, with **Sanctum validation by default**.

- Web “unauthenticated” surfaces are still allowed to call Sanctum-protected endpoints by first minting an **anonymous identity token** via `POST /api/v1/anonymous/identities`.
- The backend controls what anonymous tokens may do using `tenant.anonymous_access_policy.abilities` (and TTL).

## 4.1 Web Invite Acceptance Exception (V1)

V1 includes a narrow exception: **web may accept invites only when the user is on an invite landing reached via a single invite/share `code`.**

Constraints:
- The accepted invite is credited to the inviter principal bound to that `code` (no multi-inviter selector on web).
- Web acceptance must create or bind a lightweight anonymous identity so the backend can persist (using Sanctum):
  - invite acceptance state,
  - attribution,
  - and (optionally) a limited re-share ability.
- **Re-share allowed on web:** only for the **same event** the user just accepted (external share only), and always backend rate-limited.
- Acceptance initiated from the tenant agenda remains app-only (the app is the “trusted conversion surface”).

## 5. Future Evaluation Criteria

We will revisit the policy after Phase 8 (Gamification Spine) once we have sufficient telemetry on invite funnels. A shift toward web confirmations or web-native chat will require:

1. **Security Parity:** Equivalent authentication/authorization guarantees on the web as in the app.
2. **Task & Reminder Bridging:** Ability to schedule push/email reminders even when the acceptance originated on the web.
3. **Module Parity:** Invite, Onboarding, Map, and Transaction modules must expose consistent schemas so both web and app clients stay in sync.
4. **Partner Requirements:** Certain partner tiers may fund lighter web funnels; these will be evaluated per tenant with opt-in contracts.

## 6. Implications by Module

| Module | Impact |
|--------|--------|
| Invite & Social Loop | Web unauth shows context + deep links only; acceptance remains app-only in V1. Web-auth partner workspace can view invite metrics and manage invite campaigns, but tenant acceptance remains app-only. |
| Onboarding Flow | All onboarding steps (preferences, location, contact import) are app-only. Web unauth pages inform and route to app install/open. |
| Task & Reminder | Push reminders point to app deep links. Web-auth partner workspace can configure some notification preferences, but execution remains app-driven. |
| Tenant Home Composer | Web unauth event pages deep link into app screens; do not replicate home composition logic on web in V1. |
| Partner Admin/Workspace | Web authenticated is the primary surface for partner event management + dashboards in V1; landlord users can override as needed. |
| Partner Analytics | Tracks web landing traffic and partner workspace actions; attributes tenant conversions only when backend receives app completion events. |

## 7. Policy Maintenance

* Any proposal to relax the app requirement must update this file, the system roadmap section, and the affected module docs.
* Changes require product and partner stakeholder approval, since they affect revenue-sharing agreements and data privacy.

---

*Next Review:* After Phase 8 telemetry review or sooner if growth experiments justify reconsideration.
