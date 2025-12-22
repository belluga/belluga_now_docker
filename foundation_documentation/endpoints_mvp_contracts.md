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
- Fields marked **TBD** must be locked before implementation.
- Pagination conventions:
  - **App feeds** (invites/agenda/events) use **cursor pagination** via Laravel `cursorPaginate()`.
    - Request: `cursor` (string, optional), `limit` (int, optional).
    - Response: `next_cursor`, `prev_cursor` (string or null).
  - **Admin CRUD lists** (accounts/assets/admin events) use **page-based pagination**.
    - Request: `page` (int, optional), `per_page` (int, optional).
    - Response: `data`, `current_page`, `last_page`, `per_page`, `total`.
- Distance fields:
  - `distance_meters` is returned when the backend computes distance from an origin (see Map).
  - For non-map lists (agenda/home), include `distance_meters` only when requested; otherwise omit.

---

## 1) Identity + Bootstrap

### `POST /anonymous/identities`
**Purpose:** Create or resume anonymous identity for web/app flows.  
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

### `GET /environment` (root or tenant subdomain)
**Purpose:** Resolve landlord/tenant context + branding.
We should bring more details here, for
**Request (query):** `app_domain`, `domain`, `subdomain` (all optional).
**Response (minimum):**
```json
{
  "type": "landlord|tenant",
  "name": "string",
  "subdomain": "string?",
  // main_domain is not optional. It will always return the domain you should use by the requests.
  "main_domain": "string?",
  "domains": ["string"],
  "app_domains": ["string"],
  "theme_data_settings": {
    "primary_seed_color": "#RRGGBB",
    "secondary_seed_color": "#RRGGBB",
    "brightness_default": "light|dark"
  }
}
```
**Branding assets:** use default paths `GET /logo-light.png`, `/logo-dark.png`, `/icon-light.png`, `/icon-dark.png` (no direct URLs in this payload).

---

## 2) Home + Discovery

### `GET /home-overview`
**Purpose:** Home composition payload.  
**Response:** **TBD** (must match Flutter home layout; define sections and item DTOs).

### `GET /profile`
**Purpose:** Profile summary + role claims.  
**Response:** **TBD** (min fields for profile header + counters).

### `GET /onboarding/context`
**Purpose:** Dynamic onboarding strings and branding.  
**Response:** **TBD**.

---

## 3) Invites (User-to-User)

### `GET /invites`
**Purpose:** Invites feed and referral context.  
**Request (query):**
- `cursor` (optional)
- `limit` (optional)
**Response (minimum):**
```json
{
  "invites": [
    {
      "invite_id": "string",
      "event_id": "string",
      "inviter_principal": { "kind": "user|partner", "id": "string" },
      "status": "pending|accepted|declined|closed_duplicate",
      "credited_acceptance": true,
      "created_at": "2025-01-01T00:00:00Z"
    }
  ],
  "next_cursor": "string",
  "prev_cursor": "string"
}
```

### `GET /invites/settings`
**Purpose:** Invite quotas + UX messaging limits.  
**Response:** **TBD** (must include limit keys, reset times).

### `POST /invites/share`
**Purpose:** Create share code for invite attribution.  
**Request (body):**
```json
{ "event_id": "string" }
```
**Response (minimum):**
```json
{
  "code": "string",
  "event_id": "string",
  "inviter_principal": { "kind": "user|partner", "id": "string" }
}
```

### `POST /invites/share/{code}/accept`
**Purpose:** Accept invite from web landing by code.  
**Request (headers/body):** Auth via Sanctum (anonymous identity). No body required.
**Response:** **TBD** (accepted state + attribution binding).

**Requirement:** Invite share links must carry `code` as a GET parameter.

---

## 4) Events + Agenda

### `GET /agenda`
**Purpose:** Paged agenda feed.  
**Request (query):**
- `cursor` (optional)
- `limit` (optional)
- `past_only` (bool, optional)
- `search` (string, optional)
- `invite_filter` (enum, optional)
- `origin_lat` / `origin_lng` (optional, enables `distance_meters`)
**Response (minimum):**
```json
{
  "items": [
    {
      "event_id": "string",
      "slug": "string",
      "title": "string",
      "start_at": "2025-01-01T00:00:00Z",
      "end_at": "2025-01-01T00:00:00Z",
      "venue": { "account_id": "string", "name": "string" },
      "artists": [{ "account_id": "string", "name": "string" }],
      "is_confirmed": false,
      "total_confirmed": 0,
      "distance_meters": 0
    }
  ],
  "next_cursor": "string",
  "prev_cursor": "string"
}
```

### `GET /events/{event_id}`
**Purpose:** Event detail.  
**Response:** **TBD** (must include venue + artist references + invite context; include `distance_meters` when origin provided).

### `POST /events/{event_id}/check-in`
**Purpose:** Presence confirmation.  
**Response:** **TBD** (updated presence state).

---

## 5) Map + POIs

### `GET /map/pois`
**Purpose:** Map POIs from projection (`map_pois`).  
**Request (query):**
- `viewport` (bounds; **TBD** shape)
- `origin_lat` / `origin_lng` (optional)
- `max_distance_meters` (optional, up to `100000`)
- `categories[]` (optional)
- `tags[]` (optional)
- `sort` (optional: `priority|distance|time_to_event`)
**Notes:**
- Pagination is cursor-based elsewhere; map queries rely on viewport + radius rather than explicit item limits.
**Response (minimum):**
```json
{
  "items": [
    {
      "ref_type": "event|account|static_asset",
      "ref_id": "string",
      "category": "culture|beach|nature|historic|restaurant",
      "tags": ["string"],
      "location": { "lat": 0.0, "lng": 0.0 },
      "time_anchor_at": "2025-01-01T00:00:00Z",
      "distance_meters": 0
    }
  ]
}
```

### `GET /map/filters`
**Purpose:** Server-defined filter catalog.  
**Response:** **TBD**.

---

## 6) Push

### `POST /push/register`
**Purpose:** Register device token.  
**Request:**
```json
{ "device_id": "string", "platform": "ios|android|web", "push_token": "string" }
```
**Response:** `{ "ok": true }`

---

## 7) Tenant/Admin Area (Authenticated)

### `GET /accounts`
**Purpose:** List accounts (including unmanaged).  
**Response:** **TBD** (account summary with `is_managed`).

### `POST /accounts`
**Purpose:** Create account.  
**Request (body):**
```json
{
  "name": "string",
  "type": "artist|venue|restaurant|culture|other",
  "bio": "string?",
  "category": "string?",
  "tags": ["string"],
  "location": { "lat": 0.0, "lng": 0.0 }
}
```
**Response:** **TBD** (account detail).

### `PATCH /accounts/{account_id}`
**Purpose:** Update account details.  
**Request (body):** same fields as create (partial).
**Response:** **TBD**.

### `GET /assets`
**Purpose:** List StaticAssets.  
**Response:** **TBD**.

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
**Response:** **TBD**.

### `PATCH /assets/{asset_id}`
**Purpose:** Update StaticAsset.  
**Request (body):** same fields as create (partial).
**Response:** **TBD**.

### `GET /events`
**Purpose:** List events (tenant scope).  
**Response:** **TBD**.

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
**Response:** **TBD**.

### `PATCH /events/{event_id}`
**Purpose:** Update event.  
**Request (body):** same fields as create (partial).
**Response:** **TBD**.

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
**Response:** **TBD** (return updated branding payload).

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
