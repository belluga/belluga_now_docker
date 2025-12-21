# TODO (V1): Venue Profile (Reduced Tabs)

**Status:** Active  
**Owners:** Flutter Team + Product  
**Objective:** Deliver the reduced Venue profile using the existing Partner Detail base page.

---

## References
- `foundation_documentation/todos/active/TODO-mvp-scope-definition.md`
- `foundation_documentation/todos/active/TODO-v1-first-release.md`
- `lib/presentation/tenant/partners/models/partner_profile_config.dart`

---

## A) Decisions (MVP)
- Use existing `PartnerProfileConfig` / `ProfileModuleId` (no new screen).
- Header/taxonomy stays above tabs.
- Bio is optional; if present, show `Sobre` and it is always the first tab.
- Tabs:
  - `Sobre` (conditional) → `ProfileModuleId.richText`
  - `Como Chegar` (always) → `ProfileModuleId.locationInfo` (map preview + route CTA)
  - `Eventos` (always) → `ProfileModuleId.agendaList`
- Exclusions: `externalLinks`, `supportedEntities`, commerce/store modules.

---

## B) Flutter Tasks
- [ ] Implement venue `PartnerProfileConfig` with the reduced tabs above.
- [ ] Ensure Venue profiles open from:
  - [ ] Event Detail `O Local` CTA
  - [ ] Venue favorites

---

## C) Acceptance Criteria
- [ ] Venue profile renders reduced tabs with correct ordering.
- [ ] `Como Chegar` shows map preview + route CTA.
- [ ] Tapping venue in Event Detail routes to the Venue profile.
