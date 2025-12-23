# TODO (V1): Tenant/Admin Area (Accounts + Events + Assets)

**Status legend:** `- [ ] ⚪ Pending` · `- [ ] 🟡 Provisional` · `- [x] ✅ Production‑Ready`.
**Status:** Active  
**Owners:** Backend Team + Delphi (Flutter)  
**Objective:** Provide a simplified tenant/admin area for managing accounts, events, assets, and tenant branding in MVP.

---

## References
- `foundation_documentation/modules/partner_admin_module.md`
- `foundation_documentation/todos/active/mvp_slices/TODO-v1-first-release.md`
- Deferred items: `foundation_documentation/todos/active/TODO-vnext-parking-lot.md`

## Account + Partner Context (MVP)
- Account remains generic; Partner is a 1:1 sibling model linked by `account_id`.
- Partner stores domain fields like `type`, `tags`, and taxonomy terms (multi‑taxonomy: e.g., Venue can have `cuisines` and `music_genres`).
- Discovery uses an aggregation over Account + Partner; admin CRUD remains in the tenant/admin route file.

---

## A) Backend Tasks

### A1) Account access + permissions
- [ ] ⚪ Implement account memberships with roles + permission flags (draft in `foundation_documentation/modules/partner_admin_module.md`)
- [ ] ⚪ Enforce permissions for account-managed actions:
  - [ ] ⚪ `can_manage_details`
  - [ ] ⚪ `can_manage_events`

### A2) Tenant branding management
- [ ] ⚪ Allow tenant admin to edit About, logo, icon, and branding colors.

### A3) Accounts + assets management
- [ ] ⚪ CRUD accounts (including unmanaged accounts).
- [ ] ⚪ CRUD StaticAssets (landlord-managed assets within tenant scope).

### A4) Audit + Unmanaged lifecycle
- [ ] ⚪ Track `created_by` / `updated_by` + `*_by_type` on managed entities.
- [ ] ⚪ Emit `action_audit_log` entries for create/update/delete actions.
- [ ] ⚪ Ensure `is_managed` toggles when account access is granted/removed.

---

## B) Flutter Tasks

### B1) Tenant/Admin navigation entry
- [ ] ⚪ Provide a Web Authenticated entrypoint for tenant/admin mode (landlord user / tenant admin)
- [ ] ⚪ Gate with appropriate auth/role guard

### B2) V1 pages (minimum)
- [ ] ⚪ Tenant/Admin Home
- [ ] ⚪ Accounts management (list + create + edit)
- [ ] ⚪ Assets management (StaticAssets CRUD)
- [ ] ⚪ Events management (create/edit/delete)
- [ ] ⚪ Tenant branding management (About/logo/icon/colors)
- [ ] ⚪ Plan/Limits view (read-only; shows quotas and reset times)

### B3) Event form UX requirements
- [ ] ⚪ Venue selector lists accessible venue accounts.
- [ ] ⚪ Artist selector lists accessible artist accounts.
- [ ] ⚪ Both selectors include shortcut to create a new Artist or Venue.

---

## C) Acceptance Criteria

- [ ] ⚪ Tenant admin can manage accounts, assets, and events within permissions.
- [ ] ⚪ Tenant admin can edit branding information (About/logo/icon/colors).
