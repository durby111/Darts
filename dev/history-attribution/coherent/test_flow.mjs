// Real adapter and bracket engine, in-memory SDK transport. NOT rules enforcement.
import test from 'node:test';import assert from 'node:assert/strict';
import {historyAdapter,casualInput} from './adapter.mjs';
import * as engine from '../../js/brackets/engine.js';import {template,project} from '../../tournament-device/model.mjs';
const timestamp=n=>({__time:n,toMillis(){return this.__time;}});
function copy(v){if(v?.__time!==undefined)return timestamp(v.__time);if(Array.isArray(v))return v.map(copy);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,copy(x)]));return v;}
function fixture(){
 const docs=new Map(),app={options:{projectId:'demo-blakeout-adapter-task3'}},db={app};let clock=Date.now()+100,readHook=null;
 const sdk={doc:(_,...p)=>p.join('/'),collection:(_,...p)=>p.join('/'),serverTimestamp:()=>({__server:true}),Timestamp:{fromMillis:timestamp},FieldPath:class{constructor(...p){this.parts=p;}},documentId:()=> '__id',where:(field,op,value)=>({filter:{field,op,value}}),orderBy:field=>({sort:field}),limit:n=>({limit:n}),startAfter:s=>({cursor:s.id}),query:(path,...constraints)=>({path,constraints}),
 runTransaction:async(_db,fn)=>{const pending=[];const result=await fn({get:async path=>{const s=snap(path);if(readHook){const hook=readHook;readHook=null;hook();}return s;},set:(p,v)=>pending.push([p,v]),update:(p,v)=>pending.push([p,{...docs.get(p),...v}])});clock+=10;for(const [p,v]of pending)docs.set(p,resolve(v));return result;},
 getDocsFromServer:async q=>{
 let rows=[...docs.keys()].filter(p=>p.startsWith(q.path+'/')&&p.slice(q.path.length+1).indexOf('/')===-1).map(snap);
 const val=(s,f)=>f==='__id'?s.id:(f.parts||[f]).reduce((a,k)=>a?.[k],s.data());const scalar=x=>x?.toMillis?x.toMillis():x;
 for(const x of q.constraints)if(x.filter){const {field,op,value}=x.filter;rows=rows.filter(r=>{const a=scalar(val(r,field)),b=scalar(value);return op==='array-contains'?a?.includes(b):op==='=='?a===b:op==='>'?a>b:a<b;});}
 const sorts=q.constraints.filter(x=>x.sort).map(x=>x.sort);rows.sort((a,b)=>{for(const f of sorts){const av=scalar(val(a,f)),bv=scalar(val(b,f));if(av!==bv)return av<bv?-1:1;}return 0;});
 const cursor=q.constraints.find(x=>x.cursor)?.cursor;if(cursor)rows=rows.slice(rows.findIndex(s=>s.id===cursor)+1);
 return {docs:rows.slice(0,q.constraints.find(x=>x.limit)?.limit||50)};
 }};
 function resolve(x){if(x?.__server)return timestamp(clock);if(x?.__time!==undefined)return copy(x);if(Array.isArray(x))return x.map(resolve);if(x&&typeof x==='object')return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,resolve(v)]));return x;}
 function snap(path){return {id:path.split('/').at(-1),exists:()=>docs.has(path),data:()=>copy(docs.get(path))};}
 const session=(uid,verified=true)=>{const auth={app,currentUser:{uid,emailVerified:verified,isAnonymous:false}};return {auth,api:historyAdapter({db,auth,sdk})};};
 return {docs,session,clock:()=>clock,onRead:hook=>{readHook=hook;}};
}
async function casual(gameType='501'){const f=fixture();f.docs.set('qrGames/q',{board:'board',active:true});for(const [uid,seat]of [['a','1'],['b','2']])f.docs.set('qrGames/q/grants/'+seat,{uid,handle:'i'+seat,expires:timestamp(Date.now()+100000)});
 const board=f.session('board'),a=f.session('a'),b=f.session('b');await board.api.createContext({id:'g_q',kind:'casual',sourceId:'q',gameType});
 const confirm=async(who,uid,seat)=>who.api.confirm({displayed:await who.api.consentDetails({contextId:'g_q',registrationId:'r'+uid,seatId:seat,invitationId:'i'+seat}),contextId:'g_q',bindingId:'bind'+uid,grantId:'grant'+uid,registrationId:'r'+uid,seatId:seat,invitationId:'i'+seat,displayedUid:uid,acknowledged:true,expiresAt:Date.now()+100000});
 await confirm(a,'a','1');await confirm(b,'b','2');return {...f,board,a,b};}
