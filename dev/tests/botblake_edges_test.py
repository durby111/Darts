#!/usr/bin/env python3
import asyncio,functools,threading
from http.server import ThreadingHTTPServer
from playwright.async_api import async_playwright
from botblake_ui_test import ROOT,OUT,Quiet,state,start,score
async def main():
 srv=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)));threading.Thread(target=srv.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{srv.server_port}'
 try:
  async with async_playwright() as pw:
   b=await pw.chromium.launch(executable_path='/usr/bin/chromium');ctx=await b.new_context(service_workers='block');await ctx.route('**/*',lambda r:r.continue_() if r.request.url.startswith(base) else r.abort());p=await ctx.new_page();p.on('dialog',lambda d:d.accept())
   await start(p,base,skill='expert');await score(p)
   before=await state(p);await p.locator('[data-quick="180"]').click();assert (await state(p))['players']==before['players']
   await p.wait_for_timeout(1500);await p.click('#undoBtnX01');await p.wait_for_timeout(550);await p.click('#redoBtnX01');s=await state(p);await p.wait_for_timeout(1500);assert (await state(p))['players']==s['players']
   # Explicit near-win fixture: real scheduler, scorer and winner flow.
   await p.evaluate("""async()=>{const {game}=await import('./js/state.js');game.currentPlayer=1;game.players[1].score=32;Math.random=()=>0;document.dispatchEvent(new CustomEvent('botMatchStarted'));}""")
   await p.wait_for_timeout(1500);assert (await state(p))['players'][1]['score']==0;assert await p.locator('#winnerModal').is_visible()
   s=await state(p);await p.wait_for_timeout(1500);assert (await state(p))==s
   await p.reload();await p.click('#resumeGameBtn');s=await state(p);await p.wait_for_timeout(1500);assert (await state(p))==s
   print('PASS input guard, undo/redo no replay, legal checkout, winner stop and completed reload')
   await start(p,base,'cricket','expert');await p.evaluate("""async()=>{const {game}=await import('./js/state.js');game.currentPlayer=1;for(const data of Object.values(game.players[1].cricketData))Object.assign(data,{marks:3,closed:true});Object.assign(game.players[1].cricketData.Bull,{marks:2,closed:false});Math.random=()=>0;}""");await p.wait_for_timeout(1500);assert await p.locator('#winnerModal').is_visible();s=await state(p);assert s['players'][1]['totalMarks']==2
   await p.wait_for_timeout(1500);assert (await state(p))==s
   print('PASS Cricket winning dart stops subsequent darts and scheduler')
   await p.goto(base+'/dev/');await p.select_option('#gameType','minnesota');await p.select_option('#player2Skill','expert');await p.click('#startGameBtn');assert await p.locator('#setupScreen').is_visible()
   await p.select_option('#player2Skill','off');await p.click('#startGameBtn');assert (await state(p))['type']=='minnesota';assert all(not x.get('bot') for x in (await state(p))['players'])
   print('PASS explicit unsupported mode rejection and human-only mode remains playable')
   await b.close()
 finally:srv.shutdown()
if __name__=='__main__':asyncio.run(main())
