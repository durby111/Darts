import asyncio,threading,functools
from minnesota_places_test import near,OUT
from minnesota_cutthroat_test import ROOT,Quiet,setup,hit,enter,state
from playwright.async_api import async_playwright
from http.server import ThreadingHTTPServer
async def main():
 s=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)));threading.Thread(target=s.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{s.server_port}'
 try:
  async with async_playwright() as p:
   b=await p.chromium.launch(executable_path='/usr/bin/chromium');c=await b.new_context(service_workers='block',viewport={'width':390,'height':844});await c.route('**/*',lambda r:r.continue_() if r.request.url.startswith(base) else r.abort());page=await c.new_page();await setup(page,base,'',4,True)
   await page.evaluate("async()=>{let {game}=await import('./js/state.js');game.players[0].name='A'.repeat(160);game.players[1].name='<img src=x onerror=alert(1)>';}")
   await near(page,0,[0,60,60,60]);await hit(page,'Bull');await enter(page)
   await page.locator('#playForPlacesBtn').scroll_into_view_if_needed();assert await page.locator('#playForPlacesBtn').is_visible();assert await page.locator('#minnesotaPlacesPanel img').count()==0
   assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
   await page.screenshot(path=str(OUT/'mobile-offer-long-name.png'),full_page=True)
   await page.click('#playForPlacesBtn');assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
   await near(page,1,[0,60,60,60]);await hit(page,'Bull');await enter(page);await near(page,2,[0,60,60,60]);await hit(page,'Bull');await enter(page)
   assert await page.locator('#minnesotaPlacesPanel img').count()==0
   assert await page.locator('#minnesotaPlacesPanel').evaluate('e=>e.scrollWidth<=e.clientWidth+1')
   print('PASS mobile long-name offer/continuation/result fit; button reachable; names remain text',flush=True)
   await b.close()
 finally:s.shutdown()
asyncio.run(main())
