#!/usr/bin/env python3
"""Actual DEV platform + Firebase 10.13.2 Auth SDK against loopback Auth emulator.

Requires the Auth emulator described by auth_emulator_test.py, plus a local
browser ESM bundle exporting firebase/app and firebase/auth at the exact shipped
SDK version. Set BLAKEOUT_FIREBASE_SDK_BUNDLE to that file. Firestore is stubbed;
all external traffic is blocked. No live backend settings or mail are used.
"""
import asyncio
import functools
import http.server
import json
import os
from pathlib import Path
import shutil
import threading
import uuid
from urllib.parse import urlparse
from auth_emulator_test import action_code, success, project
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
BUNDLE = Path(os.environ['BLAKEOUT_FIREBASE_SDK_BUNDLE']).read_text()

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

async def run():
    email = f'sdk-{uuid.uuid4().hex}@example.invalid'
    password, replacement = 'Local-test-only-123!', 'Local-test-reset-456!'
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}'
    token = None
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(executable_path=shutil.which('google-chrome') or shutil.which('chromium'), headless=True)
            unexpected = []
            async def route(r):
                url = r.request.url
                name = url.rsplit('/', 1)[-1]
                source = None
                if url == base + '/sdk.js':
                    source = BUNDLE
                elif url.startswith('https://www.gstatic.com/firebasejs/10.13.2/'):
                    source = {
                        'firebase-app.js': "export * from '/sdk.js';",
                        'firebase-auth.js': """export * from '/sdk.js';
import {getAuth as actualGetAuth,connectAuthEmulator} from '/sdk.js';
const connected=new WeakSet();
export function getAuth(app){const auth=actualGetAuth(app);
 if(!connected.has(auth)){connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});connected.add(auth);}
 return auth;}
""",
                        'firebase-firestore.js': 'export const getFirestore=()=>({});'
                    }.get(name)
                elif url == base + '/dev/js/firebase-config.js':
                    source = 'export const firebaseConfig=' + json.dumps({'apiKey':project,'projectId':project,'authDomain':'localhost'}) + ';'
                elif url == base + '/dev/js/account-email-config.js':
                    source = "export const ACCOUNT_EMAIL_SERVICE_URL='';"
                if source is not None:
                    if url.startswith('https://www.gstatic.com/firebasejs/10.13.2/'):
                        source = source.replace("'/sdk.js'", json.dumps(base + '/sdk.js'))
                    await r.fulfill(content_type='text/javascript', body=source)
                elif url.startswith(base + '/sdk-session.html'):
                    await r.fulfill(content_type='text/html', body='<!doctype html><title>Local Auth SDK contract</title>')
                elif url.startswith(base + '/') or (urlparse(url).scheme == 'http' and urlparse(url).netloc == '127.0.0.1:9099'):
                    await r.continue_()
                else:
                    unexpected.append(urlparse(url).netloc + urlparse(url).path)
                    await r.abort()
            async def new_device():
                context = await browser.new_context(service_workers='block')
                await context.grant_permissions(['local-network-access'], origin=base)
                await context.route('**/*', route)
                page = await context.new_page()
                page.on('requestfailed', lambda req: print('NETWORK', urlparse(req.url).netloc + urlparse(req.url).path, req.failure))
                await page.goto(base + '/sdk-session.html')
                await initialize(page)
                return context, page
            async def initialize(page):
                await page.evaluate("async()=>{globalThis.api=await import('/dev/js/platform.js');await api.initPlatform();}")
            first, a = await new_device()
            assert await a.evaluate("async()=>(await import('/sdk.js')).SDK_VERSION") == '10.13.2'
            assert await a.evaluate('api.getAccount()') is None
            uid = await a.evaluate("async args=>(await api.registerAccount(...args)).uid", [email,password])
            token = await a.evaluate('api.getAccount().getIdToken()')
            assert await a.evaluate('api.getAccount().emailVerified') is False
            print('PASS actual platform + Auth SDK signup and unverified session')
            success('update', {'oobCode':action_code(email,'VERIFY_EMAIL')})
            assert await a.evaluate('async()=>{await api.refreshAccount();return api.requireVerifiedAccount().emailVerified;}')
            await a.reload()
            await initialize(a)
            assert await a.evaluate('api.requireVerifiedAccount().uid') == uid
            print('PASS actual platform + Auth SDK verification refresh and persisted session after reload')
            second, b = await new_device()
            assert await b.evaluate('api.getAccount()') is None
            assert await b.evaluate('async args=>(await api.signInAccount(...args)).uid',[email,password]) == uid
            await a.evaluate('api.signOutAccount()')
            assert await a.evaluate('api.getAccount()') is None
            assert await b.evaluate('api.requireVerifiedAccount().uid') == uid
            print('PASS two independent browser contexts: real SDK sign-in and device-local signout')
            await b.evaluate('email=>api.resetAccountPassword(email)',email)
            success('resetPassword', {'oobCode':action_code(email,'PASSWORD_RESET'),'newPassword':replacement})
            await b.evaluate('api.signOutAccount()')
            error = await b.evaluate('async args=>{try{await api.signInAccount(...args);return null;}catch(e){return e.code;}}',[email,password])
            assert error
            assert await b.evaluate('async args=>(await api.signInAccount(...args)).uid',[email,replacement]) == uid
            token = await b.evaluate('api.getAccount().getIdToken()')
            print('PASS actual platform + Auth SDK reset request, old-password rejection and new-password sign-in')
            # Complete the optional link on another browser context with the
            # real SDK; the emulator generates codes without delivering mail.
            await b.evaluate('email=>api.sendAccountLink(email)', email)
            code = action_code(email, 'EMAIL_SIGNIN')
            await a.goto(base + '/sdk-session.html?mode=signIn&oobCode=' + code + '&apiKey=' + project)
            await initialize(a)
            assert await a.evaluate('email=>api.completeAccountLink(email).then(user=>user.uid)', email) == uid
            assert await a.evaluate('api.requireVerifiedAccount().uid') == uid
            assert await a.evaluate('location.search') == ''
            token = await a.evaluate('api.getAccount().getIdToken()')
            print('PASS actual platform + Auth SDK email-link completion on another browser context')
            assert not unexpected, unexpected
            await first.close()
            await second.close()
            await browser.close()
    finally:
        if token:
            success('delete', {'idToken':token})
        server.shutdown()
        server.server_close()
    print('PASS emulator account cleaned up; Firestore stubbed, external network blocked, no real email')

if __name__ == '__main__':
    asyncio.run(run())
