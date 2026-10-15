#!/usr/bin/env python3
"""All six supported local tournament formats played using rendered scorer controls."""
import asyncio, functools, threading, json
from http.server import ThreadingHTTPServer
from playwright.async_api import async_playwright
from local_tournament_flow_test import ROOT,OUT,Quiet,ready,approve,event,state,play_leg,saved
async def cricket_leg(page,winner):
 while True:
  g=await state(page)
  if g['tournament']['legComplete']:return
  if g['currentPlayer']!=winner:
   await page.click('#missBtn');continue
  while True:
   g=await state(page);pending=g['pendingDarts'];used=sum(3 if d['target']=='Bed' else 1 for d in pending)
   if used>=3:break
   target=None;needed=0
   for t in g['cricketTargets']:
    data=g['players'][winner]['cricketData'][t]
    marks=data['marks']+sum(d['multiplier'] for d in pending if d['target']==t)
    if marks<data['maxMarks']:target=t;needed=data['maxMarks']-marks;break
   if target is None:break
   if target=='Bed' and used: # Bed must occupy an entire visit.
    await page.click('#tournamentMissDart');continue
   mult=1 if target in ['Bed','Triples','Doubles'] else min(2 if target=='Bull' else 3,needed)
   await page.locator(f'[data-target="{target}"][data-multiplier="{mult}"]').click()
  await page.click('#enterBtn')
async def run(browser,base,kind,offline=False):
 label=kind+('-offline' if offline else '')
 context=await browser.new_context(viewport={'width':1200,'height':1000},service_workers='allow' if offline else 'block')
 await context.tracing.start(screenshots=True,snapshots=True,sources=True)
 page=await context.new_page();page.on('dialog',lambda d:d.accept());errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 try:
  await page.goto(base+'/dev/local/brackets/');await ready(page)
  await page.locator('#createPanel summary').click();await page.fill('#title',kind+' UI game')
  await page.select_option('#gameType',kind)
  if kind!='chicago':await page.fill('#bestOf','1')
  await page.locator('#createForm button[type=submit]').click();await ready(page)
  for name in ['Alex','Alex','Sam','Jo']:
   await page.fill('#guestName',name);await page.locator('#addForm button').click()
  await page.check('[data-bulk-field=checkedIn]');await page.check('[data-bulk-field=paid]')
  await page.click('#drawPartners');await approve(page);await page.click('#saveRoster');await ready(page)
  await page.click('#startTournament');await approve(page);await ready(page)
  if offline:
   await page.evaluate('navigator.serviceWorker.ready')
   await page.wait_for_function('!!navigator.serviceWorker.controller')
   await context.set_offline(True)
   await page.reload();await ready(page)
  await page.locator('.match-action').first.click();await page.click('#launchScorer')
  await page.wait_for_function("document.querySelector('#gameScreen').style.display==='flex'")
  if kind=='chicago':
   await page.click('#chicago301Btn');await play_leg(page,0)
   await page.click('#chicagoContinueBtn');await page.click('#chicagoCricketBtn');await cricket_leg(page,1)
   await page.click('#chicagoContinueBtn');await page.click('#chicago501Btn');await play_leg(page,0)
   assert [l['gameType'] for l in (await state(page))['scoringRecords']['legs']]==['301','cricket','501']
  elif kind in ['301','501']:await play_leg(page,0)
  else:await cricket_leg(page,0)
  before=await state(page)
  assert before['scoringRecords']['legs'] and all(l['turns'] for l in before['scoringRecords']['legs'])
  await page.screenshot(path=str(OUT/f'game-{label}-winner.png'),full_page=True)
  await page.click('#tournamentSaveResult');await page.wait_for_function("document.querySelector('#tournamentResultPanel').textContent.includes('Result saved')")
  await page.wait_for_timeout(460);await page.click('#tournamentResultReturn');await ready(page)
  if offline:
   await page.reload();await ready(page)
  t=await event(page);assert sum(m['status']=='complete' for m in t['matches'])==1
  receipts=list((await saved(page))['results'].values());assert len(receipts)==1
  assert receipts[0]['result']['records']==before['scoringRecords']
  assert not errors,errors
  print(f'PASS {kind} offline={offline}: duplicate-name roster → draw/start → every dart through real controls → save exact ledger → bracket advances',flush=True)
 except Exception:
  await page.screenshot(path=str(OUT/f'game-{label}-failure.png'),full_page=True)
  print('FAILED',kind,page.url,(await page.locator('body').inner_text())[-2500:],flush=True);raise
 finally:
  await context.tracing.stop(path=str(OUT/f'game-{label}-trace.zip'));await context.close()
async def main():
 OUT.mkdir(parents=True,exist_ok=True)
 server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)));threading.Thread(target=server.serve_forever,daemon=True).start()
 try:
  async with async_playwright() as p:
   b=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
   for kind in ['301','501','cricket','spanish','minnesota','chicago']:await run(b,f'http://127.0.0.1:{server.server_port}',kind)
   await run(b,f'http://127.0.0.1:{server.server_port}','301',offline=True)
   await b.close()
 finally:server.shutdown()
if __name__=='__main__':asyncio.run(main())
