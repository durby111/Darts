#!/usr/bin/env python3
"""DEV platform/browser contract tests; Firebase traffic is mocked, never live.

Run with the existing environment:
    /home/md/Documents/Darts/.venv/bin/python dev/tests/platform_test.py

If FIRESTORE_EMULATOR_HOST points at an existing localhost emulator, also compile
and exercise firestore.rules in an isolated demo project. Otherwise that group is
explicitly skipped. No emulator or dependency installation is performed.

--print-simulator-fixture emits the exact persisted 4-player/12-counter Chicago
fixture as SIMULATOR_FIXTURE=<JSON> for Firebase's real rules simulator. perPlayer
is a canonical JSON string on the wire; all platform APIs still return arrays.
FEATURE_FIXTURE=<JSON> contains selfjoin/bootstrap/materialization/start data
and the 128-participant/384-counter casual fixture. Simulator lookups must use
the supplied signup-state snapshots rather than treating every get as a public
tournament lookup.
GUEST_FIXTURE=<JSON> covers a separate anonymous device signup with playerId:null.
--save-rules-fixtures writes dev/tests/platform_rules_fixtures.json with complete
before/after document maps, request auth, and expected per-write/read decisions.
"""
import ast
import asyncio
import base64
import functools
import hashlib
import http.server
import json
import os
from pathlib import Path
import re
import shutil
import sys
import threading
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = ROOT / f".platform-test-runtime-{os.getpid()}"
sys.dont_write_bytecode = True

APP = """
const apps = [{name:'[DEFAULT]'}];
export const getApps=()=>apps;
export const initializeApp=(config,name)=>{const app={name};apps.push(app);return app;};
"""

AUTH = """
const key='platform-test-auth';
const initial={uid:'verified_owner',email:'owner@example.com',emailVerified:true,isAnonymous:false};
const hydrate=user=>user&&({...user,getIdToken:async()=> 'verified'});
const auth={currentUser:hydrate(JSON.parse(localStorage.getItem(key)||JSON.stringify(initial)))};
const listeners=[];
const guestKey='platform-test-guest-auth';
const guestAuth={currentUser:hydrate(JSON.parse(localStorage.getItem(guestKey)||'null'))};
const guestListeners=[];
globalThis.ruleAccountUser=auth.currentUser;
globalThis.ruleGuestUser=guestAuth.currentUser;
const notify=user=>{auth.currentUser=hydrate(user);globalThis.ruleAccountUser=auth.currentUser;listeners.forEach(cb=>cb(auth.currentUser));};
globalThis.changeTestUser=user=>{localStorage.setItem(key,JSON.stringify(user));notify(user);};
globalThis.changeGuestTestUser=user=>{guestAuth.currentUser=hydrate(user);globalThis.ruleGuestUser=guestAuth.currentUser;localStorage.setItem(guestKey,JSON.stringify(user));guestListeners.forEach(cb=>cb(guestAuth.currentUser));};
addEventListener('storage',event=>{
 if(event.key===key)notify(JSON.parse(event.newValue));
 if(event.key===guestKey){guestAuth.currentUser=hydrate(JSON.parse(event.newValue));globalThis.ruleGuestUser=guestAuth.currentUser;guestListeners.forEach(cb=>cb(guestAuth.currentUser));}
});
export const getAuth=app=>({app,get currentUser(){return app.name==='blakeout-dev-guests'?guestAuth.currentUser:auth.currentUser;}});
export const browserLocalPersistence='LOCAL';
export const setPersistence=async(auth,value)=>{globalThis.testPersistence={app:auth.app.name,value};};
export const onAuthStateChanged=(auth,cb)=>{
 const target=auth.app.name==='blakeout-dev-guests'?guestListeners:listeners;
 target.push(cb);queueMicrotask(()=>cb(auth.currentUser));
 return()=>{const i=target.indexOf(cb);if(i>=0)target.splice(i,1);};
};
export const signInAnonymously=async auth=>{
 if(auth.app.name!=='blakeout-dev-guests')throw Error('Anonymous signin attempted on non-guest app');
 globalThis.anonymousApp=auth.app.name;
 changeGuestTestUser({uid:'anonymous_guest',emailVerified:false,isAnonymous:true});
 return {user:auth.currentUser};
};
export const isSignInWithEmailLink=(auth,url)=>new URL(url).searchParams.has('oobCode');
export const sendSignInLinkToEmail=async(auth,email,settings)=>{globalThis.sentLink={email,settings};};
export const signInWithEmailLink=async(auth,email)=>{
 if(email!=='owner@example.com')throw Object.assign(Error('Invalid email for this link'),{code:'auth/invalid-email'});
 globalThis.changeTestUser(initial);return {user:hydrate(initial)};
};
export const signOut=async()=>globalThis.changeTestUser(null);
const fail=()=>{if(globalThis.authFailure)throw Object.assign(Error('Authentication request failed'),{code:globalThis.authFailure});};
export const createUserWithEmailAndPassword=async(auth,email,password)=>{
 fail();if(password.length<6)throw Error('Weak password');
 globalThis.changeTestUser({uid:'registered_user',email,emailVerified:false,isAnonymous:false});
 return {user:auth.currentUser};
};
export const signInWithEmailAndPassword=async(auth,email,password)=>{
 fail();if(password==='wrong-password')throw Object.assign(Error('Invalid credentials'),{code:'auth/invalid-credential'});
 globalThis.changeTestUser(email==='owner@example.com'?initial:{uid:'registered_user',email,emailVerified:false,isAnonymous:false});
 return {user:auth.currentUser};
};
export const sendEmailVerification=async(user,settings)=>{
 fail();globalThis.sentVerification={email:user.email,settings,count:(globalThis.sentVerification?.count||0)+1};
};
export const sendPasswordResetEmail=async(auth,email,settings)=>{
 fail();globalThis.sentReset={email,settings};
};
export const reload=async user=>{fail();globalThis.reloadCount=(globalThis.reloadCount||0)+1;if(globalThis.mockVerified)user.emailVerified=true;};
"""

STORE = """
export const getFirestore=app=>({appName:app.name});
const docs=new Map();
globalThis.testDocs=docs;
globalThis.testReadPaths=[];
globalThis.testReadsByApp=[];
globalThis.ruleTransactions=[];
const snap=ref=>({id:ref.id,exists:()=>docs.has(ref.path),data:()=>structuredClone(docs.get(ref.path))});
const online=()=>{if(globalThis.testOffline)throw Error('Offline');};
const readable=()=>{online();if(globalThis.denyReads)throw Object.assign(Error('Missing permissions'),{code:'permission-denied'});};
export const collection=(db,...parts)=>({path:parts.join('/'),db});
export const doc=(db,...parts)=>parts.length?{path:parts.join('/'),id:parts.at(-1),db}:{path:db.path+'/generated-id',id:'generated-id',db:db.db};
export const getDocFromServer=async ref=>{readable();testReadPaths.push(ref.path);testReadsByApp.push({app:ref.db.appName,path:ref.path});return snap(ref);};
export const getDocsFromServer=async ref=>{
 readable();return {docs:[...docs].filter(([path,data])=>path.startsWith(ref.path+'/')
 &&(!ref.filter||(ref.filter.op==='array-contains'?data[ref.filter.field].includes(ref.filter.value):data[ref.filter.field]===ref.filter.value)))
 .map(([path])=>snap({path,id:path.split('/').at(-1)}))};
};
export const query=(col,filter)=>({...col,filter});
export const where=(field,op,value)=>({field,op,value});
export const runTransaction=async(db,callback)=>{
 online();
 if(globalThis.beforeTransaction)await globalThis.beforeTransaction();
 const attempt=async()=>{
   const writes=[];
   const result=await callback({get:async ref=>{
     if(ref.db!==db)throw Error('Cross-Firestore transaction reference');
     if(writes.length)throw Error('Transaction reads after writes');testReadPaths.push(ref.path);testReadsByApp.push({app:db.appName,path:ref.path});return snap(ref);
   },set:(ref,value)=>{if(ref.db!==db)throw Error('Cross-Firestore write');writes.push([ref.path,structuredClone(value)]);},
   delete:ref=>writes.push([ref.path,null])});
   return {writes,result};
 };
 let outcome=await attempt();
 if(globalThis.retryTransaction&&outcome.writes.length){globalThis.retryTransaction=false;outcome=await attempt();}
 const {writes,result}=outcome;
 if(writes.some(([path])=>path.startsWith('blakeoutDevCasualReceipts/'))){
   globalThis.receiptBatches=(globalThis.receiptBatches||0)+1;
   if(globalThis.failReceiptBatchAt===globalThis.receiptBatches)throw Error('Connection lost while delivering receipts');
 }
 const before=globalThis.captureRules&&writes.length?new Map(docs):null;
 writes.forEach(([path,value])=>value===null?docs.delete(path):docs.set(path,value));
 if(before){
   const actor=db.appName==='blakeout-dev-guests'?globalThis.ruleGuestUser:globalThis.ruleAccountUser;
   const token=actor?{firebase:{sign_in_provider:actor.isAnonymous?'anonymous':'password'}}:null;
   if(actor&&!actor.isAnonymous)token.email_verified=!!actor.emailVerified;
   ruleTransactions.push({before,after:new Map(docs),writes,appName:db.appName,
     auth:actor?{uid:actor.uid,token}:null,clientAccountUid:globalThis.ruleAccountUser?.uid||null});
 }
 return result;
};
"""

