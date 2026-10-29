import assert from 'node:assert/strict';
import {LEVELS,x01Turn,cricketTurn,strength,recordPracticeTurn} from '../js/botblake-engine.js';
let seed=7;const rng=()=>((seed=(seed*1664525+1013904223)>>>0)/2**32);
const state=(skill='medium',type='501')=>({type,finishType:'double-out',currentPlayer:1,players:[{history:[60,60],throws:2,totalMarks:4},{score:501,history:[],bot:{skill}}]});
let previous=0;
for(const skill of Object.keys(LEVELS)) {
 const s=state(skill);let total=0;const outcomes=new Set();
 for(let i=0;i<10000;i++){const t=x01Turn(s,rng);total+=t.score;outcomes.add(t.score);assert(t.darts.every(d=>d.n>=0&&d.n<=25&&d.m<=3));}
 const avg=total/10000;assert(avg>previous);assert(outcomes.size>3);previous=avg;console.log(skill,avg.toFixed(2));
}
const s=state('auto');assert(Math.abs(strength(s,s.players[1].bot)-(60-4.5)/133.5)<.001);
s.players[0].history=[0,0];assert(strength(s,s.players[1].bot)<.1);
s.players[0].history=[100,100];assert(strength(s,s.players[1].bot)>.7);
for(const finishType of ['open','double-out','double-in-out']) for(let remaining=2;remaining<=170;remaining++) {
 const q=state('expert');q.finishType=finishType;q.players[1].score=remaining;
 for(let i=0;i<12;i++) {const t=x01Turn(q,rng);if(!t.bust&&t.score===remaining&&finishType!=='open') assert.equal(t.darts.at(-1).m,2);assert(t.bust||remaining-t.score>=0);}
}
const q=state('expert');q.players[1].score=32;assert.equal(x01Turn(q,()=>0).score,32);assert.equal(x01Turn(q,()=>.7).bust,false);
q.finishType='double-in-out';assert.equal(x01Turn(q,()=>.7).score,0);
for(const type of ['cricket','spanish','cutthroat']) {
 const c=state('auto',type);c.cricketPoints=true;c.cricketTargets=['20','19','Bull'];
 c.players.forEach(p=>{p.score=0;p.cricketData=Object.fromEntries(c.cricketTargets.map(t=>[t,{marks:0,closed:false}]))});
 assert(Math.abs(strength(c,c.players[1].bot)-2/6.9)<.001);
 const darts=cricketTurn(c,()=>0);assert.deepEqual(darts.map(d=>d.target),['20','19','Bull']);assert.equal(darts[2].multiplier,2);
}
const team=state();team.teamMode=true;team.teams=[{rotationIndex:0,members:[{name:'H'}]},{rotationIndex:0,members:[{bot:{skill:'auto'}},{bot:{skill:'easy'}}]}];
team.currentPlayer=0;recordPracticeTurn(team,90,3);assert.equal(strength(team,team.teams[1].members[0].bot),(90-4.5)/133.5);assert.equal(strength(team,team.teams[1].members[1].bot),.25);
console.log('PASS legal finishes, double-in, variation, ordering, Auto points/marks and team isolation');

let lastMarks=0;
for (const skill of Object.keys(LEVELS)) {
 const c=state(skill,'cricket');c.cricketPoints=true;c.cricketTargets=['20','19','18','17','16','15','Bull'];
 c.players.forEach(p=>{p.score=0;p.cricketData=Object.fromEntries(c.cricketTargets.map(t=>[t,{marks:0,closed:false}]))});
 let marks=0;for(let i=0;i<10000;i++)marks+=cricketTurn(c,rng).reduce((n,d)=>n+(d.target==='MISS'?0:d.multiplier),0);
 assert(marks>lastMarks);lastMarks=marks;console.log(skill,'Cricket marks/turn',(marks/10000).toFixed(2));
}
