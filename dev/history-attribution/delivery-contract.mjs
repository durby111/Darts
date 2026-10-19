// Executable specification, NOT a Firebase adapter or security boundary.
// auth is a simulated trusted request.auth context; client payload has no UID field.
import {confirmConsent,applyOperation,applyReceipt,emptyLedger} from './model.mjs';
const copy=x=>structuredClone(x);
const stable=x=>JSON.stringify(x,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
function requireThat(ok,message){if(!ok)throw Error(message);}
function verified(auth){requireThat(auth?.emailVerified===true&&auth.isAnonymous===false,'Verified request identity required');}
export function initialDatabase(){return {events:{},consents:{},outbox:{},history:{}};}
const eventKey=(e,r)=>JSON.stringify([e,r]);
const receiptKey=(op,key)=>JSON.stringify([op,key]);
export function consentTransaction(db,{auth,eventId,registrationId,displayed,acknowledged,now,expires}){
 verified(auth);const event=db.events[eventId];requireThat(event?.active,'Inactive event');
 const seat=event.bindings[registrationId];requireThat(seat?.uid===auth.uid,'Not this roster identity');
 const consent=confirmConsent({displayed,current:seat,actor:auth,acknowledged,now,expires});
 const next=copy(db);next.consents[eventKey(eventId,registrationId)]=consent;return next;
}
export function revokeTransaction(db,{auth,eventId,registrationId}){
 verified(auth);const key=eventKey(eventId,registrationId);requireThat(db.consents[key]?.uid===auth.uid,'Not consent owner');
 const next=copy(db);delete next.consents[key];return next;
}
export function resultTransaction(db,{auth,eventId,operation,now}){
 const event=db.events[eventId];requireThat(event?.active,'Inactive event');
 requireThat(auth?.uid===event.boardUid||auth?.uid===event.ownerUid,'Not event writer');
 requireThat(operation.eventId===eventId,'Wrong source event');
 // Derive the actor from authenticated context, never the submitted actor claim.
 const organizer=auth.uid===event.ownerUid;
 if(organizer)verified(auth);
 const op={...copy(operation),actor:{actorUid:auth.uid,humanUid:organizer?auth.uid:null,source:organizer?'organizer':'shared-device-unknown-human'}};
 for(const p of op.players){
  const b=event.bindings[p.registrationId];
  requireThat(b&&b.uid===p.uid,'Forged roster UID');
  requireThat(op.binding.scope===b.scope&&op.binding.rosterRevision===b.rosterRevision,'Changed roster/scope');
  if(b.scope==='game-seat')requireThat(op.binding.gameId===b.gameId&&p.seatId===b.seatId&&p.invitationId===b.invitationId,'Changed game/seat/invitation');
 }
 const consents=Object.fromEntries(op.players.map(p=>[p.registrationId,db.consents[eventKey(eventId,p.registrationId)]]));
 const applied=applyOperation(event.ledger||emptyLedger(),op,consents,now);
 if(applied.replayed)return db; // Durable outbox remains; replay need not recreate it.
 const next=copy(db);next.events[eventId].ledger=applied.ledger;
 for(const receipt of applied.receipts){const key=receiptKey(op.operationId,receipt.key);requireThat(!next.outbox[key],'Existing immutable outbox');next.outbox[key]={...receipt,sourceOperation:op.operationId};}
 // Source head, audit and all outbox entries are one atomic candidate state.
 return next;
}
export function ownInbox(db,auth){verified(auth);denyTabletPrivateAccess(db,auth);return Object.entries(db.outbox).filter(([,r])=>r.uid===auth.uid).map(([id,receipt])=>({id,receipt:copy(receipt)}));}
export function deliverTransaction(db,{auth,outboxId}){
 verified(auth);denyTabletPrivateAccess(db,auth);const receipt=db.outbox[outboxId];requireThat(receipt&&receipt.uid===auth.uid,'Not receipt owner');
 const source=db.events[receipt.eventId]?.ledger?.operations[receipt.sourceOperation];
 requireThat(source?.revision===receipt.revision,'Unbacked receipt');
 const log=db.events[receipt.eventId].ledger.audit.find(x=>x.operationId===receipt.sourceOperation);
 const person=log?.after.recipients.find(x=>x.uid===auth.uid);requireThat(person,'Not accepted recipient');
 const result=log.after.result;
 const expected={key:JSON.stringify([auth.uid,log.eventId,log.matchId]),uid:auth.uid,eventId:log.eventId,matchId:log.matchId,revision:log.revision,status:log.after.status,result:result?{...copy(result),...(result.counters?{counters:result.counters.filter(c=>c.playerId===auth.uid).map(copy)}:{})}:null,attribution:copy(person),sourceOperation:log.operationId};
 requireThat(stable(expected)===stable(receipt),'Receipt differs from accepted source');
 const next=copy(db);next.history[auth.uid]=applyReceipt(next.history[auth.uid]||{},receipt,auth.uid);return next;
}
export function readOwnHistory(db,auth){verified(auth);denyTabletPrivateAccess(db,auth);return copy(db.history[auth.uid]||{});}
export function denyTabletPrivateAccess(db,auth){
 requireThat(!Object.values(db.events).some(e=>e.boardUid===auth?.uid),'Tablet private access denied');
}
