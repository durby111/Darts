import assert from 'node:assert/strict';
import { createTournament, saveRoster, startTournament, recordResult, canCorrect } from '../js/brackets/engine.js';
import { buildLayout } from '../js/brackets/diagram.js';
import { activeScorerMatch } from '../js/brackets/scorer-status.js';
const reopen = t => JSON.parse(JSON.stringify(t));
let paths=0, decisions=0, corrected=0, byes=0;
function result(t,m,side) { return recordResult(t,m.id,{winnerId:m[side],scoreA:side==='teamA'?1:0,scoreB:side==='teamB'?1:0}); }
function check(t) {
 const codes=new Map(t.matches.map(m=>[m.code,m]));
 for(const m of t.matches) for(const side of ['A','B']) {
  const s=m['source'+side];if(!s?.matchCode)continue;
  const from=codes.get(s.matchCode); assert.ok(from);
  if(from.status==='complete') {
   const expected=s.outcome==='winner'?from.winnerId:[from.teamA,from.teamB].find(id=>id!==from.winnerId);
   // A void conditional reset has no participating teams.
   if(m.status!=='void')assert.equal(m['team'+side],expected,`${m.code} ${side} feed from ${from.code}`);
  }
 }
 const layout=buildLayout(t.matches);
 assert.equal(layout.connectors.length,t.matches.reduce((n,m)=>n+['A','B'].filter(s=>m['source'+s]?.matchCode).length,0));
 assert.deepEqual(reopen(t),t,'JSON save/reopen retains exact state');
}
for(let count=5;count<=20;count++)for(const reset of [false,true]) {
 let t=createTournament({id:`TEST-${count}-${reset}`,ownerId:'TEST-owner',title:`TEST ${count}`,date:'2026-10-17',gameType:'301',bestOf:1});
 t=saveRoster(t,Array.from({length:count*2},(_,i)=>({id:`TEST-${i}`,name:`TEST Player ${i}`,tag:String(Math.floor(i/2)+1),paid:true,checkedIn:true,standby:false})));
 t=startTournament(t);byes+=t.matches.filter(m=>m.status==='bye').length;check(t);
 const first=t.matches.find(m=>m.status==='ready');
 const session={tournament:{tournamentId:t.id,matchId:first.id,localOnly:true,status:'scoring',teams:[{id:first.teamA},{id:first.teamB}]}};
 assert.equal(activeScorerMatch(t,true,{getItem:()=>JSON.stringify(session)}),first.id);
 assert.equal(activeScorerMatch(t,false,{getItem:()=>JSON.stringify(session)}),null);
 assert.equal(activeScorerMatch(t,true,{getItem:()=>'{broken'}),null);
 t=result(t,first,'teamA');assert.equal(activeScorerMatch(t,true,{getItem:()=>JSON.stringify(session)}),null);
 assert.ok(canCorrect(t,t.matches.find(m=>m.id===first.id)));
 t=result(t,t.matches.find(m=>m.id===first.id),'teamB');corrected++;check(t);
 let played=1;
 while(t.status!=='complete') {
  const m=t.matches.find(m=>m.status==='ready');assert.ok(m,'No deadlocked tournament');
  const side=m.code==='GF1'?(reset?'teamB':'teamA'):(played%2?'teamB':'teamA');
  const before=JSON.stringify(t);const next=result(t,m,side);assert.equal(JSON.stringify(t),before,'Input immutable');
  t=reopen(next);check(t);played++;assert.ok(played<=count*2);
 }
 const gf2=t.matches.find(m=>m.code==='GF2');assert.equal(gf2.status,reset?'complete':'void');
 assert.equal(played,count*2-2+Number(reset));
 const final=t.matches.find(m=>m.code===(reset?'GF2':'GF1'));const losses=new Map(t.teams.map(x=>[x.id,0]));
 for(const m of t.matches.filter(m=>m.status==='complete'))losses.set(m.winnerId===m.teamA?m.teamB:m.teamA,losses.get(m.winnerId===m.teamA?m.teamB:m.teamA)+1);
 for(const [id,n] of losses)assert.equal(n,id===final.winnerId?Number(reset):2,'Double-elimination loss count');
 assert.equal(canCorrect(t,t.matches.find(m=>m.id===first.id)),false);
 assert.throws(()=>result(t,t.matches.find(m=>m.id===first.id),'teamA'),/dependent/);
 decisions+=played;paths++;console.log(`PASS ${count} teams ${reset?'reset-final':'upper-final'}: ${played} played, source feeds, correction, loss counts, JSON reopen`);
}
console.log(JSON.stringify({paths,decisions,corrected,byes,scope:'pure engine and presentation layout; JSON roundtrip, not browser persistence or scorer UI'}));
