"""Rendered recovery checks with real workers and synthetic HTTP failures.

All storage belongs to disposable browser contexts; no external services used.
"""
import asyncio
import json
import threading
from collections import Counter
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
faults = {}
hits = Counter()

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)
    def log_message(self, *args):
        pass
    def do_GET(self):
        hits[self.path] += 1
        fault = faults.get(self.path)
        if fault and fault['remaining']:
            if fault['remaining'] > 0:
                fault['remaining'] -= 1
            self.send_error(fault['status'], 'Synthetic response')
        else:
            super().do_GET()
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

def set_fault(path, status, remaining):
    hits[path] = 0
    faults[path] = {'status': status, 'remaining': remaining}

def snapshot(text):
    return {k: v for k, v in json.loads(text).items() if k != 'timestamp'} if text else None

async def ready(page):
    await page.locator('#startupNotice').wait_for(state='hidden')
    assert await page.locator('[data-game-value]').count() == 30
    assert await page.locator('#startupNotice').get_attribute('data-startup-state') == 'ready'

async def score(page):
    await page.select_option('#gameType', '501')
    await page.click('#startGameBtn')
    await page.wait_for_selector('#gameScreen', state='visible')
    await page.click('[data-digit="6"]')
    await page.click('[data-digit="0"]')
    await page.click('#x01EnterBtn')
    assert await page.evaluate("import('./js/state.js').then(s=>s.game.players[0].score)") == 441

async def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}'
    groups = 0
    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
            for build in ['', 'dev/']:
                url = base + '/' + build
                module = '/' + build + 'js/registry.js'
                key = 'blakeout_dev_active_game' if build else 'blakeout_active_game'
                other_key = 'blakeout_active_game' if build else 'blakeout_dev_active_game'
                cache_name = 'blakeout-dev-v84-static-retry-20261103' if build else 'blakeout-v59-static-retry-20261103'
                ctx = await browser.new_context()
                await ctx.route('https://**/*', lambda route: route.abort())
                page = await ctx.new_page()
                # First-load failure has no controlling worker. Recovery is explicit,
                # never an automatic reload or re-evaluation of half-loaded modules.
                set_fault(module, 503, -1)
                await page.goto(url)
                await page.wait_for_function("document.querySelector('#startupNotice').dataset.startupState==='failed'")
                assert await page.locator('[data-game-value]').count() == 0
                assert await page.evaluate('navigator.serviceWorker.controller === null')
                await page.evaluate('(key)=>localStorage.setItem(key,"preserve-other-build")', other_key)
                cold_requests = hits[module]
                await page.wait_for_timeout(600)
                assert hits[module] == cold_requests == 1
                faults.clear()
                await page.click('#startupRetry')
                await ready(page)
                await score(page)
                await page.wait_for_function('navigator.serviceWorker.controller !== null')
                await page.reload()
                await ready(page)
                print(f'PASS {build or "production/"} cold failure stays visible; explicit retry starts a working scorer without loops', flush=True)
                groups += 1

                for status in [503, 404]:
                    # A poisoned cached module would break initialization if this
                    # HTTP recovery silently mixed old cached code into the graph.
                    await page.evaluate("""async ({name,url})=>{
                        const cache=await caches.open(name);
                        await cache.put(url,new Response('throw new Error("stale fixture must not run")',{headers:{'Content-Type':'text/javascript'}}));
                    }""", {'name': cache_name, 'url': base+module})
                    set_fault(module, status, 1)
                    await page.reload()
                    await ready(page)
                    assert hits[module] == 2, (build, status, hits[module])
                    await score(page)
                    assert await page.evaluate('(key)=>localStorage.getItem(key)', other_key) == 'preserve-other-build'
                    print(f'PASS {build or "production/"} warm transient {status}: two network attempts, no cached-module substitution; Start and scoring work', flush=True)
                    groups += 1

                for status in [503, 404, 401, 403]:
                    # Capture settled state, including the display's empty X01 input.
                    await page.evaluate("import('./js/state.js').then(s=>s.saveActiveGame())")
                    saved = snapshot(await page.evaluate('(key)=>localStorage.getItem(key)', key))
                    set_fault(module, status, -1)
                    await page.reload()
                    await page.wait_for_function("document.querySelector('#startupNotice').dataset.startupState==='failed'")
                    assert await page.locator('[data-game-value]').count() == 0
                    expected = 2 if status in [503, 404] else 1
                    assert hits[module] == expected, (build, status, hits[module])
                    await page.wait_for_timeout(600)
                    assert hits[module] == expected
                    after = snapshot(await page.evaluate('(key)=>localStorage.getItem(key)', key))
                    assert after == saved, {k:[saved.get(k),after.get(k)] for k in saved if saved.get(k)!=after.get(k)}
                    faults.clear()
                    await page.click('#startupRetry')
                    await ready(page)
                    assert snapshot(await page.evaluate('(key)=>localStorage.getItem(key)', key)) == saved
                    await page.click('#resumeGameBtn')
                    assert await page.evaluate("import('./js/state.js').then(s=>s.game.players[0].score)") == 441
                    print(f'PASS {build or "production/"} persistent {status}: {expected} attempt(s), visible failure, no reload loop, saved game resumes after manual recovery', flush=True)
                    groups += 1

                # A controlling worker can outlive browser eviction of its cache.
                await page.evaluate('(name)=>caches.delete(name)', cache_name)
                set_fault(module, 503, 1)
                await page.reload()
                await ready(page)
                assert hits[module] == 2
                await score(page)
                faults.clear()
                await ctx.set_offline(True)
                await page.reload()
                await ready(page)
                await page.click('#resumeGameBtn')
                assert await page.evaluate("import('./js/state.js').then(s=>s.game.players[0].score)") == 441
                assert await page.evaluate('(key)=>localStorage.getItem(key)', other_key) == 'preserve-other-build'
                print(f'PASS {build or "production/"} evicted-cache recovery, subsequent offline reload and saved-game resume', flush=True)
                groups += 1
                await ctx.close()
            await browser.close()
        print(f'PASS {groups} rendered recovery groups')
    finally:
        server.shutdown()

asyncio.run(main())
