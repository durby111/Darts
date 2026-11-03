"""Local-only title consistency and Brisket menu accessibility regressions."""
import asyncio, functools, threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[2]
OUT=Path('/workspace/scratch/pixel-scroll')
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass

async def main():
    server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    base=f'http://127.0.0.1:{server.server_port}'
    passed=0
    try:
        async with async_playwright() as pw:
            browser=await pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
            for build in ['dev/']:
                for width,height in [(320,568),(393,680),(844,390),(1280,900)]:
                    ctx=await browser.new_context(viewport={'width':width,'height':height},has_touch=True,service_workers='block')
                    await ctx.route('**/*',lambda r:r.continue_() if r.request.url.startswith(base) else r.abort())
                    page=await ctx.new_page()
                    page.on('dialog',lambda d:asyncio.create_task(d.accept()))
                    await page.goto(base+'/'+build)
                    await page.locator('#startupNotice').wait_for(state='hidden')
                    labels=await page.locator('.game-card-label').evaluate_all('''els=>els.map(el=>{
                        const c=getComputedStyle(el),r=el.getBoundingClientRect(),p=el.closest('.game-card').getBoundingClientRect();
                        const sub=el.closest('.game-card').querySelector('.game-card-sub').getBoundingClientRect();
                        return {title:el.textContent,font:c.fontSize,family:c.fontFamily,width:el.scrollWidth<=el.clientWidth+1,
                            inCard:r.top>=p.top&&r.bottom<=p.bottom,aboveSub:r.bottom<=sub.top+1};
                    })''')
                    assert len(labels)==30
                    assert all(x['font']=='18px' and x['family']==labels[0]['family'] and x['width'] and x['inCard'] and x['aboveSub'] for x in labels),labels
                    assert any('121' in x['title'] for x in labels)
                    assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
                    print('PASS titles',build or 'production',width,height,flush=True);passed+=1
                    await page.select_option('#gameType','brisket')
                    await page.click('#startGameBtn')
                    await page.wait_for_selector('#gameScreen',state='visible')
                    players=await page.evaluate("import('./js/state.js').then(s=>JSON.stringify(s.game.players))")
                    await page.reload()
                    await page.locator('#startupNotice').wait_for(state='hidden')
                    await page.click('#resumeGameBtn')
                    assert await page.evaluate("import('./js/state.js').then(s=>JSON.stringify(s.game.players))")==players
                    menu=page.get_by_role('button',name='Open game menu — Brisket, idea by Burt',exact=True)
                    assert await menu.count()==1
                    assert await page.locator('#menuBtn #brisketGameCredit').is_visible()
                    assert not await page.locator('#menuButtonText').is_visible()
                    assert await page.locator('#cricketMain #brisketGameCredit').count()==0
                    box=await menu.bounding_box()
                    assert box['width']>=44 and box['height']>=44 and box['x']>=0 and box['x']+box['width']<=width and box['y']+box['height']<=height,box
                    stored=await page.evaluate('JSON.stringify(localStorage)')
                    for key in ['Enter','Space']:
                        await menu.focus();await page.keyboard.press(key)
                        await page.locator('#gameMenuModal').wait_for(state='visible')
                        await page.click('#gameMenuResumeBtn')
                        await page.locator('#gameMenuModal').wait_for(state='hidden')
                    await page.keyboard.press('Tab')
                    await menu.focus()
                    assert await menu.evaluate("e=>e.matches(':focus-visible') && getComputedStyle(e).outlineStyle!=='none'")
                    assert await page.evaluate('JSON.stringify(localStorage)')==stored
                    await page.screenshot(path=str(OUT/f'prepared-burt-{build.replace("/","") or "prod"}-{width}.png'))
                    await page.touchscreen.tap(box['x']+box['width']/2,box['y']+box['height']/2)
                    await page.locator('#gameMenuModal').wait_for(state='visible')
                    await page.click('#gameMenuSettingsBtn')
                    await page.select_option('#gameType','501');await page.click('#startGameBtn')
                    await page.wait_for_selector('#gameScreen',state='visible')
                    assert await page.locator('#menuButtonText').is_visible()
                    assert not await page.locator('#brisketGameCredit').is_visible()
                    assert not await page.locator('#menuBtn').evaluate("e=>e.classList.contains('brisket-menu-button')")
                    assert await page.locator('#menuBtn').get_attribute('aria-label') is None
                    await page.get_by_role('button',name='Menu',exact=True).click()
                    await page.locator('#gameMenuModal').wait_for(state='visible')
                    assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
                    print('PASS Brisket-only menu, touch/keyboard/focus and ordinary Menu restoration',build or 'production',width,height,flush=True);passed+=1
                    await ctx.close()
            await browser.close()
        print('PASS',passed,'rendered presentation groups')
    finally: server.shutdown()

asyncio.run(main())
