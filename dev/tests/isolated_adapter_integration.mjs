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
const emptyRules = (await fs.readFile(root+'/dev/backend-setup/firestore.isolated-candidate.rules','utf8')).replaceAll(oldProject,project).replaceAll(oldApp,'demo-app').replace(/(function devPilotUids\(\)\s*\{[^}]*return )\[[^\]]*\];/, '$1[];');
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
 assert.equal(await a.evaluate(()=>sdk.SDK_VERSION),'10.13.2');
 assert.equal(await a.evaluate(()=>fetch('/dev/js/platform.js').then(r=>r.text())),adapterSource);
 assert(await a.evaluate(async url=>{try{await fetch(url);return false;}catch{return true;}},safetyProbe));assert.deepEqual(safetyBlocked,[safetyProbe]);
 assert(await a.evaluate(async()=>{const context=await import('/dev/js/backend-context.js');try{context.assertDevConfig({projectId:'non-demo',appId:'demo-app',authDomain:'non-demo.firebaseapp.com'});return false;}catch{return true;}}));
 console.log('PASS served adapter bytes match selected file; wrong project rejected; non-loopback probe blocked');
 const email=`adapter-${Date.now()}@example.invalid`,password='Synthetic-only-123!';
 const uid=await a.evaluate(async({email,password})=>(await api.registerAccount(email,password)).uid,{email,password});
 assert.equal(await a.evaluate(()=>api.getAccount().emailVerified),false);
 assert(await a.evaluate(async()=>{try{await api.saveProfile('Synthetic Owner');return false;}catch{return true;}}));
 assert.equal(await a.evaluate(async()=>{try{await sdk.setDoc(sdk.doc(testDB,'blakeoutDevProfiles',api.getAccount().uid),{name:'Synthetic'});return null;}catch(e){return e.code;}}),'permission-denied');
 console.log('PASS actual Auth SDK signup; adapter and rules both reject unverified write');
 const codes=await localJSON(authOrigin,`/emulator/v1/projects/${project}/oobCodes`,undefined,'GET');
 const code=codes.oobCodes.find(x=>x.email===email&&x.requestType==='VERIFY_EMAIL').oobCode;
 await localJSON(authOrigin,`/identitytoolkit.googleapis.com/v1/accounts:update?key=${project}`,{oobCode:code});
 assert(await a.evaluate(async()=>{await api.refreshAccount();return api.requireVerifiedAccount().emailVerified;}));
 assert.equal(await a.evaluate(async()=>{try{await api.saveProfile('Synthetic Owner');return null;}catch(e){return e.code;}}),'permission-denied');
 console.log('PASS verified real SDK user denied by empty pilot allowlist');
 pilotUids.push(uid);await setPilots(pilotUids);
 await a.evaluate(()=>api.saveProfile('Synthetic Owner'));
 await setPilots([]);
 assert.equal(await a.evaluate(async()=>{try{await sdk.getDocFromServer(sdk.doc(testDB,'blakeoutDevProfiles',api.getAccount().uid));return null;}catch(e){return e.code;}}),'permission-denied');
 assert.equal(await a.evaluate(async()=>{try{await api.saveProfile('Revoked');return null;}catch(e){return e.code;}}),'permission-denied');
 await setPilots(pilotUids);
 console.log('PASS same authenticated SDK session denied server reads/writes after pilot revocation');
 assert.equal((await a.evaluate(()=>api.getProfile())).name,'Synthetic Owner');
 await b.evaluate(args=>api.signInAccount(args.email,args.password),{email,password});
 assert.equal((await b.evaluate(()=>api.getProfile())).id,uid);
 console.log('PASS verified token refresh; real adapter profile transaction/read across two clients');
 const tournament={id:'synthetic-race',title:'Synthetic Race',date:'2026-10-17',gameType:'501',bestOf:1,status:'registration',registrations:[],teams:[],matches:[]};
 await a.evaluate(t=>api.createTournamentDocument(t),tournament);
 await Promise.all([a,b].map(p=>p.evaluate(()=>{globalThis.txAttempts=0;})));
 holdNextCommit=true;
 const reached=new Promise(resolve=>commitReached=resolve);
 const firstRace=a.evaluate(async()=>{try{return {ok:true,value:await api.updateTournament('synthetic-race',0,t=>({...t,title:'Synthetic A'}))};}catch(e){return {ok:false,code:e.code,revisionChanged:e.revisionChanged,currentRevision:e.currentRevision,message:e.message};}});
 await reached;
 const winner=await b.evaluate(async()=>({ok:true,value:await api.updateTournament('synthetic-race',0,t=>({...t,title:'Synthetic B'}))}));
 releaseCommit();
 const loser=await firstRace;
 assert.equal(loser.ok,false);assert.equal(loser.code,'permission-denied');
 if(candidate){assert.equal(loser.revisionChanged,true);assert.equal(loser.currentRevision,1);}else assert.equal(loser.revisionChanged,undefined);
 console.log('PASS deterministic contention: denial preserved; revisionChanged='+!!loser.revisionChanged);
 const attempts=await Promise.all([a,b].map(p=>p.evaluate(()=>txAttempts)));
 assert.equal((await a.evaluate(()=>api.getTournament('synthetic-race'))).revision,1);
 console.log('PASS competing adapter writes: one accepted, revision remains 1; SDK callback attempts '+attempts);
 assert.equal(await b.evaluate(async()=>{try{await api.updateTournament('synthetic-race',0,t=>t);return null;}catch(e){return e.code;}}),'platform/revision-conflict');
 denyNextCommit=true;
 const genuine=await b.evaluate(async()=>{try{await api.updateTournament('synthetic-race',1,t=>({...t,title:'Denied write'}));return {};}catch(e){return {code:e.code,revisionChanged:e.revisionChanged,message:e.message};}});
 assert.equal(genuine.code,'permission-denied');assert.equal(genuine.revisionChanged,undefined);
 assert.equal((await b.evaluate(()=>api.getTournament('synthetic-race'))).revision,1);
 console.log('PASS injected write denial with current revision remains unclassified permission-denied');
 // Actual local rules revocation while an older owner commit is held.
 await b.evaluate(t=>api.createTournamentDocument({...t,id:'synthetic-revoked'}),tournament);
 holdNextCommit=true;
 const revokedReached=new Promise(resolve=>commitReached=resolve);
 const revokedPending=a.evaluate(async()=>{try{await api.updateTournament('synthetic-revoked',0,t=>({...t,title:'Should remain denied'}));return {};}catch(e){return {code:e.code,revisionChanged:e.revisionChanged};}});
 await revokedReached;
 await b.evaluate(()=>api.updateTournament('synthetic-revoked',0,t=>({...t,title:'New revision'})));
 try {
  await localJSON(storeOrigin,`/emulator/v1/projects/${project}:securityRules`,{rules:{files:[{name:'revoked.rules',content:"rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if false; } } }"}]}},'PUT');
  releaseCommit();
  const revoked=await revokedPending;assert.equal(revoked.code,'permission-denied');assert.equal(revoked.revisionChanged,undefined);
 } finally {await localJSON(storeOrigin,`/emulator/v1/projects/${project}:securityRules`,{rules:{files:[{name:'candidate.rules',content:rules}]}},'PUT');}
 assert.equal((await b.evaluate(()=>api.getTournament('synthetic-revoked'))).revision,1);
 console.log('PASS actual emulator rules revocation plus stale revision remains permission-denied without revision hint');
 abortNextCommit=true;
 await b.evaluate(()=>{globalThis.txAttempts=0;});
 await b.evaluate(()=>api.saveProfile('Synthetic Retry'));
 assert.equal(injectedAborts,1);assert((await b.evaluate(()=>txAttempts))>=2);
 assert.equal((await b.evaluate(()=>api.getProfile())).name,'Synthetic Retry');
 console.log('PASS real SDK retries adapter transaction after one injected ABORTED commit; server confirms write');
 const casual={participantIds:[uid],perPlayer:[{playerId:uid,gameType:'301',points:301,darts:9,marks:0}],gameType:'301',matchId:'synthetic-casual',legScores:[]};
 const context={backendKey:project+':demo-app'};
 denyReceipt=true;
 const partial=await b.evaluate(async args=>{try{await api.saveCasualResult('synthetic-casual',args.casual,args.context);return null;}catch(e){return e.code;}},{casual,context});
 assert.equal(partial,'permission-denied');assert.equal(deniedReceipts,1);
 const beforeRetry=await b.evaluate(async()=>{const s=await sdk.getDocFromServer(sdk.doc(testDB,'blakeoutDevCasualResults','synthetic-casual'));return s.data().createdAt;});
 const first=await b.evaluate(args=>api.saveCasualResult('synthetic-casual',args.casual,args.context),{casual,context});
 const again=await b.evaluate(args=>api.saveCasualResult('synthetic-casual',args.casual,args.context),{casual,context});
 assert.equal(first.createdAt,again.createdAt);assert.equal(first.createdAt,beforeRetry);
 console.log('PASS receipt failure after result commit repaired by replay without rewriting immutable result');
 const mine=await b.evaluate(()=>api.listMyResults());assert(mine.some(r=>r.id==='synthetic-casual'));
 console.log('PASS actual casual-result/receipt writes, idempotent replay and own-result query');
 offlineControl=true;
 await ca.setOffline(true);
 await a.evaluate(()=>{globalThis.queuedSettled=false;globalThis.queueControl=sdk.setDoc(sdk.doc(testDB,'blakeoutDevProfiles',api.getAccount().uid),{name:'Synthetic Queue Control'}).then(()=>{globalThis.queuedSettled=true;});});
 assert(await a.evaluate(async()=>{try{await api.updateTournament('synthetic-race',1,t=>({...t,title:'Offline forbidden'}));return false;}catch{return true;}}));
 assert.equal(await a.evaluate(()=>globalThis.queuedSettled),false);
 assert.equal((await b.evaluate(()=>api.getProfile())).name,'Synthetic Retry');
 await ca.setOffline(false);
 await a.evaluate(()=>globalThis.queueControl);
 assert.equal((await b.evaluate(()=>api.getProfile())).name,'Synthetic Queue Control');
 offlineControl=false;
 console.log('PASS WebChannel connectivity probes blocked without network continuation: '+blockedOfflineProbes.length);
 console.log('PASS direct SDK queue control stays pending offline and persists on reconnect (not an adapter write)');
 assert.equal((await a.evaluate(()=>api.getTournament('synthetic-race'))).revision,1);
 // A successful explicit post-reconnect update proves connectivity was restored.
 await a.evaluate(()=>api.updateTournament('synthetic-race',1,t=>({...t,title:'Reconnected'})));
 assert.equal((await b.evaluate(()=>api.getTournament('synthetic-race'))).revision,2);
 console.log('PASS browser-only offline rejects transaction; no queued mutation; explicit reconnect update advances once');
 await a.evaluate(()=>{globalThis.pauseRead=true;globalThis.readPaused=false;globalThis.pending=api.updateTournament('synthetic-race',2,t=>({...t,title:'Stale session'})).then(()=>({ok:true}),e=>({ok:false,message:e.message}));});
 await a.waitForFunction(()=>globalThis.readPaused===true);
 await a.evaluate(async()=>{await api.signOutAccount();globalThis.resumeRead();});
 assert.equal((await a.evaluate(()=>globalThis.pending)).ok,false);
 assert.equal((await b.evaluate(()=>api.getTournament('synthetic-race'))).revision,2);
 console.log('PASS signout during transaction read rejects stale session before commit; second client unaffected');
 await a.evaluate(args=>api.signInAccount(args.email,args.password),{email,password});
 assert.equal((await a.evaluate(()=>api.getTournament('synthetic-race'))).revision,2);
 console.log('PASS sign-in after stale-session rejection does not replay aborted adapter update');
 // Actual engine + adapter + Auth/Firestore: all six cloud tournament modes.
 async function verifiedDevice(label){
  const d=await device(), email=label.toLowerCase()+'-'+Date.now()+'@example.invalid';
  const uid=await d.page.evaluate(async x=>(await api.registerAccount(x.email,x.password)).uid,{email,password});
  const codes=await localJSON(authOrigin,`/emulator/v1/projects/${project}/oobCodes`,undefined,'GET');
  const code=codes.oobCodes.find(x=>x.email===email&&x.requestType==='VERIFY_EMAIL').oobCode;
  await localJSON(authOrigin,`/identitytoolkit.googleapis.com/v1/accounts:update?key=${project}`,{oobCode:code});
  await d.page.evaluate(()=>api.refreshAccount());
  assert.equal(await d.page.evaluate(async()=>{try{await sdk.getDocFromServer(sdk.doc(testDB,'blakeoutDevProfiles',api.getAccount().uid));return null;}catch(e){return e.code;}}),'permission-denied');
  pilotUids.push(uid);await setPilots(pilotUids);
  await d.page.evaluate(label=>api.saveProfile(label),label);
  return {...d,uid};
 }
 const participant=await verifiedDevice('SyntheticParticipant'), outsider=await verifiedDevice('SyntheticOutsider');
 for(const gameType of ['chicago','301','501','cricket','spanish','minnesota']){
  const prepared=await b.evaluate(async({gameType,otherUid})=>{
   const engine=await import('/dev/js/brackets/engine.js');globalThis.engine=engine;
   const user=api.requireVerifiedAccount();
   let t=engine.createTournament({id:'match-'+gameType,ownerId:user.uid,title:'Synthetic '+gameType,date:'2026-10-17',gameType,bestOf:1});
   t=engine.saveRoster(t,[0,1,2,3].map(i=>({id:'reg'+i,playerId:i===0?user.uid:i===2?otherUid:null,name:'Synthetic '+i,tag:i<2?'A':'B',paid:true,checkedIn:true,standby:false})));
   t=await api.createTournamentDocument(t);
   const started=engine.startTournament(t);
   t=await api.updateTournament(t.id,0,()=>started);
   const match=t.matches.find(x=>x.status==='ready');
   const result={gameType,matchId:match.id,participantIds:[user.uid,otherUid],perPlayer:[user.uid,otherUid].flatMap(playerId=>(gameType==='chicago'?['301','cricket','501']:[gameType]).map(gameType=>({playerId,gameType,points:30,darts:3,marks:0}))),legScores:[],winnerId:match.teamA,scoreA:gameType==='chicago'?2:1,scoreB:0,forfeit:false};
   return {t,match,result};
  },{gameType,otherUid:participant.uid});
  const resultId='result-'+gameType;
  const args={...prepared,resultId,context:{backendKey:project+':demo-app'}};
  const deniedOwner=await participant.page.evaluate(async x=>{try{await api.saveMatchResult(x.t.id,1,x.resultId,x.result,t=>t,x.context);return false;}catch(e){return /organizer/.test(e.message);}},args);assert(deniedOwner);
  for(const bad of ['missing-participant','negative-counter','wrong-game','missing-backend']){
   const rejected=await b.evaluate(async({x,bad})=>{
    const result=structuredClone(x.result);let context=x.context;
    if(bad==='missing-participant')result.participantIds=[result.participantIds[0]];
    if(bad==='negative-counter')result.perPlayer[0].darts=-1;
    if(bad==='wrong-game')result.gameType=result.gameType==='301'?'501':'301';
    if(bad==='missing-backend')context={};
    try{await api.saveMatchResult(x.t.id,1,'invalid-'+bad+'-'+result.gameType,result,t=>engine.recordResult(t,result.matchId,result),context);return false;}catch{return true;}
   },{x:args,bad});assert(rejected,gameType+'/'+bad);
  }
  assert.equal((await b.evaluate(id=>api.getTournament(id),prepared.t.id)).revision,1);
  if(gameType==='501'){
   holdNextCommit=true;const reached=new Promise(resolve=>commitReached=resolve);
   const pending=a.evaluate(async x=>{const e=await import('/dev/js/brackets/engine.js');try{await api.saveMatchResult(x.t.id,1,'losing-result',x.result,t=>e.recordResult(t,x.result.matchId,x.result),x.context);return {};}catch(error){return {code:error.code,revisionChanged:error.revisionChanged};}},args);
   await reached;
   await b.evaluate(x=>api.saveMatchResult(x.t.id,1,x.resultId,x.result,t=>engine.recordResult(t,x.result.matchId,x.result),x.context),args);
   releaseCommit();const lost=await pending;assert.equal(lost.code,'permission-denied');assert.equal(lost.revisionChanged,true);
   assert.equal(await b.evaluate(async()=> (await sdk.getDocFromServer(sdk.doc(testDB,'blakeoutDevResults','losing-result'))).exists()),false);
   console.log('PASS match-result contention preserves denial, adds authorized revision hint, and leaves no losing result');
  }else await b.evaluate(x=>api.saveMatchResult(x.t.id,1,x.resultId,x.result,t=>engine.recordResult(t,x.result.matchId,x.result),x.context),args);
  const replay=await b.evaluate(x=>api.saveMatchResult(x.t.id,1,x.resultId,x.result,()=>{throw Error('Replay must not invoke updater');},x.context),args);assert.equal(replay.revision,2);
  assert.equal(await participant.page.evaluate(async id=>(await sdk.getDocFromServer(sdk.doc(testDB,'blakeoutDevResults',id))).exists(),resultId),true);
  assert.equal(await outsider.page.evaluate(async id=>{try{await sdk.getDocFromServer(sdk.doc(testDB,'blakeoutDevResults',id));return null;}catch(e){return e.code;}},resultId),'permission-denied');
  assert.equal(await participant.page.evaluate(async id=>{try{await sdk.getDocFromServer(sdk.doc(testDB,'blakeoutDevRosterPrivate',id));return null;}catch(e){return e.code;}},prepared.t.id),'permission-denied');
  console.log('PASS match mode '+gameType+': actual engine/adapter commit and replay; 4 invalid cases; nonowner write/outsider read/private-roster access denied');
 }
 const casualGames=['301','501','701','801','901','1101','1501','cricket','spanish','minnesota','chaos','quickie','cutthroat','wildcard','hammer','teamhammer','chicago','121','baseball','bermuda','golf','shanghai','countup','gotcha','sharktank','tictactoe','robinhood','doubledown','teamcricket'];
 for(const gameType of casualGames){
  const saved=await b.evaluate(async({gameType,context})=>{const uid=api.requireVerifiedAccount().uid;return api.saveCasualResult('casual-mode-'+gameType,{gameType,matchId:'casual-mode-'+gameType,participantIds:[uid],perPlayer:[{playerId:uid,gameType,points:20,darts:3,marks:0}],legScores:[]},context);},{gameType,context:{backendKey:project+':demo-app'}});
  assert.equal(saved.gameType,gameType);
 }
 console.log('PASS all '+casualGames.length+' supported casual modes through real adapter, result and receipt transactions');
 await participant.context.close();await outsider.context.close();
 await b.reload();await b.evaluate(async()=>{globalThis.api=await import('/dev/js/platform.js');await api.initPlatform();});
 assert.equal(await b.evaluate(()=>api.requireVerifiedAccount().uid),uid);
 console.log('PASS SDK browser persistence restores verified account after reload');
 assert.deepEqual(blocked,[]);
 console.log('PASS no unexpected browser request; known offline probes and negative probe denied; no Firestore stubs');
 await ca.close();await cb.close();
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
