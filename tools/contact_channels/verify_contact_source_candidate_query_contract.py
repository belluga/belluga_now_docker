#!/usr/bin/env python3
"""Enforce the server-owned contact-source candidate query contract.

This project-level guard closes a gap in the generic exact-lookup heuristic:
source eligibility is capability/mode based, not an identity-key lookup.  A
tenant-admin client must therefore never retrieve the generic Account Profile
catalog and decide source eligibility in memory.
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path


DEFAULT_REPO_ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class Finding:
    surface: str
    problem: str
    correction: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--repo",
        type=Path,
        default=DEFAULT_REPO_ROOT,
        help="Repository root to inspect (defaults to this checkout).",
    )
    return parser.parse_args()


def read_source(repo_root: Path, relative_path: str, findings: list[Finding]) -> str:
    path = repo_root / relative_path
    try:
        return path.read_text(encoding="utf-8")
    except OSError as exc:
        findings.append(
            Finding(
                relative_path,
                f"required contract surface is unavailable ({exc})",
                "Restore the source file or update this guard in the same reviewed contract change.",
            )
        )
        return ""


def source_exists(repo_root: Path, relative_path: str) -> bool:
    return (repo_root / relative_path).exists()


def read_sources(repo_root: Path, relative_paths: list[str], findings: list[Finding]) -> str:
    parts: list[str] = []
    for relative_path in relative_paths:
        source = read_source(repo_root, relative_path, findings)
        if source:
            parts.append(source)
    return "\n".join(parts)


def require_fragment(
    findings: list[Finding],
    surface: str,
    source: str,
    fragment: str,
    correction: str,
) -> None:
    if fragment not in source:
        findings.append(Finding(surface, f"missing required fragment `{fragment}`", correction))


def section_between(source: str, start: str, end: str) -> str:
    start_index = source.find(start)
    if start_index < 0:
        return ""
    end_index = source.find(end, start_index + len(start))
    return source[start_index:] if end_index < 0 else source[start_index:end_index]


def validate_repository(repo_root: Path) -> list[Finding]:
    findings: list[Finding] = []
    controller_path = (
        "flutter-app/lib/presentation/tenant_admin/account_profiles/controllers/"
        "tenant_admin_account_profiles_controller.dart"
    )
    repository_path = (
        "flutter-app/lib/infrastructure/repositories/tenant_admin/"
        "tenant_admin_account_profiles_repository.dart"
    )
    repository_contract_path = (
        "flutter-app/lib/domain/repositories/"
        "tenant_admin_account_profiles_repository_contract.dart"
    )
    encoder_path = (
        "flutter-app/lib/infrastructure/dal/dao/tenant_admin/"
        "tenant_admin_account_profiles_request_encoder.dart"
    )
    route_path = "laravel-app/routes/api/tenant_api_v1.php"
    controller_php_path = "laravel-app/app/Http/Api/v1/Controllers/AccountProfilesController.php"
    candidate_discovery_service_path = (
        "laravel-app/app/Application/AccountProfiles/AccountProfileCandidateDiscoveryService.php"
    )
    query_service_path = "laravel-app/app/Application/AccountProfiles/AccountProfileQueryService.php"
    type_provider_path = "laravel-app/app/Application/AccountProfiles/AccountProfileTypeSetProvider.php"
    type_model_path = "laravel-app/app/Models/Tenants/TenantProfileType.php"
    request_path = "laravel-app/app/Http/Api/v1/Requests/AccountProfileContactSourceCandidatesRequest.php"
    legacy_migration_path = (
        "laravel-app/database/migrations/tenants/2026_07_13_000100_add_contact_source_candidate_indexes.php"
    )
    upgraded_migration_path = (
        "laravel-app/database/migrations/tenants/2026_07_21_000100_rebuild_contact_source_candidate_index_for_name_search.php"
    )
    migration_paths = [
        legacy_migration_path,
        upgraded_migration_path,
    ]
    has_candidate_discovery_service = source_exists(
        repo_root, candidate_discovery_service_path
    )
    has_upgraded_migration = source_exists(repo_root, upgraded_migration_path)
    has_upgraded_contact_source_contract = (
        has_candidate_discovery_service and has_upgraded_migration
    )

    if has_candidate_discovery_service and not has_upgraded_migration:
        findings.append(
            Finding(
                upgraded_migration_path,
                "upgraded contact-source discovery service is present without the required name-search migration",
                "Keep the upgraded contact-source contract complete: when AccountProfileCandidateDiscoveryService exists, the name_search_key migration/index rebuild must also be present.",
            )
        )

    flutter_controller = read_source(repo_root, controller_path, findings)
    source_loader = section_between(
        flutter_controller,
        "Future<void> loadContactSourceCandidates",
        "void searchNestedProfileCandidates",
    )
    if not source_loader:
        findings.append(
            Finding(
                controller_path,
                "contact-source loader is missing",
                "Keep one controller-owned paged loader named loadContactSourceCandidates.",
            )
        )
    else:
        require_fragment(
            findings,
            controller_path,
            source_loader,
            "loadContactSourceCandidates(",
            "Use the repository's dedicated contact-source loader; do not reuse the generic profile list.",
        )
        require_fragment(
            findings,
            controller_path,
            source_loader,
            "loadNextContactSourceCandidatesPage(",
            "Page through the dedicated contact-source loader; do not construct a generic profile query.",
        )
        for forbidden in (
            "fetchAccountProfiles(",
            "fetchAccountProfilesPage(",
            "loadAllProfileTypes(",
            ".where(",
        ):
            if forbidden in source_loader:
                findings.append(
                    Finding(
                        controller_path,
                        f"forbidden broad-account-profile access/filter `{forbidden}` in contact-source loader",
                        "Move eligibility into GET /admin/api/v1/account_profiles/contact_sources; Flutter may only page, render, and select returned candidates.",
                    )
                )

    flutter_repository = read_source(repo_root, repository_path, findings)
    require_fragment(
        findings,
        repository_path,
        flutter_repository,
        "fetchContactSourceCandidatesPage(",
        "Implement the dedicated typed candidate-page method in the concrete repository.",
    )
    require_fragment(
        findings,
        repository_path,
        flutter_repository,
        "$_apiBaseUrl/v1/account_profiles/contact_sources",
        "Call the dedicated tenant-admin contact-source endpoint, not /account_profiles.",
    )
    require_fragment(
        findings,
        repository_path,
        flutter_repository,
        "encodeFetchContactSourceCandidatesQuery(",
        "Encode only the dedicated endpoint's pagination/exclusion query parameters.",
    )

    flutter_contract = read_source(repo_root, repository_contract_path, findings)
    require_fragment(
        findings,
        repository_contract_path,
        flutter_contract,
        "fetchContactSourceCandidatesPage(",
        "Expose the dedicated candidate-page contract to controllers and test doubles.",
    )
    contract_initial_loader = section_between(
        flutter_contract,
        "Future<TenantAdminPagedResult<TenantAdminAccountProfile>>\n  loadContactSourceCandidates",
        "Future<TenantAdminPagedResult<TenantAdminAccountProfile>?>\n  loadNextContactSourceCandidatesPage",
    )
    require_fragment(
        findings,
        repository_contract_path,
        contract_initial_loader,
        "_fetchContactSourceCandidatesPage(",
        "Keep the semantic initial loader bound to the dedicated contact-source page request.",
    )
    contract_next_loader = section_between(
        flutter_contract,
        "Future<TenantAdminPagedResult<TenantAdminAccountProfile>?>\n  loadNextContactSourceCandidatesPage",
        "Future<TenantAdminAccountProfile> fetchAccountProfile",
    )
    require_fragment(
        findings,
        repository_contract_path,
        contract_next_loader,
        "_fetchContactSourceCandidatesPage(",
        "Keep the semantic next-page loader bound to the dedicated contact-source page request.",
    )

    encoder = read_source(repo_root, encoder_path, findings)
    candidate_encoder = section_between(
        encoder,
        "Map<String, dynamic> encodeFetchContactSourceCandidatesQuery",
        "Map<String, dynamic> encodeCreateAccountProfile",
    )
    for required in ("'page'", "'per_page'", "'exclude_account_profile_id'"):
        require_fragment(
            findings,
            encoder_path,
            candidate_encoder,
            required,
            "Keep candidate paging and current-profile exclusion in the dedicated query encoder.",
        )

    route = read_source(repo_root, route_path, findings)
    route_marker = "Route::get('/contact_sources', [AccountProfilesController::class, 'contactSourceCandidates'])"
    require_fragment(
        findings,
        route_path,
        route,
        route_marker,
        "Declare GET /admin/api/v1/account_profiles/contact_sources before dynamic account-profile routes.",
    )
    dynamic_marker = "Route::prefix('{account_profile_id}')"
    if route.find(route_marker) > route.find(dynamic_marker) >= 0:
        findings.append(
            Finding(
                route_path,
                "contact-source route is shadowed by the dynamic account-profile prefix",
                "Place /contact_sources before Route::prefix('{account_profile_id}').",
            )
        )

    php_controller = read_source(repo_root, controller_php_path, findings)
    controller_method = section_between(
        php_controller,
        "public function contactSourceCandidates(",
        "public function publicIndex(",
    )
    if has_upgraded_contact_source_contract:
        for required in (
            "exclude_account_profile_id",
            "AccountProfileCandidateDiscoveryService::SCOPE_CONTACT_CAPABLE",
            "candidateDiscoveryService->page(",
        ):
            require_fragment(
                findings,
                controller_php_path,
                controller_method,
                required,
                "Keep the dedicated Laravel endpoint bound to the contact-capable candidate discovery scope.",
            )
        if "fetchAccountProfiles" in controller_method or "paginate(" in controller_method:
            findings.append(
                Finding(
                    controller_php_path,
                    "contact-source controller fell back to a broad account-profile list/query path",
                    "Keep contact-source retrieval on the dedicated candidate discovery path; do not reuse generic profile pagination.",
                )
            )

        candidate_discovery_service = read_source(
            repo_root, candidate_discovery_service_path, findings
        )
        candidate_query = section_between(
            candidate_discovery_service,
            "public function page(",
            "public function eligibleProfilesByIds(",
        )
        for required in (
            "self::SCOPE_CONTACT_CAPABLE",
            "->where('contact_mode', AccountProfileContactChannelsService::CONTACT_MODE_OWN)",
            "->where('is_active', true)",
            "->whereNull('deleted_at')",
            "->whereIn('profile_type', $eligibleTypes)",
            "->where('_id', '!=', $excludedProfileId)",
            "->where('name_search_key', new Regex('^'.preg_quote($normalizedSearch, '/')))",
            "->orderBy('name_search_key')",
            "->orderBy('_id')",
            "->skip($skip)",
            "->take($perPage + 1)",
        ):
            require_fragment(
                findings,
                candidate_discovery_service_path,
                candidate_query,
                required,
                "Resolve own, active, non-deleted, capability-enabled sources in the dedicated discovery query before paging.",
            )
    else:
        for required in (
            "AccountProfileContactSourceCandidatesRequest",
            "paginateContactSourceCandidates(",
            "exclude_account_profile_id",
        ):
            require_fragment(
                findings,
                controller_php_path,
                controller_method,
                required,
                "Keep request validation and candidate eligibility in the dedicated Laravel endpoint.",
            )

        query_service = read_source(repo_root, query_service_path, findings)
        candidate_query = section_between(
            query_service,
            "public function paginateContactSourceCandidates(",
            "private function applyAdminCandidateFilters",
        )
        for required in (
            "contactChannelsEnabledTypes()",
            "->where('contact_mode', 'own')",
            "->where('is_active', true)",
            "->whereNull('deleted_at')",
            "->whereIn('profile_type', $eligibleTypes)",
            "->where('_id', '!=', $normalizedExcludedProfileId)",
            "->orderBy('display_name')",
            "->orderBy('_id')",
            "->paginate($perPage)",
        ):
            require_fragment(
                findings,
                query_service_path,
                candidate_query,
                required,
                "Resolve own, active, non-deleted, capability-enabled sources in the tenant query before pagination.",
            )

    type_provider = read_source(repo_root, type_provider_path, findings)
    require_fragment(
        findings,
        type_provider_path,
        type_provider,
        "public function contactChannelsEnabledTypes()",
        "Resolve eligible profile types through the tenant-scoped type provider.",
    )
    require_fragment(
        findings,
        type_provider_path,
        type_provider,
        "->contactChannelsEnabled()",
        "Use the type capability scope rather than client-side type filtering.",
    )

    type_model = read_source(repo_root, type_model_path, findings)
    require_fragment(
        findings,
        type_model_path,
        type_model,
        "->where('capabilities.has_contact_channels', true)",
        "Keep contact-source eligibility rooted in the profile-type capability query.",
    )

    request = read_source(repo_root, request_path, findings)
    if request:
        for required in ("'page'", "'per_page'", "'exclude_account_profile_id'", "InputConstraints::PUBLIC_PAGE_SIZE_MAX"):
            require_fragment(
                findings,
                request_path,
                request,
                required,
                "When the dedicated request object exists, keep candidate pagination and exclusion validation aligned with the endpoint boundary.",
            )

    active_migration_paths = (
        migration_paths if has_upgraded_contact_source_contract else [legacy_migration_path]
    )
    migration = read_sources(repo_root, active_migration_paths, findings)
    migration_requirements = [
        "idx_account_profile_types_contact_channels_v1",
        "idx_account_profiles_contact_source_candidates_v1",
        "'capabilities.has_contact_channels'",
        "'contact_mode'",
        "'is_active'",
        "'deleted_at'",
        "'profile_type'",
    ]
    migration_requirements.append(
        "'name_search_key'" if has_upgraded_contact_source_contract else "'display_name'"
    )
    for required in migration_requirements:
        require_fragment(
            findings,
            ", ".join(active_migration_paths),
            migration,
            required,
            "Maintain the capability and paginated-candidate indexes with the query contract.",
        )

    return findings


def print_teach(repo_root: Path, findings: list[Finding]) -> None:
    print("Contact Source Candidate Query Contract — TEACH")
    print(
        "T (Truth): Contact-source eligibility is server-owned: same tenant, "
        "contact-capable type, own mode, active, non-deleted, and excluding the current profile."
    )
    print(
        "E (Evidence): Flutter must call the dedicated paged endpoint; Laravel "
        "must keep the dedicated contact-capable discovery path and retain matching indexes."
    )
    if not findings:
        print("A (Assessment): the dedicated query path is intact; no broad client fetch/filter was found.")
        print("C (Correction): none required.")
        print("H (Handoff): rerun this guard whenever the picker, endpoint, type capability, or indexes change.")
        print("Overall outcome: go")
        return

    print("A (Assessment): no-go; the candidate query contract has drifted.")
    print("C (Corrections):")
    for finding in findings:
        print(f"  - [{finding.surface}] {finding.problem}")
        print(f"    Repair: {finding.correction}")
    print("H (Handoff): repair every item above, then rerun this guard and the focused Laravel/Flutter tests.")
    print("Overall outcome: no-go")


def main() -> int:
    args = parse_args()
    repo_root = args.repo.resolve()
    findings = validate_repository(repo_root)
    print_teach(repo_root, findings)
    return 0 if not findings else 2


if __name__ == "__main__":
    raise SystemExit(main())
