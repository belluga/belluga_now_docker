# Documentation: Multidimensional Insights Service

**Version:** 1.0  
**Date:** October 16, 2025  
**Authors:** Belluga Learning & Engineering  
**Service Classification:** External Microservice (shared analytics backbone)

## 1. Overview

The Multidimensional Insights Service provides a generalized analytics and scoring platform that ingests normalized events from Guar[APP]ari tenants and outputs ranked, explainable insights. It exists as an external microservice so multiple tenants—including Guar[APP]ari—can consume a single, hardened analytics substrate without embedding complex computation inside the tenant applications.

Core capabilities:

* **Insight Model Registry:** Tenants define named analysis models such as "invite conversion health" or "partner engagement maturity."
* **Insight Topics:** Each topic represents an entity being scored (e.g., partner, invite cohort, marketing source).
* **Dimension Calculations:** Models aggregate weighted metrics across arbitrary dimensions with configurable formulas.
* **Snapshot Streams:** The service produces immutable insight snapshots and optional leaderboard projections for downstream clients.
* **Radar-Ready Outputs:** Dimension scores are formatted to feed radar/spider charts so tenant apps can visualize multi-dimensional health for events (e.g., vibe, logistics, hospitality, sustainability) or customers (e.g., engagement, reliability, promotion strength).

---

## 2. Design Principles

1. **Tenant-Isolated Processing:** Every insight calculation runs within a tenant-specific namespace, but the service hosts all tenants in a shared infrastructure footprint. Data separation is enforced via tokenized routing keys so privacy boundaries remain intact.
2. **Contract-First Configuration:** Insight models, dimensions, and transformation rules are described via JSON schemas versioned per tenant. The runtime never infers structure from events.
3. **Event-Sourced Inputs:** Inputs arrive through append-only event streams (Kafka topics or durable queues). The service never queries upstream databases directly.
4. **Explainability:** Each insight snapshot carries the dimension breakdown used to calculate its final score, ensuring UI layers can show "why this score changed."
5. **Stateless Workers:** Calculation workers are stateless and idempotent. They hydrate intermediate aggregates from tenant-specific materialized views before writing new snapshots.

---

## 3. Collection & Stream Schemas

Although deployed externally, the service mirrors our documentation standards so tenant teams can reason about integrations.

### 3.1 `insight_models`

* **Purpose:** Declares an insight computation blueprint for a tenant.
* **Structure:**
    ```json
    {
      "_id": "ObjectId()",
      "tenant_id": "ObjectId()",
      "key": "String",
      "name": "String",
      "description": "String",
      "status": "String",
      "dimensions": [
        {
          "key": "String",
          "weight": "Number",
          "aggregation": "String",
          "default_value": "Number",
          "input_event_types": ["String"]
        }
      ],
      "refresh_cadence": { "type": "String", "interval_minutes": "Number" },
      "created_at": "Date",
      "updated_at": "Date"
    }
    ```
* **Field Definitions:** `status` ∈ {`draft`, `active`, `suspended`}; `aggregation` ∈ {`sum`, `avg`, `max`, `min`}.

### 3.2 `insight_topics`

* **Purpose:** Represents the entity being scored by an insight model.
* **Structure:**
    ```json
    {
      "_id": "ObjectId()",
      "tenant_id": "ObjectId()",
      "model_id": "ObjectId()",
      "entity_reference": {
        "type": "String",
        "id": "String"
      },
      "metadata": {},
      "created_at": "Date",
      "updated_at": "Date"
    }
    ```

### 3.3 `insight_snapshots`

* **Purpose:** Stores immutable scoring outputs per topic and model. Guar[APP]ari tenants commonly maintain two model families:
    * **Event Quality Radar:** topics represent events/offers and dimensions can include `experience_quality`, `local_culture_index`, `inclusivity`, `logistics_score`, `partner_hospitality`. Scores render as radar graphs in tenant/partner UIs.
    * **Customer Engagement Radar (FCM-inspired):** topics represent users or invite trees and dimensions can include `invite_conversion`, `attendance_reliability`, `promotion_strength`, `feedback_sentiment`. Used to personalize rewards and highlight superfans.
* **Structure:**
    ```json
    {
      "_id": "ObjectId()",
      "tenant_id": "ObjectId()",
      "model_id": "ObjectId()",
      "topic_id": "ObjectId()",
      "score": "Number",
      "dimension_scores": [
        {
          "dimension_key": "String",
          "value": "Number",
          "weight": "Number",
          "contribution": "Number"
        }
      ],
      "rank": "Number",
      "generated_at": "Date",
      "source_event_window": {
        "start_at": "Date",
        "end_at": "Date"
      }
    }
    ```

### 3.4 Event Streams

* `insights.topic-events.{tenantKey}` – carries normalized business events (invite accepted, partner offer claimed, POI favorited, etc.).
* `insights.snapshot-updates.{tenantKey}` – emits new snapshot metadata for downstream caches (Flutter mock backend, partner dashboards).

---

## 4. Integration Contract

* **Authentication:** Service-to-service tokens issued by landlord identity. Tokens embed tenant scope claims so a Guar[APP]ari microservice can only publish/read its namespace.
* **Publishing Workflow:** Tenant backends transform domain events into the normalized `topic_event` schema and publish through landlord-managed Kafka. Required fields include `tenant_id`, `topic_reference`, `event_type`, `metrics`, and `occurred_at`.
* **Consumption Workflow:** Tenant applications subscribe to `snapshot-updates` for real-time leaderboards or query the service's REST API: `GET /v1/insights/{modelKey}/topics/{topicId}`.

---

## 5. Roadmap Alignment

* Phase 8 (Gamification Spine) of the Flutter roadmap consumes this service for ranking invites and partners and for rendering customer radar badges.
* Phase 10 (Tenant Home Aggregations) depends on leaderboard snapshots to feature trending offerings and radar summaries for marquee events.
* Future Partner Workspace modules reuse the same leaderboards for incentive design without re-implementing scoring logic and surface radar graphs for events/customers directly to partners.
