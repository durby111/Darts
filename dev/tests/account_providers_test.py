#!/usr/bin/env python3
"""DEV provider UI/adapter contracts in Chromium; OAuth/Firebase SDK are mocked.
All provider network is blocked. This does not prove Google or Apple OAuth setup.
"""
import asyncio
import functools
import http.server
import json
from pathlib import Path
import shutil
import threading
from playwright.async_api import async_playwright
from platform_test import APP, AUTH, STORE, QuietHandler
from feature_test_helpers import enable_future_features

ROOT = Path(__file__).resolve().parents[2]
OAUTH = r"""
globalThis.oauthCalls=[];
export class GoogleAuthProvider { constructor(){this.providerId='google.com';this.scopes=[];} setCustomParameters(value){this.parameters=value;} }
export class OAuthProvider { constructor(id){this.providerId=id;this.scopes=[];} addScope(value){this.scopes.push(value);} }
function credential(auth,id){changeTestUser({uid:'oauth-user',email:'relay@example.invalid',emailVerified:globalThis.oauthVerified!==false,isAnonymous:false,providerData:[{providerId:id}]});return {user:auth.currentUser,providerId:id};}
export async function signInWithPopup(auth,provider){
 oauthCalls.push({mode:'popup',id:provider.providerId,scopes:provider.scopes,parameters:provider.parameters});
 if(globalThis.oauthHook)return globalThis.oauthHook(auth,provider);
 if(globalThis.oauthError)throw Object.assign(Error('PRIVATE PROVIDER TOKEN AND EMAIL'),{code:oauthError,customData:{email:'private@example.invalid',token:'NEVER STORE'}});
 return credential(auth,provider.providerId);
}
export async function signInWithRedirect(auth,provider){oauthCalls.push({mode:'redirect',id:provider.providerId});if(globalThis.oauthError)throw Object.assign(Error('PRIVATE REDIRECT ERROR'),{code:oauthError});}
export async function getRedirectResult(auth){
 oauthCalls.push({mode:'return'});const id=sessionStorage.getItem('mockReturn');sessionStorage.removeItem('mockReturn');
 if(!id)return null;
 const value=credential(auth,id);
 if(sessionStorage.getItem('mockStale'))changeTestUser({uid:'replacement',emailVerified:true,isAnonymous:false});
 return value;
}
export async function linkWithCredential(){throw Error('Forbidden: implicit account linking');}
export async function fetchSignInMethodsForEmail(){throw Error('Forbidden: email enumeration');}
"""

