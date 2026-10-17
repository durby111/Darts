import assert from 'node:assert/strict';
import {explainRevisionDenial} from '../js/transaction-conflict.js';
let count=0;
async function check(name,fn){await fn();count++;console.log('PASS '+name);}
const denied=()=>Object.assign(new Error('genuine access denial'),{code:'permission-denied'});
const opts=(revision)=>({expectedRevision:2,readCurrentRevision:async()=>revision,assertSession:()=>{}});
await check('denial plus stale revision preserves denial code and cause, does not claim retryable',async()=>{const e=denied(),r=await explainRevisionDenial(e,opts(3));assert.equal(r.code,'permission-denied');assert.equal(r.cause,e);assert.equal(r.revisionChanged,true);assert.equal(r.currentRevision,3);assert.equal(r.retryable,undefined);});
await check('denied diagnostic read preserves original error identity',async()=>{const e=denied();assert.equal(await explainRevisionDenial(e,{...opts(3),readCurrentRevision:async()=>{throw denied();}}),e);});
await check('network diagnostic failure preserves original denial',async()=>{const e=denied();assert.equal(await explainRevisionDenial(e,{...opts(3),readCurrentRevision:async()=>{throw Error('offline');}}),e);});
await check('session mismatch before read does not read',async()=>{const e=denied();let reads=0;assert.equal(await explainRevisionDenial(e,{...opts(3),assertSession:()=>{throw Error('signed out');},readCurrentRevision:async()=>{reads++;return 3;}}),e);assert.equal(reads,0);});
await check('session mismatch after read suppresses revision hint',async()=>{const e=denied();let checks=0;assert.equal(await explainRevisionDenial(e,{...opts(3),assertSession:()=>{if(++checks===2)throw Error('switched');}}),e);});
await check('unchanged, older and malformed revisions never imply a conflict',async()=>{for(const rev of [2,1,NaN,Infinity,'3',null]){const e=denied();assert.equal(await explainRevisionDenial(e,opts(rev)),e);}});
await check('non-denial errors pass through without diagnostics',async()=>{for(const code of ['unauthenticated','unavailable','platform/revision-conflict']){const e=Object.assign(Error(code),{code});assert.equal(await explainRevisionDenial(e,{...opts(3),readCurrentRevision:async()=>{throw Error('must not read');}}),e);}});
await check('invalid expected revisions do not read',async()=>{for(const expectedRevision of [-1,NaN,'2',null]){const e=denied();let reads=0;assert.equal(await explainRevisionDenial(e,{...opts(3),expectedRevision,readCurrentRevision:async()=>{reads++;return 3;}}),e);assert.equal(reads,0);}});
console.log(`PASS ${count} deterministic authorization/diagnostic regression groups`);
