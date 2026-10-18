"""Actual local browser: start scorer via UI, inspect device status in a second tab.
Reuses roster/start acceptance setup; does not seed tournament/scorer state.
"""
import asyncio, functools, os, threading
from http.server import ThreadingHTTPServer
from playwright.async_api import async_playwright
import local_tournament_flow_test as flow
class ProbeComplete(BaseException): pass
async def inspect_status(page, winner, interrupt=False):
 await page.wait_for_function("document.querySelector('#gameScreen').style.display==='flex'")
 game=await flow.state(page)
 session=game['tournament']
 bracket=await page.context.new_page()
 base=page.url.split('/dev/')[0]
 await bracket.goto(base+'/dev/local/brackets/?id='+session['tournamentId']);await flow.ready(bracket)
 active=bracket.locator('.match-card.in-progress')
 assert await active.count()==1
 assert await active.locator('.match-state').inner_text()=='● In progress · device'
 assert await active.locator('.match-action').inner_text()=='Resume scorer'
 ready=bracket.locator('.match-card.ready:not(.in-progress)')
 assert await ready.count()>0
 assert 'Ready to play' in await ready.first.locator('.match-state').inner_text()
 feed=bracket.locator('.match-card.pending .source-jump').first
 label=await feed.inner_text();code=label.split(' of ')[1]
 await feed.click()
 assert await bracket.locator('.match-card:focus').get_attribute('data-code')==code
 await bracket.screenshot(path=str(flow.OUT/'device-progress-and-feeder.png'),full_page=True)
 print('PASS actual browser: scorer launch, distinct in-progress/ready states, keyboard-focus feeder jump; no cloud access',flush=True)
 raise ProbeComplete()
async def main():
 flow.OUT.mkdir(parents=True,exist_ok=True)
 server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(flow.Quiet,directory=str(flow.ROOT)))
 threading.Thread(target=server.serve_forever,daemon=True).start()
 flow.play_match=inspect_status
 try:
  async with async_playwright() as p:
   browser=await p.chromium.launch(executable_path=os.environ.get('BLAKEOUT_QA_CHROME','/usr/bin/chromium'),args=['--no-sandbox'])
   try:await flow.run(browser,f'http://127.0.0.1:{server.server_port}',10,True)
   except ProbeComplete:pass
   finally:await browser.close()
 finally:server.shutdown()
if __name__=='__main__':asyncio.run(main())
