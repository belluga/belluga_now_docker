# Documentation: Task & Reminder Orchestration Module

**Version:** 1.0  
**Date:** February 28, 2025  
**Authors:** Delphi (Belluga Co-Engineering)

## 1. Overview

The Task & Reminder Orchestration module (MOD-306) governs every follow-up obligation a tenant app user must complete after interacting with partners, invites, or bookings. It centralizes reminder authoring, schedules push notifications, and emits dated references so downstream modules—such as Agenda & Action Planner or analytics pipelines—stay in sync without duplicating logic. The module serves both mocked flows (local JSON + simulated push) and the future multi-tenant backend.

---

## 2. Design Principles

1. **Obligation Isolation:** Tasks are modeled independently from bookings or invites. Producers emit semantic intents (e.g., “confirm attendance,” “share itinerary”), and this module translates them into actionable reminders with lifecycle tracking.
2. **Push-First Delivery:** Every task can schedule one or more push notifications or in-app banners. Delivery windows, quiet hours, and retry policies live here so other modules simply consume the resulting events. Check-in reminders leverage the same infrastructure by emitting `invite.checkin` intents that include geofence metadata (when available) so the client can deep link to attendance flows.
3. **Idempotent Scheduling:** Reminder scheduling is idempotent; repeated intents dedupe by `source_reference` and `reminder_type`. State transitions append immutable history rows instead of mutating the base task document.
4. **Role Awareness:** Tasks respect user roles (tenant, partner, promoter). The module enforces which channels can reach which persona to prevent cross-scope leakage.

---

## 3. Data Model

### 3.1 `tasks`
```json
{
  "_id": "ObjectId()",
  "tenant_id": "ObjectId()",
  "user_id": "ObjectId()",
  "role_scope": "String",
  "title": "String",
  "description": "String",
  "reminder_type": "String",
  "source_reference": {
    "type": "String",
    "id": "String"
  },
  "due_at": "Date",
  "status": "String",
  "actions": [
    { "action_type": "String", "label": "String", "target": {} }
  ],
  "created_at": "Date",
  "updated_at": "Date"
}
```
`status` ∈ {`scheduled`, `notified`, `acknowledged`, `completed`, `expired`}. `role_scope` distinguishes which persona should see the task.

### 3.2 `reminder_rules`
Defines automation triggers and escalation windows per reminder type.

### 3.3 `push_delivery_queue`
Immutable log capturing each push notification attempt (`task_id`, `channel`, `payload`, `status`, `attempted_at`, `error`).

### 3.4 `task_history`
Appends events (creation, acknowledgement, completion) for auditability.

---

## 4. Interfaces

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/tasks` | GET | Lists active tasks for the authenticated user persona. |
| `/api/v1/tasks/{taskId}/ack` | POST | Marks a task as acknowledged (dismissed) and cancels pending pushes. |
| `/api/v1/tasks/{taskId}/complete` | POST | Marks completion and emits follow-up events (e.g., to award streaks). |
| `/internal/tasks/intent` | POST | Producer-facing endpoint used by booking, invite, or partner systems to register a new task intent. |

**Push Delivery**
* Uses landlord-managed FCM/APNs topics: `tenant_{tenantId}_user_{userId}`.
* Payload includes `task_id`, `reminder_type`, `cta`, and `deep_link` so Flutter/Laravel clients can route to the relevant surface.

---

## 5. Events

* **Inbound Intents:** `booking.pending_confirmation`, `booking.deposit_pending`, `invite.unshared`, `invite.followup`, `invite.checkin`, `invite.fulfillment.step-required`, `partner.requirement.assigned`, `transaction.refund.pending`. Each intent payload specifies `{ reminder_type, source_reference, due_at }` so scheduling is consistent.
* **Outbound:** 
    * `task.reminder.scheduled` – emitted after deduplication; Agenda subscribes to render dated items.
    * `task.push.sent` – includes `channel`, `attempt`, and `payload_hash` for observability.
    * `task.completed` – fired when `/complete` is called; invite module listens to auto-unsnooze or mark fulfillment steps done.
    * `task.expired` – emitted when due_at passes without completion; Invite module can translate this into `invite.attendance.no-show` or partner escalations.
    * `task.reminder.failed` – emitted if push delivery exhausts retries; Partner Analytics logs these to highlight tasks requiring manual intervention.

---

## 6. Dependencies

* **Agenda & Action Planner:** Displays dated tasks that carry a `due_at`. Receives `task.reminder.scheduled`.
* **Invite & Social Loop / Transaction Bridge / Partner Catalog:** Act as producers by posting intents.
* **Notification Infrastructure:** Relies on landlord push gateway for FCM/APNs fan-out.

---

## 7. Roadmap

1. **FCX-02:** Mock service generating deterministic follow-up tasks with simulated push payloads.
2. **Phase 6:** Tie personalization rules into reminder scheduling (e.g., only remind users who favorited the partner).
3. **Phase 8:** Emit gamification events (streaks, points) when tasks are completed on time.
4. **Phase 13:** Extend to notification multiplexing (email/SMS) while keeping the same task schema.