const input=()=>casualInput({gameType:'501',winnerId:'side1',perPlayer:[{playerId:'a',gameType:'501',points:501,darts:15,marks:0},{playerId:'b',gameType:'501',points:450,darts:15,marks:0}]});
test('casual producer -> phone consent -> result -> discovery -> owner materialization, then revoke/correct/undo',async()=>{
 const f=await casual();const req={contextId:'g_q',operationId:'first',matchId:'q',expectedRevision:0,input:input(),bindings:{a:'binda',b:'bindb'}};
 const first=await f.board.api.submit(req);assert.equal(first.occurrenceId,'first');assert.equal((await f.board.api.submit(req)).replayed,true);
 assert.equal((await f.a.api.grants()).grants[0].id,'granta');
 const found=await f.a.api.discover('granta');assert.equal(found.occurrences.length,1);
 const ops=await f.a.api.operations('g_q','first');assert.equal(ops.operations.length,1);
 await f.a.api.materialize({contextId:'g_q',occurrenceId:'first',operationId:'first',grantId:'granta'});
 assert.equal(f.docs.get('hcOwners/a/contexts/g_q/history/first').counter.playerId,'a');assert(!f.docs.has('hcOwners/b/contexts/g_q/history/first'));
 await f.a.api.revoke('granta');const revised=input();revised.perPlayer.a.points=400;
 await f.board.api.submit({...req,operationId:'corrected',expectedRevision:1,input:revised});
 await f.a.api.materialize({contextId:'g_q',occurrenceId:'first',operationId:'corrected',grantId:'granta'});
 assert.equal(f.docs.get('hcOwners/a/contexts/g_q/history/first').counter.points,400);
 await f.board.api.submit({...req,operationId:'undo',expectedRevision:2,input:{operation:'undo'}});
 await f.a.api.materialize({contextId:'g_q',occurrenceId:'first',operationId:'undo',grantId:'granta'});
 assert.equal((await f.a.api.materialize({contextId:'g_q',occurrenceId:'first',operationId:'first',grantId:'granta'})).replayed,true);
 assert.equal(f.docs.get('hcOwners/a/contexts/g_q/history/first').status,'undone');
 assert.equal((await f.a.api.sync('granta')).processed,3);
 const fresh=await f.board.api.submit({...req,operationId:'replacement',expectedRevision:3});assert.equal(fresh.occurrenceId,'replacement');
 await assert.rejects(f.a.api.materialize({contextId:'g_q',occurrenceId:'replacement',operationId:'replacement',grantId:'granta'}),/No original consent/);
});
test('forged phone identity, absent acknowledgement, stale result, post-result grant and cross-owner materialization fail',async()=>{
 const f=await casual();await assert.rejects(f.a.api.confirm({displayedUid:'b',acknowledged:true}),/confirmation/);
 await assert.rejects(f.a.api.confirm({displayedUid:'a',acknowledged:false}),/confirmation/);
 const req={contextId:'g_q',operationId:'first',matchId:'q',expectedRevision:0,input:input(),bindings:{a:'binda',b:'bindb'}};await f.board.api.submit(req);
 await assert.rejects(f.board.api.submit({...req,operationId:'stale'}),/Stale/);
 await assert.rejects(f.board.api.submit({...req,input:{...input(),winnerId:'changed'}}),/conflict/);
 await assert.rejects(f.b.api.materialize({contextId:'g_q',occurrenceId:'first',operationId:'first',grantId:'granta'}),/Missing/);
 await f.a.api.confirm({displayed:await f.a.api.consentDetails({contextId:'g_q',registrationId:'ra',seatId:'1',invitationId:'i1'}),contextId:'g_q',bindingId:'binda',grantId:'late',registrationId:'ra',seatId:'1',invitationId:'i1',displayedUid:'a',acknowledged:true,expiresAt:Date.now()+100000});
 await assert.rejects(f.a.api.materialize({contextId:'g_q',occurrenceId:'first',operationId:'first',grantId:'late'}),/No original consent/);
});
test('guest game needs no history identity, no owner history created by result commit',async()=>{
 const f=await casual();await f.board.api.submit({contextId:'g_q',operationId:'guest',matchId:'q',expectedRevision:0,input:{winnerId:null,perPlayer:{}},bindings:{}});
 assert.equal((await f.a.api.discover('granta')).occurrences.length,0);assert.equal([...f.docs.keys()].filter(k=>k.includes('/history/')).length,0);
});
test('actual bracket downstream undo then upstream correction creates new occurrence for replacement teams',async()=>{
 const f=fixture();let t=engine.createTournament({id:'e',ownerId:'owner',title:'Test',date:'2026-10-18',gameType:'501',bestOf:1});t=engine.saveRoster(t,Array.from({length:8},(_,i)=>({id:'r'+i,playerId:i===0?'a':null,name:'P'+i,tag:String(Math.floor(i/2)+1),paid:true,checkedIn:true,standby:false})));t=engine.startTournament(t);const event=template(t,'board');f.docs.set('tdEvents/e',event);
 const owner=f.session('owner'),board=f.session('board'),a=f.session('a');await owner.api.createContext({id:'t_e',kind:'tournament',sourceId:'e'});
 await a.api.confirm({displayed:await a.api.consentDetails({contextId:'t_e',registrationId:'r0'}),contextId:'t_e',bindingId:'ba',grantId:'ga',registrationId:'r0',displayedUid:'a',acknowledged:true,expiresAt:Date.now()+100000});
 let serial=0;const play=async(matchId,side='A')=>{const head=f.docs.get('hcContexts/t_e/state/current'),m=project(event,head).matches.find(m=>m.id===matchId);return board.api.submit({contextId:'t_e',operationId:'op'+(++serial),matchId,expectedRevision:head.revision,input:{winnerId:m['team'+side],scoreA:side==='A'?1:0,scoreB:side==='B'?1:0,forfeit:false},bindings:{a:'ba'}});};
 await play('W1.1');await play('W1.2');const first=await play('W2.1');
 await assert.rejects(play('W1.1','B'),/dependent/);
 let head=f.docs.get('hcContexts/t_e/state/current');await board.api.submit({contextId:'t_e',operationId:'undo',matchId:'W2.1',expectedRevision:head.revision,input:{operation:'undo'}});
 await play('W1.1','B');const next=await play('W2.1');assert.notEqual(first.occurrenceId,next.occurrenceId);
 assert.notDeepEqual(f.docs.get('hcContexts/t_e/occurrences/'+first.occurrenceId).registrations,f.docs.get('hcContexts/t_e/occurrences/'+next.occurrenceId).registrations);
});

