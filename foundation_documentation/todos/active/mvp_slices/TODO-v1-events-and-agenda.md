# TODO (V1): Events & Agenda (Browse, Detail, Presence)

**Status legend:** `- [ ] ⚪ Pending` · `- [ ] 🟡 Provisional` · `- [x] ✅ Production‑Ready`.
**Status:** Active  
**Owners:** Backend Team + Delphi (Flutter)  
**Objective:** Deliver the core events experience: browse/search, event detail, invite flows, and presence confirmation.

---

## References
- `foundation_documentation/todos/active/mvp_slices/TODO-v1-first-release.md`
- `foundation_documentation/todos/active/mvp_slices/TODO-v1-invites-implementation.md`
- `foundation_documentation/system_roadmap.md`

---

## A) Backend Tasks

### A1) Agenda/events endpoints (MOD-201)
- [ ] ⚪ Ensure `/v1/app/agenda` contract is implemented or mocked as defined in `foundation_documentation/system_roadmap.md`
- [ ] ⚪ Ensure event detail includes:
  - [ ] ⚪ `event_id`, `slug`
  - [ ] ⚪ `start_at`, `end_at` (or duration)
  - [ ] ⚪ venue + artists references (partner ids when available)
  - [ ] ⚪ invite-related context (if needed for UI)

### A2) Presence confirmation
- [ ] ⚪ Confirm presence endpoint `/v1/app/events/{event_id}/check-in` (mock or implemented)
- [ ] ⚪ Ensure responses update confirmed/presence state deterministically

---

## B) Flutter Tasks

### B1) Browse/search
- [ ] ⚪ Events list/search works end-to-end (paged, filters, past toggle where supported)

### B2) Event detail
- [ ] ⚪ Event detail renders venue + artists summaries
- [ ] ⚪ Invite actions available (send/accept/decline) with credited acceptance selector (from invites TODO)
- [ ] ⚪ Confirm presence flow available and updates UI state

---

## C) Acceptance Criteria

- [ ] ⚪ Users can browse events, open event detail, and confirm presence
- [ ] ⚪ Invite actions are available from event detail and do not duplicate invites

