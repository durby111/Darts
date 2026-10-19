import {assertAdapterEnvironment} from '../history-attribution/environment.mjs';
// Dependency injection uses the same Firebase 10.13.2 SDK as dev/js/platform.js.
// Phone and board must have separate Auth/app instances. No tokens in grants.
export function pairingAdapter({db, auth, sdk, environment}) {
  assertAdapterEnvironment({db,auth,sdk,environment});
  const {doc,getDocFromServer,runTransaction,Timestamp,serverTimestamp}=sdk;
  const ref=(...parts)=>doc(db,...parts);
  const account=()=>{if(!auth.currentUser)throw Error('Sign in first');return auth.currentUser;};
  const same=u=>{if(auth.currentUser!==u)throw Error('Account changed; review again');};
  const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
  return Object.freeze({
    async createGame(){const u=account(),game=random();await runTransaction(db,async t=>{same(u);t.set(ref('qrGames',game),{board:u.uid,active:true});});return game;},
    async pair(game,seat){const u=account(),handle=random();const bytes=crypto.getRandomValues(new Uint32Array(1));const code=String(bytes[0]%1000000).padStart(6,'0');
      await runTransaction(db,async t=>{const g=await t.get(ref('qrGames',game));const grant=await t.get(ref('qrGames',game,'grants',seat));same(u);if(!g.data()?.active||grant.exists())throw Error('Seat unavailable');
        t.set(ref('qrGames',game,'seats',seat),{handle});t.set(ref('qrInvites',handle),{game,seat,expires:Timestamp.fromMillis(Date.now()+110000),status:'open',uid:''});t.set(ref('qrSecrets',handle),{game,code});});return {game,seat,handle,code};},
    async inspect(handle){account();const i=await getDocFromServer(ref('qrInvites',handle));if(!i.exists()||i.data().status!=='open'||i.data().expires.toMillis()<=Date.now())throw Error('Pairing expired or used');return {...i.data(),handle};},
    async claim({handle,game,seat,code,confirmedUid}){const u=account();if(!u.emailVerified||confirmedUid!==u.uid)throw Error('Confirm the current verified identity');
      return runTransaction(db,async t=>{const i=await t.get(ref('qrInvites',handle));const member=await t.get(ref('qrGames',game,'members',u.uid));const grant=await t.get(ref('qrGames',game,'grants',seat));same(u);
        if(!i.exists()||i.data().game!==game||i.data().seat!==seat||i.data().status!=='open'||member.exists()||grant.exists())throw Error('Pairing unavailable or mismatched');
        const result={uid:u.uid,handle,code,expires:Timestamp.fromMillis(Date.now()+14390000)};
        t.update(ref('qrInvites',handle),{status:'claimed',uid:u.uid});t.set(ref('qrGames',game,'grants',seat),result);t.set(ref('qrGames',game,'members',u.uid),{seat,handle});return {uid:u.uid,game,seat,handle};});},
    async revoke(game,seat){const u=account();await runTransaction(db,async t=>{const r=ref('qrGames',game,'grants',seat),g=await t.get(r);same(u);if(!g.exists())return;t.delete(r);t.delete(ref('qrGames',game,'members',g.data().uid));});},
    async end(game){const u=account();await runTransaction(db,async t=>{same(u);t.update(ref('qrGames',game),{active:false});});},
    async checkIn({game,seat,handle}){const u=account();await runTransaction(db,async t=>{same(u);t.set(ref('qrGames',game,'checkins',seat),{uid:u.uid,handle,at:serverTimestamp()});});},
    async participation(game,seat){const u=account();const [g,s]=await Promise.all([getDocFromServer(ref('qrGames',game)),getDocFromServer(ref('qrGames',game,'grants',seat))]);same(u);return {active:!!(g.data()?.active&&s.exists()&&s.data().expires.toMillis()>Date.now()),uid:s.data()?.uid??null};}
  });
}
