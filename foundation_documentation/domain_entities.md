# Documentation: Domain Entities
**Version:** 1.0

## 1. Introduction

This document defines the Core Business Entities (CBEs) for the "Guar[APP]ari" project. These are the primary "nouns" of the project's domain.

This list serves as the domain source of truth referenced by the `system_architecture_principles.md` (Principle P-1) and is the foundation for all module design.

---

## 2. Core Business Entities

* **Primary Entity:** **User** (The consumer, including moratoriums and tourists, who discovers, books, and shares experiences).
* **Supporting Entity A:** **Partner** (The B2B client and provider, including establishments, guides, artists, and producers who offer services and products). Invite surfaces now consume the `InvitePartnerSummary` aggregate (id, partner type, display name, tagline, hero + logo URIs) so Flutter and Laravel share the same social-proof branding contract. The canonical Partner aggregate (id, profile, verification flags, contact information, invite/offer badges) must live under `lib/domain/partner/` with value objects for every textual or media attribute so that all downstream summaries inherit the same invariants.
* **Supporting Entity B:** **Offering** (The catalog of consumable items, encompassing Events, Products, and Experiences/Guides).
* **Supporting Entity C:** **Transaction** (The record of action and value exchange, including Bookings, Orders, Payments, and social Invitations).

### Domain helper aggregates (required for mocks & projections)

| Aggregate | Purpose | Notes |
| --- | --- | --- |
| Favorite Badge | Normalizes the glyph/branding metadata for a favorite collection badge. Exposes value objects for icon code point, font family, and package so UI layers can render glyphs without mutating domain state. | Stored under `lib/domain/favorite/` and consumed by `Favorite` + `FavoriteResume`. |
| Artist Resume | Canonical snapshot of an artist/curator identity for events, invites, and map markers. Carries `ArtistIdValue`, `ArtistNameValue`, `ArtistAvatarValue`, and `ArtistIsHighlightValue` so Venue/Schedule projections never fall back to primitives. | Lives under `lib/domain/artist/` and is produced from schedule DTOs before reaching UI controllers. |
| Friend Resume | Lightweight projection of a `User` contact used inside invites. Stores `FriendIdValue`, `TitleValue`, `FriendAvatarValue`, and `FriendMatchLabelValue` so we never fall back to primitives in domain → presentation boundaries. | Used exclusively by invite share/flow controllers. |
| City POI & Map Events | Represents geographic entities surfaced on the tenant map (coordinates, categories, badges) plus immutable POI update events (move, activation, deactivation). All coordinates, badges, and filter tokens must be expressed as value objects to keep map math and styling independent from Flutter types. | Resides under `lib/domain/map/` with collections for `value_objects/`, `events/`, and `filters/`. |
