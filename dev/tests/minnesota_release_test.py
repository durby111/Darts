#!/usr/bin/env python3
"""Production cache/update, local offline scorer and scoped artifact checks."""
import asyncio,functools,threading,subprocess
from http.server import ThreadingHTTPServer
from playwright.async_api import async_playwright
from minnesota_cutthroat_test import ROOT,OUT,Quiet,state,hit,enter,preview
async def main():
 OUT.mkdir(parents=True,exist_ok=True)
 allowed={'index.html','sw.js','js/cricket.js','js/setup.js','js/state.js','js/registry.js','js/scoring-records.js'}
 changed=subprocess.check_output(['git','diff','4c150cc','--name-only','--','.',' :!dev'.strip()],cwd=ROOT,text=True).splitlines()
 assert set(changed)<=allowed,changed
 for file in ['js/feature-availability.js','js/firebase.js','firebase.json','firestore.rules','accounts/index.html','brackets/index.html']:
  assert (ROOT/file).read_bytes()==subprocess.check_output(['git','show','4c150cc:'+file],cwd=ROOT),file
 server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)));threading.Thread(target=server.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{server.server_port}'
 try:
  async with async_playwright() as p:
   b=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);ctx=await b.new_context(viewport={'width':390,'height':844})
   await ctx.route('**/*',lambda r:r.continue_() if r.request.url.startswith(base) else r.abort())
   page=await ctx.new_page();alerts=[]
   page.on('dialog',lambda d:(alerts.append(d.message),asyncio.create_task(d.accept())))
   # A plain same-origin page seeds the old caches without running the scorer.
   await page.goto(base+'/brackets/')
   await page.evaluate('''async()=>{
    await caches.open('blakeout-v55-coming-soon');await caches.open('blakeout-dev-v65-local-tournaments');
    localStorage.setItem('blakeout_dev_active_game','existing-dev-save');
    localStorage.setItem('blakeout_roster_id','0123456789abcdef0123456789abcdef');
    localStorage.setItem('blakeout_configs',JSON.stringify({lastConfig:{gameType:'minnesota',numPlayers:'2',cricketPoints:true},savedConfigs:[{name:'existing preset',gameType:'501'}]}));
    await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;
   }''')
   await page.wait_for_function("navigator.serviceWorker.controller!==null")
   keys=await page.evaluate('caches.keys()');assert 'blakeout-v55-coming-soon' not in keys and 'blakeout-v56-minnesota-cutthroat' in keys and 'blakeout-dev-v65-local-tournaments' in keys,keys
   await page.goto(base+'/');await page.select_option('#gameType','minnesota');await page.uncheck('#cricketPoints');await page.check('#minnesotaCutthroat');await page.select_option('#numPlayers','4')
   assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
   assert await page.is_checked('#cricketPoints') and await page.locator('#cricketPoints').is_disabled()
   await page.click('#startGameBtn');await page.wait_for_selector('#cricketMain',state='visible')
   assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
   await hit(page,'20',3);await enter(page)
   before=await state(page)
   await ctx.set_offline(True);await page.reload();await page.click('#resumeGameBtn')
   assert (await state(page))['players']==before['players'] and (await state(page))['minnesotaCutthroat']
   await page.screenshot(path=str(OUT/'production-mobile-offline.png'),full_page=True)
   assert await page.evaluate("localStorage.blakeout_dev_active_game")=='existing-dev-save'
   assert await page.evaluate("localStorage.blakeout_roster_id")=='0123456789abcdef0123456789abcdef'
   assert await page.evaluate("JSON.parse(localStorage.blakeout_configs).savedConfigs[0].name")=='existing preset'
   await page.reload()
   original=await page.evaluate('localStorage.blakeout_active_game')
   await page.evaluate("document.querySelector('#numPlayers').value='1'")
   await page.click('#startGameBtn');await page.wait_for_timeout(400)
   assert any('at least two' in x for x in alerts),alerts
   assert await page.evaluate('localStorage.blakeout_active_game')==original
   print('PASS minimum-player bypass rejected before replacing the existing saved game; points forced from a no-points setup',flush=True)
   print('PASS scoped production allowlist; gates/backend unchanged; real worker upgrade clears only old production cache; presets/DEV data retained; mobile + offline Minnesota Cutthroat resume',flush=True)
   await b.close()
 finally:server.shutdown()
if __name__=='__main__':asyncio.run(main())
