# TODO (V1): Telemetry (Mixpanel) + Push Notifications

**Status legend:** `- [ ] ⚪ Pending` · `- [ ] 🟡 Provisional` · `- [x] ✅ Production‑Ready`.
**Status:** Active  
**Owners:** Backend Team (source of truth) + Delphi (Flutter)  
**Objective:** Ship V1 with measurable funnels and reliable invite/event notifications.

---

## References
- `foundation_documentation/todos/active/mvp_slices/TODO-v1-first-release.md`
- `foundation_documentation/modules/invite_and_social_loop_module.md`
- `foundation_documentation/system_roadmap.md`

---

## A) What Push Is For (V1)

Minimum notifications:
- Invite received (high priority)
- Event reminder for confirmed attendance (if scheduling is available)

Required behaviors:
- Deep link into the app to the correct surface (invite context or event detail).
- Respect tenant-level notification policies provided by the backend.

## Push Policy Summary (MVP)
- No channel filtering in V1; users receive all push types by default.
- Backend uses server-side fan‑out for event reminders and favorites audiences.

---

## B) Backend Requirements

### B1) Device registration
- [ ] ⚪ Implement `POST /api/v1/push/register`:
  - [ ] ⚪ accept `{ device_id, platform, push_token }`
  - [ ] ⚪ associate token with authenticated user + tenant
- [ ] ⚪ Optional `DELETE /api/v1/push/unregister`
- [ ] ⚪ Handle token rotation idempotently

### B2) Notification policies (tenant settings)
- [ ] ⚪ Return which notification categories are enabled and any throttles (tenant settings)
- [ ] ⚪ Keep backend authoritative; Flutter should not implement quota rules beyond UX

### B3) Notification payload contract (deep linking)
Payload must include enough data to route:
- `tenant_id`
- `type`: `invite_received | event_reminder | invite_status_changed | ...`
- `event_id` (if applicable)
- `invite_id` or `invite_code` (if applicable)
- optional `inviter_principal` summary for display

---

## C) Flutter Requirements

### C1) Push bootstrap
- [ ] ⚪ Register token on startup/login, and re-register on rotation
- [ ] ⚪ Route notification taps into:
  - [ ] ⚪ invite flow (received invites)
  - [ ] ⚪ event detail (event reminders)

### C2) UX
- [ ] ⚪ If user is already on the target event, update in-place state rather than pushing duplicate routes

---

## D) Mixpanel Requirements

### D1) Initialization
- [ ] ⚪ Prefer backend-provided configuration (tenant-aware token/keys)
- [ ] ⚪ Plan anonymous-to-authenticated identity stitching (even if deferred)

### D2) Event taxonomy (minimum)
- [ ] ⚪ Track invites funnel:
  - [ ] ⚪ `invite_received`
  - [ ] ⚪ `invite_opened`
  - [ ] ⚪ `invite_accept_selected_inviter`
  - [ ] ⚪ `invite_accepted`
  - [ ] ⚪ `invite_declined`
- [ ] ⚪ Track events funnel:
  - [ ] ⚪ `event_opened`
  - [ ] ⚪ `event_confirmed_presence`
- [ ] ⚪ Track discovery/navigation:
  - [ ] ⚪ `map_opened`
  - [ ] ⚪ `poi_opened`
  - [ ] ⚪ `favorite_artist_toggled`

### D2.1) Trigger moments (must define)
- [ ] ⚪ Define when each Mixpanel event fires (screen load, CTA tap, success response).
- [ ] ⚪ Confirm source of truth for invite acceptance events (client vs backend).
- [ ] ⚪ Confirm event detail open trigger (screen first paint vs data loaded).

### D3) Required properties (attach when available)
- [ ] ⚪ Include required properties (when available):
  - `tenant_id` (always)
  - `user_id` (when authenticated)
  - `event_id` (when applicable)
  - `inviter_kind` + `inviter_id` (when applicable)
  - `partner_id` (when applicable)
  - `source` (screen/route name)

---

## E) Acceptance Criteria

- [ ] ⚪ Invite received push arrives and routes correctly into the app
- [ ] ⚪ Mixpanel shows end-to-end invite funnel with consistent identifiers
