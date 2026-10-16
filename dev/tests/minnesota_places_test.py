#!/usr/bin/env python3
"""Rendered placement continuation; near-win boards are explicit fixtures."""
import asyncio,functools,threading,json
from pathlib import Path
from http.server import ThreadingHTTPServer
from playwright.async_api import async_playwright
from minnesota_cutthroat_test import ROOT,Quiet,setup,state,hit,enter,miss
OUT=Path('/workspace/scratch/minnesota-places-20261016')
async def near(page,index,scores):
 await page.evaluate('''async ({index,scores})=>{
 const {game}=await import('./js/state.js');game.currentPlayer=index;
 game.players.forEach((p,i)=>p.score=scores[i]);
 for(const t of game.cricketTargets)Object.assign(game.players[index].cricketData[t],{marks:3,closed:true});
 Object.assign(game.players[index].cricketData.Bull,{marks:2,closed:false});
 (await import('./js/cricket.js')).updateCricketDisplay();
 }''',{'index':index,'scores':scores})
async def resume(page):
 await page.reload();await page.click('#resumeGameBtn')
async def flow(page,base,build,n,cut):
 await setup(page,base,build,n,cut)
 scores=([0]+[60]* (n-1)) if cut else ([120]+[60]*(n-1))
 await near(page,0,scores);await hit(page,'Bull');await enter(page)
 assert await page.locator('#playForPlacesBtn').is_visible()
 assert (await state(page))['minnesotaPlaces']['order']==[0]
 await resume(page);assert await page.locator('#playForPlacesBtn').is_visible()
 await page.click('#playForPlacesBtn');s=await state(page);assert s['currentPlayer']==1 and not s['undoHistory']
 # Repeated clicks cannot restart the continuation or clear subsequent history.
 await page.evaluate("document.getElementById('playForPlacesBtn')?.click()")
 await miss(page);assert (await state(page))['currentPlayer']==2
 await page.click('#undoBtn');assert (await state(page))['currentPlayer']==1
 await resume(page);assert (await state(page))['currentPlayer']==1 and (await state(page))['minnesotaPlaces']['locked']
 await page.click('#redoBtn');assert (await state(page))['currentPlayer']==2
 # Finish last-in-order second; first-place score would otherwise block this win.
 second=n-1;await near(page,second,scores);await hit(page,'Bull');await enter(page)
 s=await state(page);assert s['minnesotaPlaces']['order'][:2]==[0,second]
 if n==4:
  assert s['currentPlayer']==1 and s['minnesotaPlaces']['phase']=='playing'
  await miss(page);assert (await state(page))['currentPlayer']==2
  await miss(page);assert (await state(page))['currentPlayer']==1 # skip both finished players
  await near(page,1,scores);await hit(page,'Bull');await enter(page)
 else:assert s['minnesotaPlaces']['phase']=='complete'
 final=await state(page);assert final['minnesotaPlaces']['order']==([0,2,1] if n==3 else [0,3,1,2])
 assert await page.locator('#winnerModal').is_visible()
 assert await page.locator('#winnerName').inner_text()==final['players'][0]['name']
 await resume(page);assert (await state(page))['minnesotaPlaces']==final['minnesotaPlaces']
 await page.click('#undoPlaceBtn');s=await state(page);assert s['minnesotaPlaces']['phase']=='playing' and s['minnesotaPlaces']['order'][0]==0
 if not s['pendingDarts']:await hit(page,'Bull')
 await enter(page);assert (await state(page))['minnesotaPlaces']['order']==final['minnesotaPlaces']['order']
 assert len((await state(page))['minnesotaPlaces']['turns'])==len(final['minnesotaPlaces']['turns'])
 await page.set_viewport_size({'width':390,'height':844});await page.screenshot(path=str(OUT/f'{build.replace("/","") or "prod"}-{n}-{cut}.png'),full_page=True)
 assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
 await page.click('#playAgainBtn');assert (await state(page))['minnesotaPlaces'] is None
 archived=await page.evaluate('''async id=>{const {BUILD_STORAGE}=await import('./js/build-context.js');return JSON.parse(localStorage.getItem(BUILD_STORAGE.activeGame+'_places_'+id));}''',final['minnesotaPlaces']['id'])
 assert archived['order']==final['minnesotaPlaces']['order']
 print(f'PASS {build or "production"} {n} players cut={cut}: offer/reload, fixed first, skip, second/third, undo/redo/reload, idempotency, winner, play again',flush=True)
async def main():
 OUT.mkdir(parents=True,exist_ok=True)
 server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)));threading.Thread(target=server.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{server.server_port}'
 try:
  async with async_playwright() as p:
   b=await p.chromium.launch(executable_path='/usr/bin/chromium');ctx=await b.new_context(service_workers='block');await ctx.route('**/*',lambda r:r.continue_() if r.request.url.startswith(base) else r.abort());await ctx.tracing.start(screenshots=True,snapshots=True)
   for build in ['', 'dev/']:
    for n in [3,4]:
     for cut in [False,True]:
      page=await ctx.new_page();await flow(page,base,build,n,cut);await page.close()
   await ctx.tracing.stop(path=str(OUT/'placements-trace.zip'));await b.close()
 finally:server.shutdown()
if __name__=='__main__':asyncio.run(main())
