# Documentation: Invite & Social Loop Module

**Version:** 1.0  
**Date:** February 28, 2025  
**Authors:** Delphi (Belluga Co-Engineering)

## 1. Overview

The Invite & Social Loop module (MOD-302) governs Guar[APP]ari’s virality engine. It manages invite issuance, referral graph analytics, friend resume projections, and gamified progression that feeds both the tenant app and the partner workspace. The module is built to operate with mocked persistence today while remaining API-compatible with a future backend microservice.

---

## 2. Design Principles

1. **Graph-Native Modeling:** Invites, referrals, and friend relationships are stored as a directed multigraph (`invite_edges`). Every edge carries immutable metadata (source partner, campaign id, channel) so downstream scoring remains deterministic.
2. **Privacy-Respecting Exposure:** Contact metadata is normalized into `friend_resumes` that only include the data points explicitly allowed by each user (display name, avatar, teaser label). The module never leaks raw address book details to other modules.
3. **Progressive Disclosure:** Invite payloads include `contextual_prompts` describing why an invite matters (e.g., “3 friends are attending this gig”). Context is generated from other modules but cached locally to avoid tight coupling.
4. **Event-Driven Incentives:** Rank changes, streaks, or reward unlocks emit events consumed by the Insights Service and Tenant Home Composer. The module does not compute final leaderboards; it only updates counters and emits domain events.
5. **Quota-Aware Monetization:** Invite issuance is tied to partner plans. Every invite maps to a `plan_charge_bucket`, allowing us to invoice or enforce limits according to the partner’s subscription tier.
6. **Automatic Event-Scoped Security:** Invite codes inherit the lifecycle of the underlying experience; when the event expires or a receiver suppresses invitations for that event, tokens are invalidated automatically and cannot be reused.

---

## 3. Data Model

### 3.1 `invite_edges`
```json
{
  "_id": "ObjectId()",
  "tenant_id": "ObjectId()",
  "sender_user_id": "ObjectId()",
  "receiver_user_id": "ObjectId()",
  "invite_code": "String",
  "status": "String",
  "attendance_status": "String",
  "source_partner_id": "ObjectId()",
  "campaign_id": "String",
  "channel": "String",
  "channel_payload": {},
  "plan_charge_bucket": "String",
  "contextual_prompts": [
    { "type": "String", "text": "String", "cta": "String" }
  ],
  "expires_at": "Date",
  "auto_expire_at": "Date",
  "created_at": "Date",
  "updated_at": "Date"
}
```
`status` ∈ {`pending`, `accepted`, `declined`, `expired`, `snoozed`, `suppressed`}. `attendance_status` ∈ {`unknown`, `confirmed`, `no_show`}. `unknown` is the default and represents “attendance not yet reported”. `channel` includes `whatsapp`, `in_app`, `qr`, `link`. `auto_expire_at` is derived from the related event/offer end time so invitations automatically close when the underlying experience has passed. `plan_charge_bucket` ties each invite to the partner plan quota bucket used by billing (e.g., `core`, `premium_boost`), enabling per-plan limits.

### 3.2 `invite_actions`
Captures all user actions performed on an invite entry.
```json
{
  "_id": "ObjectId()",
  "invite_id": "ObjectId()",
  "user_id": "ObjectId()",
  "action": "String",
  "metadata": {},
  "occurred_at": "Date"
}
```

### 3.3 `friend_resumes`
Authoritative resume objects consumed by Flutter domain models.
```json
{
  "_id": "ObjectId()",
  "user_id": "ObjectId()",
  "friend_display_name": "String",
  "avatar_url": "String",
  "match_label": "String",
  "highlight_flags": ["String"],
  "updated_at": "Date"
}
```

### 3.4 Quotas & Throttling Snapshots
To enforce both anti-spam policies and partner plan limits, the module maintains supporting documents:
```json
{
  "_id": "ObjectId()",
  "tenant_id": "ObjectId()",
  "scope_type": "String",
  "scope_reference": "ObjectId()",
  "window": { "duration_minutes": "Number", "started_at": "Date" },
  "max_allowed": "Number",
  "current_count": "Number",
  "plan_charge_bucket": "String",
  "last_violation_at": "Date"
}
```
`scope_type` ∈ {`user_sender`, `partner_plan`}. When `current_count >= max_allowed`, new invites are blocked and the API returns `429` with metadata describing the plan or quota that was exhausted. Violations emit `invite.rate-limited` or `invite.plan-limit-reached` events so Commercial/Partner Analytics modules can track upsell opportunities.

