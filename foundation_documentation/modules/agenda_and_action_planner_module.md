# Documentation: Agenda & Action Planner Module

**Version:** 1.0  
**Date:** February 28, 2025  
**Authors:** Delphi (Belluga Co-Engineering)

## 1. Overview

The Agenda & Action Planner module (MOD-303) tracks every upcoming experience, booking, and social action for Guar[APP]ari users. It consolidates offers claimed from Map, invites accepted from the social loop, and booking/payment lifecycle events into a chronological stream delivered by `/v1/app/agenda`. Dedicated follow-up tasks and reminder payloads are authored by the Task & Reminder module and surface here only as read-only references when they represent a dated commitment.

---

## 2. Architectural Tenets

1. **Timeline as the Source of Truth:** Agenda entries are modeled as immutable `timeline_nodes`. Each node references a `context_document` describing the originating entity (POI booking, invite, partner reminder reference). Mutations append new nodes instead of updating in place so history remains auditable.
2. **Action Contract Standardization:** Every actionable item surfaces the same action schema (`ActionDescriptor`) with verbs (`confirm`, `share`, `navigate`, `chat`) and CTA payloads. Flutter controllers bind directly to these descriptors, eliminating UI branching logic.
3. **State Derivation:** `agenda_states` documents hold derived state (e.g., upcoming_count, overdue_count) for fast reads. They are rebuilt asynchronously from events rather than mutated procedurally.
4. **Calendar-Ready Segmentation:** Entries are partitioned by day and by semantic `channel` (experiences, logistics, social) so we can sync to native calendars without extra mapping later.

---

## 3. Data Model

### 3.1 `timeline_nodes`
```json
{
  "_id": "ObjectId()",
  "tenant_id": "ObjectId()",
  "user_id": "ObjectId()",
  "channel": "String",
  "title": "String",
  "subtitle": "String",
  "starts_at": "Date",
  "ends_at": "Date",
  "status": "String",
  "context_document": {
    "type": "String",
    "reference_id": "String",
    "payload": {}
  },
  "actions": [
    {
      "action_type": "String",
      "label": "String",
      "target_payload": {},
      "requires_confirmation": "Boolean"
    }
  ],
  "metadata": {},
  "created_at": "Date"
}
```
`channel` ∈ {`experiences`, `logistics`, `social`, `commerce`}. `status` ∈ {`upcoming`, `in_progress`, `done`, `cancelled`}.

### 3.2 `agenda_states`
```json
{
  "_id": "ObjectId()",
  "tenant_id": "ObjectId()",
  "user_id": "ObjectId()",
  "summary`: {
    "upcoming_count": "Number",
    "overdue_count": "Number",
    "actionable_count": "Number"
  },
  "last_refreshed_at": "Date"
}
```

### 3.3 `action_audit_log`
Stores every user action triggered from an agenda card for observability and compliance.

---

## 3.4 Client Event Payload (Agenda API)
Agenda surfaces events as a paged list; Flutter consumes this shape for cards, invites, and chips.

**Request (paged list)**
- Query: `page` (int), `page_size` (int), `past_only` (bool), `search` (string), `categories[]`, `tags[]`, `taxonomy[]`, `origin_lat`, `origin_lng`, `max_distance_meters`, `confirmed_only` (bool).

**Response**
```json
{
  "items": [
    {
      "id": "string",
      "slug": "string",
      "type": {
        "id": "string",
        "name": "string",
        "slug": "string",
        "description": "string",
        "icon": "string?",
        "color": "#RRGGBB?"
      },
      "title": "string",
      "content": "string",
      "location": "string",
      "venue": {
        "id": "string",
        "display_name": "string",
        "tagline": "string?",
        "hero_image_url": "string?",
        "logo_url": "string?",
        "taxonomy_terms": [{ "type": "string", "value": "string" }]
      },
      "latitude": 0.0,
      "longitude": 0.0,
      "thumb": { "type": "image", "data": { "url": "string" } },
      "date_time_start": "2025-01-01T00:00:00Z",
      "date_time_end": "2025-01-01T00:00:00Z?",
      "artists": [
        { "id": "string", "name": "string", "avatar_url": "string (optional)", "highlight": false, "genres": ["string"] }
      ],
      "participants": [
        {
          "partner": {
            "id": "string",
            "display_name": "string",
            "tagline": "string?",
            "hero_image_url": "string?",
            "logo_url": "string?",
            "taxonomy_terms": [{ "type": "string", "value": "string" }]
          },
          "role": "string",
          "is_highlight": false
        }
      ],
      "actions": [ /* CTA descriptors, unchanged */ ],
      "is_confirmed": false,
      "total_confirmed": 0,
      "received_invites": [ /* invite DTOs */ ],
      "sent_invites": [ /* sent invite status DTOs */ ],
      "friends_going": [ /* lightweight friend resumes */ ],
      "tags": ["string"]
    }
  ],
  "has_more": true
}
```

**Display rule:** chips use `event.tags` if provided; otherwise aggregate all `artists[*].genres`; if both are empty, show no chips. Artists list itself may be empty.

### Field Definitions
- `thumb.type` ∈ {`image`}

---

## 4. Interfaces

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/app/agenda` | GET | Returns grouped timeline nodes plus derived counts. |

**Deferred (post-MVP):** `/v1/app/agenda/{nodeId}/action`, `/v1/app/agenda/sync`.

**Events**
* Inbound: `booking.confirmed`, `booking.cancelled`, `invite.accepted`, `poi.favorite.added`, `task.reminder.scheduled`.
* Outbound: `agenda.node.created`, `agenda.action.completed`, `agenda.state.updated`.

---

## 5. Dependencies

* **Map & POI Module:** Provides event payloads for bookings and location reminders.
* **Invite & Social Loop:** Supplies accepted invites and share follow-ups.
* **External Commercial Engine:** Adds payment confirmation events when bookings convert to paid transactions.
* **Task & Reminder Module:** Publishes reminder references when tasks carry concrete schedule anchors that must appear on the agenda timeline.

---

## 6. Roadmap

1. **FCX-02:** Mocked agenda repository feeding Flutter controllers using static JSON snapshots.
2. **Phase 6:** Introduce favorites/personalization, linking timeline nodes to saved POIs.
3. **Phase 11:** Attach privacy and invite-status halos, reusing derived state to toggle exposure levels.
