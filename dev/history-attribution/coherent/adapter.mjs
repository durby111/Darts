// Disabled demo SDK candidate; all backend authorization is in candidate.rules.
import {project,propose,registrations} from '../../tournament-device/model.mjs';
const clone=x=>structuredClone(x);
export function historyAdapter({db,auth,sdk}) {
 if(db?.app?.options?.projectId!=='demo-blakeout-adapter-task3'||auth?.app!==db.app)throw Error('Demo only');
 const {doc,collection,query,where,orderBy,limit,startAfter,getDocsFromServer,runTransaction,serverTimestamp,Timestamp}=sdk;
 const ref=(...p)=>doc(db,...p),get=s=>{if(!s.exists())throw Error('Missing canonical document');return s.data();};
 const user=()=>{if(!auth.currentUser)throw Error('Sign in');return auth.currentUser;};
 const player=()=>{const u=user();if(!u.emailVerified||u.isAnonymous)throw Error('Verified owner required');return u;};
 const same=u=>{if(auth.currentUser!==u)throw Error('Account changed');};
 async function page(path,filters,cursor,temporal=false){const q=query(collection(db,...path),...filters,...(temporal?[orderBy('at')]:[]),orderBy(sdk.documentId()),limit(50),...(cursor?[startAfter(cursor)]:[]));return getDocsFromServer(q);}
 return Object.freeze({
  async end(contextId){const u=user();return runTransaction(db,async tx=>{const c=get(await tx.get(ref('hcContexts',contextId)));same(u);if(u.uid!==(c.kind==='tournament'?c.ownerUid:c.boardUid))throw Error('Not owner');tx.update(ref('hcContexts',contextId),{active:false});});},
  async createContext({id,kind,sourceId,gameType}) {
   const u=user();if(id!==(kind==='tournament'?'t_':'g_')+sourceId)throw Error('Canonical context ID required');return runTransaction(db,async tx=>{
    const original=get(await tx.get(ref(kind==='tournament'?'tdEvents':'qrGames',sourceId)));same(u);
    const owner=kind==='tournament'?original.ownerUid:original.board;
    if(owner!==u.uid||!original.active)throw Error('Not active source owner');
    if(kind!=='tournament'&&!['501','cricket'].includes(gameType))throw Error('Unsupported casual game');
    const context={kind,sourceId,ownerUid:owner,boardUid:kind==='tournament'?original.boardUid:owner,gameType:kind==='tournament'?original.gameType:gameType,active:true};
    tx.set(ref('hcContexts',id,'links','current'),{members:{}});tx.set(ref('hcContexts',id),context);tx.set(ref('hcContexts',id,'state','current'),{revision:0,results:{},active:{},lastOp:''});
   });
  },
  async consentDetails({contextId,registrationId,seatId='',invitationId=''}){const u=player();return runTransaction(db,async tx=>{const c=get(await tx.get(ref('hcContexts',contextId)));same(u);if(!c.active)throw Error('Context closed');return {contextId,uid:u.uid,scope:c.kind==='tournament'?'named-tournament':'game-seat',registrationId,seatId,invitationId,eventId:c.sourceId,gameId:c.sourceId};});},
  async confirm({contextId,bindingId,grantId,registrationId,seatId='',invitationId='',expiresAt,acknowledged,displayedUid,displayed}) {
   const u=player();if(!acknowledged||displayedUid!==u.uid)throw Error('Explicit identity confirmation required');
   return runTransaction(db,async tx=>{
    const c=get(await tx.get(ref('hcContexts',contextId)));
    const existingBinding=await tx.get(ref('hcBindings',bindingId));
    const existingGrant=await tx.get(ref('hcOwners',u.uid,'grants',grantId));
    const links=get(await tx.get(ref('hcContexts',contextId,'links','current')));
    if(!c.active)throw Error('Context closed');
    if(c.kind==='tournament'){
     const e=get(await tx.get(ref('tdEvents',c.sourceId)));if(e.roster[registrationId]?.expectedUid!==u.uid)throw Error('Not roster owner');
    } else {
     const g=get(await tx.get(ref('qrGames',c.sourceId,'grants',seatId)));
     if(g.uid!==u.uid||g.handle!==invitationId||g.expires.toMillis()<=Date.now())throw Error('Invalid phone seat claim');
    }
    same(u);
    const binding={uid:u.uid,contextId,scope:c.kind==='tournament'?'named-tournament':'game-seat',registrationId,seatId,invitationId};
    if(!displayed||Object.keys(binding).some(k=>displayed[k]!==binding[k]))throw Error('Displayed consent scope changed');
    if(existingBinding.exists()&&Object.keys(binding).some(k=>existingBinding.data()[k]!==binding[k]))throw Error('Binding ID conflict');
    if(existingGrant.exists()){if(existingGrant.data().bindingId!==bindingId)throw Error('Grant ID conflict');return {replayed:true};}
    tx.set(ref('hcContexts',contextId,'links','current'),{members:{...links.members,[u.uid]:bindingId}});
    if(!existingBinding.exists())tx.set(ref('hcBindings',bindingId),binding);
    tx.set(ref('hcOwners',u.uid,'grants',grantId),{...binding,bindingId,at:serverTimestamp(),expires:Timestamp.fromMillis(expiresAt)});
   });
  },
  async revoke(grantId){const u=player();return runTransaction(db,async tx=>{
   get(await tx.get(ref('hcOwners',u.uid,'grants',grantId)));const r=await tx.get(ref('hcOwners',u.uid,'revocations',grantId));same(u);
   if(!r.exists())tx.set(ref('hcOwners',u.uid,'revocations',grantId),{at:serverTimestamp()});
  });},
  async submit({contextId,operationId,matchId,expectedRevision,input}){
   const u=user();return runTransaction(db,async tx=>{
    const c=get(await tx.get(ref('hcContexts',contextId)));
    const head=get(await tx.get(ref('hcContexts',contextId,'state','current')));
    const existing=await tx.get(ref('hcContexts',contextId,'operations',operationId));
    const links=get(await tx.get(ref('hcContexts',contextId,'links','current')));
    if(existing.exists()){
     const v=existing.data();if(v.actorUid!==u.uid||v.matchId!==matchId||JSON.stringify(v.input)!==JSON.stringify(input))throw Error('Operation ID conflict');return {replayed:true,occurrenceId:v.occurrenceId};
    }
    if(!c.active||![c.ownerUid,c.boardUid].includes(u.uid))throw Error('Not active writer');
    if(head.revision!==expectedRevision)throw Error('Stale revision');
    if(c.kind==='casual'&&matchId!==c.sourceId)throw Error('Canonical game match required');
    const before=head.results[matchId]??null;let after,results,kind,affected,roster=[],participants=[];
    if(c.kind==='tournament'){
     const event=get(await tx.get(ref('tdEvents',c.sourceId)));if(!event.active||(u.uid===c.boardUid&&event.boardUid!==u.uid))throw Error('Tournament device revoked');const p=propose(event,head,matchId,input);
     after=p.after;results=p.results;kind=p.operation;affected=p.affected;
     if(after){roster=registrations(event,after);participants=roster.map(r=>event.roster[r].expectedUid);after.players=[];results[matchId]=after;}
    }else{
     kind=input.operation==='undo'?'undo':before?'correct':'record';
     if(kind==='undo'&&!before)throw Error('Nothing to undo');
     after=kind==='undo'?null:{gameType:c.gameType,perPlayer:clone(input.perPlayer),winnerId:input.winnerId??null};
     results={...head.results};if(after)results[matchId]=after;else delete results[matchId];affected=[matchId];
    }
    if(before&&after&&JSON.stringify(before)===JSON.stringify(after))return {unchanged:true,occurrenceId:head.active[matchId]};
    if(c.kind==='casual'&&after)participants=Object.keys(after.perPlayer);
    const occurrenceId=before?head.active[matchId]:operationId;
    let occurrence;
    if(before){occurrence=get(await tx.get(ref('hcContexts',contextId,'occurrences',occurrenceId)));if(c.kind==='casual'&&after&&(Object.keys(after.perPlayer).length!==occurrence.participants.length||occurrence.participants.some(uid=>!Object.hasOwn(after.perPlayer,uid))))throw Error('Changed participants require undo and a new occurrence');}
    else{occurrence={contextId,matchId,firstOp:operationId,at:serverTimestamp(),members:clone(links.members),registrations:roster,participants};}
    same(u);
    const active={...head.active,[matchId]:occurrenceId};
    const operation={contextId,matchId,occurrenceId,revision:head.revision+1,kind,before,after,input:clone(input),actorUid:u.uid,humanUid:u.uid===c.ownerUid&&c.kind==='tournament'?u.uid:null,source:u.uid===c.ownerUid&&c.kind==='tournament'?'organizer':'shared-device-unknown-human',at:serverTimestamp()};
    if(!before)tx.set(ref('hcContexts',contextId,'occurrences',occurrenceId),occurrence);
    tx.set(ref('hcContexts',contextId,'operations',operationId),operation);
    tx.set(ref('hcContexts',contextId,'state','current'),{revision:operation.revision,results,active,lastOp:operationId});
    return {replayed:false,occurrenceId,affected};
   });
  },
  async grants(cursor=null){const u=player();const result=await page(['hcOwners',u.uid,'grants'],[],cursor);same(u);return {grants:result.docs.map(s=>({id:s.id,...s.data()})),cursor:result.docs.length===50?result.docs.at(-1):null};},
  async sync(grantId){let cursor=null,processed=0;do{const found=await this.discover(grantId,cursor);for(const occurrence of found.occurrences){let opCursor=null;do{const batch=await this.operations(occurrence.contextId,occurrence.id,opCursor);for(const op of batch.operations){await this.materialize({contextId:occurrence.contextId,occurrenceId:occurrence.id,operationId:op.id,grantId});processed++;}opCursor=batch.cursor;}while(opCursor);}cursor=found.cursor;}while(cursor);return {processed};},
  async discover(grantId,cursor=null){
   const u=player();let grant,revoked;
   await runTransaction(db,async tx=>{grant=get(await tx.get(ref('hcOwners',u.uid,'grants',grantId)));const r=await tx.get(ref('hcOwners',u.uid,'revocations',grantId));revoked=r.exists()?r.data().at:null;same(u);});
   const until=revoked&&revoked.toMillis()<grant.expires.toMillis()?revoked:grant.expires;
   const snapshots=await page(['hcContexts',grant.contextId,'occurrences'],[where('participants','array-contains',u.uid),where('at','>',grant.at),where('at','<',until)],cursor,true);same(u);
   return {occurrences:snapshots.docs.map(s=>({id:s.id,...s.data()})).filter(o=>o.members[u.uid]===grant.bindingId),cursor:snapshots.docs.length===50?snapshots.docs.at(-1):null};
  },
  async operations(contextId,occurrenceId,cursor=null){const u=player();const snapshots=await page(['hcContexts',contextId,'operations'],[where('occurrenceId','==',occurrenceId)],cursor);same(u);return {operations:snapshots.docs.map(s=>({id:s.id,...s.data()})),cursor:snapshots.docs.length===50?snapshots.docs.at(-1):null};},
  async materialize({contextId,occurrenceId,operationId,grantId}){
   const u=player();return runTransaction(db,async tx=>{
    const [g,r,o,s,h]=await Promise.all([tx.get(ref('hcOwners',u.uid,'grants',grantId)),tx.get(ref('hcOwners',u.uid,'revocations',grantId)),tx.get(ref('hcContexts',contextId,'occurrences',occurrenceId)),tx.get(ref('hcContexts',contextId,'operations',operationId)),tx.get(ref('hcOwners',u.uid,'contexts',contextId,'history',occurrenceId))]);
    same(u);const grant=get(g),occurrence=get(o),source=get(s),t=occurrence.at.toMillis();
    if(!occurrence.participants.includes(u.uid)||grant.uid!==u.uid||grant.contextId!==contextId||occurrence.members[u.uid]!==grant.bindingId||grant.at.toMillis()>=t||grant.expires.toMillis()<=t||(r.exists()&&r.data().at.toMillis()<=t))throw Error('No original consent');
    if(grant.scope==='named-tournament'&&!occurrence.registrations.includes(grant.registrationId))throw Error('Not in this contest');
    if(source.occurrenceId!==occurrenceId)throw Error('Wrong occurrence');if(h.exists()&&h.data().revision>=source.revision)return {replayed:true};
    const counter=source.after===null?null:source.after.perPlayer?source.after.perPlayer[u.uid]:source.after;
    tx.set(ref('hcOwners',u.uid,'contexts',contextId,'history',occurrenceId),{uid:u.uid,contextId,occurrenceId,operationId,grantId,revision:source.revision,status:source.after===null?'undone':'active',counter,at:source.at});return {replayed:false};
   });
  }
 });
}

export function casualInput(result) {
 if(!['501','cricket'].includes(result.gameType)||!Array.isArray(result.perPlayer))throw Error('Unsupported scorer result');
 const perPlayer={};for(const row of result.perPlayer){if(Object.hasOwn(perPlayer,row.playerId))throw Error('Duplicate player counter');Object.defineProperty(perPlayer,row.playerId,{value:clone(row),enumerable:true});}
 return {perPlayer,winnerId:result.winnerId??null};
}
