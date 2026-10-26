import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const calls=[],auth={currentUser:null};let fail=false;
const config={apiKey:'synthetic',projectId:'blakeout-darts-dev',appId:'1:901185136996:web:89d4f413520e66ff773271',authDomain:'blakeout-darts-dev.firebaseapp.com'};
const sdk={getAuth:()=>auth,browserLocalPersistence:'local',browserSessionPersistence:'session',setPersistence:async(_,p)=>{calls.push(p);if(fail)throw Error('Storage unavailable');},onAuthStateChanged:(_,fn)=>fn(auth.currentUser),signInWithEmailAndPassword:async()=>{calls.push('login');auth.currentUser={uid:'synthetic'};return {user:auth.currentUser};}};
const fixtures={'./firebase-config.js':{firebaseConfig:config},'firebase-app.js':{getApps:()=>[],initializeApp:options=>({options})},'firebase-auth.js':sdk,'firebase-firestore.js':{getFirestore:()=>({})}};
const context=vm.createContext({console,URL,TextEncoder}),cache=new Map();
async function load(spec){
 const key=spec.startsWith('https:')?spec.split('/').at(-1):spec;if(cache.has(key))return cache.get(key);
 const value=fixtures[key];
 const mod=value?new vm.SyntheticModule(Object.keys(value),function(){for(const[k,v]of Object.entries(value))this.setExport(k,v);},{context}):new vm.SourceTextModule(fs.readFileSync(new URL('../js/'+key.replace(/^\.\//,''),import.meta.url),'utf8'),{context,importModuleDynamically:load});
 cache.set(key,mod);await mod.link(load);await mod.evaluate();return mod;
}
const api=(await load('./platform.js')).namespace;
await api.initPlatform();assert.deepEqual(calls,[],'Loading home must not promote persistence');
await api.signInAccount('synthetic@example.invalid','synthetic',{remember:false});assert.deepEqual(calls,['session','login']);calls.length=0;
await api.initPlatform();assert.deepEqual(calls,[]);
await api.signInAccount('synthetic@example.invalid','synthetic',{remember:true});assert.deepEqual(calls,['local','login']);calls.length=0;
fail=true;await assert.rejects(api.signInAccount('synthetic@example.invalid','synthetic',{remember:false}),/Storage unavailable/);assert.deepEqual(calls,['session']);
console.log('PASS restored sessions unchanged, explicit session/local choices precede sign-in, failed persistence prevents authentication');