API_TESTS = r"""async () => {
 const p=await import('/dev/js/platform.js'), e=await import('/dev/js/brackets/engine.js');
 await p.initPlatform();
 const checks=[];
 const assert=(value,label)=>{if(!value)throw Error(label);checks.push(label);};
 const reject=async(fn,label)=>{let error;try{await fn();}catch(e){error=e;}assert(!!error,label);};
 assert(testPersistence.app==='blakeout-dev-accounts'&&testPersistence.value==='LOCAL','secondary LOCAL auth');
 let calls=0;const unsub=p.subscribeAccount(()=>calls++);unsub();
 assert(calls===1,'immediate account subscription');
 assert(p.requireVerifiedAccount().uid==='verified_owner','verified UID access');
 await p.saveProfile('Zoë "Ace" \\ 🎯');
 assert(JSON.stringify(testDocs.get('blakeoutDevProfiles/verified_owner'))===JSON.stringify({name:'Zoë "Ace" \\ 🎯'}),'name-only Unicode profile');
 assert((await p.listProfiles())[0].id==='verified_owner','profile lookup returns stable UID');
 await reject(()=>p.saveProfile('someone@example.com'),'email never becomes a public profile name');
 let t=await p.createTournamentDocument(e.createTournament({id:'test_t',ownerId:'wrong_owner',title:'Unicode 🎯',date:'2026-09-07',gameType:'501',bestOf:3}));
 assert(t.ownerId==='verified_owner'&&t.revision===0,'owner and revision assigned by storage');
 await reject(()=>p.createTournamentDocument(t),'duplicate tournament ID');
 await reject(()=>p.updateTournament(t.id,9,x=>x),'stale revision');
 await reject(()=>p.updateTournament(t.id,0,x=>({...x,email:'private@example.com'})),'unknown/private document fields');
 await reject(()=>p.updateTournament(t.id,0,async x=>x),'async updater');
 let attempts=0;globalThis.retryTransaction=true;
 t=await p.updateTournament(t.id,0,x=>{attempts++;return {...x,title:'Retried'};});
 assert(attempts===2&&t.revision===1,'transaction retry commits one revision');
 t=await p.updateTournament(t.id,t.revision,current=>e.saveRoster(current,
 Array.from({length:64},(_,i)=>({id:'r'+i,playerId:i===0?'verified_owner':null,
 name:i===0?'Zoë "Ace" \\ 🎯':'Player '+i,tag:String(Math.floor(i/2)),
 paid:true,checkedIn:true,standby:false}))));
 const started=e.startTournament(t);
 t=await p.updateTournament(t.id,t.revision,()=>started);
 assert(t.teams.length===32&&t.registrations.length===64&&t.matches.length===63,'full32-team engine support');
 assert(typeof testDocs.get('blakeoutDevTournaments/test_t').matches==='string','packed wire format');
 assert(Array.isArray((await p.getTournament(t.id)).matches),'decoded API arrays');
 const publicWire=testDocs.get('blakeoutDevTournaments/test_t');
 assert(JSON.parse(publicWire.registrations).every(r=>!('paid' in r)&&!('checkedIn' in r)&&!('standby' in r)),'no private flags in public payload');
 const privateWire=structuredClone(testDocs.get('blakeoutDevRosterPrivate/test_t'));
 assert(privateWire.revision===t.revision&&JSON.parse(privateWire.registrations)[0].checkedIn,'atomic private roster revision and flags');
 assert((await p.getTournament(t.id)).registrations.every(r=>r.paid&&r.checkedIn),'owner get merges private flags');
 assert((await p.listTournaments())[0].registrations[0].checkedIn,'owner list merges private flags');
 changeTestUser({uid:'spectator',email:'spectator@example.com',emailVerified:true,isAnonymous:false});
 globalThis.testReadPaths=[];
 const spectator=await p.getTournament(t.id), spectatorList=await p.listTournaments();
 assert(spectator.registrations.every(r=>!r.paid&&!r.checkedIn&&!r.standby)&&!spectatorList[0].registrations[0].paid,'spectators receive redacted default flags');
 assert(!testReadPaths.some(path=>path.startsWith('blakeoutDevRosterPrivate/')),'spectator never requests owner-only metadata');
 await reject(()=>p.updateTournament(t.id,t.revision,()=>spectator),'spectator defaults cannot write');
 changeTestUser({uid:'verified_owner',email:'owner@example.com',emailVerified:true,isAnonymous:false});
 await reject(()=>p.updateTournament(t.id,t.revision,x=>({...x,registrations:x.registrations.map((r,i)=>i?r:{...r,playerId:'missing_profile'})})),'linked player requires existing verified profile read');
 testDocs.delete('blakeoutDevRosterPrivate/test_t');
 await reject(()=>p.getTournament(t.id),'owner read rejects missing private metadata');
 await reject(()=>p.updateTournament(t.id,t.revision,x=>x),'owner writes never use spectator defaults when metadata missing');
 testDocs.set('blakeoutDevRosterPrivate/test_t',privateWire);
 testDocs.set('blakeoutDevRosterPrivate/test_t',{...privateWire,revision:privateWire.revision-1});
 await reject(()=>p.updateTournament(t.id,t.revision,x=>x),'owner writes reject out-of-sync private revision');
 testDocs.set('blakeoutDevRosterPrivate/test_t',privateWire);
 await reject(()=>p.updateTournament(t.id,t.revision,x=>({...x,registrations:x.registrations.map((r,i)=>i?r:{...r,unknown:'no'})})),'unknown nested write schema');
 const goodWire=structuredClone(testDocs.get('blakeoutDevTournaments/test_t'));
 const badWire=structuredClone(goodWire), entries=JSON.parse(badWire.registrations);
 entries[0].unknown='no';badWire.registrations=JSON.stringify(entries);
 testDocs.set('blakeoutDevTournaments/test_t',badWire);
 await reject(()=>p.getTournament(t.id),'unknown nested read schema');
 testDocs.set('blakeoutDevTournaments/test_t',goodWire);
 await reject(()=>p.updateTournament(t.id,t.revision,x=>({...x,registrations:x.registrations.map((r,i)=>i?r:{...r,name:'🎯'.repeat(26000)})})),'UTF8 payload size bound');
 const match=t.matches.find(m=>m.status==='ready'&&[m.teamA,m.teamB].some(id=>t.teams.find(team=>team.id===id).memberIds.includes('r0')));
 const result={matchId:match.id,gameType:'501',participantIds:['verified_owner'],
 perPlayer:[{playerId:'verified_owner',gameType:'501',points:501,darts:21,marks:0}],
 legScores:[],winnerId:match.teamA,scoreA:2,scoreB:0,records:{id:'record',legs:[]}};
 const updater=current=>e.recordResult(current,match.id,result);
 await reject(()=>p.saveMatchResult(t.id,t.revision,'bad_guest',{...result,participantIds:['verified_owner',null]},updater),'guest participant rejected');
 await reject(()=>p.saveMatchResult(t.id,t.revision,'bad_counter',{...result,perPlayer:[{playerId:'unrelated'}]},updater),'unrelated stats rejected');
 assert(!testDocs.has('blakeoutDevResults/bad_guest')&&(await p.getTournament(t.id)).revision===t.revision,'failed save atomicity');
 globalThis.testOffline=true;
 await reject(()=>p.saveMatchResult(t.id,t.revision,'offline',result,updater),'offline save rejects rather than fake success');
 globalThis.testOffline=false;
 const next=await p.saveMatchResult(t.id,t.revision,'result_one',result,updater);
 assert(next.revision===t.revision+1&&testDocs.has('blakeoutDevResults/result_one'),'atomic tournament/result save');
 assert(typeof testDocs.get('blakeoutDevResults/result_one').perPlayer==='string','counter wire payload is canonical JSON');
 assert(Array.isArray((await p.listMyResults())[0].perPlayer),'result API decodes counter arrays');
 const immutable=JSON.stringify(testDocs.get('blakeoutDevResults/result_one'));
 const duplicate=await p.saveMatchResult(t.id,t.revision,'result_one',result,()=>{throw Error('Must not run');});
 assert(duplicate.revision===next.revision&&immutable===JSON.stringify(testDocs.get('blakeoutDevResults/result_one')),'immutable dedup before stale check');
 await reject(()=>p.saveMatchResult(t.id,next.revision,'result_two',result,updater),'new result ID cannot duplicate completed match');
 assert((await p.listMyResults()).length===1,'own results query');
 testDocs.set('blakeoutDevTournaments/other',{...goodWire,id:'other',ownerId:'other_owner'});
 await reject(()=>p.updateTournament('other',goodWire.revision,x=>x),'nonowner mutation rejected');
 await p.sendAccountLink('owner@example.com');
 assert(new URL(sentLink.settings.url).pathname==='/dev/accounts/'&&sentLink.settings.handleCodeInApp,'canonical email return URL');
 await p.signOutAccount();
 await reject(()=>p.listProfiles(),'signed-out profile lookup rejected');
 await reject(()=>p.listMyResults(),'signed-out result query rejected');
 changeTestUser({uid:'unverified',email:'unverified@example.com',emailVerified:false,isAnonymous:false});
 await reject(()=>p.listProfiles(),'entered unverified email never grants profile lookup');
 changeTestUser({uid:'anonymous',emailVerified:true,isAnonymous:true});
 await reject(()=>p.listProfiles(),'anonymous identity rejected');
 await p.signOutAccount();
 await reject(()=>p.signInAccount('owner@example.com','wrong-password'),'incorrect password rejected');
 await reject(()=>p.registerAccount('new@example.com','short'),'weak password rejected before SDK');
 const registered=await p.registerAccount('new@example.com','TestOnlyPassword123!');
 assert(registered.uid==='registered_user'&&!registered.emailVerified,'password registration creates unverified Firebase UID');
 assert(sentVerification.email==='new@example.com'&&new URL(sentVerification.settings.url).pathname==='/dev/accounts/','signup sends verification with canonical return URL');
 await reject(()=>p.saveProfile('New player'),'unverified password account cannot create public profile');
 await reject(()=>p.listProfiles(),'unverified password account cannot inspect profiles');
 assert(!document.querySelector('#accountControls').hidden&&document.querySelector('#profilePanel').hidden,'unverified signout visible while private UI locked');
 await p.sendAccountVerification();
 assert(sentVerification.count===2,'verification resend supported');
 await p.resetAccountPassword('new@example.com');
 assert(sentReset.email==='new@example.com','password reset supported');
 assert(!Object.values(localStorage).some(value=>value.includes('TestOnlyPassword123!')),'password never saved to localStorage');
 globalThis.mockVerified=true;
 await p.refreshAccount();
 assert(p.requireVerifiedAccount().uid==='registered_user'&&reloadCount>0,'reload verifies same UID and unlocks account');
 globalThis.mockVerified=false;
 await p.signOutAccount();
 await p.signInAccount('owner@example.com','TestOnlyPassword123!');
 assert(p.getAccount().uid==='verified_owner','password signin preserves existing verified UID');
 const worstIds=['counter_a1','counter_a2','counter_b1','counter_b2'];
 worstIds.forEach(id=>testDocs.set('blakeoutDevProfiles/'+id,{name:id}));
 let chicago=await p.createTournamentDocument(e.createTournament({id:'chicago_worst',ownerId:'verified_owner',title:'12 counters',date:'2026-09-07',gameType:'chicago',bestOf:3}));
 chicago=await p.updateTournament(chicago.id,0,current=>e.saveRoster(current,worstIds.map((id,i)=>({
 id:'chicago_r'+i,playerId:id,name:id,tag:i<2?'A':'B',paid:true,checkedIn:true,standby:false}))));
 const chicagoStarted=e.startTournament(chicago);
 chicago=await p.updateTournament(chicago.id,chicago.revision,()=>chicagoStarted);
 const worstMatch=chicago.matches.find(m=>m.status==='ready');
 const worstCounters=worstIds.flatMap(playerId=>['301','501','cricket'].map(gameType=>({playerId,gameType,points:501,darts:21,marks:3})));
 const worstResult={matchId:worstMatch.id,gameType:'chicago',participantIds:worstIds,
 perPlayer:worstCounters,legScores:[],winnerId:worstMatch.teamA,scoreA:2,scoreB:1};
 const worstUpdater=current=>e.recordResult(current,worstMatch.id,worstResult);
 for(const [value,label] of [[NaN,'NaN'],[Infinity,'Infinity'],[-1,'negative'],[1e12,'oversized']]){
 await reject(()=>p.saveMatchResult(chicago.id,chicago.revision,'bad_'+label,
 {...worstResult,perPlayer:[{...worstCounters[0],points:value}]},worstUpdater),'invalid '+label+' counters rejected');
 }
 await reject(()=>p.saveMatchResult(chicago.id,chicago.revision,'too_many',
 {...worstResult,perPlayer:[...worstCounters,worstCounters[0]]},worstUpdater),'13th counter rejected');
 const counterFixture={ownerId:'verified_owner',publicLive:structuredClone(testDocs.get('blakeoutDevTournaments/chicago_worst')),
 privateLive:structuredClone(testDocs.get('blakeoutDevRosterPrivate/chicago_worst')),
 signupStateLive:structuredClone(testDocs.get('blakeoutDevSignupState/chicago_worst'))};
 await p.saveMatchResult(chicago.id,chicago.revision,'chicago_worst_result',worstResult,worstUpdater);
 counterFixture.publicComplete=testDocs.get('blakeoutDevTournaments/chicago_worst');
 counterFixture.privateComplete=testDocs.get('blakeoutDevRosterPrivate/chicago_worst');
 counterFixture.signupStateComplete=testDocs.get('blakeoutDevSignupState/chicago_worst');
 counterFixture.result=testDocs.get('blakeoutDevResults/chicago_worst_result');
 assert(JSON.parse(counterFixture.result.perPlayer).length===12,'all4players times3Chicago games stored');
 changeTestUser({uid:'counter_a1',email:'counter-a1@example.com',emailVerified:true,isAnonymous:false});
 assert((await p.listMyResults())[0].perPlayer.length===12,'12-entry counter result decoded for participant');
 changeTestUser({uid:'verified_owner',email:'owner@example.com',emailVerified:true,isAnonymous:false});
 return {checks,wire:testDocs.get('blakeoutDevTournaments/test_t'),privateWire:testDocs.get('blakeoutDevRosterPrivate/test_t'),counterFixture};
}"""

