/** Real casual-recording control flow, stubbed platform API. NOT rules enforcement. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../js/casual-recording.js',import.meta.url),'utf8');
for(const scenario of ['two-linked-denial','self-only-success','directory-denial','unsupported-game','other-only','self-cricket-success']) {
 const ids=scenario==='two-linked-denial'?['alice','bob']:scenario==='other-only'?['bob']:['alice'];
 const gameType=scenario==='unsupported-game'?'301':scenario==='self-cricket-success'?'cricket':'501';
 const result={participantIds:ids,perPlayer:ids.map(playerId=>({playerId,gameType,points:501,darts:9,marks:0})),gameType};
 const game={recording:{ownerId:'alice',backendKey:'synthetic',resultId:'stable-id',gameType,status:'pending'},scoringRecords:{legs:[{id:'leg'}]},undoHistory:[1],redoHistory:[]};
 const notifications=[],snapshots=[],submitted=[],storage=new Map();let writes=0;
 const ctx=vm.createContext({console,Date,URL,confirm:()=>true,document:{dispatchEvent:e=>notifications.push(e.detail.message),getElementById:()=>null},CustomEvent:class{constructor(type,init){this.detail=init.detail;}},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)}});
 const denied=()=>Object.assign(new Error('PERMISSION_DENIED'),{code:'permission-denied'});
 const api={initPlatform:async()=>{},requireVerifiedAccount:()=>({uid:'alice'}),getProfilesByIds:async()=>{if(scenario==='directory-denial')throw denied();return [{id:'alice'},{id:'bob'}];},saveCasualResult:async(id,payload)=>{submitted.push(JSON.parse(JSON.stringify(payload)));if(scenario==='two-linked-denial')throw denied();writes++;}};
 const exportsByPath={
 './backend-context.js':{BACKEND_KEY:'synthetic',requireCurrentBackend:()=>{}},
 './state.js':{game,recordingSession:()=>game.recording,saveActiveGame:()=>{snapshots.push(JSON.parse(JSON.stringify(game)));return true;},restoreActiveGame:()=>{},localRecordingRecoveries:()=>[]},
 './ui.js':{showModal:()=>{},hideModal:()=>{}},
 './scoring-records.js':{RECORDING_GAMES:[],newRecordId:()=>'',recordingComplete:()=>true,recordingWinnerIds:()=>['side-a'],scoringResult:()=>structuredClone(result)},
 './feature-availability.js':{isFeatureAvailable:()=>true},'./build-context.js':{BUILD_STORAGE:{casualRecoveryPrefix:'synthetic-'}},'./platform.js':api};
 const modules=new Map();
 async function load(path){if(modules.has(path))return modules.get(path);const values=exportsByPath[path];assert(values,path);const mod=new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v] of Object.entries(values))this.setExport(k,v);},{context:ctx});modules.set(path,mod);await mod.link(()=>{});await mod.evaluate();return mod;}
 const mod=new vm.SourceTextModule(source,{context:ctx,importModuleDynamically:load});await mod.link(load);await mod.evaluate();
 await mod.namespace.saveCasualResult();
 assert.deepEqual(JSON.parse(JSON.stringify(game.recording.pendingResult.participantIds)),ids);
 assert.equal(game.recording.resultId,'stable-id');assert(snapshots.length>0);
 if(['self-only-success','self-cricket-success'].includes(scenario)){assert.equal(game.recording.status,'saved');assert.equal(writes,1);assert(notifications.some(x=>x.startsWith('Casual result saved')));}
 else{assert.equal(game.recording.status,'pending');assert.equal(writes,0);assert(notifications.some(x=>x.startsWith('Not saved:')&&x.includes('Kept on this device')));assert.equal(game.undoHistory.length,1);assert(notifications.some(x=>x.includes('current access policy')&&x.includes('Linked players have not been removed')));await mod.namespace.saveCasualResult();assert.equal(game.recording.status,'pending');assert.equal(writes,0);}
 if(['two-linked-denial','other-only','unsupported-game'].includes(scenario))assert.equal(submitted.length,0);
 if(scenario==='two-linked-denial')assert(submitted.every(x=>JSON.stringify(x.participantIds)==='["alice","bob"]'));
 if(scenario==='directory-denial')assert.equal(submitted.length,0);
 console.log('PASS save compatibility '+scenario+'; no participant trimming');
}
