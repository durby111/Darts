// Verify the browser suite's SDK double against the real directory paging helper.
// This is fixture fidelity coverage, not Firestore query/rules enforcement.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {readProfilePage} from '../js/profile-directory.js';
test('scorer SDK fixture supports deterministic bounded directory pagination and owner filters',async()=>{
 const source=fs.readFileSync(new URL('./scoring_bridge_test.py',import.meta.url),'utf8').split('STORE = """')[1].split('"""')[0];
 globalThis.localStorage={__documents:JSON.stringify(Object.fromEntries(Array.from({length:77},(_,i)=>{const id='p'+String(76-i).padStart(3,'0');return ['blakeoutDevProfiles/'+id,{name:'Same',ownerId:i%2?'a':'b'}];})))};
 try {
  const sdk=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  const first=await readProfilePage({},sdk,'blakeoutDevProfiles'),last=await readProfilePage({},sdk,'blakeoutDevProfiles',first.nextCursor);
  assert.equal(first.profiles.length,50);assert.equal(first.profiles[0].id,'p000');assert.equal(first.nextCursor,'p049');
  assert.equal(last.profiles.length,27);assert.equal(last.nextCursor,null);assert.equal(new Set([...first.profiles,...last.profiles].map(p=>p.id)).size,77);
  const own=await sdk.getDocsFromServer(sdk.query(sdk.collection({},'blakeoutDevProfiles'),sdk.where('ownerId','==','a'),sdk.orderBy(sdk.documentId()),sdk.limit(50)));
  assert.equal(own.docs.length,38);assert(own.docs.every(d=>d.data().ownerId==='a'));
 } finally {delete globalThis.localStorage;}
});
