import {project,propose} from '../../tournament-device/model.mjs';
import {casualInput} from '../coherent/adapter.mjs';
export function historyDesk(session) {
 const {db,auth,storeSDK:s,history,tournament}=session;
 const actor=()=>{if(!auth.currentUser)throw Error('Session ended');return auth.currentUser;};
 const same=u=>{if(auth.currentUser!==u)throw Error('Session changed; review again');};
 const ref=(...p)=>s.doc(db,...p);
 return {
  list:role=>tournament.list(role),
  async load(id){const u=actor();return s.runTransaction(db,async tx=>{
   const [e,c,h]=await Promise.all([tx.get(ref('tdEvents',id)),tx.get(ref('hcContexts','t_'+id)),tx.get(ref('hcContexts','t_'+id,'state','current'))]);same(u);
   if(!e.exists()||!c.exists()||!h.exists())throw Error('Tournament history context has not been prepared');
   const event=e.data(),context=c.data(),head=h.data();
   if(context.kind!=='tournament'||context.sourceId!==id)throw Error('Wrong history context');
   return {event:{...event,active:event.active&&context.active},head,bracket:project(event,head)};
  });},
  async review(id,matchId,input){const u=actor(),{event,head}=await this.load(id);same(u);if(!event.active)throw Error('Entry ended');const p=propose(event,head,matchId,input);
   return {...p,eventId:id,matchId,input:structuredClone(input),expectedRevision:head.revision,operationId:crypto.randomUUID(),actor:u};
  },
  async submit(review){same(review.actor);return history.submit({contextId:'t_'+review.eventId,operationId:review.operationId,matchId:review.matchId,expectedRevision:review.expectedRevision,input:review.input});},
  async audit(id){const u=actor();let cursor=null,rows=[];do{
   const q=s.query(s.collection(db,'hcContexts','t_'+id,'operations'),s.orderBy(s.documentId()),s.limit(50),...(cursor?[s.startAfter(cursor)]:[]));
   const page=await s.getDocsFromServer(q);same(u);rows.push(...page.docs.map(d=>({...d.data(),operation:d.data().kind,reason:''})));cursor=page.docs.length===50?page.docs.at(-1):null;
  }while(cursor);return rows.sort((a,b)=>a.revision-b.revision);}
 };
}
// Explicit scorer integration seam: no automatic recording or participant trimming.
export function submitCasualResult(session,{contextId,gameId,operationId,expectedRevision,result}) {
 return session.history.submit({contextId,matchId:gameId,operationId,expectedRevision,input:casualInput(result)});
}
export async function prepareTournamentHistory(session,eventId) {
 if(session.role!=='organizer')throw Error('Organizer required');
 return session.history.createContext({id:'t_'+eventId,kind:'tournament',sourceId:eventId});
}
