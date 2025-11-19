# Map & POI Module

## 1. Overview

This document outlines the architecture and data synchronization strategy for the Map and Points of Interest (POI) module. The module is responsible for displaying an interactive map to the user, populated with various points of interest such as restaurants, beaches, attractions, and time-sensitive events.

## 2. Current Prototype Implementation

The initial prototype uses a mocked data layer that simulates fetching POIs from a hardcoded list. This is being actively refactored to support a high-fidelity mock of the final architecture.

**Shared Location Contract.** As part of FCX-02, the main Flutter application owns a `LocationRepository` + `UserLocationService` pair that lives in the domain layer. Controllers are the only consumers of repositories, so the service is injected into controllers, which then pass the user’s coordinates to downstream repositories (Map, Agenda, Task/Reminder). No repository is allowed to call another repository directly; when features need multiple data sources, controllers compose the calls or rely on lightweight domain services. This keeps dependency arrows pointing inward (controllers → repositories) and prevents caching or network responsibilities from leaking between repos.

**Mock Strategy.** During mock phases the `LocationRepository` offers deterministic positions (configurable in debug menus) so we can test distance sorting and viewport queries without GPS. When the real platform location APIs are wired, the same repository continues to back the service, preserving controller contracts.

## 3. Proposed Architecture: A Server-Centric, Real-Time Model

Initial architectural discussions considered a client-heavy caching model. However, requirements for powerful geospatial search, real-time location tracking, and live state changes make a **server-centric, real-time model** the superior approach.

This architecture leverages a powerful backend database (e.g., **MongoDB with geospatial indexes**) to handle all complex queries, while using a real-time communication layer (**WebSockets**) to push instant updates to clients.

*A core principle of this architecture is to **Build for the Future**. The B2C client application and its underlying mock data layer will be built to support the full v1.1 feature set from the start, even if some features are only testable via a debug menu initially. This avoids building technical debt and ensures the foundation is scalable.*

### 3.1. On-Demand Data Fetching (HTTP REST API)

The primary mechanism for fetching POIs will be an on-demand process driven by the user's interaction with the map. The client will request data based on the map's viewport and selected filters (including a **radius filter** expressed via `max_distance_meters`), and the server will handle all heavy lifting for geospatial queries. MongoDB's `$geoNear` aggregation already returns the calculated distance in meters, so every POI payload must include a `distance_meters` field.

**Radius semantics:** The radius filter is always anchored around a reference point (current user location by default, or a manually selected center supplied through the initial filter payload). While the user pans the map, the reference point does **not** change automatically; we continue to query “POIs within X meters of the reference point.” If the user wants to search the newly centered area, we surface a “Search this area” button — pressing it resets the reference point to the new center and reissues the radius-constrained fetch. This keeps “Max 10 km” intentions consistent regardless of map movement. The client caches the results of these calls to ensure smooth performance and provide a degree of offline functionality.

### 3.2. Real-Time Updates (WebSocket API)

For instant updates like moving POIs and live offers, a persistent WebSocket connection will be used. The backend will push events to subscribed clients, which will update the UI in real-time without a full refresh.

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

This architecture requires a REST API for on-demand queries and a WebSocket API for real-time events. The data model for a POI will need to include a `priority` field to control the visual stacking order.

### 4.1. REST API (On-Demand Queries)

1.  **Primary POI Endpoint:** `GET /api/pois`
    -   Parameters: `viewport.bounds`, `categories[]`, `tags[]`, `max_distance_meters`, `sort` (values: `priority`, `distance`, `time_to_event`).
    -   Response fields: standard POI attributes plus `distance_meters` (double). When the sort mode is `distance`, the backend orders by ascending distance while still honoring the `priority` tiers (sponsors > live events > others). `time_to_event` sorting leverages POI event metadata and still includes `distance_meters` so the client can expose secondary ordering.
2.  **Filter Discovery Endpoint:** `GET /api/filters`
    -   Returns all available categories and their associated tags to dynamically build the filter UI.

### 4.2. WebSocket API (Real-Time Events)

The client will connect to a WebSocket endpoint and subscribe to events for the visible map area.
-   **Server pushes events:** `poi:moved`, `poi:offer_activated`, `poi:offer_deactivated`.

## 5. Roadmap and Strategic Decisions

### 5.1. Phased Rollout
-   **v0.1 (Lean MVP):** The initial launch will focus on the core B2C experience, primarily listing events and static POIs. The full real-time architecture will be built, but the features may not be exposed in the UI.
-   **v1.1 (Fast-Follow):** Advanced real-time features like "moving POIs" and "live offers" will be fully enabled in the UI.

### 5.2. Unified Codebase
-   The "Partner" or "Landlord" functionality for managing POIs and offers will not be a separate application. It will be a different mode or build flavor within the main Flutter codebase, ensuring efficiency and code reuse.

### 5.3. Implementation Roadmap
-   **Phase 1 (Complete):** Foundational Mock Data Layer (`MockPoiDatabase`, `MockHttpService`, `MockWebSocketService`).
-   **Phase 2 (In Progress):** Connect Data Layer to UI (Refactor `Repository`, `Controller`, and `Screen`).
-   **Phase 2.1 (Queued):** Implement Core Visual Logic (Visual Stacking Order using the `priority` field).
-   **Phase 3 (Queued):** Implement Feature UI (Filtering Panel, POI Details Card with Deselection Logic).
-   **Phase 4 (Queued):** Final Polish (Web-specific mouseover effects, etc.).