NEW_FEATURE_TESTS = r"""async () => {
 const p=await import('/dev/js/platform.js'),e=await import('/dev/js/brackets/engine.js');
 const checks=[],assert=(v,m)=>{if(!v)throw Error(m);checks.push(m);};
 const reject=async(fn,m)=>{let error;try{await fn();}catch(e){error=e;}assert(!!error,m);};
 const login=uid=>changeTestUser({uid,email:uid+'@example.com',emailVerified:true,isAnonymous:false});
 login('verified_owner');
 let t=await p.createTournamentDocument(e.createTournament({id:'join_event',ownerId:'verified_owner',title:'Immediate join',date:'2026-09-07',gameType:'minnesota',bestOf:3}));
 const v1public=structuredClone(testDocs.get('blakeoutDevTournaments/join_event'));
 const v1private=structuredClone(testDocs.get('blakeoutDevRosterPrivate/join_event'));
 testDocs.delete('blakeoutDevSignupState/join_event');
 login('self_player');
 await reject(()=>p.joinTournament(t.id),'selfjoin requires own saved profile');
 await p.saveProfile('Self Player');
 globalThis.testReadPaths=[];
 const joined=await p.joinTournament(t.id);
 const firstJoinState=structuredClone(testDocs.get('blakeoutDevSignupState/join_event'));
 const firstSignup=structuredClone(testDocs.get('blakeoutDevSignups/join_event/players/self_player'));
 assert(joined.registrations.some(r=>r.playerId==='self_player')&&joined.revision===1,'immediate signup without organizer online');
 assert(!testReadPaths.some(path=>path.startsWith('blakeoutDevRosterPrivate/')),'selfjoin never reads private flags');
 assert(JSON.stringify(testDocs.get('blakeoutDevTournaments/join_event'))===JSON.stringify(v1public)&&JSON.stringify(testDocs.get('blakeoutDevRosterPrivate/join_event'))===JSON.stringify(v1private),'join cannot rewrite public bracket or private roster');
 assert((await p.joinTournament(t.id)).revision===1,'duplicate selfjoin is idempotent');
 login('spectator');
 const viewed=await p.getTournament(t.id);
 assert(viewed.registrations[0].name==='Self Player'&&!viewed.registrations[0].checkedIn,'self-registration public immediately; flags redacted');
 login('verified_owner');
 await reject(()=>p.updateTournament(t.id,0,current=>e.saveRoster(current,[])),'stale owner draft cannot discard signup');
 t=await p.getTournament(t.id);
 const guests=[['partner','A'],['other1','B'],['other2','B']].map(([id,tag])=>({id,tag,name:id,playerId:null,paid:false,checkedIn:true,standby:false}));
 t=await p.updateTournament(t.id,t.revision,current=>e.saveRoster(current,[{...current.registrations[0],tag:'A',paid:true,checkedIn:true},...guests]));
 const materialized={public:structuredClone(testDocs.get('blakeoutDevTournaments/join_event')),
 private:structuredClone(testDocs.get('blakeoutDevRosterPrivate/join_event')),
 state:structuredClone(testDocs.get('blakeoutDevSignupState/join_event'))};
 assert(t.registrations[0].paid&&testDocs.get('blakeoutDevRosterPrivate/join_event').revision===t.revision,'owner atomically materializes signup/private flags');
 globalThis.testReadPaths=[];
 await p.getTournament(t.id);
 login('spectator');await p.listTournaments();login('verified_owner');
 assert(!testReadPaths.some(path=>path.startsWith('blakeoutDevSignups/join_event/')),'materialized signup views avoid per-player rereads');
 t=await p.updateTournament(t.id,t.revision,current=>e.saveRoster(current,current.registrations.filter(r=>r.playerId!=='self_player')));
 assert(!testDocs.has('blakeoutDevSignups/join_event/players/self_player'),'owner removal deletes selfsignup atomically');
 login('self_player');
 const rejoined=await p.joinTournament(t.id);
 assert(rejoined.registrations.filter(r=>r.playerId==='self_player').length===1,'removed player can immediately rejoin');
 login('verified_owner');
 t=await p.getTournament(t.id);
 t=await p.updateTournament(t.id,t.revision,current=>e.saveRoster(current,current.registrations.map(r=>r.playerId==='self_player'?{...r,tag:'A',checkedIn:true}:r)));
 const beforeRace=t.revision;let transactions=0;
 globalThis.beforeTransaction=async()=>{
   if(++transactions!==1)return;
   globalThis.beforeTransaction=null;
   login('late_player');await p.saveProfile('Late Player');await p.joinTournament(t.id);login('verified_owner');
 };
 await reject(()=>p.updateTournament(t.id,beforeRace,current=>e.startTournament(current)),'concurrent signup prevents stale tournament start');
 globalThis.beforeTransaction=null;
 assert(testDocs.get('blakeoutDevTournaments/join_event').status==='registration','failed start preserves registration state');
 t=await p.getTournament(t.id);
 assert(t.registrations.some(r=>r.playerId==='late_player'),'racing signup retained');
 const ready=e.startTournament(t);
 t=await p.updateTournament(t.id,t.revision,()=>ready);
 assert(t.gameType==='minnesota'&&t.status==='live','Minnesota tournament persisted');
 const signupFixture={
   firstJoinState,firstSignup,materialized,
   publicRegistration:v1public,privateRegistration:v1private,
   publicLive:structuredClone(testDocs.get('blakeoutDevTournaments/join_event')),
   privateLive:structuredClone(testDocs.get('blakeoutDevRosterPrivate/join_event')),
   state:structuredClone(testDocs.get('blakeoutDevSignupState/join_event')),
   signups:[...testDocs].filter(([path])=>path.startsWith('blakeoutDevSignups/join_event/')).map(([path,data])=>({path,data}))
 };
 login('new_late');await p.saveProfile('Too Late');
 await reject(()=>p.joinTournament(t.id),'new signup forbidden after start');
 login('self_player');assert((await p.joinTournament(t.id)).status==='live','committed signup retry remains idempotent after start');
 login('verified_owner');
 const minnesotaMatch=t.matches.find(match=>match.status==='ready');
 const minnesotaResult={matchId:minnesotaMatch.id,gameType:'minnesota',participantIds:['self_player'],
 perPlayer:[{playerId:'self_player',gameType:'minnesota',points:0,darts:12,marks:8}],
 legScores:[],winnerId:minnesotaMatch.teamA,scoreA:2,scoreB:0};
 t=await p.saveMatchResult(t.id,t.revision,'minnesota-result',minnesotaResult,
 current=>e.recordResult(current,minnesotaMatch.id,minnesotaResult));
 assert(JSON.parse(testDocs.get('blakeoutDevResults/minnesota-result').perPlayer)[0].gameType==='minnesota','Minnesota tournament counters persist');
 signupFixture.minnesotaResult=testDocs.get('blakeoutDevResults/minnesota-result');
 signupFixture.publicComplete=testDocs.get('blakeoutDevTournaments/join_event');
 signupFixture.privateComplete=testDocs.get('blakeoutDevRosterPrivate/join_event');
 signupFixture.stateComplete=testDocs.get('blakeoutDevSignupState/join_event');
 const twoByThree=['verified_owner','casual_1','casual_2','casual_3','casual_4'];
 twoByThree.slice(1).forEach(uid=>testDocs.set('blakeoutDevProfiles/'+uid,{name:uid}));
 const casual={matchId:'casual-five',gameType:'minnesota',participantIds:twoByThree,
 perPlayer:twoByThree.map(playerId=>({playerId,gameType:'minnesota',points:0,darts:12,marks:8})),
 legScores:[],records:{id:'casual-five',legs:[]}};
 const pubBefore=JSON.stringify(testDocs.get('blakeoutDevTournaments/join_event'));
 globalThis.testOffline=true;
 await reject(()=>p.saveCasualResult('casual-five',casual),'offline casual save rejects visibly');
 globalThis.testOffline=false;
 await reject(()=>p.saveCasualResult('casual-guest',{...casual,participantIds:[...twoByThree,null]}),'casual guests excluded from attribution');
 await reject(()=>p.saveCasualResult('casual-missing',{...casual,participantIds:['missing_profile'],perPlayer:[]}),'casual participant profile must exist');
 const casualInput={...casual,source:'casual',winnerId:null,winnerIds:['side_0','side_1']};
 delete casualInput.matchId;
 const saved=await p.saveCasualResult('casual-five',casualInput);
 assert(saved.participantIds.length===5&&saved.perPlayer.length===5,'2v3 casual stats preserve all five humans');
 assert(saved.matchId==='casual-five'&&saved.winnerIds.length===2,'casual stable default match ID and tied side IDs preserved');
 assert(!('source' in testDocs.get('blakeoutDevCasualResults/casual-five')),'casual source derived from collection, not stored caller claim');
 await reject(()=>p.saveCasualResult('bad-source',{...casual,source:'tournament'}),'casual source cannot masquerade as tournament');
 await reject(()=>p.saveCasualResult('bad-winners',{...casual,winnerIds:['not a side ID']}),'casual tied winners require stable IDs');
 assert(saved.source==='casual'&&saved.provenance==='scorekeeper-recorded','casual source/provenance explicit');
 assert(JSON.stringify(testDocs.get('blakeoutDevTournaments/join_event'))===pubBefore,'casual save never touches tournament');
 const first=JSON.stringify(testDocs.get('blakeoutDevCasualResults/casual-five'));
 await p.saveCasualResult('casual-five',casual);
 assert(JSON.stringify(testDocs.get('blakeoutDevCasualResults/casual-five'))===first,'casual result ID immutable and idempotent');
 assert(twoByThree.every(uid=>testDocs.has('blakeoutDevCasualReceipts/casual-five$'+uid)),'verified participant receipts persisted');
 const mine=await p.listMyResults();
 assert(mine.some(r=>r.source==='casual')&&mine.some(r=>r.source==='tournament'),'records combine both sources');
 assert(mine.filter(r=>r.source==='casual'&&r.id==='casual-five').length===1,'playing scorekeeper history deduplicates owner and receipt');
 await p.saveCasualResult('casual-keeper',{...casual,matchId:'casual-keeper',
   participantIds:['casual_1'],perPlayer:casual.perPlayer.filter(row=>row.playerId==='casual_1')});
 const keeperRecord=(await p.listMyResults()).find(r=>r.id==='casual-keeper');
 assert(keeperRecord&&!keeperRecord.perPlayer.some(row=>row.playerId==='verified_owner'),'non-playing scorekeeper sees history without personal counters');
 const retryIds=Array.from({length:10},(_,i)=>'receipt_'+i);
 retryIds.forEach(uid=>testDocs.set('blakeoutDevProfiles/'+uid,{name:uid}));
 const retry={...casual,matchId:'receipt-retry',participantIds:retryIds,
 perPlayer:retryIds.map(playerId=>({playerId,gameType:'minnesota',points:0,darts:3,marks:1}))};
 globalThis.receiptBatches=0;globalThis.failReceiptBatchAt=2;
 await reject(()=>p.saveCasualResult('receipt-retry',retry),'interrupted receipt delivery reports retry required');
 const partial=[...testDocs.keys()].filter(path=>path.startsWith('blakeoutDevCasualReceipts/receipt-retry$')).length;
 assert(partial===7,'receipt transactions isolate rule budgets and settle in-flight delivery before error');
 const immutable=JSON.stringify(testDocs.get('blakeoutDevCasualResults/receipt-retry'));
 globalThis.failReceiptBatchAt=0;
 await p.saveCasualResult('receipt-retry',retry);
 assert(retryIds.every(uid=>testDocs.has('blakeoutDevCasualReceipts/receipt-retry$'+uid))&&JSON.stringify(testDocs.get('blakeoutDevCasualResults/receipt-retry'))===immutable,'retry completes missing receipts without rewriting score');
 const largeIds=Array.from({length:128},(_,i)=>'large_'+i);
 largeIds.forEach(uid=>testDocs.set('blakeoutDevProfiles/'+uid,{name:uid}));
 const large={...casual,matchId:'large-casual',participantIds:largeIds,
 perPlayer:largeIds.flatMap(playerId=>['minnesota','501','cricket'].map(gameType=>({playerId,gameType,points:1,darts:3,marks:1})))};
 const largeSaved=await p.saveCasualResult('large-casual',large);
 assert(largeSaved.participantIds.length===128&&largeSaved.perPlayer.length===384,'explicit casual capacity supports128 humans/384 counters');
 await reject(()=>p.saveCasualResult('too-large',{...large,participantIds:[...largeIds,'one_more']}),'129th casual participant gives explicit error, never truncates');
 return {checks,signupFixture,casualFive:testDocs.get('blakeoutDevCasualResults/casual-five'),
 casualWorst:testDocs.get('blakeoutDevCasualResults/large-casual')};
}"""

