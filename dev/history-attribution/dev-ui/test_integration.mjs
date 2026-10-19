import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {DEV_ENVIRONMENT,assertAdapterEnvironment} from '../environment.mjs';
import {adaptersForSession,openDevHistorySession} from './session.mjs';
import {historyDesk,submitCasualResult} from './bridge.mjs';
import {consentLink,consentParams,mountHistoryView} from './views.mjs';
import * as engine from '../../js/brackets/engine.js';import {template} from '../../tournament-device/model.mjs';
const require=createRequire(import.meta.url),{JSDOM}=require(process.env.BLAKEOUT_JSDOM_MODULE||'/workspace/blakeout-recovery/container-build/node_modules/jsdom');
function connection(role='phone') {const app={name:role==='board'?'blakeout-darts-dev-history-board':'blakeout-darts-dev-accounts',options:{projectId:'blakeout-darts-dev',authDomain:'blakeout-darts-dev.firebaseapp.com',appId:'1:901185136996:web:89d4f413520e66ff773271'}};const db={app},auth={app,currentUser:{uid:'a',emailVerified:true}},sdk={getFirestore:(a,name)=>a===app&&name==='(default)'?db:null};return {db,auth,sdk,role};}
test('explicit DEV routing accepted; implicit live routing and unknown namespace/project rejected',()=>{
 const c=connection();assert.equal(assertAdapterEnvironment({...c,environment:DEV_ENVIRONMENT}).projectId,'blakeout-darts-dev');
 assert.throws(()=>assertAdapterEnvironment(c),/mismatch/);
 for(const change of [{namespace:'production'},{databaseId:'other'},{projectId:'blakeout'},{mode:'production'}])assert.throws(()=>assertAdapterEnvironment({...c,environment:{...DEV_ENVIRONMENT,...change}}),/Unknown/);
 c.db.app.options.projectId='blakeout';assert.throws(()=>adaptersForSession(c),/mismatch/);
});
test('default DB and Auth/app identity required; board isolated from accounts app',()=>{
 const c=connection();assert.throws(()=>adaptersForSession({...c,auth:{...c.auth,app:{}}}),/mismatch/);
 assert.throws(()=>adaptersForSession({...c,sdk:{getFirestore:()=>({})}}),/default/);
 assert.throws(()=>adaptersForSession({...c,role:'board'}),/separate/);
 assert.equal(adaptersForSession(connection('board')).role,'board');
});
test('released entry fails closed before network even for the exact DEV route',async()=>{
 await assert.rejects(openDevHistorySession('phone',{origin:'https://blakeoutdarts.com',pathname:'/dev/history-attribution/dev-ui/'}),/not released/);
});
test('phone QR encodes only scope; arbitrary paths and mixed scopes rejected',()=>{
 const url=new URL(consentLink('event-1','r1'));assert.equal(url.pathname,'/dev/history-attribution/dev-ui/');assert(!url.href.includes('uid='));
 assert.deepEqual(consentParams(url.hash),{contextId:'t_event-1',registrationId:'r1',seatId:'',invitationId:''});
 assert.throws(()=>consentLink('../event','r'),/Invalid/);assert.throws(()=>consentParams('#context=t_e&registration=r&seat=1'),/Wrong/);
 assert.throws(()=>consentParams('#context=g_e&registration=r&seat=5&invitation=x'),/Invalid/);
});
function deskFixture(){let t=engine.createTournament({id:'e',ownerId:'a',title:'Tournament',date:'2026-10-19',gameType:'501',bestOf:1});t=engine.saveRoster(t,Array.from({length:8},(_,i)=>({id:'r'+i,playerId:null,name:'P'+i,tag:String(Math.floor(i/2)+1),paid:true,checkedIn:true,standby:false})));t=engine.startTournament(t);const event=template(t,'board');const documents={'tdEvents/e':event,'hcContexts/t_e':{kind:'tournament',sourceId:'e',active:true},'hcContexts/t_e/state/current':{revision:7,results:{},active:{},lastOp:''}};const writes=[],c=connection();const session={...c,storeSDK:{doc:(_,...p)=>p.join('/'),runTransaction:async(_,fn)=>fn({get:async p=>({exists:()=>!!documents[p],data:()=>documents[p]})})},history:{submit:async r=>writes.push(r)},tournament:{list:async()=>[event]}};return {session,writes,documents,api:historyDesk(session)};}
test('desk uses coherent head, real engine review and current actor; submits exact reviewed revision',async()=>{
 const f=deskFixture(),state=await f.api.load('e');assert.equal(state.head.revision,7);
 const m=state.bracket.matches.find(m=>m.status==='ready');const review=await f.api.review('e',m.id,{winnerId:m.teamA,scoreA:1,scoreB:0,forfeit:false});assert(review.affected.includes(m.id));
 await f.api.submit(review);assert.equal(f.writes[0].contextId,'t_e');assert.equal(f.writes[0].expectedRevision,7);
 f.session.auth.currentUser={uid:'b'};await assert.rejects(f.api.submit(review),/Session changed/);assert.equal(f.writes.length,1);
});
test('casual bridge retains all scorer counters and operation identity',async()=>{
 const calls=[],session={history:{submit:async x=>calls.push(x)}};
 await submitCasualResult(session,{contextId:'g_game',gameId:'game',operationId:'retry-safe',expectedRevision:3,result:{gameType:'501',perPlayer:[{playerId:'a',points:1},{playerId:'b',points:2}]}});
 assert.deepEqual(Object.keys(calls[0].input.perPlayer),['a','b']);assert.equal(calls[0].operationId,'retry-safe');
});
test('real phone view passes exact displayed consent only after checkbox',async()=>{
 const dom=new JSDOM('<main></main>'),root=dom.window.document.querySelector('main'),calls=[];
 const session={role:'phone',auth:{currentUser:{uid:'a'}},history:{consentDetails:async p=>({...p,uid:'a',scope:'named-tournament',eventId:'e'}),confirm:async p=>calls.push(p)}};
 await mountHistoryView(root,session,{view:'consent',hash:'#context=t_e&registration=r1'});
 const button=root.querySelector('button');assert(button.disabled);const ack=root.querySelector('input');ack.checked=true;ack.onchange();await button.onclick();assert.equal(calls.length,1);assert.equal(calls[0].displayed.contextId,'t_e');assert.equal(calls[0].displayedUid,'a');dom.window.close();
});
test('board cannot mount owner history; account switch during grant read prevents stale rendering',async()=>{
 const dom=new JSDOM('<main></main>'),root=dom.window.document.querySelector('main');
 await assert.rejects(mountHistoryView(root,{role:'board',auth:{currentUser:{uid:'board'}}}),/cannot open/);
 const auth={currentUser:{uid:'a'}};await assert.rejects(mountHistoryView(root,{role:'phone',auth,history:{grants:async()=>{auth.currentUser={uid:'b'};return {grants:[{id:'secret'}],cursor:null};}}}),/Account changed/);
 assert(!root.textContent.includes('secret'));dom.window.close();
});
test('DEV default database guard works with pinned Firebase SDK instances without network',async()=>{
 const modules=process.env.BLAKEOUT_QA_MODULES||'/workspace/blakeout-recovery/container-build/node_modules';
 const apps=require(modules+'/firebase/app'),sdk=require(modules+'/firebase/firestore');
 const app=apps.initializeApp(connection().db.app.options,'guard-contract-test');
 const db=sdk.getFirestore(app,'(default)'),other=sdk.getFirestore(app,'other');
 try {
  assert.equal(assertAdapterEnvironment({db,auth:{app},sdk,environment:DEV_ENVIRONMENT}),DEV_ENVIRONMENT);
  assert.throws(()=>assertAdapterEnvironment({db:other,auth:{app},sdk,environment:DEV_ENVIRONMENT}),/default/);
 } finally {await sdk.terminate(db);await sdk.terminate(other);await apps.deleteApp(app);}
});
test('desk refuses missing or mismatched canonical context instead of using old tournament head',async()=>{
 const f=deskFixture();delete f.documents['hcContexts/t_e'];await assert.rejects(f.api.load('e'),/not been prepared/);
 f.documents['hcContexts/t_e']={kind:'tournament',sourceId:'other',active:true};await assert.rejects(f.api.load('e'),/Wrong history context/);
});
