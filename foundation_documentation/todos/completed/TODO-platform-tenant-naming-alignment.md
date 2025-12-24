# TODO: Platform vs Tenant Naming Alignment

**Purpose:** Align foundation documentation to reflect Bóora! as the platform and Guar[APP]ari as a tenant, removing stale cross-domain artifacts.

---

## Scope
- Replace `foundation_documentation/modules/system_architecture_principles.md` with a Guar[APP]ari/Bóora!-aligned version that references the agnostic core (`delphi-ai/system_architecture_principles.md`) instead of duplicating it.
- Update core project docs to reflect platform/tenant positioning:
  - `foundation_documentation/project_mandate.md`
  - `foundation_documentation/domain_entities.md`
- Update module docs that still describe Guar[APP]ari as the platform to clarify tenant scope (keep tenant-specific screen/proposal docs intact).

## Out of Scope
- Any code changes.
- Tenant-specific marketing collateral or screen copy under `foundation_documentation/screens/` and `foundation_documentation/proposta_guarappari.md`.
- Changes to endpoint contracts.

## Definition of Done
- Core mandate and domain docs state Bóora! is the platform; Guar[APP]ari is a tenant.
- `foundation_documentation/modules/system_architecture_principles.md` is aligned to this project and no longer references Learning/Skills or unrelated module templates.
- Module docs use tenant-accurate language where applicable.

## Validation Steps
- `rg -n "Learning Engine|Skills Engine|learning_engine.md" foundation_documentation/modules` returns no matches.
- Manual review of `foundation_documentation/project_mandate.md` and `foundation_documentation/domain_entities.md` confirms platform/tenant clarity.

## Decisions
- Preserve tenant-specific content in `foundation_documentation/screens/` and proposal docs as Guar[APP]ari examples.

## Questions to Close
- None.
