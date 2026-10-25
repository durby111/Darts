import test from 'node:test';
import assert from 'node:assert/strict';
import { recordingStartProblem } from '../js/recording-start-state.js';
const ready={loading:false,ownerId:'owner',profileIds:new Map([['owner',{}],['other',{}]]),selectedIds:['owner','']};
test('screenshot state: no verified owner and all Guests cannot start',()=>{
 assert.match(recordingStartProblem({...ready,ownerId:null,selectedIds:['','']}),/Sign in and verify/);
});
test('verified owner with only Guests is told to link a profile or play normally',()=>{
 assert.match(recordingStartProblem({...ready,selectedIds:['','']}),/Play without recording/);
});
test('loading blocks start; one verified link and a guest permits revalidation',()=>{
 assert.match(recordingStartProblem({...ready,loading:true}),/Checking/);
 assert.equal(recordingStartProblem(ready),'');
});
test('duplicate and stale links block start without removing selected players',()=>{
 const selected=['owner','owner'];assert.match(recordingStartProblem({...ready,selectedIds:selected}),/only one/);
 assert.deepEqual(selected,['owner','owner']);
 assert.match(recordingStartProblem({...ready,selectedIds:['missing','']}),/unavailable/);
});
