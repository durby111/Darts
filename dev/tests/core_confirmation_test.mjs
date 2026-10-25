import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as engine from '../js/brackets/engine.js';

class Element extends EventTarget {
    constructor(tag, doc) { super(); this.tag = tag; this.doc = doc; this.children = []; this.style = {}; this.isConnected = true; }
    set id(v) { this._id=v; this.doc.nodes.set(v,this); } get id(){return this._id;}
    append(...items){this.children.push(...items);} prepend(...items){this.children.unshift(...items);}
    after(){} replaceChildren(...items){this.children=items;} setAttribute(k,v){this[k]=v;} toggleAttribute(){}
    focus(){this.doc.activeElement=this;} remove(){this.isConnected=false;}
    showModal(){this.open=true;} close(){this.open=false;this.dispatchEvent(new Event('close'));}
    click(){this.dispatchEvent(new Event('click'));}
}
function dom(){
    const d={nodes:new Map(),createElement(tag){return new Element(tag,this);},getElementById(id){return this.nodes.get(id)||null;},querySelector(){return this.body;}};
    d.body=d.createElement('body'); d.activeElement=d.createElement('button');
    for(const id of ['gameScreen','playAgainBtn','newGameBtn','winnerCancelBtn']){const el=d.createElement('div');el.id=id;}
    return d;
}
const file = name => readFile(new URL(name,import.meta.url),'utf8');
function synthetic(context, values){return new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v] of Object.entries(values))this.setExport(k,v);},{context});}

async function dialogFixture(){
    const document=dom(), window=new EventTarget();
    const context=vm.createContext({document,window,Promise});
    const mod=new vm.SourceTextModule(await file('../js/confirm-action.js'),{context});
    await mod.link(()=>{}); await mod.evaluate();
    return {document,window,ask:mod.namespace.confirmAction,dialog:()=>document.body.children.at(-1)};
}
test('in-page confirm: accessible labels, Cancel initial focus, one decision and restored focus',async()=>{
    const f=await dialogFixture(), previous=f.document.activeElement;
    const p=f.ask('No cloud writes',{title:'Save?',confirmLabel:'Save result'}), d=f.dialog();
    assert.equal(d['aria-labelledby'],'actionConfirmTitle'); assert.equal(d['aria-describedby'],'actionConfirmMessage');
    assert.equal(f.document.activeElement.textContent,'Cancel');
    const backwards=new Event('keydown',{cancelable:true}); Object.assign(backwards,{key:'Tab',shiftKey:true}); d.dispatchEvent(backwards);
    assert.equal(f.document.activeElement.textContent,'Save result');
    const forwards=new Event('keydown',{cancelable:true}); Object.assign(forwards,{key:'Tab',shiftKey:false}); d.dispatchEvent(forwards);
    assert.equal(f.document.activeElement.textContent,'Cancel');
    assert.equal(await f.ask('duplicate'),false);
    const accept=d.children[2].children[1]; accept.click(); accept.click();
    assert.equal(await p,true); assert.equal(d.isConnected,false); assert.equal(f.document.activeElement,previous);
});
test('Cancel, Escape, unexpected close and navigation all decline without accepting',async()=>{
    for(const action of ['cancel','escape','close','pagehide']){
        const f=await dialogFixture(),p=f.ask('save'),d=f.dialog();
        if(action==='cancel')d.children[2].children[0].click();
        if(action==='escape')d.dispatchEvent(new Event('cancel',{cancelable:true}));
        if(action==='close')d.close();
        if(action==='pagehide')f.window.dispatchEvent(new Event('pagehide'));
        assert.equal(await p,false,action); assert.equal(d.isConnected,false);
    }
});

