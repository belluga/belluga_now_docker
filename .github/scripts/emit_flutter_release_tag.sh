#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
FLUTTER_SUBMODULE_PATH="${FLUTTER_SUBMODULE_PATH:-flutter-app}"
FLUTTER_REPO_DIR="${ROOT_DIR}/${FLUTTER_SUBMODULE_PATH}"

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

record_output() {
  local key="$1"
  local value="$2"

  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    printf '%s=%s\n' "${key}" "${value}" >>"${GITHUB_OUTPUT}"
  fi
}

resolve_remote_tag_target() {
  local tag_name="$1"
  local direct_ref=""
  local peeled_ref=""
  local sha=""
  local ref=""

  while IFS=$'\t' read -r sha ref; do
    [[ -n "${sha}" ]] || continue
    case "${ref}" in
      "refs/tags/${tag_name}")
        direct_ref="${sha}"
        ;;
      "refs/tags/${tag_name}^{}")
        peeled_ref="${sha}"
        ;;
      *)
        fail "unexpected remote tag ref '${ref}' while resolving '${tag_name}'."
        ;;
    esac
  done < <(git -C "${FLUTTER_REPO_DIR}" ls-remote --tags origin "refs/tags/${tag_name}" "refs/tags/${tag_name}^{}")

  if [[ -n "${peeled_ref}" ]]; then
    printf '%s\n' "${peeled_ref}"
  elif [[ -n "${direct_ref}" ]]; then
    printf '%s\n' "${direct_ref}"
  fi
}

if [[ ! -d "${FLUTTER_REPO_DIR}" ]]; then
  fail "flutter submodule path '${FLUTTER_SUBMODULE_PATH}' is missing from the checked out repository."
fi

flutter_sha="$(git -C "${ROOT_DIR}" ls-tree HEAD "${FLUTTER_SUBMODULE_PATH}" | awk 'NF {print $3}' | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"
if ! [[ "${flutter_sha}" =~ ^[0-9a-f]{40}$ ]]; then
  fail "failed to resolve the pinned flutter-app SHA from the root gitlink."
fi

checked_out_flutter_sha="$(git -C "${FLUTTER_REPO_DIR}" rev-parse HEAD | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"
if [[ "${checked_out_flutter_sha}" != "${flutter_sha}" ]]; then
  fail "checked out flutter-app SHA '${checked_out_flutter_sha}' does not match root gitlink '${flutter_sha}'."
fi

if ! pubspec_content="$(git -C "${FLUTTER_REPO_DIR}" show "${flutter_sha}:pubspec.yaml" 2>/dev/null)"; then
  fail "could not read pubspec.yaml from flutter-app commit '${flutter_sha}'."
fi

mapfile -t raw_version_lines < <(printf '%s\n' "${pubspec_content}" | sed -n 's/^[[:space:]]*version:[[:space:]]*//p')
version_lines=()
for line in "${raw_version_lines[@]}"; do
  normalized_line="$(printf '%s' "${line}" | sed 's/[[:space:]]*#.*$//' | xargs)"
  if [[ -n "${normalized_line}" ]]; then
    version_lines+=("${normalized_line}")
  fi
done

if [[ "${#version_lines[@]}" -ne 1 ]]; then
  fail "could not resolve one unambiguous Flutter version tuple from flutter-app/pubspec.yaml at '${flutter_sha}'."
fi

flutter_version="${version_lines[0]}"
if [[ "${flutter_version}" == *[[:space:]]* ]]; then
  fail "resolved Flutter version tuple '${flutter_version}' is invalid because it contains whitespace."
fi

tag_name="v${flutter_version}"
push_stderr="$(mktemp)"

cleanup_push_stderr() {
  rm -f "${push_stderr}"
}

trap cleanup_push_stderr EXIT

record_output "flutter_sha" "${flutter_sha}"
record_output "flutter_version" "${flutter_version}"
record_output "tag_name" "${tag_name}"

if ! git -C "${FLUTTER_REPO_DIR}" fetch --tags origin --quiet; then
  fail "failed to fetch flutter-app tags from origin. Check repository access for the workflow token."
fi

existing_remote_target="$(resolve_remote_tag_target "${tag_name}" || true)"
if [[ -n "${existing_remote_target}" ]]; then
  if [[ "${existing_remote_target}" == "${flutter_sha}" ]]; then
    echo "INFO: flutter-app release tag '${tag_name}' already exists on '${flutter_sha}'; explicit no-op."
    record_output "created" "false"
    record_output "action" "noop_same_sha"
    exit 0
  fi

  fail "flutter-app release tag '${tag_name}' already exists on '${existing_remote_target}', expected '${flutter_sha}'. Refusing to retarget immutable release provenance."
fi

git -C "${FLUTTER_REPO_DIR}" tag -d "${tag_name}" >/dev/null 2>&1 || true
git -C "${FLUTTER_REPO_DIR}" tag "${tag_name}" "${flutter_sha}"

if git -C "${FLUTTER_REPO_DIR}" push origin "refs/tags/${tag_name}" >/dev/null 2>"${push_stderr}"; then
  echo "INFO: created flutter-app release tag '${tag_name}' on '${flutter_sha}'."
  record_output "created" "true"
  record_output "action" "created"
  exit 0
fi

post_push_target="$(resolve_remote_tag_target "${tag_name}" || true)"
if [[ "${post_push_target}" == "${flutter_sha}" ]]; then
  echo "INFO: flutter-app release tag '${tag_name}' reached '${flutter_sha}' concurrently; explicit no-op."
  record_output "created" "false"
  record_output "action" "noop_race_same_sha"
  exit 0
fi

push_error_detail="$(tr '\n' ' ' <"${push_stderr}" | sed 's/[[:space:]]\+/ /g' | xargs || true)"
if [[ -n "${push_error_detail}" ]]; then
  fail "failed to push flutter-app release tag '${tag_name}'. Git reported: ${push_error_detail}"
fi

fail "failed to push flutter-app release tag '${tag_name}'. Check token write access and remote tag protection."
