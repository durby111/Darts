import {openDevHistorySession} from './session.mjs';
import {startCasual,casualRecording,saveHistoryRecording,launchHistoryMatch,publishRoster} from './lifecycle.mjs';
import {HISTORY_DEV_RELEASE,BOARD_SETUP} from './config.mjs';
const SETUP_KEY='blakeout_dev_coherent_setup_v1';
export async function prepareSharedCasual(playerSeeds,teams,gameType) {
 const session=await openDevHistorySession('board');
 const sides=teams?teams.map((t,i)=>({id:'side-'+(i+1),name:t.name,members:t.members.map((m,j)=>({id:`human-${i+1}-${j+1}`,name:m.name,playerId:null}))})):playerSeeds.map((p,i)=>({id:'side-'+(i+1),name:p.name,members:[{id:`human-${i+1}-1`,name:p.name,playerId:null}]}));
 const persistSetup=x=>{localStorage.setItem(SETUP_KEY,JSON.stringify(x));return true;};
 let setup=JSON.parse(localStorage.getItem(SETUP_KEY)||'null');
 if(setup&&setup.boardUid!==session.auth.currentUser.uid)throw Error('An unfinished setup belongs to another board session.');
 if(setup&&(setup.gameType!==gameType||JSON.stringify(setup.teams)!==JSON.stringify(sides))){
  if(!confirm('End the unfinished shared-game setup and start this different game?'))return null;
  await session.pairing.end(setup.gameId);localStorage.removeItem(SETUP_KEY);setup=null;
 }
 setup??=await startCasual(session,{gameType,sides,persistSetup});
 const dialog=document.createElement('dialog'),status=document.createElement('p'),slots=sides.flatMap(t=>t.members);dialog.append(status);
 status.textContent='Optional phone claims identify history owners. Anyone at this tablet can score. Only the first four seats support QR claims; remaining seats are guests.';
 const add=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;dialog.append(e);return e;};
 for(let i=0;i<Math.min(slots.length,4);i++){
  const button=add('button','Pair '+slots[i].name);button.type='button';
  button.onclick=async()=>{button.disabled=true;try{const invite=await session.pairing.pair(setup.gameId,String(i+1));const url=new URL(HISTORY_DEV_RELEASE.path,HISTORY_DEV_RELEASE.origin);url.hash=new URLSearchParams({view:'claim',context:setup.contextId,registration:slots[i].id,seat:String(i+1),invitation:invite.handle});const link=add('a','Open on player phone');link.href=url.href;add('p','Pairing code: '+invite.code);await import('../../qr-seat/qr.js');const qr=add('div','');qr.innerHTML=window.makeQR(url.href);}catch(e){status.textContent=e.message;}finally{button.disabled=false;}};
 }
 document.body.append(dialog);dialog.showModal();
 return new Promise(resolve=>{
  const finish=()=>{dialog.close();dialog.remove();};
  const start=add('button','Start shared recorded game');start.onclick=async()=>{start.disabled=true;try{const recording=await casualRecording(session,setup);localStorage.removeItem(SETUP_KEY);finish();resolve({playerSeeds:teams?playerSeeds:recording.teams.map(t=>t.members[0]),teams:teams?recording.teams:null,recording});}catch(e){status.textContent=e.message;}finally{start.disabled=false;}};
  const cancel=add('button','Cancel — keep setup for retry');cancel.onclick=()=>{finish();resolve(null);};
  dialog.oncancel=e=>{e.preventDefault();finish();resolve(null);};
 });
}
export async function saveFromScorer(recording,result,persist) {
 const session=await openDevHistorySession(recording.history.role);
 return saveHistoryRecording(session,recording,result,{persist});
}
export async function launchFromScorerURL() {
 const q=new URLSearchParams(location.search),role=q.get('role')||'board';
 const session=await openDevHistorySession(role);
 return launchHistoryMatch(session,q.get('event'),q.get('match'));
}
export async function prepareRosterDesk(tournament) {
 const session=await openDevHistorySession('organizer');
 if(!BOARD_SETUP.authorizationReference)throw Error('Board assignment has not been approved');
 await publishRoster(session,tournament,BOARD_SETUP.uid);
 const url=new URL(HISTORY_DEV_RELEASE.path,HISTORY_DEV_RELEASE.origin);url.hash='view=desk&role=organizer';return url.href;
}