test('expiry, account switch and closed context fail without writing private state',async()=>{
 const f=await casual(),req={contextId:'g_q',operationId:'first',matchId:'q',expectedRevision:0,input:input()};await f.board.api.submit(req);
 const grant=f.docs.get('hcOwners/a/grants/granta');grant.expires=timestamp(0);
 await assert.rejects(f.a.api.materialize({contextId:'g_q',occurrenceId:'first',operationId:'first',grantId:'granta'}),/No original consent/);
 f.a.auth.currentUser={uid:'a',emailVerified:false,isAnonymous:false};await assert.rejects(f.a.api.grants(),/Verified/);
 await f.board.api.end('g_q');await assert.rejects(f.board.api.submit({...req,operationId:'next',expectedRevision:1}),/active writer/);
 assert(!f.docs.has('hcOwners/a/contexts/g_q/history/first'));
});

test('Cricket counters retained, wrong seat identity rejected, private writes remain owner-directed',async()=>{
 const f=await casual('cricket');
 await assert.rejects(f.a.api.confirm({contextId:'g_q',bindingId:'forged',grantId:'forged',registrationId:'ra',seatId:'2',invitationId:'i2',displayedUid:'a',acknowledged:true,expiresAt:Date.now()+100000}),/seat claim/);
 const result=casualInput({gameType:'cricket',winnerId:'side1',perPlayer:[{playerId:'a',gameType:'cricket',points:0,darts:12,marks:18}]});
 await f.board.api.submit({contextId:'g_q',operationId:'cricket',matchId:'q',expectedRevision:0,input:result});
 await f.a.api.sync('granta');assert.equal(f.docs.get('hcOwners/a/contexts/g_q/history/cricket').counter.marks,18);
 await assert.rejects(f.board.api.materialize({contextId:'g_q',occurrenceId:'cricket',operationId:'cricket',grantId:'granta'}),/Missing/);
});

