# Documentation: System Architectural Principles

**Version:** 1.2
**Date:** October 16, 2025
**Authors:** Belluga Learning & Engineering

## 1. Overview

This document establishes the fundamental architectural principles and non-negotiable design decisions that govern the entire platform. It serves as the central source of truth to ensure consistency, scalability, and maintainability across all modules, present and future.

Any new module or service developed for the platform **must** strictly adhere to the principles defined herein.

---

## 2. Global Architectural Principles

### 2.1. Nested Multi-tenancy Model

This is the platform's most critical architectural decision. It defines how data is organized and isolated.

* **Declaration:** The platform operates on a multi-level tenancy model, consisting of:
    1.  **Landlord:** The highest level, managing the entire ecosystem. There is a single data context (database) for the Landlord.
    2.  **Tenant:** The primary client (e.g., a large corporation). Each Tenant has its own dedicated database, ensuring physical data isolation from other Tenants.
    3.  **Account:** A sub-organization or "branch" within a Tenant (e.g., the Sales department of the corporation). Multiple Accounts can exist within a single Tenant and **share the Tenant's database**.

* **Justification:** This hybrid model offers the best of both worlds. Database-level separation for **Tenants** provides maximum security and isolation. Logical segregation by `account_id` within a **Tenant's** database allows for shared configurations and users while separating operational data, accurately reflecting the business model.

* **Practical Implication:** When designing a new collection, the engineer must answer two fundamental questions:

    1.  **In which database context does this collection reside?**
        * **Landlord Database:** For global data that governs the platform (e.g., list of tenants, subscription plans).
        * **Tenant Database:** For data belonging to a specific client (the vast majority of collections).

    2.  **If in a Tenant Database, is the data scoped by Account?**
        * **NO (Tenant-level data):** If the data is a configuration or resource shared by all Accounts within that Tenant. **The collection must NOT have an `account_id` field**.
            * *Examples:* `users` (a user can belong to multiple accounts), `skill_configurations`, `skills`, `learning_objects` (the raw content library).
        * **YES (Account-level data):** If the data is operational and belongs to a specific Account. **The collection MUST have an `account_id` field for filtering**.
            * *Examples:* `courses` (a course is a specific offering for an account), `cohorts`, `enrollments`, `progress_trackers`.

### 2.2. Decoupled Communication via Event-Driven Architecture

* **Declaration:** Communication between the system's core modules (e.g., Learning Engine, Skills Engine) **must** be performed asynchronously via an eventing system.
* **Justification:** Decoupling is crucial for maintainability and the independent evolution of modules. This increases the platform's resilience and development agility.
* **Practical Implication:**
    * A module must never interact directly with another module's database.
    * When firing an event, the payload must contain all necessary context for listeners to act, including relevant identifiers like `tenant_id` (for event routing), `user_id`, and, if applicable, `account_id`.

### 2.3. Safe Configuration via the "Prototype Configuration Pattern"

* **Declaration:** For entities requiring complex, reusable configuration (e.g., `prices`, `quizzes`), the system **must** utilize the **Prototype Configuration Pattern**. This pattern involves a library of "prototypes" (templates) that are cloned to create a new concrete instance.
* **Justification:** This pattern offers the best of both worlds: the efficiency of reusable templates and the safety of immutable records. By copying (snapshotting) the configuration at the moment of creation, the new entity becomes completely decoupled from its original prototype. This prevents accidental global changes and guarantees a perfect historical record, which is critical for the integrity of commercial and academic data.
* **Practical Implication:**
    * **Creation:** When creating a new object (e.g., a `price`), the user can select a `price_template`. The system then copies the template's content into the new `price` document.
    * **Immutability:** The new object is self-contained. Future changes to the template **will not** affect objects already created from it.
    * **Traceability:** The concrete object should store the ID of its original prototype (e.g., `source_template_id`) for analysis and auditing purposes only, without creating an active database link.

### 2.4. Naming and Documentation Consistency

* **Declaration:** All system components must follow standardized naming conventions and be accompanied by documentation that adheres to the established standard.
* **Justification:** Consistency reduces cognitive load, accelerates the onboarding of new engineers, and makes the system more predictable.
* **Practical Implication:**
    * **MongoDB Collections:** `snake_case`, always plural (e.g., `learning_objects`, `insight_rules`).
    * **Document Fields:** `snake_case` (e.g., `user_id`, `completed_at`, `account_id`).
    * **Module Documentation:** Must follow the structure of `learning_engine.md` (`Overview`, `Principles`, `Detailed Schema`, etc.).

### 2.5. Presentation-to-Infrastructure Dependency Rule

* **Declaration:** In application clients (Flutter, Laravel), controllers or domain services are the only layers allowed to coordinate multiple repositories. Repositories never call other repositories directly; services declared as "UserLocationService", "AnalyticsService", etc., are thin abstractions over repositories and follow the same rule.
* **Justification:** This keeps dependency arrows pointing inward (presentation → domain → data), preserves testability, and prevents caching/persistence responsibilities from leaking across repositories.
* **Practical Implication:**
    * `LocationRepository`, `PoiRepository`, `InviteRepository`, etc., expose deterministic contracts and can be composed by controllers or dedicated domain services. A controller that needs both location and POIs injects both repositories (or their service facades) and orchestrates the flow.
    * Feature services may wrap one repository (e.g., `UserLocationService` uses `LocationRepository`) but must be injected like repositories and consumed only by controllers/domain services.
    * Shared data (user location, auth state, analytics context) is published via DI services, not by having repositories reach into each other’s caches.
