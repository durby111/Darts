import {template} from '../../tournament-device/model.mjs';
import {historyDesk,submitCasualResult} from './bridge.mjs';
import {BACKEND_KEY} from '../../js/backend-context.js';
const stable=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
const same=(session,u)=>{if(session.auth.currentUser!==u)throw Error('Session changed');};
async function read(session,...path){return session.storeSDK.getDocFromServer(session.storeSDK.doc(session.db,...path));}
export async function ensureContext(session,{id,kind,sourceId,gameType}) {
 const u=session.auth.currentUser,existing=await read(session,'hcContexts',id);same(session,u);
 if(existing.exists()){const c=existing.data();if(!c.active||c.kind!==kind||c.sourceId!==sourceId||(gameType&&c.gameType!==gameType))throw Error('Context differs or is closed');return id;}
 await session.history.createContext({id,kind,sourceId,gameType});same(session,u);return id;
}
export async function publishRoster(session,tournament,boardUid) {
 if(session.role!=='organizer'||session.auth.currentUser?.uid!==tournament.ownerId)throw Error('Organizer required');
 if(!boardUid)throw Error('Approved board assignment required');
 const expected=template(tournament,boardUid),u=session.auth.currentUser;
 const old=await read(session,'tdEvents',tournament.id);same(session,u);
 if(old.exists()){if(stable(old.data())!==stable(expected))throw Error('Published roster differs; do not overwrite it');}
 else await session.tournament.create(tournament,boardUid);
 same(session,u);
 // Retrying a partial source/context setup reuses the immutable source and never resets head.
 return ensureContext(session,{id:'t_'+tournament.id,kind:'tournament',sourceId:tournament.id});
}
export async function startCasual(session,{gameType,sides,persistSetup}) {
 if(session.role!=='board'||!['501','cricket'].includes(gameType))throw Error('Shared board supports 501 and Cricket');
 const u=session.auth.currentUser;
 const gameId=await session.pairing.createGame();same(session,u);
 const setup={backendKey:BACKEND_KEY,gameId,gameType,contextId:'g_'+gameId,boardUid:u.uid,teams:structuredClone(sides)};
 // Retain the allocated source ID before the separate context request, including failures.
 if(!persistSetup(setup))throw Error('Cannot retain shared-game setup locally');
 await ensureContext(session,{id:setup.contextId,kind:'casual',sourceId:gameId,gameType});same(session,u);return setup;
}
export async function casualRecording(session,setup) {
 const u=session.auth.currentUser;if(u?.uid!==setup.boardUid)throw Error('Wrong shared board');
 await ensureContext(session,{id:setup.contextId,kind:'casual',sourceId:setup.gameId,gameType:setup.gameType});
 const teams=structuredClone(setup.teams);let seat=0;
 for(const side of teams)for(const member of side.members){seat++;member.playerId=null;if(seat<=4){const p=await session.pairing.participation(setup.gameId,String(seat));same(session,u);if(p.active)member.playerId=p.uid;}}
 const ids=teams.flatMap(t=>t.members.map(m=>m.playerId)).filter(Boolean);if(new Set(ids).size!==ids.length)throw Error('Duplicate claimed player');
 return {backendKey:BACKEND_KEY,source:'casual',resultId:crypto.randomUUID(),ownerId:u.uid,gameType:setup.gameType,bestOf:1,teams,legWins:teams.map(()=>0),legComplete:false,winnerIndex:null,status:'scoring',history:{contextId:setup.contextId,gameId:setup.gameId,revision:0,actorUid:u.uid,role:'board'}};
}
export async function launchHistoryMatch(session,eventId,matchId) {
 const {event,head,bracket}=await historyDesk(session).load(eventId),m=bracket.matches.find(x=>x.id===matchId);
 if(!event.active||m?.status!=='ready')throw Error('Match is not ready');
 const teams=[m.teamA,m.teamB].map(id=>({id,name:event.teams[id].name,members:event.teams[id].memberIds.map(r=>({id:r,name:event.roster[r].label,playerId:event.roster[r].expectedUid}))}));
 return {backendKey:BACKEND_KEY,tournamentId:eventId,matchId,revision:head.revision,ownerId:session.auth.currentUser.uid,gameType:event.gameType,bestOf:event.bestOf,teams,resultId:crypto.randomUUID(),legWins:[0,0],legComplete:false,winnerIndex:null,status:'scoring',history:{contextId:'t_'+eventId,revision:head.revision,actorUid:session.auth.currentUser.uid,role:session.role}};
}
export async function saveHistoryRecording(session,recording,result,{persist}) {
 if(!recording.history||recording.backendKey!==BACKEND_KEY||recording.history.actorUid!==session.auth.currentUser?.uid)throw Error('Wrong history recording session');
 if(recording.status==='saved')return {replayed:true};
 // Freeze the original payload and operation ID before network I/O. Retry must not
 // re-review at a newer revision or silently overwrite an intervening result.
 if(!recording.pendingResult){
  const snapshot=structuredClone(result);
  if(recording.source==='casual'){for(const uid of snapshot.participantIds||[]){if(!snapshot.perPlayer.some(row=>row.playerId===uid))snapshot.perPlayer.push({playerId:uid,gameType:snapshot.gameType,points:0,darts:0,marks:0});}}
  recording.pendingResult=snapshot;
 }
 recording.status='pending';
 if(!persist())throw Error('Cannot retain result locally');
 const h=recording.history;let response;
 if(recording.source==='casual')response=await submitCasualResult(session,{contextId:h.contextId,gameId:h.gameId,operationId:recording.resultId,expectedRevision:h.revision,result:recording.pendingResult});
 else {const r=recording.pendingResult;response=await session.history.submit({contextId:h.contextId,matchId:recording.matchId,operationId:recording.resultId,expectedRevision:h.revision,input:{winnerId:r.winnerId,scoreA:r.scoreA,scoreB:r.scoreB,forfeit:false}});}
 recording.status='saved';persist();return response;
}
