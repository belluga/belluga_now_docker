# Documentation: Flutter Client Experience Module
**Version:** 1.0

## 1. Module Index

| Module ID | Module Name | Primary Responsibility | Status | Owner |
|-----------|-------------|------------------------|--------|-------|
| MOD-201 | Flutter Client Experience Module | Deliver the multi-tenant mobile client with mocked backends and full-layer architecture (controllers, repositories, services). | Defined | Delphi |

## 2. Module Specification

### MOD-201: Flutter Client Experience Module

* **Purpose Statement:** Establish the foundational Flutter application that orchestrates tenant, partner, and promoter experiences through a clean architecture stack (presentation, domain, infrastructure) wired to mocked service contracts that mirror the definitive API.
* **Core Entities:** User, Partner, Offering, Transaction.
* **Key Workflows:** Adaptive onboarding, tenant home discovery, invite and social growth loop, agenda management, map exploration with POIs, authenticated profile utilities.
* **External Dependencies:** AutoRoute (navigation), GetIt (DI container), StreamValue (reactive state wrapper), value_object_pattern, Firebase Cloud Messaging (future push integration), mocked HTTP/WebSocket backends.
* **Service-Level Objectives:** Screen state transitions <150 ms under mock data; cold-start bootstrap <2.5 s on mid-range devices; navigation stack integrity with zero controller leaks; 100 % controller-stream parity (no orphaned state).

#### 2.1 Domain Rules

* **Invariants:** Controllers are the sole owners of state mutations; widgets remain presentational; every domain entity surfaces as a value-object backed model; DI registrations occur before route build.
* **Validation Rules:** Input fields rely on domain value objects (e.g., `EmailValue`, `PasswordValue`); invite codes enforce length 6–12; POI filter radius 1–50 km; schedule entries require ISO-8601 timestamps.
* **Authorization Requirements:** Anonymous flow limited to onboarding and invite acceptance; authenticated tenant scope unlocks home, schedule, map; partner scope exposes partner dashboards (future flavor); promoter scope requires explicit feature flag.

#### 2.2 API Endpoint Definitions

| Endpoint | Method | Description | Required Role | Request Schema | Response Schema |
|----------|--------|-------------|---------------|----------------|-----------------|
| `/v1/app/home-overview` | GET | Fetches the tenant home composition (hero sections, featured offerings, invite prompts). | Tenant | `HomeOverviewRequest` | `HomeOverviewResponse` |
| `/v1/app/invites` | GET | Retrieves pending invites and social proof metadata for the current user. | Tenant | `InviteFeedRequest` | `InviteFeedResponse` |
| `/v1/app/agenda` | GET | Provides schedule entries, suggested actions, and contextual CTAs. | Tenant | `AgendaRequest` | `AgendaResponse` |
| `/v1/app/map/pois` | GET | Returns POIs for the active viewport and filter set. | Tenant | `MapPoisRequest` | `MapPoisResponse` |
| `/v1/app/profile` | GET | Delivers profile summary, identity claims, and linked partner roles. | Tenant | `ProfileRequest` | `ProfileResponse` |
| `/v1/app/onboarding/context` | GET | Supplies localization strings, branding palette, and dynamic CTA verbs. | Anonymous | `OnboardingContextRequest` | `OnboardingContextResponse` |

*Success/Failure Handling:* All endpoints return `metadata.request_id` for tracing, success payloads encapsulated in `data`, and standardized error envelopes with `error.code`, `error.message`, `error.hints[]`. Mock implementations must reproduce this contract exactly.
*Rate Limiting:* Soft limit of 5 req/min per endpoint during mock stage to mirror production throttles; burst handling delegated to controller retry strategies.

#### 2.3 Data Schemas

##### Collection: home_overviews

**Schema Definition**

| Field | Type | Description | Required | Notes |
|-------|------|-------------|----------|-------|
| `_id` | ObjectId | Unique overview snapshot identifier. | Yes | Mirrors backend document ID. |
| `user_id` | ObjectId | Reference to the user receiving the overview. | Yes | Cached for mock personalization. |
| `hero_sections` | Array\<HeroSectionDocument\> | Ordered hero modules rendered at top of home. | Yes | Minimum 1 item. |
| `featured_offerings` | Array\<OfferingSummaryDocument\> | Highlighted offerings curated for the user. | Yes | Max 12. |
| `cta_banner` | CtaBannerDocument | Primary action banner targeting conversions. | No | Nullable when no banner active. |
| `social_proof` | Array\<SocialProofDocument\> | Invites and friend activity for viral loop. | Yes | Provide at least one entry. |
| `generated_at` | DateTime | UTC timestamp for snapshot generation. | Yes | ISO-8601 string in transport. |

