#!/usr/bin/env python3
"""Focused local-only regression suite for the opt-in Dot Better scoreboard.

Run: python3 dev/tests/dot_better_test.py
     python3 dev/tests/dot_better_test.py --only responsive_layout

Uses installed Chromium when available (or --chromium / CHROMIUM_PATH).
Serves this checkout at /dev/ on an ephemeral loopback port. Each test gets
an empty browser context; no account or real roster data is loaded. External
page requests are aborted, and Chromium's host resolver blocks external
hosts, including requests made by its real service worker. Offline coverage
uses the actual service worker and Cache Storage, not a mocked fetch/cache.

All scoring, style changes, settings, reload/resume and undo use real UI
controls. State-module imports below only observe state, never fabricate it.
JSON results and viewport screenshots are written outside the repo, to
/tmp/blakeout_dot_better_test by default. Chromium emulation does not replace
physical iPad/Safari touch, PWA-install or VoiceOver testing.
"""

import argparse
import asyncio
import functools
import inspect
import json
import os
from pathlib import Path
import shutil
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
OUT = Path('/tmp/blakeout_dot_better_test')
STYLE = 'dot-better'
STYLES = ['modern', 'classic', 'dc', STYLE]
SCORE_IDS = ['homeScore', 'awayScore', 'player3Score', 'player4Score']


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


async def state(page):
    return await page.evaluate("""async () => {
        const { game } = await import('./js/state.js');
        return JSON.parse(JSON.stringify(game));
    }""")


async def ready(page):
    await page.wait_for_function("document.documentElement.hasAttribute('data-scoreboard-mode')")
    await page.locator('#startGameBtn').wait_for(state='visible')


async def settings(page):
    if not await page.locator('#setupScreen').is_visible():
        await page.locator('#menuBtn').click()
        await page.locator('#gameMenuVisualBtn').click()
    else:
        await page.locator('#settingsBtnSetup').click()
    await page.locator('#settingsModal').wait_for(state='visible')


async def choose_style(page, style=STYLE, scale=None):
    await settings(page)
    await page.locator(f'[data-score-skin="{style}"]').click()
    assert await page.locator('html').get_attribute('data-scoreboard-mode') == style
    assert await page.locator('html').get_attribute('data-x01-skin') == style
    assert await page.evaluate("localStorage.getItem('blakeout_x01_skin')") == style
    if scale is not None:
        # Keyboard interaction with the real settings range control.
        slider = page.locator('#uiScale')
        await slider.focus()
        await slider.press('Home')
        for _ in range(round((scale - .7) / .1)):
            await slider.press('ArrowRight')
        assert abs(float(await slider.input_value()) - scale) < .001
    await page.locator('#settingsCloseBtn').click()
    await page.locator('#settingsModal').wait_for(state='hidden')


async def start_game(page, game='501', players=2, long_names=False):
    await page.locator(f'.game-card[data-game-value="{game}"]').click()
    await page.locator('#numPlayers').select_option(str(players))
    if long_names:
        for number in range(1, players + 1):
            await page.locator(f'#player{number}').fill(f'Long Test Player Number {number}')
    await page.locator('#startGameBtn').click()
    await page.locator('#gameScreen').wait_for(state='visible')
    await page.locator('#cricketMain' if game == 'cricket' else '#x01Controls').wait_for(state='visible')


async def enter_digits(page, value):
    for digit in str(value):
        await page.locator(f'#x01Controls [data-digit="{digit}"]').click()


async def commit(page, selector):
    before = await state(page)
    before_turns = sum(len(p['history']) for p in before['players'])
    await page.locator(selector).click()
    await page.wait_for_function("""async expected => {
        const {game} = await import('./js/state.js');
        return game.players.reduce((n,p) => n+p.history.length,0) === expected;
    }""", arg=before_turns + 1)
    # Wait for the scorer's real 700 ms turn lock, rather than racing the
    # next quick-score button (quick-score buttons themselves are not disabled).
    await page.wait_for_function("['x01MissBtn','x01BustBtn','x01EnterBtn'].every(id => !document.getElementById(id).disabled)")


async def new_setup(page):
    await page.locator('#menuBtn').click()
    await page.locator('#gameMenuExitBtn').click()
    await page.locator('#setupScreen').wait_for(state='visible')