GUEST_TESTS = r"""async () => {
 const p=await import('/dev/js/platform.js'),e=await import('/dev/js/brackets/engine.js');
 const checks=[],assert=(v,m)=>{if(!v)throw Error(m);checks.push(m);};
 const reject=async(fn,m)=>{let error;try{await fn();}catch(e){error=e;}assert(!!error,m);};
 const owner=p.getAccount().uid, label=(await p.getProfile()).name;
 const beforeResults=(await p.listMyResults()).length;
 let t=await p.createTournamentDocument(e.createTournament({id:'guest_event',ownerId:owner,title:'Name-only selfjoin',date:'2026-09-07',gameType:'501',bestOf:3}));
 const fixture={ownerId:owner,publicRegistration:structuredClone(testDocs.get('blakeoutDevTournaments/guest_event')),
 privateRegistration:structuredClone(testDocs.get('blakeoutDevRosterPrivate/guest_event')),
 stateBefore:structuredClone(testDocs.get('blakeoutDevSignupState/guest_event'))};
 globalThis.testReadsByApp=[];
 const joined=await p.joinTournamentAsGuest(t.id,label);
 t=joined.tournament;
 assert(joined.registrationId==='guest-anonymous_guest'&&t.registrations.some(r=>r.id===joined.registrationId),'guest response identifies exact owned row without name matching');
 assert(p.getAccount().uid===owner&&p.requireVerifiedAccount().uid===owner,'guest join never replaces verified login');
 assert(globalThis.anonymousApp==='blakeout-dev-guests'&&testPersistence.value==='LOCAL','separate LOCAL anonymous guest app');
 assert(t.registrations.length===1&&t.registrations[0].playerId===null&&t.registrations[0].name===label,'same name as verified account remains a guest');
 assert(testReadsByApp.filter(read=>read.app==='blakeout-dev-guests').every(read=>!read.path.startsWith('blakeoutDevRosterPrivate/')&&!read.path.startsWith('blakeoutDevProfiles/')),'guest credentials never read profiles/private flags');
 assert(!testDocs.has('blakeoutDevProfiles/anonymous_guest'),'guest device never receives a lifetime profile');
 fixture.firstSignup=structuredClone(testDocs.get('blakeoutDevSignups/guest_event/players/anonymous_guest'));
 fixture.stateJoined=structuredClone(testDocs.get('blakeoutDevSignupState/guest_event'));
 assert(fixture.firstSignup.playerId===null&&fixture.firstSignup.registrationId==='guest-anonymous_guest','guest signup schema has null account identity');
 assert(JSON.stringify(testDocs.get('blakeoutDevTournaments/guest_event'))===JSON.stringify(fixture.publicRegistration)&&JSON.stringify(testDocs.get('blakeoutDevRosterPrivate/guest_event'))===JSON.stringify(fixture.privateRegistration),'guest join only writes narrow signup/index');
 assert((await p.joinTournamentAsGuest(t.id,label)).tournament.revision===t.revision,'guest duplicate idempotent');
 await reject(()=>p.joinTournamentAsGuest(t.id,'A different guest'),'shared-device second name rejected explicitly');
 await reject(()=>p.joinTournamentAsGuest(t.id,'owner@example.com'),'guest name never resolved from email');
 changeGuestTestUser({uid:'anonymous_guest_two',emailVerified:false,isAnonymous:true});
 t=(await p.joinTournamentAsGuest(t.id,label)).tournament;
 assert(t.registrations.length===2&&t.registrations.every(r=>r.playerId===null),'separate devices with identical names remain distinct guests');
 const extra=['guest_partner1','guest_partner2'].map(id=>({id,playerId:null,name:id,tag:'B',paid:false,checkedIn:true,standby:false}));
 t=await p.updateTournament(t.id,t.revision,current=>e.saveRoster(current,[...current.registrations.map(r=>({...r,tag:'A',checkedIn:true})),...extra]));
 t=await p.updateTournament(t.id,t.revision,current=>e.saveRoster(current,current.registrations.filter(r=>r.id!=='guest-anonymous_guest')));
 assert(!testDocs.has('blakeoutDevSignups/guest_event/players/anonymous_guest')&&testDocs.has('blakeoutDevSignups/guest_event/players/anonymous_guest_two'),'owner removes only targeted null-ID guest signup');
 changeGuestTestUser({uid:'anonymous_guest',emailVerified:false,isAnonymous:true});
 t=(await p.joinTournamentAsGuest(t.id,label)).tournament;
 assert(t.registrations.filter(r=>r.id==='guest-anonymous_guest').length===1,'removed guest can rejoin without approval');
 t=await p.updateTournament(t.id,t.revision,current=>e.saveRoster(current,current.registrations.map(r=>r.id==='guest-anonymous_guest'?{...r,tag:'A',checkedIn:true}:r)));
 const started=e.startTournament(t);
 t=await p.updateTournament(t.id,t.revision,()=>started);
 assert((await p.joinTournamentAsGuest(t.id,label)).tournament.status==='live','committed guest signup retries after start');
 changeGuestTestUser({uid:'anonymous_guest_three',emailVerified:false,isAnonymous:true});
 await reject(()=>p.joinTournamentAsGuest(t.id,'Too late'),'new guest blocked after registration closes');
 const match=t.matches.find(m=>m.status==='ready');
 const result={matchId:match.id,gameType:'501',winnerId:match.teamA,scoreA:2,scoreB:0,participantIds:[],perPlayer:[],legScores:[]};
 await p.saveMatchResult(t.id,t.revision,'all-guest-result',result,current=>e.recordResult(current,match.id,result));
 assert((await p.listMyResults()).length===beforeResults&&testDocs.get('blakeoutDevResults/all-guest-result').participantIds.length===0,'name-only guests never increase account lifetime records');
 assert(p.getAccount().uid===owner,'verified login still intact after full guest lifecycle');
 const noAccountEvent=await p.createTournamentDocument(e.createTournament({id:'guest_no_account',ownerId:owner,title:'No account needed',date:'2026-09-07',gameType:'501',bestOf:3}));
 await p.signOutAccount();
 const noAccountJoin=await p.joinTournamentAsGuest(noAccountEvent.id,'Name only');
 assert(p.getAccount()===null&&noAccountJoin.tournament.registrations[0].playerId===null,'guest joins without a verified account or login');
 await reject(()=>p.listMyResults(),'anonymous guest session never grants lifetime account access');
 await p.signInAccount('owner@example.com','TestOnlyPassword123!');
 return {checks,fixture};
}"""

