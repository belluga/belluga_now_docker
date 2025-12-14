# TODO (V1): Partner Workspace (Memberships + Event Invite Metrics)

**Status:** Active  
**Owners:** Backend Team + Delphi (Flutter)  
**Objective:** Provide V1 partner management pages for memberships and event invite metrics (gamification/challenges readiness).

---

## References
- `foundation_documentation/modules/partner_admin_module.md`
- `foundation_documentation/modules/invite_and_social_loop_module.md`
- `foundation_documentation/todos/active/TODO-v1-first-release.md`
- Deferred items: `foundation_documentation/todos/active/TODO-vnext-parking-lot.md`

---

## A) Backend Tasks

### A1) Partner memberships
- [ ] Implement `partner_memberships` with roles + permission flags (draft in `foundation_documentation/modules/partner_admin_module.md`)
- [ ] Support invites to add members + accept flow (status: `invited` → `active`)
- [ ] Enforce permissions for partner-issued actions:
  - [ ] `can_invite`
  - [ ] `can_view_metrics`
  - [ ] `can_manage_events` (if V1 includes event editing)

### A2) Event invite metrics endpoints
- [ ] Implement metrics endpoint(s) for event host/managing partner:
  - [ ] per inviter principal aggregates
  - [ ] per issuer user aggregates (`issued_by_user_id`)
  - [ ] drill-down list for auditing
- [ ] Ensure accepted counts use `credited_acceptance=true`

### A3) Tenant settings integration
- [ ] Expose plan/quota related settings for partner-facing displays (read-only in V1)

---

## B) Flutter Tasks

### B1) Partner Workspace navigation entry
- [ ] Provide a Web Authenticated entrypoint for partner workspace mode (landlord user / partner member)
- [ ] Gate with appropriate auth/role guard

### B2) V1 pages (minimum)
- [ ] Partner Workspace Home (list manageable partners)
- [ ] Partner Members (view/add/remove, adjust role/permissions)
- [ ] Event Invite Metrics view (per event: breakdown + drill-down)
- [ ] Plan/Limits view (read-only; shows quotas and reset times)

---

## C) Acceptance Criteria

- [ ] A user can manage multiple partners and a partner can have multiple managing users
- [ ] Partner members can view event invite metrics for events scoped to that partner
- [ ] Metrics show credited accepted invites and issuer breakdown