async def test_picker_default_persistence(page):
    assert await page.locator('html').get_attribute('data-scoreboard-mode') == 'modern'
    assert await page.evaluate("localStorage.getItem('blakeout_x01_skin')") in (None, 'modern')
    await settings(page)
    choices = await page.locator('#scoreSkinChoices [data-score-skin]').evaluate_all(
        "els => els.map(el => ({id:el.dataset.scoreSkin, text:el.innerText, pressed:el.getAttribute('aria-pressed')}))")
    assert [c['id'] for c in choices] == STYLES, choices
    assert choices[0]['pressed'] == 'true', choices
    assert all(c['pressed'] == 'false' for c in choices[1:]), choices
    assert 'Dot Better' in choices[-1]['text'], choices[-1]
    await page.locator(f'[data-score-skin="{STYLE}"]').click()
    assert await page.locator(f'[data-score-skin="{STYLE}"]').get_attribute('aria-pressed') == 'true'
    assert await page.locator('#scoreSkinChoices .active').count() == 1
    await page.locator('#settingsCloseBtn').click()
    await page.reload(wait_until='domcontentloaded')
    await ready(page)
    assert await page.locator('html').get_attribute('data-scoreboard-mode') == STYLE
    assert await page.evaluate("localStorage.getItem('blakeout_x01_skin')") == STYLE
    # Restore every existing choice through its real picker and reload it.
    for style in STYLES[:-1]:
        await choose_style(page, style)
        await page.reload(wait_until='domcontentloaded')
        await ready(page)
        assert await page.locator('html').get_attribute('data-scoreboard-mode') == style
    return {'default': 'modern', 'choices': choices, 'persisted': STYLES}


async def test_scoring_switch_undo_reload(page):
    await choose_style(page)
    await start_game(page)
    await enter_digits(page, 60)
    assert (await page.locator('#inputDisplay').inner_text()).strip() == '60'
    assert (await page.locator('#homeScore').inner_text()).strip() == '441'
    assert (await state(page))['players'][0]['score'] == 501, 'Preview must not commit'
    pending = await state(page)
    await choose_style(page, 'classic')
    assert await state(page) == pending, 'Changing style changed pending state'
    await choose_style(page)
    await commit(page, '#x01EnterBtn')
    await commit(page, '[data-quick="100"]')
    scored = await state(page)
    assert [p['score'] for p in scored['players']] == [441, 401], scored['players']
    assert scored['players'][0]['history'][0] == 60
    assert scored['players'][1]['history'][0] == 100
    history_text = await page.locator('#x01Main').inner_text()
    for style in ('modern', 'classic', 'dc', STYLE):
        await choose_style(page, style)
        assert await state(page) == scored, f'{style} changed scores, history, turn or undo state'
        assert await page.locator('#x01Main').inner_text() == history_text
    await page.locator('#undoBtnX01').click()
    undone = await state(page)
    assert [p['score'] for p in undone['players']] == [441, 501]
    assert [len(p['history']) for p in undone['players']] == [1, 0]
    assert undone['currentPlayer'] == 1 and len(undone['redoHistory']) == 1
    await page.wait_for_timeout(550)
    await page.locator('#redoBtnX01').click()
    assert [p['score'] for p in (await state(page))['players']] == [441, 401]
    saved = await state(page)
    await page.reload(wait_until='domcontentloaded')
    await ready(page)
    assert await page.locator('html').get_attribute('data-scoreboard-mode') == STYLE
    await page.locator('#resumeGameBtn').click()
    restored = await state(page)
    for field in ('players', 'currentPlayer', 'completedRounds', 'scoringRecords'):
        assert restored[field] == saved[field], f'Reload lost {field}'
    assert len(restored['undoHistory']) == len(saved['undoHistory'])
    await page.locator('#undoBtnX01').click()
    assert [p['score'] for p in (await state(page))['players']] == [441, 501]
    return {'scores': [441, 401], 'switches': STYLES, 'reload_and_restored_undo': True}


