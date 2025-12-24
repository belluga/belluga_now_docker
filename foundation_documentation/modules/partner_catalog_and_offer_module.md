# Documentation: Partner Catalog & Offer Module

**Version:** 1.0  
**Date:** February 28, 2025  
**Authors:** Delphi (Belluga Co-Engineering)

## 1. Overview

The Partner Catalog & Offer module (MOD-304) maintains the canonical representation of restaurants, artists, guides, and merchants that operate within a tenant. It exposes the offer graph consumed by the Map & POI module, Tenant Home Composer, and Agenda Planner. The module sits between partner-facing tooling (future Partner Workspace) and consumer experiences, enforcing validation, media standards, and availability lifecycles.

---

## 2. Principles

1. **Value Objects Everywhere:** Every textual or media attribute is wrapped in value objects (`PartnerNameValue`, `HeroImageValue`, `OfferPriceValue`) stored within the module so Flutter and Laravel layers never juggle raw primitives.
2. **Availability Windows:** Offers declare explicit `available_windows` objects (dates, days of week, time ranges) to guarantee map and agenda projections can reason about current vs. future availability.
3. **Geo-Safe Modeling:** Partner locations and POIs rely on normalized `geo_shapes` with both `lat/long` and `geohash` representations to align with the multi-tenant map stack.
4. **Decoupled Media Storage:** Media metadata lives in this module, but binary assets are uploaded to landlord-managed storage buckets. Documents store signed URLs plus invariants (resolution, aspect ratio).

---

## 3. Core Collections

### 3.1 `partners`
```json
{
  "_id": "ObjectId()",
  "tenant_id": "ObjectId()",
  "legal_name": "String",
  "display_name": "String",
  "partner_type": "String",
  "tagline": "String",
  "description": "String",
  "media": {
    "hero_image": "String",
    "logo": "String",
    "gallery": ["String"]
  },
  "contact_channels": [
    { "type": "String", "value": "String", "is_verified": "Boolean" }
  ],
  "location": {
    "address": "String",
    "lat": "Number",
    "lng": "Number",
    "geohash": "String"
  },
  "badges": ["String"],
  "verification_flags": ["String"],
  "created_at": "Date",
  "updated_at": "Date"
}
```

### 3.2 `offers`
```json
{
  "_id": "ObjectId()",
  "partner_id": "ObjectId()",
  "tenant_id": "ObjectId()",
  "name": "String",
  "category": "String",
  "subcategories": ["String"],
  "pricing`: {
    "currency": "String",
    "amount": "Number",
    "pricing_model": "String"
  },
  "availability_windows": [
    {
      "start_at": "Date",
      "end_at": "Date",
      "days_of_week": ["String"],
      "time_ranges": [ { "start": "String", "end": "String" } ]
    }
  ],
  "poi_link": "ObjectId()",
  "status": "String",
  "created_at": "Date",
  "updated_at": "Date"
}
```

### 3.3 `partner_profiles`
Aggregated data served to authenticated partners (owner/managers) once the workspace launches. Stores metrics, insights references, and invite stats.

---

## 4. Interfaces

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/partners` | GET | Tenant-scoped list with filtering by category, status, verification flags. |
| `/api/v1/partners/{partnerId}` | GET | Detailed partner profile summary for consumer experiences. |
| `/api/v1/offers` | GET | Offer catalog filtered by partner, category, availability window. |
| `/api/v1/offers/{offerId}` | PATCH | Admin/partner operation to update descriptions or windows (behind auth). |

**Events**
* `partner.created`, `partner.updated`, `offer.published`, `offer.unavailable`, `offer.window.expired`.

---

## 5. Dependencies

* **Map & POI Module:** Consumes partner + offer data to render map markers.
* **Commercial Engine (external):** Provides pricing references when offers tie to real inventory or booking flows.
* **Multidimensional Insights Service:** Supplies badge thresholds (e.g., “Top Partner of the Week”) that update `badges`.

---

## 6. Roadmap

* **Phase 5:** Aligns with Flutter FCX-02 to serve mocked partner feeds.
* **Phase 10:** Provides partner-driven home compositions and aggregated insights to Tenant Home Composer.
* **Phase 12:** Powers the Partner Workspace module, reusing the same schema for partner CRUD operations.
