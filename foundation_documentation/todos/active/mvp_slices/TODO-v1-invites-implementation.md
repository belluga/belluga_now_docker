# TODO (V1): Invites Implementation (Backend + Flutter)

**Status:** Active  
**Owners:** Backend Team (source of truth) + Delphi (Flutter)  
**Objective:** Deliver invites that are quota-safe, audit-safe, and metrics-ready for partner gamification.

---

## References
- `foundation_documentation/modules/invite_and_social_loop_module.md`
- `foundation_documentation/modules/partner_admin_module.md`
- Deferred items: `foundation_documentation/todos/active/TODO-vnext-parking-lot.md`

## A) Backend Work

### A1) Data model requirements
- [ ] Persist invites with:
  - `event_id`, `tenant_id`
  - `receiver_user_id`
  - `inviter_principal { kind:user|partner, id }`
  - `issued_by_user_id` (nullable; required when inviter is partner)
  - `status` includes `closed_duplicate`
  - `credited_acceptance` boolean
  - timestamps: `created_at`, `viewed_at?`, `responded_at?`, `updated_at`

### A1.1) External share codes (new users attribution)
- [ ] Implement share code storage:
  - [ ] `code` → resolves to `{ tenant_id, event_id, inviter_principal, issued_by_user_id? }`
  - [ ] record opens on resolve
  - [ ] record consumption post-install/post-signup (binds attribution to user)
- [ ] Ensure eligibility: anyone who can invite can generate a share code
- [ ] Ensure share code does not bypass invite uniqueness (no duplicate invite spam)

### A1.2) Web acceptance (invite landing only) + same-event re-share
- [ ] Implement `POST /v1/app/invites/share/{code}/accept` (or equivalent) for web landing acceptance
- [ ] Acceptance credits the inviter principal bound to `code` (no multi-inviter selection on web)
- [ ] Require Sanctum (`auth:sanctum`) even on web landing acceptance; web obtains an anonymous token first via `POST /v1/anonymous/identities`
- [ ] Create/bind an anonymous identity on web acceptance so the backend can persist acceptance + attribution (anonymous user + Sanctum token is sufficient)
- [ ] Allow external re-share only for the same `event_id` after acceptance, with strict backend limits
- [ ] Invite share links must carry the `code` as a GET parameter in the URL

### A2) Uniqueness + responses
- [ ] Enforce uniqueness key:
  - `(tenant_id, event_id, receiver_user_id, inviter_principal.kind, inviter_principal.id)`
- [ ] On duplicate: respond `already_invited` (include the existing invite id/code for idempotency if desired)

### A3) Credited acceptance transaction
- [ ] On accept:
  - [ ] Set selected invite: `status=accepted`, `credited_acceptance=true`, `responded_at=now`
  - [ ] For all other invites for `(tenant_id, event_id, receiver_user_id)`:
    - [ ] set `status=closed_duplicate`, `credited_acceptance=false` (idempotent)
- [ ] Make this transactional (single source of truth for accepted conversions)

### A4) Limits (tenant settings)
- [ ] Implement `GET /v1/app/invites/settings` and enforce:
  - [ ] per-event per-inviter limits
  - [ ] per-day limits (partner + user actor)
  - [ ] pending invites cap per receiver
  - [ ] suppression lists and opt-out
- [ ] On limit hit: return `429` with payload `{ limit_key, resets_at, remaining?, allowed?, scope }`

### A5) Partner-issued invites authorization
- [ ] Validate `issued_by_user_id` has an active membership in inviter partner with `can_invite=true`

### A6) Partner event metrics
- [ ] Provide aggregates for event host/managing partner:
  - per inviter principal: sent/viewed/accepted(credited)/declined/closed_duplicate
  - per issuer user: same breakdown
  - totals

---

## B) Flutter Work

### B1) “Accept invite from…” UX (no default)
- [ ] Invite card shows:
  - [ ] “Escolher convite para aceitar”
  - [ ] “+N convites para esse evento”
- [ ] Tap opens selector list of inviters (tiles), user must select one
- [ ] Accept CTA disabled until selection exists

### B2) Handling `already_invited`
- [ ] When sending invite returns `already_invited`, show state “Já convidado” and avoid duplicate UI entries

### B3) Client settings fetch
- [ ] Add a repository call for `/v1/app/invites/settings` (cache briefly)
- [ ] Use settings only for UX messaging; do not assume limits client-side as authoritative

### B3.1) External share deep links (new users attribution)
- [ ] Support opening share links (WhatsApp/Instagram/etc.) that include a `code`
- [ ] Persist pending share `code` through onboarding/auth until user is available
- [ ] Call backend `consume` endpoint once the user is known to bind attribution
- [ ] Route user into the event context after consuming (or show a safe landing if event is not available)

### B3.2) Web acceptance UX constraints (for Web Team)
- [ ] Web invite landing can show “Aceitar” only when reached via a single `code`
- [ ] Do not expose agenda-based acceptance on web; agenda-first acceptance remains app-only
- [ ] On web landing, mint/resume anonymous identity via `POST /v1/anonymous/identities` and use the returned Sanctum token for accept + same-event re-share calls

### B4) Metrics surfacing
- [ ] Bind invite-related metrics pills (Profile + Menu hero) to repository streams:
  - sent invites count
  - accepted invites count (credited only)
  - presence confirmations

---

## C) VNext Notes (do not implement now)
- Offline persistence of invite state
- Rich suppression management UI
