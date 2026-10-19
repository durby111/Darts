import {assertDevConfig} from '../js/backend-context.js';
export const EMULATOR_ENVIRONMENT=Object.freeze({mode:'emulator',projectId:'demo-blakeout-adapter-task3',databaseId:'(default)',namespace:'coherent-v1'});
export const DEV_ENVIRONMENT=Object.freeze({mode:'dev',projectId:'blakeout-darts-dev',databaseId:'(default)',namespace:'coherent-v1'});
// Client routing guard, never a substitute for Firestore authorization.
export function assertAdapterEnvironment({db,auth,sdk,environment=EMULATOR_ENVIRONMENT}) {
 const expected=environment?.mode==='emulator'?EMULATOR_ENVIRONMENT:environment?.mode==='dev'?DEV_ENVIRONMENT:null;
 if(!expected||Object.keys(environment).length!==4||Object.keys(expected).some(k=>environment[k]!==expected[k]))throw Error('Unknown history environment or namespace');
 if(auth?.app!==db?.app||!db?.app||db.app.options?.projectId!==expected.projectId)throw Error('History project or Auth app mismatch');
 if(environment.mode==='dev') {
  assertDevConfig(db.app.options);
  if(typeof sdk?.getFirestore!=='function'||sdk.getFirestore(db.app,'(default)')!==db)throw Error('History requires the default DEV database');
 } else if(db._databaseId && (db._databaseId.projectId!==expected.projectId||db._databaseId.database!=='(default)'))throw Error('History requires the default demo database');
 return expected;
}
