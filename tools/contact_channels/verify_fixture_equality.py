#!/usr/bin/env python3
"""Fail closed when contact-channel package fixtures drift from the v1 corpus."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CANONICAL = REPO_ROOT / "foundation_documentation/contracts/contact_channels/v1/email-whatsapp.json"
DEFAULT_LARAVEL = REPO_ROOT / "laravel-app/packages/belluga/belluga_contact_channels/fixtures/contact_channels.v1.json"
DEFAULT_FLUTTER = REPO_ROOT / "flutter-app/packages/belluga_contact_channels/fixtures/contact_channels.v1.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--canonical", type=Path, default=DEFAULT_CANONICAL)
    parser.add_argument("--laravel", type=Path, default=DEFAULT_LARAVEL)
    parser.add_argument("--flutter", type=Path, default=DEFAULT_FLUTTER)
    return parser.parse_args()


def read_json(path: Path) -> bytes:
    try:
        payload = path.read_bytes()
    except OSError as exc:
        raise ValueError(f"missing fixture: {path} ({exc})") from exc

    try:
        decoded = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise ValueError(f"invalid JSON fixture: {path} ({exc})") from exc

    if not isinstance(decoded, dict) or decoded.get("version") != 1:
        raise ValueError(f"fixture must declare version 1: {path}")

    return payload


def main() -> int:
    args = parse_args()
    try:
        canonical = read_json(args.canonical)
        candidates = (("Laravel", args.laravel), ("Flutter", args.flutter))
        for label, path in candidates:
            if read_json(path) != canonical:
                raise ValueError(
                    f"{label} fixture differs byte-for-byte from canonical corpus: {path}"
                )
    except ValueError as exc:
        print(f"[contact-channels-fixture] FAIL: {exc}", file=sys.stderr)
        return 1

    print("[contact-channels-fixture] PASS: Laravel and Flutter fixtures match v1 corpus.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
