# Documentation: Domain Entities
**Version:** 1.0

## 1. Introduction

This document defines the Core Business Entities (CBEs) for the "Guar[APP]ari" project. These are the primary "nouns" of the project's domain.

This list serves as the domain source of truth referenced by the `system_architecture_principles.md` (Principle P-1) and is the foundation for all module design.

---

## 2. Core Business Entities

* **Primary Entity:** **User** (The consumer, including moratoriums and tourists, who discovers, books, and shares experiences).
* **Supporting Entity A:** **Partner** (The B2B client and provider, including establishments, guides, artists, and producers who offer services and products). Partner types are explicitly enumerated to cover both supply and social amplification roles: `artist`, `venue`, `experience_provider`, `influencer`, and `curator`. Invite surfaces now consume the `InvitePartnerSummary` aggregate (id, partner type, display name, tagline, hero + logo URIs) so Flutter and Laravel share the same social-proof branding contract. The canonical Partner aggregate (id, profile, verification flags, contact information, invite/offer badges, engagement metrics, semantic tags) must live under `lib/domain/partner/` with value objects for every textual or media attribute so that all downstream summaries inherit the same invariants. Engagement metrics are type-aware (e.g., live-status for artists, presence counts for venues, invite counts for influencers) and are always non-negative integers or bounded strings represented as value objects rather than raw primitives.
* **Supporting Entity B:** **Offering** (The catalog of consumable items, encompassing Events, Products, and Experiences/Guides).
* **Supporting Entity C:** **Transaction** (The record of action and value exchange, including Bookings, Orders, Payments, and social Invitations).

### Location & Venue Field Definitions

- `offering_location_type` (enum): allowed values `physical`, `online`. Every event-like offering must declare which location mode it uses.
- `venue` (object): required for `physical` offerings; represents a physical place with coordinates + address.
  - `venue_id` (string): normalized POI/venue id (preferred) for cross-module linking (map ↔ agenda).
  - `address` (string): human-readable address (bounded string; value object).
  - `coordinates` (object): `latitude` + `longitude` (value objects) for GeoQuery and directions.
- `online_location` (object): required for `online` offerings; represents an “anywhere” experience.
  - `label` (string): e.g., “Online”, “Ao vivo”.
  - `url` (string, optional): join/watch URL when applicable.

### Domain helper aggregates (required for mocks & projections)

| Aggregate | Purpose | Notes |
| --- | --- | --- |
| Favorite Badge | Normalizes the glyph/branding metadata for a favorite collection badge. Exposes value objects for icon code point, font family, and package so UI layers can render glyphs without mutating domain state. | Stored under `lib/domain/favorite/` and consumed by `Favorite` + `FavoriteResume`. |
| Artist Resume | Canonical snapshot of an artist/curator identity for events, invites, and map markers. Carries `ArtistIdValue`, `ArtistNameValue`, `ArtistAvatarValue`, and `ArtistIsHighlightValue` so Venue/Schedule projections never fall back to primitives. | Lives under `lib/domain/artist/` and is produced from schedule DTOs before reaching UI controllers. |
| Friend Resume | Lightweight projection of a `User` contact used inside invites. Stores `FriendIdValue`, `TitleValue`, `FriendAvatarValue`, and `FriendMatchLabelValue` so we never fall back to primitives in domain → presentation boundaries. | Used exclusively by invite share/flow controllers. |
| City POI & Map Events | Represents geographic entities surfaced on the tenant map (coordinates, categories, badges) plus immutable POI update events (move, activation, deactivation). All coordinates, badges, and filter tokens must be expressed as value objects to keep map math and styling independent from Flutter types. | Resides under `lib/domain/map/` with collections for `value_objects/`, `events/`, and `filters/`. |
| Venue / Local | Canonical “place” aggregate referenced by offerings/events. A Venue can be physical (address + coordinates) or online (no fixed locality, optional URL). Physical venues must be eligible for GeoQuery and navigation; online venues must be treated as “available anywhere” and must not trigger distance ordering or geo constraints. | The map module owns the normalized POI registry; schedule/agendas reference venues by `venue_id` + summary fields. |
| Invite | Represents a social invitation tied to an event/offering, with inviter, invitees, status, timestamps, and source links for attribution. | Only one accepted invite per invitee per event; expires at event end; supports invite attribution for ranking and missions. |
| Presence / Check-in | Captures the verified presence of a user at an event via geofence/QR/staff confirmation. | Presence is the source of truth for “Presenças Confirmadas”; accepted-without-check-in is treated as no-show. |
| Mission | Defines partner-created goals (e.g., `10 convites aceitos`) with metric target, window, reward, and validation source. | Metric is selected per mission; pre-event missions should prefer invites/engagement over presence. |
| Social Score | Aggregates north-star metrics for users and partners: `Convites Aceitos` (esforço) and `Presenças Confirmadas` (resultado), tracked all-time and for the current month (“Em Alta”). | Drives rankings, badges, and Pro/Verificado unlocks; respects privacy/anonymization when applicable. |
| Contact Hash Directory | Stores salted hashes of user-imported contacts to enable friend suggestions and invite matching without storing raw PII. | Used to suggest “Pessoas” in discovery and to match invite acceptance with previously imported contact hashes. |