async function bridgeFixture(){
    let tournament=engine.createTournament({id:'synthetic',ownerId:'device-organizer',title:'QA',date:'2026-10-25',gameType:'501',bestOf:1});
    tournament=engine.saveRoster(tournament,Array.from({length:4},(_,i)=>({id:'p'+i,name:'Guest '+i,tag:String(Math.floor(i/2)+1),paid:true,checkedIn:true,standby:false})));
    tournament=engine.startTournament(tournament);
    const match=tournament.matches.find(m=>m.status==='ready');
    const teams=[match.teamA,match.teamB].map(id=>{const t=tournament.teams.find(t=>t.id===id);return {id,name:t.name,members:t.memberIds.map(id=>({id,playerId:null,name:tournament.registrations.find(r=>r.id===id).name}))};});
    const game={tournament:{tournamentId:tournament.id,matchId:match.id,ownerId:'device-organizer',gameType:'501',bestOf:1,teams,resultId:'same-receipt',winnerIndex:0,legWins:[1,0],status:'scoring'},scoringRecords:{legs:[]}};
    const document=dom(),location={href:'original'}, calls={writes:0,local:0,questions:0}; let answer;
    const confirmAction=()=>{calls.questions++;return new Promise(resolve=>{answer=resolve;});};
    const api={initPlatform:async()=>{},requireVerifiedAccount:async()=>{},getAccount:()=>({uid:'device-organizer'}),getTournament:async()=>tournament,saveMatchResult:async(_id,_rev,receipt,_result,update)=>{calls.writes++;assert.equal(receipt,'same-receipt');tournament=update(tournament);}};
    const imports={
        './backend-context.js':{BACKEND_KEY:'dev',requireCurrentBackend:()=>{}},
        './state.js':{game,recordingSession:()=>null,saveActiveGame:()=>{calls.local++;return true;},loadActiveGame:()=>null,restoreActiveGame:()=>{},saveGameState:()=>{}},
        './setup.js':{launchTournamentScorer:()=>{},resumeGame:()=>{}},
        './ui.js':{showModal:()=>{},hideModal:()=>{}}, './cricket.js':{updateCricketDisplay:()=>{}},
        './scoring-records.js':{newRecordId:()=>'',finishScoringLeg:()=>{},scoringResult:()=>({}),tournamentScoringLocked:()=>false,RECORDING_GAMES:new Set(['501']),recordingComplete:()=>true,recordingWinnerIds:()=>[],pendingDartCount:()=>0},
        './casual-recording.js':{saveCasualResult:()=>{}},'./brackets/labels.js':{registrationLabels:()=>[]},
        './feature-availability.js':{isFeatureAvailable:()=>false},'./brackets/engine.js':engine,
        './build-context.js':{BUILD_STORAGE:{matchRecoveryPrefix:'qa'},LOCAL_TOURNAMENT:true},
        './confirm-action.js':{confirmAction},'../local/platform.js':api
    };
    const context=vm.createContext({document,location,URL,URLSearchParams,Date,console});
    const modules=new Map();
    async function dependency(name){if(!modules.has(name)){const m=synthetic(context,imports[name]);modules.set(name,m);await m.link(()=>{});await m.evaluate();}return modules.get(name);}
    const mod=new vm.SourceTextModule(await file('../js/tournament-bridge.js'),{context,initializeImportMeta(meta){meta.url='https://blakeoutdarts.com/dev/js/tournament-bridge.js';},importModuleDynamically:dependency});
    await mod.link(dependency);await mod.evaluate();
    return {game,calls,document,location,bridge:mod.namespace,answer:v=>answer(v),tournament:()=>tournament};
}
test('cancel writes nothing; confirmed save advances once despite duplicate calls',async()=>{
    const f=await bridgeFixture();let pending=f.bridge.saveTournamentResult();
    await f.bridge.saveTournamentResult();assert.equal(f.calls.questions,1);
    f.answer(false);await pending;assert.equal(f.calls.writes,0);assert.equal(f.calls.local,0);assert.equal(f.game.tournament.status,'scoring');
    pending=f.bridge.saveTournamentResult();f.answer(true);await pending;
    assert.equal(f.calls.writes,1);assert.equal(f.game.tournament.status,'saved');assert.equal(f.tournament().matches.find(m=>m.id==='GF1').status,'ready');
    await f.bridge.saveTournamentResult();assert.equal(f.calls.writes,1);assert.equal(f.calls.questions,2);
});
test('a changed match while confirmation is open is not saved',async()=>{
    const f=await bridgeFixture();const pending=f.bridge.saveTournamentResult();
    f.game.tournament.legWins=[0,1];f.answer(true);await pending;assert.equal(f.calls.writes,0);assert.equal(f.calls.local,0);
});
test('Return cannot race Save; cancelling navigation preserves page; confirmed return only persists locally',async()=>{
    const f=await bridgeFixture();f.bridge.renderTournamentControls();
    const returnButton=f.document.getElementById('tournamentReturn');
    let pending=f.bridge.saveTournamentResult();returnButton.click();assert.equal(f.calls.questions,1);f.answer(false);await pending;
    // The UI's 450 ms tap guard is intentional; invoke the stored callback only
    // through a fresh bridge instance for the independent navigation scenario.
    const n=await bridgeFixture();n.bridge.renderTournamentControls();n.document.getElementById('tournamentReturn').click();n.answer(false);
    await new Promise(resolve=>setImmediate(resolve));assert.equal(n.location.href,'original');assert.equal(n.calls.local,0);
    const y=await bridgeFixture();y.bridge.renderTournamentControls();y.document.getElementById('tournamentReturn').click();y.answer(true);
    await new Promise(resolve=>setImmediate(resolve));assert.match(y.location.href,/local\/brackets\/\?id=synthetic$/);assert.equal(y.calls.local,1);assert.equal(y.calls.writes,0);
});