RULE_FIXTURES = r"""() => {
 const clone=value=>JSON.parse(JSON.stringify(value));
 const transactions=globalThis.ruleTransactions;
 const principal=(uid,guest=false)=>uid===null?null:{uid,token:guest
   ?{firebase:{sign_in_provider:'anonymous'}}
   :{email_verified:true,firebase:{sign_in_provider:'password'}}};
 const data=(tx,path)=>tx.after.get(path)||tx.before.get(path);
 const pick=(predicate)=>{const tx=transactions.find(predicate);if(!tx)throw Error('Missing fixture transaction');return tx;};
 const wrote=(tx,path)=>tx.writes.some(([p])=>p===path);
 const hasAfter=(tx,path,revision)=>wrote(tx,path)&&tx.after.get(path)?.revision===revision;
 const cases=[];
 function context(tx){
   const paths=new Set(tx.writes.map(([path])=>path));
   const tournaments=new Set(),casuals=new Set(),profiles=new Set();
   if(tx.auth?.uid)profiles.add(tx.auth.uid);
   for(const [path,value] of tx.writes){
     const [collection,id]=path.split('/');
     if(['blakeoutDevTournaments','blakeoutDevRosterPrivate','blakeoutDevSignupState','blakeoutDevSignups'].includes(collection))tournaments.add(id);
     if(collection==='blakeoutDevSignups')profiles.add(path.split('/').at(-1));
     if(collection==='blakeoutDevResults'){
       const result=value||tx.before.get(path);
       tournaments.add(result.tournamentId);
       result.participantIds.forEach(uid=>profiles.add(uid));
     }
     if(collection==='blakeoutDevCasualResults')casuals.add(id);
     if(collection==='blakeoutDevCasualReceipts'){
       const receipt=value||tx.before.get(path);
       casuals.add(receipt.resultId);profiles.add(receipt.playerId);
     }
   }
   for(const id of tournaments){
     for(const collection of ['blakeoutDevTournaments','blakeoutDevRosterPrivate','blakeoutDevSignupState'])paths.add(collection+'/'+id);
     const statePath='blakeoutDevSignupState/'+id;
     const members=new Set([...(tx.before.get(statePath)?.members||[]),...(tx.after.get(statePath)?.members||[])]);
     if(tx.auth?.uid)members.add(tx.auth.uid);
     for(const uid of members){
       const path=`blakeoutDevSignups/${id}/players/${uid}`;paths.add(path);
       const signup=data(tx,path);if(signup?.playerId)profiles.add(signup.playerId);
     }
   }
   for(const id of casuals){
     paths.add('blakeoutDevCasualResults/'+id);
     if(tx.auth?.uid)paths.add(`blakeoutDevCasualReceipts/${id}$${tx.auth.uid}`);
   }
   for(const uid of profiles)paths.add('blakeoutDevProfiles/'+uid);
   const before={},after={};
   for(const path of [...paths].sort()){
     before[path]=clone(tx.before.get(path)??null);
     after[path]=clone(tx.after.get(path)??null);
   }
   return {documentsBefore:before,documentsAfter:after};
 }
 function add(id,tx,expected=true,deniedPaths=[],notes=''){
   const denied=new Set(deniedPaths);
   const scenario={id,kind:'atomic-write',expectedTransactionAllow:expected,
     databaseApp:tx.appName,auth:clone(tx.auth),clientAccountUid:tx.clientAccountUid??null,
     notes,...context(tx),writes:tx.writes.map(([path,value])=>({
       path,method:value===null?'delete':tx.before.has(path)?'update':'create',
       resourceBefore:clone(tx.before.get(path)??null),resourceAfter:clone(value),
       expectedAllow:expected||!denied.has(path)
     }))};
   cases.push(scenario);return scenario;
 }
 function fork(tx,auth=tx.auth,writes=tx.writes){
   const next={...tx,auth,before:new Map(tx.before),after:new Map(tx.before),writes:clone(writes)};
   for(const [path,value] of next.writes)value===null?next.after.delete(path):next.after.set(path,value);
   return next;
 }
 function readCase(id,world,path,auth,expected,notes=''){
   const tx={before:world,after:world,auth,writes:[[path,world.get(path)]],appName:'read-simulation'};
   cases.push({id,kind:'read',method:'get',path,auth:clone(auth),expectedAllow:expected,
     resource:clone(world.get(path)??null),notes,...context(tx)});
 }
 const pub='blakeoutDevTournaments/join_event',priv='blakeoutDevRosterPrivate/join_event',state='blakeoutDevSignupState/join_event';
 const signup='blakeoutDevSignups/join_event/players/self_player';
 const create=pick(tx=>wrote(tx,'blakeoutDevTournaments/test_t')&&!tx.before.has('blakeoutDevTournaments/test_t'));
 add('tournament-create-public-private-index',create);
 const join=pick(tx=>tx.auth?.uid==='self_player'&&wrote(tx,signup)&&tx.after.get(signup)?.joinRevision===1);
 add('verified-selfjoin-v1-bootstrap',join,true,[],'Before index is absent: explicit deployed-v1 bootstrap. Organizer need not be online.');
 const materialize=pick(tx=>hasAfter(tx,pub,2));
 add('owner-materializes-new-registration',materialize);
 const remove=pick(tx=>wrote(tx,signup)&&tx.writes.some(([p,v])=>p===signup&&v===null));
 add('owner-removes-verified-signup',remove);
 const rejoin=pick(tx=>wrote(tx,signup)&&tx.after.get(signup)?.joinRevision===4);
 add('verified-player-rejoins-without-approval',rejoin);
 const late=pick(tx=>wrote(tx,'blakeoutDevSignups/join_event/players/late_player'));
 add('concurrent-player-arrives-before-start',late);
 const start=pick(tx=>wrote(tx,pub)&&tx.before.get(pub)?.status==='registration'&&tx.after.get(pub)?.status==='live');
 add('owner-start-preserves-new-arrival',start);
 const staleWrites=start.writes.map(([path,value])=>{
   const next=clone(value);next.revision=late.after.get(state).revision;
   if(path===state)next.members=next.members.filter(uid=>uid!=='late_player');
   if(path===pub||path===priv)next.registrations=JSON.stringify(JSON.parse(next.registrations).filter(r=>r.id!=='self-late_player'));
   return [path,next];
 });
 add('stale-start-cannot-drop-arrival',fork(start,start.auth,staleWrites),false,staleWrites.map(([path])=>path),
   'All candidate revisions predate the shared signup revision; no owner draft may discard the arrival.');
 const lateUid='new_late',latePath=`blakeoutDevSignups/join_event/players/${lateUid}`;
 const closedBefore=start.after,closedRevision=closedBefore.get(state).revision+1;
 const closed={appName:'constructed',auth:principal(lateUid),before:new Map(closedBefore),after:new Map(closedBefore),
   writes:[[latePath,{playerId:lateUid,registrationId:'self-'+lateUid,name:'Too Late',joinRevision:closedRevision}],
     [state,{...clone(closedBefore.get(state)),revision:closedRevision,lastJoiner:lateUid,members:[...closedBefore.get(state).members,lateUid]}]]};
 closed.before.set('blakeoutDevProfiles/'+lateUid,{name:'Too Late'});
 closed.after=new Map(closed.before);closed.writes.forEach(([path,value])=>closed.after.set(path,value));
 add('new-verified-join-after-start-denied',closed,false,closed.writes.map(([path])=>path));
 const score=pick(tx=>wrote(tx,'blakeoutDevResults/minnesota-result'));
 add('minnesota-result-public-private-index-atomic',score);
 const unpaired=fork(score,score.auth,score.writes.filter(([path])=>path==='blakeoutDevResults/minnesota-result'));
 add('unpaired-tournament-result-denied',unpaired,false,unpaired.writes.map(([path])=>path));
 const chicago=pick(tx=>wrote(tx,'blakeoutDevResults/chicago_worst_result'));
 add('chicago-four-player-twelve-counter-budget',chicago);
 const thirtyTwoStart=pick(tx=>wrote(tx,'blakeoutDevTournaments/test_t')&&tx.before.get('blakeoutDevTournaments/test_t')?.status==='registration'
   &&tx.after.get('blakeoutDevTournaments/test_t')?.status==='live');
 add('thirty-two-team-start-budget',thirtyTwoStart);
 add('thirty-two-team-sixty-three-match-score-budget',pick(tx=>wrote(tx,'blakeoutDevResults/result_one')));
 const guestPub='blakeoutDevTournaments/guest_event',guestPrivate='blakeoutDevRosterPrivate/guest_event',guestState='blakeoutDevSignupState/guest_event';
 const guestPath='blakeoutDevSignups/guest_event/players/anonymous_guest';
 const guestJoin=pick(tx=>tx.auth?.uid==='anonymous_guest'&&wrote(tx,guestPath)&&tx.after.get(guestPath)?.joinRevision===1);
 add('anonymous-guest-joins-while-main-login-preserved',guestJoin,true,[],
   'Request auth is anonymous_guest on the dedicated guest app; clientAccountUid remains verified_owner. playerId is null.');
 add('anonymous-guest-no-account-needed',pick(tx=>tx.auth?.uid==='anonymous_guest_three'
   &&wrote(tx,'blakeoutDevSignups/guest_no_account/players/anonymous_guest_three')));
 add('second-device-same-name-is-distinct-guest',pick(tx=>tx.auth?.uid==='anonymous_guest_two'
   &&wrote(tx,'blakeoutDevSignups/guest_event/players/anonymous_guest_two')));
 const noAuth=fork(guestJoin,null);
 add('guest-without-device-auth-denied',noAuth,false,noAuth.writes.map(([path])=>path));
 const guestClaim=fork(guestJoin);
 const claimed=clone(guestClaim.after.get(guestPath));claimed.playerId='verified_owner';
 guestClaim.writes=guestClaim.writes.map(([path,value])=>[path,path===guestPath?claimed:value]);
 guestClaim.after.set(guestPath,claimed);
 add('guest-cannot-claim-verified-player-id',guestClaim,false,[guestPath],
   'The child write must fail. Its companion index check may pass in isolation; the atomic transaction still fails.');
 const extraFlags=fork(guestJoin);
 const flagged={...clone(extraFlags.after.get(guestPath)),paid:true,checkedIn:true};
 extraFlags.writes=extraFlags.writes.map(([path,value])=>[path,path===guestPath?flagged:value]);
 extraFlags.after.set(guestPath,flagged);
 add('guest-cannot-submit-private-flags',extraFlags,false,[guestPath]);
 const verifiedGuest=fork(guestJoin,principal('anonymous_guest'));
 add('verified-token-cannot-create-guest-kind',verifiedGuest,false,[guestPath],
   'Guest mode must use the independent anonymous token, not replace/reuse the verified login.');
 const guestMaterialize=pick(tx=>hasAfter(tx,guestPub,3));
 add('owner-materializes-multiple-null-id-guests',guestMaterialize);
 for(const [id,auth] of [['guest',principal('anonymous_guest',true)],['verified-nonowner',principal('self_player')]]){
   const forbidden=fork(guestMaterialize,auth);
   add(id+'-cannot-write-bracket-or-private-flags',forbidden,false,forbidden.writes.map(([path])=>path));
   readCase(id+'-cannot-read-owner-flags',guestMaterialize.after,guestPrivate,auth,false);
 }
 const guestRemove=pick(tx=>wrote(tx,guestPath)&&tx.writes.some(([path,value])=>path===guestPath&&value===null));
 add('owner-removes-exact-null-id-guest-only',guestRemove);
 add('removed-guest-rejoins-immediately',pick(tx=>wrote(tx,guestPath)&&tx.after.get(guestPath)?.joinRevision===5));
 const guestStart=pick(tx=>wrote(tx,guestPub)&&tx.before.get(guestPub)?.status==='registration'&&tx.after.get(guestPub)?.status==='live');
 add('owner-start-with-guests',guestStart);
 const guestLateUid='anonymous_after_start',guestLatePath=`blakeoutDevSignups/guest_event/players/${guestLateUid}`;
 const guestLateRevision=guestStart.after.get(guestState).revision+1;
 const guestLate={appName:'constructed-guest',auth:principal(guestLateUid,true),before:new Map(guestStart.after),after:new Map(guestStart.after),
   writes:[[guestLatePath,{playerId:null,registrationId:'guest-'+guestLateUid,name:'Too late guest',joinRevision:guestLateRevision}],
     [guestState,{...clone(guestStart.after.get(guestState)),revision:guestLateRevision,lastJoiner:guestLateUid,
       members:[...guestStart.after.get(guestState).members,guestLateUid]}]]};
 guestLate.writes.forEach(([path,value])=>guestLate.after.set(path,value));
 add('new-guest-after-start-denied',guestLate,false,guestLate.writes.map(([path])=>path));
 const allGuestScore=pick(tx=>wrote(tx,'blakeoutDevResults/all-guest-result'));
 add('all-guest-result-has-no-lifetime-participants',allGuestScore);
 readCase('guest-cannot-read-private-match-statistics',allGuestScore.after,'blakeoutDevResults/all-guest-result',principal('anonymous_guest',true),false);
 const five=pick(tx=>wrote(tx,'blakeoutDevCasualResults/casual-five'));
 add('casual-five-humans-with-tied-winner-ids',five);
 const max=pick(tx=>wrote(tx,'blakeoutDevCasualResults/large-casual'));
 add('casual-128-humans-384-counters-budget',max);
 const receiptTransactions=transactions.filter(tx=>tx.writes.some(([path])=>path.startsWith('blakeoutDevCasualReceipts/large-casual$'))).slice(0,8);
 if(receiptTransactions.length!==8||receiptTransactions.some(tx=>tx.writes.length!==1))throw Error('Receipt concurrency fixture is not eight small transactions');
 const receiptIds=[];
 receiptTransactions.forEach((tx,i)=>{const id='casual-receipt-wave-'+(i+1);receiptIds.push(id);add(id,tx);});
 const receipt=receiptTransactions[0],receiptPath=receipt.writes[0][0],receiptUid=receipt.after.get(receiptPath).playerId;
 const missingProfile=fork(receipt);missingProfile.before.delete('blakeoutDevProfiles/'+receiptUid);missingProfile.after.delete('blakeoutDevProfiles/'+receiptUid);
 add('casual-receipt-without-verified-profile-denied',missingProfile,false,[receiptPath]);
 const casualPath='blakeoutDevCasualResults/large-casual';
 readCase('casual-participant-before-receipt-denied',receipt.before,casualPath,principal(receiptUid),false);
 readCase('casual-participant-after-receipt-allowed',receipt.after,casualPath,principal(receiptUid),true);
 readCase('casual-scorekeeper-private-read-allowed',receipt.after,casualPath,principal('verified_owner'),true);
 readCase('casual-unrelated-verified-read-denied',receipt.after,casualPath,principal('unrelated_reader'),false);
 readCase('casual-anonymous-read-denied',receipt.after,casualPath,principal('anonymous_guest',true),false);
 readCase('casual-unverified-read-denied',receipt.after,casualPath,
   {uid:receiptUid,token:{email_verified:false,firebase:{sign_in_provider:'password'}}},false);
 const master=max.after.get(casualPath),counters=JSON.parse(master.perPlayer);
 const invalidMasters=[
   ['385-counters',{...clone(master),perPlayer:JSON.stringify([...counters,counters[0]])}],
   ['unrelated-counter-uid',{...clone(master),perPlayer:JSON.stringify([{...counters[0],playerId:'unrelated_reader'}])}],
   ['negative-counter',{...clone(master),perPlayer:JSON.stringify([{...counters[0],points:-1}])}],
   ['129-participants',{...clone(master),participantIds:[...master.participantIds,'extra_participant']}],
   ['numeric-participant',{...clone(master),participantIds:[123],perPlayer:'[]'}],
   ['regex-injection-uid',{...clone(master),participantIds:['large_0|.*'],perPlayer:'[]'}]
 ];
 for(const [label,value] of invalidMasters)add('casual-'+label+'-denied',fork(max,max.auth,[[casualPath,value]]),false,[casualPath]);
 const overwrite={...max,before:new Map(max.after),after:new Map(max.after),writes:[[casualPath,{...clone(master),createdAt:master.createdAt+1}]]};
 overwrite.after.set(casualPath,overwrite.writes[0][1]);
 add('casual-master-update-denied-even-to-scorekeeper',overwrite,false,[casualPath]);
 return {
   format:'blakeout-dev-rules-scenarios-v1',generatedAt:new Date().toISOString(),liveFirebaseWrites:false,
   instructions:[
     'Document paths omit /databases/(default)/documents/. Prefix them when invoking the rules simulator.',
     'For each atomic-write scenario evaluate every write using the SAME documentsBefore/documentsAfter; AND decisions must equal expectedTransactionAllow.',
     'Use writes[].expectedAllow for individual decisions. Some invalid-child transactions deliberately have an allowed index check but a denied child write.',
     'exists/get use documentsBefore; existsAfter/getAfter use documentsAfter. Missing paths and explicit null are absent documents. Do not return a public tournament for every lookup.',
     'Anonymous auth tokens deliberately omit email_verified. databaseApp/clientAccountUid demonstrate separation from verified main login.',
     'Receipt wave is eight concurrent ONE-WRITE transactions, NOT an eight-write atomic batch. This isolates both rule-expression and document-lookup budgets.',
     'All data and identities are synthetic, captured from mocked-SDK execution. Actual Google compiler/simulator validation remains required.'
   ],
   receiptWave:{concurrency:8,atomicBatch:false,scenarioIds:receiptIds},scenarios:cases
 };
}"""


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


