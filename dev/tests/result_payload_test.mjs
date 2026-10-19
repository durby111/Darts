import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { encodeResultLedger, decodeResultLedger } from '../js/result-payload.js';
const rules=fs.readFileSync(new URL('../backend-setup/firestore.isolated-candidate.rules',import.meta.url),'utf8');
const context=vm.createContext({});
// Evaluate only the extracted grammar functions using JS regex, NOT Firestore/RE2.
vm.runInContext(`String.prototype.matches=function(pattern){return new RegExp('^(?:'+pattern+')$').test(this)};
const originalSplit=String.prototype.split;String.prototype.split=function(pattern){return originalSplit.call(this,new RegExp(pattern))};`,context);
for(const name of ['devLegScores','devLedger']) {
 const start=rules.indexOf('    function '+name+'('),end=rules.indexOf('\n    function ',start+1);
 const code=rules.slice(start,end).replaceAll('.size()', '.length').replaceAll('value is string', "typeof value === 'string'");
 vm.runInContext(code,context);
}
const turn={id:'turn1',registrationId:'slot1',playerId:'alice',teamId:'side1',points:60,darts:3,marks:0,bust:false};
const leg={id:'leg1',gameType:'301',winnerId:'side1',turns:[turn]};
const result={participantIds:['alice'],legScores:[{id:'leg1',gameType:'301',winnerId:'side1'}],records:{id:'result1',legs:[leg],winnerIds:['side1']}};
let count=0;
function check(value){const packed=encodeResultLedger(value);assert(context.devLegScores(packed.legScores));assert(context.devLedger(packed.records??null,value.participantIds));assert.deepEqual(encodeResultLedger(decodeResultLedger({...value,...packed})),packed);count++;return packed;}
check(result);check({participantIds:[],legScores:[]});
check({...result,records:{...result.records,legs:[{...leg,gameType:'minnesota',minnesotaCutthroat:true}]}});
check({...result,participantIds:[],records:{...result.records,legs:[{...leg,turns:[{...turn,playerId:null,registrationId:null}]}]}});
for(const [field,value] of [['email','secret@example.invalid'],['playerId','bob'],['darts',4],['darts',0],['darts',1.5],['points',-1],['points',Infinity],['marks','0'],['bust','false'],['registrationId','a@b']]) {
 const bad=structuredClone(result);bad.records.legs[0].turns[0][field]=value;assert.throws(()=>encodeResultLedger(bad));count++;
}
const matrix=JSON.parse(fs.readFileSync(new URL('../backend-setup/isolated-rules-cases.json',import.meta.url)));
for(const name of ['strict canonical ledger accepted','raw nested ledger denied','private nested email denied','unrelated player denied','invalid darts denied','negative points denied','string numeric denied','bad boolean denied','escaped identity denied','nested leg unknown fields denied']) {
 const c=matrix.cases.find(c=>c.name===name);assert(c,name);assert.equal(context.devLedger(c.data.records,c.data.participantIds),c.allow,name);count++;
}
const badSummary=matrix.cases.find(c=>c.name==='unknown leg summary field denied');assert.equal(context.devLegScores(badSummary.data.legScores),false);count++;
const packed=check(result);
assert.throws(()=>decodeResultLedger({...result,...packed,records:result.records}));count++;
assert.throws(()=>decodeResultLedger({...result,...packed,records:packed.records.replace('alice','bob')}));count++;
assert(!context.devLegScores(JSON.stringify(Array.from({length:100},()=>result.legScores[0]))));count++;
const big={...result,records:{...result.records,legs:[{...leg,turns:Array.from({length:1000},(_,i)=>({...turn,id:'turn'+i}))}]}};check(big);
console.log(`PASS ${count} codec/negative/source-grammar checks; JS regex only, not Firestore compilation, RE2, authorization or budget proof`);
