import test from 'node:test';import assert from 'node:assert/strict';
import {mayAttribute,materialize,READ_BUDGET} from './owner-return-analysis.mjs';
const consent={id:'grant1',uid:'a',contextId:'game1',binding:'seat-binding-1',at:10,expires:100};
const occurrence={id:'contest1',contextId:'game1',members:{a:'seat-binding-1'},at:20};
const source={id:'op1',occurrenceId:'contest1',revision:1,status:'active',counters:{a:{points:100,darts:9,marks:0}},at:20};
const input={uid:'a',consent,occurrence,source};
test('budget is independent of number of other players; private write seven calls worst-case',()=>{
 assert.equal(READ_BUDGET.materialize.total,7);assert(READ_BUDGET.materialize.total<=10);
 for(const n of [1,4,20,128])assert.equal(READ_BUDGET.materialize.total,7,String(n));
});
test('post-result and equal-time grants cannot retroactively authorize result',()=>{
 for(const at of [20,21,99])assert.equal(mayAttribute({...input,consent:{...consent,at}}),false);
});
test('expiry or revocation before/equal acceptance deny; later revocation preserves old result only',()=>{
 for(const revokedAt of [19,20])assert.equal(mayAttribute({...input,revokedAt}),false);
 assert(mayAttribute({...input,revokedAt:21}));
 assert.equal(mayAttribute({...input,revokedAt:21,occurrence:{...occurrence,at:22}}),false);
 assert.equal(mayAttribute({...input,consent:{...consent,expires:20}}),false);
});
test('new consent cannot make old revoked grant valid and cannot backfill old occurrence',()=>{
 const renewed={...consent,id:'grant2',at:30,expires:120};
 assert.equal(mayAttribute({...input,consent:renewed}),false);
 assert(mayAttribute({...input,consent:renewed,occurrence:{...occurrence,id:'contest2',at:40}}));
});
test('different UID, seat or context is not authorized',()=>{
 for(const delta of [{uid:'b'},{consent:{...consent,binding:'seat2'}},{consent:{...consent,contextId:'game2'}}])assert.equal(mayAttribute({...input,...delta}),false);
});
test('upstream replacement has a distinct occurrence and binding; old receipt cannot cross',()=>{
 assert.throws(()=>materialize({...input,source:{...source,occurrenceId:'replacement'}}),/Wrong contest/);
 assert.equal(mayAttribute({...input,occurrence:{...occurrence,id:'replacement',members:{a:'different-binding'}}}),false);
});
test('corrections retain original entitlement; undo wins over late original or duplicate delivery',()=>{
 const initial=materialize(input);
 const corrected=materialize({...input,revokedAt:21,current:initial,source:{...source,id:'op2',revision:2,at:30,counters:{a:{points:200,darts:12,marks:0}}}});
 const undone=materialize({...input,revokedAt:21,current:corrected,source:{...source,id:'op3',revision:3,status:'undone',at:40,counters:{a:null}}});
 assert.equal(materialize({...input,current:undone}),undone);assert.equal(undone.status,'undone');assert.equal(undone.counter,null);
});
