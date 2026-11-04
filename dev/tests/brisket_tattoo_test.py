"""Synthetic, local-only closed-tattoo rendering and game-isolation checks."""
import asyncio, functools, threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[2]
OUT=Path('/workspace/scratch/burt-closed')
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
async def main():
    server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    base=f'http://127.0.0.1:{server.server_port}'
    OUT.mkdir(parents=True,exist_ok=True)
    async with async_playwright() as pw:
        browser=await pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
        for width,height,count in [(320,568,2),(393,680,2),(412,915,2),(768,1024,3),(320,568,4),(844,390,4),(1280,900,2)]:
            ctx=await browser.new_context(viewport={'width':width,'height':height},has_touch=True,service_workers='block')
            await ctx.route('**/*',lambda r:r.continue_() if r.request.url.startswith(base) else r.abort())
            p=await ctx.new_page();p.set_default_timeout(10000)
            await p.goto(base+'/dev/')
            await p.select_option('#gameType','brisket');await p.select_option('#numPlayers',str(count))
            await p.click('#startGameBtn')
            assert await p.locator('.brisket-dragon, .brisket-target-label').count()==0
            assert await p.locator('#cricketGrid button').evaluate_all('''els=>els.every(e=>{const r=e.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e;})''')
            menu_before=await p.locator('#menuBtn').evaluate('(e)=>e.outerHTML')
            assert await p.locator('#menuBtn').inner_text()=='Menu'
            assert await p.locator('#menuBtn svg').count()==0
            # Exercise renderer's complete transition space, including pending closure and every range.
            await p.evaluate('''async()=>{
                const {game:g}=await import('./js/state.js'),{getMarkSymbol:f}=await import('./js/ui.js');
                for(const t of ['1','6','15','20','Bull']) for(const n of [0,1,2,3,4]) {
                    const html=f(n,0,true,false,t,false,0,0);
                    if(html.includes('#9c293b')) throw Error('red ink');
                    if(html.includes('brisket-closed')!==(n>=3)) throw Error('wrong mark '+n);
                }
                for(const before of [0,1,2]) {
                    const h=f(3,0,before===0,false,'Bull',false,0,before);
                    if((h.match(/class="tattoo-arrow"/g)||[]).length!==before) throw Error('arrow history');
                    if(before && (!h.includes('translate(3 5) rotate(40)') || !h.includes('M110 0L95 -6'))) throw Error('arrow direction');
                    if((h.match(/class="arrow-feathers"/g)||[]).length!==before) throw Error('feather count');
                    if((h.match(/class="arrow-nock"/g)||[]).length!==before) throw Error('nock count');
                }
                if(!f(2,1,true,false,'Bull').includes('Pending closure')) throw Error('pending closure');
                for(const type of ['cricket','spanish','minnesota','cutthroat']) {
                    g.type=type;if(f(3).includes('brisket-closed')) throw Error('art leak');
                }
                g.type='brisket';
                for(let i=0;i<g.players.length;i++) for(let j=0;j<g.cricketTargets.length;j++) {
                    const m=g.players[i].cricketData[g.cricketTargets[j]],n=i===0&&j<3?3:(j+i)%4;
                    m.marks=n;m.closed=n===3;m.marksBeforeClose=j%3;m.closedInOneTurn=j%3===0;
                }
                const c=await import('./js/cricket.js');c.updateCricketDisplay();
                (await import('./js/state.js')).saveActiveGame();
            }''')
            assert await p.locator('.brisket-closed').count()>0
            assert await p.locator('#menuBtn').evaluate('(e)=>e.outerHTML')==menu_before
            for tattoo in await p.locator('.brisket-closed').all():
                assert 'Closed — Burt heart' in await tattoo.get_attribute('aria-label')
                result=await tattoo.evaluate('''e=>{
                    const r=e.getBoundingClientRect(),c=e.parentElement.getBoundingClientRect();
                    const t=e.querySelector('text').getBBox();
                    return {ok:r.left>=c.left-1&&r.right<=c.right+1&&t.x>18&&t.x+t.width<82,r:r.toJSON(),c:c.toJSON(),text:{x:t.x,width:t.width}};
                }''')
                assert result['ok'],result
            assert await p.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
            state=await p.evaluate("import('./js/state.js').then(s=>JSON.stringify(s.game.players))")
            await p.reload();await p.click('#resumeGameBtn')
            assert await p.evaluate("import('./js/state.js').then(s=>JSON.stringify(s.game.players))")==state
            menu=p.locator('#menuBtn');await menu.focus();await p.keyboard.press('Enter')
            await p.locator('#gameMenuModal').wait_for(state='visible')
            await p.click('#gameMenuResumeBtn')
            await menu.focus();await p.keyboard.press('Space');await p.locator('#gameMenuModal').wait_for(state='visible')
            await p.click('#gameMenuResumeBtn')
            await p.screenshot(path=str(OUT/f'portrait-{width}-{count}.png'))
            if width==412: await p.screenshot(path=str(OUT/'BlakeOut-DEV-Brisket-Burt-closed.png'))
            print(f'PASS {width}x{height}, {count} players: transitions, bounds, isolation, save/resume, menu keyboard',flush=True)
            await ctx.close()
        await browser.close()
    server.shutdown()
asyncio.run(main())
