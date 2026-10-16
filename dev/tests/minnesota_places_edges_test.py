#!/usr/bin/env python3
import asyncio,functools,threading,json
from http.server import ThreadingHTTPServer
from playwright.async_api import async_playwright
from minnesota_places_test import OUT,near,resume
from minnesota_cutthroat_test import ROOT,Quiet,setup,state,hit,enter,miss,special
async def recorded(page,base,build):
 await setup(page,base,build,3,True)
 await page.evaluate('''async()=>{
 const {game}=await import('./js/state.js');
 game.recording={source:'casual',resultId:'places-recorded-fixture',gameType:'minnesota',minnesotaCutthroat:true,bestOf:1,legWins:[0,0,0],status:'scoring',teams:game.players.map((p,i)=>({id:'t'+i,name:p.name,members:[{id:'r'+i,playerId:'p'+i,name:p.name}]}))};
 (await import('./js/scoring-records.js')).beginScoringLeg('minnesota');
 }''')
 await near(page,0,[0,60,60]);await hit(page,'Bull');await enter(page)
 # Simulate a primary result already pending/saved, without any backend calls.
 await page.evaluate('''async()=>{const {game,saveActiveGame}=await import('./js/state.js');game.recording.status='pending';game.recording.pendingResult=(await import('./js/scoring-records.js')).scoringResult();saveActiveGame();}''')
 primary=(await state(page));await page.click('#playForPlacesBtn')
 # Active record remains immutable even when status later changes to saved.
 await miss(page);await page.evaluate("async()=>{const {game,saveActiveGame}=await import('./js/state.js');game.recording.status='saved';saveActiveGame()}")
 await page.click('#undoBtn');assert (await state(page))['recording']['status']=='saved'
 await page.evaluate('''async()=>{const {game,saveActiveGame}=await import('./js/state.js');Object.assign(game.players[1].cricketData.Triples,{marks:3,closed:true});saveActiveGame();(await import('./js/cricket.js')).updateCricketDisplay()}''')
 await hit(page,'Triples');await page.click('[data-keypad="6"]');await resume(page)
 assert await page.locator('#scoreKeypadModal').is_visible();await page.click('[data-keypad="0"]');await page.click('[data-keypad="OK"]')
 await page.click('#tournamentMissDart');await page.click('#tournamentMissDart');await enter(page)
 s=await state(page);assert [p['score'] for p in s['players']]==[0,60,120];assert len(s['minnesotaPlaces']['turns'])==1
 assert s['minnesotaPlaces']['turns'][0]['points']==60
 assert s['scoringRecords']==primary['scoringRecords'] and s['recording']['pendingResult']==primary['recording']['pendingResult']
 await near(page,1,[0,60,120]);await hit(page,'Bull');await enter(page)
 s=await state(page);assert s['minnesotaPlaces']['order']==[0,1,2];assert s['recording']['winnerIndex']==0 and s['recording']['legWins']==[1,0,0]
 await resume(page);await page.click('#undoPlaceBtn');await enter(page)
 s=await state(page);assert s['scoringRecords']==primary['scoringRecords'] and s['recording']['pendingResult']==primary['recording']['pendingResult']
 archive=await page.evaluate("async()=>{let {BUILD_STORAGE}=await import('./js/build-context.js');return Object.keys(localStorage).filter(k=>k.startsWith(BUILD_STORAGE.activeGame+'_places_')).map(k=>JSON.parse(localStorage[k]));}")
 saved=[a for a in archive if a['id']==s['minnesotaPlaces']['id']];assert len(saved)==1 and saved[0]['order']==[0,1,2] and len(saved[0]['turns'])==2
 print('PASS '+(build or 'production')+' recorded continuation: saved primary untouched, pending result/ledger stable, keypad interruption, penalty excludes first, undo after status change, unique persisted placement record',flush=True)
async def edges(page,base,build):
 for cut in [False,True]:
  await setup(page,base,build,3,cut)
  scores=[0,120,60] if cut else [200,60,120]
  await near(page,0,scores);await hit(page,'Bull');await enter(page);await page.click('#playForPlacesBtn')
  await near(page,1,scores);await hit(page,'Bull');await enter(page)
  assert (await state(page))['minnesotaPlaces']['order']==[0] # still behind active opponent
  await miss(page);await hit(page,'20',3);await enter(page)
  assert (await state(page))['minnesotaPlaces']['order']==[0,1,2] # scoring to a tie earns second
 print('PASS '+(build or 'production')+' normal/Cutthroat second-place rejection while behind; scoring to tied lead wins against remaining opponents only',flush=True)
 # A different game must not inherit the placement summary or hidden primary undo.
 await page.click('#newGameBtn');await page.select_option('#gameType','301');await page.click('#startGameBtn')
 await page.evaluate("async()=>{const {game}=await import('./js/state.js');(await import('./js/ui.js')).showWinner(game.players[0].name)}")
 assert await page.locator('#minnesotaPlacesPanel').is_hidden()
 assert await page.locator('#winnerCancelBtn').is_visible()
 # Canceling the initial offer can still correct the original unrecorded winning dart.
 await setup(page,base,build,3,False);await near(page,0,[100,0,0]);await hit(page,'Bull');await enter(page);await page.click('#winnerCancelBtn')
 assert (await state(page))['minnesotaPlaces'] is None
 await hit(page,'Bull');await enter(page);await page.click('#playForPlacesBtn')
 # Existing closed remaining player earns place on their next turn, no fake dart.
 await page.evaluate('''async()=>{const {game}=await import('./js/state.js');for(const t of game.cricketTargets)Object.assign(game.players[2].cricketData[t],{marks:3,closed:true})}''')
 await miss(page);assert (await state(page))['minnesotaPlaces']['order']==[0,2,1]
 await setup(page,base,build,2,True,teams=True);await near(page,0,[0,60]);await hit(page,'Bull');await enter(page)
 assert await page.locator('#playForPlacesBtn').count()==0 # two teams: no third side to play
 print('PASS '+(build or 'production')+' initial-winner correction, already-closed next-turn placement, two-team game has no offer',flush=True)
async def main():
 OUT.mkdir(parents=True,exist_ok=True);srv=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)));threading.Thread(target=srv.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{srv.server_port}'
 try:
  async with async_playwright() as p:
   b=await p.chromium.launch(executable_path='/usr/bin/chromium');c=await b.new_context(service_workers='block');await c.route('**/*',lambda r:r.continue_() if r.request.url.startswith(base) else r.abort());await c.tracing.start(screenshots=True,snapshots=True)
   for build in ['', 'dev/']:
    page=await c.new_page();page.on('dialog',lambda d:asyncio.create_task(d.accept()));await recorded(page,base,build);await edges(page,base,build);await page.close()
   await c.tracing.stop(path=str(OUT/'placements-edges-trace.zip'));await b.close()
 finally:srv.shutdown()
if __name__=='__main__':asyncio.run(main())
