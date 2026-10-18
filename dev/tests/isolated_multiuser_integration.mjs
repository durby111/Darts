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
 const users=[];const password='Synthetic-only-123!';
 // Auth identities are synthetic emulator data. No actual accounts or email.
 for(let i=0;i<40;i++){
  const email=`roster-${i}-${Date.now()}@example.invalid`;
  const registered=await localJSON(authOrigin,`/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${project}`,{email,password,returnSecureToken:true});
  await localJSON(authOrigin,`/identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${project}`,{requestType:'VERIFY_EMAIL',idToken:registered.idToken});
  const codes=await localJSON(authOrigin,`/emulator/v1/projects/${project}/oobCodes`,undefined,'GET');
  const code=codes.oobCodes.find(x=>x.email===email&&x.requestType==='VERIFY_EMAIL').oobCode;
  await localJSON(authOrigin,`/identitytoolkit.googleapis.com/v1/accounts:update?key=${project}`,{oobCode:code});
  users.push({email,password,uid:registered.localId});
 }
 await setPilots(users.map(u=>u.uid));
 for(const u of users){await a.evaluate(x=>api.signInAccount(x.email,x.password),u);await a.evaluate(()=>api.saveProfile('TEST Same Display Name'));await a.evaluate(()=>api.signOutAccount());}
 await a.evaluate(x=>api.signInAccount(x.email,x.password),users[0]);await b.evaluate(x=>api.signInAccount(x.email,x.password),users[1]);
 console.log('PASS 40 synthetic verified profiles, duplicate display names retain distinct UIDs');
 const rosterEvidence=[];const tournamentRecipients={};
 for(const teams of [2,3,5,20]){
  const event=await a.evaluate(async({teams,uids})=>{
   const e=await import('/dev/js/brackets/engine.js');
   let t=e.createTournament({id:'roster-'+teams,ownerId:api.getAccount().uid,title:'TEST Teams '+teams,date:'2026-10-17',gameType:'301',bestOf:1});
   t=e.saveRoster(t,uids.map((uid,i)=>({id:'reg-'+i,playerId:uid,name:'TEST Same Display Name',tag:'T'+Math.floor(i/2),paid:true,checkedIn:true,standby:false})));
   t=await api.createTournamentDocument(t);return api.updateTournament(t.id,0,x=>e.startTournament(x));
  },{teams,uids:users.slice(0,teams*2).map(u=>u.uid)});
  const recipients=await a.evaluate(async({event,teams,context})=>{
   const e=await import('/dev/js/brackets/engine.js');
   const match=event.matches.find(m=>m.status==='ready');
   const members=event.teams.filter(t=>[match.teamA,match.teamB].includes(t.id)).flatMap(t=>t.memberIds);
   const ids=event.registrations.filter(r=>members.includes(r.id)).map(r=>r.playerId);
   const result={gameType:'301',matchId:match.id,participantIds:ids,perPlayer:ids.map(playerId=>({playerId,gameType:'301',points:30,darts:3,marks:0})),legScores:[],winnerId:match.teamA,scoreA:1,scoreB:0,forfeit:false};
   const resultId='tournament-night-'+teams;
   let t=await api.saveMatchResult(event.id,event.revision,resultId,result,x=>e.recordResult(x,match.id,result),context);
   const reference=sdk.doc(testDB,'blakeoutDevResults',resultId);const original=JSON.stringify((await sdk.getDocFromServer(reference)).data());
   const replay=await api.saveMatchResult(event.id,event.revision,resultId,result,x=>x,context);
   if(replay.revision!==t.revision)throw Error('Duplicate result advanced revision');
   t=await api.updateTournament(t.id,t.revision,x=>e.recordResult(x,match.id,{winnerId:match.teamB,scoreA:0,scoreB:1,forfeit:false}));
   if(t.matches.find(m=>m.id===match.id).winnerId!==match.teamB)throw Error('Correction failed');
   if(JSON.stringify((await sdk.getDocFromServer(reference)).data())!==original)throw Error('Correction rewrote immutable dart statistics');
   return ids;
  },{event,teams,context:{backendKey:project+':demo-app'}});
  for(const uid of recipients)tournamentRecipients[uid]=(tournamentRecipients[uid]||0)+1;
  assert.equal(event.teams.length,teams);assert.equal(new Set(event.registrations.map(x=>x.playerId)).size,teams*2);rosterEvidence.push({teams,players:teams*2});
 }
 console.log('PASS stable UID rosters:2,3,5,20 doubles teams, up to40people; actual tournament result/replay/correction preserve immutable counters');
 const context={backendKey:project+':demo-app'};let writes=0;
 // Two independent scorekeepers submit different matches/modes concurrently.
 for(let round=0;round<2;round++)for(let group=0;group<10;group+=2){
  await Promise.all([a,b].map(async(p,j)=>{
   const index=group+j, ids=users.slice(index*4,index*4+4).map(u=>u.uid),gameType=round?'cricket':'301',id=`night-${round}-${index}`;
   const result={matchId:id,gameType,participantIds:ids,perPlayer:ids.map((playerId,k)=>({playerId,gameType,points:round?0:30+k,darts:3,marks:round?3+k:0})),legScores:[]};
   await p.evaluate(x=>api.saveCasualResult(x.id,x.result,x.context),{id,result,context});
   // Duplicate save/retry and conflicting content must preserve immutable receipt/result.
   await p.evaluate(x=>api.saveCasualResult(x.id,x.result,x.context),{id,result:{...result,perPlayer:result.perPlayer.map(x=>({...x,points:999}))},context});writes++;
  }));
 }
 for(let i=0;i<40;i++){
  await b.evaluate(()=>api.signOutAccount());await b.evaluate(x=>api.signInAccount(x.email,x.password),users[i]);
  const history=await b.evaluate(()=>api.listMyResults());
  const attributed=history.filter(r=>r.id.startsWith('night-') && r.participantIds.includes(users[i].uid));
  assert.equal(history.filter(r=>r.id.startsWith('tournament-night-')).length,tournamentRecipients[users[i].uid]||0);
  assert.equal(attributed.length,2);
  for(const r of attributed){assert.equal(r.perPlayer.filter(p=>p.playerId===users[i].uid).length,1);assert(r.perPlayer.every(p=>p.points!==999));}
 }
 console.log('PASS 20 distinct results, concurrent scorekeepers/two modes,40 independent UID history lookups; retries/conflicting replay do not double count');
 await a.evaluate(()=>api.signOutAccount());await a.evaluate(x=>api.signInAccount(x.email,x.password),users[0]);
 assert(await a.evaluate(async context=>{try{await api.saveCasualResult('bad-guest',{gameType:'301',participantIds:[null],perPlayer:[{playerId:null,gameType:'301',points:1,darts:1,marks:0}]},context);return false;}catch{return true;}},context));
 assert(await a.evaluate(async context=>{try{await api.saveCasualResult('bad-attribution',{gameType:'301',participantIds:[],perPlayer:[{playerId:api.getAccount().uid,gameType:'301',points:1,darts:1,marks:0}]},context);return false;}catch{return true;}},context));
 console.log('PASS guests excluded from UID statistics; unrelated per-player counters rejected');
 await fs.writeFile(process.env.BLAKEOUT_QA_OUTPUT+'/multiuser-summary.json',JSON.stringify({rosters:rosterEvidence,syntheticUsers:40,casualResults:writes,tournamentResults:4,corrections:4,historyChecks:40,concurrentScorekeepers:2,modes:['301','cricket'],scope:'Real SDK/Firestore/Auth emulator. API-level independent contexts; not40 physical devices or a capacity load test.'},null,2));
 await ca.close();await cb.close();assert.deepEqual(blocked,[]);
 console.log('PASS external requests blocked, no live Firebase, no live allowlist changes');
} finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
