"""Actual service-worker upgrade/offline checks with synthetic storage only.

Prepare /tmp/blakeout-baseline with git archive of the pre-release main.
No external services are used. Persistent HTTP module failures are diagnostic, not a claim
to reproduce a specific physical device incident.
"""
import asyncio
import json
import threading
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
source = Path('/tmp/blakeout-baseline')
fault = False

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(source), **kwargs)
    def log_message(self, *args):
        pass
    def do_GET(self):
        if fault and self.path == '/js/registry.js':
            self.send_error(503, 'Synthetic transient module failure')
        else:
            super().do_GET()
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

async def main():
    global source, fault
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}'
    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
            ctx = await browser.new_context()
            await ctx.route('https://**/*', lambda r: r.abort())
            page = await ctx.new_page()
            print("STEP navigate", source, flush=True)
            await page.goto(base, wait_until="domcontentloaded")
            await page.wait_for_function('navigator.serviceWorker.controller !== null')
            # An existing cached client starts with a controlling worker.
            await page.reload(wait_until='domcontentloaded')
            await page.evaluate("""async()=>{
                localStorage.setItem('blakeout_dev_active_game', 'untouched-dev');
                localStorage.setItem('blakeout_roster_id', '0123456789abcdef0123456789abcdef');
                localStorage.setItem('blakeout_last_team_setup', JSON.stringify({teams:[[{name:'Older A'}],[{name:'Older B'}]],firstTeam:0}));
                await caches.open('blakeout-dev-preserve-fixture');
            }""")
            await page.select_option('#gameType', '501')
            await page.click('#startGameBtn')
            await page.wait_for_selector('#gameScreen', state='visible')
            await page.click('[data-digit="6"]')
            await page.click('[data-digit="0"]')
            await page.click('#x01EnterBtn')
            saved = await page.evaluate("localStorage.getItem('blakeout_active_game')")
            assert saved and '441' in saved
            # Persist any state updated after the click handler before recording baseline.
            await page.evaluate("import('./js/state.js').then(s=>s.saveActiveGame())")
            saved = await page.evaluate("localStorage.getItem('blakeout_active_game')")
            source = ROOT
            # A failed precache must never activate/delete the old working cache.
            fault = True
            interrupted = await page.evaluate("""async()=>{
                const reg=await navigator.serviceWorker.getRegistration();
                const old=reg.active;
                let attempted;
                reg.addEventListener('updatefound',()=>{attempted=reg.installing;},{once:true});
                await reg.update();
                if (!attempted) throw new Error('Expected an installing candidate worker');
                await new Promise((resolve,reject)=>{
                    const timer=setTimeout(()=>reject(new Error('Install did not terminate')),15000);
                    function check(){if(['activated','redundant'].includes(attempted.state)){clearTimeout(timer);resolve();}}
                    attempted.addEventListener('statechange',check);check();
                });
                return {state:attempted.state, oldStillActive:reg.active===old};
            }""")
            assert interrupted == {'state':'redundant','oldStillActive':True}, interrupted
            assert 'blakeout-v57-minnesota-places' in await page.evaluate('caches.keys()')
            assert await page.evaluate("import('./js/state.js').then(s=>s.game.players[0].score)") == 441
            print('PASS interrupted candidate install keeps previous worker/cache and running game intact')
            fault = False
            print("STEP update worker", flush=True)
            await page.evaluate("void navigator.serviceWorker.getRegistration().then(r=>r.update())")
            await page.wait_for_function("document.querySelector('.version-text').textContent==='v2.6.0'")
            await page.locator('#startupNotice').wait_for(state='hidden')
            assert await page.locator('[data-game-value]').count() == 30
            current = await page.evaluate("localStorage.getItem('blakeout_active_game')")
            before, after = json.loads(saved), json.loads(current)
            differences = {k: [before.get(k), after.get(k)] for k in set(before) | set(after) if k != 'timestamp' and before.get(k) != after.get(k)}
            assert not differences, differences
            await page.click('#resumeGameBtn')
            assert await page.evaluate("import('./js/state.js').then(s=>s.game.players[0].score)") == 441
            print('PASS old worker -> candidate worker automatic reload; old active save resumes unchanged')
            await ctx.set_offline(True)
            await page.reload()
            await page.locator('#startupNotice').wait_for(state='hidden')
            assert await page.locator('[data-game-value]').count() == 30
            await page.click('#resumeGameBtn')
            assert await page.evaluate("import('./js/state.js').then(s=>s.game.players[0].score)") == 441
            await page.goto(base+'/compat/')
            await page.click('#start')
            await page.fill('#score', '60')
            await page.click('#submit')
            assert '441' in await page.locator('#scores').inner_text()
            assert {k:v for k,v in json.loads(await page.evaluate("localStorage.getItem('blakeout_active_game')")).items() if k != 'timestamp'} == {k:v for k,v in json.loads(saved).items() if k != 'timestamp'}
            print('PASS first offline reload and simple scoring; modern save unaffected')
            await ctx.set_offline(False)
            fault = True
            print("STEP navigate", source, flush=True)
            await page.goto(base, wait_until="domcontentloaded")
            await page.wait_for_function("document.querySelector('#startupNotice').dataset.startupState==='failed'")
            assert await page.locator('[data-game-value]').count() == 0
            assert {k:v for k,v in json.loads(await page.evaluate("localStorage.getItem('blakeout_active_game')")).items() if k != 'timestamp'} == {k:v for k,v in json.loads(saved).items() if k != 'timestamp'}
            fault = False
            await page.reload()
            await page.locator('#startupNotice').wait_for(state='hidden')
            assert await page.locator('[data-game-value]').count() == 30
            assert {k:v for k,v in json.loads(await page.evaluate("localStorage.getItem('blakeout_active_game')")).items() if k != 'timestamp'} == {k:v for k,v in json.loads(saved).items() if k != 'timestamp'}
            print('PASS persistent HTTP 503 remains visible after bounded retry; refresh recovers without data loss')
            keys = await page.evaluate('caches.keys()')
            assert 'blakeout-v59-static-retry-20261103' in keys and 'blakeout-dev-preserve-fixture' in keys
            assert 'blakeout-v57-minnesota-places' not in keys
            assert await page.evaluate("localStorage.getItem('blakeout_dev_active_game')") == 'untouched-dev'
            assert await page.evaluate("localStorage.getItem('blakeout_roster_id')") == '0123456789abcdef0123456789abcdef'
            assert 'Older A' in await page.evaluate("localStorage.getItem('blakeout_last_team_setup')")
            print('PASS cache family isolation; DEV save, roster ID and old team setup retained')
            await browser.close()
    finally:
        server.shutdown()

asyncio.run(main())
