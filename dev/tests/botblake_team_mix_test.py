#!/usr/bin/env python3
"""Mixed 3/4-member team rotations through actual setup and scorer controls."""
import asyncio,functools,threading
from http.server import ThreadingHTTPServer
from playwright.async_api import async_playwright
from botblake_ui_test import ROOT,Quiet,state,score,add
async def main():
 srv=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)));threading.Thread(target=srv.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{srv.server_port}'
 try:
  async with async_playwright() as pw:
   b=await pw.chromium.launch(executable_path='/usr/bin/chromium');ctx=await b.new_context(service_workers='block');await ctx.route('**/*',lambda r:r.continue_() if r.request.url.startswith(base) else r.abort());p=await ctx.new_page()
   for size in [3,4]:
    await p.goto(base+'/dev/');await p.evaluate('localStorage.removeItem("blakeout_dev_last_team_setup")');await p.select_option('#gameType','1501');await p.check('#teamMode');await p.click('#startGameBtn')
    for zone in [0,1]:
     for i in range(size):await add(p,f'Human{zone}-{i}',zone,('auto' if zone==0 else 'easy') if i%2 else None)
    # Edit an assigned instance, then verify it survives last-setup reload.
    await p.locator('[data-bot-skill]').last.select_option('expert');await p.click('#teamStartMatchBtn')
    s=await state(p);assert s['teams'][1]['members'][-1 if size==4 else 1]['bot']['skill']=='expert'
    seen=set()
    for turn in range(size*2):
     s=await state(p);side=s['currentPlayer'];index=s['teams'][side]['rotationIndex'];m=s['teams'][side]['members'][index];seen.add((side,index))
     if m.get('bot'):await p.wait_for_timeout(1400)
     else:await score(p,20)
     after=await state(p);assert after['currentPlayer']==1-side;assert after['teams'][side]['rotationIndex']==(index+1)%size
    assert len(seen)==size*2
    savedTeams=(await state(p))['teams'];await p.reload();await p.click('#resumeGameBtn');assert (await state(p))['teams']==savedTeams
    await p.goto(base+'/dev/');await p.check('#teamMode');await p.click('#startGameBtn');assert await p.locator('[data-bot-skill]').last.input_value()=='expert'
    print(f'PASS mixed {size}v{size}: every human and bot throws in order; edited per-instance skill persists in last team setup',flush=True)
   await b.close()
 finally:srv.shutdown()
if __name__=='__main__':asyncio.run(main())
