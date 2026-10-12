#!/usr/bin/env python3
"""Actual local Firebase Auth emulator contracts; no live accounts or email.

Start firebase-tools' bundled Auth emulator with project demo-blakeout-readiness
on 127.0.0.1:9099, then run this file. No downloads or server startup occur here.
Firestore rules, browser SDK behavior and branded email delivery are not tested.
"""
import json
import os
import urllib.error
import urllib.request
import uuid

host = os.environ.get('FIREBASE_AUTH_EMULATOR_HOST', '127.0.0.1:9099')
project = os.environ.get('AUTH_EMULATOR_PROJECT', 'demo-blakeout-readiness')
if host != '127.0.0.1:9099' or not project.startswith('demo-'):
    raise SystemExit('Only 127.0.0.1:9099 and an isolated demo- project are allowed.')
base = f'http://{host}'
# Local-only transport; no proxy, redirect, credentials or production endpoint.
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

def request(path, body=None):
    req = urllib.request.Request(base + path,
        data=None if body is None else json.dumps(body).encode(),
        headers={'Content-Type': 'application/json'})
    try:
        with opener.open(req, timeout=10) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, json.load(error)

def api(method, body):
    return request(f'/identitytoolkit.googleapis.com/v1/accounts:{method}?key={project}', body)

def success(method, body):
    code, result = api(method, body)
    assert code == 200, (method, code, result.get('error', {}).get('message'))
    return result

def action_code(email, kind):
    code, result = request(f'/emulator/v1/projects/{project}/oobCodes')
    assert code == 200
    return next(item['oobCode'] for item in reversed(result['oobCodes'])
                if item['email'] == email and item['requestType'] == kind)

def main():
    email = f'readiness-{uuid.uuid4().hex}@example.invalid'
    password, replacement = 'Local-test-only-123!', 'Local-test-reset-456!'
    signup = success('signUp', {'email': email, 'password': password, 'returnSecureToken': True})
    token = signup['idToken']
    try:
        account = success('lookup', {'idToken': token})['users'][0]
        assert not account.get('emailVerified', False)
        print('PASS actual Auth emulator signup starts unverified')
        success('sendOobCode', {'requestType': 'VERIFY_EMAIL', 'idToken': token})
        verify = action_code(email, 'VERIFY_EMAIL')
        success('update', {'oobCode': verify})
        signed_in = success('signInWithPassword', {'email': email, 'password': password, 'returnSecureToken': True})
        token = signed_in['idToken']
        account = success('lookup', {'idToken': token})['users'][0]
        assert account['emailVerified'] and account['localId'] == signup['localId']
        print('PASS actual Auth emulator verification action and subsequent verified sign-in')
        code, _ = api('signInWithPassword', {'email': email, 'password': 'incorrect', 'returnSecureToken': True})
        assert code == 400
        print('PASS actual Auth emulator rejects incorrect password')
        success('sendOobCode', {'requestType': 'PASSWORD_RESET', 'email': email})
        reset = action_code(email, 'PASSWORD_RESET')
        assert success('resetPassword', {'oobCode': reset})['email'] == email
        success('resetPassword', {'oobCode': reset, 'newPassword': replacement})
        code, _ = api('signInWithPassword', {'email': email, 'password': password, 'returnSecureToken': True})
        assert code == 400
        renewed = success('signInWithPassword', {'email': email, 'password': replacement, 'returnSecureToken': True})
        token = renewed['idToken']
        assert renewed['localId'] == signup['localId']
        print('PASS actual Auth emulator reset invalidates old password and preserves account identity')
        code, _ = api('resetPassword', {'oobCode': reset, 'newPassword': password})
        assert code == 400
        print('PASS actual Auth emulator prevents reset-code reuse')
    finally:
        success('delete', {'idToken': token})
        print('PASS only this disposable emulator account deleted; no real mail or live writes')

if __name__ == '__main__':
    main()
