#!/usr/bin/env python3
"""Rendered acceptance: UI roster/draw/format/start and real scorer clicks to champion.
No Firebase/OAuth mocks or direct winner/score mutation. Local adapter is product code.
Read-only state inspection supplements visible UI assertions. External requests blocked.
"""
import asyncio, json, os, threading, functools
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.async_api import async_playwright
ROOT = Path(__file__).resolve().parents[2]
OUT = Path(os.environ.get('DARTS_EVIDENCE', '/workspace/scratch/darts-local-tournaments-20261015'))
KEY = 'blakeout_dev_local_tournaments_v1'
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*args): pass
async def saved(page):
 return await page.evaluate('(key)=>JSON.parse(localStorage.getItem(key))',KEY)
async def event(page):
 return next(iter((await saved(page))['events'].values()))
async def state(page):
 return await page.evaluate("async()=>JSON.parse(JSON.stringify((await import('/dev/js/state.js')).game))")
async def ready(page):
 await page.wait_for_function("document.querySelector('#message') && !document.querySelector('#refresh').disabled")
async def approve(page):
 await page.click('.platform-confirm-accept')
async def format_ui(page,scope,key,kind,best=1):
 await page.select_option('#formatScope',scope);await page.select_option('#formatTarget',key)
 await page.select_option('#formatGame',kind)
 if kind!='chicago':await page.fill('#formatBestOf',str(best))
 await page.click('#saveFormat');await ready(page)
 assert 'Game selection saved' in await page.locator('#message').inner_text(),await page.locator('#message').inner_text()
async def points(page,n,darts=3):
 await page.select_option('#tournamentActualDarts',str(darts))
 for digit in str(n):await page.click(f'[data-digit="{digit}"]')
 await page.click('#x01EnterBtn')
 await page.wait_for_timeout(710) # scorer deliberately rejects repeated turn commits for 700ms
async def play_leg(page,winner):
 while True:
  game=await state(page)
  if game['tournament']['legComplete']:return
  current=game['currentPlayer'];remaining=game['players'][current]['score']
  await points(page,min(180,remaining) if current==winner else 0)
async def play_match(page,winner,interrupt=False):
 await page.wait_for_function("document.querySelector('#gameScreen').style.display==='flex'")
 if interrupt:
  await points(page,60)
  before=await state(page)
  await page.reload()
  await page.wait_for_function("document.querySelector('#gameScreen').style.display==='flex'")
  after=await state(page)
  assert after['players']==before['players'] and after['scoringRecords']==before['scoringRecords']
  url=page.url;context=page.context;await page.close();page=await context.new_page()
  page.on('dialog',lambda d:d.accept())
  await page.goto(url);await page.wait_for_function("document.querySelector('#gameScreen').style.display==='flex'")
  assert (await state(page))['scoringRecords']==before['scoringRecords']
  print('PASS scorer mid-match reload and close/reopen retain exact turns',flush=True)
 while True:
  await play_leg(page,winner)
  g=await state(page)
  if max(g['tournament']['legWins'])>=g['tournament']['bestOf']//2+1:break
  await page.click('#tournamentNextLeg')
 await page.wait_for_selector('#tournamentSaveResult')
 if interrupt:
  # Undo winning turn in the rendered scorer, then re-enter it through the keypad.
  await page.click('#winnerCancelBtn');await page.wait_for_timeout(710)
  assert not (await state(page))['tournament']['legComplete']
  await play_leg(page,winner)
 if interrupt:
  # Fault at the storage boundary: receipt commits but its acknowledgment is lost.
  # No score/result state is manufactured; the scorer must recover its own ledger.
  await page.evaluate('''() => {
   const original=Storage.prototype.setItem;
   Storage.prototype.setItem=function(key,value){
    original.call(this,key,value);
    if(key==='blakeout_dev_local_tournaments_v1') {
     Storage.prototype.setItem=original;throw Error('Simulated acknowledgment lost after commit');
    }
   };
  }''')
  await page.click('#tournamentSaveResult')
  await page.wait_for_function("document.querySelector('#tournamentResultPanel').textContent.includes('Not saved')")
  result_id=(await state(page))['tournament']['resultId']
  await page.reload()
  await page.wait_for_selector('#tournamentSaveResult',state='visible')
  assert (await state(page))['tournament']['resultId']==result_id
 await page.locator('#tournamentSaveResult').dblclick(delay=40)
 await page.wait_for_function("document.querySelector('#tournamentResultPanel').textContent.includes('Result saved')")
 await page.wait_for_timeout(460)
 await page.click('#tournamentResultReturn')
 await page.wait_for_url('**/local/brackets/?id=*');await ready(page)
 return page
