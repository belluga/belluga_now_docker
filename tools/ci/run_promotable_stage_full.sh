#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "INFO: promotable stage-full wrapper starting."
bash "${ROOT_DIR}/tools/ci/verify_stage_full_promotable_state.sh"
echo "INFO: promotable state passed; launching stage-full."
bash "${ROOT_DIR}/tools/ci/run_contract.sh" --profile stage-full "$@"
