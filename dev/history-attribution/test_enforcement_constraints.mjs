// Source/model constraints, not Firestore execution.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import * as engine from '../js/brackets/engine.js';
import {template,project,propose} from '../tournament-device/model.mjs';
import {applyOperation,emptyLedger} from './model.mjs';
test('one mutable consent document per participant cannot fit all-player atomic rule validation at current capacity',()=>{
 const source=fs.readFileSync(new URL('../js/platform.js',import.meta.url),'utf8');
 const supported=Number(source.match(/participantLimit = casual \? (\d+) : 4/)[1]);
 const uniqueConsentPaths=new Set(Array.from({length:supported},(_,i)=>`event/identities/player-${i}`));
 assert.equal(supported,128);assert.equal(uniqueConsentPaths.size,128);
 assert(uniqueConsentPaths.size>10);assert(uniqueConsentPaths.size>20);
 console.log('BLOCKED proposed all-player snapshot: at least 128 distinct consent accesses, before source/audit/roster checks; limits 10 per operation and 20 per atomic request');
});
test('actual engine reuses match slot with different teams after downstream undo and upstream correction',()=>{
 let t=engine.createTournament({id:'event',ownerId:'owner',title:'Test',date:'2026-10-18',gameType:'501',bestOf:1});
 t=engine.saveRoster(t,Array.from({length:8},(_,i)=>({id:'r'+i,playerId:'p'+i,name:'P'+i,tag:String(Math.floor(i/2)+1),paid:true,checkedIn:true,standby:false})));t=engine.startTournament(t);
 const event=template(t,'board');let head={revision:0,results:{}};
 const enter=(code,side='A')=>{const m=project(event,head).matches.find(x=>x.id===code);const p=propose(event,head,code,{winnerId:m['team'+side],scoreA:side==='A'?1:0,scoreB:side==='B'?1:0,forfeit:false});head={revision:head.revision+1,results:p.results};};
 enter('W1.1');enter('W1.2');enter('W2.1');const old=head.results['W2.1'];
 let undone=propose(event,head,'W2.1',{operation:'undo'});head={revision:head.revision+1,results:undone.results};
 enter('W1.1','B');enter('W2.1');const current=head.results['W2.1'];assert.notEqual(old.teamA,current.teamA);
 console.log('CONFIRMED same W2.1 slot now contains different teams; event/match alone cannot identify a historical contest occurrence');
 const op={eventId:'event',matchId:'W2.1',operationId:'original',expectedRevision:0,kind:'record',binding:{scope:'named-tournament',rosterRevision:0},players:[],result:{type:'tournament',teamA:old.teamA,teamB:old.teamB,winnerId:old.winnerId,scoreA:old.scoreA,scoreB:old.scoreB,forfeit:false},affected:['W2.1'],blocked:[],actor:{actorUid:'board',humanUid:null,source:'shared-device-unknown-human'}};
 const accepted=applyOperation(emptyLedger(),op,{},10);
 assert.throws(()=>applyOperation(accepted.ledger,{...op,operationId:'replacement',expectedRevision:1,kind:'correct',result:{...op.result,teamA:current.teamA,teamB:current.teamB,winnerId:current.winnerId}}, {},20),/Contest binding changed/);
});
