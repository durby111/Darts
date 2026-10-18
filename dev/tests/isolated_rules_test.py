#!/usr/bin/env python3
"""Static candidate contracts plus optional synthetic LOCAL emulator enforcement.
No SDK downloads, Firebase CLI, credentials, live endpoints or production data.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
RULES = ROOT / 'dev/backend-setup/firestore.isolated-candidate.rules'
MATRIX = ROOT / 'dev/backend-setup/isolated-rules-cases.json'
BASE = '756cf9901c11045019a3ce13c50accf200575fad'


def pilot_list(source):
    match = re.search(r'(function devPilotUids\(\)\s*\{[^}]*return )(\[[^\]]*\]);', source)
    assert match, 'Missing explicit pilot list'
    return json.loads(match.group(2))


def with_pilots(source, uids):
    pattern = r'(function devPilotUids\(\)\s*\{[^}]*return )(\[[^\]]*\]);'
    result, count = re.subn(pattern, lambda m: m.group(1) + json.dumps(uids) + ';', source)
    assert count == 1
    return result


def static_checks():
    source = RULES.read_text()
    matrix = json.loads(MATRIX.read_text())
    for file in ['firestore.rules', 'firebase.json']:
        assert (ROOT / file).read_bytes() == subprocess.check_output(
            ['git', 'show', f'{BASE}:{file}'], cwd=ROOT), file
    provider = subprocess.check_output(['git', 'show', f'{BASE}:dev/js/account-provider-config.js'], cwd=ROOT).decode()
    expected_provider = provider.replace('google: Object.freeze({ enabled: false, redirectEnabled: false })', 'google: Object.freeze({ enabled: true, redirectEnabled: false })')
    assert (ROOT / 'dev/js/account-provider-config.js').read_text() == expected_provider, 'Only approved DEV Google popup switch may change; Apple/redirect stay disabled'
    assert 'accounts: true' in (ROOT / 'dev/js/feature-availability.js').read_text()
    assert 'brackets: false' in (ROOT / 'dev/js/feature-availability.js').read_text()
    assert 'accounts: false' in (ROOT / 'js/feature-availability.js').read_text()
    assert 'firestore.isolated-candidate.rules' not in (ROOT / 'firebase.json').read_text()
    assert matrix['syntheticOnly'] and len(matrix['cases']) == 155
    assert len({c['name'] for c in matrix['cases']}) == len(matrix['cases'])
    assert {c['operation'] for c in matrix['cases']} == {'get', 'list', 'query', 'write', 'commit', 'delete'}
    matches = set(re.findall(r'match /([^/]+)/', source))
    assert matches == {'databases', 'blakeoutDevProfiles', 'blakeoutDevTournaments',
                       'blakeoutDevRosterPrivate', 'blakeoutDevSignupState',
                       'blakeoutDevSignups', 'blakeoutDevResults',
                       'blakeoutDevCasualResults', 'blakeoutDevCasualReceipts'}
    assert 'devGuest' not in source and 'allow read: if true' not in source
    for grant in re.findall(r'allow [^:]+:\s*if ([^;]+);', source):
        assert grant.startswith('devVerified()') or grant.strip() == 'false', grant
    assert "in ['password', 'google.com']" in source
    assert "&& request.auth.uid in devPilotUids()" in source
    assert pilot_list(source) == []
    assert "database == '(default)'" in source
    assert "get('email_verified', false) == true" in source
    assert "match /{document=**}" in source and 'allow read, write: if false;' in source
    assert 'return existsAfter(/databases/$(database)/documents/blakeoutDevSignupState/$(id))' in source
    assert 'devResultExtras(request.resource.data)' in source
    assert any(c['name'].startswith('KNOWN LIMIT:') for c in matrix['cases'])
    print('PASS static source contracts: root rules/config and production gates unchanged; DEV accounts enabled; eight DEV collection families; verified-only grants; closed fallback; 155 unique synthetic cases')
    print('Candidate SHA256:', hashlib.sha256(RULES.read_bytes()).hexdigest())
    return matrix


def wire(value):
    if value is None: return {'nullValue': None}
    if isinstance(value, bool): return {'booleanValue': value}
    if isinstance(value, int): return {'integerValue': str(value)}
    if isinstance(value, str): return {'stringValue': value}
    if isinstance(value, list): return {'arrayValue': {'values': [wire(v) for v in value]}}
    if isinstance(value, dict): return {'mapValue': {'fields': {k: wire(v) for k, v in value.items()}}}
    raise ValueError('Unsupported synthetic value')


def emulator_checks(matrix, pilot_phases=True):
    host = os.environ.get('FIRESTORE_EMULATOR_HOST')
    if not host:
        print('SKIP compilation/enforcement: FIRESTORE_EMULATOR_HOST unset; no emulator provisioned. 155 cases NOT executed.')
        return
    # Literal loopback only; no schemes, external hosts, mirrors or proxy routing.
    if not re.fullmatch(r'(127\.0\.0\.1|localhost):[0-9]{1,5}', host):
        raise ValueError('Only an explicitly provisioned localhost emulator is permitted')
    project = f'demo-blakeout-isolated-rules-{os.getpid()}'
    prefix = f'projects/{project}/databases/(default)/documents'
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def request(method, path, data=None, auth=None, admin=False):
        headers = {'Content-Type': 'application/json'}
        if admin:
            headers['Authorization'] = 'Bearer owner'  # Local emulator fixture seeding only.
        elif auth:
            provider = ('anonymous' if auth.startswith('anonymous') else
                        'google.com' if auth == 'google' else
                        'apple.com' if auth == 'apple' else
                        'custom' if auth == 'custom' else 'password')
            claims = {'sub': auth, 'user_id': auth, 'aud': project,
                      'iss': f'https://securetoken.google.com/{project}',
                      'email_verified': auth not in ['unverified', 'anonymous'],
                      'firebase': {'sign_in_provider': provider}, 'iat': 0, 'exp': 4102444800}
            encode = lambda v: base64.urlsafe_b64encode(json.dumps(v).encode()).decode().rstrip('=')
            headers['Authorization'] = f"Bearer {encode({'alg': 'none', 'typ': 'JWT'})}.{encode(claims)}."
        req = urllib.request.Request('http://' + host + path,
              data=None if data is None else json.dumps(data).encode(), headers=headers, method=method)
        try:
            with opener.open(req, timeout=30) as response: return response.status, response.read().decode()
        except urllib.error.HTTPError as error: return error.code, error.read().decode()

    def writes(items):
        return [{'update': {'name': prefix + '/' + item['path'],
                 'fields': {k: wire(v) for k, v in item['data'].items()}}} for item in items]

    source = RULES.read_text()
    empty = with_pilots(source, [])
    synthetic = sorted({c['auth'] for c in matrix['cases'] if c['auth']})
    listed = with_pilots(source, synthetic)
    # Same tokens/data across phases: revocation is rules membership, not signout.
    phases = [('exact-candidate', source), ('default-empty', empty), ('listed', listed),
              ('verified-unlisted', listed), ('revoked', empty)] if pilot_phases else [('listed', listed)]
    if pilot_phases:
        code, body = request('PUT', f'/emulator/v1/projects/{project}:securityRules',
                            {'rules': {'files': [{'name': RULES.name, 'content': source}]}})
        assert code == 200, (code, body)
        # Exact reviewed rules bytes; unsigned synthetic emulator claims only.
        # No real token, account call, email, or live project is used.
        for uid in pilot_list(source):
            code, body = request('POST', '/v1/' + prefix + ':commit',
                {'writes': writes([{'path': 'blakeoutDevProfiles/' + uid, 'data': {'name': 'Synthetic Pilot Test'}}])}, auth=uid)
            assert code == 200, (code, body)
            code, body = request('GET', '/v1/' + prefix + '/blakeoutDevProfiles/' + uid, auth=uid)
            assert code == 200, (code, body)
            code, body = request('GET', '/v1/' + prefix + '/blakeoutDevProfiles/' + uid, auth='unlisted')
            assert code == 403, (code, body)
        print('PASS exact candidate: named UID profile write/read allowed; unlisted read denied')
    for phase, rules in phases:
        code, body = request('PUT', f'/emulator/v1/projects/{project}:securityRules',
                            {'rules': {'files': [{'name': RULES.name, 'content': rules}]}})
        assert code == 200, f'Candidate compilation failed: {code} {body}'
        print('PASS compile', phase, 'localhost emulator project', project)
        for case in matrix['cases']:
            code, body = request('DELETE', f'/emulator/v1/projects/{project}/databases/(default)/documents', admin=True)
            assert code == 200, (code, body)
            seed = case.get('seed', matrix['seed'])
            code, body = request('POST', '/v1/' + prefix + ':commit',
                {'writes': writes([{'path': k, 'data': v} for k, v in seed.items()])}, admin=True)
            assert code == 200, (code, body)
            op = case['operation']; path = case.get('path', '')
            if op in ['get', 'list', 'delete']:
                code, body = request('DELETE' if op == 'delete' else 'GET', '/v1/' + prefix + '/' + path, auth=('unlisted' if phase == 'verified-unlisted' else case['auth']))
            elif op == 'query':
                field, operator, value = case['where']
                code, body = request('POST', '/v1/' + prefix + ':runQuery', {'structuredQuery': {
                    'from': [{'collectionId': path}], 'where': {'fieldFilter': {
                        'field': {'fieldPath': field}, 'op': operator, 'value': wire(value)}}}}, auth=('unlisted' if phase == 'verified-unlisted' else case['auth']))
            else:
                items = case['writes'] if op == 'commit' else [{'path': path, 'data': case['data']}]
                code, body = request('POST', '/v1/' + prefix + ':commit', {'writes': writes(items)}, auth=('unlisted' if phase == 'verified-unlisted' else case['auth']))
            # Missing-document GET may return 404 only after rules permit access.
            allowed = code == 200 or (op == 'get' and code == 404)
            assert (allowed if phase == 'listed' and case['allow'] else code == 403), (case['name'], case['allow'], code, body)
            print('PASS', phase, case['name'])
        print(f"PASS {phase}: {len(matrix['cases'])} synthetic emulator cases")



if __name__ == '__main__':
    emulator_checks(static_checks())
