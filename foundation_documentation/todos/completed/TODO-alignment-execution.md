# TODO: Alignment of Module Docs with MVP Contracts

**Purpose:** Execute the alignment of all module documentation with the authoritative `foundation_documentation/endpoints_mvp_contracts.md`.

---

## Tasks
- [x] ✅ Update `foundation_documentation/modules/flutter_client_experience_module.md`
    - Remove `/v1/app/` prefix from all endpoints.
    - Standardize `/me`, `/environment`, and SSE paths.
- [x] ✅ Update `foundation_documentation/modules/invite_and_social_loop_module.md`
    - Align endpoints with `/invites`, `/invites/stream`, `/invites/settings`, etc.
- [x] ✅ Update `foundation_documentation/modules/agenda_and_action_planner_module.md`
    - Align endpoints with `/agenda` and `/events/stream`.
    - Ensure taxonomy and confirmed_only filters are mentioned.
- [x] ✅ Update `foundation_documentation/modules/map_poi_module.md`
    - Align endpoints with `/map/pois`, `/map/pois/stream`, and `/map/filters`.
    - Ensure viewport and distance_meters logic matches.
- [x] ✅ Update `foundation_documentation/modules/onboarding_flow_module.md`
    - Align entry paths with `/environment` and `/anonymous/identities`.

## Definition of Done
- All module docs use the standardized `/api/v1` relative paths (omitting `/app/` segment).
- No references to `/home-overview` or `/profile` remain.
- `rg -n "/v1/app/" foundation_documentation/modules` returns zero matches for API paths.

## Validation Steps
- Run `rg` to check for stale paths.
- Manual cross-check with `endpoints_mvp_contracts.md`.
