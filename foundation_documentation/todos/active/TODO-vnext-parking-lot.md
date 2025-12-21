# TODO (VNext Parking Lot): Deferred Features / Avoid Losing Functionality

**Status legend:** `- [ ] ⚪ Pending` · `- [ ] 🟡 Provisional` · `- [x] ✅ Production‑Ready`.
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
  - V1 intent: keep minimal reduced profiles; defer richer modules (store, galleries, curated content) to when Partner Blueprints/Capabilities are backend-driven.

## F) Partner Self-Management (Deferred)

- **Partner self-management area**
  - Reason: MVP uses tenant/admin area; partner self-management comes next.

## E) Invites & Metrics (Deferred)

- **Partner invite metrics**
  - Reason: defer partner-facing metrics dashboards until after MVP invite flows are stable.
- **Partner-issued invites**
  - Reason: defer partner-issued invites until after MVP user-invite flows are stable.

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
- **Sponsors POIs**
  - Reason: sponsors may require multi-location entities and/or moving POIs; defer until the model supports this cleanly.
