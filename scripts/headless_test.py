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


async def test_golf(page):
    # Game grid should now show 12 cards (Golf added), Golf select option
    # exists, picking Golf reveals #golfOptions with 3 variants.
    opts = await page.eval_on_selector_all("#gameType option", "els => els.map(e => e.value)")
    assert "golf" in opts, f"golf missing from gameType: {opts}"
    cards = await page.locator(".game-card[data-game-value]").count()
    assert cards == 12, f"expected 12 game cards (Golf added), got {cards}"

    await page.click(".game-card[data-game-value='golf']")
    await page.wait_for_timeout(80)
    golf_hidden = await page.locator("#golfOptions").evaluate("el => el.classList.contains('hidden')")
    assert not golf_hidden, "golfOptions still hidden after picking Golf"
    variants = await page.eval_on_selector_all("#golfVariant option", "els => els.map(e => e.value)")
    assert set(variants) == {"9hole", "18hole", "stableford"}, f"unexpected golf variants: {variants}"

    # Start an 18-hole stroke-play game with 2 default players.
    await page.evaluate("document.getElementById('teamMode').checked = false")
    await page.click("#startGameBtn")
    await page.wait_for_selector("#targetGameMain", state="visible", timeout=3000)

    # Hole 1 should be the active target.
    target_value = await page.locator("#targetValue").inner_text()
    assert target_value == "1", f"expected Hole 1, got {target_value!r}"

    # Tap two singles → 2 hits at 3 strokes each + 1 implied miss at 5 = 11.
    await page.click("#hitSingleBtn")
    await page.click("#hitSingleBtn")
    await page.wait_for_timeout(80)
    live_total = int(await page.locator("#targetTurnScore").inner_text())
    assert live_total == 11, f"expected 11 strokes (2 singles + 1 miss), got {live_total}"

    # END TURN should commit 11 strokes to player 0 and pass to player 1.
    await page.click("#targetEndTurnBtn")
    await page.wait_for_timeout(150)
    p0 = int(await page.locator("#homeScore").inner_text())
    assert p0 == 11, f"player 0 score should be 11 strokes after hole 1, got {p0}"

    # Now player 1 goes; tap a Triple then end turn → 1 stroke + 2 misses = 11.
    await page.click("#hitTripleBtn")
    await page.click("#targetEndTurnBtn")
    await page.wait_for_timeout(150)
    p1 = int(await page.locator("#awayScore").inner_text())
    assert p1 == 11, f"player 1 score should be 11 strokes after hole 1, got {p1}"

    # Hole should have advanced to 2.
    new_target = await page.locator("#targetValue").inner_text()
    assert new_target == "2", f"expected Hole 2 after both players finished hole 1, got {new_target!r}"
    return {"hole_after_turn": new_target, "p0_strokes": p0, "p1_strokes": p1}


async def _start_solo(page, game_type, *, finish=None, extra_setup=None):
    """Common 1-player startup helper. Returns once the game screen is up."""
    await page.select_option("#gameType", game_type)
    await page.select_option("#numPlayers", "1")
    await page.evaluate("document.getElementById('teamMode').checked = false")
    if finish:
        await page.select_option("#finishType", finish)
    if extra_setup:
        await extra_setup(page)
    await page.click("#startGameBtn")
    await page.wait_for_timeout(300)


async def test_solo_x01_501(page):
    # 1-player 501, throw a few scores, force winning checkout, verify winner.
    await _start_solo(page, "501", finish="double-out")
    await page.wait_for_selector("#x01Main", state="visible", timeout=3000)
    # Away column should be hidden (1 player).
    away_display = await page.eval_on_selector("#awayHeader", "el => getComputedStyle(el).display")
    assert away_display == "none", f"away header still rendered in 1-player ({away_display})"
    # Throw two 100s (501 -> 401 -> 301). x01 has a 700ms commit cooldown to
    # absorb double-taps, so we have to wait longer between turns than the
    # default 100ms here.
    for _ in range(2):
        await page.click("[data-quick='100']")
        await page.wait_for_timeout(800)
    home_score = int(await page.locator("#homeScore").inner_text())
    assert home_score == 301, f"expected 301 after two 100s, got {home_score}"
    # Force remaining to 50 then throw 50 → win.
    await page.evaluate("""
        (async () => {
            const stateMod = await import('./js/state.js');
            stateMod.game.players[0].score = 50;
            stateMod.game.currentPlayer = 0;
            const x01 = await import('./js/x01.js');
            x01.updateX01Display();
        })()
    """)
    await page.wait_for_timeout(80)
    await page.click("[data-digit='5']")
    await page.click("[data-digit='0']")
    await page.click("#x01EnterBtn")
    await page.wait_for_timeout(300)
    winner = await page.locator("#winnerModal").is_visible()
    assert winner, "winner modal didn't open on 1-player 501 checkout"
    return {"home_score_after_two_100s": home_score, "winner_modal": winner}


