# TODO (V1): Artist Favorites + Artist Profile (Reduced Tabs)

**Status legend:** `- [ ] ⚪ Pending` · `- [ ] 🟡 Provisional` · `- [x] ✅ Production‑Ready`.
**Status:** Active  
**Owners:** Backend Team + Delphi (Flutter)  
**Objective:** Keep favorites in Home, restrict favorites to Artists in this slice, and use the existing Partner Detail base page with reduced artist tabs. Venue favorites are tracked in a separate TODO.

---

## References
- `foundation_documentation/todos/active/mvp_slices/TODO-v1-first-release.md`
- `foundation_documentation/todos/active/TODO-vnext-parking-lot.md`

## Taxonomy Summary (MVP)
- Partners can carry multiple taxonomies (WordPress‑style). A Venue may have `cuisines` and also `music_genres`.
- Taxonomy terms are **typed** (e.g., `music_genres`, `cuisines`, `experiences`) and can be filtered independently.
- Favorites are driven by **capability** (interim policy: `artist` and `venue` are favoritable until backend sends `is_favoritable`).

---

## A) Backend Tasks

### A1) Partner “capabilities” (favoritable)
- [ ] ⚪ Define a partner blueprint/capabilities field that includes `is_favoritable` (backend source of truth)
- [ ] ⚪ V1 default policy: Artists are favoritable; other partner types default to not favoritable unless enabled

### A2) Favorites persistence (backend later)
- [ ] ⚪ (Deferred) Backend-persistent favorites are VNext; for V1 the mock app may reset on load

---

## B) Flutter Tasks

### B1) Favorites list stays in Home
- [ ] ⚪ Keep Favorites strip in Home as the entrypoint
- [ ] ⚪ When a favorite is tapped:
  - [ ] ⚪ If it’s the primary tenant favorite, keep existing pinned behavior
  - [ ] ⚪ If it’s an Artist, open the existing Partner Detail page

### B2) Restrict favorites to Artists (V1)
- [ ] ⚪ Enforce “artist-only favoritable” behavior in the mock repository path until backend sends capabilities
- [ ] ⚪ Ensure non-artist partners show favorite disabled/hidden (no toggle)

### B3) Reduce Artist profile tabs (do not create a new screen)
- [ ] ⚪ Update the artist `PartnerProfileConfig` to a minimal set of tabs/modules:
  - [ ] ⚪ Bio/summary + upcoming events (schedule)
- [ ] ⚪ Avoid store modules in V1 (defer to VNext)

---

## C) Acceptance Criteria

- [ ] ⚪ Users can favorite/unfavorite Artists (only)
- [ ] ⚪ Favorites remain visible in Home and open the artist profile
- [ ] ⚪ Artist profile uses the existing base page with reduced tabs (no new detail screen)
