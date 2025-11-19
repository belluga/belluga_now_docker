# Flutter Submodule Summary

**Submodule path:** `/flutter-app`  
**Source commit:** `8f105ca0d45d5bd60fc7c3f9d8856eb1ebeba6b2` (matches current submodule head)

## Current Execution Mandate

We are establishing a full-featured **Mock App** ahead of the Laravel delivery so that the Flutter client can harden the domain models, interaction flows, and value objects first. The Laravel team will subsequently align their contracts to the shapes validated inside this mock. All Flutter work must therefore:

1. Model every interaction against the canonical domain entities (`User`, `Partner`, `Offering`, `Transaction`) defined in `foundation_documentation/domain_entities.md`.
2. Document any new data requirements directly in `foundation_documentation/` before requesting backend work.
3. Expose mocks that are forward-compatible with the Laravel API surface rather than ad-hoc UI conveniences.

## Architectural Baseline

- Modular layering (`application`, `domain`, `infrastructure`, feature-oriented presentation) remains the enforced topology.
- Navigation continues to use `auto_route` for declarative route maps.
- All feature flows (Authentication, Tenant, Landlord) are implemented as mocks that must mirror the future API contract.

## Identified Flutter Disalignments

| Area | Finding | Required Remediation |
| --- | --- | --- |
| Domain projections | `lib/domain/venue_event/projections/venue_event_resume.dart` introduces a `VenueEvent` projection that is not tied to any documented entity and hydrates directly from `EventModel`. | Reframe the projection as an `Offering` (Event Offering) view or update the domain docs + Laravel contracts to include `VenueEvent`. Decouple from UI models by introducing DTOs sourced from the API contract. |
| Artist modeling | Artists are represented as `List<String>` with a `'Belluga Now'` default, breaking P-1 (domain fidelity) and P-6 (single source of truth). | Introduce value objects keyed to `Partner` identities (e.g., `ArtistIdentityValue`) and define fallback behavior in the shared documentation so the backend mirrors it. |
| Temporal guarantees | `DateTimeValue` reliance on `assert` means nulls would surface in release builds. | Enforce non-null invariants inside the value object (throw domain errors) and add contract tests to reject incomplete schedule payloads. |
| Layer isolation | Domain types import presentation-layer models (`EventModel`), collapsing the boundary described in `foundation_documentation/submodule_flutter-app_summary.md`. | Create boundary DTOs generated from mocked API responses; application layer performs the translation into domain projections. |

These misalignments block our ability to snapshot the mock as a canonical contract for Laravel and therefore have roadmap priority.

## Roadmap (Mock-First Flutter Track)

1. **Domain Contract Hardening**
   - Catalog every domain-facing model and map it to the authoritative entity/value object.
   - Produce DTO definitions (JSON + Dart) for each API surface we mock, ensuring fields, enums, and validation rules are spelled out.
2. **Projection & Aggregation Refactor**
   - Restructure projections such as `VenueEventResume` to consume the new DTOs and persist only domain-aligned value objects.
   - Remove cross-layer imports so `domain/` is source-of-truth for invariants.
3. **Mock Data Orchestration**
   - Centralize mock providers per endpoint (e.g., `/v1/offerings/events`) with fixtures that Laravel can reuse.
   - Document mock payloads in `foundation_documentation/` to keep Flutter and Laravel synchronized.
4. **Readiness Signal for Laravel**
   - Once each feature’s mock surface is stable, record the schema snapshot and notify backend teams via the shared documentation channel so they can implement matching endpoints.

This roadmap keeps Flutter ahead while ensuring every mock artifact is an explicit contract the Laravel team can adopt without guesswork.

## Domain Inventory & Controller Coupling

### Canonical Entities