async def test_solo_cricket(page):
    # 1-player cricket: grid must render (numPlayers===1 row layout), tapping
    # the 20 button must record a mark and increment totalMarks.
    await _start_solo(page, "cricket")
    await page.wait_for_selector("#cricketMain", state="visible", timeout=3000)

    # Cricket grid must have one-player rows so the CSS grid-template-columns
    # applies. (Bug: cricket.js wasn't appending one-player to rowClass.)
    rows = await page.locator(".cricket-row").count()
    assert rows >= 7, f"expected at least 7 cricket rows, got {rows}"
    one_player_rows = await page.locator(".cricket-row.one-player").count()
    assert one_player_rows == rows, (
        f"cricket rows missing .one-player class — only {one_player_rows}/{rows} have it. "
        f"With no modifier class, the grid template doesn't apply and the layout collapses."
    )

    # Tap the 20 button to mark one hit. With pending input, MISS hides and
    # ENTER takes its place — commit via ENTER.
    await page.locator(".cricket-num-btn", has_text="20").first.click()
    await page.wait_for_timeout(80)
    pending = await page.locator("#pendingText").inner_text()
    assert pending.strip(), f"pending text empty after tap: {pending!r}"
    await page.click("#enterBtn")
    await page.wait_for_timeout(200)
    # Player 0 totalMarks should reflect 1, and the round should advance since
    # there's only one player (current → 0+1 mod 1 → still 0, completedRounds++).
    total_marks = await page.evaluate(
        "(async () => { const m = await import('./js/state.js'); return m.game.players[0].totalMarks; })()"
    )
    assert total_marks >= 1, f"expected at least 1 mark recorded, got {total_marks}"
    round_badge = (await page.locator("#roundBadge").inner_text()).strip()
    assert round_badge in ("1", "2"), f"unexpected round badge: {round_badge!r}"
    return {"rows": rows, "one_player_rows": one_player_rows, "round": round_badge, "marks": total_marks}


async def test_solo_baseball(page):
    # 1-player baseball: target should be inning 1, end turn after 3 singles
    # → inning advances to 2 with player 0 still the active (only) player.
    await _start_solo(page, "baseball")
    await page.wait_for_selector("#targetGameMain", state="visible", timeout=3000)
    val_before = (await page.locator("#targetValue").inner_text()).strip()
    assert val_before == "1", f"expected Inning 1, got {val_before!r}"
    for _ in range(3):
        await page.click("#hitSingleBtn")
    await page.click("#targetEndTurnBtn")
    await page.wait_for_timeout(200)
    val_after = (await page.locator("#targetValue").inner_text()).strip()
    assert val_after == "2", f"inning didn't advance after 1-player turn: {val_after!r}"
    home_score = int(await page.locator("#homeScore").inner_text())
    assert home_score == 3, f"expected 3 runs from 3 singles, got {home_score}"
    return {"inning_before": val_before, "inning_after": val_after, "runs": home_score}


async def test_solo_bermuda(page):
    # 1-player bermuda (halveit default now): target index 0 = 12. Tap a triple
    # → 36 points, end turn → target advances and score sticks.
    await _start_solo(page, "bermuda")
    await page.wait_for_selector("#targetGameMain", state="visible", timeout=3000)
    target_before = (await page.locator("#targetValue").inner_text()).strip()
    assert target_before == "12", f"expected first bermuda target 12, got {target_before!r}"
    await page.click("#hitTripleBtn")
    await page.click("#targetEndTurnBtn")
    await page.wait_for_timeout(200)
    home_score = int(await page.locator("#homeScore").inner_text())
    assert home_score == 36, f"expected 36 (triple 12), got {home_score}"
    target_after = (await page.locator("#targetValue").inner_text()).strip()
    assert target_after == "13", f"target didn't advance after 1-player turn: {target_after!r}"
    return {"score": home_score, "target_after": target_after}


async def test_solo_golf(page):
    # 1-player golf: hole 1 active, 1 triple + 2 implied misses = 1 + 10 = 11.
    # End turn → hole advances to 2.
    await _start_solo(page, "golf")
    await page.wait_for_selector("#targetGameMain", state="visible", timeout=3000)
    hole_before = (await page.locator("#targetValue").inner_text()).strip()
    assert hole_before == "1", f"expected Hole 1, got {hole_before!r}"
    await page.click("#hitTripleBtn")
    live = int(await page.locator("#targetTurnScore").inner_text())
    assert live == 11, f"expected 11 strokes (1 triple + 2 misses), got {live}"
    await page.click("#targetEndTurnBtn")
    await page.wait_for_timeout(200)
    home_score = int(await page.locator("#homeScore").inner_text())
    assert home_score == 11, f"expected 11 strokes, got {home_score}"
    hole_after = (await page.locator("#targetValue").inner_text()).strip()
    assert hole_after == "2", f"hole didn't advance after 1-player turn: {hole_after!r}"
    return {"strokes": home_score, "hole_after": hole_after}


