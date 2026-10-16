#!/usr/bin/env python3
"""Rendered Minnesota option/scoring checks on production and DEV source.
Targeted win-edge fixtures set up near-finished boards explicitly. Full local
bracket flow uses real inputs throughout, no engine-driven match winners.
External network is blocked; this does not test Firebase or physical hardware.
"""
import asyncio,functools,threading,json,os
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from playwright.async_api import async_playwright
from local_tournament_games_test import cricket_leg
ROOT=Path(__file__).resolve().parents[2]
OUT=Path('/workspace/scratch/minnesota-cutthroat-20261016')
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
async def state(page):return await page.evaluate("async()=>JSON.parse(JSON.stringify((await import('./js/state.js')).game))")
async def hit(page,target,mult=1):await page.locator(f'[data-target="{target}"][data-multiplier="{mult}"]').click()
async def enter(page):await page.click('#enterBtn')
async def miss(page):await page.click('#missBtn')
async def cycle(page):
 while (await state(page))['currentPlayer']!=0:await miss(page)
async def special(page,target,value):
 await hit(page,target)
 for d in str(value):await page.click(f'[data-keypad="{d}"]')
 await page.click('[data-keypad="OK"]')
async def setup(page,base,build='dev/',players=4,cut=True,teams=False):
 await page.goto(base+'/'+build)
 await page.select_option('#gameType','minnesota')
 await page.uncheck('#minnesotaCutthroat')
 await page.select_option('#numPlayers','1')
 if cut:
  await page.check('#minnesotaCutthroat')
  assert await page.input_value('#numPlayers')=='2'
  assert await page.locator('#cricketPoints').is_disabled()
 else:await page.uncheck('#minnesotaCutthroat')
 await page.select_option('#numPlayers',str(players))
 if teams:await page.check('#teamMode')
 await page.click('#startGameBtn')
 if teams:
  for index,name in enumerate(['A','B','C','D']):
   await page.fill('#teamAddName',name);await page.click('#teamAddBtn')
   await page.locator('#teamTray .team-chip').filter(has_text=name).click()
   await page.click('#teamZone'+str(index//2)+'Label')
  await page.click('#teamStartMatchBtn')
 await page.wait_for_selector('#cricketMain',state='visible')
 assert (await state(page))['minnesotaCutthroat']==cut
async def preview(page,expected):
 ids=['homeScore','awayScore','player3Score','player4Score']
 values=[int(await page.locator('#'+i).inner_text()) for i in ids[:len(expected)]]
 assert values==expected,(values,expected)
async def penalties(page,base,build,players):
 await setup(page,base,build,players)
 # P0 and P1 close 20; only P2/P3 remain vulnerable.
 await hit(page,'20',3);await enter(page)
 await hit(page,'20',3);await enter(page);await cycle(page)
 await hit(page,'20',3)
 expected=[0,0]+[60]*(players-2);await preview(page,expected)
 assert '+120' in await page.locator('#scoreDiffIndicator').inner_text() if players==4 else '+60' in await page.locator('#scoreDiffIndicator').inner_text()
 await enter(page);assert [p['score'] for p in (await state(page))['players']]==expected
 await page.click('#undoBtn');await page.wait_for_timeout(510)
 assert [p['score'] for p in (await state(page))['players']]==[0]*players
 await page.click('#redoBtn');await page.wait_for_timeout(510)
 assert [p['score'] for p in (await state(page))['players']]==expected
 await page.reload();await page.click('#resumeGameBtn');await cycle(page)
 assert (await state(page))['minnesotaCutthroat']
 for target,value in [('Triples',60),('Doubles',40),('Bed',90)]:
  for _ in range(3 if target=='Bed' else 1):
   for _ in range(1 if target=='Bed' else 3):await hit(page,target)
   await enter(page)
   for _ in range(1 if target=='Bed' else 3):await hit(page,target)
   await enter(page);await cycle(page)
  await special(page,target,value)
  expected=[0,0]+[v+value for v in expected[2:]];await preview(page,expected)
  # Pending special scores and mode survive resume before ENTER.
  await page.reload();await page.click('#resumeGameBtn');await preview(page,expected)
  await enter(page);assert [p['score'] for p in (await state(page))['players']]==expected
  await cycle(page)
 await page.screenshot(path=str(OUT/f'{build or "prod"}-{players}-penalties.png').replace('dev/-','dev-'),full_page=True)
 print(f'PASS {build or "production"} {players} players: number + Triples/Doubles/Bed penalties, closed immunity, pending/reload, undo/redo',flush=True)
async def wins(page,base,build):
 for scores,cut,expected in [([0,0],True,True),([0,60],True,True),([60,0],True,False),([60,0],False,True)]:
  await setup(page,base,build,2,cut)
  await page.evaluate("""async scores=>{
   const {game}=await import('./js/state.js');
   game.players.forEach((p,i)=>p.score=scores[i]);
   for(const t of game.cricketTargets)Object.assign(game.players[0].cricketData[t],{marks:3,closed:true});
   Object.assign(game.players[0].cricketData.Bull,{marks:2,closed:false});
   (await import('./js/cricket.js')).updateCricketDisplay();
  }""",scores)
  await hit(page,'Bull');await enter(page)
  assert await page.locator('#winnerModal').is_visible()==expected,(scores,cut)
  if expected:
   await page.reload();await page.click('#resumeGameBtn')
   await page.click('#menuBtn');await page.click('#gameMenuNewGameBtn')
   assert (await state(page))['minnesotaCutthroat']==cut
   assert all(p['score']==0 for p in (await state(page))['players'])
 print(f'PASS {build or "production"}: tied/lowest win, higher-score rejection, normal highest-score win and reload/play again',flush=True)
async def presets(page,base,build):
 await page.goto(base+'/'+build);await page.select_option('#gameType','minnesota');await page.check('#minnesotaCutthroat')
 await page.select_option('#numPlayers','3');await page.click('#startGameBtn')
 await page.reload()
 assert await page.is_checked('#minnesotaCutthroat') and await page.input_value('#numPlayers')=='3'
 await page.select_option('#gameType','cricket')
 assert await page.locator('#minnesotaCutthroatOption').is_hidden() and not await page.locator('#cricketPoints').is_disabled()
 # Old preset lacking the option must default to normal, never inherit stale Cutthroat.
 await page.evaluate("async()=> (await import('./js/state.js')).applyConfig({gameType:'minnesota',numPlayers:'1',cricketPoints:false})")
 assert not await page.is_checked('#minnesotaCutthroat') and await page.input_value('#numPlayers')=='1'
 assert not await page.is_checked('#cricketPoints')
 await page.click('#startGameBtn');assert not (await state(page))['minnesotaCutthroat']
 print(f'PASS {build or "production"}: saved setup, switching games, old preset and normal solo/no-points preserved',flush=True)
async def teams(page,base,build):
 await setup(page,base,build,2,True,True)
 await hit(page,'20',3);await enter(page);await cycle(page)
 assert (await state(page))['teams'][0]['rotationIndex']==1,(await state(page))['teams']
 await hit(page,'20',3);await preview(page,[0,60]);await enter(page)
 await page.reload();await page.click('#resumeGameBtn')
 s=await state(page);assert s['minnesotaCutthroat'] and s['teamMode'] and [p['score'] for p in s['players']]==[0,60]
 print(f'PASS {build or "production"}: two-person teams, partner rotation, penalty preview/save/reload',flush=True)
async def local(page,base):
 from local_tournament_flow_test import ready,approve,event,saved
 await page.goto(base+'/dev/local/brackets/');await ready(page)
 await page.locator('#createPanel summary').click();await page.fill('#title','Minnesota Cutthroat acceptance')
 await page.select_option('#gameType','minnesota');await page.check('#createMinnesotaCutthroat');await page.fill('#bestOf','1')
 await page.locator('#createForm button[type=submit]').click();await ready(page)
 for name in ['One','Two','Three','Four']:
  await page.fill('#guestName',name);await page.locator('#addForm button').click()
 await page.check('[data-bulk-field=checkedIn]');await page.check('[data-bulk-field=paid]');await page.click('#drawPartners');await approve(page)
 await page.click('#saveRoster');await ready(page);await page.click('#startTournament');await approve(page);await ready(page)
 assert (await event(page))['minnesotaCutthroat']
 for scope,key,cut in [('brackets','winners',False),('rounds','winners:1',True),('matches','W1.1',False),('matches','W1.1',True),('matches','GF1',False)]:
  await page.select_option('#formatScope',scope);await page.select_option('#formatTarget',key);await page.select_option('#formatGame','minnesota')
  await page.locator('#formatMinnesotaCutthroat').set_checked(cut);await page.fill('#formatBestOf','1');await page.click('#saveFormat');await ready(page)
  assert 'Game selection saved' in await page.locator('#message').inner_text()
 await page.reload();await ready(page)
 for code,cut in [('W1.1',True),('GF1',False)]:
  await page.locator(f'[data-code="{code}"] .match-action').click();await page.click('#launchScorer')
  await page.wait_for_selector('#cricketMain',state='visible');assert (await state(page))['minnesotaCutthroat']==cut
  await page.reload();await page.wait_for_selector('#cricketMain',state='visible');assert (await state(page))['minnesotaCutthroat']==cut
  # Full actual UI play; close and score 20 to exercise mode before closing remaining rows.
  await hit(page,'20',3);await page.click('#tournamentMissDart');await page.click('#tournamentMissDart');await enter(page);await miss(page)
  await hit(page,'20',3);await page.click('#tournamentMissDart');await page.click('#tournamentMissDart');await enter(page)
  assert [p['score'] for p in (await state(page))['players']]==([0,60] if cut else [60,0])
  await cricket_leg(page,0)
  await page.click('#tournamentSaveResult');await page.wait_for_function("document.querySelector('#tournamentResultPanel').textContent.includes('Result saved')")
  await page.wait_for_timeout(460);await page.click('#tournamentResultReturn');await ready(page)
  receipt=next(r['result'] for r in (await saved(page))['results'].values() if r['result']['matchId']==code)
  assert bool(receipt.get('minnesotaCutthroat'))==cut
  assert bool(receipt['records']['legs'][0].get('minnesotaCutthroat'))==cut
 assert (await event(page))['status']=='complete'
 await page.screenshot(path=str(OUT/'local-tournament-champion.png'),full_page=True)
 print('PASS local tournament: default/bracket/round/match options persist; Cutthroat + normal real scorer matches, dart ledgers, reload/return and champion',flush=True)
async def main():
 OUT.mkdir(parents=True,exist_ok=True)
 server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)));threading.Thread(target=server.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{server.server_port}'
 try:
  async with async_playwright() as p:
   b=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
   for build in os.environ.get('MN_BUILDS','dev/,').split(','):
    context=await b.new_context(viewport={'width':1200,'height':1000},service_workers='block')
    await context.route('**/*',lambda r:r.continue_() if r.request.url.startswith(base) else r.abort())
    await context.tracing.start(screenshots=True,snapshots=True,sources=True)
    page=await context.new_page();page.on('dialog',lambda d:d.accept());errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    try:
     for count in [3,4]:await penalties(page,base,build,count)
     await wins(page,base,build);await presets(page,base,build);await teams(page,base,build)
     if build=='dev/':await local(page,base)
     assert not errors,errors
    except Exception:
     await page.screenshot(path=str(OUT/f'{build or "prod"}-failure.png').replace('dev/-','dev-'),full_page=True)
     print('FAIL',page.url,(await page.locator('body').inner_text())[-2000:],flush=True);raise
    finally:
     await context.tracing.stop(path=str(OUT/f'{"dev" if build else "prod"}-trace.zip'));await context.close()
   await b.close()
 finally:server.shutdown()
if __name__=='__main__':asyncio.run(main())
