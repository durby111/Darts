import {assertAdapterEnvironment} from '../history-attribution/environment.mjs';
import {template,project,propose,registrations} from './model.mjs';
const stable=value=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
export function tournamentDevice({db,auth,sdk,environment}){
  assertAdapterEnvironment({db,auth,sdk,environment});
  const {doc,getDocFromServer,getDocs,collection,query,where,runTransaction,serverTimestamp,Timestamp}=sdk;
  const ref=(...s)=>doc(db,...s),user=()=>{if(!auth.currentUser)throw Error('Device or organizer session required');return auth.currentUser;};
  const current=u=>{if(auth.currentUser!==u)throw Error('Session changed; select the event again');};
  async function receiptPlayers(event,after,read){if(!after)return null;const ids=registrations(event,after),data=await Promise.all(ids.map(id=>event.roster[id].expectedUid?read(ref('tdEvents',event.eventId,'identities',id)):null));return ids.map((id,i)=>{const d=data[i]?.data();return {registrationId:id,uid:d?.active&&d.expires.toMillis()>Date.now()&&d.rosterRevision===event.rosterRevision?d.uid:null};});}
  return Object.freeze({
    async create(t,boardUid){const u=user();if(t.ownerId!==u.uid)throw Error('Organizer identity mismatch');const event=template(t,boardUid);await runTransaction(db,async tx=>{current(u);tx.set(ref('tdEvents',t.id),event);tx.set(ref('tdEvents',t.id,'state','current'),{revision:0,results:{},lastOp:''});});return event;},
    async list(role){const u=user(),q=query(collection(db,'tdEvents'),where(role==='organizer'?'ownerUid':'boardUid','==',u.uid));return (await getDocs(q)).docs.map(d=>d.data());},
    async load(e){user();const [a,b]=await Promise.all([getDocFromServer(ref('tdEvents',e)),getDocFromServer(ref('tdEvents',e,'state','current'))]);if(!a.exists()||!b.exists())throw Error('Tournament unavailable');return {event:a.data(),head:b.data(),bracket:project(a.data(),b.data())};},
    async review(e,matchId,input,reason){const u=user(),{event,head}=await this.load(e);if(!event.active)throw Error('Tournament entry has ended');const p=propose(event,head,matchId,input);if(p.after)p.after.players=await receiptPlayers(event,p.after,getDocFromServer);current(u);return {eventId:e,matchId,input,reason,expectedRevision:head.revision,operationId:crypto.randomUUID(),after:p.after,before:p.before,affected:p.affected,actorUid:u.uid};},
    async submit(review){const u=user();if(review.actorUid!==u.uid)throw Error('Session changed; review again');return runTransaction(db,async tx=>{
      const e=review.eventId,[a,b,old]=await Promise.all([tx.get(ref('tdEvents',e)),tx.get(ref('tdEvents',e,'state','current')),tx.get(ref('tdEvents',e,'audit',review.operationId))]);current(u);
      if(old.exists()){const v=old.data();if(v.actorUid===u.uid&&v.matchId===review.matchId&&stable(v.after)===stable(review.after))return {revision:v.revision,replayed:true};throw Error('Operation ID already used');}
      const event=a.data(),head=b.data();if(!event?.active)throw Error('Tournament entry has ended');if(head.revision!==review.expectedRevision)throw Error('Tournament changed; reload and review again');
      const p=propose(event,head,review.matchId,review.input);if(p.after)p.after.players=await receiptPlayers(event,p.after,r=>tx.get(r));current(u);
      if(stable(p.after)!==stable(review.after)||stable(p.before)!==stable(review.before))throw Error('Player attribution changed; review again');
      if(p.after)p.results[review.matchId]=p.after;
      const revision=head.revision+1,operator=event.ownerUid===u.uid;
      tx.set(ref('tdEvents',e,'state','current'),{revision,results:p.results,lastOp:review.operationId});
      tx.set(ref('tdEvents',e,'audit',review.operationId),{eventId:e,operationId:review.operationId,matchId:review.matchId,revision,operation:p.operation,before:p.before,after:p.after,actorUid:u.uid,humanUid:operator?u.uid:null,source:operator?'organizer':'shared-device-unknown-human',at:serverTimestamp(),reason:review.reason});
      return {revision,replayed:false};});},
    async audit(e){user();return (await getDocs(collection(db,'tdEvents',e,'audit'))).docs.map(d=>d.data()).sort((a,b)=>a.revision-b.revision);},
    async consent(e,registrationId,confirmedUid){const u=user();if(u.uid!==confirmedUid||!u.emailVerified)throw Error('Confirm your verified identity');await runTransaction(db,async tx=>{const ev=await tx.get(ref('tdEvents',e));current(u);const d=ev.data();if(d.roster[registrationId]?.expectedUid!==u.uid)throw Error('This roster slot belongs to another identity');tx.set(ref('tdEvents',e,'identities',registrationId),{uid:u.uid,active:true,scope:'named-tournament-history',rosterRevision:d.rosterRevision,expires:Timestamp.fromMillis(Date.now()+43190000),at:serverTimestamp()});});},
    async revokeConsent(e,r){const u=user();await runTransaction(db,async tx=>{current(u);tx.delete(ref('tdEvents',e,'identities',r));});},
    async end(e){const u=user();await runTransaction(db,async tx=>{current(u);tx.update(ref('tdEvents',e),{active:false});});},
    async revokeDevice(e){const u=user();await runTransaction(db,async tx=>{current(u);tx.update(ref('tdEvents',e),{boardUid:null});});}
  });
}