def grammar_checks(wire, private_wire):
    """Exercise the exact checked-in grammar strings, not copies of the regexes."""
    rules = (ROOT / "firestore.rules").read_text()
    count = 0
    for function, field in [
        ("devRegistrationPayload", "registrations"),
        ("devTeamPayload", "teams"), ("devMatchPayload", "matches"),
        ("devPrivateRosterPayload", "privateRegistrations")
    ]:
        body = rules.split(f"function {function}(", 1)[1].split("\n    }", 1)[0]
        values = {}

        def expression(source):
            def visit(node):
                if isinstance(node, ast.Constant) and isinstance(node.value, str):
                    return node.value
                if isinstance(node, ast.Name):
                    return values[node.id]
                if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
                    return visit(node.left) + visit(node.right)
                raise AssertionError(f"Unexpected grammar expression: {source}")
            return visit(ast.parse(" ".join(source.splitlines()).strip(), mode="eval").body)

        for name, value in re.findall(r"let (\w+) = (.*?);", body, flags=re.S):
            values[name] = expression(value)
        pattern = expression(re.search(r"return value.matches\((.*?)\);", body, flags=re.S)[1])
        regex = re.compile(pattern)
        packed = private_wire["registrations"] if field == "privateRegistrations" else wire[field]
        assert regex.fullmatch(packed), f"{field}: actual Unicode32-team payload rejected"
        entries = json.loads(packed)
        entries[0]["unknown"] = "no"
        assert not regex.fullmatch(json.dumps(entries, ensure_ascii=False, separators=(",", ":")))
        del entries[0]["unknown"]
        string_field = "name" if field in {"registrations", "teams"} else "id"
        for label in ['Zoë 🎯 東京', 'Ace "Quoted"', r"Back\slash", "line\nbreak", r"literal\u0040"]:
            entries[0][string_field] = label
            assert regex.fullmatch(json.dumps(entries, ensure_ascii=False, separators=(",", ":"))), label
            count += 1
        entries[0][string_field] = "secret@example.com"
        email = json.dumps(entries, ensure_ascii=False, separators=(",", ":"))
        assert not regex.fullmatch(email)
        assert not regex.fullmatch(email.replace("@", r"\u0040")), "escaped email bypass"
        assert not regex.fullmatch("not-json"), "invalid JSON accepted"
        entries[0][string_field] = "line\nbreak"
        escaped = json.dumps(entries, ensure_ascii=False, separators=(",", ":"))
        assert not regex.fullmatch(escaped.replace(r"\n", "\n")), "unescaped JSON control character accepted"
        if field == "registrations":
            entries[0]["paid"] = True
            assert not regex.fullmatch(json.dumps(entries, ensure_ascii=False, separators=(",", ":"))), "private flag allowed in public schema"
        count += 6
    print(f"PASS packed schema grammar ({count} checks; Python regex, not emulator)")

def result_grammar_checks(result):
    rules = (ROOT / "firestore.rules").read_text()
    body = rules.split("function devResultCounters(", 1)[1].split("\n    }", 1)[0]
    values = {"players": "|".join(result["participantIds"])}

    def expression(source):
        def visit(node):
            if isinstance(node, ast.Constant) and isinstance(node.value, str):
                return node.value
            if isinstance(node, ast.Name):
                return values[node.id]
            if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
                return visit(node.left) + visit(node.right)
            raise AssertionError(f"Unexpected counter grammar expression: {source}")
        return visit(ast.parse(" ".join(source.splitlines()).strip(), mode="eval").body)

    for name, value in re.findall(r"let (\w+) = (.*?);", body, flags=re.S):
        if name != "players":
            values[name] = expression(value)
    regex = re.compile(expression(re.search(r"value.matches\((.*?)\)\)\);", body, flags=re.S)[1]))
    assert regex.fullmatch(result["perPlayer"]), "12-entry Chicago counter fixture rejected"
    entries = json.loads(result["perPlayer"])
    pack = lambda data: json.dumps(data, separators=(",", ":"))
    assert len(entries) == 12 and len(set(entry["playerId"] for entry in entries)) == 4
    assert not regex.fullmatch(pack(entries + [entries[0]])), "13 counters accepted"
    for changes in [{"playerId": "unrelated"}, {"gameType": "unknown"}, {"unknown": True},
                    {"points": -1}, {"darts": 1.5}, {"marks": None}, {"points": 1000000000000}]:
        assert not regex.fullmatch(pack([{**entries[0], **changes}])), changes
    for value in [0, 0.5, 0.0000012345678901234567, 1.23456789e-200, 5e-324, 999999999999]:
        assert regex.fullmatch(pack([{**entries[0], "points": value, "marks": value}])), value
    assert not regex.fullmatch(result["perPlayer"].replace('"counter_a1"', '"counter_\\u00611"')), "escaped UID accepted"
    print("PASS result counter grammar (12-entry Chicago, membership, bounds, decimals, unknown fields)")

def casual_grammar_checks(result):
    body = (ROOT / "firestore.rules").read_text().split("function devCasualCounters(", 1)[1].split("\n    }", 1)[0]
    values = {}

    def expression(source):
        def visit(node):
            if isinstance(node, ast.Constant) and isinstance(node.value, str):
                return node.value
            if isinstance(node, ast.Name):
                return values[node.id]
            if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
                return visit(node.left) + visit(node.right)
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "join":
                assert isinstance(node.func.value, ast.Name) and node.func.value.id == "ids"
                return visit(node.args[0]).join(result["participantIds"])
            raise AssertionError(f"Unexpected casual grammar expression: {source}")
        return visit(ast.parse(" ".join(source.splitlines()).strip(), mode="eval").body)

    for name, value in re.findall(r"let (\w+) = (.*?);", body, flags=re.S):
        values[name] = expression(value)
    regex = re.compile(expression(re.search(r"value.matches\((.*?)\)\s*&&", body, flags=re.S)[1]))
    limit = int(re.search(r"value.split\(.*?\).size\(\) <= (\d+)", body)[1])
    accepts = lambda payload: regex.fullmatch(payload) and len(re.split(r"\},\{", payload)) <= limit
    assert len(result["participantIds"]) == 128 and len(json.loads(result["perPlayer"])) == 384
    assert accepts(result["perPlayer"]), "maximum casual counter payload rejected"
    counters = json.loads(result["perPlayer"])
    for payload in [[*counters, counters[0]], [{**counters[0], "playerId": "unrelated"}],
                    [{**counters[0], "marks": -1}], [{**counters[0], "email": "no@example.com"}],
                    [{**counters[0], "gameType": "unknown"}]]:
        assert not accepts(json.dumps(payload, separators=(",", ":"))), "invalid casual counters accepted"
    print("PASS casual counter grammar (128 participants/384 counters, no truncation, UID membership)")


