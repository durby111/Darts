#!/usr/bin/env python3
"""Adapter/engine failure boundaries in Chromium; not full UI acceptance evidence."""
import asyncio, functools, threading
from http.server import ThreadingHTTPServer
from playwright.async_api import async_playwright
from local_tournament_flow_test import ROOT, OUT, Quiet
JS = r'''async () => {
const p=await import('/dev/local/platform.js'), e=await import('/dev/js/brackets/engine.js');
const ok=(v,m)=>{if(!v)throw Error(m);};
const reject=async(fn,text)=>{let error;try{await fn();}catch(x){error=x;}ok(error?.message.includes(text),`Expected ${text}; got ${error?.message}`);};
const fixture=(id,n=8)=>e.saveRoster(e.createTournament({id,ownerId:'device-organizer',title:'Boundary',date:'2026-10-15',gameType:'301',bestOf:1}),Array.from({length:n},(_,i)=>({id:`r${i}`,playerId:null,name:`Player ${i}`,tag:String(Math.floor(i/2)+1),paid:true,checkedIn:true,standby:false})));
let t=fixture('edge');const original=JSON.stringify(t);
await reject(()=>e.blindDraw({...t,registrations:t.registrations.slice(0,5)}),'even number');
await reject(()=>e.blindDraw({...t,registrations:t.registrations.map((r,i)=>({...r,checkedIn:i!==0}))}),'Check in');
const draw=e.blindDraw(t);ok(JSON.stringify(t)===original,'Draw mutated input');ok(draw.teams.length===4 && new Set(draw.teams.flatMap(x=>x.memberIds)).size===8,'Draw members');
let standby=fixture('standby',6);standby.registrations[4].standby=standby.registrations[5].standby=true;
ok(e.blindDraw(standby).teams.length===2,'Standby excluded');
t=e.startTournament(draw);
for(const kind of ['301','501','cricket','spanish','minnesota','chicago']) {
 const next=e.setFormat(t,'brackets','winners',{gameType:kind,bestOf:kind==='chicago'?3:1});
 ok(e.matchFormat(next,next.matches[0]).gameType===kind,'Game accepted '+kind);
}
await reject(()=>e.setFormat(t,'brackets','winners',{gameType:'301',bestOf:101}),'Best-of');
t=e.setFormat(t,'brackets','winners',{gameType:'501',bestOf:1});
t=e.setFormat(t,'rounds','winners:1',{gameType:'cricket',bestOf:3});
t=e.setFormat(t,'matches',t.matches[0].id,{gameType:'spanish',bestOf:5});
ok(e.matchFormat(t,t.matches[0]).gameType==='spanish','Match priority');ok(e.matchFormat(t,t.matches[1]).gameType==='cricket','Round priority');
console.log('PASS blind draw invalid/standby/input immutability; six supported games, format validation and precedence');
await p.createTournamentDocument(fixture('concurrent'));
const base=await p.getTournament('concurrent');
const simultaneous=await Promise.allSettled([1,2].map(()=>p.updateTournament(base.id,base.revision,x=>e.blindDraw(x))));
ok(simultaneous.filter(x=>x.status==='fulfilled').length===1,'One revision wins across concurrent requests');
ok((await p.getTournament(base.id)).revision===base.revision+1,'Single revision increment');
console.log('PASS concurrent local writes serialize; stale revision rejected');
let stored=await p.getTournament(base.id);const raw=localStorage.getItem(p.STORAGE_KEY);
const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===p.STORAGE_KEY)throw Error('Quota fault');return set.call(this,k,v);};
try {await reject(()=>p.updateTournament(stored.id,stored.revision,x=>e.startTournament(x)),'Quota fault');}
finally {Storage.prototype.setItem=set;}
ok(localStorage.getItem(p.STORAGE_KEY)===raw,'Failed save changed stored event');
stored=await p.updateTournament(stored.id,stored.revision,x=>e.startTournament(x));
const m=stored.matches.find(x=>x.status==='ready');
const result={matchId:m.id,winnerId:m.teamA,scoreA:1,scoreB:0};let updates=0;
const updater=x=>{updates++;return e.recordResult(x,m.id,result);};
await p.saveMatchResult(stored.id,stored.revision,'receipt',result,updater);
await p.saveMatchResult(stored.id,stored.revision,'receipt',result,updater);
await p.saveMatchResult(stored.id,stored.revision,'receipt',Object.fromEntries(Object.entries(result).reverse()),updater);
ok(updates===1,'Retry re-applied result');
await reject(()=>p.saveMatchResult(stored.id,stored.revision,'receipt',{...result,winnerId:m.teamB},updater),'different scoring');
console.log('PASS quota failure preserves state; retry saves; lost-ack retry is idempotent; receipt mismatch rejected');
let current=await p.getTournament(stored.id);const receipt=JSON.stringify(JSON.parse(localStorage.getItem(p.STORAGE_KEY)).results);
current=await p.updateTournament(current.id,current.revision,x=>e.recordResult(x,m.id,{winnerId:m.teamB,scoreA:0,scoreB:1}));
await p.saveMatchResult(stored.id,stored.revision,'receipt',result,updater);
ok((await p.getTournament(stored.id)).matches.find(x=>x.id===m.id).winnerId===m.teamB,'Old receipt reverted correction');
ok(JSON.stringify(JSON.parse(localStorage.getItem(p.STORAGE_KEY)).results)===receipt,'Correction mutated ledger');
while(e.canCorrect(current,current.matches.find(x=>x.id===m.id))) {
 const ready=current.matches.find(x=>x.status==='ready');
 current=e.recordResult(current,ready.id,{winnerId:ready.teamA,scoreA:1,scoreB:0});
}
await reject(()=>e.recordResult(current,m.id,{winnerId:m.teamA,scoreA:1,scoreB:0}),'dependent match');
console.log('PASS correction audit keeps original receipt; stale replay cannot revert; played descendants prevent correction');
const active=await p.getTournament(stored.id);const ready=active.matches.find(x=>x.status==='ready');
localStorage.setItem('blakeout_dev_local_active_game',JSON.stringify({tournament:{tournamentId:active.id,matchId:ready.id,status:'scoring'}}));
await reject(()=>p.updateTournament(active.id,active.revision,x=>e.setFormat(x,'matches',ready.id,{gameType:'501',bestOf:1})),'already started');
localStorage.removeItem('blakeout_dev_local_active_game');
const backup=localStorage.getItem(p.STORAGE_KEY);localStorage.setItem(p.STORAGE_KEY,'not JSON');
await reject(()=>p.initPlatform(),'JSON');ok(localStorage.getItem(p.STORAGE_KEY)==='not JSON','Corrupt storage overwritten');
localStorage.setItem(p.STORAGE_KEY,backup);
console.log('PASS format cannot invalidate an active scorer; malformed storage fails without replacement');
await p.createTournamentDocument(fixture('two-tabs',4));
return true;
}'''
async def main():
 OUT.mkdir(parents=True,exist_ok=True)
 server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)));threading.Thread(target=server.serve_forever,daemon=True).start()
 try:
  async with async_playwright() as a:
   b=await a.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);context=await b.new_context(service_workers='block');page=await context.new_page()
   page.on('console',lambda msg:print(msg.text,flush=True) if msg.text.startswith('PASS') else None)
   await page.goto(f'http://127.0.0.1:{server.server_port}/dev/local/brackets/')
   assert await page.evaluate(JS)
   url=f'http://127.0.0.1:{server.server_port}/dev/local/brackets/?id=two-tabs'
   await page.goto(url)
   other=await page.context.new_page();await other.goto(url)
   for tab,name in [(page,'First tab person'),(other,'Second tab person')]:
    await tab.wait_for_function("document.querySelector('#rosterPanel') && !document.querySelector('#rosterPanel').hidden")
    await tab.fill('#guestName',name);await tab.locator('#addForm button').click()
   await page.click('#saveRoster')
   await page.wait_for_function("document.querySelector('#saveRoster').disabled")
   await other.click('#saveRoster')
   await other.wait_for_function("document.querySelector('#message').textContent.includes('changed')")
   assert await other.locator('#rosterRows input[data-field=name]').evaluate_all("xs=>xs.some(x=>x.value==='Second tab person')")
   stored=await other.evaluate("async()=>await (await import('/dev/local/platform.js')).getTournament('two-tabs')")
   assert any(r['name']=='First tab person' for r in stored['registrations'])
   assert not any(r['name']=='Second tab person' for r in stored['registrations'])
   await other.close()
   print('PASS two rendered tabs: stale save rejected, unsaved draft retained, newer roster preserved',flush=True)
   await page.set_viewport_size({'width':390,'height':844});await page.screenshot(path=str(OUT/'local-mobile.png'),full_page=True)
   assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
   print('PASS local entry at 390px without horizontal page overflow',flush=True)
   await b.close()
 finally:server.shutdown()
if __name__=='__main__':asyncio.run(main())
