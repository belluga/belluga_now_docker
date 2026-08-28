#!/usr/bin/env bash
set -euo pipefail
umask 077

mode="${1:-}"; [[ $# -gt 0 ]] && shift
manifest=""; actual=""; root=""; laravel=""; flutter=""
expected_run_id=""; expected_lane=""; expected_platform=""; expected_build=""
while (($#)); do
  case "$1" in
    --manifest) manifest="$2"; shift 2 ;;
    --actual-run) actual="$2"; shift 2 ;;
    --root-repository) root="$2"; shift 2 ;;
    --laravel-repository) laravel="$2"; shift 2 ;;
    --flutter-repository) flutter="$2"; shift 2 ;;
    --expected-run-id) expected_run_id="$2"; shift 2 ;;
    --expected-lane) expected_lane="$2"; shift 2 ;;
    --expected-platform) expected_platform="$2"; shift 2 ;;
    --expected-build-fingerprint) expected_build="$2"; shift 2 ;;
    *) echo "ERROR: unknown argument $1" >&2; exit 2 ;;
  esac
done
[[ "$mode" == --record-new || "$mode" == --validate-existing ]] || { echo 'ERROR: use --record-new or --validate-existing' >&2; exit 2; }
[[ -n "$manifest" && -n "$actual" && -n "$root" && -n "$laravel" && -n "$flutter" ]] || { echo 'ERROR: manifest, actual-run and all repositories are required' >&2; exit 2; }
[[ -n "$expected_run_id" && -n "$expected_lane" && -n "$expected_platform" && -n "$expected_build" ]] || { echo 'ERROR: all expected runtime identity values are required' >&2; exit 2; }

python3 - "$mode" "$manifest" "$actual" "$root" "$laravel" "$flutter" "$expected_run_id" "$expected_lane" "$expected_platform" "$expected_build" <<'PY'
import datetime as dt
import hashlib
import json
import os
import pathlib
import re
import stat
import subprocess
import sys
import urllib.parse

(mode, manifest_raw, actual_raw, *repos, expected_run_id, expected_lane,
 expected_platform, expected_build) = sys.argv[1:]
manifest = pathlib.Path(manifest_raw).absolute()
actual = pathlib.Path(actual_raw).absolute()

def fail(message):
    raise SystemExit(f'ERROR: {message}')

def reject_symlink_components(path, leaf_may_not_exist=False):
    current = pathlib.Path(path.anchor)
    parts = path.parts[1:] if path.is_absolute() else path.parts
    for index, part in enumerate(parts):
        current = current / part
        if leaf_may_not_exist and index == len(parts) - 1 and not current.exists():
            continue
        if current.is_symlink():
            fail(f'symlink path is forbidden: {current}')

reject_symlink_components(actual)
if not actual.is_file(): fail('actual-run must be a regular file')
reject_symlink_components(manifest, leaf_may_not_exist=True)
try:
    actual_bytes = actual.read_bytes()
    evidence = json.loads(actual_bytes)
except (OSError, json.JSONDecodeError) as error:
    fail(f'invalid actual-run: {error}')

actual_keys = {'schema_version','lane','run_id','served_build_fingerprint','target_base_url','tenant_id','fixture_ids','platform','runtime_identity','backend_identity','steps','lifecycle','tap_outcome'}
lifecycle_keys = {'started_at','completed_at','cleanup_completed_at','cleanup_succeeded'}
tap_keys = {'status','target_urls'}
if not isinstance(evidence, dict) or set(evidence) != actual_keys: fail('actual-run schema is not the closed v2 schema')
if evidence.get('schema_version') != 2: fail('actual-run schema_version must be 2')
if not isinstance(evidence.get('lifecycle'), dict) or set(evidence['lifecycle']) != lifecycle_keys: fail('actual-run lifecycle schema is not closed')
if not isinstance(evidence.get('tap_outcome'), dict) or set(evidence['tap_outcome']) != tap_keys: fail('actual-run tap_outcome schema is not closed')
if evidence.get('run_id') != expected_run_id or evidence.get('lane') != expected_lane: fail('actual-run run-id/lane does not match wrapper-owned identity')
if evidence.get('platform') != expected_platform: fail('actual-run platform does not match wrapper-owned identity')
if evidence.get('served_build_fingerprint') != expected_build: fail('actual-run build fingerprint does not match wrapper-owned identity')
if expected_lane not in {'event-web','account-profile-web','android'}: fail('unknown runtime lane')
if (expected_lane == 'android') != (expected_platform == 'android'): fail('lane/platform combination is invalid')
if not re.fullmatch(r'[0-9a-f]{7,64}(?:-[0-9a-f]{7,64})?', expected_build): fail('unknown or malformed build fingerprint')
if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:-]{7,127}', expected_run_id): fail('malformed run-id')