### Partner Field Definitions

- `partner_type` (enum): allowed values `artist`, `venue`, `experience_provider`, `influencer`, `curator`. Drives engagement metrics, labeling, and permissioning per role.
- `accepted_invites` (int): cumulative, non-negative count of invites accepted that are attributable to the partner; zero default; must not be null.
- `engagement` (object): optional; type-specific metrics expressed via value objects.
  - For `artist`: `status_label` (bounded string, <=32 chars, e.g., “Tocando agora”), `next_show_at` (ISO8601, optional).
  - For `venue`: `presence_count` (non-negative int).
  - For `experience_provider`: `experience_count` (non-negative int).
  - For `influencer`: `invite_count` (non-negative int; if present, should align with `accepted_invites` for consistency).
  - For `curator`: `article_count` and `doc_count` (non-negative ints).
- `media`: `avatar_uri` and `cover_uri` are optional but, if present, must be valid URIs captured as value objects. Fallbacks live in the projection layer, not the aggregate.
- `tags` (array of strings): optional, up to 16 entries, each ≤32 chars, sanitized and stored via value objects to avoid leaking UI-specific tokens into the domain. Tags are **type-aware**; examples include:
  - `artist`: music genres (e.g., rock, samba, eletrônica).
  - `experience_provider`: context/location tags (e.g., mar, praia, mergulho, montanha).
  - `curator`: curatorial focus (e.g., história, causos).
  - `influencer` (personalidade): focus areas (e.g., lifestyle, baladas).

### Social Graph & Presence Field Definitions

- `user_level` (enum): `basic`, `verified` (Pro/Verificado). Verified unlocks higher invite limits and monetization surfaces.
- `privacy_mode` (enum): `public`, `friends_only` (friends defined as reciprocated favorites). Private users are anonymized in rankings (blur/avatar masking) but still count toward metrics.
- `people_discovery_priority`: order “Pessoas” by monthly Social Score; verified users are surfaced first when scores tie, but both verified and basic can appear.
- `invite_status` (enum): `pending`, `accepted`, `declined`; `expired` is derived when the event ends. Exactly one accepted invite per invitee per event.
- `invite_limits` (by role): `basic` up to 20 pending invites simultaneously; `verified` up to 50; `partner_paid` up to 100 (higher via plan tiers). Invites are single-use per invitee/event.
- `check_in_method` (enum): `geofence`, `qr`, `staff_manual`. Geofence radius is partner-defined; QR is optional reinforcement; manual is staff-only for auditability.
- `presence_status` (enum): `confirmed`, `no_show` (accepted invite without check-in by event end).
- `mission_metric` (enum): `invites_accepted`, `presences_confirmed`, `check_ins`, `purchases` (future). Chosen per mission by the partner; pre-event missions are advised to avoid presence unless explicitly desired.
- `mission_status` (enum): `pending`, `active`, `completed`, `expired`.
- `partner_curator_link_status` (enum): `pending`, `accepted`; either side can propose, reciprocal acceptance required.
- `contact_hash` (string): salted hash for a contact identifier (e.g., phone/email) used solely for matching imported contacts to existing users; raw identifiers are never stored.
