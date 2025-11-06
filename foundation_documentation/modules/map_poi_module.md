# Map & POI Module

## 1. Overview

This document outlines the architecture and data synchronization strategy for the Map and Points of Interest (POI) module. The module is responsible for displaying an interactive map to the user, populated with various points of interest such as restaurants, beaches, attractions, and time-sensitive events.

## 2. Current Prototype Implementation

The initial prototype uses a mocked data layer that simulates fetching POIs from a hardcoded list. This is being actively refactored to support a high-fidelity mock of the final architecture.

## 3. Proposed Architecture: A Server-Centric, Real-Time Model

Initial architectural discussions considered a client-heavy caching model. However, requirements for powerful geospatial search, real-time location tracking, and live state changes make a **server-centric, real-time model** the superior approach.

This architecture leverages a powerful backend database (e.g., **MongoDB with geospatial indexes**) to handle all complex queries, while using a real-time communication layer (**WebSockets**) to push instant updates to clients.

*A core principle of this architecture is to **Build for the Future**. The B2C client application and its underlying mock data layer will be built to support the full v1.1 feature set from the start, even if some features are only testable via a debug menu initially. This avoids building technical debt and ensures the foundation is scalable.*

### 3.1. On-Demand Data Fetching (HTTP REST API)

The primary mechanism for fetching POIs will be an on-demand process driven by the user's interaction with the map. The client will request data based on the map's viewport and selected filters, and the server will handle all heavy lifting for geospatial queries. The client will cache the results of these calls to ensure smooth performance and provide a degree of offline functionality.

### 3.2. Real-Time Updates (WebSocket API)

For instant updates like moving POIs and live offers, a persistent WebSocket connection will be used. The backend will push events to subscribed clients, which will update the UI in real-time without a full refresh.

### 3.3. User Interface and Interaction

#### 3.3.1. Filtering
A two-level filtering system will be implemented for categories, sub-category tags, and search distance.

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
    -   This endpoint will serve most data, using geospatial and filter parameters (`viewport`, `categories`, `tags`, etc.).
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
