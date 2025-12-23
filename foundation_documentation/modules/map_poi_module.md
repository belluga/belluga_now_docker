# Map & POI Module

## 1. Overview

This document outlines the architecture and data synchronization strategy for the Map and Points of Interest (POI) module. The module is responsible for displaying an interactive map to the user, populated with various points of interest such as restaurants, beaches, attractions, and time-sensitive events.

## 2. Current Prototype Implementation

The initial prototype uses a mocked data layer that simulates fetching POIs from a hardcoded list. This is being actively refactored to support a high-fidelity mock of the final architecture.

**Shared Location Contract.** As part of FCX-02, the main Flutter application owns a `LocationRepository` + `UserLocationService` pair that lives in the domain layer. Controllers are the only consumers of repositories, so the service is injected into controllers, which then pass the user’s coordinates to downstream repositories (Map, Agenda, Task/Reminder). No repository is allowed to call another repository directly; when features need multiple data sources, controllers compose the calls or rely on lightweight domain services. This keeps dependency arrows pointing inward (controllers → repositories) and prevents caching or network responsibilities from leaking between repos.

**Mock Strategy.** During mock phases the `LocationRepository` offers deterministic positions (configurable in debug menus) so we can test distance sorting and viewport queries without GPS. When the real platform location APIs are wired, the same repository continues to back the service, preserving controller contracts.

**Location Permission Gate (Guard).** All screens whose behavior depends on current user location (e.g., the Map POI viewport, “nearby”/distance-ranked lists, and any future “near me” actions) must be protected by a dedicated navigation guard. If location services are disabled or permission is not granted, navigation must redirect to an inviting permission screen that:
- Explains why location is required (nearby venues, distance sorting, “search this area”).
- Offers a primary CTA to request permission (when possible) or open settings (when denied forever).
- Offers a CTA to open system location settings when the device-level service is disabled.

**Cached Location Mode (Non-Live).** When live location is blocked (service off / permission denied) but the app has a previously captured location, the client should remain usable:
- Show a “not live” screen explaining we’re using a possibly outdated location (with timestamp).
- Allow the user to continue using cached location for “nearby” ordering and map centering, while offering a CTA to re-enable live location.

## 3. Proposed Architecture: A Server-Centric, Real-Time Model

Initial architectural discussions considered a client-heavy caching model. However, requirements for powerful geospatial search, real-time location tracking, and live state changes make a **server-centric, real-time model** the superior approach.

This architecture leverages a powerful backend database (e.g., **MongoDB with geospatial indexes**) to handle all complex queries, while using a real-time communication layer (**SSE**) to push instant updates to clients.

*A core principle of this architecture is to **Build for the Future**. The B2C client application and its underlying mock data layer will be built to support the full v1.1 feature set from the start, even if some features are only testable via a debug menu initially. This avoids building technical debt and ensures the foundation is scalable.*

### 3.1. On-Demand Data Fetching (HTTP REST API)

The primary mechanism for fetching POIs will be an on-demand process driven by the user's interaction with the map. The client will request data based on the map's viewport and selected filters (including a **radius filter** expressed via `max_distance_meters`), and the server will handle all heavy lifting for geospatial queries. MongoDB's `$geoNear` aggregation already returns the calculated distance in meters, so every POI payload must include a `distance_meters` field.

**Radius semantics:** The radius filter is always anchored around a reference point (current user location by default, or a manually selected center supplied through the initial filter payload). While the user pans the map, the reference point does **not** change automatically; we continue to query “POIs within X meters of the reference point.” If the user wants to search the newly centered area, we surface a “Search this area” button — pressing it resets the reference point to the new center and reissues the radius-constrained fetch. This keeps “Max 10 km” intentions consistent regardless of map movement. The client caches the results of these calls to ensure smooth performance and provide a degree of offline functionality.

### 3.2. Real-Time Updates (SSE)

For instant updates like moving POIs and live offers, a persistent SSE connection will be used. The backend will push delta events to subscribed clients, which will update the UI in real-time without a full refresh.

### 3.3. User Interface and Interaction

