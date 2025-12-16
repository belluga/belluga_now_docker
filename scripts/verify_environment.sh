#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "== docker compose config (default) =="
docker compose config >/dev/null
echo "OK"

echo "== docker compose config (--profile local-db) =="
docker compose --profile local-db config >/dev/null
echo "OK"

if [[ "${COMPOSE_PROFILES:-}" == *"local-db"* ]]; then
  echo "== local-db profile checks =="
  if [[ ! -f "laravel-app/.env" ]]; then
    echo "WARN: laravel-app/.env not found; configure DB_URI/DB_URI_LANDLORD/DB_URI_TENANTS for local Mongo." >&2
    exit 0
  fi

  if ! rg -n '^(DB_URI|DB_URI_LANDLORD|DB_URI_TENANTS)=' laravel-app/.env >/dev/null; then
    echo "WARN: laravel-app/.env missing DB_URI* variables; local Mongo may not connect." >&2
    exit 0
  fi

  if ! rg -n 'mongo:27017' laravel-app/.env >/dev/null; then
    echo "WARN: laravel-app/.env DB_URI* do not reference mongo:27017; local-db profile may not be used." >&2
  fi
fi
