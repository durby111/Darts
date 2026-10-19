// Disabled demo-only owner side. Canonical writer/discovery integration is blocked.
// This does not create Auth credentials or initialize a Firebase connection.
export function ownerReturnAdapter({db,auth,sdk}) {
 if(db?.app?.options?.projectId!=='demo-blakeout-adapter-task3'||auth?.app!==db.app)throw Error('Matching demo app required');
 const {doc,runTransaction,serverTimestamp,Timestamp}=sdk;
 const ref=(...p)=>doc(db,...p);
 const user=()=>{const u=auth.currentUser;if(!u?.emailVerified||u.isAnonymous)throw Error('Verified owner required');return u;};
 const same=u=>{if(auth.currentUser!==u)throw Error('Account changed');};
 const snapshot=s=>{if(!s.exists())throw Error('Required canonical record missing');return s.data();};
 return Object.freeze({
  async confirm({consentId,bindingId,displayed,acknowledged,expiresAt}){
   const u=user();if(!acknowledged)throw Error('Phone confirmation required');
   return runTransaction(db,async tx=>{
    const b=snapshot(await tx.get(ref('haBindings',bindingId)));same(u);
    if(b.uid!==u.uid||displayed.uid!==u.uid||displayed.bindingId!==bindingId||displayed.contextId!==b.contextId||displayed.scope!==b.scope)throw Error('Phone identity or scope changed');
    tx.set(ref('haOwners',u.uid,'consents',consentId),{uid:u.uid,contextId:b.contextId,binding:bindingId,scope:b.scope,at:serverTimestamp(),expires:Timestamp.fromMillis(expiresAt)});
   });
  },
  async revoke(consentId){const u=user();return runTransaction(db,async tx=>{
   const c=snapshot(await tx.get(ref('haOwners',u.uid,'consents',consentId)));
   const r=await tx.get(ref('haOwners',u.uid,'revocations',consentId));same(u);
   if(c.uid!==u.uid)throw Error('Wrong consent owner');if(r.exists())return;
   tx.set(ref('haOwners',u.uid,'revocations',consentId),{at:serverTimestamp()});
  });},
  async materialize({occurrenceId,operationId,consentId}){
   const u=user();return runTransaction(db,async tx=>{
    const dest=ref('haOwners',u.uid,'history',occurrenceId);
    const [c,o,s,r,h]=await Promise.all([
     tx.get(ref('haOwners',u.uid,'consents',consentId)),tx.get(ref('haOccurrences',occurrenceId)),
     tx.get(ref('haOccurrences',occurrenceId,'operations',operationId)),tx.get(ref('haOwners',u.uid,'revocations',consentId)),tx.get(dest)]);
    same(u);const grant=snapshot(c),first=snapshot(o),source=snapshot(s);
    const t=first.at.toMillis();
    if(grant.uid!==u.uid||grant.binding!==first.members[u.uid]||grant.contextId!==first.contextId||grant.at.toMillis()>=t||grant.expires.toMillis()<=t||(r.exists()&&r.data().at.toMillis()<=t))throw Error('No consent at original acceptance');
    if(source.occurrenceId!==occurrenceId)throw Error('Wrong contest occurrence');
    if(h.exists()&&h.data().revision>=source.revision)return {replayed:true};
    tx.set(dest,{uid:u.uid,occurrenceId,consentId,operationId,revision:source.revision,status:source.status,counter:source.counters[u.uid],at:source.at});
    return {replayed:false};
   });
  }
 });
}
