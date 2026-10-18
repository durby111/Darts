import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {fileURLToPath} from 'node:url';
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.BLAKEOUT_QA_PLAYWRIGHT);
const root = fileURLToPath(new URL('../../',import.meta.url));
const project = 'demo-blakeout-adapter-task3';
const candidate=true;
const adapterSource=await fs.readFile(root+'/dev/js/platform.js','utf8');
console.log('ADAPTER actual incorporated worktree source; no runtime rewriting');
const authOrigin = 'http://127.0.0.1:19099', storeOrigin = 'http://127.0.0.1:18085';
const backendOriginal = await fs.readFile(root+'/dev/js/backend-context.js','utf8');
const oldProject = /DEV_BACKEND = '([^']+)'/.exec(backendOriginal)[1];
const oldApp = /DEV_APP_ID = '([^']+)'/.exec(backendOriginal)[1];
const backend = backendOriginal.replaceAll(oldProject,project).replaceAll(oldApp,'demo-app');
const emptyRules = (await fs.readFile(root+'/dev/backend-setup/firestore.cloud-resume-candidate.rules','utf8')).replaceAll(oldProject,project).replaceAll(oldApp,'demo-app').replace(/(function devPilotUids\(\)\s*\{[^}]*return )\[[^\]]*\];/, '$1[];');
async function localJSON(origin, endpoint, body, method='POST') {
  assert([authOrigin,storeOrigin].includes(origin));
  const r=await fetch(origin+endpoint,{method,redirect:'error',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  const j=await r.json(); assert(r.ok,JSON.stringify(j)); return j;
}
const pilotUids=[];
let rules=emptyRules;
async function setPilots(uids) {
 assert.equal(emptyRules.split('return [];').length,2);
 rules=emptyRules.replace('return [];','return '+JSON.stringify(uids)+';');
 await localJSON(storeOrigin,`/emulator/v1/projects/${project}:securityRules`,{rules:{files:[{name:'synthetic-pilot.rules',content:rules}]}},'PUT');
}
await localJSON(storeOrigin,`/emulator/v1/projects/${project}:securityRules`,{rules:{files:[{name:'candidate.rules',content:rules}]}},'PUT');
console.log('PASS compile empty pilot candidate; synthetic project/app markers');
const bundle=await fs.readFile(process.env.BLAKEOUT_QA_OUTPUT+'/sdk.js','utf8');
const server=http.createServer((req,res)=>{res.writeHead(403);res.end('Harness routes only');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const blocked=[], safetyBlocked=[], blockedOfflineProbes=[];
let offlineControl=false;
const safetyProbe='https://non-loopback.invalid/synthetic-probe';
let abortNextCommit=false, injectedAborts=0;
let holdNextCommit=false, commitReached, releaseCommit;
let denyNextCommit=false, denyReceipt=false, deniedReceipts=0;
const authWrapper=`export * from '${base}/sdk.js';
import {getAuth as actual,connectAuthEmulator} from '${base}/sdk.js';
const seen=new WeakSet();export function getAuth(app){if(app.options.projectId!=='${project}')throw Error('Non-demo project blocked');const a=actual(app);if(!seen.has(a)){connectAuthEmulator(a,'${authOrigin}',{disableWarnings:true});seen.add(a);}globalThis.testAuth=a;return a;}`;
const storeWrapper=`export * from '${base}/sdk.js';
import {getFirestore as actual,connectFirestoreEmulator,runTransaction as realTransaction} from '${base}/sdk.js';
const seen=new WeakSet();export function getFirestore(app){if(app.options.projectId!=='${project}')throw Error('Non-demo project blocked');const d=actual(app);if(!seen.has(d)){connectFirestoreEmulator(d,'127.0.0.1',18085);seen.add(d);}globalThis.testDB=d;return d;}
export function runTransaction(db,fn,options){return realTransaction(db,async t=>{globalThis.txAttempts=(globalThis.txAttempts||0)+1;const original=t.get.bind(t);t.get=async(...args)=>{const result=await original(...args);if(globalThis.pauseRead){globalThis.pauseRead=false;globalThis.readPaused=true;await new Promise(resolve=>globalThis.resumeRead=resolve);}return result;};return fn(t);},options);}`;
let browser;
try {
 browser=await chromium.launch({executablePath:process.env.BLAKEOUT_QA_CHROME,headless:true,args:['--disable-background-networking','--disable-component-update','--disable-domain-reliability','--disable-sync','--no-first-run']});
 async function device(){
  const context=await browser.newContext({serviceWorkers:'block'});
  await context.grantPermissions(['local-network-access'],{origin:base});
  await context.routeWebSocket('**/*',ws=>{blocked.push('websocket '+ws.url());ws.close();});
  await context.route('**/*',async route=>{
   const url=route.request().url(), parsed=new URL(url);let body;
   if(url===base+'/sdk.js')body=bundle;
   else if(url===base+'/session.html')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Synthetic local adapter test</title>'});
   else if(url===base+'/dev/js/firebase-config.js')body='export const firebaseConfig='+JSON.stringify({apiKey:project,projectId:project,appId:'demo-app',authDomain:project+'.firebaseapp.com'})+';';
   else if(url===base+'/dev/js/backend-context.js')body=backend;
   else if(url===base+'/dev/js/cloud-resume-config.js')body='export const CLOUD_RESUME_ENABLED = true;';
   else if(url===base+'/dev/js/platform.js')body=adapterSource;
   else if(candidate && url===base+'/dev/js/transaction-conflict.js')body=await fs.readFile('dev/js/transaction-conflict.js','utf8');
   else if(url==='https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js')body=`export * from '${base}/sdk.js';`;
   else if(url==='https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js')body=authWrapper;
   else if(url==='https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js')body=storeWrapper;
   else if(parsed.origin===base && /^\/dev\/js\/(?:brackets\/)?[a-z-]+\.js$/.test(parsed.pathname))body=await fs.readFile(path.join(root,parsed.pathname),'utf8');
   else if([authOrigin,storeOrigin].includes(parsed.origin)){
    const isCommit=parsed.origin===storeOrigin && parsed.pathname.endsWith(':commit') && route.request().method()==='POST';
    if(isCommit && holdNextCommit){holdNextCommit=false;commitReached();await new Promise(resolve=>releaseCommit=resolve);}
    const receiptWrite=isCommit && route.request().postData()?.includes('/blakeoutDevCasualReceipts/');
    if(isCommit && (denyNextCommit || (denyReceipt && receiptWrite))){denyNextCommit=false;if(receiptWrite){denyReceipt=false;deniedReceipts++;}return route.fulfill({status:403,contentType:'application/json',headers:{'Access-Control-Allow-Origin':base,'Access-Control-Allow-Credentials':'true'},body:JSON.stringify({error:{code:403,status:'PERMISSION_DENIED',message:'Synthetic denial; must not be relabeled as stale revision'}})});}
    if(abortNextCommit && parsed.origin===storeOrigin && parsed.pathname.endsWith(':commit') && route.request().method()==='POST'){abortNextCommit=false;injectedAborts++;return route.fulfill({status:409,contentType:'application/json',headers:{'Access-Control-Allow-Origin':base,'Access-Control-Allow-Credentials':'true'},body:JSON.stringify({error:{code:409,message:'Synthetic transient conflict',status:'ABORTED'}})});}
    return route.continue();
   }
   else if(parsed.origin===base && !parsed.pathname.includes('..')) {
    const file=path.join(root,parsed.pathname.endsWith('/') ? parsed.pathname+'index.html':parsed.pathname);
    const mime=file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':file.endsWith('.svg')?'image/svg+xml':file.endsWith('.png')?'image/png':'application/octet-stream';
    try{return route.fulfill({contentType:mime,body:await fs.readFile(file)});}catch{return route.fulfill({status:404,body:''});}
   }
   else{
    const bucket=url===safetyProbe?safetyBlocked:(offlineControl && parsed.origin==='https://www.google.com' && parsed.pathname==='/images/cleardot.gif'?blockedOfflineProbes:blocked);
    bucket.push(parsed.origin+parsed.pathname);return route.abort();
   }
   return route.fulfill({contentType:'text/javascript',body,headers:{'Access-Control-Allow-Origin':'*'}});
  });
  const page=await context.newPage();page.setDefaultTimeout(20000);
  page.on('requestfailed',r=>console.log('REQUEST FAILED',new URL(r.url()).origin,new URL(r.url()).pathname,r.failure()?.errorText));
  await page.goto(base+'/session.html');
  await page.evaluate(async()=>{globalThis.api=await import('/dev/js/platform.js');globalThis.sdk=await import('/sdk.js');await api.initPlatform();});
  return {context,page};
 }

 const {context:ca,page:a}=await device(),{context:cb,page:b}=await device();
 async function user(page,label){
  const email=`${label}-${Date.now()}@example.invalid`,password='Synthetic-only-123!';
  const uid=await page.evaluate(async({email,password})=>(await api.registerAccount(email,password)).uid,{email,password});
  const codes=await localJSON(authOrigin,`/emulator/v1/projects/${project}/oobCodes`,undefined,'GET');
  const code=codes.oobCodes.find(x=>x.email===email&&x.requestType==='VERIFY_EMAIL').oobCode;
  await localJSON(authOrigin,`/identitytoolkit.googleapis.com/v1/accounts:update?key=${project}`,{oobCode:code});
  await page.evaluate(()=>api.refreshAccount());pilotUids.push(uid);await setPilots(pilotUids);
  await page.evaluate(()=>api.saveProfile('TEST Duplicate Name'));return {uid,email,password};
 }
 const owner=await user(a,'resume-owner');
 const outsider=await user(b,'resume-outsider');
 await a.goto(base+'/dev/');
 await a.waitForSelector('#cloudResumePanel');
 await a.evaluate(async()=>{globalThis.api=await import('/dev/js/platform.js');globalThis.sdk=await import('/sdk.js');await api.initPlatform();});
 await a.locator('.game-card[data-game-value="301"]').click();await a.selectOption('#numPlayers','2');await a.click('#startGameBtn');
 await a.waitForFunction(()=>document.querySelector('#cloudGameStatus')?.textContent.includes('Cloud saved'));
 async function state(p){return p.evaluate(async()=>JSON.parse(JSON.stringify((await import('/dev/js/state.js')).snapshotActiveGame(true))));}
 async function stable(p){await p.waitForFunction(()=>document.querySelector('#cloudGameStatus')?.textContent.includes('Cloud saved'));}
 for(const digit of '60')await a.click(`[data-digit="${digit}"]`);await a.click('#x01EnterBtn');await a.waitForTimeout(800);await stable(a);
 // Preserve an unfinished keypad expression, exact rules, player turn and undo.
 holdNextCommit=true;const queuedReached=new Promise(resolve=>commitReached=resolve);
 await a.click('[data-digit="4"]');await queuedReached;
 await a.click('[data-digit="5"]');
 assert(!(await a.locator('#cloudGameStatus').innerText()).includes('Cloud saved'));
 releaseCommit();await stable(a);
 console.log('PASS held first save plus newer partial input: saved status waits for latest snapshot');
 const original=await state(a),id=original.cloudResume.id;
 assert.equal(original.players[0].score,241);assert.equal(original.currentPlayer,1);assert.equal(original.currentInput,'45');assert(original.undoHistory.length);
 await a.evaluate(()=>api.signOutAccount());
 assert(await a.locator('#gameScreen').isHidden());
 assert.equal(await a.evaluate(async()=> (await import('/dev/js/state.js')).loadActiveGame()),null);
 assert.equal(await b.evaluate(async ({uid,id})=>{try{await sdk.getDocFromServer(sdk.doc(testDB,'blakeoutDevActiveGames',uid,'games',id));return null;}catch(e){return e.code;}},{uid:owner.uid,id}),'permission-denied');
 assert.deepEqual(await b.evaluate(()=>api.listCloudGames()),[]);
 // Independent browser storage: sign out outsider; sign in owner. Never copy storage.
 await b.evaluate(()=>api.signOutAccount());await b.evaluate(x=>api.signInAccount(x.email,x.password),owner);
 await b.goto(base+'/dev/');await b.waitForSelector('#cloudResumePanel');
 await b.evaluate(async()=>{globalThis.api=await import('/dev/js/platform.js');globalThis.sdk=await import('/sdk.js');await api.initPlatform();});
 await b.click('#cloudResumeRefresh');await b.click(`[data-cloud-game="${id}"]`);
 await b.waitForFunction(()=>document.querySelector('#gameScreen').style.display==='flex');
 const resumed=await state(b); delete original.timestamp;delete resumed.timestamp;assert.deepEqual(resumed,original);
 await b.click('#undoBtnX01');await b.waitForTimeout(800);await stable(b);
 assert.equal((await state(b)).currentInput,'');
 await b.click('#undoBtnX01');await b.waitForTimeout(800);await stable(b);
 assert.equal((await state(b)).players[0].score,301);
 console.log('PASS independent contexts: signed-in game, real keypad turn/partial input, logout, same UID sign-in and exact players/scores/turn/rules/undo restoration');
 // UI offline retries must preserve newer input queued behind a failed save.
 offlineControl=true;await cb.setOffline(true);await b.click('[data-digit="7"]');
 await b.waitForFunction(()=>document.querySelector('#cloudGameStatus').textContent.includes('Not synced'));
 await b.click('[data-digit="8"]');
 await b.waitForFunction(()=>document.querySelector('#cloudGameStatus').textContent.includes('Not synced'));
 await cb.setOffline(false);await b.click('#cloudGameRetry');await stable(b);offlineControl=false;
 assert.equal((await b.evaluate(id=>api.loadCloudGame(id),id)).snapshot.currentInput,'78');
 console.log('PASS rendered offline retry preserves newer partial input and only reports saved after latest acknowledgment');
 // Real CAS and idempotency through the adapter against emulator rules.
 const saved=await b.evaluate(id=>api.loadCloudGame(id),id);
 const first=await b.evaluate(({id,saved})=>api.saveCloudGame(id,saved.revision,'test-operation',saved.snapshot),{id,saved});
 assert.equal(await b.evaluate(({id,saved})=>api.saveCloudGame(id,saved.revision,'test-operation',saved.snapshot),{id,saved}),first);
 assert.equal(await b.evaluate(async({id,saved})=>{try{await api.saveCloudGame(id,saved.revision,'stale-operation',saved.snapshot);return null;}catch(e){return e.code;}},{id,saved}),'platform/active-game-conflict');
 console.log('PASS stale revision rejected; identical retry does not create a second revision');
 // A second authenticated session cannot read or write another UID path directly.
 const {context:cc,page:c}=await device();await c.evaluate(x=>api.signInAccount(x.email,x.password),outsider);
 assert.equal(await c.evaluate(async({uid,id})=>{try{await sdk.getDocFromServer(sdk.doc(testDB,'blakeoutDevActiveGames',uid,'games',id));return null;}catch(e){return e.code;}},{uid:owner.uid,id}),'permission-denied');
 assert.equal(await c.evaluate(async({uid,id,snapshot})=>{try{await api.saveCloudGame(id,-1,'alien-operation',snapshot);return false;}catch{return true;}},{uid:owner.uid,id,snapshot:saved.snapshot}),true);
 console.log('PASS distinct UID with identical display name cannot read or adopt owner snapshot');
 await c.evaluate(()=>api.signOutAccount());await c.goto(base+'/dev/');await c.waitForSelector('#cloudResumePanel');
 await c.locator('.game-card[data-game-value="301"]').click();await c.selectOption('#numPlayers','1');await c.click('#startGameBtn');
 assert.equal((await state(c)).cloudResume,null);
 console.log('PASS guest start remains device-local and has no cloud owner');
 // Competing independent authenticated contexts: one revision can win.
 await a.evaluate(x=>api.signInAccount(x.email,x.password),owner);
 const beforeRace=await b.evaluate(id=>api.loadCloudGame(id),id);
 const race=await Promise.all([a,b].map((p,i)=>p.evaluate(async({id,beforeRace,i})=>{try{return {ok:true,revision:await api.saveCloudGame(id,beforeRace.revision,'race-'+i,beforeRace.snapshot)};}catch(e){return {ok:false,code:e.code};}},{id,beforeRace,i})));
 assert.equal(race.filter(x=>x.ok).length,1);assert.equal(race.filter(x=>!x.ok).length,1);
 const afterRace=await b.evaluate(id=>api.loadCloudGame(id),id);assert.equal(afterRace.revision,beforeRace.revision+1);
 console.log('PASS real SDK concurrent same-UID devices: one winner, no silent overwrite');
 offlineControl=true;await ca.setOffline(true);
 const offline=await a.evaluate(async({id,record})=>{try{await api.saveCloudGame(id,record.revision,'offline-operation',record.snapshot);return false;}catch{return true;}},{id,record:afterRace});assert(offline);
 assert.equal((await b.evaluate(id=>api.loadCloudGame(id),id)).revision,afterRace.revision);
 await ca.setOffline(false);offlineControl=false;
 assert.equal((await a.evaluate(id=>api.loadCloudGame(id),id)).revision,afterRace.revision);
 console.log('PASS offline transaction fails without queued overwrite after reconnect');
 const linked=structuredClone(afterRace.snapshot);linked.cloudResume={ownerId:owner.uid,id:'linked-snapshot'};
 linked.tournament={backendKey:project+':demo-app',tournamentId:'test-night',matchId:'W1.1',revision:3,ownerId:owner.uid,gameType:'301',bestOf:3,resultId:'test-result',status:'scoring',legWins:[1,0]};
 await a.evaluate(s=>api.saveCloudGame('linked-snapshot',-1,'link-operation',s),linked);
 assert.deepEqual((await b.evaluate(()=>api.loadCloudGame('linked-snapshot'))).snapshot,linked);
 const rejected=await a.evaluate(async s=>{try{await api.saveCloudGame('local-only',-1,'local-operation',{...s,cloudResume:{ownerId:api.getAccount().uid,id:'local-only'},tournament:{...s.tournament,localOnly:true}});return false;}catch{return true;}},linked);assert(rejected);
 console.log('PASS snapshot contract preserves bracket linkage/leg state; device-only tournaments rejected (fixture contract, not live bracket permission)');
 const raw=await b.evaluate(async({id,uid})=>{const reference=sdk.doc(testDB,'blakeoutDevActiveGames',uid,'games',id);const old=(await sdk.getDocFromServer(reference)).data();try{await sdk.setDoc(reference,{...old,revision:old.revision+2});return null;}catch(e){return e.code;}},{id,uid:owner.uid});assert.equal(raw,'permission-denied');
 console.log('PASS rules reject direct malformed revision bypass');
 // Lifecycle operations never change completed result/history collections.
 const life=structuredClone((await a.evaluate(id=>api.loadCloudGame(id),id)).snapshot);
 life.cloudResume={id:'life-main',ownerId:owner.uid};
 await a.evaluate(s=>api.saveCloudGame('life-main',-1,'life-create',s),life);
 assert.equal(await a.evaluate(()=>api.changeCloudGame('life-main',0,'life-archive','archive')),1);
 assert.equal(await a.evaluate(()=>api.changeCloudGame('life-main',0,'life-archive','archive')),1);
 assert.equal((await b.evaluate(()=>api.loadCloudGame('life-main'))).status,'archived');
 assert(await b.evaluate(async s=>{try{await api.saveCloudGame('life-main',1,'archived-save',s);return false;}catch{return true;}},life));
 const badRestore=await a.evaluate(async()=>{const r=sdk.doc(testDB,'blakeoutDevActiveGames',api.getAccount().uid,'games','life-main');const old=(await sdk.getDocFromServer(r)).data();try{await sdk.setDoc(r,{...old,revision:2,status:'active',payload:'tampered',archivedAt:null,updatedAt:sdk.serverTimestamp()});return null;}catch(e){return e.code;}});assert.equal(badRestore,'permission-denied');
 assert.equal(await b.evaluate(()=>api.changeCloudGame('life-main',1,'life-restore','restore')),2);
 assert.deepEqual((await b.evaluate(()=>api.loadCloudGame('life-main'))).snapshot,life);
 console.log('PASS archive/restore exact payload, idempotent archive, archived saves and tampered restore denied');
 // Rendered archive and restore, using the existing user-driven setup navigation.
 await b.evaluate(async()=>{(await import('/dev/js/setup.js')).showSetup();});
 await b.click('#cloudResumeRefresh');await b.click('[data-cloud-game="life-main"]');
 await b.waitForFunction(()=>document.querySelector('#gameScreen').style.display==='flex');
 await b.click('#cloudGameArchive');
 await b.waitForFunction(()=>document.querySelector('#cloudResumeStatus').textContent.includes('Archived.'));
 assert.equal(await b.evaluate(async()=> (await import('/dev/js/state.js')).loadActiveGame()),null);
 await b.click('[data-cloud-game="life-main"]');
 await b.waitForFunction(()=>document.querySelector('#gameScreen').style.display==='flex');
 assert.equal((await b.evaluate(()=>api.loadCloudGame('life-main'))).status,'active');
 console.log('PASS rendered archive hides local Resume; explicit restore reopens same game without result writes');
 // Unsynced same-owner recovery is CAS-protected rather than silently overwriting.
 offlineControl=true;await cb.setOffline(true);await b.click('[data-digit="9"]');
 await b.waitForFunction(()=>document.querySelector('#cloudGameStatus').textContent.includes('Not synced'));
 const unsynced=(await state(b)).currentInput;
 await b.evaluate(()=>api.signOutAccount());await cb.setOffline(false);offlineControl=false;
 await b.evaluate(x=>api.signInAccount(x.email,x.password),owner);await b.click('#cloudRecoverLocal');await stable(b);
 assert.equal((await b.evaluate(()=>api.loadCloudGame('life-main'))).snapshot.currentInput,unsynced);
 console.log('PASS signed-out offline edits recover for sameUID only when server revision still matches');
 const recovered=await a.evaluate(()=>api.loadCloudGame('life-main'));
 await a.evaluate(r=>api.saveCloudGame('life-main',r.revision,'newer-device-operation',r.snapshot),recovered);
 await b.evaluate(async()=>{(await import('/dev/js/setup.js')).showSetup();});await b.click('#cloudRecoverLocal');
 await b.waitForFunction(()=>document.querySelector('#cloudResumeStatus').textContent.includes('Cloud state changed'));
 assert.equal((await b.evaluate(()=>api.loadCloudGame('life-main'))).revision,recovered.revision+1);
 console.log('PASS stale device recovery is refused without overwriting newer server revision');

 //55 deterministic IDs prove pagination beyond the old50-document cap.
 await a.evaluate(async({life})=>{for(let i=0;i<55;i++){const id='page-'+String(i).padStart(3,'0');await api.saveCloudGame(id,-1,'create-'+id,{...life,cloudResume:{id,ownerId:api.getAccount().uid}});}}, {life});
 const pages=await a.evaluate(async()=>{let cursor=null,ids=[],pages=0;do{const p=await api.listCloudGamesPage({afterId:cursor,pageSize:20});ids.push(...p.items.map(x=>x.id));cursor=p.nextCursor;pages++;if(pages>10)throw Error('Cursor loop');}while(cursor);return {ids,pages};});
 assert.equal(pages.ids.filter(x=>x.startsWith('page-')).length,55);assert.equal(new Set(pages.ids).size,pages.ids.length);assert(pages.pages>=3);
 console.log('PASS bounded stable-ID pagination includes all55new games with no duplicates');
 for(const name of ['young','old','future']){
  await a.evaluate(({life,name})=>api.saveCloudGame('retain-'+name,-1,'retain-create-'+name,{...life,cloudResume:{id:'retain-'+name,ownerId:api.getAccount().uid}}),{life,name});
  await a.evaluate(name=>api.changeCloudGame('retain-'+name,0,'retain-archive-'+name,'archive'),name);
 }
 const backdate=await a.evaluate(async()=>{const r=sdk.doc(testDB,'blakeoutDevActiveGames',api.getAccount().uid,'games','retain-young');const old=(await sdk.getDocFromServer(r)).data();try{await sdk.setDoc(r,{...old,revision:2,archivedAt:sdk.Timestamp.fromMillis(0),updatedAt:sdk.serverTimestamp()});return null;}catch(e){return e.code;}});assert.equal(backdate,'permission-denied');
 // Only local emulator admin fixtures set historical server timestamps; the client above cannot.
 for(const [name,days] of [['young',29],['old',31],['future',-1]]){
  const response=await fetch(storeOrigin+`/v1/projects/${project}/databases/(default)/documents/blakeoutDevActiveGames/${owner.uid}/games/retain-${name}?updateMask.fieldPaths=archivedAt`,{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:'Bearer owner'},body:JSON.stringify({fields:{archivedAt:{timestampValue:new Date(Date.now()-days*86400000).toISOString()}}})});assert(response.ok,await response.text());
 }
 for(const name of ['young','future'])assert.equal(await a.evaluate(async name=>{try{await api.changeCloudGame('retain-'+name,1,'discard-'+name,'discard');return null;}catch(e){return e.code;}},name),'permission-denied');
 assert.equal(await a.evaluate(()=>api.changeCloudGame('retain-old',1,'discard-old','discard')),2);
 assert.equal(await a.evaluate(()=>api.changeCloudGame('retain-old',1,'discard-old','discard')),2);
 assert.equal(await a.evaluate(()=>api.loadCloudGame('retain-old')),null);
 const tombstone=await a.evaluate(async()=>{const r=sdk.doc(testDB,'blakeoutDevActiveGames',api.getAccount().uid,'games','retain-old');const old=(await sdk.getDocFromServer(r)).data();let resurrect,deleted;try{await sdk.setDoc(r,{...old,revision:3,status:'active',archivedAt:null,updatedAt:sdk.serverTimestamp()});}catch(e){resurrect=e.code;}try{await sdk.deleteDoc(r);}catch(e){deleted=e.code;}return {payload:old.payload,status:old.status,resurrect,deleted};});
 assert.deepEqual(tombstone,{payload:'',status:'discarded',resurrect:'permission-denied',deleted:'permission-denied'});
 console.log('PASS server-enforced30day minimum:29day/future discard denied,31day discard clears payload, retry safe, tombstone cannot resurrect/delete');
 await fs.writeFile(process.env.BLAKEOUT_QA_OUTPUT+'/lifecycle-summary.json',JSON.stringify({archiveRestore:true,uiArchiveRestore:true,offlineDeviceRecovery:true,pagination:{newGames:55,pages:pages.pages},retentionDays:30,fixtures:'Local emulator admin timestamps29days/31days/future; client backdating denied',tombstone:true,liveWrites:false},null,2));
 await fs.writeFile(process.env.BLAKEOUT_QA_OUTPUT+'/resume-ui.png',await b.screenshot({fullPage:true}));
 await ca.close();await cb.close();await cc.close();
 assert.deepEqual(blocked,[]);
 console.log('PASS no unexpected external request; synthetic users/rules only; live project unreachable');
} finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