required_steps = ['toolbar_authoring','delta_or_html','backend_readback','public_render','anchor_tap','tap_outcome']
if evidence.get('steps') != required_steps: fail('runtime steps must be the exact ordered lifecycle')
if not isinstance(evidence.get('fixture_ids'), list) or not evidence['fixture_ids']: fail('fixture_ids must be a non-empty list')
for key in ('tenant_id','runtime_identity','backend_identity'):
    if not isinstance(evidence.get(key), str) or not evidence[key]: fail(f'{key} must be a non-empty string')

def parse_time(value, key):
    if not isinstance(value, str) or not value.endswith('Z'): fail(f'{key} must be a UTC timestamp')
    try: return dt.datetime.fromisoformat(value[:-1] + '+00:00')
    except ValueError: fail(f'{key} is malformed')
life = evidence['lifecycle']
times = [parse_time(life[key], key) for key in ('started_at','completed_at','cleanup_completed_at')]
if times != sorted(times) or life['cleanup_succeeded'] is not True: fail('runtime lifecycle is unordered or cleanup did not succeed')

def validate_https_url(value, key):
    if not isinstance(value, str) or value != value.strip() or re.search(r'[\x00-\x20\x7f\\"<>]', value): fail(f'{key} contains whitespace, control, backslash, quote, or angle bracket')
    if re.search(r'%(?![0-9A-Fa-f]{2})|%(?:0[0-9A-Fa-f]|1[0-9A-Fa-f]|20|7[fF])', value): fail(f'{key} contains malformed or forbidden percent encoding')
    try:
        parsed = urllib.parse.urlsplit(value); port = parsed.port
    except ValueError: fail(f'{key} is malformed')
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username is not None or parsed.password is not None: fail(f'{key} must be absolute HTTPS without userinfo')
    if port is not None and not 1 <= port <= 65535: fail(f'{key} has invalid port')
    authority = parsed.netloc
    if '%' in authority: fail(f'{key} contains an encoded authority')
    if authority.startswith('['):
        close = authority.find(']')
        lexical_port = authority[close + 2:] if close >= 0 and authority[close + 1:close + 2] == ':' else None
    else:
        lexical_port = authority.rsplit(':', 1)[1] if authority.count(':') == 1 else None
    if lexical_port is not None and len(lexical_port) > 1 and lexical_port.startswith('0'): fail(f'{key} has a leading-zero port')
    return parsed

base_url = validate_https_url(evidence['target_base_url'], 'target_base_url')
if base_url.query or base_url.fragment: fail('target_base_url cannot contain query or fragment')
backend_identity = validate_https_url(evidence['backend_identity'], 'backend_identity')
if backend_identity.query or backend_identity.fragment: fail('backend_identity cannot contain query or fragment')
runtime_identity = evidence['runtime_identity']
if re.match(r'^[A-Za-z][A-Za-z0-9+.-]*://', runtime_identity):
    runtime_url = validate_https_url(runtime_identity, 'runtime_identity')
    if runtime_url.query or runtime_url.fragment: fail('runtime_identity URL cannot contain query or fragment')
tap = evidence['tap_outcome']
if tap.get('status') not in {'opened','external_application'}: fail('tap outcome status is invalid')
if not isinstance(tap.get('target_urls'), list) or not tap['target_urls']: fail('tap outcome target_urls must be non-empty')
sensitive_query_key_segments = {'sig','signature','token','key','secret','password','passwd','authorization','auth'}
sensitive_compact_query_keys = {'accesstoken','apikey'}
def contains_sensitive_url_params(raw_params):
    for query_key, _ in urllib.parse.parse_qsl(raw_params, keep_blank_values=True):
        camel_split_key = re.sub(r'([a-z0-9])([A-Z])', r'\1_\2', query_key)
        query_key_parts = re.findall(r'[a-z0-9]+', camel_split_key.lower())
        query_key_segments = set(query_key_parts)
        compact_query_key = ''.join(query_key_parts)
        if query_key_segments & sensitive_query_key_segments or compact_query_key in sensitive_compact_query_keys:
            return True
    return False
for index, target in enumerate(tap['target_urls']):
    parsed_target = validate_https_url(target, f'tap_outcome.target_urls[{index}]')
    if contains_sensitive_url_params(parsed_target.query) or contains_sensitive_url_params(parsed_target.fragment):
        fail(f'tap_outcome.target_urls[{index}] contains sensitive query or fragment key')

