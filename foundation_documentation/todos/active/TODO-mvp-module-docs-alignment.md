# TODO: MVP Module Docs Alignment

**Purpose:** Align module documentation with the MVP implementation contracts (remove deprecated endpoints, reference current routes, and match current behaviors) and scan all module docs for additional drift vs the current MVP schema.

---

## Scope
- Perform a full scan of `foundation_documentation/modules/` to identify any mismatches with the current MVP contracts.
- Update module docs to reflect the MVP endpoint contracts:
  - Remove `/v1/app/home-overview` references (no aggregated home endpoint).
  - Replace `/v1/app/profile` with `/v1/app/me`.
  - Replace `/v1/app/onboarding/context` with `/v1/environment`.
  - Ensure module references to agenda/map align with current filters and SSE notes where applicable.
- Update affected module documents in `foundation_documentation/modules/`.

## Out of Scope
- Any Laravel/Flutter implementation work.
- Changes to endpoint contracts themselves (only module doc alignment).
- Roadmap edits unless new endpoints are introduced (none expected).

## Definition of Done
- Module docs no longer mention removed endpoints.
- Module docs reference the MVP contracts for `/me`, `/environment`, `/agenda`, `/map/pois`, and SSE streams where applicable.
- Cross-check confirms no module doc contradicts `foundation_documentation/endpoints_mvp_contracts.md` or the MVP schema decisions already documented.

## Validation Steps
- Manual scan of updated module docs against `foundation_documentation/endpoints_mvp_contracts.md`.
- `rg -n "/v1/app/home-overview|/v1/app/profile|/v1/app/onboarding/context" foundation_documentation/modules` returns no matches.

## Decisions
- Use independent requests for home composition (no aggregated endpoint).

## Questions to Close
- None.
