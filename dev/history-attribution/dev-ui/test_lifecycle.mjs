import test from 'node:test';import assert from 'node:assert/strict';
import {startCasual,casualRecording,saveHistoryRecording,publishRoster,ensureContext} from './lifecycle.mjs';
import {provisionBoard} from './board-setup.mjs';
import {BACKEND_KEY} from '../../js/backend-context.js';
import * as engine from '../../js/brackets/engine.js';import {template} from '../../tournament-device/model.mjs';
function fixture(){const docs=new Map(),calls=[],auth={currentUser:{uid:'board'}};const session={role:'board',auth,db:{},storeSDK:{doc:(_,...p)=>p.join('/'),getDocFromServer:async p=>({exists:()=>docs.has(p),data:()=>structuredClone(docs.get(p))})},pairing:{createGame:async()=>{calls.push('create-game');docs.set('qrGames/game',{board:'board',active:true});return 'game';},participation:async(g,seat)=>({active:seat==='1',uid:seat==='1'?'alice':null})},history:{createContext:async x=>{calls.push('context');docs.set('hcContexts/'+x.id,{...x,active:true});},submit:async x=>{calls.push(structuredClone(x));return {}; }},tournament:{create:async(t,b)=>{calls.push('publish');docs.set('tdEvents/'+t.id,template(t,b));}}};return {session,docs,calls};}
const sides=[{id:'s1',name:'A',members:[{id:'r1',name:'A'}]},{id:'s2',name:'B',members:[{id:'r2',name:'B'}]}];
for(const gameType of ['501','cricket'])test(`${gameType}: shared setup, optional claim, result retention and stable retry`,async()=>{
 const f=fixture();let saved;const setup=await startCasual(f.session,{gameType,sides,persistSetup:x=>{saved=structuredClone(x);return true;}});assert.equal(saved.gameId,'game');
 const r=await casualRecording(f.session,setup);assert.equal(r.teams[0].members[0].playerId,'alice');assert.equal(r.teams[1].members[0].playerId,null);
 let attempts=0,persists=0;const submitted=[];f.session.history.submit=async x=>{submitted.push(structuredClone(x));if(++attempts===1)throw Error('Lost acknowledgement');return {replayed:true};};
 const result={gameType,participantIds:['alice','zero-darts'],perPlayer:[{playerId:'alice',gameType,points:30,darts:3,marks:gameType==='cricket'?3:0}]};
 await assert.rejects(saveHistoryRecording(f.session,r,result,{persist:()=>{persists++;return true;}}),/Lost/);assert.equal(r.status,'pending');
 await saveHistoryRecording(f.session,r,{...result,winnerId:'changed'},{persist:()=>true});
 assert.deepEqual(submitted[0],submitted[1]);assert.equal(submitted[0].input.perPlayer['zero-darts'].darts,0);assert.equal(r.status,'saved');assert(persists>0);
});
test('storage failure blocks result network send; wrong device cannot submit restored result',async()=>{
 const f=fixture(),r={backendKey:BACKEND_KEY,history:{actorUid:'board'},resultId:'r',source:'casual'};
 await assert.rejects(saveHistoryRecording(f.session,r,{gameType:'501',perPlayer:[]},{persist:()=>false}),/retain/);assert.equal(f.calls.length,0);
 f.session.auth.currentUser={uid:'other'};await assert.rejects(saveHistoryRecording(f.session,r,{}, {persist:()=>true}),/Wrong/);
});
test('allocated casual source retained if context setup fails and can resume without second game',async()=>{
 const f=fixture();let saved;const original=f.session.history.createContext;f.session.history.createContext=async()=>{throw Error('Offline');};
 await assert.rejects(startCasual(f.session,{gameType:'501',sides,persistSetup:x=>{saved=x;return true;}}),/Offline/);
 f.session.history.createContext=original;await casualRecording(f.session,saved);assert.equal(f.calls.filter(x=>x==='create-game').length,1);
});
function event(){let t=engine.createTournament({id:'event',ownerId:'owner',title:'Test',date:'2026-10-19',gameType:'501',bestOf:1});t=engine.saveRoster(t,Array.from({length:4},(_,i)=>({id:'r'+i,name:'P'+i,tag:String(Math.floor(i/2)+1),paid:true,checkedIn:true,standby:false})));return engine.startTournament(t);}
test('partial roster publication retries exact source without overwriting it or resetting head',async()=>{
 const f=fixture();f.session.role='organizer';f.session.auth.currentUser={uid:'owner'};const t=event(),original=f.session.history.createContext;
 f.session.history.createContext=async()=>{throw Error('Offline');};await assert.rejects(publishRoster(f.session,t,'board'),/Offline/);
 f.session.history.createContext=original;await publishRoster(f.session,t,'board');await publishRoster(f.session,t,'board');
 assert.equal(f.calls.filter(x=>x==='publish').length,1);assert.equal(f.calls.filter(x=>x==='context').length,1);
 await assert.rejects(publishRoster(f.session,{...t,title:'Changed'},'board'),/differs/);
});
test('closed/wrong context cannot be recycled',async()=>{const f=fixture();f.docs.set('hcContexts/g_x',{kind:'casual',sourceId:'x',active:false});await assert.rejects(ensureContext(f.session,{id:'g_x',kind:'casual',sourceId:'x',gameType:'501'}),/closed/);});
test('provisioning disabled before requesting any token or Auth operation',async()=>{
 let calls=0;await assert.rejects(provisionBoard({tokenProvider:async()=>{calls++;return 'not-a-token';},location:{origin:'https://blakeoutdarts.com',pathname:'/dev/history-attribution/dev-ui/'}}),/not released/);assert.equal(calls,0);
});
