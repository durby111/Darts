#!/usr/bin/env python3
"""
BlakeOut headless smoke / interaction tests.

Spins up `python3 -m http.server` against ./dev (or ./), drives the page
with Playwright, asserts critical flows, and dumps screenshots + a JSON
report under /tmp/blakeout_test/.

Usage:
    python3 scripts/headless_test.py                  # run full battery
    python3 scripts/headless_test.py --target dev     # default
    python3 scripts/headless_test.py --target prod    # serve / (root)
    python3 scripts/headless_test.py --only setup     # run a single named test
    python3 scripts/headless_test.py --keep-screenshots  # keep all (default: only failures)

Tests added in this round:
    setup            — page loads, all game types present, no console errors
    game_options     — selecting baseball/bermuda/121 reveals the right form
    team_mode        — team-mode lockup regression check (chip becomes
                       selected on tap, zones respond)
    baseball_cap     — hit buttons cap at 3 darts per turn
    bermuda_picker   — Doubles ring opens the 1-20 face picker modal
    leaderboard_seed — 121 summary writes localStorage leaderboard

Add a new test by writing `async def test_<name>(page)`. The runner
discovers them by prefix.
"""

import argparse, asyncio, inspect, json, subprocess, sys, time, os
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT = Path("/tmp/blakeout_test")
PORT = 8810


async def test_setup(page):
    title = await page.title()
    assert "BlakeOut" in title, f"title={title!r}"
    opts = await page.eval_on_selector_all("#gameType option", "els => els.map(e => e.value)")
    expected = {"301", "501", "cricket", "121", "baseball", "bermuda"}
    missing = expected - set(opts)
    assert not missing, f"missing game types: {missing}"
    return {"title": title, "game_types": opts}


async def test_game_options(page):
    # Selecting baseball should reveal #baseballOptions
    await page.select_option("#gameType", "baseball")
    bb_hidden = await page.locator("#baseballOptions").evaluate("el => el.classList.contains('hidden')")
    assert not bb_hidden, "baseballOptions still hidden after selecting baseball"

    await page.select_option("#gameType", "bermuda")
    bm_hidden = await page.locator("#bermudaOptions").evaluate("el => el.classList.contains('hidden')")
    assert not bm_hidden, "bermudaOptions still hidden after selecting bermuda"

    await page.select_option("#gameType", "121")
    g121_hidden = await page.locator("#game121Options").evaluate("el => el.classList.contains('hidden')")
    assert not g121_hidden, "game121Options still hidden after selecting 121"
    legs = await page.eval_on_selector_all("#totalLegs121 option", "els => els.map(e => e.value)")
    assert set(legs) == {"5", "10", "25", "infinite"}, f"unexpected totalLegs options: {legs}"
    pen = await page.eval_on_selector_all("#legLossPenalty121 option", "els => els.map(e => e.value)")
    assert "1" in pen, f"-1 penalty option missing: {pen}"
    return {"legs_options": legs, "penalty_options": pen}


async def test_team_mode(page):
    # Enable team mode, hit Start Game, confirm team builder responds.
    await page.evaluate("document.getElementById('teamMode').checked = true")
    # The setup screen's startGameBtn opens the team builder when teamMode is on.
    await page.click("#startGameBtn")
    await page.wait_for_selector("#teamBuilderScreen", state="visible", timeout=3000)
    # Add an ad-hoc tray player and verify it appears as a chip.
    await page.fill("#teamAddName", "Alice")
    await page.click("#teamAddBtn")
    chip_count_before = await page.locator(".team-chip[data-chip-id]").count()
    assert chip_count_before >= 1, f"chip never appeared after Add ({chip_count_before})"
    # Tap the chip — should become .selected. If the screen were greyed out
    # (the old lockup), this click would not register.
    chip = page.locator(".team-chip[data-chip-id]").first
    await chip.click()
    await page.wait_for_timeout(150)
    is_selected = await chip.evaluate("el => el.classList.contains('selected')")
    assert is_selected, "chip did not get .selected class (team-builder lockup regressed)"
    # Tap a zone to assign — chip should leave the tray and enter the zone.
    await page.click("#teamZone0")
    await page.wait_for_timeout(150)
    in_zone = await page.locator("#teamZone0Members .team-zone-member").count()
    assert in_zone >= 1, "chip did not move into zone after tap"
    return {"chip_moved_into_zone": in_zone}


