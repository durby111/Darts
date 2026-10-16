#!/usr/bin/env python3
"""Full production matches: all closures through rendered controls, no seeded winners."""
import asyncio,functools,threading
from http.server import ThreadingHTTPServer
from playwright.async_api import async_playwright
from minnesota_places_test import OUT
from minnesota_cutthroat_test import ROOT,Quiet,setup,state,hit,enter,miss
async def finish(page,winner):
 for visit in range(200):
  g=await state(page)
  if g.get('minnesotaPlaces') and winner in g['minnesotaPlaces']['order']:return
  if g['currentPlayer']!=winner:await miss(page);continue
  while True:
   g=await state(page);pending=g['pendingDarts'];used=sum(3 if d['target']=='Bed' else 1 for d in pending)
   if used>=3:break
   target=None
   for t in g['cricketTargets']:
    data=g['players'][winner]['cricketData'][t];marks=data['marks']+sum(d['multiplier'] for d in pending if d['target']==t)
    if marks<data['maxMarks']:target=t;needed=data['maxMarks']-marks;break
   if target is None or target=='Bed' and used:break
   await hit(page,target,1 if target in ['Bed','Triples','Doubles'] else min(2 if target=='Bull' else 3,needed))
  await enter(page)
 raise AssertionError('match did not finish')
async def main():
 OUT.mkdir(parents=True,exist_ok=True);srv=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)));threading.Thread(target=srv.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{srv.server_port}'
 try:
  async with async_playwright() as p:
   b=await p.chromium.launch(executable_path='/usr/bin/chromium');c=await b.new_context(service_workers='block');await c.route('**/*',lambda r:r.continue_() if r.request.url.startswith(base) else r.abort());await c.tracing.start(screenshots=True,snapshots=True)
   for cut in [False,True]:
    page=await c.new_page();await setup(page,base,'',3,cut);await finish(page,0);await page.click('#playForPlacesBtn');await finish(page,1)
    s=await state(page);assert s['minnesotaPlaces']['order']==[0,1,2];assert s['minnesotaPlaces']['phase']=='complete';assert s['minnesotaPlaces']['turns']
    print(f'PASS full production match cut={cut}: first and second closed every row with rendered dart controls; third assigned, no seeded board or scores',flush=True);await page.close()
   await c.tracing.stop(path=str(OUT/'placements-full-trace.zip'));await b.close()
 finally:srv.shutdown()
if __name__=='__main__':asyncio.run(main())