#### 3.3.1. Filtering
A two-level filtering system will be implemented for categories, sub-category tags, and search distance. Map controllers must accept an `initial_filter_payload` so any upstream surface (Home quick actions, agenda CTAs, notifications) can deep-link users into a pre-filtered map session. Example payload `{ "categories": ["music"], "tags": ["live"], "max_distance_meters": 3000 }`. When provided, the map bootstraps the viewport, selects the FAB/filter chips accordingly, and issues an immediate POI fetch using those parameters. Controllers persist this payload in state so pushing back to the map restores the last selection unless the user explicitly clears it. If the initial filter corresponds to one of the Floating Action Buttons (e.g., “Music”, “Beaches”), that FAB renders in the active state (highlighted/selected). This visual feedback tells the user the map is already filtered and that they can tap the same FAB to toggle or choose another filter to broaden the results.

#### 3.3.2. POI Details Card & Actions
When a user taps a POI, a details card will appear with "Details", "Share", and "Route" buttons.

#### 3.3.3. Core UI Logic and Polish
-   **Visual Stacking Order:** To meet business goals, POIs must be rendered in a specific vertical order. The map client must render markers with a z-index based on a `priority` field in the POI data model (e.g., Sponsors on top, then Live Events, then other Events, then all other POIs).
-   **Deselection Logic:** The POI details card must close automatically if the user clicks on the map outside the card or begins to drag the map, signifying a loss of focus.
-   **Mouseover Effect (Web):** On the web platform, hovering over a POI marker should increase its z-index to bring it to the front.

## 4. API Requirements for Proposed Architecture

This architecture requires a REST API for on-demand queries and an SSE API for real-time events. The data model for a POI will need to include a `priority` field to control the visual stacking order.

### 3.4 POI Type Registry & Navigation
- **Normalized IDs/Slugs:** Every custom object (poi, event, artist) exposes `id`, `slug`, and `type`. Navigation and actions use the slug as the canonical identifier; IDs back lookups but routing is slug-first.
- **POI Type Registry:** `poi_types` defines how to map external sources into normalized POIs without per-request pipelines.
  ```json
  {
    "slug": "restaurant",
    "label": "Restaurante",
    "kind": "venue|restaurant|beach|historic|generic",
    "pipeline": {
      "source": "collection_or_view",
      "match_template": { /* whitelisted predicates, e.g., bbox, term_ids */ },
      "projection": { "id": "$_id", "name": "$name", "lat": "$lat", "lng": "$lng", "address": "$address" },
      "field_map": { "lat": "location.lat", "lng": "location.lng" },
      "cache_ttl_seconds": 900,
      "max_page_size": 100
    },
    "route": { "name": "poi_detail", "params": ["slug"] }
  }
  ```
- **Lookup Flow:** Pipelines are only used upstream to produce/update normalized POI documents. Reads (agenda, map, event detail) never run pipelines; they fetch the normalized POI by `slug/id`. Events carry `venue_id` referencing that normalized POI. Route resolution uses `type` + `slug` → route map (e.g., `poi/*` → POI detail; `event` → event detail).

### 3.5 Custom Objects & Taxonomies
- **Custom Object Types:** `poi`, `event`, `artist`. All share the normalized shape `{ id, slug, type }` for routing and linking; slug is the primary navigation key.
- **Taxonomies/Terms:** `taxonomies` define `{ id, slug, name, applies_to: [poi|event|artist] }`; `terms` carry `{ id, slug, name, taxonomy_id }`. Object-term links use `{ object_type, object_id, term_id }`.
- **Usage:**
  - POIs own their terms (e.g., `cuisine`, `ambience`, `vibe`).
  - Artists own `genres` terms.
  - Events may supply `tags`; if empty, clients derive chips from linked artist genres (and, optionally, POI terms if exposed).
- **Navigation:** Detail actions are resolved from `type` + `slug` using a registry map, not IDs. Backend must ensure slug uniqueness per type and return both slug and id for robustness.

### 3.6 Materialized `map_pois` (Projection Records, Optional Time Anchor)

For V1, we treat `map_pois` as a **materialized projection/read model** used by the map experience. Whenever a Partner or an Event is created/updated (by landlord admins or partner members), we write/update a linked `map_pois` record in the same logical transaction.

