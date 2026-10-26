import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mountHomeAccount} from '../js/home-account.js';
const require=createRequire(import.meta.url);
const {JSDOM}=require(process.env.BLAKEOUT_JSDOM_MODULE || 'jsdom');
for(const initial of [null,{isAnonymous:true},{uid:'synthetic',emailVerified:false},{uid:'synthetic',emailVerified:true}]) {
 const dom=new JSDOM('<header class="setup-header"><a id="homeAccountLink" href="accounts/">Login</a></header><input id="recordCasualStats" type="checkbox">',{url:'https://example.invalid/dev/'});
 const d=dom.window.document;let listener,removed=0;
 const dispose=await mountHomeAccount(d,async()=>({initPlatform:async()=>{},subscribeAccount:fn=>{listener=fn;fn(initial);return()=>removed++;}}));
 const button=d.querySelector('button'),link=d.querySelector('a'),toggle=d.querySelector('input');
 assert.equal(button.disabled,!initial?.emailVerified);assert.equal(link.textContent,initial&&!initial.isAnonymous?'My account':'Login');
 button.click();assert.equal(toggle.checked,!!initial?.emailVerified);
 assert.equal(d.querySelectorAll('input[type=password]').length,0);
 listener(null);toggle.checked=false;button.click();assert.equal(toggle.checked,false);assert.equal(link.textContent,'Login');
 listener({emailVerified:true});toggle.disabled=true;button.click();assert.match(d.querySelector('[role=status]').textContent,/unavailable/);assert.equal(toggle.checked,false);
 dispose();assert.equal(removed,1);assert.equal(d.querySelector('details'),null);dom.window.close();
}
const dom=new JSDOM('<header class="setup-header"><a id="homeAccountLink">Login</a></header>');
await mountHomeAccount(dom.window.document,async()=>{throw Error('SECRET MUST NOT BE DISPLAYED');});
assert.match(dom.window.document.body.textContent,/connection unavailable/);assert.doesNotMatch(dom.window.document.body.textContent,/SECRET/);
console.log('PASS home guest/anonymous/unverified/verified states, sign-out, unavailable setup, no password collection, disposal and offline fallback');