test('owner return scans more than fifty occurrences without duplicate delivery or lost undo',async()=>{
 const f=await casual();let revision=0;
 for(let i=0;i<51;i++){
  await f.board.api.submit({contextId:'g_q',operationId:'r'+String(i).padStart(3,'0'),matchId:'q',expectedRevision:revision++,input:input()});
  if(i<50)await f.board.api.submit({contextId:'g_q',operationId:'u'+String(i).padStart(3,'0'),matchId:'q',expectedRevision:revision++,input:{operation:'undo'}});
 }
 assert.equal((await f.a.api.sync('granta')).processed,101);
 await f.a.api.sync('granta');const records=[...f.docs].filter(([p])=>p.startsWith('hcOwners/a/contexts/g_q/history/')).map(([,r])=>r);
 assert.equal(records.length,51);assert.equal(records.filter(r=>r.status==='active').length,1);
});
test('account replacement while a transaction reads stops publication to the old owner',async()=>{
 const f=await casual();await f.board.api.submit({contextId:'g_q',operationId:'first',matchId:'q',expectedRevision:0,input:input()});
 f.onRead(()=>{f.a.auth.currentUser={uid:'b',emailVerified:true,isAnonymous:false};});
 await assert.rejects(f.a.api.materialize({contextId:'g_q',occurrenceId:'first',operationId:'first',grantId:'granta'}),/Account changed/);
 assert(!f.docs.has('hcOwners/a/contexts/g_q/history/first'));
});

test('known players without consent retain canonical result but receive no private attribution',async()=>{
 const f=fixture();f.docs.set('qrGames/q',{board:'board',active:true});const board=f.session('board'),a=f.session('a');
 await board.api.createContext({id:'g_q',kind:'casual',sourceId:'q',gameType:'501'});
 await board.api.submit({contextId:'g_q',operationId:'first',matchId:'q',expectedRevision:0,input:input()});
 assert.equal(f.docs.get('hcContexts/g_q/operations/first').after.perPlayer.a.points,501);
 assert.equal((await a.api.grants()).grants.length,0);assert.equal([...f.docs.keys()].filter(k=>k.includes('/history/')).length,0);
 await assert.rejects(board.api.submit({contextId:'g_q',operationId:'remove-player',matchId:'q',expectedRevision:1,input:{winnerId:null,perPlayer:{}}}),/Changed participants/);
});

test('phone DOM acknowledgement calls real adapter and persists exact displayed scope',async()=>{
 const {createRequire}=await import('node:module');const {JSDOM}=createRequire(import.meta.url)('/workspace/blakeout-recovery/container-build/node_modules/jsdom');
 const {mountPhoneConsent}=await import('./phone.mjs');const f=fixture();f.docs.set('qrGames/q',{board:'board',active:true});f.docs.set('qrGames/q/grants/1',{uid:'a',handle:'i1',expires:timestamp(Date.now()+100000)});
 const board=f.session('board'),a=f.session('a');await board.api.createContext({id:'g_q',kind:'casual',sourceId:'q',gameType:'501'});
 const dom=new JSDOM('<main></main>'),root=dom.window.document.querySelector('main');
 await mountPhoneConsent(root,a.api,{contextId:'g_q',bindingId:'binda',grantId:'granta',registrationId:'ra',seatId:'1',invitationId:'i1',expiresAt:Date.now()+100000});
 assert.match(root.textContent,/Game q, seat 1/);const button=root.querySelector('button');assert(button.disabled);assert(!f.docs.has('hcOwners/a/grants/granta'));
 const ack=root.querySelector('input');ack.checked=true;ack.onchange();await button.onclick();assert.equal(f.docs.get('hcOwners/a/grants/granta').scope,'game-seat');assert.match(root.textContent,/Attribution confirmed/);dom.window.close();
});