async def test_miss_explicit_and_arithmetic_bust(page):
    await choose_style(page)
    await start_game(page, '301')
    await commit(page, '#x01MissBtn')
    missed = await state(page)
    assert [p['score'] for p in missed['players']] == [301, 301]
    assert missed['players'][0]['history'][-1]['miss'] is True
    assert 'MISS' in await page.locator('#p1HistoryCol').inner_text()
    await commit(page, '#x01BustBtn')
    busted = await state(page)
    assert [p['score'] for p in busted['players']] == [301, 301]
    assert busted['players'][1]['history'][-1]['bust'] is True
    assert 'BUST' in await page.locator('#p3HistoryCol').inner_text()
    await commit(page, '[data-quick="180"]')  # Home 121
    await commit(page, '[data-quick="100"]')  # Away 201
    await enter_digits(page, 180)
    assert 'BUST' in await page.locator('#homeScore').inner_text()
    await commit(page, '#x01EnterBtn')
    arithmetic = await state(page)
    assert [p['score'] for p in arithmetic['players']] == [121, 201]
    assert arithmetic['players'][0]['history'][-1]['bust'] is True
    assert arithmetic['players'][0]['history'][-1]['score'] == 180
    await page.locator('#undoBtnX01').click()
    undone = await state(page)
    assert undone['currentPlayer'] == 0
    assert len(undone['players'][0]['history']) == 2
    assert undone['players'][0]['score'] == 121
    return {'miss': True, 'explicit_bust': True, 'arithmetic_bust': True, 'undo': True}


async def test_existing_styles_isolated(page):
    await start_game(page)
    snapshots = {}
    # Removing ONLY the additive stylesheet must not alter any original style.
    # This checks computed styles and geometry, rather than maintaining a brittle
    # screenshot hash dependent on the local Chromium/font version.
    async def metrics():
        return await page.evaluate("""() => Object.fromEntries([
            '#gameScreen','#scoreHeader','#homeScore','#x01Main','#x01Controls',
            '.number-pad','.pad-center','[data-digit="1"]','[data-quick="100"]'
        ].map(selector => {
            const el=document.querySelector(selector), s=getComputedStyle(el), r=el.getBoundingClientRect();
            return [selector,{css:Array.from(s).map(k=>[k,s.getPropertyValue(k)]),
                rect:[r.x,r.y,r.width,r.height]}];
        }))""")
    for style in STYLES[:-1]:
        await choose_style(page, style)
        await page.wait_for_timeout(100)
        before = await metrics()
        await page.locator('link[href="css/dot-better.css"]').evaluate('el => el.disabled = true')
        await page.wait_for_timeout(100)
        without = await metrics()
        await page.locator('link[href="css/dot-better.css"]').evaluate('el => el.disabled = false')
        assert before == without, f'Dot Better CSS leaked into {style}'
        await commit(page, '[data-quick="40"]')
        snapshots[style] = [p['score'] for p in (await state(page))['players']]
    assert snapshots == {'modern': [461, 501], 'classic': [461, 461], 'dc': [421, 461]}, snapshots
    return {'unchanged_computed_styles': list(snapshots), 'scores': snapshots}


async def layout_metrics(page):
    return await page.evaluate("""() => {
        const rect=el=>{const r=el.getBoundingClientRect();return {
            x:r.x,y:r.y,left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
        const visible=el=>el.getClientRects().length && getComputedStyle(el).visibility!=='hidden';
        const measure=el=>({id:el.id||el.dataset.digit||el.dataset.quick||el.textContent.trim(),
            box:rect(el),font:parseFloat(getComputedStyle(el).fontSize),
            clientWidth:el.clientWidth,scrollWidth:el.scrollWidth});
        const header=document.querySelector('#scoreHeader');
        return {header:rect(header),controls:rect(document.querySelector('#x01Controls')),
            history:rect(document.querySelector('#x01Main')),
            headerChildren:[...header.children].filter(visible).map(measure),
            scores:[...header.querySelectorAll('.score-big')].filter(visible).map(el=>({
                ...measure(el),owner:rect(el.closest('.player-header'))})),
            keys:[...document.querySelectorAll('#x01Controls button,#menuBtn')].filter(visible).map(measure),
            entries:[...document.querySelectorAll('.score-history-entry')].filter(visible).map(measure),
            documentWidth:document.documentElement.scrollWidth,innerWidth};
    }""")


def overlap(a, b):
    return min(a['right'], b['right']) - max(a['left'], b['left']) > 1 and \
        min(a['bottom'], b['bottom']) - max(a['top'], b['top']) > 1


