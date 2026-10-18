/** Real SDK/emulator assertions only. Called by isolated run_tests.py; no mocks. */
import assert from 'node:assert/strict';
export async function testLifecycle({owner,board,otherOwner,denied,local,store,project}) {
 const id='lifecycle-merged',backendKey='blakeout-darts-dev:1:901185136996:web:89d4f413520e66ff773271';
 await owner.p.evaluate(async({id,backendKey})=>{
  const s=session.storeSDK,u=session.auth.currentUser.uid;
  await s.setDoc(s.doc(session.db,'blakeoutDevActiveGames',u,'games',id),{ownerId:u,backendKey,gameId:id,revision:0,operationId:'create',payload:'opaque-private',updatedAt:s.serverTimestamp(),status:'active',archivedAt:null});
 },{id,backendKey});
 const read=async()=>owner.p.evaluate(async id=>{const s=session.storeSDK;return (await s.getDocFromServer(s.doc(session.db,'blakeoutDevActiveGames',session.auth.currentUser.uid,'games',id))).data();},id);
 const update=async patch=>owner.p.evaluate(async({id,patch})=>{const s=session.storeSDK;await s.updateDoc(s.doc(session.db,'blakeoutDevActiveGames',session.auth.currentUser.uid,'games',id),{...patch,updatedAt:s.serverTimestamp(),...(patch.status==='archived'?{archivedAt:s.serverTimestamp()}:{})});},{id,patch});
 const reject=async(label,patch)=>{await assert.rejects(update(patch),e=>e.message.includes('permission'));assert.equal((await read()).revision,0);console.log('PASS merged lifecycle denies '+label);};
 await reject('stale revision',{revision:0,operationId:'stale'});
 await reject('skipped revision',{revision:2,operationId:'skip'});
 await reject('wrong backend',{revision:1,backendKey:'other'});
 await reject('archive payload mutation',{revision:1,status:'archived',payload:'changed'});
 await reject('direct active discard',{revision:1,status:'discarded',payload:''});
 await denied('client timestamp',owner.p,async id=>{const s=session.storeSDK;await s.updateDoc(s.doc(session.db,'blakeoutDevActiveGames',session.auth.currentUser.uid,'games',id),{revision:1,updatedAt:1});},id);
 await denied('other owner snapshot read',otherOwner.p,async({uid,id})=>{const s=session.storeSDK;await s.getDocFromServer(s.doc(session.db,'blakeoutDevActiveGames',uid,'games',id));},{uid:owner.uid,id});
 await denied('tablet creates own private snapshot despite overlapping pilot membership',board.p,async({id,backendKey})=>{const s=session.storeSDK,u=session.auth.currentUser.uid;await s.setDoc(s.doc(session.db,'blakeoutDevActiveGames',u,'games',id),{ownerId:u,backendKey,gameId:id,revision:0,operationId:'board',payload:'private',updatedAt:s.serverTimestamp(),status:'active',archivedAt:null});},{id,backendKey});
 await update({revision:1,operationId:'save',payload:'latest'});
 await update({revision:2,operationId:'archive',status:'archived'});
 await assert.rejects(update({revision:3,operationId:'early-discard',status:'discarded',payload:''}),e=>e.message.includes('permission'));
 await update({revision:3,operationId:'restore',status:'active',archivedAt:null});
 assert.equal((await read()).payload,'latest');
 await update({revision:4,operationId:'archive-again',status:'archived'});
 // Synthetic administrator fixture ages only the archived timestamp in this demo emulator.
 await local(`${store}/v1/projects/${project}/databases/(default)/documents/blakeoutDevActiveGames/${owner.uid}/games/${id}?updateMask.fieldPaths=archivedAt`,{fields:{archivedAt:{timestampValue:new Date(Date.now()-31*86400000).toISOString()}}},'PATCH');
 await update({revision:5,operationId:'discard',status:'discarded',payload:''});
 const tombstone=await read();assert.equal(tombstone.payload,'');assert.equal(tombstone.status,'discarded');
 await assert.rejects(update({revision:6,operationId:'resurrect',status:'active',archivedAt:null}),e=>e.message.includes('permission'));
 await denied('delete lifecycle tombstone',owner.p,async id=>{const s=session.storeSDK;await s.deleteDoc(s.doc(session.db,'blakeoutDevActiveGames',session.auth.currentUser.uid,'games',id));},id);
 console.log('PASS merged lifecycle active save/archive/restore/aged discard; early discard, resurrection and delete denied');
}
