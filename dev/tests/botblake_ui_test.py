#!/usr/bin/env python3
"""Local rendered BotBlake tests. No external network or backend writes."""
import asyncio, functools, threading, json
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[2]
OUT=Path('/workspace/scratch/botblake-20261029')
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
async def state(p):return await p.evaluate("async()=>JSON.parse(JSON.stringify((await import('./js/state.js')).game))")
async def start(p,base,mode='501',skill='auto'):
 await p.goto(base+'/dev/');await p.select_option('#gameType',mode);await p.select_option('#player2Skill',skill);await p.click('#startGameBtn');await p.wait_for_selector('#gameScreen',state='visible')
async def score(p,n=60):
 await p.wait_for_timeout(750)
 for d in str(n):await p.locator(f'[data-digit="{d}"]').click()
 await p.click('#x01EnterBtn')
async def add(p,name,zone,skill=None):
 if skill:
  await p.select_option('#teamBotSkill',skill);await p.click('#teamAddBotBtn')
 else:
  await p.fill('#teamAddName',name);await p.click('#teamAddBtn')
 await p.locator('#teamTray [data-chip-id]').last.click();await p.locator(f'#teamZone{zone}').click(position={'x':10,'y':10})
async def main():
 OUT.mkdir(parents=True,exist_ok=True)
 srv=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)));threading.Thread(target=srv.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{srv.server_port}'
 try:
  async with async_playwright() as pw:
   browser=await pw.chromium.launch(executable_path='/usr/bin/chromium');ctx=await browser.new_context(service_workers='block');await ctx.route('**/*',lambda r:r.continue_() if r.request.url.startswith(base) else r.abort());await ctx.tracing.start(screenshots=True,snapshots=True)
   p=await ctx.new_page();errors=[];p.on('pageerror',lambda e:errors.append(str(e)));p.on('dialog',lambda d:d.accept())
   await start(p,base);assert (await state(p))['currentPlayer']==0
   await score(p);await p.wait_for_timeout(1500);s=await state(p);assert s['currentPlayer']==0 and len(s['players'][1]['history'])==1,s
   await p.click('#undoBtnX01');await p.wait_for_timeout(1600);s=await state(p);assert s['currentPlayer']==1 and len(s['players'][1]['history'])==0
   await p.reload();await p.click('#resumeGameBtn');await p.wait_for_timeout(1500);assert (await state(p))['currentPlayer']==1
   await p.locator('#botStatus button').click();await p.wait_for_timeout(1500);assert len((await state(p))['players'][1]['history'])==1
   await score(p);await p.click('#menuBtn');s=await state(p);await p.wait_for_timeout(1600);assert (await state(p))==s
   await p.click('#gameMenuNewGameBtn');await p.wait_for_timeout(1400);assert (await state(p))['currentPlayer']==0
   await p.set_viewport_size({'width':390,'height':844});await p.screenshot(path=str(OUT/'individual.png'));await p.set_viewport_size({'width':1280,'height':900})
   print('PASS individual setup, actual turns, undo pause, save/reload, continue, menu cancellation, restart')
   for size in [2,3,4]:
    await p.goto(base+'/dev/');await p.evaluate('localStorage.removeItem("blakeout_dev_last_team_setup")');await p.select_option('#gameType','501');await p.check('#teamMode');await p.click('#startGameBtn')
    for i in range(size):await add(p,f'H{i}',0)
    for i in range(size):await add(p,'',1,['easy','expert','medium','hard'][i])
    await p.click('#teamStartMatchBtn');s=await state(p);assert [len(t['members']) for t in s['teams']]==[size,size];assert s['teams'][1]['members'][0]['bot']['skill']=='easy';assert s['teams'][1]['members'][1]['bot']['skill']=='expert'
    ids=[m['id'] for t in s['teams'] for m in t['members']];assert len(ids)==len(set(ids))
    for i in range(size+1):
     await score(p);await p.wait_for_timeout(1500);s=await state(p);assert s['currentPlayer']==0 and [t['rotationIndex'] for t in s['teams']]==[(i+1)%size]*2
    await p.reload();await p.click('#resumeGameBtn');assert [m['bot']['skill'] for m in (await state(p))['teams'][1]['members']]==['easy','expert','medium','hard'][:size]
    print(f'PASS {size}v{size} differently skilled bots, human/bot teams, rotation and reload')
   await p.goto(base+'/dev/');await p.evaluate('localStorage.removeItem("blakeout_dev_last_team_setup")');await p.select_option('#gameType','cricket');await p.check('#teamMode');await p.click('#startGameBtn')
   for zone in [0,1]:
    await add(p,'',zone,'auto' if zone==0 else 'hard');await add(p,f'Human{zone}',zone)
   await p.set_viewport_size({'width':390,'height':844});await p.screenshot(path=str(OUT/'teams-mobile.png'),full_page=True);assert await p.evaluate('document.documentElement.scrollWidth <= innerWidth+1');await p.set_viewport_size({'width':1280,'height':900})
   await p.click('#teamStartMatchBtn');s=await state(p);assert all(not t['members'][0].get('bot') for t in s['teams'])
   for _ in range(2):
    await p.locator('[data-target="20"][data-multiplier="3"]').click();await p.click('#enterBtn')
   await p.wait_for_timeout(3000);s=await state(p);assert s['currentPlayer']==0 and [t['rotationIndex'] for t in s['teams']]==[0,0];assert s['teams'][0]['members'][0]['practice']['marks']==3
   assert s['teams'][0]['members'][1]['bot']['skill']=='auto' and s['teams'][1]['members'][1]['bot']['skill']=='hard'
   print('PASS mixed teams, Auto human-first ordering, Cricket actual bot turns and human-only marks')
   await p.click('#menuBtn');await p.click('#gameMenuSettingsBtn');await p.set_viewport_size({'width':390,'height':844});await p.uncheck('#teamMode');await p.locator('#player2Skill').scroll_into_view_if_needed();await p.screenshot(path=str(OUT/'setup-mobile.png'),full_page=True);assert await p.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
   assert not errors,errors
   await ctx.tracing.stop(path=str(OUT/'ui-trace.zip'));await browser.close()
 finally:srv.shutdown()
if __name__=='__main__':asyncio.run(main())
