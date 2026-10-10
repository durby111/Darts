"""Actual browser coverage for DEV sample-test entries and production gates."""
import asyncio
import json
from functools import partial
from http.server import ThreadingHTTPServer
import shutil
import threading
from urllib.parse import urlparse, parse_qs

from playwright.async_api import async_playwright
from bracket_visual_test import ROOT, Handler


async def run():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(ROOT)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f'http://127.0.0.1:{server.server_port}'
    groups = 0
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True, executable_path=shutil.which('chromium') or shutil.which('google-chrome'))
            for theme in ['blue', 'arctic']:
                for style in ['modern', 'classic', 'dc', 'dot-better']:
                    context = await browser.new_context(viewport={'width': 1280, 'height': 900}, service_workers='block')
                    await context.route('https://**', lambda route: route.abort())
                    await context.add_init_script(f"localStorage.setItem('blakeout_theme','{theme}');localStorage.setItem('blakeout_x01_skin','{style}');")
                    page = await context.new_page()
                    for feature in ['brackets', 'accounts']:
                        await page.goto(base + '/dev/')
                        entry = page.locator(f'.dev-app-nav:not(.dev-game-nav) a[data-app-feature="{feature}"]')
                        await entry.wait_for()
                        assert await entry.is_enabled()
                        assert 'Sample' in await entry.inner_text()
                        assert 'coming soon' not in (await page.locator('body').inner_text()).lower()
                        # Keyboard activation exercises the real anchor, not a forced click.
                        await entry.focus()
                        await page.keyboard.press('Enter')
                        await page.wait_for_url(base + f'/dev/preview/{feature}/')
                        await page.wait_for_selector('.match-card' if feature == 'brackets' else '#records .platform-data-row')
                        assert await page.locator('html').get_attribute('data-theme') == theme
                        assert await page.locator('html').get_attribute('data-scoreboard-mode') == style
                        assert 'nothing is saved or sent' in (await page.locator('.preview-title').inner_text()).lower()
                        assert 'coming soon' not in (await page.locator('body').inner_text()).lower()
                    await context.close()
                    groups += 1
                    print(f'PASS setup entries and saved appearance: {theme}/{style}', flush=True)
            for feature in ['brackets', 'accounts']:
                context = await browser.new_context(service_workers='block')
                await context.route('https://**', lambda route: route.abort())
                page = await context.new_page()
                await page.goto(base + '/dev/')
                await page.locator('#startGameBtn').click()
                await page.locator('#menuBtn').click()
                # Capture the current initialized input state, not Start Game's earlier
                # snapshot. beforeunload legitimately refreshes the timestamp.
                saved = await page.evaluate("async()=>{(await import('/dev/js/state.js')).saveActiveGame();return localStorage.getItem('blakeout_dev_active_game')}")
                assert saved
                await page.locator(f'#gameMenuModal .dev-game-nav a[data-app-feature="{feature}"]').click()
                await page.wait_for_url(base + f'/dev/preview/{feature}/')
                await page.wait_for_selector('.match-card' if feature == 'brackets' else '#records .platform-data-row')
                after = await page.evaluate("localStorage.getItem('blakeout_dev_active_game')")
                old, new = json.loads(saved), json.loads(after)
                assert new.pop('timestamp') >= old.pop('timestamp')
                assert new == old, 'Navigation changed the saved game contents'
                await context.close()
                groups += 1
                print(f'PASS Game Menu click to {feature}; local game retained', flush=True)
            context = await browser.new_context(service_workers='block')
            requests = []
            context.on('request', lambda request: requests.append(request.url))
            page = await context.new_page()
            for feature in ['brackets', 'accounts']:
                for suffix in ['/', '/index.html?mode=signIn&oobCode=NOT-A-REAL-TOKEN#old-event']:
                    requests.clear()
                    await page.goto(base + f'/dev/{feature}' + suffix)
                    await page.wait_for_url(base + f'/dev/preview/{feature}/')
                    await page.wait_for_selector('.match-card' if feature == 'brackets' else '#records .platform-data-row')
                    assert all(urlparse(url).netloc == urlparse(base).netloc for url in requests)
                    assert not any(urlparse(url).path == '/dev/js/platform.js' for url in requests)
                    assert parse_qs(urlparse(page.url).query) == ({'id': ['sample-cup']} if feature == 'brackets' else {})
                    assert not urlparse(page.url).fragment
                    groups += 1
                    print(f'PASS direct DEV route {feature}{suffix}: sample only, no provider import or token forwarding', flush=True)
                await page.goto(base + f'/{feature}/')
                assert 'Coming soon' in await page.locator('body').inner_text()
                assert await page.locator('button:disabled').count() == 2
                assert await page.locator('a[href*="preview"]').count() == 0
                groups += 1
                print(f'PASS production {feature} remains gated', flush=True)
            await context.close()
            await browser.close()
        print(f'{groups}/{groups} DEV navigation, appearance and production-boundary groups passed')
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


if __name__ == '__main__':
    asyncio.run(run())
