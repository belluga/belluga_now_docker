# MVP Endpoint Contracts (Response Schemas)

**Status:** Draft  
**Purpose:** Define the MVP endpoints and the minimum response schemas required so Flutter can mock and backend can implement with the same contract.  
**Scope:** MVP only (partner-issued invites, partner metrics, sponsors POIs are deferred).

---

## 0) Conventions
- Base prefix is `/api/v1` (router-mounted). Paths below omit the prefix.
- All responses include `tenant_id` when the request is tenant-scoped.
- IDs are stable string IDs (Mongo ObjectId as string).
- Date/times are ISO 8601 (`YYYY-MM-DDTHH:mm:ssZ`).
- Home composition is client-side only. There is **no** aggregated `/home-overview` endpoint; use independent requests (e.g., `/invites`, `/agenda` with `confirmed_only=true` for confirmed events, `/partners/discovery`, `/missions`, `/discover/people`, `/discover/curator-content`, `/map/pois`).
- Event list queries **must** treat “happening now” as part of the “upcoming” bucket. This applies to any list surfaced as “upcoming” or “my events” (confirmed).
- Pagination conventions (MVP): **all lists are page-based**.
  - Request: `page` (int, optional), `page_size` or `per_page` (int, optional).
  - Response: `has_more` (bool) for app feeds, or paginator fields for admin lists.
- Distance fields:
  - `distance_meters` is returned when the backend computes distance from an origin (see Map).
  - For non-map lists (agenda/home), include `distance_meters` only when requested; otherwise omit.
- Taxonomy terms are typed pairs: `{ "type": "string", "value": "string" }` (WordPress-style, multi-taxonomy per partner).

---

## 1) Identity + Bootstrap

### `POST /anonymous/identities`
**Purpose:** Create or resume anonymous identity for web/app flows.  
**Request (body):**
```json
{
  "device_name": "string",
  "fingerprint": {
    "hash": "string",
    "user_agent": "string?",
    "locale": "string?"
  },
  "metadata": {}
}
```
**Response:**
```json
{
  "data": {
    "user_id": "string",
    "identity_state": "anonymous",
    "token": "string",
    "abilities": ["string"],
    "expires_at": "2025-01-01T00:00:00Z"
  }
}
```
**Field Definitions**
- `identity_state`: `anonymous`.

### `GET /environment` (root or tenant subdomain)
**Purpose:** Resolve landlord/tenant context + branding.  
**Request (query):** `app_domain`, `domain`, `subdomain` (all optional).  
**Tenant resolution:** App calls the configured tenant domain directly. Web resolves by the request host domain. Root-level usage is optional for discovery/lookup flows.
**Response (minimum):**
```json
{
  "type": "landlord|tenant",
  "tenant_id": "string?",
  "name": "string",
  "subdomain": "string?",
  "main_domain": "string",
  "domains": ["string"],
  "app_domains": ["string"],
  "theme_data_settings": {
    "primary_seed_color": "#RRGGBB",
    "secondary_seed_color": "#RRGGBB",
    "brightness_default": "light|dark"
  }
}
```
**Field Definitions**
- `type`: `landlord`, `tenant`.
- `theme_data_settings.brightness_default`: `light`, `dark`.

**Branding assets:** use default paths `GET /logo-light.png`, `/logo-dark.png`, `/icon-light.png`, `/icon-dark.png` (no direct URLs in this payload).

---

## 2) Home + Discovery

### `GET /me`
**Purpose:** Authenticated profile summary + role claims.  
**Response:**
```json
{
  "tenant_id": "string",
  "data": {
    "user_id": "string",
    "display_name": "string",
    "avatar_url": "string?",
    "user_level": "basic|verified",
    "privacy_mode": "public|friends_only",
    "social_score": {
      "invites_accepted": 0,
      "presences_confirmed": 0,
      "rank_label": "string?"
    },
    "counters": {
      "pending_invites": 0,
      "confirmed_events": 0,
      "favorites": 0
    },
    "role_claims": {
      "is_partner": false,
      "is_curator": false,
      "is_verified": false
    }
  }
}
```
**Field Definitions**
- `user_level`: `basic`, `verified`.
- `privacy_mode`: `public`, `friends_only`.

---