async def test_responsive_layout(page):
    checked = []
    for width, height in ((744, 1133), (820, 1180), (1133, 744), (390, 844)):
        for players, scale in ((2, 1.0), (4, 1.5)):
            await page.set_viewport_size({'width': width, 'height': height})
            if await page.locator('#gameScreen').is_visible():
                await new_setup(page)
            await choose_style(page, scale=scale)
            await start_game(page, '1501', players, long_names=True)
            # True four-digit starting scores, then enough committed turns to
            # produce history for each player. No test mutates app/game state.
            for _ in range(players):
                await commit(page, '[data-quick="100"]')
            await enter_digits(page, 60)  # Also exercise live delta/preview layout.
            tag = f'{width}x{height}-{players}p-{scale}x'
            m = await layout_metrics(page)
            assert m['documentWidth'] <= width + 1, (tag, 'page horizontal overflow', m)
            header, controls, history = (m[k] for k in ('header', 'controls', 'history'))
            assert header['bottom'] <= history['top'] + 1, (tag, 'header/history overlap', m)
            assert history['bottom'] <= controls['top'] + 1, (tag, 'history/keypad order or overlap', m)
            assert controls['bottom'] <= height + 1, (tag, 'keypad below viewport', m)
            assert height - controls['bottom'] <= 32, (tag, 'keypad not bottom-anchored', m)
            for panel in (header, controls, history):
                assert panel['left'] >= -1 and panel['right'] <= width + 1, (tag, 'offscreen panel', panel)
                assert abs(panel['left'] - header['left']) <= 2, (tag, 'panels not aligned', panel, header)
                assert abs(panel['width'] - header['width']) <= 2, (tag, 'panel widths differ', panel, header)
            assert history['height'] >= 80, (tag, 'history collapsed', history)
            assert len(m['scores']) == players, (tag, 'missing score', m['scores'])
            for score in m['scores']:
                assert score['font'] >= 24, (tag, 'score too small', score)
                assert score['scrollWidth'] <= score['clientWidth'] + 1, (tag, 'clipped score', score)
                assert score['box']['left'] >= score['owner']['left'] - 1, (tag, score)
                assert score['box']['right'] <= score['owner']['right'] + 1, (tag, score)
            for i, a in enumerate(m['headerChildren']):
                for b in m['headerChildren'][i+1:]:
                    assert not overlap(a['box'], b['box']), (tag, 'header elements overlap', a, b)
            for key in m['keys']:
                assert key['box']['width'] >= 43.9 and key['box']['height'] >= 43.9, \
                    (tag, 'touch target below 44px', key)
            for i, a in enumerate(m['keys']):
                for b in m['keys'][i+1:]:
                    assert not overlap(a['box'], b['box']), (tag, 'key overlap', a, b)
            assert all(e['font'] >= 14 for e in m['entries']), (tag, 'history text too small', m['entries'])
            screenshot = OUT / f'layout-{tag}.png'
            await page.screenshot(path=str(screenshot), full_page=True)
            checked.append({'scenario': tag, 'header': header, 'controls': controls, 'history': history,
                            'minimum_touch_width': min(k['box']['width'] for k in m['keys']),
                            'minimum_touch_height': min(k['box']['height'] for k in m['keys']),
                            'screenshot': str(screenshot)})
    return checked


async def test_history_viewport_retains_records(page):
    await page.set_viewport_size({'width': 390, 'height': 844})
    await choose_style(page)
    await start_game(page, '1501')
    for _ in range(40):
        await commit(page, '[data-quick="26"]')
    before = await state(page)
    assert [len(p['history']) for p in before['players']] == [20, 20]
    assert [p['score'] for p in before['players']] == [981, 981]
    await page.wait_for_timeout(40)
    geometry = await page.evaluate("""() => {
      const main = document.getElementById('x01Main');
      return [...main.children].filter(c => c.style.display !== 'none').map(c => {
        const box = c.getBoundingClientRect();
        const first = c.firstElementChild.getBoundingClientRect();
        const last = c.lastElementChild.getBoundingClientRect();
        return {id:c.id, count:c.children.length, client:c.clientHeight,
                height:c.scrollHeight, scroll:c.scrollTop,
                top:box.top, bottom:box.bottom, firstTop:first.top, lastBottom:last.bottom};
      });
    }""")
    for lane in geometry:
        assert lane['count'] == 21, lane  # 20 preserved rounds and the active round
        assert lane['height'] > lane['client'], lane
        assert lane['firstTop'] < lane['top'], lane
        assert 0 <= lane['bottom'] - lane['lastBottom'] <= 6, lane
        assert abs(lane['scroll'] - (lane['height'] - lane['client'])) <= 2, lane
    # A style round trip must preserve all records and return to the latest row.
    await choose_style(page, 'modern')
    await choose_style(page)
    assert await state(page) == before
    await page.screenshot(path=str(OUT / 'history-latest-at-bottom.png'), full_page=True)
    return {'retained_turns': 40, 'lanes': geometry, 'state_unchanged': True}


