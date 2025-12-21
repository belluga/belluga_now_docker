# TODO (V1): Map (POIs + Events + Stacking)

**Status:** Active  
**Owners:** Backend Team + Delphi (Flutter)  
**Objective:** Ship the V1 map experience with static POIs (beach/nature/etc.), dynamic event POIs, and same-spot stacking (`+N` badge + POI deck).

---

## References
- `foundation_documentation/modules/map_poi_module.md`
- `foundation_documentation/todos/active/mvp_slices/TODO-v1-first-release.md`
- Deferred items: `foundation_documentation/todos/active/TODO-vnext-parking-lot.md`

---

## A) Backend Tasks

### A1) `map_pois` projection persistence
- [ ] On create/update of Account/Partner, StaticAsset, or Event (and POI-enabled custom objects), upsert linked `map_pois` record (transactional / consistent write)
- [ ] Support `time_anchor_at` nullable on `map_pois` (no stored `visible_from/visible_until`)
- [ ] Implement tenant settings for time-window filtering:
  - [ ] `map_poi_future_window_days`
  - [ ] `map_poi_past_window_days`

### A2) Time-window filtering (query-time)
- [ ] When fetching POIs, include time-anchored POIs only when:
  - [ ] `time_anchor_at <= now + future_window_days`
  - [ ] `time_anchor_at >= now - past_window_days`
- [ ] POIs without `time_anchor_at` remain eligible (subject to `is_active`, viewport, and filters)

### A3) Same-spot stacking (V1 exact-key)
- [ ] Normalize coordinates on write (fixed precision, e.g., 6 decimals)
- [ ] Derive/store an `exact_key` from normalized coordinates (e.g., `"lat,lng"`)
- [ ] Map endpoint returns stacks grouped by `exact_key`:
  - [ ] `stack_key`, `center`, `top_poi`, `stack_count`, `items[]`
- [ ] Ensure deterministic ordering within stack:
  - [ ] sort by `priority`, then stable tiebreaker (`ref_type` precedence + `ref_id`)

### A4) Performance/indexing
- [ ] 2dsphere index on `map_pois.location`
- [ ] Index strategy supports `tenant_id`, `is_active`, `category`, and `time_anchor_at` filters used by the map endpoint

---

## B) Flutter Tasks

### B1) Map rendering + filters
- [ ] Render static POIs for categories: `Culture`, `Restaurant`, `Beach`, `Nature`, `Historic`
- [ ] Render dynamic Event POIs distinctly from static POIs
- [ ] Keep categories coarse; use tags for subcategories (no enum expansion in V1)
  - StaticAsset and Event are POI-enabled sources; Account/Partner is conditional per MVP scope.

### B2) Same-spot UX
- [ ] Marker shows top POI + `+N` badge when stack has multiple items
- [ ] Tapping opens POI deck/selector listing stack items ordered by priority
- [ ] Selecting an item pins selection until cleared or refreshed

### B3) Deep links
- [ ] For POI with `ref_type=event`, route to event detail
- [ ] For other POIs, route to POI details screen

---

## C) Acceptance Criteria

- [ ] Beaches and Nature POIs appear as static POIs and are filterable
- [ ] Event POIs appear only within backend-defined time windows (via settings)
- [ ] Same-spot POIs stack with `+N` badge and open a POI deck with deterministic ordering
