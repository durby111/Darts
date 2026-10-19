// Real platform + directory modules, synthetic SDK transport. No Firebase enforcement claim.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const user={uid:'owner',emailVerified:true,isAnonymous:false};
const auth={currentUser:user};
const rows=Array.from({length:105},(_,i)=>({id:`u${String(i).padStart(3,'0')}`,name:'Duplicate name'}));
let historyRead=null,historyGet=null;
let reads=0,afterRead=()=>{};const queries=[],ids=[];
const snap=row=>({id:row?.id,exists:()=>!!row,data:()=>({name:row.name})});
const sdk={where:(field,operator,value)=>({field,operator,value}),getFirestore:()=>({}),collection:(_,name)=>name,documentId:()=> '__name__',orderBy:field=>({order:field}),limit:n=>({limit:n}),startAfter:id=>({after:id}),query:(collection,...constraints)=>({collection,constraints}),doc:(_,collection,id)=>({collection,id}),getDocsFromServer:async q=>{if(historyRead)return historyRead(q);reads++;queries.push(q);assert.equal(q.collection,'blakeoutDevProfiles');assert.equal(q.constraints.find(c=>c.limit)?.limit,50);const cursor=q.constraints.find(c=>c.after)?.after;const docs=rows.filter(r=>!cursor||r.id>cursor).slice(0,50).map(snap);afterRead();return {docs};},getDocFromServer:async ref=>{if(historyGet)return historyGet(ref);reads++;assert.equal(ref.collection,'blakeoutDevProfiles');ids.push(ref.id);const result=snap(rows.find(r=>r.id===ref.id));afterRead();return result;}};
const config={apiKey:'synthetic-not-a-credential',projectId:'blakeout-darts-dev',appId:'1:901185136996:web:89d4f413520e66ff773271',authDomain:'blakeout-darts-dev.firebaseapp.com'};
const fixtures={'./firebase-config.js':{firebaseConfig:config},'firebase-app.js':{getApps:()=>[],initializeApp:options=>({options})},'firebase-auth.js':{getAuth:()=>auth,browserLocalPersistence:{},setPersistence:async()=>{},onAuthStateChanged:(_,cb)=>cb(auth.currentUser)},'firebase-firestore.js':sdk};
const ctx=vm.createContext({console,URL,TextEncoder});const cache=new Map();
async function load(spec){
 const key=spec.startsWith('https:')?spec.split('/').at(-1):spec;
 if(cache.has(key))return cache.get(key);
 const fixture=fixtures[key];
 const mod=fixture?new vm.SyntheticModule(Object.keys(fixture),function(){for(const [k,v]of Object.entries(fixture))this.setExport(k,v);},{context:ctx}):new vm.SourceTextModule(fs.readFileSync(new URL('../js/'+key.replace(/^\.\//,''),import.meta.url),'utf8'),{context:ctx,importModuleDynamically:load});
 cache.set(key,mod);await mod.link(load);await mod.evaluate();return mod;
}
const api=(await load('./platform.js')).namespace;
assert.equal((await api.listProfilePage()).profiles.length,50);
assert.deepEqual(JSON.parse(JSON.stringify((await api.listProfilePage('u049')).profiles.map(r=>r.id))),rows.slice(50,100).map(r=>r.id));
assert.equal((await api.listProfiles()).length,105);
assert.equal(queries.length,5);
console.log('PASS real platform/helper integration: bounded pages and complete legacy directory');
const selected=await api.getProfilesByIds(['u104','u001','u104','absent']);
assert.deepEqual(JSON.parse(JSON.stringify(selected.map(r=>r.id))),['u104','u001']);
assert.deepEqual(ids,['u104','u001','absent']);
console.log('PASS targeted off-page IDs, deduplication, missing rows, duplicate names');
for(const invalid of [null,['../bad'],Array(129).fill('u001')]){const before=reads;await assert.rejects(api.getProfilesByIds(invalid),/Invalid linked/);assert.equal(reads,before);}
for(const guest of [null,{...user,isAnonymous:true},{...user,emailVerified:false}]){
 auth.currentUser=guest;
 for(const call of [()=>api.listProfilePage(),()=>api.getProfilesByIds(['u001']),()=>api.listProfiles()]){const before=reads;await assert.rejects(call(),/Sign in and verify/);assert.equal(reads,before);}
}
console.log('PASS invalid IDs and guest/unverified access stop before SDK reads');
for(const call of [()=>api.listProfilePage(),()=>api.getProfilesByIds(['u001']),()=>api.listProfiles()]){
 auth.currentUser=user;afterRead=()=>{auth.currentUser={...user,uid:'other'};};
 await assert.rejects(call(),/signed-in account changed/);
}
auth.currentUser=user;afterRead=()=>{};
console.log('PASS account switching rejects stale directory/targeted/legacy responses');

const backendKey='blakeout-darts-dev:1:901185136996:web:89d4f413520e66ff773271';
const stored=rows.map(row=>({id:row.id,data:()=>({backendKey,legScores:'[]',perPlayer:'[]',participantIds:['owner'],gameType:'501'})}));
let tournamentError='permission-denied',switchAccount=false,badRecord=false,oldReceipt=false;const historyQueries=[];
historyRead=async q=>{
 historyQueries.push(q);assert.equal(q.constraints.find(c=>c.limit)?.limit,50);assert.equal(q.constraints.find(c=>c.order)?.order,'__name__');
 const filter=q.constraints.find(c=>c.field);assert.equal(filter.value,'owner');
 if(q.collection==='blakeoutDevResults')throw Object.assign(new Error('synthetic denied'),{code:tournamentError});
 if(q.collection==='blakeoutDevCasualReceipts'){assert.equal(filter.field,'playerId');return {docs:oldReceipt?[{id:'receipt',data:()=>({backendKey,resultId:'old-linked'})}]:[]};}
 assert.equal(q.collection,'blakeoutDevCasualResults');assert.equal(filter.field,'ownerId');
 const cursor=q.constraints.find(c=>c.after)?.after?.id;
 if(switchAccount)auth.currentUser={...user,uid:'replacement'};
 const docs=stored.filter(r=>!cursor||r.id>cursor).slice(0,50);
 return {docs:badRecord?[{id:'bad',data:()=>({})}]:docs};
};
let unavailable;
const history=await api.listMyResults({onUnavailable:s=>{unavailable=[...s];}});
assert.equal(history.length,105);assert.deepEqual(unavailable,['tournament']);
assert.equal(historyQueries.filter(q=>q.collection==='blakeoutDevCasualResults').length,3);
console.log('PASS real history API: 105 owned records in bounded pages survive explicit tournament denial');
await assert.rejects(api.listMyResults(),e=>e.code==='permission-denied');
tournamentError='unavailable';let warned=false;
await assert.rejects(api.listMyResults({onUnavailable:()=>{warned=true;}}),e=>e.code==='unavailable');assert.equal(warned,false);
tournamentError='permission-denied';badRecord=true;
await assert.rejects(api.listMyResults({onUnavailable:()=>{warned=true;}}),/older or unknown backend/);assert.equal(warned,false);badRecord=false;
switchAccount=true;
await assert.rejects(api.listMyResults({onUnavailable:()=>{warned=true;}}),/signed-in account changed/);assert.equal(warned,false);
console.log('PASS strict legacy calls, network/schema errors and account switches never report complete/empty history');

auth.currentUser=user;switchAccount=false;oldReceipt=true;
historyGet=async()=>{throw Object.assign(new Error('synthetic linked denial'),{code:'permission-denied'});};
const partial=await api.listMyResults({onUnavailable:s=>{unavailable=[...s];}});
assert.equal(partial.length,105);assert.deepEqual(unavailable,['tournament','linked-casual']);
historyGet=async()=>{throw Object.assign(new Error('synthetic offline'),{code:'unavailable'});};
await assert.rejects(api.listMyResults({onUnavailable:()=>assert.fail('must not publish partial network failure')}),e=>e.code==='unavailable');
console.log('PASS inaccessible old linked record is explicitly flagged; accessible own data survives; network failures propagate');