async def test_cricket_smoke(page):
    await page.set_viewport_size({'width': 390, 'height': 844})
    await choose_style(page, scale=1.5)
    await start_game(page, 'cricket', 4, long_names=True)
    assert await page.locator('.cricket-row').count() == 7
    assert await page.locator('#gameScreen').get_attribute('data-scoreboard-family') == 'cricket'
    await page.locator('.cricket-dt-btn[data-target="20"][data-multiplier="3"]').first.click()
    await page.locator('#enterBtn').click()
    closed = await state(page)
    assert closed['players'][0]['cricketData']['20']['closed'] is True
    await choose_style(page, 'dc')
    assert await state(page) == closed
    await choose_style(page)
    await page.locator('#undoBtn').click()
    undone = await state(page)
    assert undone['currentPlayer'] == 0
    # Casual Cricket snapshots before each dart; ENTER adds no extra snapshot.
    assert undone['players'][0]['cricketData']['20']['closed'] is False
    assert undone['pendingDarts'] == []

    # Everyone closes 20, while 19 stays open. The new palette must retain
    # the closed-target cue, including a non-color dashed-border signal.
    for player in range(4):
        await page.locator('.cricket-dt-btn[data-target="20"][data-multiplier="3"]').first.click()
        await page.locator('#enterBtn').click()
        await page.wait_for_function('async expected => (await import("./js/state.js")).game.currentPlayer === expected',
                                     arg=(player + 1) % 4)
    all_closed = await state(page)
    assert all(p['cricketData']['20']['closed'] for p in all_closed['players'])
    assert all(not p['cricketData']['19']['closed'] for p in all_closed['players'])
    cue = await page.evaluate('''() => {
        const closed = document.querySelector('.cricket-num-btn[data-target="20"]');
        const open = document.querySelector('.cricket-num-btn[data-target="19"]');
        const a = getComputedStyle(closed), b = getComputedStyle(open);
        return {dimmed:closed.classList.contains('dimmed'), closedBackground:a.backgroundColor,
                openBackground:b.backgroundColor, border:a.borderTopStyle};
    }''')
    assert cue['dimmed'] and cue['closedBackground'] != cue['openBackground'], cue
    assert cue['border'] == 'dashed', cue
    # Normal point scoring still works on an open target: two T19 darts
    # close Home's 19 and score 57 while the opponents still have it open.
    for _ in range(2):
        await page.locator('.cricket-dt-btn[data-target="19"][data-multiplier="3"]').first.click()
    await page.locator('#enterBtn').click()
    scored = await state(page)
    assert scored['players'][0]['score'] == 57
    assert scored['players'][0]['cricketData']['19']['closed'] is True
    # A dimmed, globally closed target remains harmless if it is tapped.
    await page.locator('.cricket-dt-btn[data-target="20"][data-multiplier="3"]').first.click()
    await page.locator('#enterBtn').click()
    assert [p['score'] for p in (await state(page))['players']] == [57, 0, 0, 0]
    width = await page.evaluate('document.documentElement.scrollWidth')
    assert width <= 391, f'Cricket horizontal overflow: {width}'
    await page.screenshot(path=str(OUT / 'cricket-390x844-4p-1.5x.png'), full_page=True)
    return {'four_player_phone_max_scale': True, 'T20_closure': True, 'style_preserves_state': True, 'undo': True, 'closed_target_cue': cue, 'normal_points': 57}


