import {assertDevHistoryRoute,adaptersForSession} from './session.mjs';
import {assertDevConfig} from '../../js/backend-context.js';
import {BOARD_SETUP} from './config.mjs';
// tokenProvider is supplied by an independently approved provisioning service.
// This module never mints credentials, creates identities, or changes role rules.
export async function provisionBoard({app,auth,db,authSDK,sdk,tokenProvider,location=globalThis.location}) {
 assertDevHistoryRoute(location);assertDevConfig(app.options);
 if(app.name!=='blakeout-darts-dev-history-board'||auth.app!==app||db.app!==app)throw Error('Dedicated board app required');
 if(!BOARD_SETUP.uid||!BOARD_SETUP.authorizationReference)throw Error('Board provisioning is not approved');
 if(auth.currentUser)throw Error('Sign out the existing device session before provisioning');
 if(typeof tokenProvider!=='function')throw Error('Approved board token provider required');
 adaptersForSession({db,auth,sdk,role:'board'}); // Validate database before requesting credentials.
 await authSDK.setPersistence(auth,authSDK.browserSessionPersistence);
 try {
  await authSDK.signInWithCustomToken(auth,await tokenProvider({projectId:app.options.projectId,uid:BOARD_SETUP.uid}));
  if(auth.currentUser?.uid!==BOARD_SETUP.uid)throw Error('Provisioned identity does not match approved board');
  return adaptersForSession({db,auth,sdk,role:'board'});
 }catch(error){await authSDK.signOut(auth);throw error;}
}
