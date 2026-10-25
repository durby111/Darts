import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../js/brackets/engine.js';
import * as adapter from '../local/platform.js';
const memory = new Map();
globalThis.localStorage = {getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v),key:i=>[...memory.keys()][i],get length(){return memory.size;}};
Object.defineProperty(globalThis,'navigator',{value:{locks:{request:async(_key,callback)=>callback()}},configurable:true});
function fixture(){
 let t=engine.createTournament({id:'synthetic',ownerId:'device-organizer',title:'Isolated verification',date:'2026-10-25',gameType:'501',bestOf:1});
 t=engine.saveRoster(t,Array.from({length:4},(_,i)=>({id:'p'+i,name:'Guest '+i,tag:String(Math.floor(i/2)+1),paid:true,checkedIn:true,standby:false})));
 return engine.startTournament(t);
}
const result=(m,winner)=>({matchId:m.id,winnerId:winner,scoreA:winner===m.teamA?1:0,scoreB:winner===m.teamB?1:0});
test('save advances bracket; duplicate receipt does not undo correction; dependent result blocks correction',async()=>{
 memory.clear(); let t=fixture();
 memory.set(adapter.STORAGE_KEY,JSON.stringify({version:1,events:{synthetic:t},results:{},corrections:[]}));
 const first=t.matches.find(m=>m.status==='ready'),r=result(first,first.teamA);
 t=await adapter.saveMatchResult(t.id,t.revision,'receipt-1',r,current=>engine.recordResult(current,first.id,r));
 assert.equal(t.matches.find(m=>m.id==='GF1').status,'ready');
 const revision=t.revision;
 const retry=await adapter.saveMatchResult(t.id,revision-1,'receipt-1',{...r},()=>{throw Error('must not rerun');});
 assert.equal(retry.revision,revision);
 const corrected=result(first,first.teamB);
 t=await adapter.updateTournament(t.id,t.revision,current=>engine.recordResult(current,first.id,corrected));
 assert.equal(JSON.parse(memory.get(adapter.STORAGE_KEY)).corrections.length,1);
 const afterRetry=await adapter.saveMatchResult(t.id,revision-1,'receipt-1',r,()=>{throw Error('must not rerun');});
 assert.equal(afterRetry.matches.find(m=>m.id===first.id).winnerId,first.teamB);
 const gf=t.matches.find(m=>m.id==='GF1');
 t=await adapter.updateTournament(t.id,t.revision,current=>engine.recordResult(current,gf.id,result(gf,gf.teamA)));
 assert.equal(t.status,'complete');
 await assert.rejects(adapter.updateTournament(t.id,t.revision,current=>engine.recordResult(current,first.id,r)),/dependent match/);
 await assert.rejects(adapter.saveMatchResult(t.id,t.revision,'receipt-1',{...r,winnerId:'wrong'},()=>{}),/different scoring/);
});
test('lower bracket wins GF1: reset is required and its result completes tournament',()=>{
 let t=fixture(); const first=t.matches.find(m=>m.status==='ready');
 t=engine.recordResult(t,first.id,result(first,first.teamA));
 const gf=t.matches.find(m=>m.id==='GF1');
 t=engine.recordResult(t,gf.id,result(gf,gf.teamB));
 assert.equal(t.status,'live'); const reset=t.matches.find(m=>m.id==='GF2');
 assert.equal(reset.status,'ready');
 t=engine.recordResult(t,reset.id,result(reset,reset.teamA)); assert.equal(t.status,'complete');
});
