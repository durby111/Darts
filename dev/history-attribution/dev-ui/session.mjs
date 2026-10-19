import {HISTORY_DEV_RELEASE} from './config.mjs';
import {DEV_ENVIRONMENT,assertAdapterEnvironment} from '../environment.mjs';
import {assertDevConfig} from '../../js/backend-context.js';
import {historyAdapter} from '../coherent/adapter.mjs';
import {pairingAdapter} from '../../qr-firebase/adapter.mjs';
import {tournamentDevice} from '../../tournament-device/adapter.mjs';
const SDK='https://www.gstatic.com/firebasejs/10.13.2';
export function assertDevHistoryRoute(location) {
 if(!HISTORY_DEV_RELEASE.enabled)throw Error('History integration is not released.');
 if(location.origin!==HISTORY_DEV_RELEASE.origin||location.pathname!==HISTORY_DEV_RELEASE.path)throw Error('Unapproved DEV history route');
}
export function adaptersForSession({db,auth,sdk,role}) {
 if(!['phone','organizer','board'].includes(role))throw Error('Unknown history role');
 assertAdapterEnvironment({db,auth,sdk,environment:DEV_ENVIRONMENT});
 const expected=role==='board'?'blakeout-darts-dev-history-board':'blakeout-darts-dev-accounts';
 if(db.app.name!==expected)throw Error('History role requires a separate matching app');
 const options={db,auth,sdk,environment:DEV_ENVIRONMENT};
 return {db,auth,storeSDK:sdk,role,history:historyAdapter(options),pairing:pairingAdapter(options),tournament:tournamentDevice(options)};
}
export async function openDevHistorySession(role,location=globalThis.location) {
 // Gate runs before config/SDK imports or any connection.
 assertDevHistoryRoute(location);
 if(!['phone','organizer','board'].includes(role))throw Error('Unknown history role');
 const {firebaseConfig}=await import('../../js/firebase-config.js');assertDevConfig(firebaseConfig);
 const [apps,authSDK,sdk]=await Promise.all([import(`${SDK}/firebase-app.js`),import(`${SDK}/firebase-auth.js`),import(`${SDK}/firebase-firestore.js`)]);
 const name=role==='board'?'blakeout-darts-dev-history-board':'blakeout-darts-dev-accounts';
 const app=apps.getApps().find(a=>a.name===name)||apps.initializeApp(firebaseConfig,name);assertDevConfig(app.options);
 const auth=authSDK.getAuth(app),db=sdk.getFirestore(app,'(default)');
 // Board provisioning/sign-in is deliberately not performed by this route.
 // An approved device session must already exist; no personal submitter login.
 if(role!=='board')await authSDK.setPersistence(auth,authSDK.browserLocalPersistence);
 await auth.authStateReady();
 if(!auth.currentUser)throw Error(role==='board'?'An approved shared-device session is required.':'Sign in on the DEV Accounts page, then return here.');
 const session=adaptersForSession({db,auth,sdk,role});
 return {...session,subscribe:fn=>authSDK.onAuthStateChanged(auth,fn)};
}
