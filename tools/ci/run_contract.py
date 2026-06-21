#!/usr/bin/env python3
"""Execute repo-owned CI contract manifests for local CI-equivalent profiles."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
PROFILE_TO_MANIFEST = {
    "stage-full": REPO_ROOT / "tools" / "ci" / "contracts" / "stage-full.json",
    "main-proof": REPO_ROOT / "tools" / "ci" / "contracts" / "main-proof.json",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run local CI contract manifests.")
    parser.add_argument("--profile", choices=sorted(PROFILE_TO_MANIFEST), help="Named contract profile to run.")
    parser.add_argument("--manifest", help="Explicit manifest path (used mainly for tests/debug).")
    parser.add_argument("--report", help="Optional JSON report output path.")
    parser.add_argument("--list", action="store_true", help="List the resolved entries without executing them.")
    return parser.parse_args()


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def resolve_manifest(args: argparse.Namespace) -> Path:
    if bool(args.profile) == bool(args.manifest):
        raise ValueError("pass exactly one of --profile or --manifest")
    if args.profile:
        return PROFILE_TO_MANIFEST[args.profile]
    manifest_path = Path(args.manifest)
    if not manifest_path.is_absolute():
        manifest_path = (Path.cwd() / manifest_path).resolve()
    return manifest_path


def normalize_path(base: Path, raw_path: str) -> Path:
    candidate = Path(raw_path)
    if candidate.is_absolute():
        return candidate
    return (base / candidate).resolve()


def flatten_manifest(manifest_path: Path, visited: set[Path] | None = None) -> tuple[dict, list[dict]]:
    visited = visited or set()
    manifest_path = manifest_path.resolve()
    if manifest_path in visited:
        raise ValueError(f"manifest import cycle detected at {manifest_path}")
    visited.add(manifest_path)

    payload = load_json(manifest_path)
    if payload.get("schema_version") != "ci-contract-v1":
        raise ValueError(f"{manifest_path} must declare schema_version=ci-contract-v1")

    base_dir = manifest_path.parent
    entries: list[dict] = []
    for imported in payload.get("imports", []):
        child_path = normalize_path(base_dir, imported["path"])
        _, child_entries = flatten_manifest(child_path, visited)
        entries.extend(child_entries)
    for entry in payload.get("entries", []):
        command = entry.get("command")
        if not isinstance(command, list) or not command or not all(isinstance(part, str) for part in command):
            raise ValueError(f"{manifest_path} entry `{entry.get('id', '<missing>')}` must use a string command array")
        cwd = normalize_path(base_dir, entry.get("cwd", "."))
        if not cwd.exists():
            raise ValueError(f"{manifest_path} entry `{entry.get('id', '<missing>')}` cwd does not exist: {cwd}")
        entries.append(
            {
                "id": entry["id"],
                "description": entry.get("description", ""),
                "kind": entry.get("kind", "contract-entry"),
                "repo": entry.get("repo", "unknown"),
                "manifest_path": str(manifest_path),
                "cwd": str(cwd),
                "command": command,
            }
        )
    return payload, entries


def render_listing(contract_id: str, description: str, entries: list[dict]) -> str:
    lines = [f"Contract: {contract_id}", f"Description: {description}", ""]
    for entry in entries:
        lines.extend(
            [
                f"- {entry['id']} ({entry['repo']})",
                f"  cwd: {entry['cwd']}",
                f"  cmd: {' '.join(entry['command'])}",
            ]
        )
    return "\n".join(lines) + "\n"


def execute_entries(entries: list[dict]) -> tuple[list[dict], bool]:
    results: list[dict] = []
    all_passed = True
    for entry in entries:
        print(f"[ci-contract] START {entry['id']} ({entry['repo']}) -> {' '.join(entry['command'])}")
        started_at = time.time()
        completed = subprocess.run(entry["command"], cwd=entry["cwd"], check=False)
        duration_seconds = round(time.time() - started_at, 3)
        status = "passed" if completed.returncode == 0 else "failed"
        print(
            f"[ci-contract] {status.upper()} {entry['id']} exit={completed.returncode} duration={duration_seconds:.3f}s"
        )
        results.append(
            {
                "id": entry["id"],
                "repo": entry["repo"],
                "kind": entry["kind"],
                "manifest_path": entry["manifest_path"],
                "cwd": entry["cwd"],
                "command": entry["command"],
                "status": status,
                "exit_code": completed.returncode,
                "duration_seconds": duration_seconds,
            }
        )
        if completed.returncode != 0:
            all_passed = False
            break
    return results, all_passed


def write_report(path: Path, contract_payload: dict, manifest_path: Path, results: list[dict], overall_status: str) -> None:
    payload = {
        "schema_version": "ci-contract-run-v1",
        "artifact_kind": "ci_contract_run",
        "contract_id": contract_payload["contract_id"],
        "manifest_path": str(manifest_path),
        "overall_status": overall_status,
        "entries": results,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    args = parse_args()
    try:
        manifest_path = resolve_manifest(args)
        payload, entries = flatten_manifest(manifest_path)
    except Exception as exc:  # noqa: BLE001 - deterministic CLI error path
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    if args.list:
        print(render_listing(payload["contract_id"], payload.get("description", ""), entries), end="")
        return 0

    try:
        results, all_passed = execute_entries(entries)
    except KeyboardInterrupt:
        print("[ci-contract] INTERRUPTED by operator", file=sys.stderr)
        return 130
    overall_status = "passed" if all_passed else "failed"
    if args.report:
        write_report(Path(args.report).resolve(), payload, manifest_path, results, overall_status)
    return 0 if all_passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
