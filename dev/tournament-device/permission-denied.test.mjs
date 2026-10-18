import assert from 'node:assert/strict';
import {isPermissionDenied} from './permission-denied.mjs';
const accepted=[
 {code:'permission-denied'}, {code:'PERMISSION_DENIED'},
 {code:'firestore/permission-denied'},
 {message:'PERMISSION_DENIED: evaluation error'},
 {message:'permission-denied'},
 {message:'page.evaluate: FirebaseError: PERMISSION_DENIED: evaluation error'},
 {message:'FirebaseError: permission-denied.'},
];
const rejected=[
 null,undefined,'permission-denied',{},
 {code:'unavailable',message:'FirebaseError: PERMISSION_DENIED'},
 {code:'auth/network-request-failed'}, {code:'unknown'},
 {code:'not-permission-denied'}, {code:'permission-denied-extra'},
 {message:'network error'}, {message:'UNAVAILABLE: retry'},
 {message:'Error: permission denied'}, {message:'permission-denied-extra'},
 {message:'not-PERMISSION_DENIED'},
 {message:'Network error while checking permission-denied'},
 {message:'FirebaseError: unavailable; prior permission-denied'},
 {message:'FirebaseError: PERMISSION_DENIED_EXTRA'},
];
for (const value of accepted) assert.equal(isPermissionDenied(value),true,JSON.stringify(value));
for (const value of rejected) assert.equal(isPermissionDenied(value),false,JSON.stringify(value));
console.log(`PASS strict denial matcher: ${accepted.length} accepted and ${rejected.length} rejected cases`);
