#!/usr/bin/env python3
"""No network/subprocess: exact guard and tamper tests in disposable directories."""
import hashlib
import importlib.util
import json
import re
from pathlib import Path
import tempfile

ROOT = Path(__file__).resolve().parents[2]
DIR = ROOT / 'dev/backend-setup'
spec = importlib.util.spec_from_file_location('pilot_guard', DIR / 'prepare_isolated_pilot.py')
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)
count = 0

def check(name, mutate=None, project=g.PROJECT, expected=None, prepare=False, deny=True):
    global count
    with tempfile.TemporaryDirectory() as tmp:
        d = Path(tmp)
        for f in ['firebase.isolated-dev.json', 'isolated-pilot-manifest.json', 'firestore.isolated-candidate.rules']:
            (d / f).write_bytes((DIR / f).read_bytes())
        rules = d / 'firestore.isolated-candidate.rules'
        rules.write_text(re.sub(r'(function devPilotUids\(\)\s*\{[^}]*return )\[[^\]]*\];', lambda m: m.group(1)+'[];', rules.read_text()))
        digest = hashlib.sha256(rules.read_bytes()).hexdigest()
        pin = d / 'isolated-pilot-manifest.json'
        data = json.loads(pin.read_text()); data['rulesSha256'] = digest; pin.write_text(json.dumps(data))
        if mutate:
            changed = mutate(d)
            if changed: digest = changed
        try:
            result = g.validate(d, project, expected or digest, prepare)
        except ValueError:
            assert deny, name
        else:
            assert not deny, name
            assert result['executed'] is False
            if not prepare: assert 'proposedCommand' not in result
            else:
                assert '--project blakeout-darts-dev' in result['proposedCommand']
                assert '--only firestore:rules' in result['proposedCommand']
        count += 1
        print('PASS', name)

def named(d):
    p = d / 'firestore.isolated-candidate.rules'
    p.write_text(p.read_text().replace('return [];', 'return ["synthetic-approved"];'))
    digest = hashlib.sha256(p.read_bytes()).hexdigest()
    m = d / 'isolated-pilot-manifest.json'
    data = json.loads(m.read_text()); data['rulesSha256'] = digest; m.write_text(json.dumps(data))
    return digest

check('empty default validates locked without deployment', deny=False)
check('empty default cannot prepare activation', prepare=True)
check('production refused', project='blakeout')
check('default alias refused', project='default')
check('unrelated project refused', project='another-dev')
check('incorrect expected hash refused', expected='0' * 64)
check('candidate tampering refused', lambda d: (d/'firestore.isolated-candidate.rules').write_text('allow read, write: if true;') and None)
check('root rules config refused', lambda d: (d/'firebase.isolated-dev.json').write_text('{"firestore":{"rules":"../../firestore.rules"}}') and None)
check('extra deploy target refused', lambda d: (d/'firebase.isolated-dev.json').write_text('{"hosting":{},"firestore":{"database":"(default)","rules":"firestore.isolated-candidate.rules"}}') and None)
check('manifest target tampering refused', lambda d: (d/'isolated-pilot-manifest.json').write_text('{}') and None)
check('symlink refused', lambda d: ((d/'firebase.isolated-dev.json').unlink(), (d/'firebase.isolated-dev.json').symlink_to(DIR/'firebase.isolated-dev.json')) and None)
check('synthetic named fixture prepares DEV-only command without execution', named, prepare=True, deny=False)
print(f'PASS {count} offline deployment guard cases')

actual_digest = hashlib.sha256((DIR / 'firestore.isolated-candidate.rules').read_bytes()).hexdigest()
actual = g.validate(DIR, g.PROJECT, actual_digest, True)
assert actual['pilotCount'] == 1 and actual['executed'] is False
print('PASS exact named candidate manifest/hash and DEV-only command preparation')
