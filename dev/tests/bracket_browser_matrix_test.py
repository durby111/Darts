"""32 browser/UI paths: no seeded events, direct engine calls or score-state mutation.
Manual result form drives progression; scorer launch is checked once per path.
Full keypad/scorer coverage remains in local_tournament_flow_test.py.
"""
import asyncio,functools,json,os,threading,traceback
from pathlib import Path
from http.server import ThreadingHTTPServer
from playwright.async_api import async_playwright
import local_tournament_flow_test as f
OUT=Path(os.environ['DARTS_EVIDENCE'])
async def ready(page):
 await page.wait_for_function("!document.querySelector('#localBoot') && document.querySelector('#message') && !document.querySelector('#refresh').disabled && !document.querySelector('#message').textContent.includes('Loading')")

async def record(page,m,side):
 await page.locator(f'.match-card[data-code="{m["code"]}"] .match-action').click()
 await page.select_option('#winner',m['teamA' if side==0 else 'teamB'])
 await page.fill('#scoreA',str(1-side));await page.fill('#scoreB',str(side))
 await page.locator('#resultForm button[type=submit]').click();await f.approve(page);await ready(page)
async def path(browser,base,count,reset):
 tag=f'{count}-teams-'+('reset' if reset else 'upper');folder=OUT/tag;folder.mkdir(parents=True,exist_ok=True)
 context=await browser.new_context(viewport={'width':1440,'height':1100},service_workers='block')
 external=[];errors=[]
 async def route(r):
  if r.request.url.startswith(base+'/'):await r.continue_()
  else:external.append(r.request.url.split('?')[0]);await r.abort()
 await context.route('**/*',route)
 page=await context.new_page();page.set_default_timeout(12000)
 page.on('pageerror',lambda e:errors.append(str(e)))
 try:
  await page.goto(base+'/dev/local/brackets/');await ready(page)
  await page.locator('#createPanel summary').click();await page.fill('#title','TEST Browser '+tag)
  await page.select_option('#gameType','301');await page.fill('#bestOf','1');await page.locator('#createForm button[type=submit]').click();await ready(page)
  for i in range(count*2):
   await page.fill('#guestName',f'TEST {i+1}');await page.locator('#addForm button').click()
  await page.check('[data-bulk-field=checkedIn]');await page.check('[data-bulk-field=paid]')
  await page.click('#drawPartners');await f.approve(page);await page.click('#saveRoster');await ready(page)
  t=await f.event(page);assert len(t['teams'])==count
  await page.reload();await ready(page);assert (await f.event(page))==t
  await page.click('#startTournament');await f.approve(page);await ready(page)
  t=await f.event(page);assert t['status']=='live';url=page.url
  byes=sum(m['status']=='bye' and m['bracket']=='winners' for m in t['matches']);assert byes==2**((count-1).bit_length())-count
  m=next(m for m in t['matches'] if m['status']=='ready')
  await page.locator(f'.match-card[data-code="{m["code"]}"] .match-action').click();await page.click('#launchScorer')
  await page.wait_for_function("document.querySelector('#gameScreen').style.display==='flex'")
  await page.goto(url);await ready(page)
  assert await page.locator('.match-card.in-progress').count()==1
  assert 'In progress · device' in await page.locator('.match-card.in-progress').inner_text()
  assert await page.locator('.match-card.ready:not(.in-progress)').count()>0
  feed=page.locator('.match-card.pending .source-jump').first;label=await feed.inner_text();code=label.split(' of ')[1]
  await feed.click();assert await page.locator('.match-card:focus').get_attribute('data-code')==code
  await page.click('#diagramFit');await page.screenshot(path=str(folder/'start.png'),full_page=True)
  played=0;corrections=0;feederChecks=0
  while (await f.event(page))['status']!='complete':
   t=await f.event(page)
   for waiting in t['matches']:
    if waiting['bracket']!='losers' or waiting['status']!='pending':continue
    for side in ['A','B']:
     src=waiting.get('source'+side)
     if not waiting.get('team'+side) and src and src.get('matchCode'):
      text=await page.locator(f'.match-card[data-code="{waiting["code"]}"]').inner_text()
      assert 'Await '+src['outcome']+' of '+src['matchCode'] in text;feederChecks+=1
   m=next(m for m in t['matches'] if m['status']=='ready')
   side=(1 if reset else 0) if m['code']=='GF1' else played%2
   await record(page,m,side);played+=1
   if played==1:
    await record(page,m,1-side);side=1-side;corrections+=1
    await page.reload();await ready(page)
   saved=await f.event(page);done=next(x for x in saved['matches'] if x['id']==m['id'])
   assert done['winnerId']==m['teamA' if side==0 else 'teamB']
   card=page.locator(f'.match-card[data-code="{m["code"]}"]')
   assert '✓ Won' in await card.locator('.won').inner_text();assert '✕ Lost' in await card.locator('.lost').inner_text()
   assert await card.locator('.won').evaluate("e=>getComputedStyle(e).backgroundColor")=='rgb(23, 77, 50)'
   assert await card.locator('.lost').evaluate("e=>getComputedStyle(e).backgroundColor")=='rgb(101, 35, 43)'
   for target in saved['matches']:
    for slot in ['A','B']:
     source=target.get('source'+slot)
     if source and source.get('matchCode')==m['code'] and target['status']!='void':
      expected=done['winnerId'] if source['outcome']=='winner' else m['teamB' if side==0 else 'teamA']
      assert target['team'+slot]==expected
   if played>count*2:raise AssertionError('Too many matches')
  final=await f.event(page);assert played==count*2-2+int(reset)
  assert next(m for m in final['matches'] if m['code']=='GF2')['status']==('complete' if reset else 'void')
  losses={x['id']:0 for x in final['teams']}
  for m in final['matches']:
   if m['status']=='complete':losses[m['teamB'] if m['winnerId']==m['teamA'] else m['teamA']]+=1
  champion=next(m for m in final['matches'] if m['code']==('GF2' if reset else 'GF1'))['winnerId']
  assert all(n==2 for team,n in losses.items() if team!=champion)
  await page.close();page=await context.new_page();await page.goto(url);await ready(page)
  assert await f.event(page)==final;assert await page.locator('#champion').is_visible()
  await page.screenshot(path=str(folder/'champion.png'),full_page=True)
  assert not external,external;assert not errors,errors
  report={'teams':count,'reset':reset,'manualResults':played,'corrections':corrections,'winnerByes':byes,'waitingFeederAssertions':feederChecks,'scorerLaunchAndPlayingStatus':True,'styleAssertions':True,'closeReopen':True,'externalRequests':external,'errors':errors}
  (folder/'result.json').write_text(json.dumps(report,indent=2));print('PASS',tag,json.dumps(report),flush=True)
  return report
 except Exception as error:
  traceback.print_exc()
  print("FAIL",tag,str(error),"PAGE_ERRORS",errors,"EXTERNAL",external,flush=True)
  await page.screenshot(path=str(folder/'failure.png'),full_page=True)
  raise
 finally:await context.close()
async def main():
 OUT.mkdir(parents=True,exist_ok=True)
 server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(f.Quiet,directory=str(f.ROOT)));threading.Thread(target=server.serve_forever,daemon=True).start()
 try:
  async with async_playwright() as p:
   browser=await p.chromium.launch(executable_path=os.environ.get('BLAKEOUT_QA_CHROME','/usr/bin/google-chrome'),args=['--no-sandbox'])
   sem=asyncio.Semaphore(4)
   async def bounded(n,reset):
    async with sem:return await path(browser,f'http://127.0.0.1:{server.server_port}',n,reset)
   results=await asyncio.gather(*(bounded(n,r) for n in map(int,os.environ.get("BLAKEOUT_MATRIX_SIZES",",".join(map(str,range(5,21)))).split(",")) for r in [False,True]),return_exceptions=True)
   summary={'passed':[r for r in results if isinstance(r,dict)],'failed':[str(r) for r in results if isinstance(r,BaseException)],'scope':'Browser manual-result paths plus scorer launch; not keypad play for every match'}
   (OUT/'summary.json').write_text(json.dumps(summary,indent=2));await browser.close()
   assert not summary['failed'],summary['failed']
 finally:server.shutdown()
if __name__=='__main__':asyncio.run(main())
