import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyLedger,confirmConsent,eligible,applyOperation,applyReceipt,ENABLED} from './model.mjs';
import {gameSeatBinding,tournamentOperation,phoneConsentView} from './integration.mjs';
import {createRequire} from 'node:module';
const {JSDOM}=createRequire(import.meta.url)('/workspace/blakeout-recovery/container-build/node_modules/jsdom');
const base={scope:'named-tournament',eventId:'event',registrationId:'r1',uid:'alice',rosterRevision:0};
const actor={uid:'alice',emailVerified:true,isAnonymous:false};
const consent=(b=base)=>confirmConsent({displayed:b,current:b,actor,acknowledged:true,now:10,expires:100});
const op=(x={})=>({eventId:'event',matchId:'m1',operationId:'o1',expectedRevision:0,kind:'record',binding:{scope:'named-tournament',rosterRevision:0},players:[{registrationId:'r1',uid:'alice'},{registrationId:'guest',uid:null}],result:{type:'tournament',winnerId:'t1',scoreA:2,scoreB:0},affected:['m1'],blocked:[],actor:{source:'shared-device-unknown-human',actorUid:'board',humanUid:null},...x});
const save=()=>applyOperation(emptyLedger(),op(),{r1:consent()},20);
test('disabled and claim is identity only, with separate exact game/seat binding',()=>{
 assert.equal(ENABLED,false);const b=gameSeatBinding({eventId:'event',registrationId:'r1',rosterRevision:0,claim:{uid:'alice',game:'g1',seat:'seat1',handle:'invite'}});
 assert.equal(eligible(b,b,20),false);assert.equal(eligible(consent(),b,20),false);assert.equal(eligible(consent(b),base,20),false);
 for(const key of ['gameId','seatId','invitationId'])assert.equal(eligible(consent(b),{...b,[key]:'changed'},20),false);
});
test('phone confirmation rejects changed account, roster, missing acknowledgement and unverified identity',()=>{
 for(const overrides of [{current:{...base,rosterRevision:1}},{actor:{...actor,uid:'bob'}},{actor:{...actor,emailVerified:false}},{acknowledged:false}])assert.throws(()=>confirmConsent({displayed:base,current:base,actor,acknowledged:true,now:10,expires:100,...overrides}));
});
test('missing, revoked, expired or changed-roster consent does not block scoring or attribute history',()=>{
 for(const c of [undefined,{...consent(),active:false},{...consent(),expires:20},{...consent(),rosterRevision:1}]){
 const x=applyOperation(emptyLedger(),op(),{r1:c},20);assert.equal(x.ledger.revision,1);assert.equal(x.receipts.length,0);assert.equal(x.ledger.audit[0].actor.humanUid,null);
 }
});
test('idempotent replay cannot duplicate receipts or accept changed content',()=>{
 const x=save();const replay=applyOperation(x.ledger,op(),{},200);assert.equal(replay.ledger,x.ledger);assert.equal(replay.receipts.length,0);
 assert.throws(()=>applyOperation(x.ledger,op({result:{type:'tournament',winnerId:'t2'}}),{},20),/reused/);
});
test('concurrent results require revision retry, preserving both after reload',()=>{
 const first=save();const other=op({matchId:'m2',operationId:'o2'});
 assert.throws(()=>applyOperation(first.ledger,other,{},20),/Stale/);
 const second=applyOperation(first.ledger,{...other,expectedRevision:1},{r1:consent()},20);assert.equal(Object.keys(second.ledger.matches).length,2);
});
test('correction after revoke retains historical UID, replaces stats and never reassigns roster',()=>{
 const first=save();const change=op({operationId:'o2',expectedRevision:1,kind:'correct',players:[{registrationId:'r1',uid:'bob'}],binding:{scope:'named-tournament',rosterRevision:1},result:{type:'tournament',winnerId:'t2',scoreA:0,scoreB:2}});
 const second=applyOperation(first.ledger,change,{},200);assert.equal(second.receipts[0].uid,'alice');
 let history=applyReceipt({},first.receipts[0],'alice');history=applyReceipt(history,second.receipts[0],'alice');assert.equal(Object.keys(history).length,1);assert.equal(Object.values(history)[0].result.winnerId,'t2');
 assert.equal(applyReceipt(history,first.receipts[0],'alice'),history);assert.throws(()=>applyReceipt(history,second.receipts[0],'bob'),/owner/);
 assert.equal(first.ledger.matches.m1.result.winnerId,'t1');
});
test('undo records tombstone and affected matches; completed descendants block operation',()=>{
 const first=save(),undo=op({operationId:'undo',expectedRevision:1,kind:'undo',affected:['m1','final']});
 assert.throws(()=>applyOperation(first.ledger,{...undo,blocked:['final']},{},20),/downstream/);
 const x=applyOperation(first.ledger,undo,{},200);assert.equal(x.receipts[0].status,'undone');assert.equal(x.receipts[0].result,null);assert.deepEqual(x.ledger.audit[1].affected,['m1','final']);assert(x.ledger.audit[1].before);
});
test('late consent cannot retroactively assign earlier unlinked results',()=>{
 const x=applyOperation(emptyLedger(),op(),{},20);const y=applyOperation(x.ledger,op({operationId:'o2',expectedRevision:1,kind:'correct'}),{r1:consent()},30);assert.equal(y.receipts.length,0);
});
test('reject fabricated human identity, duplicate UID and private payload fields',()=>{
 assert.throws(()=>applyOperation(emptyLedger(),op({actor:{source:'shared-device-unknown-human',actorUid:'board',humanUid:'alice'}}),{},20));
 assert.throws(()=>applyOperation(emptyLedger(),op({players:[{registrationId:'r1',uid:'alice'},{registrationId:'r2',uid:'alice'}]}),{},20));
 assert.throws(()=>applyOperation(emptyLedger(),op({result:{type:'501',resume:{secret:true}}}),{},20),/Unexpected/);
});
test('phone DOM shows distinct scope, requires acknowledgement and never claims score approval',async()=>{
 for(const b of [base,gameSeatBinding({eventId:'event',registrationId:'r1',rosterRevision:0,claim:{uid:'alice',game:'g1',seat:'seat1',handle:'invite'}})]){
 const dom=new JSDOM('<main></main>'),root=dom.window.document.querySelector('main');let submitted=0;
 phoneConsentView(root,b,async value=>{assert.deepEqual(value,b);submitted++;});
 assert.match(root.textContent,/not who submitted or approved/);assert.match(root.textContent,b.scope==='game-seat'?/does not cover other games/:/named tournament/);
 const button=root.querySelector('button');assert(button.disabled);await button.onclick();assert.equal(submitted,0);
 const checkbox=root.querySelector('input');checkbox.checked=true;checkbox.onchange();await button.onclick();assert.equal(submitted,1);dom.window.close();
 }
});

