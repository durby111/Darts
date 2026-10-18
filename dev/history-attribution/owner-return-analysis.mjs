// Executable temporal contract, NOT a Firestore-rule evaluator.
import assert from 'node:assert/strict';
export function mayAttribute({uid,consent,revokedAt=null,occurrence}) {
 return consent.uid===uid && consent.binding===occurrence.members[uid]
  && consent.contextId===occurrence.contextId
  && consent.at<occurrence.at && occurrence.at<consent.expires
  && (revokedAt===null || occurrence.at<revokedAt);
}
export function materialize({uid,consent,revokedAt,occurrence,source,current=null}) {
 assert(mayAttribute({uid,consent,revokedAt,occurrence}),'Not entitled at original acceptance');
 assert.equal(source.occurrenceId,occurrence.id,'Wrong contest occurrence');
 assert(Number.isSafeInteger(source.revision)&&source.revision>0);
 if(current&&current.revision>=source.revision)return current;
 return {uid,occurrenceId:occurrence.id,consentId:consent.id,operationId:source.id,revision:source.revision,status:source.status,counter:structuredClone(source.counters[uid]),at:source.at};
}
// Conservative counts: repeated get calls counted separately, no cache credit.
export const READ_BUDGET=Object.freeze({
 consentCreate:{binding:1,total:1},
 revokeCreate:{consent:1,total:1},
 materialize:{consentBinding:1,occurrence:1,consentTiming:1,revocationExists:1,revocationGet:1,sourceOperation:1,currentExists:1,total:7}
});
