// Actual production page/engine/device adapter in jsdom. Not rendered browser QA.
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import {createRequire} from 'node:module';import {fileURLToPath,pathToFileURL} from 'node:url';
const {JSDOM}=createRequire(import.meta.url)(process.env.BLAKEOUT_JSDOM_MODULE||'jsdom');
const root=fileURLToPath(new URL('../../',import.meta.url));
const dom=new JSDOM(fs.readFileSync(root+'local/brackets/template.html','utf8'),{url:'http://localhost/local/brackets/',runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window,ctx=dom.getInternalVMContext();w.document.body.append(w.document.querySelector('template').content.cloneNode(true));
Object.assign(w,{structuredClone,ResizeObserver:class{observe(){}},fetch(){throw Error('Network forbidden')},confirm(){throw Error('Native confirm forbidden')}});w.HTMLElement.prototype.scrollIntoView=function(){};
Object.defineProperty(w.navigator,'locks',{value:{request:async(k,cb)=>cb()}});
const modules=new Map();
async function load(f){if(modules.has(f))return modules.get(f);const m=new vm.SourceTextModule(fs.readFileSync(f,'utf8'),{context:ctx,identifier:f,initializeImportMeta(meta){meta.url=pathToFileURL(f).href},importModuleDynamically:async s=>{const n=await load(path.resolve(path.dirname(f),s));if(n.status==='linked')await n.evaluate();return n}});modules.set(f,m);await m.link(s=>load(path.resolve(path.dirname(f),s)));return m;}
const get=id=>w.document.getElementById(id);const settle=async()=>{for(let i=0;i<12;i++)await new Promise(r=>setTimeout(r,0));};
const input=(id,value)=>{get(id).value=value;get(id).dispatchEvent(new w.Event('input',{bubbles:true}));get(id).dispatchEvent(new w.Event('change',{bubbles:true}));};
const submit=async id=>{get(id).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await settle()};
const click=async id=>{get(id).click();await settle()};
const approve=async()=>{w.document.querySelector('.platform-confirm-accept').click();await settle()};
w.localStorage.setItem('blakeout_active_game','PRODUCTION SENTINEL');w.localStorage.setItem('blakeout_dev_local_tournaments_v1','DEV SENTINEL');
await(await load(root+'js/brackets/page.js')).evaluate();await settle();
input('title','QA unpaid entrants');input('date','2026-11-18');input('gameType','301');input('bestOf','1');await submit('createForm');
for(let i=1;i<=4;i++){input('guestName','Guest '+i);await submit('addForm');}
assert.equal(w.document.querySelectorAll('#rosterRows [data-field=name]').length,4);
assert([...w.document.querySelectorAll('#rosterRows [data-field=paid],#rosterRows [data-field=checkedIn]')].every(x=>!x.checked));
await click('drawPartners');await approve();await click('saveRoster');
let data=JSON.parse(w.localStorage.getItem('blakeout_local_tournaments_v1'));let event=Object.values(data.events)[0];assert.equal(event.teams.length,2);
await click('startTournament');await approve();data=JSON.parse(w.localStorage.getItem('blakeout_local_tournaments_v1'));event=Object.values(data.events)[0];assert.equal(event.status,'live');assert(event.registrations.every(r=>!r.paid&&!r.checkedIn));
assert.equal(w.localStorage.getItem('blakeout_active_game'),'PRODUCTION SENTINEL');assert.equal(w.localStorage.getItem('blakeout_dev_local_tournaments_v1'),'DEV SENTINEL');
assert(w.document.querySelector('.match-action'));console.log('PASS production actual DOM: create → four named unpaid/unchecked guests → draw → save → start; playable match and isolated persistence');dom.window.close();
