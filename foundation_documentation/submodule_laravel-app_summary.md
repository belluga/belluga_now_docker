# Documentation: Submodule Summary - laravel-app
**Version:** 1.0

## 1. Analyzed Version

* **Submodule Name:** `laravel-app`
* **Commit Hash:** `3c6b83a19d9baa3e66c40f85b8a4c7ac10488229`
* **Analysis Date:** `2025-12-24`

*Purpose: This document summarizes the key architectural aspects of the specified submodule version relevant to the main ecosystem.*

---

## 2. Core Dependencies & Technologies

* `laravel/framework` (^12.0): API framework.
* `mongodb/laravel-mongodb` (^5.4): MongoDB ODM/driver integration.
* `spatie/laravel-multitenancy` (^4.0): Tenant resolution and switching.
* `laravel/sanctum` (^4.0): Stateless token auth.
* `spatie/laravel-data` (^4.17): Data transfer object tooling.

---

## 3. Structural Patterns

* **Overall Structure:** MVC with application services and domain helpers; API controllers under `app/Http/Api/v1/Controllers`.
* **Key Patterns:** Multi-tenant middleware groups; service layer in `app/Application`; domain utilities in `app/Domain`.
* **Routing:** API routes are registered in `bootstrap/app.php` with explicit prefixes for tenant, landlord, initialize, and account scopes.

---

## 4. Ecosystem Configuration Points

* **Configuration Method:** `.env` + config files under `config/`.
* **Key Variables/Files:**
    * `config/database.php`: MongoDB connections (`mongodb`, `landlord`, `tenant`).
    * `DB_URI`, `DB_URI_LANDLORD`, `DB_URI_TENANTS`: MongoDB connection strings.
    * `config/multitenancy.php`: `DomainTenantFinder`, `SwitchMongoTenantDatabaseTask`, tenant/landlord connections.
    * `config/sanctum.php`: Sanctum token settings.
    * `bootstrap/app.php`: API route prefixes and middleware groups.

---

## 5. Architectural Principle Alignment

* **P-3 (API-Centric Ecosystem):** Aligned. Headless API with explicit route groups.
* **P-8 (Explicit Schemas):** Partially Aligned. Request validation exists, but endpoint schemas still require consolidation in foundation docs.
* **P-11 (Stateless Authentication):** Aligned. Sanctum token-based auth.
* **P-12 (Resource-Oriented Naming):** Partially Aligned. Resource naming present, but some routes vary from roadmap conventions.
* **P-18 (Ingress Configuration Parity):** Partially Aligned. Route prefixes exist; ingress parity must be maintained via docs.

---

## 6. Key Integration Points / API Surface (If Applicable)

* **API Prefix/Base:** `/api/v1`, `/admin/api/v1`, `/api/v1/initialize`, `/api/v1/accounts/{account_slug}`
* **Primary Endpoints/Modules:** Tenant auth, identity, accounts, roles, branding; landlord admin routes.
* **Authentication Method:** Laravel Sanctum tokens with abilities.

---

## 7. Notes & Observations

* Tenant resolution uses `DomainTenantFinder` with MongoDB database switching (`SwitchMongoTenantDatabaseTask`).
* Anonymous identity flow is implemented with fingerprint-based idempotency and tenant-driven ability/TTL policy.
