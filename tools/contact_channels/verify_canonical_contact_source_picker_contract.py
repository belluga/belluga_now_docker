#!/usr/bin/env python3
"""Enforce the cross-repository contact-source candidate contract.

The picker uses the shared, scoped Account Profile candidate endpoint. Project-local
tests and Flutter architecture rules own implementation details; this root guard only
checks that the pinned Flutter consumer and Laravel provider still agree.
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


def require_compact_fragment(
    findings: list[Finding],
    surface: str,
    source: str,
    fragment: str,
    correction: str,
) -> None:
    compact_source = "".join(source.split())
    if fragment not in compact_source:
        findings.append(Finding(surface, f"missing required contract `{fragment}`", correction))


def validate_repository(repo_root: Path) -> list[Finding]:
    findings: list[Finding] = []

    flutter_scope_path = (
        "flutter-app/lib/domain/tenant_admin/"
        "tenant_admin_account_profile_candidate_scope.dart"
    )
    flutter_repository_path = (
        "flutter-app/lib/infrastructure/repositories/tenant_admin/"
        "tenant_admin_account_profiles_repository.dart"
    )
    flutter_create_path = (
        "flutter-app/lib/presentation/tenant_admin/account_profiles/screens/"
        "tenant_admin_account_profile_create_screen.dart"
    )
    flutter_edit_path = (
        "flutter-app/lib/presentation/tenant_admin/account_profiles/screens/"
        "tenant_admin_account_profile_edit_screen.dart"
    )
    laravel_route_path = "laravel-app/routes/api/tenant_api_v1.php"
    laravel_request_path = (
        "laravel-app/app/Http/Api/v1/Requests/AccountProfileCandidatesRequest.php"
    )
    laravel_service_path = (
        "laravel-app/app/Application/AccountProfiles/"
        "AccountProfileCandidateDiscoveryService.php"
    )

    flutter_scope = read_source(repo_root, flutter_scope_path, findings)
    for fragment in (
        "TenantAdminAccountProfileCandidateScope.contactCapable => 'contact_capable'",
        "TenantAdminAccountProfileCandidateScope.queryable => 'queryable'",
    ):
        require_fragment(
            findings,
            flutter_scope_path,
            flutter_scope,
            fragment,
            "Keep Flutter candidate scopes aligned with Laravel's closed scope vocabulary.",
        )

    flutter_repository = read_source(repo_root, flutter_repository_path, findings)
    for fragment in (
        "fetchAccountProfileCandidatesPage({",
        "'$_apiBaseUrl/v1/account_profiles/candidates'",
        "scope: scope.wireValue",
        ".encodeFetchAccountProfileCandidatesQuery(",
    ):
        require_fragment(
            findings,
            flutter_repository_path,
            flutter_repository,
            fragment,
            "Keep the candidate repository on the shared scoped endpoint.",
        )

    flutter_create = read_source(repo_root, flutter_create_path, findings)
    require_compact_fragment(
        findings,
        flutter_create_path,
        flutter_create,
        "createCandidatePickerSession(scope:TenantAdminAccountProfileCandidateScope.contactCapable,maxSelections:1",
        "Keep Account Profile creation on one contact-capable candidate session.",
    )

    flutter_edit = read_source(repo_root, flutter_edit_path, findings)
    require_compact_fragment(
        findings,
        flutter_edit_path,
        flutter_edit,
        "createCandidatePickerSession(scope:TenantAdminAccountProfileCandidateScope.contactCapable,maxSelections:1,excludeAccountProfileId:widget.accountProfileId",
        "Keep Account Profile editing on one contact-capable session that excludes itself.",
    )

    laravel_route = read_source(repo_root, laravel_route_path, findings)
    require_fragment(
        findings,
        laravel_route_path,
        laravel_route,
        "Route::get('/candidates', [AccountProfilesController::class, 'candidates'])",
        "Expose the shared candidate endpoint under the Account Profile resource.",
    )
    forbid_fragment(
        findings,
        laravel_route_path,
        laravel_route,
        "Route::get('/contact_sources'",
        "Do not create a parallel contact-source endpoint; use the scoped candidate endpoint.",
    )

    laravel_request = read_source(repo_root, laravel_request_path, findings)
    require_fragment(
        findings,
        laravel_request_path,
        laravel_request,
        "Rule::in(AccountProfileCandidateDiscoveryService::scopes())",
        "Keep request validation bound to the candidate service's closed scope vocabulary.",
    )

    laravel_service = read_source(repo_root, laravel_service_path, findings)
    for fragment in (
        "public const SCOPE_QUERYABLE = 'queryable'",
        "public const SCOPE_CONTACT_CAPABLE = 'contact_capable'",
        "return [self::SCOPE_QUERYABLE, self::SCOPE_CONTACT_CAPABLE]",
    ):
        require_fragment(
            findings,
            laravel_service_path,
            laravel_service,
            fragment,
            "Keep Laravel's candidate scopes closed and aligned with Flutter.",
        )

    return findings


def print_teach(findings: list[Finding]) -> None:
    print("Canonical Contact Source Picker Contract — TEACH")
    print(
        "T (Truth): Account Profile contact-source selection uses the shared, scoped "
        "Account Profile candidate endpoint with scope=contact_capable."
    )
    print(
        "E (Evidence): the pinned Flutter create/edit consumers use a typed candidate "
        "session and Laravel exposes the matching closed-scope candidate contract."
    )
    if not findings:
        print("A (Assessment): the cross-repository candidate contract is aligned.")
        print("C (Correction): none required.")
        print("H (Handoff): project-local tests and architecture rules own implementation details.")
        print("Overall outcome: go")
        return

    print("A (Assessment): no-go; the cross-repository candidate contract has drifted.")
    print("C (Corrections):")
    for finding in findings:
        print(f"  - [{finding.surface}] {finding.problem}")
        print(f"    Repair: {finding.correction}")
    print("H (Handoff): align the pinned Flutter consumer and Laravel provider, then rerun this guard.")
    print("Overall outcome: no-go")


def main() -> int:
    args = parse_args()
    findings = validate_repository(args.repo.resolve())
    print_teach(findings)
    return 0 if not findings else 2


if __name__ == "__main__":
    raise SystemExit(main())
