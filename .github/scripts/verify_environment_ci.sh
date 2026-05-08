#!/usr/bin/env bash
set -euo pipefail

required_files=(
  ".gitmodules"
  "docker-compose.yml"
  ".github/scripts/check_promotion_lane.sh"
  ".github/scripts/check_submodule_branch_alignment.sh"
  ".github/scripts/check_web_flutter_metadata.sh"
)

for file in "${required_files[@]}"; do
  if [[ ! -f "$file" ]]; then
    echo "ERROR: required file missing: $file" >&2
    exit 1
  fi
done

worker_block="$(awk '
  /^  worker:/ { in_worker=1; print; next }
  in_worker && /^  [a-zA-Z0-9_-]+:/ { exit }
  in_worker { print }
' docker-compose.yml)"

if [[ -z "$worker_block" ]]; then
  echo "ERROR: docker-compose.yml missing worker service block" >&2
  exit 1
fi

if ! grep -Fq 'command: ["sh", "/var/www/scripts/run_queue_worker.sh"]' <<<"$worker_block"; then
  echo "ERROR: worker service must use /var/www/scripts/run_queue_worker.sh so OTP jobs on queue 'otp' are consumed." >&2
  exit 1
fi

required_submodules=(flutter-app laravel-app web-app)

for submodule in "${required_submodules[@]}"; do
  if ! grep -Eq "path[[:space:]]*=[[:space:]]*$submodule" .gitmodules; then
    echo "ERROR: .gitmodules missing required submodule path '$submodule'" >&2
    exit 1
  fi

  if [[ ! -d "$submodule" ]]; then
    echo "ERROR: expected checkout directory for submodule '$submodule' not found" >&2
    exit 1
  fi
done

echo "OK: CI environment invariants validated."
