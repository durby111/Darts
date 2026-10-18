// Local-only integration entry. Deliberately no real-project/live mode.
// SDK modules are bundled from the existing pinned QA tooling, never a CDN.
import * as apps from 'firebase/app';
import * as authSDK from 'firebase/auth';
import * as storeSDK from 'firebase/firestore';
import {pairingAdapter} from './adapter.mjs';
export async function emulatorSession(role, name){
  if(!['board','phone'].includes(role))throw Error('Unknown role');
  if(!['127.0.0.1','localhost'].includes(location.hostname))throw Error('Loopback only');
  const app=apps.initializeApp({projectId:'demo-blakeout-adapter-task3',apiKey:'demo-key',appId:'demo-app'},`qr-${role}-${name}`);
  const auth=authSDK.getAuth(app);authSDK.connectAuthEmulator(auth,'http://127.0.0.1:19099',{disableWarnings:true});
  await authSDK.setPersistence(auth,authSDK.inMemoryPersistence);
  const db=storeSDK.getFirestore(app);storeSDK.connectFirestoreEmulator(db,'127.0.0.1',18085);
  return {auth,db,authSDK,storeSDK,adapter:pairingAdapter({db,auth,sdk:storeSDK}),
    async signIn(email,password){return authSDK.signInWithEmailAndPassword(auth,email,password);},
    async signOut(){return authSDK.signOut(auth);}};
}
