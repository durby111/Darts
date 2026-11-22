// Actual production or DEV page, engine and device adapter in jsdom. No provider writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import {createRequire} from 'node:module';import {fileURLToPath,pathToFileURL} from 'node:url';
const {JSDOM}=createRequire(import.meta.url)(process.env.BLAKEOUT_JSDOM_MODULE||'jsdom');
const root=fileURLToPath(new URL('../../',import.meta.url));
const scope=process.env.BLAKEOUT_BUILD==='dev'?'dev/':'';
const dom=new JSDOM(fs.readFileSync(path.join(root,scope?'dev/brackets/index.html':'local/brackets/template.html'),'utf8'),{url:'https://example.test/local/brackets/',runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window;w.document.body.append(w.document.querySelector('#featurePageTemplate').content.cloneNode(true));
Object.assign(w,{structuredClone,ResizeObserver:class{observe(){} disconnect(){}},fetch(){throw Error('Network forbidden')}});w.HTMLElement.prototype.scrollIntoView=function(){};Object.defineProperty(w.navigator,'locks',{value:{request:async(k,fn)=>fn()}});w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'))};
const ctx=dom.getInternalVMContext(),mods=new Map();
function mod(filename){if(mods.has(filename))return mods.get(filename);const m=new vm.SourceTextModule(fs.readFileSync(filename,'utf8'),{context:ctx,identifier:pathToFileURL(filename).href,initializeImportMeta:x=>x.url=pathToFileURL(filename).href});mods.set(filename,m);return m;}
const entry=mod(path.join(root,scope+'js/brackets/page.js'));await entry.link((s,m)=>{const target=fileURLToPath(new URL(s,m.identifier));return mod(scope&&target===path.join(root,'dev/js/platform.js')?path.join(root,'dev/local/platform.js'):target);});await entry.evaluate();
const settle=async()=>{for(let i=0;i<10;i++)await new Promise(r=>setTimeout(r,0))};const get=id=>w.document.getElementById(id);const input=(id,v)=>{get(id).value=v;get(id).dispatchEvent(new w.Event('input',{bubbles:true}));};const submit=id=>get(id).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));const saved=()=>JSON.parse(w.localStorage.getItem(scope?'blakeout_dev_local_tournaments_v1':'blakeout_local_tournaments_v1'));const event=()=>Object.values(saved().events)[0];
const rows=()=>[...get('rosterRows').rows];
const field=(i,key)=>rows()[i].querySelector('[data-field='+key+']');
const values=key=>rows().map(row=>row.querySelector('[data-field='+key+']').value);
const change=(el,value)=>{if(el.type==='checkbox')el.checked=value;else el.value=value;el.dispatchEvent(new w.Event(el.type==='checkbox'?'change':'input',{bubbles:true}));};
const choice=(answer)=>w.document.querySelector('.platform-confirm-'+answer).click();
try{
 await settle();
 input('title','Synthetic roster QA'); get('gameType').value='301'; get('bestOf').value='1'; submit('createForm'); await settle();
 for(const name of ['Zed','alex','Bea','Alex','Max']){input('guestName',name);submit('addForm');await settle();}
 for(let i=0;i<5;i++)change(field(i,'tag'),String(Math.floor(i/2)+1));
 change(field(4,'standby'),true);change(field(0,'paid'),true);change(field(2,'checkedIn'),true);
 submit('rosterForm');await settle();
 const initial=event();assert.equal(initial.revision,1);const originalIds=rows().map(r=>r.dataset.registration);
 const changeButton=get('sortRosterAz');changeButton.click();
 assert.equal(changeButton.getAttribute('aria-pressed'),'true');assert.deepEqual(values('name'),['alex','Alex','Bea','Max','Zed']);
 assert.deepEqual(rows().slice(0,2).map(r=>r.dataset.registration),[originalIds[1],originalIds[3]]);
 assert.ok([...get('rosterRows').querySelectorAll('[data-move]')].every(b=>b.disabled));
 assert.equal(get('saveRoster').disabled,true);assert.deepEqual(event(),initial);
 const clear=get('clearTeamNumbers');clear.click();await settle();choice('cancel');await settle();assert.deepEqual(values('tag'),['1','2','2','3','1']);
 change(field(0,'paid'),true);
 clear.click();await settle();choice('accept');await settle();assert.ok(values('tag').every(v=>v===''));
 assert.deepEqual(event(),initial);assert.equal(get('saveRoster').disabled,false);
 changeButton.click();assert.deepEqual(rows().map(r=>r.dataset.registration),originalIds);
 submit('rosterForm');await settle();
 assert.equal(event().revision,2);assert.deepEqual(event().teams,[]);assert.deepEqual(event().matches,[]);
 assert.deepEqual(event().registrations,initial.registrations.map((r,i)=>({...r,tag:'',paid:i===1?true:r.paid})));
 assert.equal(clear.disabled,true);
 get('refresh').click();await settle();assert.ok(values('tag').every(v=>v===''));
 assert.deepEqual(rows().map(r=>r.dataset.registration),originalIds);
 console.log('PASS '+(scope||'production')+' stable reversible alphabetic view, guarded cancel, draft-only clear, full persisted tags cleared including standby, flags and order retained, refresh');
}finally{w.close()}
