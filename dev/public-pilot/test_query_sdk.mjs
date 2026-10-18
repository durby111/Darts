/** Actual Firebase SDK against demo emulator; mockUserToken supplies nonadmin claims only. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {isPermissionDenied} from '../tournament-device/permission-denied.mjs';
const require=createRequire(import.meta.url),modules=process.env.BLAKEOUT_QA_MODULES;
assert(modules&&path.isAbsolute(modules));
require('../tests/loopback_transport.cjs').install();
const apps=require(modules+'/firebase/app'),sdk=require(modules+'/firebase/firestore');
const host=process.env.FIRESTORE_EMULATOR_HOST;assert.match(host||'',/^127\.0\.0\.1:[0-9]+$/);
const project='demo-blakeout-public-policy',base='http://'+host,port=Number(host.split(':')[1]);
const source=fs.readFileSync(new URL('./firestore.public-proposed.rules',import.meta.url),'utf8');
async function rules(content){const response=await fetch(base+`/emulator/v1/projects/${project}:securityRules`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({rules:{files:[{name:'sdk-control.rules',content}]}})});assert.equal(response.status,200,await response.text());}
const clients=[];
function client(uid,verified=true,provider='password'){
 const app=apps.initializeApp({projectId:project,apiKey:'demo-key',appId:'demo-app'},'query-'+uid);
 const db=sdk.getFirestore(app);sdk.connectFirestoreEmulator(db,'127.0.0.1',port,{mockUserToken:{sub:uid,user_id:uid,email_verified:verified,firebase:{sign_in_provider:provider}}});clients.push({db,app});return db;
}
async function deny(label,action){await assert.rejects(action,isPermissionDenied,label);console.log('PASS actual SDK deny '+label);}
try{
 const alice=client('alice'),bob=client('bob'),unverified=client('unverified',false),anonymous=client('anonymous',false,'anonymous');
 const profiles=db=>sdk.collection(db,'blakeoutDevProfiles');
 const bounded=await sdk.getDocsFromServer(sdk.query(profiles(alice),sdk.orderBy(sdk.documentId()),sdk.limit(50)));assert.equal(bounded.size,50);console.log('PASS actual SDK explicit limit 50 returns 50 of >75 names');
 assert.equal((await sdk.getDocsFromServer(sdk.query(profiles(alice),sdk.limit(1)))).size,1);console.log('PASS actual SDK explicit limit 1');
 await deny('absent query limit',()=>sdk.getDocsFromServer(profiles(alice)));
 await deny('query limit 51',()=>sdk.getDocsFromServer(sdk.query(profiles(alice),sdk.limit(51))));
 await deny('unverified bounded query',()=>sdk.getDocsFromServer(sdk.query(profiles(unverified),sdk.limit(50))));
 await deny('anonymous bounded query',()=>sdk.getDocsFromServer(sdk.query(profiles(anonymous),sdk.limit(50))));
 await deny('cross-user private get',()=>sdk.getDocFromServer(sdk.doc(bob,'blakeoutDevCasualResults','saved')));
 assert((await sdk.getDocFromServer(sdk.doc(alice,'blakeoutDevCasualResults','saved'))).exists());console.log('PASS actual SDK own private get');
 await rules("rules_version = '2'; service cloud.firestore { match /databases/{db}/documents { match /{doc=**} { allow read, write: if false; } } }");
 await deny('same identity under deny-all proves nonadmin',()=>sdk.getDocFromServer(sdk.doc(alice,'blakeoutDevProfiles','alice')));
 console.log('PASS 9 actual SDK cases; no Admin SDK or real tokens');
}finally{await rules(source);for(const {db,app} of clients){await sdk.terminate(db);await apps.deleteApp(app);}}