async def test_winner_palette_and_repeat(page):
    # Actual wins and dismissal/replay through the UI. No fabricated game state.
    checks = []
    for style, theme in [('modern', 'arctic'), ('classic', 'red'), ('dc', 'blue'),
                         (STYLE, 'arctic'), (STYLE, 'blue')]:
        await choose_style(page, style)
        await settings(page)
        await page.locator(f'[data-theme-choice="{theme}"]').click()
        await page.locator('#settingsCloseBtn').click()
        await page.emulate_media(reduced_motion='no-preference')
        await start_game(page, '301')
        await commit(page, '[data-quick="180"]')
        await commit(page, '#x01MissBtn')
        await enter_digits(page, 121)
        await commit(page, '#x01EnterBtn')
        await page.locator('#winnerModal').wait_for(state='visible')
        assert (await state(page))['players'][0]['score'] == 0
        palette = await page.evaluate('''dotBetter => {
            const modal=document.querySelector('#winnerModal');
            const card=modal.querySelector('.winner-modal-content');
            const base=dotBetter ? document.querySelector('#gameScreen') : document.documentElement;
            const theme=getComputedStyle(base), actual=getComputedStyle(card);
            const action=document.querySelector('#playAgainBtn'), r=action.getBoundingClientRect();
            const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
            return {surface:actual.backgroundColor, expectedSurface:theme.getPropertyValue('--color-surface').trim(),
                text:actual.color, expectedText:theme.getPropertyValue('--color-text').trim(),
                actionColor:getComputedStyle(action).color, actionBg:getComputedStyle(action).backgroundColor,
                actionHit:hit===action||action.contains(hit),
                animation:getComputedStyle(modal.querySelector('.winner-emblem')).animationName};
        }''', style == STYLE)
        def rgb(hex_color):
            v=hex_color.lstrip('#')
            if len(v)==3: v=''.join(c*2 for c in v)
            return 'rgb('+', '.join(str(int(v[i:i+2],16)) for i in (0,2,4))+')'
        assert palette['surface'] == rgb(palette['expectedSurface']), (style, theme, palette)
        assert palette['text'] == rgb(palette['expectedText']), (style, theme, palette)
        assert palette['actionHit'], (style, theme, 'celebration covers action', palette)
        if style == STYLE:
            assert palette['actionBg'] == 'rgb(40, 110, 183)', palette
            assert palette['actionColor'] == 'rgb(255, 255, 255)', palette
        # Undo a win while the modal is open, then win again. CSS animation
        # restarts on display; dismiss/reopen cannot leave a stale overlay.
        await page.locator('#winnerCancelBtn').click()
        await page.locator('#winnerModal').wait_for(state='hidden')
        assert (await state(page))['players'][0]['score'] == 121
        await page.wait_for_timeout(600)
        await enter_digits(page, 121)
        await commit(page, '#x01EnterBtn')
        await page.locator('#winnerModal').wait_for(state='visible')
        # Reduced-motion preference disables all new celebration animations.
        await page.emulate_media(reduced_motion='reduce')
        await page.wait_for_timeout(100)
        animations = await page.locator('#winnerModal').evaluate('''el =>
            el.getAnimations({subtree:true}).filter(a => a.playState==='running').map(a=>a.animationName)''')
        assert not animations, (style, theme, 'reduced motion still animates', animations)
        await page.locator('#playAgainBtn').click()
        await page.locator('#winnerModal').wait_for(state='hidden')
        assert [p['score'] for p in (await state(page))['players']] == [301, 301]
        await new_setup(page)
        checks.append({'style':style, 'theme':theme, 'palette':palette,
                       'undo_win_reopen_play_again':True, 'reduced_motion':True})
    return checks


