import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);const {JSDOM}=require(process.env.BLAKEOUT_JSDOM_MODULE||'/tmp/blakeout-qa-node/node_modules/jsdom');
const dom=new JSDOM('<select id="gameType"><option value="501">501</option></select><input id="recordCasualStats" type="checkbox" checked>');
const rows=Array.from({length:55},(_,i)=>({id:`u${String(i).padStart(3,'0')}`,name:'Same Name'}));const pages=[],lookups=[];
const api={initPlatform:async()=>{},requireVerifiedAccount:()=>({uid:'owner'}),listProfilePage:async cursor=>{pages.push(cursor);return {profiles:cursor?rows.slice(50):rows.slice(0,50),nextCursor:cursor?null:'u049'};},getProfilesByIds:async ids=>{lookups.push(ids);return rows.filter(x=>ids.includes(x.id));}};
const ctx=vm.createContext({console,URL,document:dom.window.document,Option:dom.window.Option});
const deps={'./backend-context.js':{BACKEND_KEY:'synthetic',requireCurrentBackend:()=>{}},'./state.js':{game:{},recordingSession:()=>{},saveActiveGame:()=>{},restoreActiveGame:()=>{},localRecordingRecoveries:()=>[]},'./ui.js':{showModal:()=>{},hideModal:()=>{}},'./scoring-records.js':{RECORDING_GAMES:new Set(['501']),newRecordId:()=> 'stable',recordingComplete:()=>true,recordingWinnerIds:()=>[],scoringResult:()=>{}},'./feature-availability.js':{isFeatureAvailable:()=>true},'./build-context.js':{BUILD_STORAGE:{casualRecoveryPrefix:'synthetic-'}},'./platform.js':api};
const cache=new Map();async function load(path){if(cache.has(path))return cache.get(path);if(path==='./recording-start-state.js'){const m=new vm.SourceTextModule(fs.readFileSync(new URL('../js/recording-start-state.js',import.meta.url),'utf8'),{context:ctx});cache.set(path,m);await m.link(load);await m.evaluate();return m;}const values=deps[path];assert(values,path);const mod=new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v]of Object.entries(values))this.setExport(k,v);},{context:ctx});cache.set(path,mod);await mod.link(()=>{});await mod.evaluate();return mod;}
const mod=new vm.SourceTextModule(fs.readFileSync(new URL('../js/casual-recording.js',import.meta.url),'utf8'),{context:ctx,importModuleDynamically:load});await mod.link(load);await mod.evaluate();
const drain=async()=>{for(let i=0;i<10;i++)await new Promise(setImmediate);};
const promise=mod.namespace.prepareCasualRecording([{name:'First'},{name:'Second'}],null);await drain();
const doc=dom.window.document,a=doc.querySelector('#casualLink0'),b=doc.querySelector('#casualLink1');assert.equal(a.options.length,51);a.value='u001';
doc.querySelector('#casualLinkMore').click();await drain();assert.equal(a.value,'u001');assert.equal(b.options.length,56);b.value='u054';assert(doc.querySelector('#casualLinkMore').hidden);
doc.querySelector('#casualLinkReload').click();await drain();assert.equal(b.value,'u054');assert.deepEqual(pages,[null,'u049',null]);
doc.querySelector('#casualLinkStart').click();await drain();assert(doc.querySelector('#casualLinkStatus').textContent.includes('Confirm local recording'));assert.equal(b.value,'u054');doc.querySelector('#casualLocalOnlyAck').checked=true;doc.querySelector('#casualLinkStart').click();await drain();const prepared=await promise;assert.deepEqual(JSON.parse(JSON.stringify(lookups)),[['u001','u054'],['u001','u054']]);assert.deepEqual(JSON.parse(JSON.stringify(prepared.recording.teams.map(x=>x.members[0].playerId))),['u001','u054']);
console.log('PASS real setup DOM: explicit load more, UID selection retained on page/reload, targeted validation for off-page selection, no participant trimming');dom.window.close();
