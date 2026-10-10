"""Rendered DEV sample previews: shared themes, responsive layout and screenshots.

Uses the shipped memory-only previews. No accounts, provider requests or saved
games are created. Physical touch and live-site verification remain separate.
"""
import argparse
import asyncio
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import shutil
import threading

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
THEMES = ['blue', 'red', 'neon', 'sunburst', 'volt', 'inferno', 'miami', 'grape', 'aqua', 'royal', 'shamrock', 'arctic']
STYLES = ['modern', 'classic', 'dc', 'dot-better']


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


async def run(output):
    output.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(ROOT)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    checks = []
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True, executable_path=shutil.which('chromium') or shutil.which('google-chrome'))
            context = await browser.new_context(viewport={'width': 1440, 'height': 1100})
            external = []
            context.on('request', lambda request: external.append(request.url) if not request.url.startswith(f'http://127.0.0.1:{server.server_port}/') else None)
            for feature in ['brackets', 'accounts']:
                page = await context.new_page()
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                await page.goto(f'http://127.0.0.1:{server.server_port}/dev/preview/{feature}/?scenario=live' if feature == 'brackets' else f'http://127.0.0.1:{server.server_port}/dev/preview/accounts/')
                await page.wait_for_selector('.match-card' if feature == 'brackets' else '#records .platform-data-row')
                for theme in THEMES:
                    for style in STYLES:
                        await page.evaluate("([theme,style])=>{document.documentElement.dataset.theme=theme;document.documentElement.dataset.scoreboardMode=style;document.documentElement.dataset.x01Skin=style;}", [theme, style])
                        for width, height in [(1440, 1100), (390, 844)]:
                            await page.set_viewport_size({'width': width, 'height': height})
                            if feature == 'brackets':
                                await page.locator('#diagramFit').click()
                            await page.wait_for_timeout(40)
                            metrics = await page.evaluate("""() => {
                                const body=getComputedStyle(document.body), card=getComputedStyle(document.querySelector('.platform-card'));
                                const subject=getComputedStyle(document.querySelector('.match-card, .platform-data-row'));
                                const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
                                const ctx=canvas.getContext('2d');
                                const rgb=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3);};
                                const lum=color=>rgb(color).map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((s,n,i)=>s+n*[.2126,.7152,.0722][i],0);
                                const contrast=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
                                const selectors=['.slot-members','.source-jump','.match-state','.platform-data-row'];
                                const ratios=selectors.flatMap(selector=>[...document.querySelectorAll(selector)].slice(0,5).map(el=>{
                                    let parent=el,bg;
                                    while(parent){bg=getComputedStyle(parent).backgroundColor;if(bg!=='rgba(0, 0, 0, 0)')break;parent=parent.parentElement;}
                                    return {selector,ratio:contrast(getComputedStyle(el).color,bg)};
                                }));
                                const diagram=document.querySelector('#diagram');
                                return {overflow:document.documentElement.scrollWidth>innerWidth+1, bodyFont:body.fontFamily, subjectFont:subject.fontFamily,
                                    card:card.backgroundColor, subject:subject.backgroundColor, ratios,
                                    fit:!diagram||(diagram.scrollWidth<=diagram.clientWidth+2&&diagram.scrollHeight<=diagram.clientHeight+2),
                                    controlsContained:[...document.querySelectorAll('.source-jump, .match-action')].every(el=>{const a=el.getBoundingClientRect(),b=el.closest('.match-slot, .match-card').getBoundingClientRect();return a.top>=b.top-1&&a.bottom<=b.bottom+1;})};
                            }""")
                            label = f'{feature}/{theme}/{style}/{width}'
                            assert not metrics['overflow'], label + ' horizontal page overflow'
                            assert metrics['fit'], label + ' bracket not fully fitted'
                            assert metrics['controlsContained'], label + ' clipped match controls'
                            assert metrics['bodyFont'] == metrics['subjectFont'], label + ' inconsistent font'
                            if feature == 'brackets':
                                assert metrics['card'] == metrics['subject'], label + ' mismatched shared surfaces'
                            assert all(item['ratio'] >= 4.5 for item in metrics['ratios']), (label, metrics['ratios'])
                            checks.append({'variant': label, **metrics})
                            if theme in ['blue', 'arctic'] and (width == 1440 or style == 'modern'):
                                section = page.locator('.bracket-section' if feature == 'brackets' else '#recordsPanel')
                                await section.scroll_into_view_if_needed()
                                await section.screenshot(path=str(output / f'{feature}-{theme}-{style}-{width}.png'))
                assert not errors, errors
                await page.close()
            # The 32-team overview must retain every match and connection.
            page = await context.new_page()
            await page.goto(f'http://127.0.0.1:{server.server_port}/dev/preview/brackets/?scenario=large')
            await page.wait_for_selector('.match-card')
            assert await page.locator('.match-card').count() == 63
            await page.set_viewport_size({'width': 1440, 'height': 1100})
            await page.locator('#diagramFit').click()
            await page.locator('.bracket-section').scroll_into_view_if_needed()
            assert await page.locator('.connector:not(.drop)').first.evaluate("e=>parseFloat(getComputedStyle(e).strokeWidth)*Number(document.querySelector('#diagram').dataset.zoom)>=1.4")
            await page.screenshot(path=str(output / 'brackets-32-teams.png'))
            assert not external, external
            await browser.close()
        (output / 'report.json').write_text(json.dumps(checks, indent=2))
        print(f'PASS {len(checks)} rendered variants: 12 themes × 4 styles × 2 sizes × 2 feature pages; contrast, containment, shared font/surfaces. 63-match overview captured. No external preview requests.')
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path('/tmp/blakeout-bracket-visual'))
    args = parser.parse_args()
    asyncio.run(run(args.output))
