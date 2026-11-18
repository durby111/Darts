// Actual worker install/activate/fetch handlers with fresh, isolated Cache API
// fixtures. No real browser storage, network, cloud writes or player data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
for (const build of ['', 'dev/']) {
 const base = `https://example.test/${build}`, handlers = {}, stores = new Map();
 let online = false, status = 200, skipped = 0, claimed = 0;
 const key = r => typeof r === 'string' ? new URL(r, base).href : r.url;
 const caches = {
  async open(name) { if (!stores.has(name)) stores.set(name, new Map()); const m = stores.get(name);
   return { async addAll(requests) { for (const r of requests) { assert.equal(r.cache,'reload'); const p = new URL(r.url).pathname; const file = p.endsWith('/') ? p+'index.html' : p; assert.ok(fs.existsSync(new URL('../../'+file.slice(1),import.meta.url)),file); m.set(r.url,new Response(file)); } },
    async match(r) { return m.get(key(r))?.clone(); }, async put(r,s) {m.set(key(r),s);} };
  }, async keys(){return [...stores.keys()]}, async delete(k){return stores.delete(k)}
 };
 class ScopedRequest extends Request { constructor(r,opts){super(typeof r==='string'?new URL(r,base):r,opts);} }
 const ctx=vm.createContext({URL,Request:ScopedRequest,Response,Set,setTimeout:fn=>fn(), caches,
  self:{location:new URL('sw.js',base),addEventListener:(e,f)=>handlers[e]=f,skipWaiting:()=>skipped++,clients:{claim:()=>claimed++}},
  fetch:async()=>{if(!online)throw Error('offline');return new Response('network',{status});}
 });
 vm.runInContext(fs.readFileSync(new URL('../../'+build+'sw.js',import.meta.url),'utf8')+'\nthis.name=CACHE_NAME;',ctx);
 stores.set(build?'blakeout-dev-v1':'blakeout-v1',new Map());
 const other=build?'blakeout-v1':'blakeout-dev-v1'; stores.set(other,new Map());
 async function lifecycle(type){let p;handlers[type]({waitUntil:v=>p=v});await p;}
 await lifecycle('install');await lifecycle('activate');
 assert.equal(skipped,1);assert.equal(claimed,1);assert.ok(stores.has(other));assert.equal(stores.size,2);
 async function navigate(relative,options={}) {let p;const request={url:new URL(relative,base).href,method:'GET',mode:'navigate',...options};handlers.fetch({request,respondWith:v=>p=v});return p;}
 for(const path of ['local/brackets/','local/brackets/?id=synthetic','local/brackets/index.html?id=synthetic','?localTournament=1&tournamentMatch=1','index.html?localTournament=1&tournamentMatch=1']) {
  for(let reload=0;reload<2;reload++) {const result=await navigate(path);assert.ok(result,path);assert.equal(await result.text(),'/'+build+(path.startsWith('local/')?'local/brackets/index.html':'index.html'));}
 }
 for(const path of ['accounts/?oobCode=secret','local/brackets/?oobCode=secret','local/brackets/?apiKey=secret','brackets/?id=cloud','?tournamentMatch=1','js/app.js?version=unknown','missing/','https://other.test/local/brackets/',build?'../local/brackets/':'dev/local/brackets/']) assert.equal(await navigate(path),undefined,path);
 assert.equal(await navigate('local/brackets/?id=synthetic',{method:'POST'}),undefined);
 assert.equal(await navigate('local/brackets/?id=synthetic',{mode:'cors'}),undefined);
 // An HTTP error is not a network disconnect and must not be masked.
 online=true;status=403;assert.equal((await navigate('local/brackets/?id=synthetic')).status,403);
 status=200;assert.equal(await (await navigate('local/brackets/?id=synthetic')).text(),'network');
 online=false;assert.equal(await (await navigate('local/brackets/?id=synthetic')).text(),'network');
 const setup=fs.readFileSync(new URL('../../'+build+'js/setup.js',import.meta.url),'utf8');
 assert.ok(setup.includes('(no email — shared roster)'));assert.ok(!setup.includes('(no email — local only)'));
 console.log('PASS '+(build||'production/')+' cold offline entry/scorer/return/reload, sensitive/scope/method exclusions, cache activation, network-first and roster copy');
}