async def run():
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(QuietHandler,directory=str(ROOT)))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    base=f'http://127.0.0.1:{server.server_port}'
    count=0
    def passed(message):
        nonlocal count
        count+=1;print('PASS',message,flush=True)
    try:
      async with async_playwright() as p:
        browser=await p.chromium.launch(executable_path=shutil.which('google-chrome') or shutil.which('chromium'),headless=True)
        async def fixture(google=False,apple=False,redirect=False,project='blakeout-darts-dev'):
            context=await browser.new_context(service_workers='block',viewport={'width':390,'height':844})
            await context.add_init_script("if(localStorage.getItem('platform-test-auth')===null)localStorage.setItem('platform-test-auth','null')")
            async def route(r):
                url=r.request.url;name=url.rsplit('/',1)[-1]
                modules={'firebase-app.js':APP,'firebase-auth.js':AUTH+OAUTH,'firebase-firestore.js':STORE}
                if url.startswith('https://www.gstatic.com/firebasejs/10.13.2/') and name in modules:
                    await r.fulfill(content_type='text/javascript',body=modules[name])
                elif name=='firebase-config.js':
                    await r.fulfill(content_type='text/javascript',body='export const firebaseConfig='+json.dumps({'apiKey':'mock-only','projectId':project,'authDomain':project+'.firebaseapp.com','appId':'1:901185136996:web:89d4f413520e66ff773271'})+';')
                elif name=='account-provider-config.js' and google is not None:
                    await r.fulfill(content_type='text/javascript',body="export const ACCOUNT_PROVIDER_PROJECT='blakeout-darts-dev';export const ACCOUNT_PROVIDERS="+json.dumps({'google':{'enabled':google,'redirectEnabled':redirect},'apple':{'enabled':apple,'redirectEnabled':redirect}})+';')
                elif url.startswith(base+'/'):await r.continue_()
                else:await r.abort()
            await context.route('**/*',route);await enable_future_features(context)
            page=await context.new_page();page.set_default_timeout(5000)
            await page.goto(base+'/dev/accounts/')
            if project == 'blakeout-darts-dev':
                await page.wait_for_function("document.querySelector('#passwordSignIn')&&!document.querySelector('#passwordSignIn').disabled")
            else:
                await page.wait_for_function("document.querySelector('#accountStatus').textContent.includes('isolated project')")
            return context,page
        context,page=await fixture(google=None)
        assert await page.locator('#googleSignIn').is_enabled()
        assert await page.locator('#appleSignIn').is_disabled()
        await page.locator('#googleSignIn').click()
        await page.wait_for_function("!document.querySelector('#profilePanel').hidden")
        assert await page.evaluate("oauthCalls.length===1 && oauthCalls[0].id==='google.com' && oauthCalls[0].mode==='popup'")
        assert await page.evaluate("oauthCalls[0].scopes.length===0 && oauthCalls[0].parameters.prompt==='select_account'")
        assert await page.locator('#providerRedirect').is_hidden()
        passed('actual candidate switch enables Google popup only; explicit chooser, no extra scopes, Apple and redirect off (mock SDK)')
        await context.close()
        context,page=await fixture()
        assert await page.locator('#googleSignIn').is_disabled() and await page.locator('#appleSignIn').is_disabled()
        error=await page.evaluate("async()=>{try{await(await import('/dev/js/platform.js')).signInAccountProvider('google');}catch(e){return e.code;}}")
        assert error=='auth/provider-not-configured' and await page.evaluate('oauthCalls.length')==0
        for theme in ['blue','arctic']:
            for style in ['modern','classic','dc','dot-better']:
                await page.evaluate("args=>{document.documentElement.dataset.theme=args[0];document.documentElement.dataset.scoreboardMode=args[1];}",[theme,style])
                assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
                for button in ['googleSignIn','appleSignIn']:
                    assert await page.locator('#'+button).evaluate('el=>el.getBoundingClientRect().height>=44')
        passed('unconfigured providers disabled in UI/adapter; eight mobile theme/style combinations fit');await context.close()
        context,page=await fixture(google=True,project='blakeout')
        assert await page.locator('#googleSignIn').is_disabled()
        error=await page.evaluate("async()=>{try{await(await import('/dev/js/platform.js')).signInAccountProvider('google');}catch(e){return e.code;}}")
        assert error == 'auth/provider-failed'
        assert await page.locator('#passwordSignIn').is_disabled()
        assert await page.evaluate('oauthCalls.length')==0
        passed('shared production project cannot start provider auth even with Google flag enabled');await context.close()
        context,page=await fixture(google=True)
        for code in ['auth/popup-closed-by-user','auth/cancelled-popup-request','auth/popup-blocked','auth/account-exists-with-different-credential','auth/credential-already-in-use','auth/operation-not-allowed','auth/unauthorized-domain','auth/network-request-failed','unknown-secret-error']:
            await page.evaluate('code=>globalThis.oauthError=code',code)
            await page.locator('#googleSignIn').click()
            await page.wait_for_function("!document.querySelector('#googleSignIn').disabled")
            message=await page.locator('#accountStatus').inner_text()
            assert 'PRIVATE' not in message and 'private@example' not in message
            assert await page.locator('#providerRedirect').is_hidden()
            assert await page.locator('#appleSignIn').is_disabled()
            assert not await page.evaluate("Object.values(sessionStorage).some(v=>v.includes('NEVER STORE'))")
        assert await page.evaluate('oauthCalls.length')==9
        passed('cancel/block/collision/config/network failures sanitized, no implicit redirect/linking/credential storage')
        await page.evaluate("() => {globalThis.oauthError=null;globalThis.oauthHook=async(auth,provider)=>new Promise(resolve=>{globalThis.finishPopup=()=>{changeTestUser({uid:'google-user',emailVerified:true,isAnonymous:false,providerData:[{providerId:provider.providerId}]});resolve({user:auth.currentUser,providerId:provider.providerId});};});}")
        await page.locator('#googleSignIn').click()
        await page.wait_for_function("typeof finishPopup==='function'")
        assert await page.locator('#passwordSignIn').is_disabled()
        code=await page.evaluate("async()=>{try{await(await import('/dev/js/platform.js')).signInAccountProvider('google');}catch(e){return e.code;}}")
        assert code=='auth/provider-busy' and await page.evaluate('oauthCalls.length')==10
        await page.evaluate('finishPopup()');await page.wait_for_function("!document.querySelector('#profilePanel').hidden")
        assert await page.evaluate('oauthCalls.at(-1).parameters.prompt')=='select_account'
        passed('one popup, repeated-call exclusion, Google account chooser and verified UID session')
        error=await page.evaluate("async()=>{try{await(await import('/dev/js/platform.js')).signInAccountProvider('google');}catch(e){return e.code;}}")
        assert error=='auth/provider-account-present'
        passed('signed-in account cannot be implicitly replaced/linked through provider API');await context.close()
        context,page=await fixture(apple=True)
        await page.evaluate('globalThis.oauthVerified=false')
        await page.locator('#appleSignIn').click();await page.wait_for_function("!document.querySelector('#verificationPanel').hidden")
        assert await page.locator('#recordsPanel').is_hidden()
        assert await page.evaluate('oauthCalls[0].scopes')==['email','name']
        passed('configured Apple requests only name/email; unverified provider cannot access private records');await context.close()
        context,page=await fixture(google=True,redirect=True)
        await page.evaluate("() => {const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='blakeout_darts_dev_provider_return')throw Error('Storage unavailable');return original.call(this,key,value);};}")
        error=await page.evaluate("async()=>{try{await(await import('/dev/js/platform.js')).signInAccountProvider('google','redirect');}catch(e){return e.code;}}")
        assert error=='auth/redirect-storage-unavailable' and await page.evaluate('oauthCalls.length')==0
        passed('redirect storage failure prevents navigation without requesting credentials');await context.close()
        context,page=await fixture(google=True,redirect=True)
        await page.evaluate("globalThis.oauthError='auth/popup-blocked'")
        await page.locator('#googleSignIn').click();await page.wait_for_function("!document.querySelector('#providerRedirect').hidden")
        assert await page.evaluate('oauthCalls.length')==1
        await page.evaluate('globalThis.oauthError=null');await page.locator('#providerRedirect').click()
        await page.wait_for_function("oauthCalls.some(c=>c.mode==='redirect')")
        marker=await page.evaluate("JSON.parse(sessionStorage.blakeout_darts_dev_provider_return)")
        assert set(marker)=={'provider','project','startedAt'}
        assert marker['provider']=='google' and marker['project']=='blakeout-darts-dev'
        await page.evaluate("sessionStorage.setItem('mockReturn','google.com')")
        await page.reload();await page.wait_for_function("!document.querySelector('#profilePanel').hidden")
        assert await page.evaluate("sessionStorage.getItem('blakeout_darts_dev_provider_return')") is None
        assert await page.evaluate("oauthCalls.filter(c=>c.mode==='return').length")==1
        await page.evaluate("(async()=>await(await import('/dev/js/platform.js')).completeAccountProviderRedirect())()")
        assert await page.evaluate("oauthCalls.filter(c=>c.mode==='return').length")==1
        passed('explicit configured redirect fallback, minimal tab-scoped marker, return consumed exactly once');await context.close()
        for issue in ['expired','wrong-project','missing-result','stale-session','malformed']:
            context,page=await fixture(google=True,redirect=True)
            await page.evaluate("issue=>{sessionStorage.setItem('blakeout_darts_dev_provider_return',issue==='malformed'?'bad':JSON.stringify({provider:'google',project:issue==='wrong-project'?'blakeout':'blakeout-darts-dev',startedAt:issue==='expired'?0:Date.now()}));if(issue==='stale-session'){sessionStorage.setItem('mockReturn','google.com');sessionStorage.setItem('mockStale','1');}}",issue)
            await page.reload();await page.wait_for_function("document.querySelector('#passwordSignIn')&&!document.querySelector('#passwordSignIn').disabled")
            assert await page.evaluate("sessionStorage.getItem('blakeout_darts_dev_provider_return')") is None
            if issue=='stale-session':assert await page.evaluate("(async()=>(await import('/dev/js/platform.js')).getAccount().uid)()")=='replacement'
            else:assert 'return' in (await page.locator('#accountStatus').inner_text()).lower()
            passed('redirect rejects '+issue+' without retry or linking');await context.close()
        await browser.close()
    finally:server.shutdown();server.server_close()
    print(f'{count}/{count} provider contract groups passed. OAuth mocked; no real Google/Apple sign-in or backend writes.')

if __name__=='__main__':asyncio.run(run())
