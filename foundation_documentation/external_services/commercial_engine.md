# Documentation: The Commercial Engine

**Version:** 1.0  
**Date:** October 16, 2025  
**Authors:** Belluga Learning & Engineering  
**Service Classification:** External Microservice (shared across tenants)

## 1. Overview

This document describes the architecture of two distinct but commercially related domains: the **Financial Engine** and the **Attribution Engine**. While documented together for efficiency, they operate as **separate, decoupled conceptual modules** that together manage the platform's entire commercial lifecycle.

* **The Financial Engine:** Manages the "what" and "how" of a sale. Its scope includes a flexible product catalog, advanced pricing models, contract management, invoicing, payment processing, and a full suite of financial instruments like coupons, refunds, and service credits.
* **The Attribution Engine:** Manages the "who" or "why" behind a sale. It tracks the sources of new business, such as affiliates, salespeople, and marketing campaigns, answering the question: "Who gets credit for this sale?"

The two engines are cleanly decoupled. The integration point is an `attribution` object stored as an immutable **snapshot** within the Financial Engine's `contracts` collection. This ensures that the Financial Engine has no direct dependency on the Attribution Engine's data, upholding our core architectural principles.

---

## 2. Design Principles

### Design Principles (Financial)

* **Flexible Product Catalog Model:** The engine uses a two-level catalog (`catalog_items` and `products`) to cleanly separate the definition of an item from how it is packaged and sold.
* **Prototype Configuration for Prices:** To ensure safety and efficiency, all `prices` are created using the **Prototype Configuration Pattern**. A library of reusable `price_templates` allows for the rapid creation of new commercial terms, which are then snapshotted into a `price` document, making it a complete, self-contained record.
* **Immutable Versioning for Prices:** A `price` is considered an immutable commercial offer. To "edit" a price, the system deactivates the existing record and creates a new, versioned clone with the updated terms. This provides a perfect, auditable history of all commercial terms offered over time.
* **The Price as the Source of Truth:** A `product` can have multiple `prices`. The `prices` collection is the source of truth for all commercial terms, and a `contract` is an immutable snapshot of a specific `price` at the time of sale.
* **Event-Driven Architecture:** The engine operates independently, emitting events for significant financial state changes (e.g., `PaymentSucceeded`, `ContractStatusChanged`) to ensure eventual consistency across the platform without creating hard dependencies.

### Design Principles (Attribution)

* **Unified Source Model for Flexibility:** The engine uses a single, unified `attribution_sources` collection with a `type` discriminator to consistently manage diverse entities like affiliates, salespeople, and campaigns.
* **Decoupled Integration via Snapshotting:** To maintain strict decoupling, the `contracts` collection stores a snapshot of key attribution details at the time of sale. This ensures historical financial records remain accurate even if the original attribution source's details change later.
* **Immutable Touchpoint Logging:** The `touchpoints` collection provides a complete, immutable audit trail of every significant customer interaction, which is crucial for analytics and resolving commission disputes.

---

## 3. Detailed Collection Schemas

### Financial Engine Collections

The following collections reside in the database of each **Tenant**.

#### `catalog_items`

* **Purpose**: The master list of every individual, atomic item the school can sell.
* **Structure**:
    ```json
    {
        "_id": "ObjectId()",
        "account_id": "ObjectId()",
        "name": "String",
        "type": "String",
        "active": "Boolean",
        "thumbnail_url": "String",
        "media_gallery": [
            {
                "url": "String",
                "type": "String",
                "description": "String"
            }
        ],
        "details": {}
    }
    ```
* **Field Definitions:**
    * `type`: `"course_bundle"`, `"physical_good"`, `"service"`.
    * `media_gallery.type`: `"image"`, `"video"`.

#### `products`

* **Purpose**: A sellable package or bundle composed of items from the master catalog.
* **Structure**:
    ```json
    {
      "_id": "ObjectId()",
      "account_id": "ObjectId()",
      "name": "String",
      "description": "String",
      "active": "Boolean",
      "thumbnail_url": "String",
      "media_gallery": [
        {
            "url": "String",
            "type": "String",
            "description": "String"
        }
      ],
      "items": [
        {
            "item_id": "ObjectId()",
            "quantity": "Number"
        }
      ]
    }
    ```

#### `price_templates`

* **Purpose**: A library of reusable, prototypical commercial terms that can be used to create new `prices`.
* **Structure**:
    ```json
    {
      "_id": "ObjectId()",
      "account_id": "ObjectId()",
      "name": "String",
      "is_archived": "Boolean",
      "template_data": {
        "description": "String",
        "billing_model": "String",
        "billing_timing": "String",
        "billing_cycle": { "interval": "String", "interval_count": "Number" },
        "trial": { "type": "String", "duration_days": "Number" },
        "cancelation_policy": {
            "fee_type": "String",
            "grace_period": { "duration_days": "Number" }
        },
        "enrollment_fee": { "amount": "Decimal128", "name": "String" },
        "pricing_phases": [
          { "duration_in_cycles": "Number", "amount_per_cycle": "Decimal128" }
        ],
        "metered_components": [
          { "item_name": "String", "unit_name": "String", "price_per_unit": "Decimal128" }
        ]
      }
    }
    ```

#### `prices`

* **Purpose**: Defines the specific commercial terms for selling a `product`. Each document is a self-contained, immutable record created from a `price_template`.
* **Structure**:
    ```json
    {
      "_id": "ObjectId()",
      "account_id": "ObjectId()",
      "product_id": "ObjectId()",
      "source_template_id": "ObjectId()",
      "version": "Number",
      "previous_version_id": "ObjectId()",
      "active": "Boolean",
      "is_default": "Boolean",
      "description": "String",
      "billing_model": "String",
      "billing_timing": "String",
      "billing_cycle": { "interval": "String", "interval_count": "Number" },
      "trial": { "type": "String", "duration_days": "Number" },
      "cancelation_policy": {
            "fee_type": "String",
            "grace_period": { "duration_days": "Number" }
      },
      "enrollment_fee": { "amount": "Decimal128", "name": "String" },
      "pricing_phases": [
        { "duration_in_cycles": "Number", "amount_per_cycle": "Decimal128" }
      ],
      "metered_components": [
        { "item_name": "String", "unit_name": "String", "price_per_unit": "Decimal128" }
      ]
    }
    ```
* **Field Definitions:**
    * `billing_model`: `"one_time"`, `"fixed_installments"`, `"standard_subscription"`, `"accruing_subscription"`.