## 3) Invites (User-to-User)

### `GET /invites/stream` (SSE)
**Purpose:** Stream invite changes (SSE).  
**Request (query):** same pagination filters as `/invites` (`page`, `page_size`); stream applies to the authenticated user.  
**Event types:**
- `invite.created`
- `invite.updated`
- `invite.deleted`
**Payload (minimum):**
```json
{ "invite_id": "string", "type": "invite.created|invite.updated|invite.deleted", "updated_at": "2025-01-01T00:00:00Z" }
```

### `GET /invites`
**Purpose:** Invites feed and referral context.  
**Request (query):**
- `page` (optional)
- `page_size` (optional)
**Response (minimum):**
```json
{
  "tenant_id": "string",
  "invites": [
    {
      "id": "string",
      "event_id": "string",
      "event_name": "string",
      "event_date": "2025-01-01T00:00:00Z",
      "event_image_url": "string",
      "location": "string",
      "host_name": "string",
      "message": "string",
      "tags": ["string"],
      "inviter_name": "string?",
      "inviter_avatar_url": "string?",
      "additional_inviters": ["string"]
    }
  ],
  "has_more": true
}
```

### `GET /invites/settings`
**Purpose:** Invite quotas + UX messaging limits.  
**Response:**
```json
{
  "tenant_id": "string",
  "limits": {
    "pending_limit_basic": 20,
    "pending_limit_verified": 50,
    "pending_limit_partner_paid": 100,
    "per_event_invite_limit": 1
  },
  "cooldowns": {
    "share_code_cooldown_seconds": 0
  },
  "reset_at": "2025-01-01T00:00:00Z?",
  "over_quota_message": "string?"
}
```

### `POST /invites/share`
**Purpose:** Create share code for invite attribution.  
**Request (body):**
```json
{ "event_id": "string" }
```
**Response (minimum):**
```json
{
  "tenant_id": "string",
  "code": "string",
  "event_id": "string",
  "inviter_principal": { "kind": "user|partner", "id": "string" }
}
```
**Field Definitions**
- `inviter_principal.kind`: `user`, `partner`.
**Implementation Notes (Uniqueness):**
- `code` must be unique per tenant. Enforce a unique index on `(tenant_id, code)` (or global unique if tenant scope is not used).
- Generate URL-safe codes (base62/ULID/short hash). Recommended length ≥ 8–10 chars.
- On insert conflict, retry generation (e.g., up to 3–5 attempts) before failing.

### `POST /invites/share/{code}/accept`
**Purpose:** Accept invite from web landing by code.  
**Request (headers/body):** Auth via Sanctum (anonymous identity). No body required.  
**Response:**
```json
{
  "tenant_id": "string",
  "invite_id": "string",
  "event_id": "string",
  "inviter_principal": { "kind": "user|partner", "id": "string" },
  "status": "accepted|declined|already_accepted|expired",
  "attribution_bound": true,
  "accepted_at": "2025-01-01T00:00:00Z?"
}
```
**Field Definitions**
- `inviter_principal.kind`: `user`, `partner`.
- `status`: `accepted`, `declined`, `already_accepted`, `expired`.

**Requirement:** Invite share links must carry `code` as a GET parameter.
**Tracking Notes:**
- `share_visit` is tracked separately from invites; it does **not** count as an accepted invite.
- When an acceptance occurs via this endpoint, it **does** count as `invite_accepted` with `source = share_url`.

#### Invite Flow & Friends Management (MVP)
- **Primary invite paths:**
  - **Direct invite (existing user):** server creates a per-recipient invite and sends push. Source = `direct_invite`.
  - **Share link:** server issues a `code` via `POST /invites/share`; no per-recipient record until acceptance. Source = `share_url`.
- **Acceptance rules:** only one accepted invite per invitee per event. Acceptances should bind attribution to the inviter principal.
- **Tracking:** `share_visit` is analytics-only. `invite_sent` and `invite_accepted` should include a `source` (`direct_invite`, `share_url`).
- **Friends (MVP):** no social graph. “Friends” are matched contacts from hashed imports only; raw PII is never stored.
- **Delivery fallback:** if a contact hash matches an existing user, send push; if no match, use a share URL (e.g., WhatsApp deep link) with the invite `code`.