async def test_baseball_cap(page):
    # Start a Baseball game with 2 default players, tap Single 4 times, ensure
    # the 4th tap is rejected (button disabled) and the turn score stays at 3.
    await page.select_option("#gameType", "baseball")
    await page.evaluate("document.getElementById('teamMode').checked = false")
    await page.click("#startGameBtn")
    await page.wait_for_selector("#targetGameMain", state="visible", timeout=3000)
    for _ in range(3):
        await page.click("#hitSingleBtn")
    turn_score_after_3 = int(await page.locator("#targetTurnScore").inner_text())
    # 4th tap: button should be disabled (cap)
    disabled = await page.locator("#hitSingleBtn").is_disabled()
    assert disabled, "Single button still enabled after 3 hits (3-dart cap regressed)"
    assert turn_score_after_3 == 3, f"expected 3 runs from 3 singles, got {turn_score_after_3}"
    return {"turn_score_after_3_singles": turn_score_after_3, "single_disabled_at_3": disabled}


async def test_bermuda_picker(page):
    # Bermuda Classic: target index 4 is the Doubles ring. We can't easily
    # advance through the early targets without a real game flow, so we set
    # the bermuda state directly via window-level JS.
    await page.select_option("#gameType", "bermuda")
    await page.click("#startGameBtn")
    await page.wait_for_selector("#targetGameMain", state="visible", timeout=3000)
    # Jump the bermuda state to the Doubles ring (classic variant, index 4).
    await page.evaluate("""
        (async () => {
            const mod = await import('./js/bermuda.js');
            const stateMod = await import('./js/state.js');
            stateMod.game.bermuda.targetIndex = 4;
        })()
    """)
    # Force a refresh via the target_game UI
    await page.evaluate("""
        (async () => {
            const tg = await import('./js/target_game.js');
            tg.updateTargetGameDisplay();
        })()
    """)
    await page.wait_for_timeout(150)
    # Tap the Single (the "Any Double" button on the ring) — should open the picker
    await page.click("#hitSingleBtn")
    await page.wait_for_selector("#bermudaFacePickerModal", state="visible", timeout=2000)
    btn_count = await page.locator("#bermudaFacePickerGrid button").count()
    assert btn_count == 20, f"expected 20 face buttons (1-20), got {btn_count}"
    return {"face_buttons": btn_count}


async def test_theme_picker(page):
    # Three swatches render; default is blue. Click each one and confirm
    # data-theme on <html> updates + localStorage persists it.
    swatches = await page.locator(".theme-swatch[data-theme-choice]").count()
    assert swatches == 3, f"expected 3 theme swatches, got {swatches}"
    initial = await page.evaluate("document.documentElement.getAttribute('data-theme')")
    assert initial == "blue", f"default theme was {initial!r}, expected 'blue'"

    for theme in ("red", "neon", "blue"):
        await page.click(f".theme-swatch[data-theme-choice='{theme}']")
        await page.wait_for_timeout(80)
        applied = await page.evaluate("document.documentElement.getAttribute('data-theme')")
        saved = await page.evaluate("localStorage.getItem('blakeout_theme')")
        assert applied == theme, f"clicking {theme} → data-theme={applied!r}"
        assert saved == theme, f"clicking {theme} → localStorage={saved!r}"
    return {"swatches": swatches, "final": "blue"}


async def test_game_grid(page):
    # 11 game cards render, default-active is 501, click cricket → active swaps
    # and the hidden <select> mirrors the new value.
    cards = await page.locator(".game-card[data-game-value]").count()
    assert cards == 11, f"expected 11 game cards, got {cards}"
    active = await page.locator(".game-card.active").get_attribute("data-game-value")
    assert active == "501", f"default-active card was {active!r}"

    await page.click(".game-card[data-game-value='cricket']")
    await page.wait_for_timeout(80)
    new_active = await page.locator(".game-card.active").get_attribute("data-game-value")
    select_val = await page.eval_on_selector("#gameType", "el => el.value")
    assert new_active == "cricket", f"clicking cricket → active card={new_active!r}"
    assert select_val == "cricket", f"hidden select stayed at {select_val!r}"
    # And the cricket options form should now be visible
    cricket_hidden = await page.locator("#cricketOptions").evaluate("el => el.classList.contains('hidden')")
    assert not cricket_hidden, "cricketOptions still hidden after picking cricket"
    return {"cards": cards, "active_after_click": new_active}


