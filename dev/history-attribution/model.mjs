// Disabled pure candidate. Inputs MUST come from authenticated, authoritative
// transactions in a future adapter. This module is NOT an authorization boundary.
export const ENABLED = false;
const clone = value => structuredClone(value);
const stable = value => JSON.stringify(value, (_k,v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))) : v);
function check(ok, message) { if (!ok) throw Error(message); }
function id(value) { check(typeof value==='string' && /^[A-Za-z0-9_.:%-]{1,128}$/.test(value) && !['__proto__','constructor','prototype'].includes(value), 'Invalid identity'); return value; }
export function binding(value) {
    check(['game-seat','named-tournament'].includes(value.scope),'Unknown consent scope');
    const out={scope:value.scope,eventId:id(value.eventId),registrationId:id(value.registrationId),uid:id(value.uid),rosterRevision:value.rosterRevision};
    check(Number.isSafeInteger(out.rosterRevision)&&out.rosterRevision>=0,'Invalid roster revision');
    if(value.scope==='game-seat')Object.assign(out,{gameId:id(value.gameId),seatId:id(value.seatId),invitationId:id(value.invitationId)});
    return out;
}
export function confirmConsent({displayed,current,actor,acknowledged,now,expires}) {
    check(actor?.emailVerified===true && actor.isAnonymous===false,'Verified phone identity required');
    const a=binding(displayed),b=binding(current);
    check(stable(a)===stable(b)&&a.uid===actor.uid,'Identity or seat changed; review again');
    check(acknowledged===true,'Explicit phone confirmation required');
    check(Number.isSafeInteger(now)&&Number.isSafeInteger(expires)&&expires>now&&expires<=now+12*60*60*1000,'Invalid consent lifetime');
    return {...a,active:true,confirmedAt:now,expires};
}
export function eligible(consent, expected, now) {
    if(!consent||consent.active!==true||!Number.isSafeInteger(now)||!Number.isSafeInteger(consent.confirmedAt)||!Number.isSafeInteger(consent.expires)||consent.confirmedAt>now||consent.expires<=now)return false;
    try{return stable(binding(consent))===stable(binding(expected));}catch{return false;}
}
function publicResult(value) {
    check(value && ['501','cricket','tournament'].includes(value.type),'Unsupported result kind');
    const keys=['type','teamA','teamB','winnerId','scoreA','scoreB','forfeit','counters'];
    check(Object.keys(value).every(k=>keys.includes(k)),'Unexpected result data');
    for(const k of ['teamA','teamB','winnerId'])if(value[k]!==undefined&&value[k]!==null)id(value[k]);
    for(const k of ['scoreA','scoreB'])if(value[k]!==undefined&&value[k]!==null)check(Number.isSafeInteger(value[k])&&value[k]>=0,'Invalid score');
    if(value.forfeit!==undefined)check(typeof value.forfeit==='boolean','Invalid forfeit');
    if(value.counters!==undefined){
        check(Array.isArray(value.counters),'Invalid counters');
        for(const c of value.counters){
            check(Object.keys(c).every(k=>['playerId','gameType','points','darts','marks'].includes(k)),'Unexpected counter data');id(c.playerId);
            check(c.gameType===value.type,'Counter game mismatch');
            for(const k of ['points','darts','marks'])check(Number.isFinite(c[k])&&c[k]>=0,'Invalid counter');
        }
    }
    return clone(value);
}
export function emptyLedger() { return {revision:0,operations:{},matches:{},audit:[]}; }
// Result inputs are public event results only: never private history or resume.
export function applyOperation(previous, op, consents, now) {
    id(op.operationId);id(op.matchId);id(op.eventId);
    check(['record','correct','undo'].includes(op.kind),'Invalid operation');
    check(Number.isSafeInteger(now)&&now>=0,'Invalid authoritative time');
    const digest=stable(op),old=previous.operations[op.operationId];
    if(old){check(old.digest===digest,'Operation ID reused with different content');return {ledger:previous,replayed:true,receipts:[]};}
    check(op.expectedRevision===previous.revision,'Stale event revision');
    const prior=previous.matches[op.matchId];
    check(!prior||prior.eventId===op.eventId,'Match belongs to another event');
    check(op.kind==='record'?!prior:!!prior,'Invalid match lifecycle');
    check(Array.isArray(op.affected)&&op.affected.every(x=>typeof x==='string'),'Affected matches required');
    check(Array.isArray(op.blocked)&&op.blocked.length===0,'Undo downstream affected matches first');
    check(op.actor?.source==='shared-device-unknown-human'?op.actor.humanUid===null:op.actor?.source==='organizer'&&op.actor.humanUid===op.actor.actorUid,'Honest submitter identity required');
    id(op.actor.actorUid);
    check(Array.isArray(op.players)&&new Set(op.players.map(p=>p.registrationId)).size===op.players.length,'Duplicate roster seats');
    const seen=new Set();
    for(const p of op.players){id(p.registrationId);if(p.uid!==null){id(p.uid);check(!seen.has(p.uid),'Duplicate player identity');seen.add(p.uid);}}
    // Freeze ownership when first accepted. Later consent never backfills old
    // results, and revocation/roster changes never reassign an accepted result.
    const recipients=prior?prior.recipients:op.players.filter(p=>p.uid!==null&&eligible(consents[p.registrationId],{...op.binding,...(op.binding.scope==='game-seat'?{seatId:p.seatId,invitationId:p.invitationId}:{}),eventId:op.eventId,registrationId:p.registrationId,uid:p.uid},now)).map(p=>({registrationId:p.registrationId,uid:p.uid,consent:clone(consents[p.registrationId])}));
    const revision=previous.revision+1;
    const result=op.kind==='undo'?null:publicResult(op.result);
    check(op.kind==='undo'||(result&&['501','cricket','tournament'].includes(result.type)),'Unsupported result kind');
    const after={eventId:op.eventId,matchId:op.matchId,revision,status:op.kind==='undo'?'undone':'active',result,recipients:clone(recipients)};
    const ledger=clone(previous);ledger.revision=revision;ledger.matches[op.matchId]=after;
    ledger.operations[op.operationId]={digest,revision};
    ledger.audit.push({operationId:op.operationId,eventId:op.eventId,matchId:op.matchId,revision,at:now,actor:clone(op.actor),before:prior?clone(prior):null,after:clone(after),affected:clone(op.affected)});
    // Idempotent per-match replacement, never additive counters. Consumers must
    // apply only increasing revisions to this stable UID/event/match key.
    const receipts=recipients.map(p=>({key:JSON.stringify([p.uid,op.eventId,op.matchId]),uid:p.uid,eventId:op.eventId,matchId:op.matchId,revision,status:after.status,result:result?{...clone(result),...(result.counters?{counters:result.counters.filter(c=>c.playerId===p.uid).map(clone)}:{})}:null,attribution:clone(p)}));
    return {ledger,replayed:false,receipts};
}
export function applyReceipt(history, receipt, ownerUid) {
    check(receipt.uid===ownerUid,'Private history owner mismatch');
    check(receipt.key===JSON.stringify([receipt.uid,receipt.eventId,receipt.matchId]),'Receipt key mismatch');
    const old=history[receipt.key];
    if(old&&old.revision>receipt.revision)return history;
    if(old&&old.revision===receipt.revision){check(stable(old)===stable(receipt),'Conflicting receipt revision');return history;}
    return {...history,[receipt.key]:clone(receipt)};
}