### `POST /contacts/import`
**Purpose:** Import hashed contacts for friend suggestions and invite matching.  
**Request (body):**
```json
{
  "contacts": [
    { "type": "phone|email", "hash": "string" }
  ],
  "salt_version": "string?"
}
```
**Response:**
```json
{
  "tenant_id": "string",
  "matches": [
    {
      "contact_hash": "string",
      "type": "phone|email",
      "user_id": "string",
      "display_name": "string?",
      "avatar_url": "string?"
    }
  ],
  "unmatched_count": 0
}
```
**Field Definitions**
- `contacts[].type`: `phone`, `email`.
- `matches[].type`: `phone`, `email`.

---

## 4) Events + Agenda

### `GET /events/stream` (SSE)
**Purpose:** Stream event changes for active app filters (SSE).  
**Request (query):** same filters as `/agenda` (`search`, `categories[]`, `tags[]`, `taxonomy[]`, `confirmed_only`, `origin_lat`, `origin_lng`, `max_distance_meters`).  
**Event types:**
- `event.created` (new event matches filters)
- `event.updated` (fields changed)
- `event.deleted` (event removed)
**Payload (minimum):**
```json
{ "event_id": "string", "type": "event.created|event.updated|event.deleted", "updated_at": "2025-01-01T00:00:00Z" }
```

### `GET /agenda`
**Purpose:** Paged agenda feed.  
**Request (query):**
```json
{
  "page": 1,
  "page_size": 10,
  "past_only": false,
  "search": "string?",
  "categories": ["string"],
  "tags": ["string"],
  "taxonomy": [{ "type": "string", "value": "string" }],
  "origin_lat": 0.0,
  "origin_lng": 0.0,
  "max_distance_meters": 100000,
  "confirmed_only": false
}
```
**Notes (mock behavior):**
- `past_only=false` returns upcoming events **plus** events happening now.
- `past_only=true` returns events that started before now **and are not happening now**.
- "Happening now" means `date_time_start <= now < date_time_end`. If `date_time_end` is missing, assume `date_time_start + 3h`.
- `confirmed_only=true` returns only events confirmed by the current user (includes “happening now” using the same rule above).
- Sort order: upcoming/now ascending by `date_time_start`, past descending by `date_time_start`.
- Search matches `title`, `content`, or any `artists[].name` (case-insensitive).
- Categories filter matches `type.slug` or event categories when available (case-insensitive).
- Tags filter matches any `tags[]` on the event (case-insensitive).
- Taxonomy filter matches any `taxonomy_terms` attached to the venue or participants (case-insensitive).
- If `origin_lat`/`origin_lng` are provided, filter within `max_distance_meters` (default 50000); if no matches, fall back to the unfiltered list.

**Response (minimum):**
```json
{
  "tenant_id": "string",
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
        { "id": "string", "name": "string", "avatar_url": "string?", "highlight": false, "genres": ["string"] }
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
      "actions": [
        {
          "id": "string?",
          "label": "string",
          "open_in": "external|inApp",
          "color": "#RRGGBB?",
          "item_type": "string?",
          "item_id": "string?",
          "external_url": "string?",
          "message": "string?"
        }
      ],
      "is_confirmed": false,
      "total_confirmed": 0,
      "received_invites": [
        {
          "id": "string",
          "event_id": "string",
          "event_name": "string",
          "event_date": "2025-01-01T00:00:00Z",
          "event_image_url": "string",
          "location": "string",
          "host_name": "string",
          "message": "string",
          "tags": ["string"],
          "inviter_name": "string?",
          "inviter_avatar_url": "string?",
          "additional_inviters": ["string"]
        }
      ],
      "sent_invites": [
        {
          "friend": { "id": "string", "display_name": "string", "avatar_url": "string?" },
          "status": "pending|accepted|declined|viewed",
          "sent_at": "2025-01-01T00:00:00Z",
          "responded_at": "2025-01-01T00:00:00Z?"
        }
      ],
      "friends_going": [
        { "id": "string", "display_name": "string", "avatar_url": "string?" }
      ],
      "tags": ["string"]
    }
  ],
  "has_more": true
}
```
**Field Definitions**
- `thumb.type`: `image`.
- `actions[].open_in`: `external`, `inApp`.
- `sent_invites[].status`: `pending`, `accepted`, `declined`, `viewed`.