secret_key = re.compile(r'(?:password|passwd|secret|token|authorization|cookie|api[_-]?key)', re.I)
bearer = re.compile(r'\bbearer\s+[A-Za-z0-9._~+/=-]+', re.I)
control = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]')
def scan(value, location='$'):
    if isinstance(value, dict):
        for key, nested in value.items():
            if secret_key.search(str(key)): fail(f'secret-bearing key at {location}')
            scan(nested, f'{location}.{key}')
    elif isinstance(value, list):
        for index, nested in enumerate(value): scan(nested, f'{location}[{index}]')
    elif isinstance(value, str):
        if control.search(value) or bearer.search(value): fail(f'secret/control-bearing value at {location}')
        if re.match(r'^[A-Za-z][A-Za-z0-9+.-]*://', value):
            try: parsed = urllib.parse.urlsplit(value)
            except ValueError: fail(f'malformed URL value at {location}')
            if parsed.username is not None or parsed.password is not None: fail(f'URL userinfo at {location}')
scan(evidence)

repo_names = ('root','laravel_app','flutter_app')
excluded = {actual, manifest}
def git(repo, *args): return subprocess.check_output(['git','-C',repo,*args])
def current_path_record(repo_path, relative):
    path = repo_path / os.fsdecode(relative)
    if path.absolute() in excluded: return b''
    try: info = path.lstat()
    except FileNotFoundError: return b'D\0' + relative + b'\0'
    mode_bits = stat.S_IMODE(info.st_mode)
    if stat.S_ISLNK(info.st_mode): payload = os.fsencode(os.readlink(path)); kind = b'L'
    elif stat.S_ISREG(info.st_mode): payload = path.read_bytes(); kind = b'F'
    elif stat.S_ISDIR(info.st_mode): payload = b''; kind = b'G'
    else: fail(f'unsupported repository path type: {path}')
    return kind+b'\0'+relative+b'\0'+oct(mode_bits).encode()+b'\0'+hashlib.sha256(payload).digest()
def repository_identity(repo):
    repo_path = pathlib.Path(repo).resolve(strict=True)
    head = git(repo,'rev-parse','HEAD').strip().decode()
    index = git(repo,'ls-files','-s','-z')
    tracked = [item for item in git(repo,'ls-files','-z').split(b'\0') if item]
    untracked = [item for item in git(repo,'ls-files','--others','--exclude-standard','-z').split(b'\0') if item]
    digest = hashlib.sha256(); digest.update(b'HEAD\0'+head.encode()+b'\0INDEX\0'+index+b'\0CURRENT\0')
    for relative in sorted(set(tracked+untracked)): digest.update(current_path_record(repo_path,relative))
    return head,digest.hexdigest()
commits={}; fingerprints={}
for name,repo in zip(repo_names,repos): commits[name],fingerprints[name]=repository_identity(repo)

manifest_value = {'schema_version':2,'lane':evidence['lane'],'run_id':evidence['run_id'],'source_commits':commits,'source_fingerprints':fingerprints,'actual_run_sha256':hashlib.sha256(actual_bytes).hexdigest(),'served_build_fingerprint':evidence['served_build_fingerprint'],'target_base_url':evidence['target_base_url'],'tenant_id':evidence['tenant_id'],'fixture_ids':evidence['fixture_ids'],'platform':evidence['platform'],'runtime_identity':evidence['runtime_identity'],'backend_identity':evidence['backend_identity'],'steps':evidence['steps'],'lifecycle':evidence['lifecycle'],'tap_outcome':evidence['tap_outcome'],'generated_at':evidence['lifecycle']['cleanup_completed_at']}
serialized=(json.dumps(manifest_value,sort_keys=True,indent=2)+'\n').encode()
if mode=='--record-new':
    manifest.parent.mkdir(parents=True,exist_ok=True,mode=0o700); reject_symlink_components(manifest.parent)
    if manifest.exists() or manifest.is_symlink(): fail('refusing to overwrite manifest')
    temporary=manifest.parent/f'.{manifest.name}.{os.getpid()}.{os.urandom(8).hex()}.tmp'
    descriptor=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    try:
        with os.fdopen(descriptor,'wb') as stream: stream.write(serialized); stream.flush(); os.fsync(stream.fileno())
        os.link(temporary,manifest)
    finally:
        try: temporary.unlink()
        except FileNotFoundError: pass
else:
    reject_symlink_components(manifest)
    if not manifest.is_file(): fail('manifest absent; validation never creates it')
    if manifest.read_bytes()!=serialized: fail('manifest is stale or mismatched')
PY