test('actual bracket engine event/audit bridge retains guest scoring and validates result',async()=>{
 const engine=await import('../js/brackets/engine.js');const {template,project,propose}=await import('../tournament-device/model.mjs');
 let t=engine.createTournament({id:'event',ownerId:'owner',title:'Test',date:'2026-10-18',gameType:'501',bestOf:1});
 t=engine.saveRoster(t,Array.from({length:4},(_,i)=>({id:'r'+i,playerId:i===1?'alice':null,name:'Player '+i,tag:String(Math.floor(i/2)+1),paid:true,checkedIn:true,standby:false})));t=engine.startTournament(t);
 const event=template(t,'board'),head={revision:0,results:{},lastOp:''};const m=project(event,head).matches.find(m=>m.status==='ready');
 const reviewed=propose(event,head,m.id,{winnerId:m.teamA,scoreA:1,scoreB:0,forfeit:false});
 reviewed.after.players=[...event.teams[m.teamA].memberIds,...event.teams[m.teamB].memberIds].map(registrationId=>({registrationId,uid:event.roster[registrationId].expectedUid}));
 const audit={eventId:'event',matchId:m.id,operationId:'integrated',revision:1,operation:'record',after:reviewed.after,before:null,actorUid:'board',humanUid:null,source:'shared-device-unknown-human'};
 const operation=tournamentOperation(event,audit,head);const saved=applyOperation(emptyLedger(),operation,{r1:consent()},20);
 assert.equal(saved.receipts.length,1);assert.equal(saved.ledger.audit[0].actor.humanUid,null);
 assert.throws(()=>tournamentOperation(event,{...audit,after:{...audit.after,winnerId:'forged'}},head));
 assert.throws(()=>tournamentOperation(event,{...audit,actorUid:'stranger'},head),/actor/);
 assert.throws(()=>tournamentOperation(event,{...audit,humanUid:'alice'},head),/submitter/);
});
test('501 and Cricket per-seat history copies only consenting owner counters; no consent still scores',async()=>{
 const {casualOperation}=await import('./integration.mjs');
 for(const gameType of ['501','cricket']){
 const seats=[{registrationId:'r1',uid:'alice',seatId:'s1',invitationId:'i1'},{registrationId:'r2',uid:'bob',seatId:'s2',invitationId:'i2'}];
 const b=gameSeatBinding({eventId:'event',registrationId:'r1',rosterRevision:0,claim:{uid:'alice',game:'g1',seat:'s1',handle:'i1'}});
 const result={gameType,participantIds:['alice','bob'],perPlayer:seats.map(s=>({playerId:s.uid,gameType,points:100,darts:9,marks:3}))};
 const operation=casualOperation({eventId:'event',gameId:'g1',rosterRevision:0,operationId:'casual',expectedRevision:0,result,seats,actor:op().actor});
 const saved=applyOperation(emptyLedger(),operation,{r1:consent(b)},20);assert.equal(saved.receipts.length,1);assert.deepEqual(saved.receipts[0].result.counters.map(x=>x.playerId),['alice']);assert.equal(saved.ledger.matches.g1.result.counters.length,2);
 assert.equal(applyOperation(emptyLedger(),operation,{},20).receipts.length,0);
 }
});