### `GET /events/{event_id}`
**Purpose:** Event detail.  
**Response:**
```json
{
  "tenant_id": "string",
  "data": {
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
    "tags": ["string"],
    "artists": [
      { "id": "string", "name": "string", "avatar_url": "string?", "highlight": false, "genres": ["string"] }
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
    "actions": [
      {
        "id": "string?",
        "label": "string",
        "open_in": "external|inApp",
        "color": "#RRGGBB?",
        "item_type": "string?",
        "item_id": "string?",
        "external_url": "string?",
        "message": "string?"
      }
    ],
    "is_confirmed": false,
    "total_confirmed": 0,
    "received_invites": [
      {
        "id": "string",
        "event_id": "string",
        "event_name": "string",
        "event_date": "2025-01-01T00:00:00Z",
        "event_image_url": "string",
        "location": "string",
        "host_name": "string",
        "message": "string",
        "tags": ["string"],
        "inviter_name": "string?",
        "inviter_avatar_url": "string?",
        "additional_inviters": ["string"]
      }
    ],
    "sent_invites": [
      {
        "friend": { "id": "string", "display_name": "string", "avatar_url": "string?" },
        "status": "pending|accepted|declined|viewed",
        "sent_at": "2025-01-01T00:00:00Z",
        "responded_at": "2025-01-01T00:00:00Z?"
      }
    ],
    "friends_going": [
      { "id": "string", "display_name": "string", "avatar_url": "string?" }
    ]
  }
}
```
**Field Definitions**
- `thumb.type`: `image`.
- `actions[].open_in`: `external`, `inApp`.
- `sent_invites[].status`: `pending`, `accepted`, `declined`, `viewed`.

### `POST /events/{event_id}/check-in`
**Purpose:** Presence confirmation.  
**Response:**
```json
{
  "tenant_id": "string",
  "event_id": "string",
  "presence_status": "confirmed|no_show",
  "check_in_method": "geofence|qr|staff_manual",
  "confirmed_at": "2025-01-01T00:00:00Z"
}
```
**Field Definitions**
- `presence_status`: `confirmed`, `no_show`.
- `check_in_method`: `geofence`, `qr`, `staff_manual`.

---

## 5) Map + POIs

### `GET /map/pois/stream` (SSE)
**Purpose:** Stream POI changes for the active map viewport/filters.  
**Request (query):** same as `/map/pois` (`viewport`, `categories[]`, `tags[]`, `taxonomy[]`, `search`, `origin_lat`, `origin_lng`, `max_distance_meters`).  
**Event types:**
- `poi.created` (new POI matches filters)
- `poi.updated` (fields changed)
- `poi.deleted` (POI removed)
**Payload (minimum):**
```json
{ "ref_type": "event|account|static_asset", "ref_id": "string", "type": "poi.created|poi.updated|poi.deleted", "updated_at": "2025-01-01T00:00:00Z" }
```

### `GET /map/pois`
**Purpose:** Map POIs from projection (`map_pois`).  
**Request (query):**
```json
{
  "viewport": { "north": 0.0, "south": 0.0, "east": 0.0, "west": 0.0 },
  "origin_lat": 0.0,
  "origin_lng": 0.0,
  "max_distance_meters": 100000,
  "categories": ["culture"],
  "tags": ["string"],
  "taxonomy": [{ "type": "string", "value": "string" }],
  "search": "string?",
  "sort": "priority|distance|time_to_event"
}
```
**Field Definitions**
- `categories[]`: `culture`, `beach`, `nature`, `historic`, `restaurant`.
- `sort`: `priority`, `distance`, `time_to_event`.

**Notes:**
- Pagination is page-based elsewhere; map queries rely on viewport + radius rather than explicit item limits.
**Response (minimum):**
```json
{
  "tenant_id": "string",
  "items": [
    {
      "ref_type": "event|account|static_asset",
      "ref_id": "string",
      "category": "culture|beach|nature|historic|restaurant",
      "tags": ["string"],
      "taxonomy_terms": [{ "type": "string", "value": "string" }],
      "location": { "lat": 0.0, "lng": 0.0 },
      "time_anchor_at": "2025-01-01T00:00:00Z",
      "distance_meters": 0
    }
  ]
}
```
**Field Definitions**
- `ref_type`: `event`, `account`, `static_asset`.
- `category`: `culture`, `beach`, `nature`, `historic`, `restaurant`.
- `taxonomy_terms[]`: typed pairs `{type, value}` attached to the POI for filtering.

