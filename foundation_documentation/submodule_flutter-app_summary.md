# Documentation: Submodule Summary - flutter-app
**Version:** 1.0

## 1. Analyzed Version

* **Submodule Name:** `flutter-app`
* **Commit Hash:** `70f764f0bda38e32365df4c6410a47de725f6ea8`
* **Analysis Date:** `2025-12-13`

*Purpose: This document summarizes the key architectural aspects of the specified submodule version relevant to the main ecosystem.*

---

## 2. Core Dependencies & Technologies

* `Flutter (via FVM)`: Primary UI toolkit; commands run through `fvm flutter …`.
* `auto_route`: Declarative, code-generated navigation and guard management.
* `get_it`: DI container used for controller/repository/service wiring.
* `get_it_modular_with_auto_route`: Submodule-style route aggregation + ModuleScope pattern.
* `dio`: HTTP client used by Laravel-backed adapters (e.g., environment/app branding fetch).
* `sentry_flutter`: Error + performance reporting (bootstrapped in `lib/main.dart`).
* `flutter_map` / `latlong2`: Map rendering and geo primitives for the tenant map experience.
* `stream_value`: Reactive state holder for controller-owned state → widgets.
* `value_object_pattern`: Value-object layer used for UI/domain primitives (IDs, icons, URIs, etc.).

---

## 3. Structural Patterns

* **Overall Structure:** Layered boundaries (`application`, `domain`, `infrastructure`, `presentation`) with feature-first presentation modules (`tenant/*`, `landlord/*`, `prototypes/*`).
* **Key Patterns:**
    * Controller-owned state via `StreamValue`; widgets act as (mostly) pure renderers.
    * Repository contracts live in `lib/domain/repositories/*`; implementations in `lib/infrastructure/repositories/*`.
    * DAL split between DTOs (`lib/infrastructure/dal/dto/*`) and backend adapters (`lib/infrastructure/dal/dao/*`), with mocks as the default data source.
    * Navigation is defined via AutoRoute and assembled through modular route providers (`lib/application/router/modular_app/*`).

---

## 4. Ecosystem Configuration Points

* **Configuration Method:** DI wiring through GetIt + module registration (`ModuleSettings`); backend adapters default to mock implementations with targeted Laravel-backed adapters for environment/bootstrap.
* **Key Variables/Files:**
    * `.fvmrc` / `.fvm/fvm_config.json`: Flutter SDK pinning.
    * `pubspec.yaml`: Declares third-party packages and Flutter SDK constraints.
    * `analysis_options.yaml`: Lints/analysis rules expected to stay clean.
    * `lib/application/router/modular_app/module_settings.dart`: Global registrations, backend selection, and submodule route initialization.
    * `lib/application/configurations/belluga_constants.dart`: Derives API base/admin URLs from `AppData` (bootstrapped at startup).
    * `foundation_documentation/` (symlink): Shared domain/roadmap source of truth.

---

## 5. Architectural Principle Alignment

* **P-1 (Domain-First, Schema-Second):** Partially Aligned — Domain entities and value objects exist, but partner subtype vocabulary (e.g., influencer/curator) and engagement metrics still need stricter documentation traceability in foundation docs.
* **P-3 (API-Centric Ecosystem):** Partially Aligned — The app bootstraps against a Laravel-backed environment endpoint, while most feature data remains mock-backed to unblock UI/flow development ahead of finalized API delivery.
* **P-8 (Explicit Schemas):** Partially Aligned — Significant DTO coverage exists (app_data, schedule, invites, profile, map), but mock databases (notably partners/discovery) still encode schema expectations implicitly.
* **Appendix A (Flutter Tenets):** Partially Aligned — Feature-first organization and controller/stream patterns are present; continued tightening is needed to keep DTOs out of widgets and keep screen logic consistently controller-driven.

---

## 6. Key Integration Points / API Surface (If Applicable)

* **API Prefix/Base:** `https://{AppData.hostname}/api` (derived at runtime from the environment bootstrap payload).
* **Primary Endpoints/Modules (Current Consumer Shape):** App environment/bootstrap (branding + theme), schedule/events, invites, favorites, partners/discovery, profile, map POIs (mixed: bootstrap via Laravel adapter; others primarily mock-backed).
* **Authentication Method:** Presentational auth flows exist, but repository/backends are currently mock-focused; secure storage is available for future token/session persistence.

---

## 7. Notes & Observations

* Environment/bootstrap is implemented via a Laravel-backed adapter (`/environment?app_domain=…`) and must remain aligned with the backend payload keys used for branding (e.g., `main_logo_light_url`, `main_icon_dark_url`, `theme_data_settings`).
* Partners/discovery continues to rely on local mock databases that embed subtype and engagement expectations; these should be treated as prototype contracts and mirrored in foundation documentation to prevent Flutter ↔ Laravel drift.
* `ModuleSettings` supports test-time backend builders, enabling targeted tests to swap mock/real adapters without changing production wiring.