Key properties:
- `map_pois` is the map projection (geometry + category + tags + priority + deep-link reference).
- The record may carry an optional `time_anchor_at` (nullable). We do **not** store `visible_from`/`visible_until`. Visibility windows are computed at query time using backend-owned tenant settings.
- Partner/Custom Object types can enable/disable POI projection via capabilities. When disabled, the backend can keep the POI record but set `is_active=false` (soft disabled), or omit creation entirely for that type.

**Reference linkage (required):**
```json
{
  "ref_type": "partner|event|static",
  "ref_id": "ObjectId() | null"
}
```

**Time anchor (optional):**
```json
{
  "time_anchor_at": "Date | null"
}
```

Query-time window policy (backend settings example):
- include time-anchored POIs where `time_anchor_at <= now + future_window_days`
- and `time_anchor_at >= now - past_window_days`
- POIs without `time_anchor_at` are always eligible (subject to `is_active`, viewport, and filters)

This ensures future events/campaigns do not appear immediately when created, while still allowing the backend to tune visibility without rewriting data.

#### Example: “Promotional Coupon” Custom Object (POI-enabled)

Scenario: A partner wants a time-bound promotion (“Pague 1, leve 2” de cerveja). This can be modeled as a POI-enabled custom object type (it may be “a partner-like object” from the map’s point of view, but it is not required to be a Partner profile).

Custom object fields (example):
```json
{
  "type": "promotional_coupon",
  "title": "Pague 1, leve 2 (Cerveja)",
  "details": "Válido das 18h às 22h, somente hoje.",
  "partner_id": "ObjectId()",
  "starts_at": "Date",
  "ends_at": "Date",
  "location": { "type": "Point", "coordinates": [-40.498383, -20.673067] },
  "tags": ["cerveja", "promo", "happy-hour"],
  "coupon_code": "String"
}
```

Projection into `map_pois` on save (example):
```json
{
  "ref_type": "custom_object",
  "ref_id": "ObjectId()",
  "category": "sponsor",
  "name": "Pague 1, leve 2 (Cerveja)",
  "description": "Válido das 18h às 22h, somente hoje.",
  "location": { "type": "Point", "coordinates": [-40.498383, -20.673067] },
  "tags": ["cerveja", "promo", "happy-hour"],
  "priority": 10,
  "is_active": true,
  "time_anchor_at": "2025-12-13T18:00:00Z"
}
```

Notes:
- The POI exists as a projection; the canonical coupon object holds the full details and validation rules.
- `time_anchor_at` uses `starts_at` by default; tenant settings decide how early/late it appears.

### 3.7 Same-Spot POIs (Stacking, Deduplication, and Performance)

Multiple POIs can share the same coordinates (e.g., venue + promotion + event + nearby beach marker snapping to the same point). We handle this explicitly so UX and metrics remain deterministic.

#### A) Model-level rules
- `ref_type + ref_id` is the identity; never duplicate the same reference as multiple POIs.
- Use `priority` as the primary sort key (lower number = higher priority).
- Use a stable tiebreaker (e.g., `ref_type` precedence + `ref_id`) to keep ordering deterministic across refreshes.

#### B) Stacking vs Clustering (Two Scenarios We Must Support)

We explicitly support both scenarios:

1. **Exact same location (stacking):** multiple POIs intentionally share the *same* point (e.g., a venue, an event at that venue, and a time-bound promotional coupon).
2. **Near same location (clustering):** POIs are near each other but not identical (zoomed-out map density).

For V1, we implement (1) as the default and defer (2) unless density demands it.

#### C) Coordinate Normalization (Required for Exact-Key Stacks)

To make “exact same location” deterministic across writes, the backend must normalize coordinates when persisting `map_pois`:
- Store `location.coordinates` rounded to a fixed precision (e.g., 6 decimals).
- Derive an `exact_key` from the normalized coordinates (string or separate fields), e.g. `"lat,lng"`.

This avoids float noise causing two logically identical points to fail stacking.

#### D) API strategy (Recommended: Backend Returns Stacks)

Backend returns “stacks” for same-spot POIs; each stack has a top POI and a count.

**V1 stack grouping:**
- Group by `exact_key` only (same normalized coordinates).