def emulator_checks(wire, private_wire):
    host = os.environ.get("FIRESTORE_EMULATOR_HOST")
    if not host:
        print("SKIP Firestore emulator: FIRESTORE_EMULATOR_HOST unset; rules not deployed/compiled")
        return
    if host.split(":")[0] not in {"localhost", "127.0.0.1"}:
        raise RuntimeError("Tests only allow a localhost Firestore emulator, never a live project.")
    project = f"demo-blakeout-platform-{os.getpid()}"
    base = f"http://{host}"

    def request(method, path, data=None, user=None):
        headers = {"Content-Type": "application/json"}
        if user:
            anonymous = user.startswith("anonymous_")
            encode = lambda value: base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=")
            claims = {"sub": user, "user_id": user, "aud": project, "iss": f"https://securetoken.google.com/{project}",
                      "email_verified": not anonymous and user != "unverified",
                      "firebase": {"sign_in_provider": "anonymous" if anonymous else "password"}, "iat": 0, "exp": 4102444800}
            if not anonymous:
                claims["email"] = f"{user}@example.com"
            headers["Authorization"] = f"Bearer {encode({'alg': 'none', 'typ': 'JWT'})}.{encode(claims)}."
        req = urllib.request.Request(base + path, data=None if data is None else json.dumps(data).encode(),
                                     headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=15) as response:
                return response.status, response.read().decode()
        except urllib.error.HTTPError as error:
            return error.code, error.read().decode()

    def fields(value):
        if value is None:
            return {"nullValue": None}
        if isinstance(value, bool):
            return {"booleanValue": value}
        if isinstance(value, int):
            return {"integerValue": str(value)}
        if isinstance(value, str):
            return {"stringValue": value}
        if isinstance(value, list):
            return {"arrayValue": {"values": [fields(item) for item in value]}}
        return {"mapValue": {"fields": {key: fields(item) for key, item in value.items()}}}

    def put(path, data, user="verified_owner"):
        return request("PATCH", f"/v1/projects/{project}/databases/(default)/documents/{path}",
                       {"fields": {key: fields(item) for key, item in data.items()}}, user)

    prefix = f"projects/{project}/databases/(default)/documents/"

    def commit(documents, user="verified_owner"):
        writes = [{"delete": prefix + path} if data is None else
                  {"update": {"name": prefix + path, "fields": {key: fields(value) for key, value in data.items()}}}
                  for path, data in documents]
        return request("POST", f"/v1/projects/{project}/databases/(default)/documents:commit",
                       {"writes": writes}, user)

    code, text = request("PUT", f"/emulator/v1/projects/{project}:securityRules",
                         {"rules": {"files": [{"name": "firestore.rules", "content": (ROOT / "firestore.rules").read_text()}]}})
    assert code == 200, f"Rules compilation failed: {code} {text}"
    assert put("blakeoutDevProfiles/verified_owner", {"name": 'Zoë "Ace" \\ 🎯'})[0] == 200
    assert put("blakeoutDevProfiles/other", {"name": "Imposter"})[0] == 403
    assert put("blakeoutDevProfiles/unverified", {"name": "Unverified"}, "unverified")[0] == 403
    assert put("blakeoutDevProfiles/verified_owner", {"name": "Owner", "email": "private@example.com"})[0] == 403
    document = {**wire, "id": "emulator", "revision": 0, "status": "registration", "gameType": "chicago"}
    metadata = {**private_wire, "tournamentId": "emulator", "revision": 0}
    assert put("blakeoutDevTournaments/emulator", document)[0] == 403, "unpaired public creation"
    code, text = commit([("blakeoutDevTournaments/emulator", document), ("blakeoutDevRosterPrivate/emulator", metadata)])
    assert code == 200, f"Atomic tournament/private roster creation denied: {code} {text}"
    assert request("GET", f"/v1/projects/{project}/databases/(default)/documents/blakeoutDevTournaments/emulator")[0] == 200
    private_path = f"/v1/{prefix}blakeoutDevRosterPrivate/emulator"
    assert request("GET", private_path, user="verified_owner")[0] == 200
    for user in ["other", "unverified", None]:
        assert request("GET", private_path, user=user)[0] == 403, "private roster disclosed"
    assert put("blakeoutDevTournaments/emulator", {**document, "revision": 1}, "other")[0] == 403
    assert put("blakeoutDevTournaments/emulator", {**document, "revision": 1})[0] == 403, "unpaired public update"
    assert put("blakeoutDevRosterPrivate/emulator", {**metadata, "revision": 1})[0] == 403, "unpaired private update"
    assert put("blakeoutDevTournaments/emulator", {**document, "revision": 2})[0] == 403
    invalid = json.loads(document["registrations"])
    invalid[0]["name"] = "secret@example.com"
    invalid_flags = json.loads(document["registrations"])
    invalid_flags[0]["paid"] = True
    for payload in [json.dumps(invalid, separators=(",", ":")),
                    json.dumps(invalid, separators=(",", ":")).replace("@", r"\u0040"),
                    json.dumps(invalid_flags, separators=(",", ":"))]:
        assert commit([("blakeoutDevTournaments/emulator", {**document, "revision": 1, "registrations": payload}),
                       ("blakeoutDevRosterPrivate/emulator", {**metadata, "revision": 1})])[0] == 403
    assert put("blakeoutDevUnknown/doc", {"name": "Unknown schema"})[0] == 403
    participants = ["verified_owner", "verified_participant", "counter_third", "counter_fourth"]
    for participant in participants[1:]:
        assert put(f"blakeoutDevProfiles/{participant}", {"name": participant}, participant)[0] == 200
    result = {"ownerId": "verified_owner", "tournamentId": "emulator",
              "participantIds": participants,
              "perPlayer": json.dumps([{"playerId": player, "gameType": game, "points": 501, "darts": 21, "marks": 0}
                                      for player in participants for game in ["301", "501", "cricket"]], separators=(",", ":")),
              "gameType": "chicago", "matchId": "W1.1", "legScores": [], "createdAt": 1788792400000}
    assert put("blakeoutDevResults/result", result)[0] == 403, "result must be accompanied by tournament revision"
    code, text = commit([("blakeoutDevTournaments/emulator", {**document, "revision": 1}),
                         ("blakeoutDevRosterPrivate/emulator", {**metadata, "revision": 1}),
                         ("blakeoutDevResults/result", result)])
    assert code == 200, f"Atomic result denied: {code} {text}"
    result_path = f"/v1/{prefix}blakeoutDevResults/result"
    for user, expected in [("verified_owner", 200), ("verified_participant", 200),
                           ("unrelated", 403), ("unverified", 403), (None, 403)]:
        assert request("GET", result_path, user=user)[0] == expected, user
    assert put("blakeoutDevResults/result", result)[0] == 403, "immutable result update"
    assert request("DELETE", result_path, user="verified_owner")[0] == 403, "immutable result deletion"
    signup_path = "blakeoutDevSignups/emulator/players/verified_participant"
    signup = {"playerId": "verified_participant", "registrationId": "self-verified_participant",
              "name": "verified_participant", "joinRevision": 2}
    signup_state = {"tournamentId": "emulator", "revision": 2, "lastJoiner": "verified_participant",
                    "members": ["verified_participant"]}
    assert put(signup_path, signup, "verified_participant")[0] == 403, "unpaired signup"
    code, text = commit([(signup_path, signup), ("blakeoutDevSignupState/emulator", signup_state)], "verified_participant")
    assert code == 200, f"Immediate v1 selfjoin failed: {code} {text}"
    assert request("GET", f"/v1/{prefix}{signup_path}")[0] == 200, "signup not public"
    assert put("blakeoutDevRosterPrivate/emulator", {**metadata, "revision": 3}, "verified_participant")[0] == 403
    assert commit([("blakeoutDevTournaments/emulator", {**document, "revision": 2}),
                   ("blakeoutDevRosterPrivate/emulator", {**metadata, "revision": 2})])[0] == 403, "stale owner omitted signup"
    materialized = {**document, "revision": 3}
    private_materialized = {**metadata, "revision": 3}
    regs = json.loads(document["registrations"])
    regs.append({"id": signup["registrationId"], "playerId": signup["playerId"], "name": signup["name"], "tag": ""})
    materialized["registrations"] = json.dumps(regs, separators=(",", ":"), ensure_ascii=False)
    private_regs = json.loads(metadata["registrations"])
    private_regs.append({"id": signup["registrationId"], "paid": False, "checkedIn": False, "standby": False})
    private_materialized["registrations"] = json.dumps(private_regs, separators=(",", ":"))
    code, text = commit([("blakeoutDevTournaments/emulator", materialized),
                         ("blakeoutDevRosterPrivate/emulator", private_materialized),
                         ("blakeoutDevSignupState/emulator", {**signup_state, "revision": 3, "lastJoiner": None})])
    assert code == 200, f"Owner materialization failed: {code} {text}"
    code, text = commit([("blakeoutDevTournaments/emulator", {**document, "revision": 4, "status": "live"}),
                         ("blakeoutDevRosterPrivate/emulator", {**metadata, "revision": 4}),
                         ("blakeoutDevSignupState/emulator", {**signup_state, "revision": 4, "lastJoiner": None, "members": []}),
                         (signup_path, None)])
    assert code == 200, f"Owner signup removal/start failed: {code} {text}"
    assert commit([(signup_path, {**signup, "joinRevision": 5}),
                   ("blakeoutDevSignupState/emulator", {**signup_state, "revision": 5})], "verified_participant")[0] == 403, "closed signup accepted"
    casual_ids = ["verified_owner"] + [f"wide_{i}" for i in range(127)]
    casual = {"ownerId": "verified_owner", "participantIds": casual_ids, "gameType": "minnesota",
              "matchId": "casual-max", "legScores": [], "createdAt": 1788792400000,
              "perPlayer": json.dumps([{"playerId": uid, "gameType": game, "points": 0, "darts": 3, "marks": 1}
                                      for uid in casual_ids for game in ["minnesota", "501", "cricket"]], separators=(",", ":"))}
    code, text = put("blakeoutDevCasualResults/casual-max", casual)
    assert code == 200, f"Maximum casual result failed: {code} {text}"
    for label, invalid in [
        ("numeric-id", {**casual, "participantIds": [123], "perPlayer": "[]"}),
        ("regex-id", {**casual, "participantIds": [".*"], "perPlayer": "[]"}),
        ("over-capacity", {**casual, "participantIds": casual_ids + ["too_many"]}),
        ("unrelated-counter", {**casual, "perPlayer": json.dumps([{"playerId": "unrelated", "gameType": "minnesota", "points": 0, "darts": 3, "marks": 1}], separators=(",", ":"))}),
    ]:
        assert put(f"blakeoutDevCasualResults/invalid-{label}", invalid)[0] == 403, label
    receipt = {"resultId": "casual-max", "playerId": "wide_0", "ownerId": "verified_owner"}
    assert put("blakeoutDevCasualReceipts/casual-max$wide_0", receipt)[0] == 403, "receipt for missing verified profile"
    assert put("blakeoutDevProfiles/wide_0", {"name": "Wide zero"}, "wide_0")[0] == 200
    assert request("GET", f"/v1/{prefix}blakeoutDevCasualResults/casual-max", user="wide_0")[0] == 403, "receipt-less reader"
    assert put("blakeoutDevCasualReceipts/casual-max$wide_0", receipt)[0] == 200
    assert request("GET", f"/v1/{prefix}blakeoutDevCasualResults/casual-max", user="wide_0")[0] == 200
    assert put("blakeoutDevCasualResults/casual-max", casual)[0] == 403, "mutable casual result"
    assert request("GET", f"/v1/{prefix}blakeoutDevCasualResults/casual-max")[0] == 403, "public casual result"
    guest_public = {**document, "id": "guest-event", "revision": 0, "matches": "[]"}
    guest_private = {**metadata, "tournamentId": "guest-event", "revision": 0}
    guest_state = {"tournamentId": "guest-event", "revision": 0, "lastJoiner": None, "members": []}
    code, text = commit([("blakeoutDevTournaments/guest-event", guest_public),
                         ("blakeoutDevRosterPrivate/guest-event", guest_private),
                         ("blakeoutDevSignupState/guest-event", guest_state)])
    assert code == 200, text
    guest_signup = {"playerId": None, "registrationId": "guest-anonymous_guest", "name": "Name-only guest", "joinRevision": 1}
    joined_state = {**guest_state, "revision": 1, "lastJoiner": "anonymous_guest", "members": ["anonymous_guest"]}
    guest_path = "blakeoutDevSignups/guest-event/players/anonymous_guest"
    code, text = commit([(guest_path, guest_signup), ("blakeoutDevSignupState/guest-event", joined_state)], "anonymous_guest")
    assert code == 200, f"Anonymous guest selfjoin failed: {code} {text}"
    assert request("GET", f"/v1/{prefix}{guest_path}")[0] == 200
    assert request("GET", f"/v1/{prefix}blakeoutDevRosterPrivate/guest-event", user="anonymous_guest")[0] == 403
    assert put("blakeoutDevProfiles/anonymous_guest", {"name": "No lifetime profile"}, "anonymous_guest")[0] == 403
    assert put(guest_path, {**guest_signup, "name": "Changed"}, "anonymous_guest")[0] == 403
    assert put("blakeoutDevRosterPrivate/guest-event", {**guest_private, "revision": 2}, "anonymous_guest")[0] == 403
    assert put("blakeoutDevCasualResults/guest-stat", {**casual, "ownerId": "anonymous_guest"}, "anonymous_guest")[0] == 403
    spoof = {**guest_signup, "playerId": "verified_owner", "registrationId": "self-anonymous_impostor", "joinRevision": 2}
    assert commit([("blakeoutDevSignups/guest-event/players/anonymous_impostor", spoof),
                   ("blakeoutDevSignupState/guest-event", {**joined_state, "revision": 2, "lastJoiner": "anonymous_impostor",
                                                         "members": ["anonymous_guest", "anonymous_impostor"]})],
                  "anonymous_impostor")[0] == 403, "guest attached a verified UID"
    code, text = commit([("blakeoutDevTournaments/guest-event", {**guest_public, "revision": 2}),
                         ("blakeoutDevRosterPrivate/guest-event", {**guest_private, "revision": 2}),
                         ("blakeoutDevSignupState/guest-event", {**guest_state, "revision": 2}),
                         (guest_path, None)])
    assert code == 200, f"Owner guest removal failed: {code} {text}"
    code, text = commit([(guest_path, {**guest_signup, "joinRevision": 3}),
                         ("blakeoutDevSignupState/guest-event", {**joined_state, "revision": 3})], "anonymous_guest")
    assert code == 200, f"Guest rejoin failed: {code} {text}"
    print("PASS actual Firestore emulator compilation/access/privacy checks")