**Field Definitions**

* `HeroSectionDocument.layout_type`: Valid values are `grid`, `carousel`, `single_callout` — defines widget template to instantiate.
* `OfferingSummaryDocument.cta_type`: Valid values are `follow`, `book`, `buy`, `share` — maps to localized CTA verbs.
* `CtaBannerDocument.priority`: Valid values are `high`, `medium`, `low` — determines placement stacking order.

##### Collection: invite_feeds

**Schema Definition**

| Field | Type | Description | Required | Notes |
|-------|------|-------------|----------|-------|
| `_id` | ObjectId | Feed snapshot identifier. | Yes | |
| `user_id` | ObjectId | User owning the invite queue. | Yes | |
| `invites` | Array\<InviteDocument\> | Active invites requiring attention. | Yes | Sorted by `created_at`. |
| `referral_chain` | Array\<ReferralNodeDocument\> | Historical inviter graph for analytics. | No | |
| `generated_at` | DateTime | Snapshot timestamp. | Yes | |

**Field Definitions**

* `InviteDocument.type`: Valid values are `tenant_share`, `partner_campaign`, `event_guestlist` — orchestrates controller handling.
* `InviteDocument.status`: Valid values are `pending`, `accepted`, `declined`, `expired` — drives UI badge state.
* `ReferralNodeDocument.relationship`: Valid values are `direct`, `indirect`, `influencer` — indicates invitation depth.

##### Collection: agenda_entries

**Schema Definition**

| Field | Type | Description | Required | Notes |
|-------|------|-------------|----------|-------|
| `_id` | ObjectId | Agenda item identifier. | Yes | |
| `user_id` | ObjectId | User associated with the entry. | Yes | |
| `schedulable_id` | ObjectId | Reference to offering/event. | Yes | |
| `schedulable_type` | String | Type discriminator for the schedulable item. | Yes | Mirrors backend polymorphic type. |
| `start_time` | DateTime | Event start timestamp. | Yes | ISO-8601. |
| `end_time` | DateTime | Event end timestamp. | No | Optional for instantaneous items. |
| `status` | String | Participation state. | Yes | |
| `cta` | CtaDescriptorDocument | Action user can take next. | Yes | |
| `metadata` | Map | Arbitrary structured data (e.g., dress code, location). | No | Key-value pairs. |

**Field Definitions**

* `schedulable_type`: Valid values are `event`, `experience`, `product_pickup`, `invite_task`.
* `status`: Valid values are `upcoming`, `checked_in`, `cancelled`, `completed`.
* `CtaDescriptorDocument.intent`: Valid values are `confirm`, `reschedule`, `share`, `review`.

##### Collection: map_pois

**Schema Definition**

| Field | Type | Description | Required | Notes |
|-------|------|-------------|----------|-------|
| `_id` | ObjectId | POI identifier. | Yes | |
| `partner_id` | ObjectId | Owning partner reference. | Yes | |
| `category` | String | High-level POI category. | Yes | |
| `tags` | Array\<String\> | Secondary classification tags. | Yes | Max 10. |
| `priority` | Integer | Render stacking priority (higher first). | Yes | 0–100. |
| `geo` | GeoPointDocument | Latitude/longitude and viewport metadata. | Yes | |
| `live_status` | String | Current live state. | Yes | |
| `available_offers` | Array\<OfferDocument\> | Offers attached to the POI. | No | |

**Field Definitions**

* `category`: Valid values are `food_drink`, `music`, `art`, `nature`, `mobility`.
* `live_status`: Valid values are `static`, `live_event`, `sponsored_highlight`.
* `OfferDocument.kind`: Valid values are `discount`, `bundle`, `vip_pass`.

##### Collection: profile_summaries

**Schema Definition**

| Field | Type | Description | Required | Notes |
|-------|------|-------------|----------|-------|
| `_id` | ObjectId | Profile snapshot ID. | Yes | |
| `user_id` | ObjectId | Primary user identifier. | Yes | |
| `display_name` | String | Render-ready name. | Yes | 1–64 chars. |
| `avatar_url` | String | Remote image URL. | No | Must be HTTPS. |
| `roles` | Array\<String\> | Active roles (tenant, partner, promoter). | Yes | Non-empty. |
| `permissions` | Array\<String\> | Granted permissions or feature flags. | Yes | |
| `connected_partners` | Array\<ConnectedPartnerDocument\> | Partners the user manages or follows. | No | |
| `last_synced_at` | DateTime | Timestamp for last profile sync. | Yes | |

