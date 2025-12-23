# Documentation: Tenant Home Composer Module

**Version:** 1.0  
**Date:** February 28, 2025  
**Authors:** Delphi (Belluga Co-Engineering)

## 1. Overview

The Tenant Home Composer module (MOD-301) assembles the personalized landing experience for every tenant app user. For MVP, this module is **deferred**: home composition is client-side using independent requests (invites, agenda, map, discovery), and there is **no** aggregated home endpoint. Post-MVP, this module will emit a single schema and persist lightweight snapshots so mocked clients and production clients can converge on the same payload contract.

---

## 2. Design Principles

1. **Snapshot Everything:** Each generated home overview is stored as an immutable `home_overviews` document tied to `user_id`, `tenant_id`, and `generated_at`. Controllers only mutate by writing a brand-new snapshot, which preserves historical personalization for audits and experimentation.
2. **Composable Sections:** Every home surface (hero carousel, invite nudges, POI strips, agenda actions) is modeled as a `HomeSection` with a `type` discriminator. Clients render sections declaratively based on this metadata, so we can add/remove sections without redeploying Flutter UI.
3. **External Source Isolation:** The module never queries external services directly. It relies on upstream modules (Map, Invite, Agenda, Partner Catalog) via asynchronous events or cached read models. This ensures each producer maintains its own invariants while the composer simply curates.
4. **Business-Driven Prioritization:** Section ordering, CTA selection, and copy tone derive from rule sets stored in `home_rulesets`. Rules encapsulate partner campaigns, invite boosts, and locality signals so we avoid hardcoding logic inside controllers.
5. **Search & Map Bridging:** Quick filters and search suggestions on the home screen map to `HomeSection` instances that deep-link into the Map module via `initial_filter_payload`s (categories, tags, radius). This keeps the “predefined filter buttons” and search results consistent with the map architecture.

---

## 3. Core Collections

### 3.1 `home_rulesets`
```json
{
  "_id": "ObjectId()",
  "tenant_id": "ObjectId()",
  "name": "String",
  "status": "String",
  "priority": "Number",
  "audience_filters": {
    "roles": ["String"],
    "geo_hashes": ["String"],
    "partner_ids": ["ObjectId()"]
  },
  "section_blueprints": [
    {
      "section_type": "String",
      "limit": "Number",
      "data_contract": {},
      "fallback_strategy": "String"
    }
  ],
  "valid_from": "Date",
  "valid_until": "Date",
  "created_at": "Date",
  "updated_at": "Date"
}
```
*`status` ∈ {`draft`, `active`, `paused`}. `fallback_strategy` controls whether to collapse, substitute, or repeat sections when upstream data is scarce.*

### 3.2 `home_overviews`
```json
{
  "_id": "ObjectId()",
  "tenant_id": "ObjectId()",
  "user_id": "ObjectId()",
  "sections": [
    {
      "section_id": "String",
      "type": "String",
      "title": "String",
      "subtitle": "String",
      "cta": { "type": "String", "label": "String", "target": {} },
      "payload": {}
    }
  ],
  "generated_at": "Date",
  "rule_applied": "ObjectId()",
  "experiments": [
    { "experiment_key": "String", "variant": "String" }
  ]
}
```

### 3.3 `home_feedback`
Captures user actions taken from the home screen so ranking logic can adapt.
```json
{
  "_id": "ObjectId()",
  "tenant_id": "ObjectId()",
  "user_id": "ObjectId()",
  "section_id": "String",
  "action": "String",
  "metadata": {},
  "occurred_at": "Date"
}
```

---

## 4. Interfaces (Post-MVP)

**MVP note:** no home composer API is shipped; the app composes home from independent endpoints. Post-MVP endpoint names are to be defined alongside the final home payload contract.

### 4.2 Events
* **Inbound:** `invites.summary.updated`, `agenda.snapshot.updated`, `partner.highlight.updated`, `poi.highlight.updated`.
* **Outbound:** `home.snapshot.generated` (used for analytics) and `home.section.rendered` (fire-and-forget metric event).

---

## 5. Operational Policies

* **Regeneration Cadence:** Snapshots auto-refresh every 4 hours or when upstream events mark dependent sections dirty.
* **A/B Experimentation:** Experiments defined in `home_rulesets` propagate variant identifiers into each section payload. Clients echo the variant when emitting feedback so scoring stays consistent.
* **Latency Budget:** Composer must respond within 350 ms at the API layer. Complex aggregations are executed ahead of time by upstream modules; composer simply stitches data.

---

## 6. Roadmap

1. **MVP (FCX-01/02):** Deferred; client composes home from independent endpoints (invites, agenda, map, discovery).
2. **Phase 8 Dependency:** Integrate Multidimensional Insights snapshots to surface gamified leaderboards.
3. **Phase 10 Alignment:** Receive backend-driven aggregation payloads to fully replace mock data while preserving the same schema.
