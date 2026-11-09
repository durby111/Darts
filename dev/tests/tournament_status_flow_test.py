"""Synthetic local organizer flow: truthful flags, atomic start and live payment edits."""
import asyncio,functools,threading,json
from http.server import ThreadingHTTPServer
from playwright.async_api import async_playwright
from local_tournament_flow_test import ROOT,Quiet,ready,event,saved,state,play_leg
async def main():
 server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)));threading.Thread(target=server.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{server.server_port}'
 async with async_playwright() as pw:
  b=await pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  for draw,width in [(False,390),(True,768)]:
   ctx=await b.new_context(viewport={'width':width,'height':900},service_workers='block');await ctx.route('**/*',lambda r:r.continue_() if r.request.url.startswith(base) else r.abort())
   p=await ctx.new_page();p.on('dialog',lambda d:d.accept());await p.goto(base+'/dev/local/brackets/');await ready(p)
   await p.locator('#createPanel summary').click();await p.fill('#title','Unpaid named players');await p.select_option('#gameType','301');await p.fill('#bestOf','1');await p.locator('#createForm button[type=submit]').click();await ready(p)
   await p.fill('#guestName','   ');await p.locator('#addForm button').click();assert await p.locator('#rosterRows tr').count()==0
   for i in range(4):
    await p.fill('#guestName',f'Guest {i}');await p.locator('#addForm button').click()
    if not draw:await p.locator('#rosterRows tr').last.locator('[data-field=tag]').fill(str(i//2+1))
   if draw:
    await p.click('#drawPartners');await p.click('.platform-confirm-cancel');assert await p.locator('#rosterRows [data-field=tag]').evaluate_all('es=>es.every(e=>!e.value)')
    await p.locator('#drawPartners').dblclick(delay=40);await p.click('.platform-confirm-accept')
   await p.click('#startTournament');await p.click('.platform-confirm-cancel');assert (await event(p))['status']=='registration'
   await p.locator('#startTournament').dblclick(delay=40);await p.click('.platform-confirm-accept');await ready(p)
   t=await event(p);assert t['revision']==1 and t['status']=='live';assert all(not r['paid'] and not r['checkedIn'] for r in t['registrations'])
   await p.reload();await ready(p);assert await event(p)==t
   match=next(m for m in t['matches'] if m['status']=='ready')
   desk=await ctx.new_page();await desk.goto(p.url);await ready(desk)
   await p.locator(f'.match-card[data-code="{match["code"]}"] .match-action').click();await p.click('#launchScorer');await p.wait_for_url('**/?localTournament=1&tournamentMatch=1');await p.wait_for_function("document.querySelector('#gameScreen').style.display==='flex'")
   await desk.locator('#paymentRows input').first.check();await ready(desk);paid=await event(desk);assert paid['registrations'][0]['paid'];assert paid['teams']==t['teams'] and paid['matches']==t['matches']
   await desk.reload();await ready(desk);assert await desk.locator('#paymentRows input').first.is_checked()
   from pathlib import Path
   Path('/workspace/scratch/tournament-status').mkdir(parents=True,exist_ok=True)
   await desk.locator('#paymentPanel').scroll_into_view_if_needed();await desk.screenshot(path=f'/workspace/scratch/tournament-status/payments-{width}.png')
   print('PASS start and concurrent payment before scorer save',draw,flush=True)
   await play_leg(p,0)
   await p.click('#tournamentSaveResult');await p.locator('dialog[aria-labelledby=actionConfirmTitle]').get_by_role('button',name='Save result',exact=True).click()
   await p.wait_for_function("document.querySelector('#tournamentResultPanel').textContent.includes('Result saved')")
   await p.click('#tournamentResultReturn');await p.locator('dialog[aria-labelledby=actionConfirmTitle]').get_by_role('button',name='Return to brackets',exact=True).click();await p.wait_for_url('**/local/brackets/?id=*');await ready(p)
   final=await event(p);assert final['registrations'][0]['paid'] and all(not r['checkedIn'] for r in final['registrations']);assert len((await saved(p))['results'])==1
   await desk.reload();await ready(desk);await desk.locator('#paymentRows input').first.uncheck();await ready(desk);assert not (await event(desk))['registrations'][0]['paid']
   assert len((await saved(desk))['results'])==1
   print('PASS', 'blind draw' if draw else 'manual doubles',width,'blank name, unpaid/unchecked atomic start, cancel/repeat, reload, scorer completion plus concurrent payment, receipt preservation',flush=True)
   await ctx.close()
  await b.close()
 server.shutdown()
asyncio.run(main())
