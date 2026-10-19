import * as engine from '../js/brackets/engine.js';
export function template(t,boardUid){
  if(t.status!=='live'||t.teams.length<2||t.teams.length>20)throw Error('Start a 2–20 team tournament first');
  if(t.matches.some(m=>m.status==='complete'))throw Error('Publish before entering any results');
  const roster=Object.fromEntries(t.registrations.map(r=>[r.id,{label:r.name,expectedUid:r.playerId??null}]));
  const teams=Object.fromEntries(t.teams.map(x=>[x.id,{name:x.name,memberIds:x.memberIds}]));
  if(t.teams.some(x=>x.memberIds.length!==2))throw Error('This candidate supports doubles teams');
  // Collapse structural byes once, while the trusted organizer creates the
  // immutable template. Runtime rules need only immediate competitive sources.
  const topology={},outcomes={};
  const source=s=>!s||'teamId' in s?s:outcomes[s.matchCode][s.outcome];
  for(const m of t.matches){const a=source(m.sourceA),b=source(m.sourceB);topology[m.id]={sourceA:a,sourceB:b};outcomes[m.code]=!a||!b?{winner:a||b,loser:null}:{winner:{matchCode:m.code,outcome:'winner'},loser:{matchCode:m.code,outcome:'loser'}};}
  const descendants={};
  for(const m of t.matches){const found=new Set([m.code]);for(const n of t.matches)if([n.sourceA,n.sourceB].some(s=>s?.matchCode&&found.has(s.matchCode)))found.add(n.code);found.delete(m.code);descendants[m.id]=[...found];}
  // No payment flags, emails, credentials or private resume payloads in projection.
  const seed={id:t.id,ownerId:t.ownerId,title:t.title,gameType:t.gameType,bestOf:t.bestOf,status:t.status,revision:0,teams:t.teams.map(x=>({id:x.id,name:x.name,memberIds:x.memberIds})),registrations:t.registrations.map(r=>({id:r.id,name:r.name,playerId:null})),matches:t.matches};
  return {eventId:t.id,ownerUid:t.ownerId,boardUid,title:t.title,gameType:t.gameType,bestOf:t.bestOf,active:true,rosterRevision:0,teams,roster,topology,descendants,seed:JSON.stringify(seed)};
}
export function project(event,head){
  let t=JSON.parse(event.seed);
  for(const m of t.matches){const r=head.results[m.id];if(r)t=engine.recordResult(t,m.id,r);}
  t.revision=head.revision;return t;
}
export function propose(event,head,matchId,input){
  const t=project(event,head),m=t.matches.find(x=>x.id===matchId);
  if(!m)throw Error('Choose a match from this tournament');
  const blocked=event.descendants[matchId].filter(id=>head.results[id]);
  if(blocked.length)throw Error('Undo completed dependent matches first, in reverse order: '+blocked.reverse().join(', '));
  const results=structuredClone(head.results),before=results[matchId]??null;
  if(input.operation==='undo'){if(!before)throw Error('This match has no result to undo');delete results[matchId];}
  else {const next=engine.recordResult(t,matchId,input),updated=next.matches.find(x=>x.id===matchId);results[matchId]={teamA:updated.teamA,teamB:updated.teamB,winnerId:updated.winnerId,scoreA:updated.scoreA,scoreB:updated.scoreB,forfeit:updated.forfeit,players:[]};}
  const next=project(event,{...head,results});
  const affected=next.matches.filter((x,i)=>JSON.stringify(x)!==JSON.stringify(t.matches[i])).map(x=>x.id);
  return {before,after:results[matchId]??null,results,affected,operation:input.operation==='undo'?'undo':before?'correct':'record'};
}
export function registrations(event,result){return [...event.teams[result.teamA].memberIds,...event.teams[result.teamB].memberIds];}
