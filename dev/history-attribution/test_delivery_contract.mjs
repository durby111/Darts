import test from 'node:test';import assert from 'node:assert/strict';
import {initialDatabase,consentTransaction,revokeTransaction,resultTransaction,ownInbox,deliverTransaction,readOwnHistory,denyTabletPrivateAccess} from './delivery-contract.mjs';
const alice={uid:'alice',emailVerified:true,isAnonymous:false},bob={...alice,uid:'bob'},board={uid:'board'};
const binding={scope:'named-tournament',eventId:'event',registrationId:'r1',uid:'alice',rosterRevision:0};
function fixture(){const db=initialDatabase();db.events.event={active:true,boardUid:'board',ownerUid:'organizer',bindings:{r1:binding}};return db;}
const consent=db=>consentTransaction(db,{auth:alice,eventId:'event',registrationId:'r1',displayed:binding,acknowledged:true,now:10,expires:100});
const operation={eventId:'event',matchId:'m1',operationId:'o1',expectedRevision:0,kind:'record',binding:{scope:'named-tournament',rosterRevision:0},players:[{registrationId:'r1',uid:'alice'}],result:{type:'tournament',winnerId:'t1',scoreA:2,scoreB:0},affected:['m1'],blocked:[],actor:{actorUid:'forged',humanUid:'forged',source:'organizer'}};
const write=(db,op=operation,now=20)=>resultTransaction(db,{auth:board,eventId:'event',operation:op,now});
test('consent derives UID from request identity and current roster',()=>{
 assert.throws(()=>consentTransaction(fixture(),{auth:bob,eventId:'event',registrationId:'r1',displayed:binding,acknowledged:true,now:10,expires:100}),/roster/);
 assert.equal(consent(fixture()).consents['["event","r1"]'].uid,'alice');
});
test('no consent: result advances, no receipt; tablet actor ignores forged human claim',()=>{
 const db=write(fixture());assert.equal(db.events.event.ledger.revision,1);assert.equal(Object.keys(db.outbox).length,0);assert.equal(db.events.event.ledger.audit[0].actor.humanUid,null);
 assert.throws(()=>write(consent(fixture()),{...operation,players:[{registrationId:'r1',uid:'bob'}]}),/roster/);
});
test('atomic specification has no source-only success; crash before commit changes nothing',()=>{
 const db=consent(fixture()),snapshot=structuredClone(db);const staged=write(db);
 assert.deepEqual(db,snapshot);assert.equal(Object.keys(db.outbox).length,0);
 assert.equal(staged.events.event.ledger.revision,1);assert.equal(Object.keys(staged.outbox).length,1);
});
test('commit then crash/restart: durable outbox survives and retry does not duplicate',()=>{
 const committed=write(consent(fixture()));const restored=JSON.parse(JSON.stringify(committed));
 const replay=write(restored);assert.equal(replay,restored);assert.equal(Object.keys(replay.outbox).length,1);
 const inbox=ownInbox(replay,alice);assert.equal(inbox.length,1);const delivered=deliverTransaction(replay,{auth:alice,outboxId:inbox[0].id});
 assert.equal(Object.keys(readOwnHistory(delivered,alice)).length,1);assert.deepEqual(deliverTransaction(delivered,{auth:alice,outboxId:inbox[0].id}),delivered);
});
test('cross-user receipt, tablet private access and unverified owner are denied',()=>{
 const db=write(consent(fixture())),id=Object.keys(db.outbox)[0];
 assert.equal(ownInbox(db,bob).length,0);assert.throws(()=>deliverTransaction(db,{auth:bob,outboxId:id}),/owner/);
 assert.throws(()=>denyTabletPrivateAccess(db,board),/denied/);assert.throws(()=>ownInbox(db,board),/Verified/);
 assert.throws(()=>deliverTransaction(db,{auth:{...alice,emailVerified:false},outboxId:id}),/Verified/);
});
test('revocation and expiry serialized before new result remove future attribution',()=>{
 const granted=consent(fixture());const revoked=revokeTransaction(granted,{auth:alice,eventId:'event',registrationId:'r1'});
 assert.equal(Object.keys(write(revoked).outbox).length,0);assert.equal(Object.keys(write(granted,operation,100).outbox).length,0);
});
test('correction/undo delivered out of order cannot restore stale totals',()=>{
 let db=write(consent(fixture()));db=revokeTransaction(db,{auth:alice,eventId:'event',registrationId:'r1'});
 db=write(db,{...operation,operationId:'o2',expectedRevision:1,kind:'correct',result:{type:'tournament',winnerId:'t2',scoreA:0,scoreB:2}},110);
 db=write(db,{...operation,operationId:'o3',expectedRevision:2,kind:'undo'},120);
 const inbox=ownInbox(db,alice).reverse();for(const item of inbox)db=deliverTransaction(db,{auth:alice,outboxId:item.id});
 const values=Object.values(readOwnHistory(db,alice));assert.equal(values.length,1);assert.equal(values[0].status,'undone');assert.equal(values[0].revision,3);assert.equal(Object.keys(db.outbox).length,3);
});
test('concurrent result snapshots: stale revision rejects, reload preserves both matches',()=>{
 let db=write(consent(fixture()));const other={...operation,operationId:'o2',matchId:'m2'};
 assert.throws(()=>write(db,other),/Stale/);db=write(db,{...other,expectedRevision:1});assert.equal(Object.keys(db.outbox).length,2);
});

test('verified board still cannot access private delivery; forged receipt data is rejected',()=>{
 const db=write(consent(fixture())),outboxId=Object.keys(db.outbox)[0];
 assert.throws(()=>ownInbox(db,{...alice,uid:'board'}),/Tablet/);
 assert.throws(()=>readOwnHistory(db,{...alice,uid:'board'}),/Tablet/);
 const forged=structuredClone(db);forged.outbox[outboxId].result.winnerId='forged';
 assert.throws(()=>deliverTransaction(forged,{auth:alice,outboxId}),/differs/);
});