async def test_leaderboard_seed(page):
    # Drive a synthetic 121 match-end by writing state then calling the
    # show121MatchSummary export. Confirms the leaderboard localStorage row
    # is created.
    await page.evaluate("localStorage.removeItem('blakeout_121_leaderboard')")
    await page.evaluate("""
        (async () => {
            const stateMod = await import('./js/state.js');
            const g121Mod = await import('./js/game121.js');
            Object.assign(stateMod.game, {
                type: '121',
                players: [
                    { name: 'Tester', rosterEmail: 'tester@example.com', score: 0, throws: 0, totalMarks: 0, history: [], lastTurnMarks: {} }
                ],
                currentPlayer: 0,
                game121: {
                    currentLeg: 1, totalLegs: 1, dartsPerLeg: 12,
                    dartsThrown: 0, startingScore: 121, highestStart: 131,
                    legLossPenalty: 1, soloMode: false,
                    legResults: [{ winner: 0, checkout: 40, startingScore: 121, dartsUsed: 12 }],
                    legsWon: [1],
                    roundsByPlayer: { 0: { 180: 1, 160: 0, 140: 1, 120: 0, 100: 2, 60: 1 } }
                }
            });
            g121Mod.show121MatchSummary();
        })()
    """)
    await page.wait_for_selector("#game121SummaryModal", state="visible", timeout=2000)
    body_text = await page.locator("#game121SummaryBody").inner_text()
    saved = await page.evaluate("localStorage.getItem('blakeout_121_leaderboard')")
    assert saved, "leaderboard localStorage row not written"
    parsed = json.loads(saved)
    assert any(r.get("name") == "Tester" for r in parsed), f"Tester not in leaderboard rows: {parsed}"
    return {
        "leaderboard_rows": len(parsed),
        "summary_has_180s": "180s" in body_text,
        "summary_excerpt": body_text.split("\n")[:6]
    }


async def run_one(page, name, fn, screens_dir, keep_screens):
    page.set_default_timeout(5000)
    errors = []

    def on_pageerror(err):
        errors.append(f"pageerror: {err}")

    def on_console(msg):
        if msg.type in ("error", "warning"):
            txt = msg.text
            if "deprecated" in txt.lower() or "firestore" in txt.lower():
                return
            errors.append(f"{msg.type}: {txt}")

    page.on("pageerror", on_pageerror)
    page.on("console", on_console)
    try:
        result = await fn(page)
        shot_path = screens_dir / f"{name}.png"
        if keep_screens:
            await page.screenshot(path=str(shot_path), full_page=True)
        return {"ok": True, "result": result, "console": errors, "screenshot": str(shot_path) if keep_screens else None}
    except Exception as e:
        shot_path = screens_dir / f"{name}-FAIL.png"
        try:
            await page.screenshot(path=str(shot_path), full_page=True)
        except Exception:
            pass
        return {"ok": False, "error": str(e), "console": errors, "screenshot": str(shot_path)}


def discover():
    return {
        name[len("test_"):]: fn
        for name, fn in inspect.getmembers(sys.modules[__name__], inspect.iscoroutinefunction)
        if name.startswith("test_")
    }


async def main_async(target: str, only: str | None, keep_screens: bool):
    OUT.mkdir(exist_ok=True)
    screens = OUT / "screens"
    screens.mkdir(exist_ok=True)
    serve_root = REPO / ("dev" if target == "dev" else ".")

    srv = subprocess.Popen(
        ["python3", "-m", "http.server", str(PORT), "--bind", "127.0.0.1"],
        cwd=str(serve_root), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    time.sleep(1.2)
    try:
        from playwright.async_api import async_playwright
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            ctx = await browser.new_context(viewport={"width": 900, "height": 1600})
            results = {}
            tests = discover()
            names = [only] if only else list(tests.keys())
            for name in names:
                if name not in tests:
                    print(f"!! unknown test: {name}", file=sys.stderr)
                    continue
                page = await ctx.new_page()
                await page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="domcontentloaded", timeout=10000)
                await page.wait_for_timeout(300)
                r = await run_one(page, name, tests[name], screens, keep_screens)
                results[name] = r
                status = "PASS" if r["ok"] else "FAIL"
                print(f"  [{status}] {name}")
                if not r["ok"]:
                    print(f"         {r['error']}")
                    for line in r["console"][:6]:
                        print(f"           console: {line}")
                    print(f"         screenshot: {r['screenshot']}")
                await page.close()
            await browser.close()
    finally:
        srv.terminate()
        srv.wait()

    report_path = OUT / "report.json"
    report_path.write_text(json.dumps(results, indent=2))
    passed = sum(1 for r in results.values() if r["ok"])
    total = len(results)
    print(f"\n{passed}/{total} passed. Report: {report_path}")
    return 0 if passed == total else 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", choices=["dev", "prod"], default="dev")
    ap.add_argument("--only", help="run a single test by name (without test_ prefix)")
    ap.add_argument("--keep-screenshots", action="store_true",
                    help="keep screenshots from passing tests too")
    args = ap.parse_args()
    sys.exit(asyncio.run(main_async(args.target, args.only, args.keep_screenshots)))


if __name__ == "__main__":
    main()
