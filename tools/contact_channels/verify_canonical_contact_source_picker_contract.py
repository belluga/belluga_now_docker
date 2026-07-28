#!/usr/bin/env python3
"""Enforce the canonical contact-source picker contract.

The contact-source picker is a scenario-specific view over the generic tenant-admin
Account Profile index. Eligibility and stale-source handling stay server-owned via
generic query filters; no dedicated contact_sources endpoint/request/repository
contract may survive.
"""

from __future__ import annotations

import argparse
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


def section_between(source: str, start: str, end: str) -> str:
    start_index = source.find(start)
    if start_index < 0:
        return ""

    end_index = source.find(end, start_index + len(start))
    return source[start_index:] if end_index < 0 else source[start_index:end_index]


def require_fragment(
    findings: list[Finding],
    surface: str,
    source: str,
    fragment: str,
    correction: str,
) -> None:
    if fragment not in source:
        findings.append(Finding(surface, f"missing required fragment `{fragment}`", correction))


def forbid_fragment(
    findings: list[Finding],
    surface: str,
    source: str,
    fragment: str,
    correction: str,
) -> None:
    if fragment in source:
        findings.append(Finding(surface, f"forbidden fragment present `{fragment}`", correction))


def validate_repository(repo_root: Path) -> list[Finding]:
    findings: list[Finding] = []

    flutter_controller_path = (
        "flutter-app/lib/presentation/tenant_admin/account_profiles/controllers/"
        "tenant_admin_account_profiles_controller.dart"
    )
    flutter_repository_path = (
        "flutter-app/lib/infrastructure/repositories/tenant_admin/"
        "tenant_admin_account_profiles_repository.dart"
    )
    flutter_contract_path = (
        "flutter-app/lib/domain/repositories/"
        "tenant_admin_account_profiles_repository_contract.dart"
    )
    flutter_encoder_path = (
        "flutter-app/lib/infrastructure/dal/dao/tenant_admin/"
        "tenant_admin_account_profiles_request_encoder.dart"
    )
    abstract_query_path = "laravel-app/app/Application/Shared/Query/AbstractQueryService.php"
    route_path = "laravel-app/routes/api/tenant_api_v1.php"
    php_controller_path = "laravel-app/app/Http/Api/v1/Controllers/AccountProfilesController.php"
    query_service_path = "laravel-app/app/Application/AccountProfiles/AccountProfileQueryService.php"
    type_provider_path = "laravel-app/app/Application/AccountProfiles/AccountProfileTypeSetProvider.php"
    type_model_path = "laravel-app/app/Models/Tenants/TenantProfileType.php"
    profile_model_path = "laravel-app/app/Models/Tenants/AccountProfile.php"
    migration_path = (
        "laravel-app/database/migrations/tenants/"
        "2026_07_21_000100_rebuild_contact_source_candidate_index_for_name_search.php"
    )
    request_path = "laravel-app/app/Http/Api/v1/Requests/AccountProfileContactSourceCandidatesRequest.php"

    flutter_controller = read_source(repo_root, flutter_controller_path, findings)
    flutter_controller_section = section_between(
        flutter_controller,
        "Future<void> loadContactSourceCandidates",
        "void searchNestedProfileCandidates",
    )
    for required in (
        "Future<void> loadContactSourceCandidates({String? excludeProfileId})",
        "_loadContactSourceCandidatesPage(",
        "search: _contactSourceCandidatesQuery",
        "profileType: _contactSourceCandidatesProfileType",
        "contactMode: BellugaContactSourceMode.own.rawValue",
        "contactChannelsEnabledOnly: true",
        "excludeAccountProfileId: _contactSourceCandidatesExcludeProfileId",
    ):
        require_fragment(
            findings,
            flutter_controller_path,
            flutter_controller_section,
            required,
            "Keep the scenario-specific picker loader on the canonical generic page loader with server-owned filters.",
        )
    for forbidden in (
        "fetchContactSourceCandidatesPage(",
        "encodeFetchContactSourceCandidatesQuery(",
        "/contact_sources",
    ):
        forbid_fragment(
            findings,
            flutter_controller_path,
            flutter_controller,
            forbidden,
            "Do not reintroduce a dedicated contact-source endpoint or repository path.",
        )

    flutter_repository = read_source(repo_root, flutter_repository_path, findings)
    flutter_repository_section = section_between(
        flutter_repository,
        "fetchAccountProfilesPage({",
        "fetchAccountProfileCandidatesPage({",
    )
    for required in (
        "fetchAccountProfilesPage(",
        "encodeFetchAccountProfilesQuery(",
        "$_apiBaseUrl/v1/account_profiles",
        "contactMode: contactMode?.value,",
        "excludeAccountProfileId: excludeAccountProfileId?.value,",
        "page: page.value,",
        "pageSize: pageSize.value,",
    ):
        require_fragment(
            findings,
            flutter_repository_path,
            flutter_repository_section,
            required,
            "Keep the contact-source picker backed by the generic Account Profile endpoint.",
        )
    for forbidden in (
        "fetchContactSourceCandidatesPage(",
        "/contact_sources",
    ):
        forbid_fragment(
            findings,
            flutter_repository_path,
            flutter_repository,
            forbidden,
            "Remove the dedicated contact-source repository path and keep only the canonical generic fetch.",
        )

    flutter_contract = read_source(repo_root, flutter_contract_path, findings)
    for required in (
        "TenantAdminAccountProfilesRepoString? contactMode,",
        "TenantAdminAccountProfilesRepoBool? contactChannelsEnabledOnly,",
        "TenantAdminAccountProfilesRepoString? excludeAccountProfileId,",
    ):
        require_fragment(
            findings,
            flutter_contract_path,
            flutter_contract,
            required,
            "Expose the generic account-profile page filters needed by the canonical picker.",
        )
    forbid_fragment(
        findings,
        flutter_contract_path,
        flutter_contract,
        "fetchContactSourceCandidatesPage(",
        "Remove the dedicated contact-source repository contract; the canonical picker must use fetchAccountProfilesPage filters only.",
    )

    flutter_encoder = read_source(repo_root, flutter_encoder_path, findings)
    flutter_encoder_section = section_between(
        flutter_encoder,
        "Map<String, dynamic> encodeFetchAccountProfilesQuery({",
        "Map<String, dynamic> encodeFetchAccountProfileCandidatesQuery({",
    )
    for required in (
        "payload['contact_mode'] = contactMode.trim();",
        "payload['contact_channels_enabled_only'] = true;",
        "payload['exclude_account_profile_id'] = excludeAccountProfileId.trim();",
        "payload['page'] = page;",
        "payload['page_size'] = pageSize;",
    ):
        require_fragment(
            findings,
            flutter_encoder_path,
            flutter_encoder_section,
            required,
            "Encode the canonical server-owned filters on the generic Account Profile request.",
        )
    forbid_fragment(
        findings,
        flutter_encoder_path,
        flutter_encoder,
        "encodeFetchContactSourceCandidatesQuery(",
        "Remove the dedicated contact-source query encoder; the generic request encoder is authoritative.",
    )

    route = read_source(repo_root, route_path, findings)
    forbid_fragment(
        findings,
        route_path,
        route,
        "Route::get('/contact_sources'",
        "Do not expose a dedicated /contact_sources route; use GET /admin/api/v1/account_profiles with filters.",
    )

    php_controller = read_source(repo_root, php_controller_path, findings)
    php_controller_section = section_between(
        php_controller,
        "public function index(",
        "public function candidates(",
    )
    for required in (
        "'contact_mode' => ['sometimes', 'string', 'in:own,mirrored_account_profile']",
        "'contact_channels_enabled_only' => ['sometimes', 'boolean']",
        "'exclude_account_profile_id' => ['sometimes', 'string', 'regex:/^[a-f0-9]{24}$/i']",
        "AccountProfileNameSearchKey::normalizeRequestSearch($validated['search'])",
        "$validated['search'] = $normalizedSearch;",
        "$perPage = (int) ($validated['per_page'] ?? $validated['page_size'] ?? 15) ?: 15;",
        "$this->profileQueryService->paginate(",
    ):
        require_fragment(
            findings,
            php_controller_path,
            php_controller_section,
            required,
            "Validate the canonical generic filters directly on the admin index.",
        )
    forbid_fragment(
        findings,
        php_controller_path,
        php_controller,
        "public function contactSourceCandidates(",
        "Remove the dedicated contact-source controller action; the admin index is the only picker surface.",
    )

    query_service = read_source(repo_root, query_service_path, findings)
    query_service_paginate_section = section_between(
        query_service,
        "public function paginate(",
        "private function applyAdminCandidateFilters",
    )
    query_service_admin_filters_section = section_between(
        query_service,
        "private function applyAdminCandidateFilters(",
        "public function publicPaginate(",
    )
    for required in (
        "applyAdminCandidateFilters($query, $queryParams);",
        "new Regex('^'.preg_quote($search, '/'), 'i')",
        "$this->buildPaginator(",
        "private readonly AccountProfileContactChannelsService $contactChannelsService,",
    ):
        require_fragment(
            findings,
            query_service_path,
            query_service_paginate_section if "private readonly" not in required else query_service,
            required,
            "Keep the generic query path responsible for normalized prefix search and canonical picker pagination.",
        )
    for required in (
        "contactChannelsEnabledTypes()",
        "->whereIn('profile_type', $contactChannelsEnabledTypes)",
        "->where('is_active', true);",
        "$excludedProfileId = trim((string) ($queryParams['exclude_account_profile_id'] ?? ''));",
        "->where('_id', '!=', $excludedProfileId);",
    ):
        require_fragment(
            findings,
            query_service_path,
            query_service_admin_filters_section,
            required,
            "Keep eligibility filtering and preview payload on the generic Account Profile query path.",
        )
    for required in (
        "'effective_contact_channels' => $this->contactChannelsService",
        "->resolveEffectiveContactChannels($profile),",
    ):
        require_fragment(
            findings,
            query_service_path,
            query_service,
            required,
            "Keep eligibility filtering and preview payload on the generic Account Profile query path.",
        )
    forbid_fragment(
        findings,
        query_service_path,
        query_service,
        "paginateContactSourceCandidates(",
            "Do not add a dedicated contact-source pagination path back into the query service.",
        )

    abstract_query = read_source(repo_root, abstract_query_path, findings)
    for required in (
        "$this->baseSearchableFields(),",
        "if (is_array($value)) {",
        "$query->where($field, $value);",
    ):
        require_fragment(
            findings,
            abstract_query_path,
            abstract_query,
            required,
            "Keep generic scalar filters, including contact_mode, flowing through the shared query paginator.",
        )

    type_provider = read_source(repo_root, type_provider_path, findings)
    for required in (
        "public function contactChannelsEnabledTypes()",
        "->contactChannelsEnabled()",
    ):
        require_fragment(
            findings,
            type_provider_path,
            type_provider,
            required,
            "Resolve contact-capable profile types through the tenant-scoped type provider.",
        )

    type_model = read_source(repo_root, type_model_path, findings)
    require_fragment(
        findings,
        type_model_path,
        type_model,
        "->where('capabilities.has_contact_channels', true)",
            "Keep contact-capable type resolution server-owned in the profile-type model scope.",
        )

    profile_model = read_source(repo_root, profile_model_path, findings)
    for required in (
        "use HasSlug, SoftDeletes, UsesTenantConnection;",
        "'contact_mode',",
        "'is_active' => 'bool',",
        "'deleted_at' => 'datetime',",
    ):
        require_fragment(
            findings,
            profile_model_path,
            profile_model,
            required,
            "Keep the generic Account Profile model enforcing soft-delete semantics and filterable contact-mode state.",
        )

    migration = read_sources(repo_root, [migration_path], findings)
    for required in (
        "idx_account_profiles_contact_source_candidates_v1",
        "'contact_mode' => 1,",
        "'is_active' => 1,",
        "'deleted_at' => 1,",
        "'profile_type' => 1,",
        "'name_search_key' => 1,",
        "'_id' => 1,",
    ):
        require_fragment(
            findings,
            migration_path,
            migration,
            required,
            "Keep the canonical contact-source picker backed by the name_search_key candidate index authority.",
        )

    if source_exists(repo_root, request_path):
        findings.append(
            Finding(
                request_path,
                "dedicated contact-source request object still exists",
                "Delete the dedicated request object; the admin index validation is authoritative for the canonical picker.",
            )
        )

    return findings