async def run(browser,base,people,reset):
 context=await browser.new_context(viewport={'width':1400,'height':1050},service_workers='block')
 await context.tracing.start(screenshots=True,snapshots=True,sources=True)
 external=[];errors=[]
 async def route(r):
  if r.request.url.startswith(base):await r.continue_()
  else:external.append(r.request.url);await r.abort()
 await context.route('**/*',route)
 context.on('page',lambda page:page.on('pageerror',lambda err:errors.append(str(err))))
 page=await context.new_page();page.on('dialog',lambda d:d.accept())
 try:
  await page.goto(base+'/dev/local/brackets/');await ready(page)
  # Sentinels only; never seed tournament state or mutate score/winner state.
  sentinels={'blakeout_active_game':'production-preserved','blakeout_dev_active_game':'existing-dev-preserved','blakeout_roster_id':'0123456789abcdef0123456789abcdef','blakeout_usage_month':'unchanged'}
  await page.evaluate('(values)=>Object.entries(values).forEach(([k,v])=>localStorage.setItem(k,v))',sentinels)
  await page.locator('#createPanel summary').click();await page.fill('#title',f'TEST Acceptance {people} people')
  await page.select_option('#gameType','301');await page.fill('#bestOf','1')
  await page.locator('#createForm button[type=submit]').click();await ready(page)
  for i in range(people):
   await page.fill('#guestName',f'TEST Player {i+1}');await page.locator('#addForm button').click()
  await page.check('[data-bulk-field=checkedIn]');await page.check('[data-bulk-field=paid]')
  await page.click('#drawPartners');await page.click('.platform-confirm-cancel')
  assert await page.locator('#rosterRows input[data-field=tag]').evaluate_all('(xs)=>xs.every(x=>!x.value)')
  await page.locator('#drawPartners').dblclick(delay=40);await approve(page)
  await page.click('#saveRoster');await ready(page)
  drawn=await event(page)
  assert len(drawn['teams'])==people//2 and all(len(t['memberIds'])==2 for t in drawn['teams'])
  assert len(set(m for t in drawn['teams'] for m in t['memberIds']))==people
  await page.reload();await ready(page);assert (await event(page))['teams']==drawn['teams']
  await page.click('#startTournament');await page.click('.platform-confirm-cancel')
  assert (await event(page))['status']=='registration'
  await page.locator('#startTournament').dblclick(delay=40);await approve(page);await ready(page)
  t=await event(page);assert t['status']=='live'
  initial_byes=sum(m['status']=='bye' and m['bracket']=='winners' for m in t['matches'])
  assert initial_byes==(2**((people//2-1).bit_length())-people//2)
  await format_ui(page,'brackets','losers','501')
  await format_ui(page,'rounds','losers:1','301')
  first=next(m for m in t['matches'] if m['status']=='ready')
  await format_ui(page,'matches',first['id'],'501',3 if people==12 else 1)
  await format_ui(page,'brackets','reset','501')
  await page.screenshot(path=str(OUT/f'{people}-people-start.png'),full_page=True)
  print(f'PASS {people} entered names → blind draw {people//2} pairs → saved/reloaded → start; {initial_byes} winners byes; bracket/round/match formats saved',flush=True)
  played=0;ledger_before=None
  while (await event(page))['status']!='complete':
   t=await event(page);m=next(m for m in t['matches'] if m['status']=='ready')
   winner=1 if m['code']=='GF1' and reset else 0 if m['code']=='GF1' else played%2
   expected=t.get('formats',{}).get('matches',{}).get(m['id']) or t.get('formats',{}).get('rounds',{}).get(f"{m['bracket']}:{m['round']}") or t.get('formats',{}).get('brackets',{}).get(m['bracket']) or {'gameType':t['gameType'],'bestOf':t['bestOf']}
   await page.locator(f'.match-card[data-code="{m["code"]}"] .match-action').click()
   assert expected['gameType'] in await page.locator('#resultHeading').inner_text()
   await page.click('#launchScorer');await page.wait_for_url('**/?localTournament=1&tournamentMatch=1')
   await page.wait_for_function("document.querySelector('#gameScreen').style.display==='flex'")
   assert (await state(page))['tournament']['gameType']==expected['gameType']
   page=await play_match(page,winner,interrupt=played==0)
   played+=1;store=await saved(page)
   assert len(store['results'])==played, 'Repeated save must not duplicate the receipt'
   recorded=next(x for x in (await event(page))['matches'] if x['id']==m['id'])
   assert recorded['status']=='complete' and recorded['winnerId']==m['teamA' if winner==0 else 'teamB']
   if played==1:
    ledger_before=json.dumps(store['results'],sort_keys=True)
    # Correct the actual scorer result using the permitted bracket correction flow.
    await page.locator(f'.match-card[data-code="{m["code"]}"] .match-action').click()
    other=m['teamB' if winner==0 else 'teamA'];threshold=expected['bestOf']//2+1
    await page.select_option('#winner',other)
    await page.fill('#scoreA',str(threshold if other==m['teamA'] else 0));await page.fill('#scoreB',str(threshold if other==m['teamB'] else 0))
    await page.locator('#resultForm button[type=submit]').click();await approve(page);await ready(page)
    store=await saved(page);assert len(store['corrections'])==1 and json.dumps(store['results'],sort_keys=True)==ledger_before
    assert next(x for x in (await event(page))['matches'] if x['id']==m['id'])['winnerId']==other
    await page.reload();await ready(page)
    print(f'PASS {people}: scorer result correction advances corrected winner; original dart ledger preserved; reload retained',flush=True)
   print(f'PASS {people}: scorer match {m["code"]} ({expected["gameType"]}, best {expected["bestOf"]}) saved and returned [{played}]',flush=True)
  final=await event(page);assert played==people-2+int(reset)
  assert next(m for m in final['matches'] if m['code']=='GF2')['status']==('complete' if reset else 'void')
  losses={t['id']:0 for t in final['teams']}
  for m in final['matches']:
   if m['status']=='complete':losses[m['teamB'] if m['winnerId']==m['teamA'] else m['teamA']]+=1
  champion=(next(m for m in final['matches'] if m['code']==('GF2' if reset else 'GF1')))['winnerId']
  assert all(v==2 for k,v in losses.items() if k!=champion) and losses[champion]<=1
  await page.reload();await ready(page);assert (await event(page))==final
  assert await page.locator('#champion').is_visible()
  await page.screenshot(path=str(OUT/f'{people}-people-champion.png'),full_page=True)
  for k,v in sentinels.items():assert await page.evaluate('(k)=>localStorage.getItem(k)',k)==v,k
  assert not external,external
  assert not errors,errors
  (OUT/f'{people}-people-final.json').write_text(json.dumps(await saved(page),indent=2))
  print(f'PASS {people}: champion, {played} scorer matches, reset={reset}, reload, two-loss elimination, original data and no external requests',flush=True)
 except Exception:
  page=context.pages[-1] if page.is_closed() else page
  await page.screenshot(path=str(OUT/f'{people}-people-failure.png'),full_page=True)
  print('FAIL URL',page.url, 'MESSAGE', (await page.locator('body').inner_text())[-3000:],flush=True)
  raise
 finally:
  await context.tracing.stop(path=str(OUT/f'{people}-people-trace.zip'));await context.close()
async def main():
 OUT.mkdir(parents=True,exist_ok=True)
 server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)))
 threading.Thread(target=server.serve_forever,daemon=True).start()
 try:
  async with async_playwright() as p:
   browser=await p.chromium.launch(executable_path=os.environ.get('BLAKEOUT_QA_CHROME', '/usr/bin/chromium'),args=['--no-sandbox'])
   for people in map(int,os.environ.get('DARTS_PEOPLE','12,16,22').split(',')):
    await run(browser,f'http://127.0.0.1:{server.server_port}',people,people!=16)
   await browser.close()
 finally:server.shutdown()
if __name__=='__main__':asyncio.run(main())
