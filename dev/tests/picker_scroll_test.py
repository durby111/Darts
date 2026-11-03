"""Rendered scroll handoff regression; isolated synthetic saves, no backend.

BLAKEOUT_SCROLL_BASELINE=1 routes setup.css from the deployed pre-fix commit.
Actual wheel/touch input must move the outer scroller at the grid boundary;
Playwright's automatic scroll-into-view is not used to make cards reachable.
"""
import asyncio, functools, json, os, subprocess, threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[2]
OUT=Path('/workspace/scratch/pixel-scroll')
BASELINE='d2c0326d9eced017cfb3b5e9bd54313610714a1e'
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass

async def main():
    server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    base=f'http://127.0.0.1:{server.server_port}'
    results=[]
    try:
        async with async_playwright() as pw:
            browser=await pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
            cases=[(393,680,True,False),(393,600,True,True),(412,915,True,False),
                   (320,568,False,True),(844,390,True,True),(1280,900,True,False)]
            for build in ['', 'dev/']:
                for width,height,resume,expanded in cases:
                    ctx=await browser.new_context(viewport={'width':width,'height':height},has_touch=True,
                        is_mobile=width<1000,service_workers='block')
                    async def route(r):
                        if not r.request.url.startswith(base): return await r.abort()
                        if os.environ.get('BLAKEOUT_SCROLL_BASELINE') and r.request.url.endswith('/css/setup.css'):
                            content=subprocess.check_output(['git','show',BASELINE+':'+build+'css/setup.css'],cwd=ROOT)
                            return await r.fulfill(content_type='text/css',body=content)
                        await r.continue_()
                    await ctx.route('**/*',route)
                    page=await ctx.new_page()
                    await page.goto(base+'/'+build)
                    await page.locator('#startupNotice').wait_for(state='hidden')
                    if resume:
                        await page.click('#startGameBtn')
                        await page.wait_for_selector('#gameScreen',state='visible')
                        await page.reload()
                        await page.locator('#startupNotice').wait_for(state='hidden')
                    await page.evaluate('(open)=>document.querySelectorAll("#setupScreen details").forEach(d=>d.open=open)',expanded)
                    before=await page.evaluate('JSON.stringify(localStorage)')
                    # Move the page just enough to expose a touchable area of the
                    # grid; its bottom rows remain below the fixed action panel.
                    await page.evaluate('''()=>{
                        const grid=document.querySelector('#gameTypeGrid');
                        grid.scrollTop=grid.scrollHeight;
                        const available=Math.min(innerHeight,document.querySelector('#playSection').getBoundingClientRect().top);
                        document.querySelector('#setupScreen').scrollTop=Math.max(0,grid.getBoundingClientRect().top-available/2);
                    }''')
                    position=await page.evaluate('''()=>{const r=gameTypeGrid.getBoundingClientRect();return {x:r.left+40,y:Math.max(30,r.top+35),outer:setupScreen.scrollTop}}''')
                    await page.mouse.move(position['x'],position['y'])
                    await page.mouse.wheel(0,350)
                    await page.wait_for_timeout(300)
                    after=await page.evaluate('setupScreen.scrollTop')
                    assert after>position['outer']+10, (build,width,height,'grid trapped scroll',position,after)
                    # Exercise touch scrolling from inside the bottomed-out grid.
                    await page.evaluate('setupScreen.scrollTop=Math.max(0,setupScreen.scrollTop-180)')
                    pos=await page.evaluate('''()=>{const r=gameTypeGrid.getBoundingClientRect();const limit=Math.min(innerHeight,playSection.getBoundingClientRect().top);return {x:r.left+35,y:Math.min(limit-25,Math.max(80,r.top+90)),outer:setupScreen.scrollTop}}''')
                    session=await ctx.new_cdp_session(page)
                    await session.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':pos['x'],'y':pos['y']}]})
                    for step in range(1,9):
                        await session.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':pos['x'],'y':max(5,pos['y']-step*20)}]})
                        await page.wait_for_timeout(20)
                    await session.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
                    await page.wait_for_timeout(300)
                    assert await page.evaluate('setupScreen.scrollTop')>pos['outer']+5, (build,width,height,'touch did not hand off',pos)
                    # Position using the actual outer scroller after handoff, then
                    # hit-test and tap both final cards above any overlapping bar.
                    for index in [-2,-1]:
                        card=page.locator('[data-game-value]').nth(index)
                        ident=await card.get_attribute('data-game-value')
                        await page.evaluate('''id=>{
                            const card=document.querySelector('[data-game-value="'+id+'"]');
                            const r=card.getBoundingClientRect(),bar=playSection.getBoundingClientRect();
                            const overlaps=bar.left<r.right&&bar.right>r.left;
                            const target=overlaps?Math.min(innerHeight,bar.top):innerHeight;
                            setupScreen.scrollTop+=r.bottom-target+20;
                        }''',ident)
                        box=await card.bounding_box()
                        x,y=box['x']+box['width']/2,box['y']+box['height']/2
                        assert box['height']>=44 and box['width']>=44
                        assert await page.evaluate('''({x,y,id})=>document.elementFromPoint(x,y)?.closest('[data-game-value]')?.dataset.gameValue===id''',{'x':x,'y':y,'id':ident}), (build,width,height,ident,box)
                        await page.touchscreen.tap(x,y)
                        assert await page.locator('#gameType').input_value()==ident
                    assert await page.evaluate('JSON.stringify(localStorage)')==before
                    # Team Cricket has its own setup requirements; exercise the
                    # persistent Start control with ordinary 501 after both taps.
                    await page.select_option('#gameType','501')
                    start=await page.locator('#startGameBtn').bounding_box()
                    assert start['height']>=44 and start['y']>=0 and start['y']+start['height']<=height
                    x,y=start['x']+start['width']/2,start['y']+start['height']/2
                    assert await page.evaluate('({x,y})=>document.elementFromPoint(x,y)?.closest("#startGameBtn")!==null',{'x':x,'y':y})
                    await page.screenshot(path=str(OUT/f'fixed-{build.replace("/","") or "prod"}-{width}-{height}.png'))
                    await page.touchscreen.tap(x,y)
                    await page.wait_for_selector('#gameScreen',state='visible')
                    assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
                    results.append({'build':build or 'production','viewport':[width,height],'resume':resume,'expanded':expanded,'pass':True})
                    print('PASS',results[-1],flush=True)
                    await ctx.close()
            await browser.close()
        OUT.mkdir(parents=True,exist_ok=True)
        (OUT/'scroll-results.json').write_text(json.dumps(results,indent=2))
        print(f'PASS {len(results)} rendered scroll/Start groups')
    finally: server.shutdown()

asyncio.run(main())