### `GET /map/filters`
**Purpose:** Server-defined filter catalog.  
**Response:**
```json
{
  "tenant_id": "string",
  "categories": [
    { "key": "culture", "label": "string", "count": 0 }
  ],
  "tags": [
    { "key": "string", "label": "string", "count": 0 }
  ],
  "taxonomy_terms": [
    { "type": "string", "value": "string", "label": "string", "count": 0 }
  ]
}
```
**Field Definitions**
- `categories[].key`: `culture`, `beach`, `nature`, `historic`, `restaurant`.
- `taxonomy_terms[].type`: taxonomy group slug (e.g., `cuisine`, `music_genre`, `vibe`).

---

## 6) Push

### `POST /push/register`
**Purpose:** Register device token.  
**Request:**
```json
{ "device_id": "string", "platform": "ios|android|web", "push_token": "string" }
```
**Field Definitions**
- `platform`: `ios`, `android`, `web`.
**Implementation Notes (Multi-device):**
- A single user may register multiple devices. Store tokens per `device_id` (upsert by `device_id`).
- Do **not** overwrite other devices when a new device registers.
**Notification Targeting (MVP):**
- **Event audience:** use server-side fan-out to all users with confirmed presence for the event.
- **Favorites audience:** use server-side fan-out to users who favorited the account/artist/venue.
- **Invites:** direct device push to recipient users; do not rely on event topics.
**User Preferences (MVP):**
- Users receive all push types by default. Preference filtering is deferred to later versions.
**Future (Partner/Account push):**
- Partners can target audiences they own (e.g., their followers/favorites, confirmed attendees) via server-side fan-out with permission checks.

**Response:**
```json
{ "tenant_id": "string", "ok": true }
```

---

## 7) Tenant/Admin Area (Authenticated)

**Admin routing:** endpoints in this section are served by the tenant/admin route file (no `/admin` prefix). Keep admin vs app separation by **route file**, not path prefix.

### Account + Partner Data Strategy (MVP Decision)
- **Account** stays generic (core boilerplate model).
- **Partner** is a first-class domain model, stored separately and linked 1:1 to `account_id`.
- **Discovery** should be served by a MongoDB aggregation that joins Account + Partner and returns a **Discovery DTO** (not the core models), enabling filters (tags/type/search) without polluting the base Account.
- **Auth Policy (Upstream):** wildcard (`*`) abilities are prohibited for tenant/app tokens; abilities must be explicit. This must be implemented in the upstream Laravel core and then merged into this project.
- **Boilerplate extensibility (explicit instruction):** the boilerplate may include `ConcreteAccount` / `ConcretePartner` as **examples only**. Every project **must replace** these with its own domain models and **must not ship** the boilerplate examples as-is. The project implementation must define a `PartnerModel` as a **sibling** to `AccountAbstract` (1:1 by `account_id`), not a child or extension of the boilerplate concrete model.
- **Project routes (explicit instruction):** create project-specific route files (e.g., `routes/api/project_api_v1.php`) and register only those for the project runtime. Do **not** expose boilerplate CRUD routes in the project API surface.

### `GET /accounts`
**Purpose:** List accounts (including unmanaged).  
**Pagination:** Page-based (`page`, `per_page`); no cursor.
**Response:**
```json
{
  "tenant_id": "string",
  "data": [
    {
      "account_id": "string",
      "name": "string",
      "type": "artist|venue|restaurant|culture|other",
      "category": "string?",
      "tags": ["string"],
      "location": { "lat": 0.0, "lng": 0.0 },
      "is_managed": false,
      "linked_user_id": "string?",
      "updated_at": "2025-01-01T00:00:00Z",
      "created_at": "2025-01-01T00:00:00Z"
    }
  ],
  "current_page": 1,
  "last_page": 1,
  "per_page": 15,
  "total": 0
}
```
**Field Definitions**
- `type`: `artist`, `venue`, `restaurant`, `culture`, `other`.