async def run():
    RUNTIME.mkdir(exist_ok=True)
    os.environ["TMPDIR"] = str(RUNTIME)
    import tempfile
    tempfile.tempdir = str(RUNTIME)
    from playwright.async_api import async_playwright
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(QuietHandler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(executable_path=shutil.which("google-chrome"), headless=True,
                                               args=["--no-sandbox", "--disable-dev-shm-usage"])
            context = await browser.new_context(service_workers="block", accept_downloads=True)
            if "--save-rules-fixtures" in sys.argv:
                await context.add_init_script("globalThis.captureRules=true")

            async def route(request):
                url = request.request.url
                modules = {"firebase-app.js": APP, "firebase-auth.js": AUTH, "firebase-firestore.js": STORE}
                filename = url.rsplit("/", 1)[-1]
                if filename in modules:
                    await request.fulfill(content_type="text/javascript", body=modules[filename])
                elif filename == "account-email-config.js":
                    await request.fulfill(content_type="text/javascript",
                                          body="export const ACCOUNT_EMAIL_SERVICE_URL='';")
                elif url.startswith(base):
                    await request.continue_()
                else:
                    await request.abort()
            await context.route("**/*", route)
            page = await context.new_page()
            await page.goto(base + "/dev/accounts/")
            output = await page.evaluate(API_TESTS)
            print(f"PASS platform APIs ({len(output['checks'])} assertions)")
            features = await page.evaluate(NEW_FEATURE_TESTS)
            print(f"PASS self-registration/casual/Minnesota APIs ({len(features['checks'])} assertions)")
            guests = await page.evaluate(GUEST_TESTS)
            print(f"PASS anonymous guest self-registration ({len(guests['checks'])} assertions)")
            if "--save-rules-fixtures" in sys.argv:
                scenarios = await page.evaluate(RULE_FIXTURES)
                scenarios["rulesPath"] = "firestore.rules"
                scenarios["rulesSha256"] = hashlib.sha256((ROOT / "firestore.rules").read_bytes()).hexdigest()
                destination = ROOT / "dev/tests/platform_rules_fixtures.json"
                destination.write_text(json.dumps(scenarios, ensure_ascii=False, indent=2) + "\n")
                print(f"SAVED {len(scenarios['scenarios'])} rules scenarios: {destination}")
            grammar_checks(output["wire"], output["privateWire"])
            result_grammar_checks(output["counterFixture"]["result"])
            casual_grammar_checks(features["casualWorst"])
            if "--print-simulator-fixture" in sys.argv:
                print("SIMULATOR_FIXTURE=" + json.dumps(output["counterFixture"], ensure_ascii=False, separators=(",", ":")))
                print("FEATURE_FIXTURE=" + json.dumps(features, ensure_ascii=False, separators=(",", ":")))
                print("GUEST_FIXTURE=" + json.dumps(guests["fixture"], ensure_ascii=False, separators=(",", ":")))
            await page.locator("#refreshRecords").click()
            await page.wait_for_function("document.querySelector('#lifetimeSummary').textContent.includes('23.86 PPD')")
            await page.wait_for_function("document.querySelector('#lifetimeSummary').textContent.includes('2.00 MPR')")
            assert "scorekeeper-recorded" in await page.locator("#records").inner_text()
            assert "organizer-recorded" in await page.locator("#records").inner_text()
            async with page.expect_download() as download_event:
                await page.locator("#exportRecords").click()
            download = await download_event.value
            export = RUNTIME / "records.json"
            await download.save_as(export)
            data = json.loads(export.read_text())
            assert data["playerId"] == "verified_owner" and len(data["results"]) == 5
            assert {"casual-five", "casual-keeper", "receipt-retry", "large-casual"} <= {
                record["id"] for record in data["results"] if record["source"] == "casual"
            }
            assert {record["source"] for record in data["results"]} == {"tournament", "casual"}
            await page.set_viewport_size({"width": 390, "height": 844})
            assert await page.evaluate("document.documentElement.scrollWidth <= 390")
            assert await page.locator('nav a[href="../brackets/"]').count() == 1
            other = await context.new_page()
            await other.goto(base + "/dev/accounts/")
            await other.locator("#signOut").click()
            await page.wait_for_function("document.querySelector('#profilePanel').hidden")
            await page.goto(base + "/dev/accounts/?oobCode=mock-link")
            await page.locator("#linkEmail").fill("owner@example.com")
            await page.locator("#completeLink").click()
            await page.wait_for_function("document.querySelector('#profilePanel').hidden === false")
            assert "oobCode" not in page.url
            await page.evaluate("globalThis.denyReads=true")
            await page.locator("#refreshRecords").click()
            await page.wait_for_function("document.querySelector('#accountStatus').textContent.includes('permission-denied')")
            print("PASS account UI (records/export, mobile, route, shared signout, email completion, permission errors)")
            await page.evaluate("globalThis.denyReads=false")
            await page.locator("#signOut").click()
            await page.locator("#accountEmail").fill("new@example.com")
            await page.locator("#accountPassword").fill("BrowserTestPassword123!")
            await page.locator("#passwordRegister").click()
            await page.wait_for_function("document.querySelector('#verificationPanel').hidden === false")
            await page.wait_for_function("document.querySelector('#accountPassword').value === ''")
            assert await page.locator("#signOut").is_visible()
            assert await page.locator("#profilePanel").is_hidden()
            await page.evaluate("globalThis.authFailure='auth/too-many-requests'")
            await page.locator("#sendVerification").click()
            await page.wait_for_function("document.querySelector('#accountStatus').textContent.includes('auth/too-many-requests')")
            await page.evaluate("globalThis.authFailure=null;globalThis.mockVerified=true;dispatchEvent(new Event('focus'))")
            await page.wait_for_function("document.querySelector('#profilePanel').hidden === false")
            assert await page.evaluate("!Object.values(localStorage).some(value=>value.includes('BrowserTestPassword123!'))")
            await page.locator("#signOut").click()
            await page.locator("#passwordReset").click()
            await page.wait_for_function("globalThis.sentReset?.email === 'new@example.com'")
            await page.locator("#accountEmail").fill("owner@example.com")
            await page.locator("#accountPassword").fill("wrong-password")
            await page.locator("#passwordSignIn").click()
            await page.wait_for_function("document.querySelector('#accountStatus').textContent.includes('auth/invalid-credential')")
            assert await page.locator("#profilePanel").is_hidden()
            await page.locator("#accountPassword").fill("BrowserTestPassword123!")
            await page.locator("#passwordSignIn").click()
            await page.wait_for_function("document.querySelector('#profilePanel').hidden === false")
            print("PASS password UI (register, verification gate, unverified signout, quota errors, return reload, reset, sign-in)")
            await context.route("**/firebase-config.js", lambda request: request.abort())
            await page.reload()
            await page.wait_for_function("document.querySelector('#accountStatus').getAttribute('role') === 'alert'")
            assert await page.locator("#sendLink").is_disabled()
            assert await page.locator("#passwordSignIn").is_disabled()
            print("PASS missing Firebase config visibly surfaced")
            await context.close()
            email_context = await browser.new_context(service_workers="block")
            email_calls = []
            email_response = {"status": 200, "body": {"status": "sent"}}

            async def email_route(route):
                url = route.request.url
                filename = url.rsplit("/", 1)[-1]
                modules = {"firebase-app.js": APP, "firebase-auth.js": AUTH, "firebase-firestore.js": STORE}
                if filename in modules:
                    await route.fulfill(content_type="text/javascript", body=modules[filename])
                elif filename == "account-email-config.js":
                    await route.fulfill(content_type="text/javascript", body=(
                        "export const ACCOUNT_EMAIL_SERVICE_URL="
                        "'https://blakeout-email-dev.dartsblakeout.workers.dev';"))
                elif url.startswith("https://blakeout-email-dev.dartsblakeout.workers.dev/"):
                    if route.request.method == "OPTIONS":
                        await route.fulfill(status=204, headers={
                            "Access-Control-Allow-Origin": base,
                            "Access-Control-Allow-Methods": "POST",
                            "Access-Control-Allow-Headers": "authorization,content-type"})
                    else:
                        email_calls.append({"url": url, "body": route.request.post_data_json,
                                            "headers": route.request.headers})
                        await route.fulfill(status=email_response["status"],
                                            content_type="application/json",
                                            headers={"Access-Control-Allow-Origin": base,
                                                     "Access-Control-Expose-Headers": "Retry-After",
                                                     "Retry-After": "60"},
                                            body=email_response.get("raw", json.dumps(email_response["body"])))
                elif url.startswith(base):
                    await route.continue_()
                else:
                    await route.abort()

            await email_context.route("**/*", email_route)
            email_page = await email_context.new_page()
            await email_page.goto(base + "/dev/accounts/")
            await email_page.wait_for_function("typeof changeTestUser === 'function'")
            await email_page.evaluate("""async () => {
                const p = await import('/dev/js/platform.js');
                await p.initPlatform();
                changeTestUser(null);
                await p.registerAccount('new@example.com', 'PrivateTestPassword123!');
            }""")
            assert len(email_calls) == 1
            assert email_calls[-1]["url"].endswith("/verify-email")
            assert email_calls[-1]["body"] == {}
            assert email_calls[-1]["headers"].get("authorization") == "Bearer verified"
            assert not await email_page.evaluate("!!globalThis.sentVerification"), "No duplicate Firebase email"
            email_response.update(status=429, body={"error": {
                "code": "email/rate-limited", "message": "Private upstream details must not display"}})
            await email_page.locator("#sendVerification").click()
            await email_page.wait_for_function(
                "document.querySelector('#accountStatus').textContent.includes('email/rate-limited')")
            assert "Private upstream" not in await email_page.locator("#accountStatus").inner_text()
            assert "Wait at least 1 minute(s)" in await email_page.locator("#accountStatus").inner_text()
            assert "may take longer" in await email_page.locator("#accountStatus").inner_text()
            assert await email_page.locator("#sendVerification").is_enabled()
            email_response.update(status=200, body={"status": "accepted"})
            await email_page.evaluate("""async () => {
                const p = await import('/dev/js/platform.js');
                await p.signOutAccount();
                await p.resetAccountPassword(' person@example.com ');
            }""")
            assert email_calls[-1]["url"].endswith("/reset-password")
            assert email_calls[-1]["body"] == {"email": "person@example.com"}
            assert "authorization" not in email_calls[-1]["headers"]
            assert not await email_page.evaluate("!!globalThis.sentReset")
            for response_status, body in [(200, {}), (503, {"error": {"code": "unknown", "message": "secret"}})]:
                email_response.update(status=response_status, body=body)
                error = await email_page.evaluate("""async () => {
                    try { await (await import('/dev/js/platform.js')).resetAccountPassword('person@example.com'); }
                    catch (error) { return error.message; }
                }""")
                assert error and "secret" not in error
            for response_status in [200, 502]:
                email_response.update(status=response_status, raw="private-provider-text is not JSON")
                error = await email_page.evaluate("""async () => {
                    try { await (await import('/dev/js/platform.js')).resetAccountPassword('person@example.com'); }
                    catch (error) { return error.message; }
                }""")
                assert error == "The email service returned an invalid response. Please try again later."
                del email_response["raw"]
            count_before = len(email_calls)
            await email_page.evaluate("""async () => {
                const p = await import('/dev/js/platform.js');
                changeTestUser({uid:'switching',email:'one@example.com',emailVerified:false,isAnonymous:false});
                p.getAccount().getIdToken = async () => { changeTestUser(null); return 'old-token'; };
                try { await p.sendAccountVerification(); throw new Error('Unexpected success'); }
                catch (error) { if (!error.message.includes('account changed')) throw error; }
            }""")
            assert len(email_calls) == count_before, "Account switch must not send old token"
            print("PASS branded email transport (registration/resend/reset, no duplicate sends, errors, account switch)")
            await email_context.close()
            await browser.close()
            emulator_checks(output["wire"], output["privateWire"])
    finally:
        server.shutdown()
        server.server_close()
        shutil.rmtree(RUNTIME, ignore_errors=True)


if __name__ == "__main__":
    asyncio.run(run())