**VNext clustering (optional):**
- Also compute `cluster_key` based on zoom-dependent precision (e.g., geohash/H3/S2 or bucket rounding).
- Group by `cluster_key` at low zoom levels to reduce payload and marker density, while preserving sub-stacks by `exact_key` inside a cluster when presenting the deck.

Response shape (example):
```json
{
  "stack_key": "String",
  "center": { "lat": "Number", "lng": "Number" },
  "top_poi": { /* POI */ },
  "stack_count": "Number",
  "items": [ /* POIs ordered by priority */ ]
}
```

#### E) UX rules
- The marker shows the top POI (highest priority) and a badge like “+3”.
- Tapping opens a selector/deck:
  - items ordered by `priority` then stable tiebreaker
  - selecting an item pins it for that session (until map refresh or user clears selection)

#### F) Query performance considerations
- Keep 2dsphere index on `location`.
- Filter first by viewport + category/tags; only then apply stacking/grouping.
- For V1, group by `exact_key` (normalized coordinates). For VNext clustering, group by `cluster_key` derived from zoom.

### 4.1. REST API (On-Demand Queries)

1.  **Primary POI Endpoint:** `GET /v1/app/map/pois`
    -   Purpose: return POIs within the current viewport and/or within a max distance anchored around a reference point (typically the user’s current position).
    -   Parameters (query string):
        - `ne_lat`, `ne_lng`, `sw_lat`, `sw_lng` (optional but recommended): current map viewport bounds.
        - `origin_lat`, `origin_lng` (optional): reference point for `$geoNear` / distance ordering; if omitted, backend may derive from viewport center.
        - `max_distance_meters` (optional): radius filter anchored to origin; when present, backend must compute `distance_meters`.
        - `categories[]`, `tags[]`, `taxonomy[]`, `search` (optional): filters and free-text matching (taxonomy entries are `{type, value}` pairs).
        - `sort` (optional): `priority`, `distance`, `time_to_event`.
    -   Backend enforcement:
        - Use MongoDB geospatial queries (`$geoNear` and/or `$geoWithin`) as the authoritative source of “nearby” truth.
        - When `origin_lat/lng` is provided, return `distance_meters` for each POI.
        - Apply time-window filters for `time_anchor_at` using backend-owned tenant settings (future/past windows). The client should not hardcode visibility windows.
    -   Response fields: standard POI attributes plus `distance_meters` (double, optional when distance is not requested). When sorting by `distance`, backend orders by ascending distance while still honoring priority tiers (sponsors > live events > others).
2.  **Filter Discovery Endpoint:** `GET /v1/app/map/filters`
    -   Returns all available categories and their associated tags to dynamically build the filter UI (taxonomy catalog is sourced separately and applied as advanced filters when needed).

### 4.2. SSE API (Real-Time Events)

The client will connect to an SSE endpoint and subscribe to events for the visible map area.
-   **Server pushes events:** `poi.created`, `poi.updated`, `poi.deleted`.
    - **Endpoint:** `GET /v1/app/map/pois/stream` (filters match `/v1/app/map/pois`).

## 5. Roadmap and Strategic Decisions

### 5.1. Phased Rollout
-   **v0.1 (Lean MVP):** The initial launch will focus on the core B2C experience, primarily listing events and static POIs. The full real-time architecture will be built, but the features may not be exposed in the UI.
-   **v1.1 (Fast-Follow):** Advanced real-time features like "moving POIs" and "live offers" will be fully enabled in the UI.

### 5.2. Unified Codebase
-   The "Partner" or "Landlord" functionality for managing POIs and offers will not be a separate application. It will be a different mode or build flavor within the main Flutter codebase, ensuring efficiency and code reuse.

### 5.3. Implementation Roadmap
-   **Phase 1 (Complete):** Foundational Mock Data Layer (`MockPoiDatabase`, `MockHttpService`, `MockSseService`).
-   **Phase 2 (In Progress):** Connect Data Layer to UI (Refactor `Repository`, `Controller`, and `Screen`).
-   **Phase 2.1 (Queued):** Implement Core Visual Logic (Visual Stacking Order using the `priority` field).
-   **Phase 3 (Queued):** Implement Feature UI (Filtering Panel, POI Details Card with Deselection Logic).
-   **Phase 4 (Queued):** Final Polish (Web-specific mouseover effects, etc.).