| Entity | Source Path | Notes | Controller / Feature Touchpoints |
| --- | --- | --- | --- |
| User | `lib/domain/user/user_contract.dart` | Canonical consumer identity built from `MongoIDValue` and `UserProfileContract`. Needs value-object coverage for every PII field (profile photo, birthday, etc.). | `ProfileScreenController` pulls `UserContract` via `AuthRepositoryContract` for display and sign-out flows (`lib/presentation/tenant/profile/screens/profile_screen/controllers/profile_screen_controller.dart`). Auth/login controllers share the same repository stream. |
| Tenant | `lib/domain/tenant/tenant.dart` | Represents the hosting venue or white-label tenant; couples to `AppData` and resolves domains/subdomains. | Initialization flows call into `BellugaInitScreenControllerContract` which bootstraps `AuthRepositoryContract`, then `InitScreenController` selects tenant/home routes based on results. |
| Schedule Event (Offering) | `lib/domain/schedule/event_model.dart` | Primary representation of calendar offerings, carrying title, HTML content, artists, geo, and slot times. Works as the upstream source for projections such as `VenueEventResume`. | `ScheduleScreenController`, `EventDetailController`, tenant home, and invites builder query `ScheduleRepositoryContract` for lists or details. |
| Invite | `lib/domain/invites/invite_model.dart` | Represents social/transactional invitations with participants and partner info. | `InviteFlowScreenController` orchestrates decisions using `InvitesRepositoryContract`, while tenant home’s invites banner consumes the shared stream for highlights. |
| Favorite (placeholder) | `lib/domain/favorite/favorite.dart` | Comment-only stub indicates future aggregate; today only `FavoriteResume` projections exist. | `TenantHomeController` consumes `FavoriteRepositoryContract.fetchFavorites()` returning resumes, so controllers are blocked until the entity is finalized. |
| City POI / Map Regions | `lib/domain/map/*.dart` | Encapsulate partner-supplied points of interest, categories, and coordinates that underpin the city map experience. | Map module controllers (`lib/presentation/tenant/map/.../controllers`) query `CityMapRepositoryContract` for POIs, categories, and regions. |

### Projection Catalog

- `VenueEventResume` (`lib/domain/venue_event/projections/venue_event_resume.dart`) — Event teaser projection derived from `EventModel` and used by tenant home hero and schedule cards.
- `FavoriteResume` (`lib/domain/favorite/projections/favorite_resume.dart`) — Lightweight depiction of a favorite item; currently the only consumable favorite shape.
- `ScheduleSummaryModel` & `ScheduleSummaryItemModel` (`lib/domain/schedule/`) — Temporal projection that drives calendar pagination and highlights for `ScheduleScreenController`.
- `CourseChildrenSummary`, `CourseItemModel`, etc. (`lib/domain/courses/`) — Additional projections around learning content; need reconciliation with Offering/Partner definitions before wiring to controllers.

### Controller Coupling Observations

1. **Tenant Home aggregation** — `TenantHomeController` composes favorites, featured events, and upcoming events by calling three repository contracts, then adapts `EventModel` into `VenueEventResume` inside the controller. This leaks projection logic out of repositories and should be moved into mappers backed by documented DTOs.
2. **Schedule experience** — `ScheduleScreenController` relies on synchronous `StreamValue` wiring while performing repository fetches for both summary and per-day events. We must ensure repository outputs already enforce `DateTimeValue` invariants instead of letting controllers filter nulls.
3. **Invite flows** — Controllers consume domain `InviteModel` objects directly with no intermediate projection, matching our target contract. These mocks should therefore be promoted to the shared documentation so Laravel can implement the same payload.
4. **Map module** — Controllers under `lib/presentation/tenant/map/.../controllers` query domain repositories for POIs and categories but the corresponding entities are not yet documented in `foundation_documentation/domain_entities.md`. We need to add these geo/partner projections (or align them to Partner subtypes) before solidifying API contracts.

#### Clarifying Repository Outputs

- Controllers are allowed to consume **models** (full aggregates such as `EventModel`, `InviteModel`) whenever they need the entire contract for business logic or detailed rendering.
- **Projections** (e.g., `VenueEventResume`, `FavoriteResume`, `ScheduleSummaryItemModel`) are reusable snapshots or summaries derived from those models. They exist for states like previews, carousels, or badges where the full aggregate would be excessive.
- Repositories decide whether a call returns a model or a projection. Controllers should not rebuild projections from models; instead, they request the appropriate shape (`getEventsByDate` for full models, `getEventResumesByDate` for summaries) so that mapping logic stays centralized and reusable across screens.

### Outstanding Alignment Tasks

- Promote every projection that maps to a canonical entity (favorites, venue events, schedule summaries) into repository-returned DTOs so controllers receive target-state contracts instead of crafting them on the fly.
- Update `foundation_documentation/domain_entities.md` with any additional aggregates we plan to support (e.g., Experiences/Courses, City POIs) or consolidate them under the existing `Offering` and `Partner` umbrellas.
- Ensure repository contracts emit only domain entities, while projections live either in dedicated read-model packages or UI mappers. This will keep controllers declarative and make it easier for Laravel to mirror the contract.
