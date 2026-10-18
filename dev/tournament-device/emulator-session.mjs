import * as apps from 'firebase/app';
import * as authSDK from 'firebase/auth';
import * as storeSDK from 'firebase/firestore';
import {tournamentDevice} from './adapter.mjs';
export * as engine from '../js/brackets/engine.js';
export {mountDesk,mountConsent,mountConsentFromLocation} from './ui.mjs';
export async function emulatorSession(role,name){
  if(!['board','phone','organizer'].includes(role)||!['127.0.0.1','localhost'].includes(location.hostname))throw Error('Loopback demo only');
  const app=apps.initializeApp({projectId:'demo-blakeout-adapter-task3',apiKey:'demo-key',appId:'demo-app'},`event-${role}-${name}`);
  const auth=authSDK.getAuth(app);authSDK.connectAuthEmulator(auth,'http://127.0.0.1:19099',{disableWarnings:true});
  await authSDK.setPersistence(auth,authSDK.inMemoryPersistence);
  const db=storeSDK.getFirestore(app);storeSDK.connectFirestoreEmulator(db,'127.0.0.1',18085);
  return {auth,db,authSDK,storeSDK,role,api:tournamentDevice({db,auth,sdk:storeSDK})};
}
