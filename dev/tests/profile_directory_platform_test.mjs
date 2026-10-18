// Real platform + directory modules, synthetic SDK transport. No Firebase enforcement claim.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const user={uid:'owner',emailVerified:true,isAnonymous:false};
const auth={currentUser:user};
const rows=Array.from({length:105},(_,i)=>({id:`u${String(i).padStart(3,'0')}`,name:'Duplicate name'}));
let reads=0,afterRead=()=>{};const queries=[],ids=[];
const snap=row=>({id:row?.id,exists:()=>!!row,data:()=>({name:row.name})});
const sdk={getFirestore:()=>({}),collection:(_,name)=>name,documentId:()=> '__name__',orderBy:field=>({order:field}),limit:n=>({limit:n}),startAfter:id=>({after:id}),query:(collection,...constraints)=>({collection,constraints}),doc:(_,collection,id)=>({collection,id}),getDocsFromServer:async q=>{reads++;queries.push(q);assert.equal(q.collection,'blakeoutDevProfiles');assert.equal(q.constraints.find(c=>c.limit)?.limit,50);const cursor=q.constraints.find(c=>c.after)?.after;const docs=rows.filter(r=>!cursor||r.id>cursor).slice(0,50).map(snap);afterRead();return {docs};},getDocFromServer:async ref=>{reads++;assert.equal(ref.collection,'blakeoutDevProfiles');ids.push(ref.id);const result=snap(rows.find(r=>r.id===ref.id));afterRead();return result;}};
const config={apiKey:'synthetic-not-a-credential',projectId:'blakeout-darts-dev',appId:'1:901185136996:web:89d4f413520e66ff773271',authDomain:'blakeout-darts-dev.firebaseapp.com'};
const fixtures={'./firebase-config.js':{firebaseConfig:config},'firebase-app.js':{getApps:()=>[],initializeApp:options=>({options})},'firebase-auth.js':{getAuth:()=>auth,browserLocalPersistence:{},setPersistence:async()=>{},onAuthStateChanged:(_,cb)=>cb(auth.currentUser)},'firebase-firestore.js':sdk};
const ctx=vm.createContext({console,URL});const cache=new Map();
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
