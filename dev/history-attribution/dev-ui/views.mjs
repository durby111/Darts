import {mountPhoneConsent} from '../coherent/phone.mjs';
import {historyDesk} from './bridge.mjs';
import {HISTORY_DEV_RELEASE} from './config.mjs';
const id=v=>{if(typeof v!=='string'||!/^[-A-Za-z0-9_]{1,128}$/.test(v))throw Error('Invalid history link');return v;};
export function consentLink(eventId,registrationId) {
 const url=new URL(HISTORY_DEV_RELEASE.path,HISTORY_DEV_RELEASE.origin);
 url.hash=new URLSearchParams({view:'consent',context:'t_'+id(eventId),registration:id(registrationId)}).toString();return url.href;
}
export function consentParams(hash) {
 const q=new URLSearchParams(hash.replace(/^#/,''));
 const contextId=id(q.get('context')),registrationId=id(q.get('registration'));
 if(!/^[tg]_/.test(contextId))throw Error('Invalid history context');
 const seatId=q.get('seat')||'',invitationId=q.get('invitation')||'';
 if(contextId.startsWith('g_')&&(!/^[1-4]$/.test(seatId)||!/^[a-f0-9]{64}$/.test(invitationId)))throw Error('Invalid game seat link');
 if(contextId.startsWith('t_')&&(seatId||invitationId))throw Error('Wrong tournament consent scope');
 return {contextId,registrationId,seatId,invitationId};
}
export async function mountHistoryView(root,session,{view='history',hash=''}={}) {
 const user=session.auth.currentUser;
 const current=()=>{if(!user||session.auth.currentUser!==user)throw Error('Account changed. Reload to continue.');};
 const text=(tag,value,parent=root)=>{const e=root.ownerDocument.createElement(tag);e.textContent=value;parent.append(e);return e;};
 current();root.replaceChildren();
 if(view==='desk') {
  if(!['board','organizer'].includes(session.role))throw Error('A result desk session is required');
  const {mountDesk}=await import('../../tournament-device/ui.mjs');current();
  return mountDesk(root,{...session,label:'DEV tournament results',api:historyDesk(session),identityLink:consentLink});
 }
 if(session.role==='board')throw Error('Shared devices cannot open personal history');
 if(view==='consent') {
  const params=consentParams(hash),key=crypto.randomUUID();
  return mountPhoneConsent(root,{
   async consentDetails(p){const d=await session.history.consentDetails(p);current();return d;},
   async confirm(p){current();await session.history.confirm(p);current();}
  },{...params,bindingId:'b_'+key,grantId:'g_'+key,expiresAt:Date.now()+11*60*60*1000});
 }
 if(view!=='history')throw Error('Unknown history view');
 text('h1','Your linked history');text('p','Refresh each consent scope to recover accepted results and later corrections. Refresh may need repeating while results are still arriving.');
 const status=text('p','');status.setAttribute('role','status');
 let cursor=null;
 do {
  const batch=await session.history.grants(cursor);current();
  for(const grant of batch.grants){const item=text('section','');text('h2',grant.scope==='named-tournament'?'Tournament '+grant.contextId:'Game '+grant.contextId,item);
   const records=text('div','',item);
   const refresh=text('button','Refresh history',item),revoke=text('button','Stop future attribution',item);refresh.type=revoke.type='button';
   const action=async(button,fn)=>{button.disabled=true;try{current();await fn();current();}catch(e){if(session.auth.currentUser===user)status.textContent=e.message;}finally{button.disabled=false;}};
   refresh.onclick=()=>action(refresh,async()=>{
    await session.history.sync(grant.id);current();const {storeSDK:s,db}=session;let after=null,rows=[];
    do {const q=s.query(s.collection(db,'hcOwners',user.uid,'contexts',grant.contextId,'history'),s.orderBy(s.documentId()),s.limit(50),...(after?[s.startAfter(after)]:[]));const page=await s.getDocsFromServer(q);current();rows.push(...page.docs.map(d=>d.data()));after=page.docs.length===50?page.docs.at(-1):null;}while(after);
    records.replaceChildren();for(const row of rows){text('p',`${row.occurrenceId} · revision ${row.revision} · ${row.status}`,records);if(row.status==='active'&&row.counter){const c=row.counter;text('p',Object.hasOwn(c,'darts')?`${c.points} points · ${c.darts} darts · ${c.marks} marks`:`${c.scoreA} — ${c.scoreB}`,records);}}
    status.textContent='History refreshed. New results may arrive after this refresh.';
   });
   revoke.onclick=()=>action(revoke,async()=>{await session.history.revoke(grant.id);current();status.textContent='Future attribution stopped. Earlier accepted results remain correctable.';});
  }
  cursor=batch.cursor;
 }while(cursor);
}