**Field Definitions**

* `roles`: Valid values are `tenant`, `partner`, `promoter`.
* `permissions`: Valid values are `manage_pois`, `send_notifications`, `access_reports`, `beta_feature`.
* `ConnectedPartnerDocument.relationship`: Valid values are `owner`, `manager`, `fan`.

#### 2.4 Event & Messaging Contracts

* **Outbound Events:** `app.session_bootstrapped` emitted when the bootstrap sequence finalizes, payload includes `user_id`, `active_modules`, `timestamp`. `app.invite_consumed` fired when an invite transitions to `accepted`.
* **Inbound Events:** `poi.moved`, `offer.activated`, `offer.deactivated` simulated through WebSocket mock; controllers ensure idempotent application by comparing `event.sequence`.
* **Queue/Topic Configuration:** FCM topics follow `partner_{partnerId}` naming; mocked notifier replicates topic subscription flow to guarantee DI wiring.

#### 2.5 Background Jobs & Schedulers

* Application schedules `DailyRefreshJob` (7 AM local) to refresh cached home overview and agenda using background fetch APIs.
* `InviteExpirySweep` runs hourly to mark stale invites and emit UI updates.
* Jobs delegate to controllers’ services and honor app lifecycle (pause/resume) to avoid stale state.

#### 2.6 Observability & Instrumentation

* **Logs:** Structured debug logs via `dart:developer` with fields `{event, controller, payloadHash}`; upload to Crashlytics in production.
* **Metrics:** Custom analytics events (`home_section_view`, `invite_action`, `poi_tap`) proxied through a unified `AnalyticsService`.
* **Tracing:** Session traces captured with Firebase Performance; spans named `Controller::<Action>` (e.g., `TenantHomeController::loadOverview`).
* **Alerts:** Crash-free sessions threshold ≥99%; analytics anomaly detection (invite acceptance drop >20 % triggers alert).

#### 2.7 Testing Strategy

* **Unit Tests:** 100 % coverage for controllers’ state transitions, repository mocks, and value object validations.
* **Integration Tests:** AutoRoute navigation flows, DI bootstrap, and StreamValue-driven UI updates using `flutter_test`.
* **Contract Tests:** Golden contract tests ensuring mock responses match schema definitions; WebSocket event shape validation.
* **Performance Tests:** Frame budget tests for home, map, and schedule screens under 60 fps minimum using `integration_test`.

## 3. Cross-Module Considerations

* **Shared Libraries:** `lib/application` hosts theming and localization contracts; `lib/presentation/shared/widgets` houses reusable components (e.g., `MainLogo`, `BellugaBottomNavigationBar`); `lib/domain/value_objects` encapsulates validation logic shared across modules.
* **Data Ownership Boundaries:** Mock repositories remain the single source of truth for state; cached DTOs never overwrite domain models without controller orchestration.
* **Failure & Degradation Modes:** When WebSocket mock disconnects, controllers downgrade to polling (`/v1/app/map/pois`) and surface passive UI states; offline mode caches last successful responses and displays timestamped banners.

## 4. Implementation Notes

* **Code Structure:** Four-layer directory layout (`application/`, `domain/`, `infrastructure/`, `presentation/`) with feature-first organization under `presentation/tenant/screens/**`. Each screen owns a controller in `controllers/` and a repository contract in `domain/repositories/`.
* **Configuration Management:** `.env.dart` defines environment toggles; `MockEnvironmentConfig` provides endpoints, feature flags, and asset URLs; secrets never hardcoded.
* **Deployment Pipeline:** CI runs `flutter analyze`, `flutter test`, golden diffs, and build_runner. Artifacts published as APK/IPA for internal distribution with mock flag enabled.

## 5. Decision Log

| Decision ID | Date | Module(s) | Summary | Status | Rationale | Linked Evidence |
|-------------|------|-----------|---------|--------|-----------|-----------------|
| DEC-201-001 | 2025-02-14 | MOD-201 | Controllers own all mutable state via StreamValue, widgets stay stateless. | Approved | Aligns with architecture overview and prevents state divergence. | flutter-app/foundation_documentation/flutter_architecture.md |

## 6. Appendices

* **Reference APIs:** Laravel backend contracts defined in MOD-101 (pending).
* **Security Review Checklist:** Enforce HTTPS-only asset loading; sanitize invite codes before display; gate partner dashboards behind role checks.
* **Operational Runbooks:** `docs/runbooks/flutter_bootstrap.md` (to be authored) will outline cold-start troubleshooting, mock backend rotation, and DI registration audits.

