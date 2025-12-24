# TODO (Upstream): Profile Endpoint (/api/v1/me)

**Status legend:** `- [ ] ⚪ Pending` · `- [ ] 🟡 Provisional` · `- [x] ✅ Production‑Ready`.
**Status:** Active  
**Owners:** Backend Team (Upstream)  
**Objective:** Deliver a boilerplate-generic `/api/v1/me` endpoint for tenant apps.

---

**scope:** Implement `/api/v1/me` in the upstream Laravel boilerplate using the MVP contract in `foundation_documentation/endpoints_mvp_contracts.md`, including user level, privacy mode, social score, counters, and role claims.  
**out_of_scope:** Tenant-specific fields, partner discovery payloads, or any project-only claims.  
**definition_of_done:** Endpoint is available in upstream, protected by Sanctum, returns the full contract schema with stable field names and enums, and includes `tenant_id` for tenant-scoped calls.  
**validation_steps:** Contract tests validate schema + enum values; a sample authenticated request returns all required fields.

---

## References
- `foundation_documentation/endpoints_mvp_contracts.md`
- `foundation_documentation/system_roadmap.md`

---

## A) Backend Tasks

### A1) Endpoint contract
- [ ] ⚪ Implement `GET /api/v1/me` per MVP contract.
- [ ] ⚪ Return `tenant_id` for tenant-scoped calls.
- [ ] ⚪ Enforce enum values (`user_level`, `privacy_mode`) as documented.

### A2) Auth + abilities
- [ ] ⚪ Require `auth:sanctum`.
- [ ] ⚪ Ensure ability checks are explicit (no wildcard abilities).

---

## B) Acceptance Criteria

- [ ] ⚪ `/api/v1/me` returns the documented schema (no missing keys).
- [ ] ⚪ Contract tests pass in upstream boilerplate.
