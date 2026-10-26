import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createSharedPlayerAuth} from '../js/shared-player-auth.js';
import {requestSharedPlayer} from '../js/shared-player-dialog.js';
import {createPlayerVisit} from '../js/shared-player-list.js';
import {mountHomeAccount} from '../js/home-account.js';
const {JSDOM}=createRequire(import.meta.url)(process.env.BLAKEOUT_JSDOM_MODULE || 'jsdom');
const flush=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
let passed=0;async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
const config={apiKey:'synthetic',projectId:'blakeout-darts-dev',appId:'1:901185136996:web:89d4f413520e66ff773271',authDomain:'blakeout-darts-dev.firebaseapp.com'};
function sdkFixture(overrides={}) {
 const events=[],owner={uid:'owner',persistence:'local'},auth={currentUser:null};
 const user={uid:'player',displayName:'Player',email:'player@example.invalid',emailVerified:true,isAnonymous:false,...overrides.user};
 const apps={initializeApp:(options,name)=>{events.push(['app',name]);return {name};},deleteApp:async app=>events.push(['delete',app.name])};
 const sdk={inMemoryPersistence:'memory',initializeAuth:(app,options)=>{events.push(['auth',options.persistence]);return auth;},
 signInWithEmailAndPassword:async()=>{events.push(['login']);await overrides.wait;auth.currentUser=user;return {user};},reload:async()=>{},
 getIdTokenResult:async()=>({token:'NEVER_EXPOSE_TOKEN',claims:{sub:user.uid,email_verified:true,auth_time:Date.now()/1000,...overrides.claims}}),
 signOut:async()=>{events.push(['signout']);auth.currentUser=null;if(overrides.closeFails)throw Error('synthetic cleanup failure');}};
 const load=async path=>path.endsWith('firebase-config.js')?{firebaseConfig:config}:path.endsWith('firebase-app.js')?apps:sdk;
 return {load,events,owner,auth};
}
await test('separate memory auth verifies fresh identity and returns no credentials',async()=>{
 const f=sdkFixture(),a=await createSharedPlayerAuth(f.load);const p=await a.signIn('player@example.invalid','synthetic');
 assert.deepEqual(Object.keys(p),['id','name','email','expiresAt']);assert.equal(p.id,'player');assert(p.expiresAt>Date.now()&&p.expiresAt<=Date.now()+300000);assert.deepEqual(f.owner,{uid:'owner',persistence:'local'});
 assert(f.events.some(e=>e[0]==='auth'&&e[1]==='memory'));assert.match(f.events[0][1],/^blakeout-dev-player-/);
 await a.close();await a.close();assert.equal(f.auth.currentUser,null);assert.equal(f.events.filter(e=>e[0]==='delete').length,1);
});
await test('anonymous, unverified, stale and mismatched claims are rejected and cleaned',async()=>{
 for(const value of [{user:{isAnonymous:true}},{user:{emailVerified:false}},{claims:{email_verified:false}},{claims:{sub:'other'}},{claims:{auth_time:1}},{claims:{auth_time:'invalid'}}]){
  const f=sdkFixture(value),a=await createSharedPlayerAuth(f.load);await assert.rejects(a.signIn('x','x'));await a.close();assert.equal(f.auth.currentUser,null);assert.equal(f.events.at(-1)[0],'delete');
 }
});
await test('cancel waits for late login before signout; cleanup failure still deletes app',async()=>{
 const wait=deferred(),f=sdkFixture({wait:wait.promise}),a=await createSharedPlayerAuth(f.load);
 const login=a.signIn('x','x');const rejected=assert.rejects(login);const closing=a.close();wait.resolve();await rejected;await closing;
 assert.equal(f.auth.currentUser,null);assert.deepEqual(f.events.slice(-2).map(e=>e[0]),['signout','delete']);
 const bad=sdkFixture({closeFails:true}),b=await createSharedPlayerAuth(bad.load);await b.signIn('x','x');await assert.rejects(b.close());assert.equal(bad.events.at(-1)[0],'delete');
});
function domFixture(){
 const dom=new JSDOM('<button id="before">Add player</button>',{url:'https://example.invalid/dev/'});const w=dom.window;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 dom.window.document.querySelector('button').focus();return dom;
}
function submit(d){d.querySelector('[name=email]').value='player@example.invalid';d.querySelector('[name=password]').value='synthetic';d.querySelector('form button').click();}
function accept(d){d.querySelector('[name=playerName]').value='Shared player';const c=d.querySelector('[name=consent]');c.checked=true;c.dispatchEvent(new d.defaultView.Event('change'));d.querySelector('.shared-player-confirm').click();}
await test('explicit confirmation only; password clears immediately; result omits email and tokens',async()=>{
 const dom=domFixture(),d=dom.window.document;let closes=0;
 const result=requestSharedPlayer(d,{create:async()=>({signIn:async()=>({id:'p1',name:'Name',email:'player@example.invalid',expiresAt:Date.now()+300000}),close:async()=>closes++})});
 submit(d);assert.equal(d.querySelector('[name=password]').value,'');await flush();assert.equal(d.querySelector('section').hidden,false);
 assert.equal(d.querySelector('.shared-player-confirm').disabled,true);assert.equal(closes,1);accept(d);
 assert.deepEqual(await result,{id:'p1',name:'Shared player'});assert.equal(d.querySelector('dialog'),null);assert.equal(d.activeElement.id,'before');dom.window.close();
});
await test('repeated requests and canceled late completions never add a player',async()=>{
 const dom=domFixture(),d=dom.window.document,pending=deferred();let closes=0,logins=0;
 const result=requestSharedPlayer(d,{create:async()=>({signIn:async()=>{logins++;return pending.promise;},close:async()=>closes++})});
 assert.equal(await requestSharedPlayer(d),null);submit(d);await flush();d.querySelector('.shared-player-cancel').click();
 pending.resolve({id:'p1',name:'Name',email:'player@example.invalid',expiresAt:Date.now()+300000});assert.equal(await result,null);assert.equal(logins,1);assert(closes>=1);assert.equal(d.querySelector('dialog'),null);dom.window.close();
});
await test('confirmation cannot extend the authentication freshness deadline',async()=>{
 const dom=domFixture(),d=dom.window.document;
 const result=requestSharedPlayer(d,{create:async()=>({signIn:async()=>({id:'p1',name:'Name',email:'player@example.invalid',expiresAt:Date.now()-1}),close:async()=>{}})});
 submit(d);await flush();accept(d);assert.match(d.querySelector('[role=status]').textContent,/expired/);assert(d.querySelector('dialog'));
 d.querySelector('.shared-player-cancel').click();assert.equal(await result,null);dom.window.close();
});
await test('navigation abort, failed verification and cleanup failure leave no participant',async()=>{
 for(const mode of ['abort','failure','cleanup']){
  const dom=domFixture(),d=dom.window.document;const controller=new dom.window.AbortController();let closes=0;
  const result=requestSharedPlayer(d,{signal:controller.signal,create:async()=>({signIn:async()=>{if(mode==='failure')throw Error('SENSITIVE');return {id:'p1',name:'Name',email:'player@example.invalid',expiresAt:Date.now()+300000};},close:async()=>{closes++;if(mode==='cleanup')throw Error('SENSITIVE');}})});
  submit(d);await flush();if(mode==='abort')controller.abort();else {assert.match(d.querySelector('[role=status]').textContent,/Could not verify/);assert.doesNotMatch(d.body.textContent,/SENSITIVE/);d.querySelector('.shared-player-cancel').click();}
  assert.equal(await result,null);assert(closes>=1);dom.window.close();
 }
});
await test('visit deduplicates UID, preserves duplicate names, strips extra data and clears on owner change',async()=>{
 const v=createPlayerVisit();v.setOwner('owner');assert(v.add({id:'p1',name:'Same',token:'secret',email:'secret'},'owner'));
 v.add({id:'p2',name:'Same'},'owner');v.add({id:'p1',name:'Same'},'owner');assert.equal(v.list().length,2);assert.deepEqual(Object.keys(v.list()[0]),['id','name']);
 assert.equal(v.add({id:'p3',name:'X'},'other'),false);v.list()[0].name='changed';assert.equal(v.list()[0].name,'Same');v.remove('p1');assert.equal(v.list().length,1);v.setOwner(null);assert.equal(v.list().length,0);
});
await test('home account replacement cancels pending player without touching saved game',async()=>{
 const dom=new JSDOM('<header class="setup-header"><a id="homeAccountLink">Login</a></header><select id="gameType"><option>501</option></select>',{url:'https://example.invalid/dev/'}),d=dom.window.document;
 dom.window.localStorage.setItem('synthetic-game','preserved');let listener,owner={uid:'owner',emailVerified:true},attempt;
 const pending=deferred();const dispose=await mountHomeAccount(d,async()=>({initPlatform:async()=>{},getAccount:()=>owner,subscribeAccount:fn=>{listener=fn;fn(owner);return()=>{};}}),async(_,options)=>{attempt=options.signal;return pending.promise;});
 const add=[...d.querySelectorAll('button')].find(b=>b.textContent==='Add player account');add.click();assert.equal(add.disabled,true);
 owner=null;listener(null);assert(attempt.aborted);pending.resolve({id:'p1',name:'Player'});await flush();assert.equal(d.querySelectorAll('li').length,0);assert.equal(dom.window.localStorage.getItem('synthetic-game'),'preserved');
 dispose();dom.window.close();
});
await test('home confirms/removes participants and clears them on game change or revoked verification',async()=>{
 const dom=new JSDOM('<header class="setup-header"><a id="homeAccountLink">Login</a></header><select id="gameType"><option>501</option></select>',{url:'https://example.invalid/dev/'}),d=dom.window.document;
 let listener;const owner={uid:'owner',emailVerified:true};
 const dispose=await mountHomeAccount(d,async()=>({initPlatform:async()=>{},getAccount:()=>owner,subscribeAccount:fn=>{listener=fn;fn(owner);return()=>{};}}),async()=>({id:'p1',name:'Player'}));
 const add=[...d.querySelectorAll('button')].find(b=>b.textContent==='Add player account');
 add.click();await flush();assert.equal(d.querySelectorAll('li').length,1);assert.match(d.querySelector('li').textContent,/verified this visit/);
 d.querySelector('li button').click();assert.equal(d.querySelectorAll('li').length,0);
 add.click();await flush();d.querySelector('#gameType').dispatchEvent(new dom.window.Event('change'));assert.equal(d.querySelectorAll('li').length,0);
 add.click();await flush();owner.emailVerified=false;listener(owner);assert.equal(d.querySelectorAll('li').length,0);assert.equal(add.disabled,true);
 dispose();dom.window.close();
});
await test('simulated cross-tab sign-out, Back restore and restart never restore visit proofs',async()=>{
 const make=()=>new JSDOM('<header class="setup-header"><a id="homeAccountLink">Login</a></header>',{url:'https://example.invalid/dev/'});
 const a=make(),b=make(),listeners=new Set();let owner={uid:'owner',emailVerified:true};
 const api={initPlatform:async()=>{},getAccount:()=>owner,subscribeAccount:fn=>{listeners.add(fn);fn(owner);return()=>listeners.delete(fn);}};
 const request=async()=>({id:'p1',name:'Player'});
 const disposeA=await mountHomeAccount(a.window.document,async()=>api,request);
 const disposeB=await mountHomeAccount(b.window.document,async()=>api,request);
 const add=[...a.window.document.querySelectorAll('button')].find(x=>x.textContent==='Add player account');
 add.click();await flush();assert.equal(a.window.document.querySelectorAll('li').length,1);assert.equal(b.window.document.querySelectorAll('li').length,0);
 a.window.dispatchEvent(new a.window.PageTransitionEvent('pagehide',{persisted:true}));
 assert.equal(a.window.document.querySelectorAll('li').length,0);assert.equal(a.window.document.querySelector('a').textContent,'Login');
 owner=null; // Simulated SDK state changed while A was in Back cache; no observer yet.
 a.window.dispatchEvent(new a.window.PageTransitionEvent('pageshow',{persisted:true}));
 assert.equal(a.window.document.querySelector('a').textContent,'Login');
 listeners.forEach(fn=>fn(owner));assert.equal(b.window.document.querySelector('a').textContent,'Login');
 owner={uid:'owner',emailVerified:true};const restarted=make();
 const disposeRestart=await mountHomeAccount(restarted.window.document,async()=>api,request);
 assert.equal(restarted.window.document.querySelector('a').textContent,'My account');assert.equal(restarted.window.document.querySelectorAll('li').length,0);
 disposeA();disposeB();disposeRestart();for(const dom of [a,b,restarted])dom.window.close();
});
console.log(`${passed} shared-player groups passed using synthetic SDK/DOM; no live account access.`);
