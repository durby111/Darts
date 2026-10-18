import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const context=vm.createContext({console, URL});
let imports=0,creates=0,signins=0,mail=0,serverError=null;
const account={uid:'synthetic',emailVerified:false,isAnonymous:false};
const auth={currentUser:account};
const stubs={
 'firebase-app.js':{getApps:()=>[],initializeApp:(options,name)=>({options,name})},
 'firebase-auth.js':{getAuth:()=>auth,browserLocalPersistence:{},setPersistence:async()=>{},onAuthStateChanged:(_,f)=>f(account),createUserWithEmailAndPassword:async()=>{creates++;if(serverError)throw serverError;return {user:account};},sendEmailVerification:async()=>{mail++;},signInWithEmailAndPassword:async()=>{signins++;return {user:account};}},
 'firebase-firestore.js':{getFirestore:()=>({})}
};
const modules=new Map();
async function load(url){
 if(modules.has(url))return modules.get(url);
 let m;
 if(url.startsWith('https:')){
  const exports=stubs[url.split('/').pop()];assert(exports,'Unexpected SDK import');
  m=new vm.SyntheticModule(Object.keys(exports),function(){for(const [k,v] of Object.entries(exports))this.setExport(k,v);},{context,identifier:url});
 }else m=new vm.SourceTextModule(fs.readFileSync(fileURLToPath(url),'utf8'),{context,identifier:url,initializeImportMeta:meta=>meta.url=url,importModuleDynamically:async(spec,ref)=>{imports++;const dep=await load(new URL(spec,ref.identifier).href);if(dep.status==='linked')await dep.evaluate();return dep;}});
 modules.set(url,m);await m.link((spec,ref)=>load(new URL(spec,ref.identifier).href));return m;
}
const m=await load(new URL('../js/platform.js',import.meta.url).href);await m.evaluate();const api=m.namespace;
const invalid=[undefined,null,123,'','Aa1!aaaaa','aa1!aaaaaa','AA1!AAAAAA','Aa!!aaaaaa','Aa11aaaaaa','Aa1 aaaaaa','Aa1!'+ 'a'.repeat(4093)];
for(const password of invalid)await assert.rejects(()=>api.registerAccount('synthetic@example.invalid',password),e=>e.code==='auth/password-does-not-meet-requirements');
assert.equal(imports,0);assert.equal(creates,0);assert.equal(mail,0);
console.log('PASS 11 invalid signup inputs rejected before SDK import, account creation or email');
for(const password of ['Aa1!aaaaaa','Aa1!'+ 'a'.repeat(4092),' Aa1!aaaaa','Aa1_aaaaaa'])assert.doesNotThrow(()=>api.validateSignupPassword(password));
console.log('PASS minimum/maximum length, supported punctuation and untrimmed password boundaries');
await api.registerAccount('synthetic@example.invalid','Aa1!aaaaaa');assert.equal(creates,1);assert.equal(mail,1);
for(const code of ['auth/weak-password','auth/password-does-not-meet-requirements','auth/too-many-requests']){
 serverError=Object.assign(new Error('Synthetic server denial'),{code});
 await assert.rejects(()=>api.registerAccount('synthetic@example.invalid','Aa1!aaaaaa'),e=>e===serverError);
 assert.equal(mail,1);
}
console.log('PASS server policy/quota errors preserved without verification email or retries');
await api.signInAccount('synthetic@example.invalid','oldpw');assert.equal(signins,1);
console.log('PASS existing short password sign-in is not forced through signup policy');
const html=fs.readFileSync(new URL('../accounts/index.html',import.meta.url),'utf8');
assert.match(html,/id="accountPassword"[^>]*minlength="1"/);assert(!/id="accountPassword"[^>]*pattern=/.test(html));
assert(html.includes('signupPasswordHint'));
console.log('PASS shared sign-in input permits existing passwords and explains signup-only requirements');