async def test_service_worker_offline(page):
    # This test is intentionally run with real service workers enabled.
    await page.wait_for_function('!!navigator.serviceWorker.controller', timeout=20000)
    await page.evaluate('navigator.serviceWorker.ready')
    cached = await page.evaluate("""async () => {
        const names=await caches.keys();
        const files=[];
        for (const name of names) {
            const cache=await caches.open(name);
            files.push(...(await cache.keys()).map(r=>({cache:name,path:new URL(r.url).pathname})));
        }
        return files;
    }""")
    asset = [f for f in cached if f['path'].endswith('/dev/css/dot-better.css')]
    assert asset and all(f['cache'].startswith('blakeout-dev-') for f in asset), cached
    assert any(f['path'].endswith('/dev/js/settings.js') for f in cached), cached
    await choose_style(page)
    await start_game(page)
    await commit(page, '[data-quick="60"]')
    before = await state(page)
    await page.context.set_offline(True)
    try:
        response = await page.reload(wait_until='domcontentloaded')
        assert response and response.from_service_worker, 'Offline navigation not served by actual service worker'
        await ready(page)
        assert await page.locator('html').get_attribute('data-scoreboard-mode') == STYLE
        await page.locator('#resumeGameBtn').click()
        restored = await state(page)
        assert restored['players'] == before['players']
        assert restored['currentPlayer'] == 1
        style_response = await page.evaluate("""async () => {
            const r=await fetch('./css/dot-better.css');return {ok:r.ok,text:await r.text()};
        }""")
        assert style_response['ok'] and 'data-scoreboard-mode' in style_response['text']
        await commit(page, '[data-quick="100"]')
        assert [p['score'] for p in (await state(page))['players']] == [441, 401]
        await page.locator('#undoBtnX01').click()
        assert [p['score'] for p in (await state(page))['players']] == [441, 501]
        await choose_style(page, 'modern')
        await choose_style(page)
        await page.screenshot(path=str(OUT / 'offline-resumed-game.png'), full_page=True)
    finally:
        await page.context.set_offline(False)
    return {'real_service_worker': True, 'asset': asset, 'offline_resume_score_undo_and_picker': True}


async def run(args):
    global OUT
    OUT = args.output.resolve()
    OUT.mkdir(parents=True, exist_ok=True)
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    tests = {name[5:]: fn for name, fn in globals().items()
             if name.startswith('test_') and inspect.iscoroutinefunction(fn)}
    if args.only and args.only not in tests:
        raise ValueError(f'Unknown test {args.only!r}; choose from {list(tests)}')
    results = {}
    try:
        from playwright.async_api import async_playwright
        async with async_playwright() as p:
            executable = args.chromium or os.environ.get('CHROMIUM_PATH') or shutil.which('chromium')
            browser = await p.chromium.launch(headless=True, executable_path=executable, args=[
                '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost',
                '--disable-background-networking', '--no-proxy-server',
            ])
            for name, test in tests.items():
                if args.only and name != args.only:
                    continue
                context = await browser.new_context(viewport={'width': 820, 'height': 1180},
                    service_workers='allow' if name == 'service_worker_offline' else 'block',
                    reduced_motion='reduce')
                external = set()
                async def local_only(route):
                    url = route.request.url
                    if urlparse(url).netloc == urlparse(origin).netloc:
                        await route.continue_()
                    else:
                        external.add(url)
                        await route.abort('blockedbyclient')
                await context.route('**/*', local_only)
                page = await context.new_page()
                page.set_default_timeout(10000)
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                started = time.monotonic()
                try:
                    await page.goto(origin + '/dev/index.html', wait_until='domcontentloaded')
                    await ready(page)
                    detail = await test(page)
                    assert not errors, f'Uncaught page errors: {errors}'
                    results[name] = {'ok': True, 'detail': detail}
                except Exception as exc:
                    screenshot = OUT / f'FAIL-{name}.png'
                    try:
                        await page.screenshot(path=str(screenshot), full_page=True, timeout=5000)
                    except Exception:
                        pass
                    results[name] = {'ok': False, 'error': str(exc), 'screenshot': str(screenshot)}
                results[name].update(seconds=round(time.monotonic()-started, 2), page_errors=errors,
                                     blocked_external_requests=sorted(external))
                print(f"[{'PASS' if results[name]['ok'] else 'FAIL'}] {name}: "
                      f"{results[name].get('error', '')}", flush=True)
                await context.close()
            await browser.close()
    finally:
        server.shutdown()
        server.server_close()
    report = OUT / 'report.json'
    report.write_text(json.dumps(results, indent=2) + '\n')
    passed = sum(r['ok'] for r in results.values())
    print(f'{passed}/{len(results)} passed. Report: {report}', flush=True)
    return 0 if passed == len(results) else 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--only', help='Run one named test without the test_ prefix')
    parser.add_argument('--chromium', help='Chromium executable; defaults to CHROMIUM_PATH or installed chromium')
    parser.add_argument('--output', type=Path, default=OUT)
    raise SystemExit(asyncio.run(run(parser.parse_args())))
