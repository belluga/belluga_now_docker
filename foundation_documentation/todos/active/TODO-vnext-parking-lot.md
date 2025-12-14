# TODO (VNext Parking Lot): Deferred Features / Avoid Losing Functionality

**Status:** Active  
**Owner:** Delphi  
**Purpose:** Capture features we intentionally do **not** ship in V1 so they are not lost and can be re-evaluated in future versions.

---

## A) Profile & Utilities (Deferred)

- **Wallet / Guar[APP]ari Pay** (balance + statement + cashbacks)
  - Source reference: `foundation_documentation/screens/modulo_perfil_e_utilidades.md`
  - Notes: defer until payment/ledger contracts are implemented and a stable Transaction Bridge read-model exists.
- **Purchases & Reservations history**
  - Source reference: `foundation_documentation/screens/modulo_perfil_e_utilidades.md`
  - Notes: depends on Transaction Bridge + booking lifecycles and partner-side fulfillment.
- **Premium plan management**
  - Source reference: `foundation_documentation/screens/modulo_perfil_e_utilidades.md`
  - Notes: depends on subscription/billing system + entitlements delivery.

---

## B) Partner Profiles (Deferred / Simplify in V1)

- **Full partner profile modular tabs for all partner types**
  - V1 intent: keep a minimal “Artist profile” view by reducing existing tabs, not creating multiple new surfaces.
  - Defer richer modules (store, galleries, curated content) to when Partner Blueprints/Capabilities are backend-driven.
- **Venue profile pages**
  - V1 intent: avoid venue detail pages to reduce complexity; map + event flows cover venue context.

---

## C) Favorites (Deferred Enhancements)

- **Backend-persistent favorites**
  - V1 intent: mock behavior can reset on load; backend becomes source of truth later.
- **Favorite venues**
  - V1 intent: only artist favorites; venues deferred.

---

## D) Map (Deferred Enhancements)

- **Subcategories taxonomy**
  - V1 intent: keep coarse POI categories and use tags for richer filtering.
  - Defer expanding `CityPoiCategory` unless validated by UX demand.

