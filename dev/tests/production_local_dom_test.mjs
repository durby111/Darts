// Actual production page, engine and device adapter in jsdom. No provider mocks.
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import {createRequire} from 'node:module';import {fileURLToPath,pathToFileURL} from 'node:url';
const {JSDOM}=createRequire(import.meta.url)(process.env.BLAKEOUT_JSDOM_MODULE||'jsdom');
const root=fileURLToPath(new URL('../../',import.meta.url));
const dom=new JSDOM(fs.readFileSync(path.join(root,'local/brackets/template.html'),'utf8'),{url:'https://example.test/local/brackets/',runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window;w.document.body.append(w.document.querySelector('template').content.cloneNode(true));
Object.assign(w,{structuredClone,ResizeObserver:class{observe(){} disconnect(){}},fetch(){throw Error('Network forbidden')}});w.HTMLElement.prototype.scrollIntoView=function(){};Object.defineProperty(w.navigator,'locks',{value:{request:async(k,fn)=>fn()}});w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'))};
const ctx=dom.getInternalVMContext(),mods=new Map();
function mod(filename){if(mods.has(filename))return mods.get(filename);const m=new vm.SourceTextModule(fs.readFileSync(filename,'utf8'),{context:ctx,identifier:pathToFileURL(filename).href,initializeImportMeta:x=>x.url=pathToFileURL(filename).href});mods.set(filename,m);return m;}
const entry=mod(path.join(root,'js/brackets/page.js'));await entry.link((s,m)=>mod(fileURLToPath(new URL(s,m.identifier))));await entry.evaluate();
const settle=async()=>{for(let i=0;i<10;i++)await new Promise(r=>setTimeout(r,0))};const get=id=>w.document.getElementById(id);const input=(id,v)=>{get(id).value=v;get(id).dispatchEvent(new w.Event('input',{bubbles:true}));};const submit=id=>get(id).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));const saved=()=>JSON.parse(w.localStorage.getItem('blakeout_local_tournaments_v1'));const event=()=>Object.values(saved().events)[0];
try{await settle();assert.match(get('message').textContent,/connected/i);
w.localStorage.setItem('blakeout_active_game','ordinary sentinel');w.localStorage.setItem('blakeout_dev_local_tournaments_v1','DEV sentinel');input('title','Named unpaid release test');get('gameType').value='301';get('bestOf').value='1';submit('createForm');await settle();
for(let i=0;i<4;i++){input('guestName','Guest '+i);submit('addForm');await settle();const tags=w.document.querySelectorAll('#rosterRows [data-field=tag]');tags[i].value=String(Math.floor(i/2)+1);tags[i].dispatchEvent(new w.Event('input',{bubbles:true}));}
get('startTournament').click();await settle();assert.ok(w.document.querySelector('.platform-confirm-cancel'));w.document.querySelector('.platform-confirm-cancel').click();await settle();assert.equal(event().status,'registration');
get('startTournament').click();get('startTournament').click();await settle();w.document.querySelector('.platform-confirm-accept').click();await settle();assert.equal(event().status,'live');assert.equal(event().revision,1);assert.ok(event().registrations.every(r=>!r.paid&&!r.checkedIn));
const payment=w.document.querySelector('#paymentRows input');payment.checked=true;payment.dispatchEvent(new w.Event('change',{bubbles:true}));await settle();assert.equal(event().registrations.filter(r=>r.paid).length,1);assert.equal(w.localStorage.getItem('blakeout_active_game'),'ordinary sentinel');assert.equal(w.localStorage.getItem('blakeout_dev_local_tournaments_v1'),'DEV sentinel');
console.log('PASS actual production DOM: create/add four named unpaid guests, cancel/repeated start, live payment edit, ordinary/DEV preservation, no network');
}finally{w.close()}