### `POST /accounts`
**Purpose:** Create account.  
**Request (body):**
```json
{
  "name": "string",
  "document": {
    "type": "cpf|cnpj",
    "number": "string"
  }
}
```
**Field Definitions**
- `document.type`: `cpf`, `cnpj`.

**Response:**
```json
{
  "tenant_id": "string",
  "data": {
    "account_id": "string",
    "name": "string",
    "document": {
      "type": "cpf|cnpj",
      "number": "string"
    },
    "updated_at": "2025-01-01T00:00:00Z",
    "created_at": "2025-01-01T00:00:00Z"
  }
}
```
**Field Definitions**
- `document.type`: `cpf`, `cnpj`.

### `PATCH /accounts/{account_id}`
**Purpose:** Update account details.  
**Request (body):** same fields as create (partial).  
**Response:**
```json
{
  "tenant_id": "string",
  "data": {
    "account_id": "string",
    "name": "string",
    "document": {
      "type": "cpf|cnpj",
      "number": "string"
    },
    "updated_at": "2025-01-01T00:00:00Z",
    "created_at": "2025-01-01T00:00:00Z"
  }
}
```
**Field Definitions**
- `document.type`: `cpf`, `cnpj`.

### `GET /assets`
**Purpose:** List StaticAssets.  
**Response:**
```json
{
  "tenant_id": "string",
  "data": [
    {
      "asset_id": "string",
      "name": "string",
      "category": "culture|beach|nature|historic|restaurant",
      "tags": ["string"],
      "description": "string?",
      "thumbnail_url": "string?",
      "location": { "lat": 0.0, "lng": 0.0 },
      "updated_at": "2025-01-01T00:00:00Z",
      "created_at": "2025-01-01T00:00:00Z"
    }
  ],
  "current_page": 1,
  "last_page": 1,
  "per_page": 15,
  "total": 0
}
```
**Field Definitions**
- `category`: `culture`, `beach`, `nature`, `historic`, `restaurant`.

### `GET /assets/{asset_id}`
**Purpose:** Fetch a single StaticAsset by id.  
**Response:**
```json
{
  "tenant_id": "string",
  "data": {
    "asset_id": "string",
    "name": "string",
    "category": "culture|beach|nature|historic|restaurant",
    "tags": ["string"],
    "description": "string?",
    "thumbnail_url": "string?",
    "location": { "lat": 0.0, "lng": 0.0 },
    "updated_at": "2025-01-01T00:00:00Z",
    "created_at": "2025-01-01T00:00:00Z"
  }
}
```
**Field Definitions**
- `category`: `culture`, `beach`, `nature`, `historic`, `restaurant`.

### `POST /assets`
**Purpose:** Create StaticAsset.  
**Request (body):**
```json
{
  "name": "string",
  "category": "culture|beach|nature|historic|restaurant",
  "tags": ["string"],
  "description": "string?",
  "thumbnail_url": "string?",
  "location": { "lat": 0.0, "lng": 0.0 }
}
```
**Field Definitions**
- `category`: `culture`, `beach`, `nature`, `historic`, `restaurant`.

**Response:**
```json
{
  "tenant_id": "string",
  "data": {
    "asset_id": "string",
    "name": "string",
    "category": "culture|beach|nature|historic|restaurant",
    "tags": ["string"],
    "description": "string?",
    "thumbnail_url": "string?",
    "location": { "lat": 0.0, "lng": 0.0 },
    "updated_at": "2025-01-01T00:00:00Z",
    "created_at": "2025-01-01T00:00:00Z"
  }
}
```
**Field Definitions**
- `category`: `culture`, `beach`, `nature`, `historic`, `restaurant`.

### `PATCH /assets/{asset_id}`
**Purpose:** Update StaticAsset.  
**Request (body):** same fields as create (partial).  
**Response:**
```json
{
  "tenant_id": "string",
  "data": {
    "asset_id": "string",
    "name": "string",
    "category": "culture|beach|nature|historic|restaurant",
    "tags": ["string"],
    "description": "string?",
    "thumbnail_url": "string?",
    "location": { "lat": 0.0, "lng": 0.0 },
    "updated_at": "2025-01-01T00:00:00Z",
    "created_at": "2025-01-01T00:00:00Z"
  }
}
```
**Field Definitions**
- `category`: `culture`, `beach`, `nature`, `historic`, `restaurant`.

