import assert from 'node:assert/strict';
import {readProfilePage} from '../js/profile-directory.js';
const rows=Array.from({length:105},(_,i)=>({id:`u${String(i).padStart(3,'0')}`,name:'Same Name'}));const queries=[];
const sdk={collection:()=>null,documentId:()=> '__name__',orderBy:field=>({order:field}),limit:n=>({limit:n}),startAfter:id=>({after:id}),query:(_, ...constraints)=>constraints,getDocsFromServer:async constraints=>{queries.push(constraints);assert.equal(constraints.find(x=>x.limit)?.limit,50);assert.equal(constraints.find(x=>x.order)?.order,'__name__');const after=constraints.find(x=>x.after)?.after;return {docs:rows.filter(x=>!after||x.id>after).slice(0,50).map(x=>({id:x.id,data:()=>({name:x.name})}))};}};
let cursor=null;const received=[];do{const page=await readProfilePage({},sdk,'profiles',cursor);received.push(...page.profiles);cursor=page.nextCursor;}while(cursor!==null);
assert.deepEqual(received,rows);assert.equal(queries.length,3);assert.equal(new Set(received.map(x=>x.id)).size,105);
await assert.rejects(readProfilePage({},sdk,'profiles','../other'),/cursor/);assert.equal(queries.length,3);
const exactSdk={...sdk,getDocsFromServer:async constraints=>({docs:constraints.some(x=>x.after)?[]:rows.slice(0,50).map(x=>({id:x.id,data:()=>({name:x.name})}))})};const first=await readProfilePage({},exactSdk,'profiles');assert.equal(first.nextCursor,'u049');assert.deepEqual(await readProfilePage({},exactSdk,'profiles',first.nextCursor),{profiles:[],nextCursor:null});
console.log('PASS directory: 105 profiles / 3 bounded pages, duplicate names remain distinct, invalid cursor refused, exact page boundary terminates');