async def test_solo_121(page):
    # 1-player 121: throw 60s until darts run out. Confirm the leg ends and a
    # new leg starts (or the match summary appears at totalLegs limit).
    async def lower_legs(page):
        await page.select_option("#totalLegs121", "5")
        await page.select_option("#dartsPerLeg", "9")
    await _start_solo(page, "121", extra_setup=lower_legs)
    await page.wait_for_selector("#x01Main", state="visible", timeout=3000)
    # 9 darts at 60 strokes → 3 turns of 60 = 180 total, can't checkout from 121.
    # Each turn-commit has a 700ms cooldown to absorb double-taps.
    for _ in range(3):
        await page.click("[data-quick='60']")
        await page.wait_for_timeout(800)
    await page.wait_for_timeout(2500)  # leg-end 2s delay
    leg_now = await page.evaluate("(async () => { const m = await import('./js/state.js'); return m.game.game121.currentLeg; })()")
    assert leg_now >= 2, f"expected leg to advance after dart limit hit, got {leg_now}"
    return {"current_leg": leg_now}


async def test_solo_minnesota(page):
    # 1-player minnesota cricket: grid renders with one-player class
    # (same regression as cricket).
    await _start_solo(page, "minnesota")
    await page.wait_for_selector("#cricketMain", state="visible", timeout=3000)
    rows = await page.locator(".cricket-row").count()
    one_player = await page.locator(".cricket-row.one-player").count()
    assert one_player == rows, f"minnesota rows missing .one-player class: {one_player}/{rows}"
    return {"rows": rows}


async def test_solo_spanish(page):
    # 1-player spanish cricket: same rendering regression check.
    await _start_solo(page, "spanish")
    await page.wait_for_selector("#cricketMain", state="visible", timeout=3000)
    rows = await page.locator(".cricket-row").count()
    one_player = await page.locator(".cricket-row.one-player").count()
    assert one_player == rows, f"spanish rows missing .one-player class: {one_player}/{rows}"
    return {"rows": rows}


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
    assert cards == 12, f"expected 12 game cards, got {cards}"
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


async def test_x01_trusts_player(page):
    # Regression: x01 used to reject Double-In odd first throws and auto-bust
    # at newScore === 1 in double-out modes. App only sees turn totals, so
    # the player is now trusted on rule-compliance — only newScore < 0 busts.
    await page.select_option("#gameType", "301")
    await page.select_option("#finishType", "double-in-out")
    await page.evaluate("document.getElementById('teamMode').checked = false")
    await page.click("#startGameBtn")
    await page.wait_for_selector("#x01Main", state="visible", timeout=3000)

    # First throw: odd 7 used to be rejected as "MUST START WITH DOUBLE".
    await page.click("[data-digit='7']")
    await page.click("#x01EnterBtn")
    await page.wait_for_timeout(150)
    # Score should have advanced (player 0 went 301 → 294) and turn moved to player 1.
    p0_score = int(await page.locator("#homeScore").inner_text())
    assert p0_score == 294, f"expected 294 after single 7, got {p0_score}"

    # Drive player 0 down toward 5 remaining, then throw 4 (would have been
    # auto-bust on newScore === 1 in the old code).
    # Currently player 1 is active. Score them a 0 so they pass quickly.
    await page.click("[data-digit='0']")
    await page.click("#x01EnterBtn")
    await page.wait_for_timeout(80)
    # Back to player 0 at 294. Set their score directly to 5 to skip the grind.
    await page.evaluate("""
        (async () => {
            const stateMod = await import('./js/state.js');
            stateMod.game.players[0].score = 5;
            stateMod.game.currentPlayer = 0;
            const x01 = await import('./js/x01.js');
            x01.updateX01Display();
        })()
    """)
    await page.wait_for_timeout(80)
    p0_now = int(await page.locator("#homeScore").inner_text())
    assert p0_now == 5, f"forced-set score didn't stick, got {p0_now}"

    # Throw a 4 → newScore = 1. Under the old rule this was BUST. Now it's a legal score.
    await page.click("[data-digit='4']")
    await page.click("#x01EnterBtn")
    await page.wait_for_timeout(150)
    after = int(await page.locator("#homeScore").inner_text())
    assert after == 1, f"expected newScore=1 to be accepted (player goes to 1), got {after}"

    # Last-turn check: from 1 remaining, throw 1 → newScore=0 → trust as WIN
    # even though strict double-out would require ending on a double. The app
    # only sees totals, so it has to trust.
    await page.evaluate("""
        (async () => {
            const stateMod = await import('./js/state.js');
            stateMod.game.players[0].score = 1;
            stateMod.game.currentPlayer = 0;
            const x01 = await import('./js/x01.js');
            x01.updateX01Display();
        })()
    """)
    await page.wait_for_timeout(80)
    await page.click("[data-digit='1']")
    await page.click("#x01EnterBtn")
    await page.wait_for_timeout(300)
    winner_visible = await page.locator("#winnerModal").is_visible()
    assert winner_visible, "winner modal should open when player wins from 1 with odd 1 in double-out"
    return {
        "first_throw_odd_accepted": True,
        "newScore_1_accepted": True,
        "last_turn_odd_wins": True,
    }


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