### `GET /events`
**Purpose:** List events (tenant scope).  
**Response:**
```json
{
  "tenant_id": "string",
  "data": [
    {
      "event_id": "string",
      "title": "string",
      "start_at": "2025-01-01T00:00:00Z",
      "end_at": "2025-01-01T00:00:00Z",
      "venue_account_id": "string",
      "artist_account_ids": ["string"],
      "location": { "lat": 0.0, "lng": 0.0 },
      "updated_at": "2025-01-01T00:00:00Z",
      "created_at": "2025-01-01T00:00:00Z"
    }
  ],
  "current_page": 1,
  "last_page": 1,
  "per_page": 15,
  "total": 0
}
```

### `POST /events`
**Purpose:** Create event.  
**Request (body):**
```json
{
  "title": "string",
  "start_at": "2025-01-01T00:00:00Z",
  "end_at": "2025-01-01T00:00:00Z",
  "venue_account_id": "string",
  "artist_account_ids": ["string"],
  "location": { "lat": 0.0, "lng": 0.0 }
}
```
**Response:**
```json
{
  "tenant_id": "string",
  "data": {
    "event_id": "string",
    "title": "string",
    "start_at": "2025-01-01T00:00:00Z",
    "end_at": "2025-01-01T00:00:00Z",
    "venue_account_id": "string",
    "artist_account_ids": ["string"],
    "location": { "lat": 0.0, "lng": 0.0 },
    "updated_at": "2025-01-01T00:00:00Z",
    "created_at": "2025-01-01T00:00:00Z"
  }
}
```

### `PATCH /events/{event_id}`
**Purpose:** Update event.  
**Request (body):** same fields as create (partial).  
**Response:**
```json
{
  "tenant_id": "string",
  "data": {
    "event_id": "string",
    "title": "string",
    "start_at": "2025-01-01T00:00:00Z",
    "end_at": "2025-01-01T00:00:00Z",
    "venue_account_id": "string",
    "artist_account_ids": ["string"],
    "location": { "lat": 0.0, "lng": 0.0 },
    "updated_at": "2025-01-01T00:00:00Z",
    "created_at": "2025-01-01T00:00:00Z"
  }
}
```

### `POST /branding/update`
**Purpose:** Update tenant About/logo/icon/colors.  
**Request (multipart/form-data):**
- `theme_data_settings[brightness_default]` (`light|dark`)
- `theme_data_settings[primary_seed_color]` (`#RRGGBB`)
- `theme_data_settings[secondary_seed_color]` (`#RRGGBB`)
- `logo_settings[light_logo_uri]` (png file, optional)
- `logo_settings[dark_logo_uri]` (png file, optional)
- `logo_settings[light_icon_uri]` (png file, optional)
- `logo_settings[dark_icon_uri]` (png file, optional)
- `logo_settings[favicon_uri]` (ico file, optional)
- `logo_settings[pwa_icon]` (png file, optional; generates variants)

**Response:**
```json
{
  "tenant_id": "string",
  "data": {
    "theme_data_settings": {
      "primary_seed_color": "#RRGGBB",
      "secondary_seed_color": "#RRGGBB",
      "brightness_default": "light|dark"
    },
    "logo_settings": {
      "light_logo_uri": "string?",
      "dark_logo_uri": "string?",
      "light_icon_uri": "string?",
      "dark_icon_uri": "string?",
      "favicon_uri": "string?",
      "pwa_icon_uri": "string?"
    }
  }
}
```
**Field Definitions**
- `theme_data_settings.brightness_default`: `light`, `dark`.

---

## 8) Deferred (Do Not Implement in MVP)
- Partner-issued invites + partner invite metrics endpoints.
- Sponsors POIs endpoints.
- `/initialize` (system bootstrap) is out of MVP scope; `/environment` is the MVP entrypoint.

---

## Definition of Done
- [ ] All MVP endpoints are listed.
- [ ] Every endpoint has **response schema** documented.
- [ ] Response schemas match frontend needs (no missing fields).
- [ ] Every endpoint that accepts input has **payload schema** documented.
