#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNNER="$ROOT_DIR/tools/ci/run_contract.sh"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

PASS_SCRIPT="$TMP_DIR/pass.sh"
FAIL_SCRIPT="$TMP_DIR/fail.sh"
MANIFEST="$TMP_DIR/test-contract.json"
REPORT="$TMP_DIR/report.json"
OUTPUT="$TMP_DIR/output.log"

cat > "$PASS_SCRIPT" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
printf 'pass-script-ok\n'
SCRIPT

cat > "$FAIL_SCRIPT" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
printf 'fail-script-start\n'
exit 7
SCRIPT

chmod +x "$PASS_SCRIPT" "$FAIL_SCRIPT"

cat > "$MANIFEST" <<JSON
{
  "schema_version": "ci-contract-v1",
  "contract_id": "runner-test",
  "description": "Synthetic contract runner test",
  "entries": [
    {
      "id": "first-pass",
      "repo": "synthetic",
      "cwd": "${TMP_DIR}",
      "command": ["bash", "${PASS_SCRIPT}"]
    }
  ]
}
JSON

bash "$RUNNER" --manifest "$MANIFEST" --report "$REPORT" >"$OUTPUT"
grep -q 'START first-pass' "$OUTPUT"
grep -q 'PASSED first-pass' "$OUTPUT"

python3 - "$REPORT" <<'PY'
import json
import sys
from pathlib import Path

payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
assert payload["artifact_kind"] == "ci_contract_run"
assert payload["overall_status"] == "passed"
assert payload["entries"][0]["id"] == "first-pass"
assert payload["entries"][0]["status"] == "passed"
PY

cat > "$MANIFEST" <<JSON
{
  "schema_version": "ci-contract-v1",
  "contract_id": "runner-test-fail",
  "description": "Synthetic contract runner failure test",
  "entries": [
    {
      "id": "first-pass",
      "repo": "synthetic",
      "cwd": "${TMP_DIR}",
      "command": ["bash", "${PASS_SCRIPT}"]
    },
    {
      "id": "second-fail",
      "repo": "synthetic",
      "cwd": "${TMP_DIR}",
      "command": ["bash", "${FAIL_SCRIPT}"]
    },
    {
      "id": "third-unreached",
      "repo": "synthetic",
      "cwd": "${TMP_DIR}",
      "command": ["bash", "${PASS_SCRIPT}"]
    }
  ]
}
JSON

if bash "$RUNNER" --manifest "$MANIFEST" --report "$REPORT" >"$OUTPUT" 2>&1; then
  cat "$OUTPUT"
  printf 'expected failing manifest to stop the runner\n' >&2
  exit 1
fi

grep -q 'FAILED second-fail exit=7' "$OUTPUT"

python3 - "$REPORT" <<'PY'
import json
import sys
from pathlib import Path

payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
assert payload["overall_status"] == "failed"
assert len(payload["entries"]) == 2
assert payload["entries"][1]["id"] == "second-fail"
assert payload["entries"][1]["exit_code"] == 7
PY

printf 'ci_contract_runner_test: OK\n'
