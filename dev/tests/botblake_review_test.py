#!/usr/bin/env python3
"""Regression checks from BotBlake's post-implementation review; local only."""
import asyncio, functools, threading
from http.server import ThreadingHTTPServer
from playwright.async_api import async_playwright
from botblake_ui_test import ROOT, Quiet, state, start, score

async def settings_pause(p, base):
 await start(p,base,skill='expert');await score(p)
 await p.click('#menuBtn');await p.click('#gameMenuVisualBtn')
 assert await p.locator('#settingsModal').is_visible()
 before=await state(p);await p.wait_for_timeout(1600)
 assert (await state(p))['players']==before['players'], 'Bot advanced behind Visual Settings'

async def builder_keyboard(p, base):
 await start(p,base,skill='expert');await score(p)
 await p.click('#menuBtn');await p.click('#gameMenuSettingsBtn')
 await p.check('#teamMode');await p.click('#startGameBtn')
 await p.locator('#teamAddName').press_sequentially('New Human')
 assert await p.locator('#teamAddName').input_value()=='New Human', 'Pending old bot blocked team-builder typing'
 before=await state(p);await p.wait_for_timeout(1600)
 assert (await state(p))['players']==before['players']

async def mode_coverage(p, base):
 for mode in ['301','501','701','801','901','1101','1501','cricket','spanish','cutthroat']:
  await start(p,base,mode,'expert')
  if mode in ['cricket','spanish','cutthroat']:
   await p.locator('[data-target="20"][data-multiplier="3"]').click();await p.click('#enterBtn')
  else:await score(p)
  await p.wait_for_timeout(1500);s=await state(p)
  assert s['currentPlayer']==0,mode
  assert s['players'][1]['throws']==1 if mode in ['cricket','spanish','cutthroat'] else len(s['players'][1]['history'])==1,mode

async def config_and_first(p,base):
 await p.goto(base+'/dev/');await p.select_option('#gameType','501');await p.select_option('#player1Skill','auto');await p.select_option('#numPlayers','3');await p.select_option('#player3Skill','hard')
 await p.click('#startGameBtn');s=await state(p)
 assert not s['players'][0].get('bot') and [x.get('bot',{}).get('skill') for x in s['players']]==[None,'auto','hard']
 await p.reload();await p.locator('#loadLastBtn').evaluate('(el)=>el.click()')
 assert [await p.locator(f'#player{i}Skill').input_value() for i in [1,2,3]]==['auto','off','hard']
 await p.locator('[data-player-order-action="down"][data-player-index="0"]').click()
 assert [await p.locator(f'#player{i}Skill').input_value() for i in [1,2,3]]==['off','auto','hard']


async def cutthroat_leader(p,base):
 await p.goto(base+'/dev/');await p.select_option('#gameType','cutthroat');await p.select_option('#numPlayers','3');await p.select_option('#player1Skill','expert');await p.click('#startGameBtn')
 await p.evaluate("""async()=>{
  const {game}=await import('./js/state.js');Math.random=()=>0;
  game.players.forEach((p,i)=>p.score=[100,50,150][i]);
  for(const t of ['20','19'])Object.assign(game.players[0].cricketData[t],{marks:3,closed:true});
  Object.assign(game.players[1].cricketData['20'],{marks:3,closed:true});
 }""")
 await p.wait_for_timeout(1500);s=await state(p)
 assert [x['score'] for x in s['players']]==[100,107,207]
 assert all(s['players'][0]['cricketData'][t]['closed'] for t in ['18','17'])
 assert s['currentPlayer']==1

async def team_average_undo(p,base):
 from botblake_ui_test import add
 await p.goto(base+'/dev/');await p.select_option('#gameType','501');await p.check('#teamMode');await p.click('#startGameBtn')
 for zone in [0,1]:
  await add(p,f'Human{zone}',zone);await add(p,'',zone,'auto')
 await p.click('#teamStartMatchBtn');await score(p,60)
 s=await state(p);assert s['teams'][0]['members'][0]['practice']=={'turns':1,'points':60,'marks':0}
 await p.click('#undoBtnX01');assert not (await state(p))['teams'][0]['members'][0].get('practice')
 await p.wait_for_timeout(550);await p.click('#redoBtnX01')
 assert (await state(p))['teams'][0]['members'][0]['practice']['points']==60
 await score(p,0)
 value=await p.evaluate("""async()=>{const {game}=await import('./js/state.js');const {activeBot,strength}=await import('./js/botblake-engine.js');return strength(game,activeBot(game));}""")
 assert abs(value-(30-4.5)/133.5)<.00001
 await p.click('#menuBtn');saved=(await state(p))['teams'];await p.reload();await p.click('#resumeGameBtn');await p.wait_for_timeout(1500)
 assert (await state(p))['teams']==saved
 assert await p.locator('#botStatus button').is_visible()


async def keyboard_navigation(p,base):
 await start(p,base,skill='expert');await score(p);await p.wait_for_timeout(1500)
 await p.click('#undoBtnX01')
 quick=p.locator('[data-quick="26"]');await quick.focus();await quick.press('Tab')
 assert not await quick.evaluate('(el)=>document.activeElement===el'), 'Bot turn trapped Tab focus in scoring controls'
 before=await state(p);await quick.focus();await quick.press('Enter')
 assert (await state(p))['players']==before['players'], 'Keyboard activation scored for the bot'

async def main():
 srv=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)));threading.Thread(target=srv.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{srv.server_port}'
 failures=[]
 try:
  async with async_playwright() as pw:
   b=await pw.chromium.launch(executable_path='/usr/bin/chromium')
   for test in [settings_pause,builder_keyboard,mode_coverage,config_and_first,cutthroat_leader,team_average_undo,keyboard_navigation]:
    import sys
    if len(sys.argv)>1 and test.__name__ not in sys.argv[1:]:continue
    ctx=await b.new_context(service_workers='block');await ctx.route('**/*',lambda r:r.continue_() if r.request.url.startswith(base) else r.abort());p=await ctx.new_page();p.on('dialog',lambda d:d.accept())
    try:await test(p,base);print('PASS',test.__name__,flush=True)
    except Exception as e:failures.append(test.__name__);print('FAIL',test.__name__,str(e),flush=True)
    await ctx.close()
   await b.close()
 finally:srv.shutdown()
 assert not failures,failures
if __name__=='__main__':asyncio.run(main())