def print_teach(findings: list[Finding]) -> None:
    print("Canonical Contact Source Picker Contract — TEACH")
    print(
        "T (Truth): the contact-source picker is a filtered view over the generic tenant-admin "
        "Account Profile index. Eligibility is server-owned via contact-capable type, own mode, "
        "active non-deleted state, exclusion of the current profile, normalized prefix search, "
        "and bounded pagination."
    )
    print(
        "E (Evidence): Flutter must call fetchAccountProfilesPage with canonical filters; Laravel "
        "must validate/apply those filters on the generic index, keep the supporting "
        "name_search_key index authority, and return effective contact preview payload."
    )
    if not findings:
        print("A (Assessment): the canonical picker contract is intact; no dedicated contact_sources surface was found.")
        print("C (Correction): none required.")
        print("H (Handoff): rerun this guard whenever the picker flow, generic account-profile index, or contact preview payload changes.")
        print("Overall outcome: go")
        return

    print("A (Assessment): no-go; the canonical picker contract has drifted.")
    print("C (Corrections):")
    for finding in findings:
        print(f"  - [{finding.surface}] {finding.problem}")
        print(f"    Repair: {finding.correction}")
    print("H (Handoff): repair every item above, then rerun this guard and the focused Flutter/Laravel tests.")
    print("Overall outcome: no-go")


def main() -> int:
    args = parse_args()
    findings = validate_repository(args.repo.resolve())
    print_teach(findings)
    return 0 if not findings else 2


if __name__ == "__main__":
    raise SystemExit(main())