---

## 4. APIs & Events

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/app/invites` | GET | Returns paginated invite feed with friend resumes, contextual prompts, quota status, and suppression flags per event. |
| `/v1/app/invites/{inviteCode}/accept` | POST | Confirms an invite and emits `invite.accepted`. |
| `/v1/app/invites/{inviteCode}/resend` | POST | Rotates share tokens and reissues invite links. |
| `/v1/app/invites/{inviteCode}/snooze` | POST | Marks invite as `snoozed`, emits `invite.snoozed`, and registers a reminder intent. |
| `/v1/app/invites/{inviteCode}/suppress-event` | POST | Blocks future invites for the same event (per receiver) until suppression is lifted. |
| `/v1/app/invites/{inviteCode}/accept/import-contacts` | POST | Shortcut endpoint used immediately after an acceptance to trigger contact import/friend discovery without leaving the invite context. |
| `/v1/app/invites/{inviteCode}/attendance` | POST | Allows invitees to self-report attendance (`confirmed`/`no_show`). Emits `invite.attendance.user-reported`; partner confirmations still override but both signals feed analytics/trust scoring. |

**Events**
* Outbound: `invite.created`, `invite.accepted`, `invite.accepted.contacts-import-triggered`, `invite.fulfillment.step-required`, `invite.fulfillment.step-completed`, `invite.attendance.confirmed`, `invite.attendance.no-show`, `invite.attendance.unconfirmed`, `invite.expired`, `invite.reward-unlocked`, `invite.rate-limited`, `invite.plan-limit-reached`, `invite.snoozed`, `invite.suppressed`.
* Inbound: `user.profile.updated` (refresh resumes), `agenda.action.completed` (to suggest invites tied to actions), `insights.rank.changed`, `task.completed` (so we can auto-unsnooze when reminders convert).
* Analytics/CRM Integration: Every fulfillment intent (`invite.fulfillment.step-required`, e.g., pay deposit, upload document) is mirrored to the Partner Analytics/CRM module along with contact info so partners can track outstanding requirements. When tasks complete, the analytics module receives `invite.fulfillment.step-completed` events (emitted by Transaction Bridge or Task & Reminder). Final conversion is measured via attendance events: `invite.attendance.confirmed` (partner confirms presence or user checks in) and `invite.attendance.no-show`. These events tie back to partner KPIs and invite reward logic.
* Task & Reminder Integration: `invite.snoozed` dispatches a `task.intent` payload `{ source_type: "invite", invite_id, reminder_type: "invite_followup" }` so MOD-306 can schedule pushes. When a user selects “Decide later,” remind them before the invite expires. As the event time approaches, the invite module emits a `task.intent` with `reminder_type: "invite_checkin"` targeting the invitee to confirm attendance or mark a no-show. This “check-in” reminder can carry deep links to the `/attendance` endpoint so users can self-report quickly, while partner confirmations remain authoritative. When the tenant shares venue coordinates, the check-in flow can also request a passive location permission check—if the device reports being within the event geofence at the event time, the module sets `attendance_status = confirmed_geo` and emits `invite.attendance.geo-confirmed`, giving partners extra confidence without manual input. (Flutter reference: `native_geofence` package can be used during mock/prototype stages to monitor entry/exit events while keeping the invite module decoupled from the specific plugin.) Future enhancement: once we unlock partner-to-guest messaging, accepted invitees will be able to opt into push channels—or even lightweight chat rooms—so partners and invite trees can coordinate in real time. That capability is deferred beyond v1 and will reuse the Task/Reminder notification rails with additional consent checks.

---

## 5. Gamification Hooks

* **Streak Engine:** Maintains per-user streak documents with counters for consecutive days of invite engagement. Feeds Phase 8 Gamification Spine.
* **Shareable Badges:** Each accepted invite can mint a badge reference consumed by the Flutter badge component.
* **Leaderboard Source Events:** Emits delta events to the Multidimensional Insights Service with payload `{model_key: "invite_conversion", topic_reference: {type: "user", id: sender_user_id}, metrics: {accepted_invites: 1}}`.

---

## 6. Roadmap Alignment

* FCX-02 wires mocked repositories to this contract.
* Phase 9 extends the module with swipe-style carousels and WhatsApp deep links.
* Partner Workspace fast-follow consumes `invite_edges` to expose referral funnels to partners without duplicating logic. A dedicated Partner Analytics module will aggregate invitation performance per plan, quota bucket, and channel to support billing and upsell strategies.
