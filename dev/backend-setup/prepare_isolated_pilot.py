#!/usr/bin/env python3
"""Offline validation/command preparation only. Never invokes Firebase or logs in."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shlex

PROJECT = 'blakeout-darts-dev'
APP = '1:901185136996:web:89d4f413520e66ff773271'
CONFIG = {'firestore': {'database': '(default)', 'rules': 'firestore.isolated-candidate.rules'}}


def validate(directory, project, expected_sha256, prepare=False):
    if project != PROJECT:
        raise ValueError('Only blakeout-darts-dev is permitted; production/aliases refused')
    paths = {name: directory / name for name in [
        'firebase.isolated-dev.json', 'isolated-pilot-manifest.json',
        'firestore.isolated-candidate.rules']}
    if any(p.is_symlink() or not p.is_file() for p in paths.values()):
        raise ValueError('Require regular local config, manifest and candidate files')
    if json.loads(paths['firebase.isolated-dev.json'].read_text()) != CONFIG:
        raise ValueError('Config must select only the default database and exact isolated rules file')
    rules = paths['firestore.isolated-candidate.rules'].read_bytes()
    digest = hashlib.sha256(rules).hexdigest()
    manifest = json.loads(paths['isolated-pilot-manifest.json'].read_text())
    if manifest != {'projectId': PROJECT, 'appId': APP, 'database': '(default)', 'rulesSha256': digest}:
        raise ValueError('Pinned manifest identity/hash mismatch; re-review changed candidate')
    if not re.fullmatch('[0-9a-f]{64}', expected_sha256) or expected_sha256 != digest:
        raise ValueError('Explicit expected SHA256 does not match exact candidate bytes')
    source = rules.decode('utf-8')
    matches = re.findall(r'function devPilotUids\(\)\s*\{\s*//[^\n]*\n\s*return (\[[^\]]*\]);\s*\}', source)
    if len(matches) != 1 or '&& request.auth.uid in devPilotUids()' not in source:
        raise ValueError('Missing explicit pilot membership guard')
    uids = json.loads(matches[0])
    if not isinstance(uids, list) or len(uids) > 20 or any(
            not isinstance(uid, str) or not re.fullmatch('[A-Za-z0-9_-]{1,128}', uid) for uid in uids):
        raise ValueError('Pilot requires at most 20 explicit supported UID strings')
    if len(set(uids)) != len(uids):
        raise ValueError('Duplicate pilot UID')
    if prepare and not uids:
        raise ValueError('Empty pilot: all clients denied; no activation command prepared')
    result = {'projectId': PROJECT, 'appId': APP, 'database': '(default)',
              'rulesSha256': digest, 'pilotCount': len(uids),
              'status': 'LOCKED: empty pilot denies all clients' if not uids else 'REVIEW REQUIRED: named UID candidate',
              'executed': False}
    if prepare:
        result['proposedCommand'] = shlex.join(['firebase', 'deploy', '--project', PROJECT,
            '--config', str(paths['firebase.isolated-dev.json'].resolve()), '--only', 'firestore:rules'])
        result['warning'] = 'Preparation only. Exact live deployment still requires separate authorization.'
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', required=True)
    parser.add_argument('--expected-sha256', required=True)
    parser.add_argument('--prepare-command', action='store_true')
    args = parser.parse_args()
    try:
        result = validate(Path(__file__).resolve().parent, args.project, args.expected_sha256, args.prepare_command)
    except (ValueError, OSError) as error:
        parser.exit(2, 'REFUSED: ' + str(error) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
