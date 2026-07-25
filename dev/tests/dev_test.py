#!/usr/bin/env python3
"""
BlakeOut DEV regression and layout test battery (v2.4-dev).

Lives under /dev/tests/ — tests the dev build only. Modeled on
scripts/headless_test.py but covers the v2.3 overhaul features:

    registry_picker    — all game cards render from registry, search filters,
                         category chips filter, hidden select syncs
    favorites_recents  — star toggles favorites, favorites chip appears,
                         recents recorded after a game start
    chaos_cricket      — random board: 6 unique numbers + Bull, shared across
                         players, marks/scoring work, play-again re-rolls
    shanghai           — round targets advance, face×multiplier scoring,
                         S+D+T instant win
    shanghai_no_win    — normal completion path: highest score wins round 7
    themes             — all 12 swatches render and apply, persist to storage
    play_again_target  — regression: Play Again after a baseball game
                         restarts baseball correctly (was broken)
    resume_target_game — regression: baseball state survives save/restore
    core_cricket       — no regression: standard cricket scoring flow
    core_x01           — no regression: 501 scoring + winner modal
    setup_throw_order  — drag, arrow, randomize, match/play-again order
    team_throw_order   — within-team drag/randomize + first-team order
    multiplayer_score_visibility — 3/4-player scores across phones,
                         tablets, orientations and UI-scale extremes
    multiplayer_cricket_grid_fit — compact max-scale cricket variants

Usage:
    python3 dev/tests/dev_test.py                # run all
    python3 dev/tests/dev_test.py --only themes  # single test
"""

import argparse, asyncio, inspect, json, subprocess, sys, time
from pathlib import Path

DEV_ROOT = Path(__file__).resolve().parent.parent   # .../blakeout/dev
OUT = Path("/tmp/blakeout_dev_test")
PORT = 8823


# ---------------------------------------------------------------- helpers

async def fresh(page):
    """Clear storage so onboarding/favorites tests start clean."""
    await page.evaluate("localStorage.clear()")
    await page.reload(wait_until="domcontentloaded")
    await page.wait_for_timeout(300)


async def dismiss_onboard(page):
    # Max Visibility feature removed — kept as a no-op shim so tests that
    # call it don't all need editing. Safe to delete once nothing calls it.
    return


async def start_game(page, game_type, num_players="2"):
    await page.select_option("#gameType", game_type)
    await page.select_option("#numPlayers", num_players)
    await page.evaluate("document.getElementById('teamMode').checked = false")
    await page.click("#startGameBtn")
    await page.wait_for_timeout(300)


async def get_state(page, expr):
    return await page.evaluate(
        f"(async () => {{ const m = await import('./js/state.js'); return {expr}; }})()"
    )


async def set_ui_scale(page, value):
    await page.evaluate(
        """value => {
            const slider = document.getElementById('uiScale');
            slider.value = String(value);
            slider.dispatchEvent(new Event('input', { bubbles: true }));
        }""",
        value,
    )


async def drag_locator_to(page, source, target, target_y_ratio=0.5):
    source_box = await source.bounding_box()
    target_box = await target.bounding_box()
    assert source_box and target_box, "drag source/target must be visible"
    sx = source_box["x"] + source_box["width"] / 2
    sy = source_box["y"] + source_box["height"] / 2
    tx = target_box["x"] + target_box["width"] / 2
    ty = target_box["y"] + target_box["height"] * target_y_ratio
    await page.mouse.move(sx, sy)
    await page.mouse.down()
    await page.mouse.move((sx + tx) / 2, (sy + ty) / 2, steps=4)
    await page.mouse.move(tx, ty, steps=4)
    await page.mouse.up()
    await page.wait_for_timeout(120)


# ---------------------------------------------------------------- tests

async def test_registry_picker(page):
    await dismiss_onboard(page)
    # Registry card count grows deliberately as game batches land.
    cards = await page.locator(".game-card[data-game-value]").count()
    assert cards == 29, f"expected 29 game cards, got {cards}"

    # New games present
    for gid in ("chaos", "shanghai", "901", "1101", "1501", "countup",
                "quickie", "cutthroat", "wildcard", "gotcha", "hammer", "teamhammer",
                "sharktank", "tictactoe", "robinhood", "doubledown", "teamcricket"):
        n = await page.locator(f".game-card[data-game-value='{gid}']").count()
        assert n == 1, f"{gid} card missing"

    # Search filters
    await page.fill("#gameSearchInput", "shang")
    await page.wait_for_timeout(100)
    visible = await page.locator(".game-card[data-game-value]").count()
    assert visible == 1, f"search 'shang' should leave 1 card, got {visible}"
    await page.fill("#gameSearchInput", "")
    await page.wait_for_timeout(100)

    # Category chips filter
    await page.click(".picker-chip[data-category='cricket']")
    await page.wait_for_timeout(100)
    cricket_cards = await page.eval_on_selector_all(
        ".game-card[data-game-value]", "els => els.map(e => e.dataset.gameValue)")
    assert set(cricket_cards) == {
        "cricket", "spanish", "minnesota", "chaos",
        "quickie", "cutthroat", "wildcard", "hammer", "teamhammer", "doubledown",
        "teamcricket"
    }, \
        f"cricket category shows {cricket_cards}"
    await page.click(".picker-chip[data-category='all']")
    await page.wait_for_timeout(100)

    # Selecting a card syncs the hidden select and shows the right options
    await page.click(".game-card[data-game-value='shanghai']")
    await page.wait_for_timeout(100)
    sel = await page.eval_on_selector("#gameType", "el => el.value")
    assert sel == "shanghai", f"hidden select = {sel!r}"
    sh_hidden = await page.locator("#shanghaiOptions").evaluate(
        "el => el.classList.contains('hidden')")
    assert not sh_hidden, "shanghaiOptions hidden after picking shanghai"
    return {"cards": cards}


async def test_long_x01_starts(page):
    # Long X01 modes are registry-driven but must initialize at their full
    # four-digit score and still subtract turns normally.
    starts = {}
    for game_type in ("901", "1101", "1501"):
        await page.evaluate("localStorage.removeItem('blakeout_active_game')")
        await page.reload(wait_until="domcontentloaded")
        await page.wait_for_timeout(250)
        await start_game(page, game_type, num_players="4")
        scores = await get_state(page, "m.game.players.map(p => p.score)")
        expected = int(game_type)
        assert scores == [expected] * 4, f"{game_type} starts = {scores}"
        visible = [
            int(await page.locator(f"#{score_id}").inner_text())
            for score_id in ("homeScore", "awayScore", "player3Score", "player4Score")
        ]
        assert visible == scores, f"{game_type} header = {visible}"
        await page.click("[data-quick='180']")
        await page.wait_for_timeout(800)
        after = await get_state(page, "m.game.players[0].score")
        assert after == expected - 180, f"{game_type} after 180 = {after}"
        starts[game_type] = after
    return {"after_180": starts}


async def test_count_up(page):
    # Count Up reuses the numeric turn-total pad but adds scores for exactly
    # eight rounds, hides X01-only controls, supports ties, and persists.
    await fresh(page)
    await start_game(page, "countup", num_players="2")
    await page.wait_for_selector("#x01Main", state="visible", timeout=3000)
    scores = await get_state(page, "m.game.players.map(p => p.score)")
    assert scores == [0, 0], scores
    assert not await page.locator("#x01BustBtn").is_visible(), "BUST is not valid in Count Up"
    assert not await page.locator("#checkoutSuggestion").is_visible(), "checkout hint leaked into Count Up"
    indicator = (await page.locator("#finishIndicator").inner_text()).strip()
    assert "ROUND 1 OF 8" in indicator, indicator

    await page.click("[data-quick='100']")
    await page.wait_for_timeout(800)
    first = await get_state(page, "m.game.players[0].score")
    assert first == 100, f"Count Up should add 100, got {first}"
    stored = await page.evaluate(
        "JSON.parse(localStorage.getItem('blakeout_active_game')).players[0].score")
    assert stored == 100, f"committed Count Up turn not persisted: {stored}"

    # Put both players at their final turn. P1 reaches 180; P2 ties it, so
    # the winner modal should name both and no phantom round 9 should render.
    await page.evaluate("""
        (async () => {
            const s = await import('./js/state.js');
            s.game.completedRounds = 7;
            s.game.currentPlayer = 0;
            s.game.players[0].score = 120;
            s.game.players[1].score = 140;
            s.game.players[0].history = Array(7).fill(0);
            s.game.players[1].history = Array(7).fill(0);
            (await import('./js/x01.js')).updateX01Display();
        })()
    """)
    await page.click("[data-quick='60']")
    await page.wait_for_timeout(800)
    await page.click("[data-quick='40']")
    await page.wait_for_timeout(800)
    assert await page.locator("#winnerModal").is_visible(), "Count Up did not end after round 8"
    winner = (await page.locator("#winnerName").inner_text()).strip()
    assert "Home" in winner and "Away" in winner, f"tie winners = {winner!r}"
    final = await get_state(page, "({scores:m.game.players.map(p=>p.score), rounds:m.game.completedRounds})")
    assert final == {"scores": [180, 180], "rounds": 8}, final
    rounds = await page.locator("#roundNumCol .round-number").count()
    assert rounds == 8, f"phantom Count Up round rendered: {rounds}"
    await page.click("#playAgainBtn")
    await page.wait_for_timeout(400)
    replay = await get_state(page, "({scores:m.game.players.map(p=>p.score), rounds:m.game.completedRounds})")
    assert replay == {"scores": [0, 0], "rounds": 0}, replay
    return {"first_turn": first, "final": final, "winner": winner}


async def test_gotcha(page):
    # Gotcha is a 2–4 player race to exactly 301. Matching a live opponent
    # bombs them to zero; overshooting penalizes the pre-turn score and never
    # bombs; exact entry wins.
    await fresh(page)
    await page.select_option("#numPlayers", "1")
    await page.select_option("#gameType", "gotcha")
    await page.wait_for_timeout(100)
    assert await page.input_value("#numPlayers") == "2", "Gotcha must require 2+ players"
    await page.click("#startGameBtn")
    await page.wait_for_selector("#x01Main", state="visible", timeout=3000)
    assert not await page.locator("#x01BustBtn").is_visible(), "BUST should hide in Gotcha"

    # Away lands exactly on Home's 40 and bombs Home back to zero.
    await page.evaluate("""
        (async () => {
            const state = await import('./js/state.js');
            state.game.players[0].score = 40;
            state.game.players[1].score = 20;
            state.game.currentPlayer = 1;
            (await import('./js/x01.js')).updateX01Display();
        })()
    """)
    for digit in "20":
        await page.click(f"[data-digit='{digit}']")
    await page.click("#x01EnterBtn")
    await page.wait_for_timeout(800)
    bombed = await get_state(page, "m.game.players.map(p => p.score)")
    entry = await get_state(page, "m.game.players[1].history.at(-1)")
    assert bombed == [0, 40], f"Gotcha bomb scores = {bombed}"
    assert entry.get("bombed") == ["Home"], f"bomb history = {entry}"

    # Home at 276 throws 50: 25 over, so 25 is deducted from the original
    # 276 -> 251. Away already has 251 but overshoots never bomb.
    await page.evaluate("""
        (async () => {
            const state = await import('./js/state.js');
            state.game.players[0].score = 276;
            state.game.players[1].score = 251;
            state.game.currentPlayer = 0;
            (await import('./js/x01.js')).updateX01Display();
        })()
    """)
    for digit in "50":
        await page.click(f"[data-digit='{digit}']")
    await page.click("#x01EnterBtn")
    await page.wait_for_timeout(800)
    rebounded = await get_state(page, "m.game.players.map(p => p.score)")
    over_entry = await get_state(page, "m.game.players[0].history.at(-1)")
    assert rebounded == [251, 251], f"Gotcha overshoot = {rebounded}"
    assert over_entry.get("overshoot") == 25 and not over_entry.get("bombed"), over_entry

    # Away needs 20 and reaches exactly 301.
    await page.evaluate("""
        (async () => {
            const state = await import('./js/state.js');
            state.game.players[1].score = 281;
            state.game.currentPlayer = 1;
            (await import('./js/x01.js')).updateX01Display();
        })()
    """)
    for digit in "20":
        await page.click(f"[data-digit='{digit}']")
    await page.click("#x01EnterBtn")
    await page.wait_for_timeout(500)
    assert await page.locator("#winnerModal").is_visible(), "exact 301 did not win Gotcha"
    winner = (await page.locator("#winnerName").inner_text()).strip()
    assert winner == "Away", winner
    stored = await page.evaluate(
        "JSON.parse(localStorage.getItem('blakeout_active_game')).players[1].score")
    assert stored == 301, f"Gotcha win not persisted: {stored}"
    await page.click("#playAgainBtn")
    await page.wait_for_timeout(400)
    replay = await get_state(page, "m.game.players.map(p=>p.score)")
    assert replay == [0, 0], replay
    return {"bombed": bombed, "overshoot": rebounded, "winner": winner}


async def test_hammer_cricket(page):
    # Dart positions matter: miss, single 20, triple 20 = 0 + 40 + 180.
    # An all-miss turn drops the hammer (-triple target), target-stage undo
    # restores round state, and round 8 uses ×1/×3/×5.
    await fresh(page)
    await start_game(page, "hammer", num_players="2")
    await page.wait_for_selector("#targetGameMain", state="visible", timeout=3000)
    target = (await page.locator("#targetValue").inner_text()).strip()
    assert target == "20", target
    assert await page.locator("#targetMissDartBtn").is_visible(), "Hammer needs explicit misses"

    await page.click("#targetMissDartBtn")
    await page.click("#hitSingleBtn")
    await page.click("#hitTripleBtn")
    live = int(await page.locator("#targetTurnScore").inner_text())
    assert live == 220, f"Hammer weighted turn = {live}"
    await page.click("#targetEndTurnBtn")
    await page.wait_for_timeout(250)
    p0 = await get_state(page, "m.game.players[0].score")
    assert p0 == 220, p0

    # Away records no hits: 3 × target 20 is subtracted.
    await page.click("#targetEndTurnBtn")
    await page.wait_for_timeout(250)
    state = await get_state(page, "({scores:m.game.players.map(p=>p.score), round:m.game.hammer.round})")
    assert state == {"scores": [220, -60], "round": 2}, state
    assert (await page.locator("#targetValue").inner_text()).strip() == "19"
    assert (await page.locator("#roundBadge").inner_text()).strip() == "2"

    # Cross-turn undo must restore both scores and Hammer's target round.
    await page.click("#targetUndoBtn")
    await page.wait_for_timeout(150)
    undone = await get_state(
        page, "({scores:m.game.players.map(p=>p.score), round:m.game.hammer.round, current:m.game.currentPlayer})")
    assert undone == {"scores": [220, 0], "round": 1, "current": 1}, undone
    assert (await page.locator("#targetValue").inner_text()).strip() == "20"

    # Final-round singles at target 15: 15×1 + 15×3 + 15×5 = 135.
    await page.evaluate("""
        (async () => {
            const state = await import('./js/state.js');
            state.game.hammer.round = 8;
            state.game.hammer.targets[7] = 15;
            state.game.currentPlayer = 0;
            (await import('./js/target_game.js')).updateTargetGameDisplay();
        })()
    """)
    for _ in range(3):
        await page.click("#hitSingleBtn")
    final_live = int(await page.locator("#targetTurnScore").inner_text())
    assert final_live == 135, f"Hammer final weights = {final_live}"
    await page.evaluate("(async () => (await import('./js/setup.js')).playAgain())()")
    await page.wait_for_timeout(350)
    replay = await get_state(page, "({scores:m.game.players.map(p=>p.score), round:m.game.hammer.round})")
    assert replay == {"scores": [0, 0], "round": 1}, replay
    return {"weighted": live, "hammer_drop": state["scores"][1], "final_weighted": final_live}


async def test_team_hammer(page):
    # Team Hammer forces team mode and exactly two throwers per side. Scores
    # and hammer penalties belong to the team while member rotation advances.
    await fresh(page)
    await page.select_option("#gameType", "teamhammer")
    await page.wait_for_timeout(100)
    assert await page.locator("#teamMode").is_checked(), "Team Hammer should force Team Mode"
    assert await page.locator("#teamMode").is_disabled(), "forced Team Mode should not be switchable"
    await page.click("#startGameBtn")
    await page.wait_for_selector("#teamBuilderScreen", state="visible")

    for name in ("Alpha", "Bravo", "Charlie", "Delta"):
        await page.fill("#teamAddName", name)
        await page.click("#teamAddBtn")

    async def assign(name, zone):
        await page.locator(".team-chip", has_text=name).click()
        await page.click(f"#teamZone{zone}Label")

    await assign("Alpha", 0)
    await assign("Charlie", 1)
    assert await page.locator("#teamStartMatchBtn").is_disabled(), "1v1 must not start Team Hammer"
    await assign("Bravo", 0)
    await assign("Delta", 1)
    assert await page.locator("#teamStartMatchBtn").is_enabled(), "2v2 should enable Team Hammer"
    await page.click("#teamStartMatchBtn")
    await page.wait_for_timeout(300)

    teams = await get_state(page, "m.game.teams")
    assert [len(team["members"]) for team in teams] == [2, 2], teams
    await page.click("#hitSingleBtn")
    await page.click("#targetMissDartBtn")
    await page.click("#targetMissDartBtn")
    await page.click("#targetEndTurnBtn")
    await page.wait_for_timeout(250)
    after_home = await get_state(
        page, "({scores:m.game.players.map(p=>p.score), rotations:m.game.teams.map(t=>t.rotationIndex)})")
    assert after_home == {"scores": [20, 0], "rotations": [1, 0]}, after_home

    await page.click("#targetEndTurnBtn")
    await page.wait_for_timeout(250)
    after_away = await get_state(
        page, "({scores:m.game.players.map(p=>p.score), rotations:m.game.teams.map(t=>t.rotationIndex)})")
    assert after_away == {"scores": [20, -60], "rotations": [1, 1]}, after_away
    original_members = await get_state(page, "m.game.teams.map(t=>t.members.map(m=>m.name))")
    await page.evaluate("(async () => (await import('./js/setup.js')).playAgain())()")
    await page.wait_for_timeout(350)
    replay = await get_state(
        page, "({scores:m.game.players.map(p=>p.score), rotations:m.game.teams.map(t=>t.rotationIndex), members:m.game.teams.map(t=>t.members.map(m=>m.name)), round:m.game.hammer.round})")
    assert replay == {"scores": [0, 0], "rotations": [0, 0], "members": original_members, "round": 1}, replay
    return {"teams": [len(team["members"]) for team in teams], "after_round": after_away}


async def test_target_game_team_rotation(page):
    # Team rotation is centralized for every target engine, including older
    # Baseball/Bermuda/Golf/Shanghai modes. History records the real thrower.
    await fresh(page)
    await page.select_option("#gameType", "baseball")
    await page.check("#teamMode")
    await page.click("#startGameBtn")
    await page.wait_for_selector("#teamBuilderScreen", state="visible")
    for name in ("Alpha", "Bravo", "Charlie", "Delta"):
        await page.fill("#teamAddName", name)
        await page.click("#teamAddBtn")
    for name, zone in (("Alpha", 0), ("Bravo", 0), ("Charlie", 1), ("Delta", 1)):
        await page.locator(".team-chip", has_text=name).click()
        await page.click(f"#teamZone{zone}Label")
    await page.click("#teamStartMatchBtn")
    await page.wait_for_timeout(300)

    await page.click("#hitSingleBtn")
    await page.click("#targetEndTurnBtn")
    await page.wait_for_timeout(200)
    home = await get_state(
        page, "({rotation:m.game.teams[0].rotationIndex, thrower:m.game.players[0].history.at(-1).thrower})")
    assert home == {"rotation": 1, "thrower": "Alpha"}, home

    await page.click("#targetEndTurnBtn")
    await page.wait_for_timeout(200)
    away = await get_state(
        page, "({rotation:m.game.teams[1].rotationIndex, thrower:m.game.players[1].history.at(-1).thrower})")
    assert away == {"rotation": 1, "thrower": "Charlie"}, away
    next_thrower = (await page.locator("#homeThrower").inner_text()).strip()
    assert "Bravo" in next_thrower, next_thrower
    return {"home": home, "away": away, "next": next_thrower}


async def test_shark_tank(page):
    # A tied top score bites every surfer once. A unique leader is safe;
    # players at half or less take two bites. Six bites eliminates and the
    # final survivor wins.
    await fresh(page)
    await start_game(page, "sharktank", num_players="3")
    await page.wait_for_selector("#x01Main", state="visible", timeout=3000)
    headers = [
        int(await page.locator(f"#{score_id}").inner_text())
        for score_id in ("homeScore", "awayScore", "player3Score")
    ]
    assert headers == [6, 6, 6], f"Shark lives header = {headers}"
    assert not await page.locator("#x01BustBtn").is_visible(), "BUST should hide in Shark Tank"

    # Home and Away tie at 100; Player 3 has 40. Everyone takes one bite.
    await page.click("[data-quick='100']")
    await page.wait_for_timeout(800)
    await page.click("[data-quick='100']")
    await page.wait_for_timeout(800)
    await page.click("[data-quick='40']")
    await page.wait_for_timeout(800)
    tied = await get_state(
        page, "({bites:m.game.sharkTank.bites, round:m.game.sharkTank.round, current:m.game.currentPlayer})")
    assert tied == {"bites": [1, 1, 1], "round": 2, "current": 0}, tied
    tied_headers = [
        int(await page.locator(f"#{score_id}").inner_text())
        for score_id in ("homeScore", "awayScore", "player3Score")
    ]
    assert tied_headers == [5, 5, 5], tied_headers

    # Put rivals near elimination. Home's 100 is double Away's 50 (2 bites)
    # but not double Player 3's 60 (1 bite): both reach six, Home survives.
    await page.evaluate("""
        (async () => {
            const state = await import('./js/state.js');
            state.game.sharkTank.bites = [0, 4, 5];
            state.game.sharkTank.eliminated = [false, false, false];
            state.game.sharkTank.roundScores = [null, null, null];
            state.game.currentPlayer = 0;
            (await import('./js/x01.js')).updateX01Display();
        })()
    """)
    await page.click("[data-quick='100']")
    await page.wait_for_timeout(800)
    for digit in "50":
        await page.click(f"[data-digit='{digit}']")
    await page.click("#x01EnterBtn")
    await page.wait_for_timeout(800)
    await page.click("[data-quick='60']")
    await page.wait_for_timeout(500)

    assert await page.locator("#winnerModal").is_visible(), "last Shark Tank surfer did not win"
    winner = (await page.locator("#winnerName").inner_text()).strip()
    assert winner == "Home", winner
    final = await get_state(
        page, "({bites:m.game.sharkTank.bites, eliminated:m.game.sharkTank.eliminated})")
    assert final == {"bites": [0, 6, 6], "eliminated": [False, True, True]}, final
    stored = await page.evaluate(
        "JSON.parse(localStorage.getItem('blakeout_active_game')).sharkTank.bites")
    assert stored == [0, 6, 6], f"Shark Tank state not persisted: {stored}"
    await page.click("#playAgainBtn")
    await page.wait_for_timeout(400)
    replay = await get_state(page, "({bites:m.game.sharkTank.bites, eliminated:m.game.sharkTank.eliminated})")
    assert replay == {"bites": [0, 0, 0], "eliminated": [False, False, False]}, replay
    return {"tie_round": tied, "final": final, "winner": winner}


async def test_tic_tac_toe(page):
    # Two-player board: center Bull, 8 unique random numbers, four marks to
    # claim, S/D/T mark values, and first three-in-a-row wins.
    await fresh(page)
    await page.select_option("#numPlayers", "4")
    await page.select_option("#gameType", "tictactoe")
    await page.wait_for_timeout(100)
    assert await page.input_value("#numPlayers") == "2", "Tic Tac Toe must force two players"
    await page.click("#startGameBtn")
    await page.wait_for_selector("#ticTacToeMain", state="visible", timeout=3000)

    targets = await get_state(page, "m.game.ticTacToe.targets")
    assert len(targets) == 9 and targets[4] == "Bull", targets
    numbers = [int(value) for index, value in enumerate(targets) if index != 4]
    assert len(set(numbers)) == 8 and all(1 <= value <= 20 for value in numbers), targets
    assert await page.locator(".tic-cell").count() == 9

    # Triple + Single on square 0 claims it for Home.
    await page.click("[data-tic-mult='3']")
    await page.click("[data-tic-cell='0']")
    await page.click("[data-tic-mult='1']")
    await page.click("[data-tic-cell='0']")
    preview = await page.locator("[data-tic-cell='0'] .tic-x").inner_text()
    assert "4/4" in preview, preview
    await page.click("#ticEndTurnBtn")
    await page.wait_for_timeout(250)
    owner = await get_state(page, "m.game.ticTacToe.cells[0].owner")
    assert owner == 0, owner
    stored_owner = await page.evaluate(
        "JSON.parse(localStorage.getItem('blakeout_active_game')).ticTacToe.cells[0].owner")
    assert stored_owner == 0, stored_owner

    # Arrange Home one claimed square away from top-row victory, then claim
    # square 2 with Double+Double.
    await page.evaluate("""
        (async () => {
            const state = await import('./js/state.js');
            state.game.currentPlayer = 0;
            state.game.ticTacToe.cells[0].owner = 0;
            state.game.ticTacToe.cells[0].marks[0] = 4;
            state.game.ticTacToe.cells[1].owner = 0;
            state.game.ticTacToe.cells[1].marks[0] = 4;
            (await import('./js/tictactoe.js')).updateTicTacToeDisplay();
        })()
    """)
    await page.click("[data-tic-mult='2']")
    await page.click("[data-tic-cell='2']")
    await page.click("[data-tic-cell='2']")
    await page.click("#ticEndTurnBtn")
    await page.wait_for_timeout(300)
    assert await page.locator("#winnerModal").is_visible(), "Tic Tac Toe line did not win"
    winner = (await page.locator("#winnerName").inner_text()).strip()
    assert winner == "Home", winner
    owners = await get_state(page, "m.game.ticTacToe.cells.slice(0,3).map(c=>c.owner)")
    assert owners == [0, 0, 0], owners
    await page.click("#playAgainBtn")
    await page.wait_for_timeout(400)
    replay_owners = await get_state(page, "m.game.ticTacToe.cells.map(c=>c.owner)")
    assert replay_owners == [None] * 9, replay_owners
    return {"targets": targets, "winner": winner, "top_row": owners}


async def test_robin_hood(page):
    # Bulls score the official high values (100/200), triples are disabled,
    # and the highest total after every player finishes round 10 wins.
    await fresh(page)
    await start_game(page, "robinhood", num_players="2")
    await page.wait_for_selector("#targetGameMain", state="visible", timeout=3000)
    assert (await page.locator("#targetValue").inner_text()).strip() == "Bull"
    assert await page.locator("#hitTripleBtn").is_disabled(), "Robin Hood has no triple Bull"

    await page.click("#hitSingleBtn")
    await page.click("#hitDoubleBtn")
    live = int(await page.locator("#targetTurnScore").inner_text())
    assert live == 300, f"Robin Hood bull total = {live}"
    await page.click("#targetEndTurnBtn")
    await page.wait_for_timeout(250)
    assert await get_state(page, "m.game.players[0].score") == 300

    # Final player, final round. Away adds 200 but remains below Home.
    await page.evaluate("""
        (async () => {
            const state = await import('./js/state.js');
            state.game.robinHood.round = 10;
            state.game.completedRounds = 9;
            state.game.currentPlayer = 1;
            state.game.players[0].score = 500;
            state.game.players[1].score = 200;
            (await import('./js/target_game.js')).updateTargetGameDisplay();
        })()
    """)
    await page.click("#hitDoubleBtn")
    await page.click("#targetEndTurnBtn")
    await page.wait_for_timeout(300)
    assert await page.locator("#winnerModal").is_visible(), "Robin Hood did not finish round 10"
    winner = (await page.locator("#winnerName").inner_text()).strip()
    assert winner == "Home", winner
    state = await get_state(
        page, "({scores:m.game.players.map(p=>p.score), rounds:m.game.completedRounds})")
    assert state == {"scores": [500, 400], "rounds": 10}, state
    stored = await page.evaluate(
        "JSON.parse(localStorage.getItem('blakeout_active_game')).robinHood.round")
    assert stored == 10, stored
    await page.click("#playAgainBtn")
    await page.wait_for_timeout(400)
    replay = await get_state(page, "({scores:m.game.players.map(p=>p.score), round:m.game.robinHood.round})")
    assert replay == {"scores": [0, 0], "round": 1}, replay
    return {"turn": live, "final": state, "winner": winner}


async def test_double_down_cricket(page):
    # Two unique random doubles (D2–D14) gate the Cricket phase; 15–20 need
    # three marks each; only D1 wins after those challenges are complete.
    await fresh(page)
    await start_game(page, "doubledown", num_players="2")
    await page.wait_for_selector("#doubleDownMain", state="visible", timeout=3000)
    required = await get_state(page, "m.game.doubleDown.requiredDoubles")
    assert len(required) == 2 and len(set(required)) == 2, required
    assert all(2 <= value <= 14 for value in required), required
    phase = (await page.locator("#doubleDownPhase").inner_text()).strip()
    assert phase == "DOUBLE IN", phase

    # Hit both required doubles; the same turn immediately exposes Cricket.
    await page.locator("[data-double-down-kind='double-in']").nth(0).click()
    await page.locator("[data-double-down-kind='double-in']").nth(1).click()
    await page.wait_for_timeout(100)
    assert (await page.locator("#doubleDownPhase").inner_text()).strip() == "CLOSE 15–20"
    await page.locator("[data-double-down-kind='cricket'][data-target='20'][data-marks='3']").click()
    await page.click("#doubleDownEndTurnBtn")
    await page.wait_for_timeout(250)
    progress = await get_state(page, "m.game.doubleDown.progress[0]")
    assert progress["doubles"] == [True, True], progress
    assert progress["cricket"]["20"] == 3, progress
    stored = await page.evaluate(
        "JSON.parse(localStorage.getItem('blakeout_active_game')).doubleDown.progress[0]")
    assert stored["doubles"] == [True, True] and stored["cricket"]["20"] == 3, stored

    # Prepare Home with both doubles and all six Cricket numbers closed.
    # The phase must become D1, and recording D1 wins on commit.
    await page.evaluate("""
        (async () => {
            const state = await import('./js/state.js');
            state.game.currentPlayer = 0;
            const progress = state.game.doubleDown.progress[0];
            progress.doubles = [true, true];
            Object.keys(progress.cricket).forEach(target => { progress.cricket[target] = 3; });
            state.game.pendingDarts = [];
            (await import('./js/doubledown.js')).updateDoubleDownDisplay();
        })()
    """)
    assert (await page.locator("#doubleDownPhase").inner_text()).strip() == "DOUBLE DOWN"
    await page.click("[data-double-down-kind='double-one']")
    await page.click("#doubleDownEndTurnBtn")
    await page.wait_for_timeout(300)
    assert await page.locator("#winnerModal").is_visible(), "D1 did not win Double Down"
    winner = (await page.locator("#winnerName").inner_text()).strip()
    assert winner == "Home", winner
    final = await get_state(page, "m.game.doubleDown.progress[0]")
    assert final["doubleOne"] is True, final
    await page.click("#playAgainBtn")
    await page.wait_for_timeout(400)
    replay = await get_state(page, "m.game.doubleDown.progress")
    assert all(not any(progress["doubles"]) and not progress["doubleOne"]
               and all(marks == 0 for marks in progress["cricket"].values())
               for progress in replay), replay
    return {"required": required, "first_turn": progress, "winner": winner}


async def test_team_cricket_400(page):
    # Official 2v2 model: members own marks, teams share points. Both partners
    # must close a target before scoring; turns rotate A1/B1/A2/B2; the lead
    # cannot exceed 400; Traditional rules require both full boards.
    await fresh(page)
    await page.select_option("#gameType", "teamcricket")
    await page.wait_for_timeout(100)
    assert await page.locator("#teamMode").is_checked()
    assert await page.locator("#teamMode").is_disabled()
    assert await page.locator("#teamCricketOptions").is_visible()
    await page.click("#startGameBtn")
    await page.wait_for_selector("#teamBuilderScreen", state="visible")

    for name in ("Alpha", "Bravo", "Charlie", "Delta"):
        await page.fill("#teamAddName", name)
        await page.click("#teamAddBtn")

    async def assign(name, zone):
        await page.locator(".team-chip", has_text=name).click()
        await page.click(f"#teamZone{zone}Label")

    await assign("Alpha", 0)
    await assign("Charlie", 1)
    assert await page.locator("#teamStartMatchBtn").is_disabled()
    await assign("Bravo", 0)
    await assign("Delta", 1)
    assert await page.locator("#teamStartMatchBtn").is_enabled()
    await page.click("#teamStartMatchBtn")
    await page.wait_for_timeout(300)
    await page.wait_for_selector("#teamCricketMain", state="visible")
    members = await get_state(page, "m.game.teamCricket.memberMarks.map(team=>team.length)")
    assert members == [2, 2], members
    assert await page.locator(".team-cricket-member-heading").count() == 4

    # Four individual mark columns must remain contained on a compact phone
    # at maximum UI scale, not only on the default tablet viewport.
    await page.set_viewport_size({"width": 390, "height": 844})
    await set_ui_scale(page, 1.5)
    fit = await page.evaluate("""
        () => {
            const failures = [];
            document.querySelectorAll('.team-cricket-mark-cell .mark').forEach(mark => {
                const box = mark.getBoundingClientRect();
                const cell = mark.closest('.team-cricket-mark-cell').getBoundingClientRect();
                if (box.left < cell.left - 1 || box.right > cell.right + 1) failures.push({box, cell});
            });
            return {failures, width:document.documentElement.scrollWidth, inner:window.innerWidth};
        }
    """)
    assert not fit["failures"] and fit["width"] <= fit["inner"] + 1, f"compact Team Cricket overflow: {fit}"
    await page.set_viewport_size({"width": 900, "height": 1600})
    await set_ui_scale(page, 1.0)

    # Alpha is closed on 20, Bravo has 2 marks. Alpha's T20 cannot score yet
    # because both partners were not closed when Alpha threw.
    await page.evaluate("""
        (async () => {
            const state = await import('./js/state.js');
            state.game.teamCricket.memberMarks[0][0]['20'] = 3;
            state.game.teamCricket.memberMarks[0][1]['20'] = 2;
            (await import('./js/teamcricket.js')).updateTeamCricketDisplay();
        })()
    """)
    await page.locator("[data-team-cricket-target='20'][data-team-cricket-mult='3']").click()
    await page.click("#teamCricketEnterBtn")
    await page.wait_for_timeout(200)
    no_points = await get_state(
        page, "({scores:m.game.players.map(p=>p.score), rotations:m.game.teams.map(t=>t.rotationIndex), current:m.game.currentPlayer})")
    assert no_points == {"scores": [0, 0], "rotations": [1, 0], "current": 1}, no_points

    # Charlie misses, bringing up Bravo. Bravo closes 20 with a Triple; the
    # two excess marks now earn 40 shared team points.
    await page.click("#teamCricketMissBtn")
    await page.wait_for_timeout(150)
    thrower = (await page.locator("#homeThrower").inner_text()).strip()
    assert "Bravo" in thrower, thrower
    await page.locator("[data-team-cricket-target='20'][data-team-cricket-mult='3']").click()
    preview = int(await page.locator("#homeScore").inner_text())
    assert preview == 40, f"Team Cricket preview = {preview}"
    team_badge = (await page.locator(
        ".team-cricket-mark-cell.active .pending-indicator").inner_text()).strip()
    assert team_badge == "+3", f"Team Cricket pending badge = {team_badge!r}"
    await page.click("#teamCricketEnterBtn")
    await page.wait_for_timeout(200)
    score = await get_state(page, "m.game.players[0].score")
    assert score == 40, score

    # The 400 spread cap clips a T20 from 60 down to 10 at a 390–0 score.
    await page.evaluate("""
        (async () => {
            const state = await import('./js/state.js');
            state.game.currentPlayer = 0;
            state.game.players[0].score = 390;
            state.game.players[1].score = 0;
            state.game.teams[0].rotationIndex = 0;
            state.game.teamCricket.memberMarks[0][0]['20'] = 3;
            state.game.teamCricket.memberMarks[0][1]['20'] = 3;
            (await import('./js/teamcricket.js')).updateTeamCricketDisplay();
        })()
    """)
    await page.locator("[data-team-cricket-target='20'][data-team-cricket-mult='3']").click()
    capped_preview = int(await page.locator("#homeScore").inner_text())
    assert capped_preview == 400, capped_preview
    await page.click("#teamCricketEnterBtn")
    await page.wait_for_timeout(200)
    capped = await get_state(page, "m.game.players[0].score")
    assert capped == 400, capped

    # Traditional win: both Home members close every target and hold the lead.
    await page.evaluate("""
        (async () => {
            const state = await import('./js/state.js');
            state.game.currentPlayer = 0;
            state.game.teams[0].rotationIndex = 0;
            state.game.teamCricket.memberMarks[0].forEach(member => {
                Object.keys(member).forEach(target => { member[target] = 3; });
            });
            (await import('./js/teamcricket.js')).updateTeamCricketDisplay();
        })()
    """)
    await page.locator("[data-team-cricket-target='20'][data-team-cricket-mult='1']").click()
    await page.click("#teamCricketEnterBtn")
    await page.wait_for_timeout(300)
    assert await page.locator("#winnerModal").is_visible(), "Traditional Team Cricket did not win"
    winner = (await page.locator("#winnerName").inner_text()).strip()
    assert winner == "Home", winner
    stored = await page.evaluate(
        "JSON.parse(localStorage.getItem('blakeout_active_game')).teamCricket.memberMarks[0][1]['Bull']")
    assert stored == 3, f"Team Cricket state not persisted: {stored}"
    original_members = await get_state(page, "m.game.teams.map(t=>t.members.map(m=>m.name))")
    await page.click("#playAgainBtn")
    await page.wait_for_timeout(400)
    replay = await get_state(
        page, "({scores:m.game.players.map(p=>p.score), rotations:m.game.teams.map(t=>t.rotationIndex), members:m.game.teams.map(t=>t.members.map(m=>m.name)), marks:m.game.teamCricket.memberMarks})")
    assert replay["scores"] == [0, 0] and replay["rotations"] == [0, 0]
    assert replay["members"] == original_members, replay
    assert all(value == 0 for team in replay["marks"] for member in team for value in member.values()), replay
    return {"members": members, "scored": score, "capped": capped, "winner": winner}


async def test_team_cricket_new_rules(page):
    # New Team Cricket still requires both partners to close a target before
    # scoring, but only one partner needs the whole board closed to win.
    await fresh(page)
    await page.select_option("#gameType", "teamcricket")
    await page.select_option("#teamCricketRules", "new")
    await page.click("#startGameBtn")
    await page.wait_for_selector("#teamBuilderScreen", state="visible")
    for name in ("Alpha", "Bravo", "Charlie", "Delta"):
        await page.fill("#teamAddName", name)
        await page.click("#teamAddBtn")
    for name, zone in (("Alpha", 0), ("Bravo", 0), ("Charlie", 1), ("Delta", 1)):
        await page.locator(".team-chip", has_text=name).click()
        await page.click(f"#teamZone{zone}Label")
    await page.click("#teamStartMatchBtn")
    await page.wait_for_timeout(300)
    rules = await get_state(page, "m.game.teamCricket.rules")
    assert rules == "new", rules
    config_rules = await page.evaluate(
        "JSON.parse(localStorage.getItem('blakeout_configs')).lastConfig.teamCricketRules")
    assert config_rules == "new", config_rules

    await page.evaluate("""
        (async () => {
            const state = await import('./js/state.js');
            state.game.currentPlayer = 0;
            Object.keys(state.game.teamCricket.memberMarks[0][0]).forEach(target => {
                state.game.teamCricket.memberMarks[0][0][target] = 3;
            });
            (await import('./js/teamcricket.js')).updateTeamCricketDisplay();
        })()
    """)
    await page.locator("[data-team-cricket-target='20'][data-team-cricket-mult='1']").click()
    await page.click("#teamCricketEnterBtn")
    await page.wait_for_timeout(300)
    assert await page.locator("#winnerModal").is_visible(), "New Team Cricket should allow one closer"
    winner = (await page.locator("#winnerName").inner_text()).strip()
    assert winner == "Home", winner
    return {"rules": rules, "winner": winner}


async def test_game_rules_tooltip(page):
    # ⓘ badge on every card pops a brief gameplay summary.
    await dismiss_onboard(page)
    n_info = await page.locator(".game-card-info[data-rules-toggle]").count()
    n_cards = await page.locator(".game-card[data-game-value]").count()
    assert n_info == n_cards, f"every card needs an info badge: {n_info}/{n_cards}"

    await page.click(".game-card-info[data-rules-toggle='cricket']")
    await page.wait_for_timeout(100)
    pop = page.locator("#gameRulesPop")
    assert await pop.is_visible(), "rules popover should open"
    text = await pop.inner_text()
    assert "mark" in text.lower() and "Cricket" in text, f"popover text: {text!r}"

    # Same badge again → toggles closed
    await page.click(".game-card-info[data-rules-toggle='cricket']")
    await page.wait_for_timeout(100)
    assert await page.locator("#gameRulesPop").count() == 0, "popover should toggle off"

    # Open, then tap outside the grid → closes
    await page.click(".game-card-info[data-rules-toggle='501']")
    await page.wait_for_timeout(100)
    assert await page.locator("#gameRulesPop").is_visible()
    await page.click("h1")
    await page.wait_for_timeout(100)
    assert await page.locator("#gameRulesPop").count() == 0, "outside tap should close popover"
    return {"badges": n_info}


async def test_favorites_recents(page):
    await fresh(page)
    await dismiss_onboard(page)
    # No favorites chip initially (0 favs)
    fav_chip = await page.locator(".picker-chip[data-category='fav']").count()
    assert fav_chip == 0, "favorites chip should hide when no favorites"

    # Star cricket
    await page.click(".game-card-fav[data-fav-toggle='cricket']")
    await page.wait_for_timeout(100)
    favs = await page.evaluate("JSON.parse(localStorage.getItem('blakeout_game_favs'))")
    assert favs == ["cricket"], f"favs = {favs}"
    fav_chip = await page.locator(".picker-chip[data-category='fav']").count()
    assert fav_chip == 1, "favorites chip should appear after starring"

    # Favorites category shows only cricket
    await page.click(".picker-chip[data-category='fav']")
    await page.wait_for_timeout(100)
    shown = await page.eval_on_selector_all(
        ".game-card[data-game-value]", "els => els.map(e => e.dataset.gameValue)")
    assert shown == ["cricket"], f"fav view shows {shown}"
    await page.click(".picker-chip[data-category='all']")

    # Start a game → recents recorded, recent chip visible after returning
    await start_game(page, "301")
    recents = await page.evaluate("JSON.parse(localStorage.getItem('blakeout_recent_games'))")
    assert recents[0] == "301", f"recents = {recents}"
    return {"favs": favs, "recents": recents}


async def test_chaos_cricket(page):
    await dismiss_onboard(page)
    await start_game(page, "chaos")
    await page.wait_for_selector("#cricketMain", state="visible", timeout=3000)

    targets = await get_state(page, "m.game.cricketTargets")
    assert len(targets) == 7, f"expected 7 chaos targets, got {targets}"
    assert targets[-1] == "Bull", f"last target should be Bull: {targets}"
    nums = [int(t) for t in targets[:-1]]
    assert len(set(nums)) == 6, f"numbers not unique: {nums}"
    assert all(1 <= n <= 20 for n in nums), f"numbers out of range: {nums}"
    assert nums == sorted(nums, reverse=True), f"not sorted desc: {nums}"

    # Both players share the same board
    p0_keys = await get_state(page, "Object.keys(m.game.players[0].cricketData)")
    p1_keys = await get_state(page, "Object.keys(m.game.players[1].cricketData)")
    assert p0_keys == p1_keys, f"players have different boards: {p0_keys} vs {p1_keys}"

    # Grid renders all 7 rows with buttons for the random numbers
    rows = await page.locator(".cricket-row").count()
    assert rows == 7, f"expected 7 cricket rows, got {rows}"

    # Hit the first target 3 times → closes for player 0
    first = targets[0]
    for _ in range(3):
        await page.locator(f".cricket-num-btn[data-target='{first}']").first.click()
        await page.wait_for_timeout(60)
    await page.click("#enterBtn")
    await page.wait_for_timeout(250)
    closed = await get_state(page, f"m.game.players[0].cricketData['{first}'].closed")
    assert closed, f"target {first} not closed after 3 marks"

    # Play Again re-rolls the board (statistically: 10 tries, boards differ)
    await page.evaluate("""
        (async () => {
            const s = await import('./js/setup.js');
            s.playAgain();
        })()
    """)
    await page.wait_for_timeout(300)
    targets2 = await get_state(page, "m.game.cricketTargets")
    assert len(targets2) == 7, f"re-rolled board malformed: {targets2}"
    # marks reset
    marks = await get_state(page, f"m.game.players[0].cricketData['{targets2[0]}'].marks")
    assert marks == 0, "marks not reset after Play Again"
    return {"board1": targets, "board2": targets2}


async def test_cricket_quickie(page):
    # Quickie ends after the last player in round 10. Board progress ranks
    # first, then points break an equal-marks tie.
    await fresh(page)
    await start_game(page, "quickie", num_players="2")
    await page.wait_for_selector("#cricketMain", state="visible", timeout=3000)
    await page.evaluate("""
        (async () => {
            const state = await import('./js/state.js');
            state.game.completedRounds = 9;
            state.game.currentPlayer = 1;
            state.game.players[0].cricketData['20'].marks = 2;
            state.game.players[1].cricketData['20'].marks = 1;
            state.game.players[0].score = 10;
            state.game.players[1].score = 500;
            (await import('./js/cricket.js')).updateCricketDisplay();
        })()
    """)
    await page.click("#missBtn")
    await page.wait_for_timeout(450)
    assert await page.locator("#winnerModal").is_visible(), "Quickie did not end at 10 rounds"
    winner = (await page.locator("#winnerName").inner_text()).strip()
    assert winner == "Home", f"board progress should beat points at limit: {winner!r}"
    rounds = await get_state(page, "m.game.completedRounds")
    badge = (await page.locator("#roundBadge").inner_text()).strip()
    assert rounds == 10 and badge == "10", f"Quickie round cap: rounds={rounds}, badge={badge}"
    stored = await page.evaluate(
        "JSON.parse(localStorage.getItem('blakeout_active_game')).completedRounds")
    assert stored == 10, f"Quickie final round not persisted: {stored}"
    return {"winner": winner, "rounds": rounds}


async def test_cutthroat_cricket(page):
    # Extra marks penalize every open opponent, preview in their headers,
    # and the closer wins only while holding the lowest score.
    await fresh(page)
    await page.select_option("#numPlayers", "1")
    await page.select_option("#gameType", "cutthroat")
    await page.wait_for_timeout(100)
    assert await page.input_value("#numPlayers") == "2", "Cut-Throat must require 2+ sides"
    assert await page.locator("#cricketPoints").is_disabled(), "Cut-Throat points must be forced"
    await page.click("#startGameBtn")
    await page.wait_for_selector("#cricketMain", state="visible", timeout=3000)

    await page.evaluate("""
        (async () => {
            const state = await import('./js/state.js');
            const target = state.game.players[0].cricketData['20'];
            target.marks = 3;
            target.closed = true;
            (await import('./js/cricket.js')).updateCricketDisplay();
        })()
    """)
    await page.locator(".cricket-dt-btn[data-target='20'][data-multiplier='3']").first.click()
    await page.wait_for_timeout(100)
    preview = int(await page.locator("#awayScore").inner_text())
    indicator = (await page.locator("#scoreDiffIndicator").inner_text()).strip()
    assert preview == 60 and "+60" in indicator, f"Cut-Throat preview={preview}, indicator={indicator!r}"
    await page.click("#enterBtn")
    await page.wait_for_timeout(350)
    scores = await get_state(page, "m.game.players.map(p => p.score)")
    assert scores == [0, 60], f"Cut-Throat penalties = {scores}"

    # Close the rest of Home's board and give one final excess Bull. Away
    # receives the penalty and Home qualifies with the lower score.
    await page.wait_for_timeout(750)
    await page.evaluate("""
        (async () => {
            const state = await import('./js/state.js');
            state.game.currentPlayer = 0;
            state.game.cricketTargets.forEach(target => {
                const data = state.game.players[0].cricketData[target];
                data.marks = 3;
                data.closed = true;
            });
            (await import('./js/cricket.js')).updateCricketDisplay();
        })()
    """)
    await page.locator(".cricket-num-btn[data-target='Bull']").first.click()
    await page.click("#enterBtn")
    await page.wait_for_timeout(350)
    assert await page.locator("#winnerModal").is_visible(), "lowest-score closer should win Cut-Throat"
    winner = (await page.locator("#winnerName").inner_text()).strip()
    assert winner == "Home", winner
    final_scores = await get_state(page, "m.game.players.map(p => p.score)")
    assert final_scores == [0, 85], final_scores
    return {"preview": preview, "scores": final_scores, "winner": winner}


async def test_wildcard_cricket(page):
    # Six unique 7–20 values start wild. A marked row locks; every unmarked
    # row visibly changes after the turn; Bull remains fixed. Undo restores
    # both player data and the prior target board.
    await fresh(page)
    await start_game(page, "wildcard", num_players="2")
    await page.wait_for_selector("#cricketMain", state="visible", timeout=3000)
    initial = await get_state(page, "m.game.cricketTargets.slice()")
    nums = [int(value) for value in initial[:-1]]
    assert len(nums) == 6 and len(set(nums)) == 6, initial
    assert all(7 <= value <= 20 for value in nums) and initial[-1] == "Bull", initial

    locked = initial[0]
    await page.locator(f".cricket-num-btn[data-target='{locked}']").first.click()
    await page.click("#enterBtn")
    await page.wait_for_timeout(350)
    changed = await get_state(page, "m.game.cricketTargets.slice()")
    assert changed[0] == locked, f"marked Wild Card row moved: {initial} -> {changed}"
    assert changed[-1] == "Bull", changed
    assert all(changed[index] != initial[index] for index in range(1, 6)), \
        f"unmarked rows must all change: {initial} -> {changed}"
    changed_nums = [int(value) for value in changed[:-1]]
    assert len(set(changed_nums)) == 6 and all(7 <= value <= 20 for value in changed_nums), changed
    marks = await get_state(page, f"m.game.players[0].cricketData['{locked}'].marks")
    assert marks == 1, f"locked target lost mark: {marks}"

    await page.evaluate("""
        (async () => {
            const state = await import('./js/state.js');
            state.undoLastAction(() => {});
            (await import('./js/cricket.js')).updateCricketDisplay();
        })()
    """)
    restored = await get_state(page, "m.game.cricketTargets.slice()")
    assert restored == initial, f"undo did not restore Wild Card board: {restored}"
    return {"initial": initial, "changed": changed, "restored": restored}


async def test_shanghai(page):
    await dismiss_onboard(page)
    await start_game(page, "shanghai")
    await page.wait_for_selector("#targetGameMain", state="visible", timeout=3000)

    # Round 1 target
    val = (await page.locator("#targetValue").inner_text()).strip()
    assert val == "1", f"expected round 1, got {val!r}"

    # Player 0: single (1) + double (2) = 3 points, no shanghai (no triple)
    await page.click("#hitSingleBtn")
    await page.click("#hitDoubleBtn")
    live = int(await page.locator("#targetTurnScore").inner_text())
    assert live == 3, f"expected 3 (S+D on 1s), got {live}"
    await page.click("#targetEndTurnBtn")
    await page.wait_for_timeout(200)
    p0 = int(await page.locator("#homeScore").inner_text())
    assert p0 == 3, f"player 0 should have 3, got {p0}"
    no_win = await page.locator("#winnerModal").is_visible()
    assert not no_win, "S+D alone must NOT trigger shanghai"

    # Player 1: S+D+T on 1s = 6 points AND instant shanghai win
    await page.click("#hitSingleBtn")
    await page.click("#hitDoubleBtn")
    await page.click("#hitTripleBtn")
    await page.click("#targetEndTurnBtn")
    await page.wait_for_timeout(300)
    winner = await page.locator("#winnerModal").is_visible()
    assert winner, "S+D+T in one turn must trigger instant Shanghai win"
    name = await page.locator("#winnerName").inner_text()
    assert "SHANGHAI" in name.upper(), f"winner text should shout SHANGHAI: {name!r}"
    return {"p0_score": p0, "shanghai_win": winner}


async def test_shanghai_no_win(page):
    await dismiss_onboard(page)
    await start_game(page, "shanghai", num_players="1")
    await page.wait_for_selector("#targetGameMain", state="visible", timeout=3000)
    # Play all 7 rounds with a single triple each round: score = 3×round
    for rnd in range(1, 8):
        await page.click("#hitTripleBtn")
        await page.click("#targetEndTurnBtn")
        await page.wait_for_timeout(150)
    winner = await page.locator("#winnerModal").is_visible()
    assert winner, "winner modal should open after round 7"
    # Total = 3×(1+..+7) = 84
    score = await get_state(page, "m.game.players[0].score")
    assert score == 84, f"expected 84, got {score}"
    return {"final_score": score}


async def test_themes(page):
    await dismiss_onboard(page)
    # Theme picker now lives inside the unified Settings modal
    await page.click("#settingsBtnSetup")
    await page.wait_for_timeout(400)   # showModal 300ms input guard
    swatches = await page.eval_on_selector_all(
        ".theme-swatch[data-theme-choice]", "els => els.map(e => e.dataset.themeChoice)")
    expected = {"blue", "red", "neon", "sunburst", "volt", "inferno", "miami",
                "grape", "aqua", "royal", "shamrock", "arctic"}
    assert set(swatches) == expected, f"swatches = {swatches}"
    assert len(swatches) == 12, f"expected 12 swatches, got {len(swatches)}"

    for theme in ("sunburst", "arctic", "volt", "blue"):
        await page.click(f".theme-swatch[data-theme-choice='{theme}']")
        await page.wait_for_timeout(80)
        applied = await page.evaluate("document.documentElement.getAttribute('data-theme')")
        saved = await page.evaluate("localStorage.getItem('blakeout_theme')")
        assert applied == theme and saved == theme, f"{theme}: applied={applied}, saved={saved}"

    # Contrast sanity: primary color must differ per theme (tokens actually loaded)
    prims = {}
    for theme in ("sunburst", "volt", "arctic"):
        await page.click(f".theme-swatch[data-theme-choice='{theme}']")
        await page.wait_for_timeout(80)
        prims[theme] = await page.evaluate(
            "getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim()")
    assert len(set(prims.values())) == 3, f"theme tokens not distinct: {prims}"
    await page.click(".theme-swatch[data-theme-choice='blue']")
    await page.click("#settingsCloseBtn")
    return {"swatches": len(swatches), "primaries": prims}


async def test_settings_modal(page):
    # a5/a3/a8: unified settings — gear on setup, wallpaper presets +
    # persistence, and in-game access via Game Menu → Visual Settings.
    await fresh(page)
    await page.click("#settingsBtnSetup")
    await page.wait_for_timeout(400)
    assert await page.locator("#settingsModal").is_visible(), "settings modal should open"
    assert await page.locator("#settingsModal #themePicker .theme-swatch").count() >= 12, \
        "theme picker should render inside settings"
    n_wall = await page.locator(".wallpaper-choice").count()
    assert n_wall == 6, f"expected 6 wallpaper choices (Default/None/4 presets), got {n_wall}"

    # Pick the felt preset → CSS var applied + persisted
    await page.click(".wallpaper-choice[data-wallpaper-id='felt']")
    await page.wait_for_timeout(100)
    var = await page.evaluate(
        "document.documentElement.style.getPropertyValue('--app-wallpaper')")
    assert "../assets/wallpapers/felt.svg" in var, f"wallpaper var not applied: {var!r}"
    saved = await page.evaluate("JSON.parse(localStorage.getItem('blakeout_wallpaper'))")
    assert saved == {"type": "preset", "id": "felt"}, f"saved = {saved}"
    active = await page.locator(".wallpaper-choice.active").get_attribute("data-wallpaper-id")
    assert active == "felt", f"active choice = {active}"

    # Survives reload
    await page.reload(wait_until="domcontentloaded")
    await page.wait_for_timeout(500)
    var2 = await page.evaluate(
        "document.documentElement.style.getPropertyValue('--app-wallpaper')")
    assert "../assets/wallpapers/felt.svg" in var2, f"wallpaper lost on reload: {var2!r}"
    loaded = await page.evaluate("""
        () => new Promise(resolve => {
            const image = new Image();
            image.onload = () => resolve(true);
            image.onerror = () => resolve(false);
            image.src = 'assets/wallpapers/felt.svg';
        })
    """)
    assert loaded, "felt wallpaper asset failed to load"

    # UI scale slider lives in the modal now
    await page.click("#settingsBtnSetup")
    await page.wait_for_timeout(400)
    assert await page.locator("#settingsModal #uiScale").is_visible(), "uiScale missing from settings"
    await page.click("#settingsCloseBtn")
    await page.wait_for_timeout(100)
    assert not await page.locator("#settingsModal").is_visible(), "Done should close settings"

    # In-game: Menu → Visual Settings opens the same modal
    await start_game(page, "501")
    await page.click("#menuBtn")
    await page.wait_for_timeout(400)
    await page.click("#gameMenuVisualBtn")
    await page.wait_for_timeout(400)
    assert await page.locator("#settingsModal").is_visible(), "settings should open in-game"
    assert not await page.locator("#gameMenuModal").is_visible(), "game menu should close first"
    # Live theme change mid-game
    await page.click(".theme-swatch[data-theme-choice='volt']")
    await page.wait_for_timeout(100)
    applied = await page.evaluate("document.documentElement.getAttribute('data-theme')")
    assert applied == "volt", f"in-game theme change failed: {applied}"
    await page.click("#settingsCloseBtn")
    return {"wallpaper": saved, "choices": n_wall}


async def test_setup_section_separation(page):
    # Main setup choices should read as distinct, consistently styled panels
    # on both tablets and phones. Game Options disappears when irrelevant.
    await fresh(page)
    panel_ids = [
        "gamePickerSection", "gameOptionsSection", "playersSection",
        "presetsSection", "playSection", "maintenanceSection"
    ]
    labels = await page.eval_on_selector_all(
        ".setup-card > .setup-panel > .setup-section-label",
        "elements => elements.map(element => element.textContent.trim())")
    assert labels == ["Game", "Game Options", "Players", "Presets", "Play", "App Maintenance"], labels

    metrics = await page.evaluate("""
        ids => ids.map(id => {
            const element = document.getElementById(id);
            const style = getComputedStyle(element);
            const box = element.getBoundingClientRect();
            return {id, visible:style.display !== 'none', top:box.top, bottom:box.bottom,
                    borderLeft:parseFloat(style.borderLeftWidth),
                    radius:parseFloat(style.borderTopLeftRadius),
                    background:style.backgroundColor};
        })
    """, panel_ids)
    for panel in metrics:
        assert panel["visible"], f"default 501 panel hidden: {panel}"
        assert panel["borderLeft"] >= 4 and panel["radius"] > 0, f"panel separator missing: {panel}"
        assert panel["background"] != "rgba(0, 0, 0, 0)", f"panel background missing: {panel}"
    for previous, current in zip(metrics, metrics[1:]):
        assert current["top"] >= previous["bottom"] + 8, \
            f"panels run together: {previous['id']} -> {current['id']}"

    await page.select_option("#gameType", "countup")
    assert not await page.locator("#gameOptionsSection").is_visible(), \
        "empty Game Options panel should hide for Count Up"
    await page.select_option("#gameType", "cricket")
    assert await page.locator("#gameOptionsSection").is_visible(), \
        "Game Options panel should return for Cricket"

    await page.set_viewport_size({"width": 390, "height": 844})
    compact = await page.evaluate("""
        () => ({documentWidth:document.documentElement.scrollWidth,
               viewportWidth:window.innerWidth,
               panelWidths:[...document.querySelectorAll('.setup-card > .setup-panel')]
                   .filter(element => getComputedStyle(element).display !== 'none')
                   .map(element => element.getBoundingClientRect().width)})
    """)
    assert compact["documentWidth"] <= compact["viewportWidth"] + 1, compact
    assert all(width > 250 for width in compact["panelWidths"]), compact
    return {"labels": labels, "tablet": metrics, "compact": compact}


async def test_support_link(page):
    # The Cash App tip used to be a plain text link nobody noticed. It is now
    # a "Buy me a beer" button (the Buy-Me-a-Coffee/Ko-fi convention) and has
    # to stay obvious: real button chrome, a big tap target, and the beer
    # wording — while still pointing at Cash App with a safe target=_blank.
    await fresh(page)
    button = page.locator("#supportBtn")
    assert await button.count() == 1, "support button missing from setup footer"
    assert await button.is_visible(), "support button should be visible on the setup screen"

    href = await button.get_attribute("href")
    assert href == "https://cash.app/$MikeDurbin", f"unexpected tip destination: {href!r}"
    assert await button.get_attribute("target") == "_blank"
    rel = (await button.get_attribute("rel") or "").split()
    assert "noopener" in rel and "noreferrer" in rel, f"unsafe rel on _blank link: {rel}"

    label = (await button.get_attribute("aria-label") or "")
    text = (await button.inner_text()).lower()
    assert "beer" in text, f"button should read as a beer tip: {text!r}"
    assert "cash app" in text, f"button should name the payment method: {text!r}"
    assert "beer" in label.lower() and "cash app" in label.lower(), f"aria-label: {label!r}"
    assert "🍺" in await button.inner_html(), "beer icon missing"

    style = await page.evaluate("""
        () => {
            const el = document.getElementById('supportBtn');
            const s = getComputedStyle(el);
            const box = el.getBoundingClientRect();
            return {display:s.display, background:s.backgroundImage,
                    radius:parseFloat(s.borderBottomLeftRadius),
                    decoration:s.textDecorationLine,
                    height:box.height, width:box.width};
        }
    """)
    assert style["display"].startswith("inline-flex"), style
    assert style["background"] != "none", "tip button needs its own fill, not link text"
    assert style["height"] >= 44, f"tap target too small: {style}"
    assert style["radius"] >= 12, f"button should be a pill, not a link: {style}"
    assert "underline" not in style["decoration"], style

    # The old bare "$MikeDurbin" text link must be gone so there's exactly
    # one obvious way to tip.
    cash_links = await page.eval_on_selector_all(
        "#setupScreen a[href*='cash.app']", "els => els.map(e => e.id)")
    assert cash_links == ["supportBtn"], f"duplicate/legacy cash links: {cash_links}"
    return {"href": href, "style": style}


async def test_x01_live_preview(page):
    # Typing a dart should move the active player's header score in real
    # time, before ENTER, so a walk-up score entry reads back instantly.
    await dismiss_onboard(page)
    await start_game(page, "501")
    await page.wait_for_selector("#x01Controls", state="visible", timeout=3000)

    async def header():
        return {
            "score": (await page.text_content("#homeScore")).strip(),
            "delta": (await page.text_content("#homeDelta")).strip(),
            "cls": await page.get_attribute("#homeScore", "class"),
        }

    assert (await header())["score"] == "501"

    # First dart: T20 → 441 previewed, nothing committed yet.
    await page.click("[data-digit='3']")
    await page.click("[data-op='*']")
    await page.click("[data-digit='2']")
    await page.click("[data-digit='0']")
    await page.wait_for_timeout(120)
    after_first = await header()
    assert after_first["score"] == "441", after_first
    assert after_first["delta"] == "\u221260", after_first
    assert "score-preview" in after_first["cls"], after_first
    committed = await get_state(page, "m.game.players[0].score")
    assert committed == 501, f"preview must not commit: {committed}"

    # Second dart adds to the same turn and the preview keeps up.
    await page.click("[data-op='+']")
    await page.click("[data-digit='2']")
    await page.click("[data-digit='0']")
    await page.wait_for_timeout(120)
    after_second = await header()
    assert after_second["score"] == "421", after_second
    assert after_second["delta"] == "\u221280", after_second

    # ENTER commits and the preview styling clears.
    await page.click("#x01EnterBtn")
    await page.wait_for_timeout(300)
    after_enter = await header()
    assert after_enter["score"] == "421", after_enter
    assert after_enter["delta"] == "", after_enter
    assert "score-preview" not in after_enter["cls"], after_enter
    assert await get_state(page, "m.game.players[0].score") == 421

    # Undo-as-clear drops a half-typed entry and restores the real score.
    await page.click("[data-digit='9']")
    await page.wait_for_timeout(120)
    assert (await header())["score"] == "421"  # away player is active now
    away = await page.text_content("#awayScore")
    assert away.strip() == "492", f"active player preview expected: {away!r}"
    await page.click("#undoBtnX01")
    await page.wait_for_timeout(200)
    assert (await page.text_content("#awayScore")).strip() == "501"
    assert (await page.text_content("#awayDelta")).strip() == ""

    # A turn bigger than what's left previews BUST instead of a negative.
    await page.evaluate("""
        (async () => {
            const m = await import('./js/state.js');
            m.game.players[1].score = 20;
        })()
    """)
    await page.click("[data-digit='6']")
    await page.click("[data-digit='0']")
    await page.wait_for_timeout(120)
    bust_score = (await page.text_content("#awayScore")).strip()
    bust_cls = await page.get_attribute("#awayScore", "class")
    assert bust_score == "BUST", bust_score
    assert "score-preview-bust" in bust_cls, bust_cls
    return {"first": after_first, "second": after_second, "after_enter": after_enter}


async def test_play_again_target(page):
    # Regression: playAgain() used to corrupt target games (left stale
    # baseball state + stamped cricketData on players).
    await dismiss_onboard(page)
    await start_game(page, "baseball")
    await page.wait_for_selector("#targetGameMain", state="visible", timeout=3000)
    # Play one turn to dirty the state
    await page.click("#hitSingleBtn")
    await page.click("#targetEndTurnBtn")
    await page.wait_for_timeout(200)

    await page.evaluate("""
        (async () => {
            const s = await import('./js/setup.js');
            s.playAgain();
        })()
    """)
    await page.wait_for_timeout(300)
    bb = await get_state(page, "m.game.baseball")
    assert bb and bb["inning"] == 1, f"baseball state not re-initialized: {bb}"
    p0 = await get_state(page, "m.game.players[0]")
    assert p0["score"] == 0, f"score not reset: {p0['score']}"
    assert "cricketData" not in p0, "cricketData wrongly stamped on baseball player"
    val = (await page.locator("#targetValue").inner_text()).strip()
    assert val == "1", f"target display should reset to inning 1, got {val!r}"
    return {"inning": bb["inning"]}


async def test_resume_target_game(page):
    # Regression: baseball/bermuda/golf/shanghai state now survives
    # save → reload → resume.
    await dismiss_onboard(page)
    await start_game(page, "baseball")
    await page.wait_for_selector("#targetGameMain", state="visible", timeout=3000)
    # Two full innings-turns to advance state
    for _ in range(2):
        await page.click("#hitSingleBtn")
        await page.click("#targetEndTurnBtn")
        await page.wait_for_timeout(200)
    inning_before = await get_state(page, "m.game.baseball.inning")

    # Reload the app (simulates tablet refresh) and resume
    await page.reload(wait_until="domcontentloaded")
    await page.wait_for_timeout(400)
    resume_visible = await page.locator("#resumeGameBtn").is_visible()
    assert resume_visible, "Resume button missing after reload with saved game"
    await page.click("#resumeGameBtn")
    await page.wait_for_timeout(300)
    inning_after = await get_state(page, "m.game.baseball.inning")
    assert inning_after == inning_before, \
        f"baseball inning lost on resume: {inning_before} → {inning_after}"
    return {"inning": inning_after}


async def test_dedicated_engine_resume(page):
    # Dedicated boards must survive a real page reload, not only serialize
    # correctly in memory. Cover both Tic Tac Toe and Double Down routing.
    await fresh(page)
    await start_game(page, "tictactoe", num_players="2")
    await page.click("[data-tic-mult='3']")
    await page.click("[data-tic-cell='0']")
    await page.click("[data-tic-mult='1']")
    await page.click("[data-tic-cell='0']")
    await page.click("#ticEndTurnBtn")
    await page.wait_for_timeout(200)
    target = await get_state(page, "m.game.ticTacToe.targets[0]")
    await page.reload(wait_until="domcontentloaded")
    await page.wait_for_timeout(350)
    await page.click("#resumeGameBtn")
    await page.wait_for_timeout(250)
    assert await page.locator("#ticTacToeMain").is_visible()
    restored_tic = await get_state(
        page, "({owner:m.game.ticTacToe.cells[0].owner, target:m.game.ticTacToe.targets[0]})")
    assert restored_tic == {"owner": 0, "target": target}, restored_tic

    await page.evaluate("localStorage.removeItem('blakeout_active_game')")
    await page.reload(wait_until="domcontentloaded")
    await page.wait_for_timeout(350)
    await start_game(page, "doubledown", num_players="2")
    required = await get_state(page, "m.game.doubleDown.requiredDoubles.slice()")
    await page.locator("[data-double-down-kind='double-in']").nth(0).click()
    await page.click("#doubleDownEndTurnBtn")
    await page.wait_for_timeout(200)
    await page.reload(wait_until="domcontentloaded")
    await page.wait_for_timeout(350)
    await page.click("#resumeGameBtn")
    await page.wait_for_timeout(250)
    assert await page.locator("#doubleDownMain").is_visible()
    restored_double = await get_state(
        page, "({required:m.game.doubleDown.requiredDoubles, progress:m.game.doubleDown.progress[0].doubles})")
    assert restored_double == {"required": required, "progress": [True, False]}, restored_double
    return {"tic_tac_toe": restored_tic, "double_down": restored_double}


async def test_core_cricket(page):
    # No-regression: standard cricket flow still works end to end.
    await dismiss_onboard(page)
    await start_game(page, "cricket")
    await page.wait_for_selector("#cricketMain", state="visible", timeout=3000)
    rows = await page.locator(".cricket-row").count()
    assert rows == 7, f"expected 7 cricket rows, got {rows}"
    # T20 → 3 marks, closes 20 in one turn
    await page.locator(".cricket-dt-btn[data-target='20'][data-multiplier='3']").first.click()
    await page.wait_for_timeout(80)
    await page.click("#enterBtn")
    await page.wait_for_timeout(250)
    closed = await get_state(page, "m.game.players[0].cricketData['20'].closed")
    one_turn = await get_state(page, "m.game.players[0].cricketData['20'].closedInOneTurn")
    assert closed and one_turn, f"T20 close failed: closed={closed}, oneTurn={one_turn}"
    return {"rows": rows}


async def test_core_x01(page):
    # No-regression: 501 still scores and declares a winner.
    await dismiss_onboard(page)
    await start_game(page, "501", num_players="1")
    await page.wait_for_selector("#x01Main", state="visible", timeout=3000)
    await page.click("[data-quick='100']")
    await page.wait_for_timeout(800)
    score = int(await page.locator("#homeScore").inner_text())
    assert score == 401, f"expected 401 after 100, got {score}"
    await page.evaluate("""
        (async () => {
            const stateMod = await import('./js/state.js');
            stateMod.game.players[0].score = 40;
            stateMod.game.currentPlayer = 0;
            const x01 = await import('./js/x01.js');
            x01.updateX01Display();
        })()
    """)
    await page.wait_for_timeout(100)
    await page.click("[data-quick='40']")
    await page.wait_for_timeout(400)
    winner = await page.locator("#winnerModal").is_visible()
    assert winner, "winner modal didn't open on 501 checkout"
    return {"score_after_100": score}


async def test_all_games_boot(page):
    # Every registry game must start cleanly and route to the right main
    # panel for its engine. Driven from the registry so new games are
    # covered automatically.
    await dismiss_onboard(page)
    games = await page.evaluate(
        "(async () => { const r = await import('./js/registry.js');"
        " return r.listGames().map(g => ({id:g.id, engine:g.engine, requiresTeamMode:!!g.requiresTeamMode})); })()")
    assert len(games) >= 29, f"registry shrank? {len(games)} games"
    panels = {
        "cricket": "#cricketMain", "x01": "#x01Main",
        "score": "#x01Main", "target": "#targetGameMain",
        "tictactoe": "#ticTacToeMain", "doubledown": "#doubleDownMain"
    }
    booted = []
    for g in games:
        # Team-required games have richer dedicated setup/boot tests.
        if g["requiresTeamMode"]:
            booted.append(g["id"])
            continue
        await page.evaluate("localStorage.removeItem('blakeout_active_game')")
        await page.reload(wait_until="domcontentloaded")
        await page.wait_for_timeout(400)
        await dismiss_onboard(page)
        await start_game(page, g["id"])
        game_visible = await page.locator("#gameScreen").is_visible()
        assert game_visible, f"{g['id']}: game screen didn't open"
        panel = panels.get(g["engine"])
        if panel:
            vis = await page.locator(panel).is_visible()
            assert vis, f"{g['id']}: {panel} not visible for engine {g['engine']}"
        booted.append(g["id"])
    return {"booted": booted}


async def test_x01_remaining_entry(page):
    # Both replacement workflows are supported:
    # tap score → type what's LEFT → ENTER, and type what's LEFT → tap score.
    await dismiss_onboard(page)
    await start_game(page, "501", num_players="1")
    await page.wait_for_selector("#x01Main", state="visible", timeout=3000)

    # Tap the score → remaining mode indicator
    await page.click("#homeScore")
    await page.wait_for_timeout(100)
    disp = await page.locator("#inputDisplay").inner_text()
    assert "LEFT" in disp, f"remaining mode not shown: {disp!r}"

    # Type 376 (i.e. threw 125 from 501) → display shows the math
    for d in "376":
        await page.click(f"[data-digit='{d}']")
    disp = await page.locator("#inputDisplay").inner_text()
    assert "376" in disp and "125" in disp, f"conversion not shown: {disp!r}"
    await page.click("#x01EnterBtn")
    await page.wait_for_timeout(800)
    score = await get_state(page, "m.game.players[0].score")
    assert score == 376, f"expected 376 remaining, got {score}"
    hist = await get_state(page, "m.game.players[0].history")
    last = hist[-1]["score"] if isinstance(hist[-1], dict) else hist[-1]
    assert last == 125, f"history should record 125 thrown, got {hist[-1]}"

    # Natural type-first workflow: type the desired replacement score, then
    # tap the active current score. It commits immediately without ENTER.
    for d in "300":
        await page.click(f"[data-digit='{d}']")
    before_tap = await get_state(page, "m.game.players[0].score")
    assert before_tap == 376, f"typing alone changed score: {before_tap}"
    await page.click("#homeScore")
    await page.wait_for_timeout(800)
    replaced = await get_state(page, "m.game.players[0].score")
    assert replaced == 300, f"type-then-tap should replace 376 with 300, got {replaced}"
    hist = await get_state(page, "m.game.players[0].history")
    replacement_throw = hist[-1]["score"] if isinstance(hist[-1], dict) else hist[-1]
    assert replacement_throw == 76, f"replacement history should record 76, got {hist[-1]}"
    assert (await page.locator("#inputDisplay").inner_text()).strip() == "0"

    # Invalid remaining (more than current) → rejected, score unchanged
    for d in "999":
        await page.click(f"[data-digit='{d}']")
    await page.click("#homeScore")
    await page.wait_for_timeout(800)
    score2 = await get_state(page, "m.game.players[0].score")
    assert score2 == 300, f"invalid remaining must not change score: {score2}"

    # Tapping the score again cancels the mode
    await page.click("#homeScore")
    await page.wait_for_timeout(100)
    await page.click("#homeScore")
    await page.wait_for_timeout(100)
    disp = await page.locator("#inputDisplay").inner_text()
    assert "LEFT" not in disp, f"remaining mode should toggle off: {disp!r}"
    return {"tap_first": score, "type_first": replaced}


async def test_x01_miss_bust_symbols(page):
    # a4: MISS and BUST are distinct player-declared actions with their
    # own history symbols, and BUST stays available even mid-input.
    await dismiss_onboard(page)
    await start_game(page, "501", num_players="2")
    await page.wait_for_selector("#x01Main", state="visible", timeout=3000)

    # P0 declares a miss → ⊘ MISS in history, score unchanged
    await page.click("#x01MissBtn")
    await page.wait_for_timeout(800)
    p0_score = await get_state(page, "m.game.players[0].score")
    assert p0_score == 501, f"miss must not change score: {p0_score}"
    miss_cells = await page.locator("#p1HistoryCol .score-history-entry.miss").count()
    assert miss_cells == 1, f"expected 1 miss cell, got {miss_cells}"
    miss_txt = await page.locator("#p1HistoryCol .score-history-entry.miss").inner_text()
    assert "MISS" in miss_txt and "⊘" in miss_txt, f"miss cell text: {miss_txt!r}"

    # P1: BUST must stay visible while digits are typed
    await page.click("[data-digit='4']")
    await page.click("[data-digit='5']")
    bust_visible = await page.locator("#x01BustBtn").is_visible()
    assert bust_visible, "BUST button must stay available mid-input"
    await page.click("#x01BustBtn")
    await page.wait_for_timeout(800)
    p1_score = await get_state(page, "m.game.players[1].score")
    assert p1_score == 501, f"bust must not change score: {p1_score}"
    # 2-player layout puts player 1 in #p3HistoryCol
    bust_cells = await page.locator("#p3HistoryCol .score-history-entry.bust").count()
    assert bust_cells == 1, f"expected 1 bust cell, got {bust_cells}"
    bust_txt = await page.locator("#p3HistoryCol .score-history-entry.bust").inner_text()
    assert "BUST" in bust_txt and "✖" in bust_txt, f"bust cell text: {bust_txt!r}"

    # History entries survive undo/redo shape checks (flags round-trip storage)
    hist0 = await get_state(page, "m.game.players[0].history")
    assert isinstance(hist0[-1], dict) and hist0[-1].get("miss"), f"miss flag lost: {hist0[-1]}"
    hist1 = await get_state(page, "m.game.players[1].history")
    assert isinstance(hist1[-1], dict) and hist1[-1].get("bust"), f"bust flag lost: {hist1[-1]}"
    return {"miss": miss_txt, "bust": bust_txt}


async def test_x01_no_stale_score_game2(page):
    # 1e: the winning throw must not still be on screen when game 2 starts.
    await dismiss_onboard(page)
    await start_game(page, "501", num_players="1")
    await page.wait_for_selector("#x01Main", state="visible", timeout=3000)
    await page.evaluate("""
        (async () => {
            const stateMod = await import('./js/state.js');
            stateMod.game.players[0].score = 40;
            const x01 = await import('./js/x01.js');
            x01.updateX01Display();
        })()
    """)
    await page.click("[data-quick='40']")
    await page.wait_for_timeout(400)
    assert await page.locator("#winnerModal").is_visible(), "checkout should win"
    # Winning throw is sitting in the display right now — Play Again must wipe it
    await page.click("#playAgainBtn")
    await page.wait_for_timeout(500)
    disp = (await page.locator("#inputDisplay").inner_text()).strip()
    assert disp == "0", f"stale score visible at game 2 start: {disp!r}"
    indicator = (await page.locator("#finishIndicator").inner_text()).strip()
    assert indicator == "" or "DOUBLE" in indicator, f"stale indicator: {indicator!r}"
    score = await get_state(page, "m.game.players[0].score")
    assert score == 501, f"game 2 should restart at 501, got {score}"
    return {"display": disp}


async def test_cricket_pending_mark_count(page):
    # 1f: while entering marks the pending line shows a running total.
    await dismiss_onboard(page)
    await start_game(page, "cricket")
    await page.wait_for_selector("#cricketMain", state="visible", timeout=3000)
    await page.locator(".cricket-dt-btn[data-target='20'][data-multiplier='3']").first.click()
    await page.wait_for_timeout(80)
    await page.locator(".cricket-dt-btn[data-target='19'][data-multiplier='2']").first.click()
    await page.wait_for_timeout(80)
    await page.locator(".cricket-num-btn[data-target='18']").first.click()
    await page.wait_for_timeout(80)
    pending = (await page.locator("#pendingText").inner_text()).strip()
    assert "6 marks" in pending, f"pending line missing mark count: {pending!r}"
    assert "T20" in pending and "D19" in pending, f"dart list gone: {pending!r}"
    badges = await page.eval_on_selector_all(
        ".cricket-cell.active .pending-indicator",
        "elements => elements.map(element => element.textContent.trim())")
    assert badges == ["+3", "+2", "+1"], f"pending target badges missing: {badges}"
    # Single dart → singular form
    await page.click("#enterBtn")
    await page.wait_for_timeout(300)
    await page.locator(".cricket-num-btn[data-target='20']").first.click()
    await page.wait_for_timeout(80)
    pending2 = (await page.locator("#pendingText").inner_text()).strip()
    assert "1 mark" in pending2 and "1 marks" not in pending2, f"singular broken: {pending2!r}"
    badge2 = (await page.locator(".cricket-cell.active .pending-indicator").inner_text()).strip()
    assert badge2 == "+1", f"single pending badge missing: {badge2!r}"
    return {"pending": pending, "badges": badges}


async def test_setup_throw_order(page):
    # a9: standard-player order supports pointer drag, accessible arrows,
    # deterministic randomization, and survives beginMatch + Play Again.
    await fresh(page)
    await page.select_option("#numPlayers", "4")
    names = ["Alpha", "Bravo", "Charlie", "Delta"]
    for index, name in enumerate(names, 1):
        await page.fill(f"#player{index}", name)

    # Portrait tablet: four players should be balanced as a 2×2 card grid,
    # with each name field using the full card width beneath its controls.
    await page.set_viewport_size({"width": 744, "height": 1133})
    portrait = await page.evaluate("""
        () => {
            const rows = [1,2,3,4].map(index => {
                const row = document.getElementById(`player${index}Group`).getBoundingClientRect();
                const input = document.getElementById(`player${index}`).getBoundingClientRect();
                return {left:row.left, top:row.top, right:row.right, bottom:row.bottom,
                        width:row.width, inputLeft:input.left, inputRight:input.right,
                        inputTop:input.top};
            });
            return rows;
        }
    """)
    tolerance = 3
    assert abs(portrait[0]["top"] - portrait[1]["top"]) <= tolerance, portrait
    assert abs(portrait[2]["top"] - portrait[3]["top"]) <= tolerance, portrait
    assert portrait[2]["top"] > portrait[0]["bottom"], portrait
    assert portrait[1]["left"] > portrait[0]["right"], portrait
    assert portrait[3]["left"] > portrait[2]["right"], portrait
    for row in portrait:
        assert row["inputTop"] > row["top"], row
        assert row["inputLeft"] <= row["left"] + 15 and row["inputRight"] >= row["right"] - 15, row

    # Phone portrait falls back to a clean one-column stack.
    await page.set_viewport_size({"width": 390, "height": 844})
    phone_lefts = await page.eval_on_selector_all(
        "#playerOrderList .player-row:not(.hidden)",
        "rows => rows.map(row => Math.round(row.getBoundingClientRect().left))")
    assert max(phone_lefts) - min(phone_lefts) <= 2, phone_lefts
    await page.set_viewport_size({"width": 900, "height": 1600})

    labels = await page.eval_on_selector_all(
        "[data-player-order-label]", "els => els.map(el => el.textContent.trim())")
    assert labels == ["Throws 1st", "Throws 2nd", "Throws 3rd", "Throws 4th"], labels

    # Drag Alpha from first to third. Drop in the upper half of slot 3 so
    # the insertion index is exactly 2.
    await drag_locator_to(
        page,
        page.locator("[data-player-drag-index='0']"),
        page.locator("#player3Group"),
        target_y_ratio=0.25,
    )
    dragged = [await page.input_value(f"#player{i}") for i in range(1, 5)]
    assert dragged == ["Bravo", "Charlie", "Alpha", "Delta"], f"drag order = {dragged}"

    # Arrow fallback moves Alpha one place earlier.
    await page.click("#player3Group [data-player-order-action='up']")
    arrowed = [await page.input_value(f"#player{i}") for i in range(1, 5)]
    assert arrowed == ["Bravo", "Alpha", "Charlie", "Delta"], f"arrow order = {arrowed}"

    # Restore a known order, then force Fisher-Yates picks to index 0.
    for index, name in enumerate(names, 1):
        await page.fill(f"#player{index}", name)
    await page.evaluate("window.__testRandom = Math.random; Math.random = () => 0")
    await page.click("#randomizePlayersBtn")
    await page.evaluate("Math.random = window.__testRandom; delete window.__testRandom")
    randomized = [await page.input_value(f"#player{i}") for i in range(1, 5)]
    assert randomized == ["Bravo", "Charlie", "Delta", "Alpha"], randomized

    await start_game(page, "501", num_players="4")
    started = await get_state(page, "m.game.players.map(p => p.name)")
    assert started == randomized, f"beginMatch lost order: {started}"

    saved_order = await page.evaluate(
        "JSON.parse(localStorage.getItem('blakeout_configs')).lastConfig")
    assert [saved_order[f"player{i}"] for i in range(1, 5)] == randomized, \
        f"last config lost order: {saved_order}"

    await page.evaluate("(async () => (await import('./js/setup.js')).playAgain())()")
    await page.wait_for_timeout(350)
    replayed = await get_state(page, "m.game.players.map(p => p.name)")
    assert replayed == randomized, f"Play Again lost order: {replayed}"
    return {"dragged": dragged, "randomized": randomized, "replayed": replayed}


async def test_team_throw_order(page):
    # Team randomization is constrained to each team's members, while the
    # independent Home/Away first-team selection remains intact.
    await fresh(page)
    await page.select_option("#gameType", "501")
    await page.check("#teamMode")
    await page.click("#startGameBtn")
    await page.wait_for_selector("#teamBuilderScreen", state="visible")

    for name in ("Alpha", "Bravo", "Charlie", "Delta"):
        await page.fill("#teamAddName", name)
        await page.click("#teamAddBtn")

    async def assign(name, zone):
        await page.locator(".team-chip", has_text=name).click()
        await page.click(f"#teamZone{zone}Label")

    await assign("Alpha", 0)
    await assign("Bravo", 0)
    await assign("Charlie", 1)
    await assign("Delta", 1)

    # Same-zone pointer drag: Alpha below Bravo. Previously same-zone drops
    # were ignored and only the arrow fallback could reorder a team.
    zone0_members = page.locator("#teamZone0Members .team-zone-member")
    await drag_locator_to(page, zone0_members.nth(0), zone0_members.nth(1), target_y_ratio=0.85)
    home_after_drag = await page.eval_on_selector_all(
        "#teamZone0Members .team-zone-member-name",
        "els => els.map(el => el.textContent.replace(/^\\s*\\d+\\.\\s*/, '').trim())",
    )
    assert home_after_drag == ["Bravo", "Alpha"], f"same-team drag = {home_after_drag}"

    # Away throws first; randomization must not change that choice or move
    # anyone between Home and Away.
    await page.click("#teamSwapFirstBtn")
    await page.evaluate("window.__testRandom = Math.random; Math.random = () => 0")
    await page.click("#teamRandomizeBtn")
    await page.evaluate("Math.random = window.__testRandom; delete window.__testRandom")

    await page.click("#teamStartMatchBtn")
    await page.wait_for_timeout(350)
    state = await get_state(page, "({players:m.game.players.map(p=>p.name), teams:m.game.teams})")
    assert state["players"] == ["Away", "Home"], f"first-team choice lost: {state['players']}"
    away_members = [p["name"] for p in state["teams"][0]["members"]]
    home_members = [p["name"] for p in state["teams"][1]["members"]]
    assert away_members == ["Delta", "Charlie"], away_members
    assert home_members == ["Alpha", "Bravo"], home_members

    # Rotation and Play Again must not mutate the selected member order.
    await page.evaluate("""
        (async () => {
            const teams = await import('./js/teams.js');
            teams.advanceRotation(0);
            teams.advanceRotation(1);
            (await import('./js/setup.js')).playAgain();
        })()
    """)
    await page.wait_for_timeout(350)
    replay = await get_state(page, "m.game.teams")
    assert [p["name"] for p in replay[0]["members"]] == away_members
    assert [p["name"] for p in replay[1]["members"]] == home_members
    assert [team["rotationIndex"] for team in replay] == [0, 0]
    return {"away_first": away_members, "home_second": home_members}


async def test_multiplayer_score_visibility(page):
    # Representative responsive matrix: compact phone through large tablet,
    # portrait + landscape, both engines, 3/4 players, and scale extremes.
    scenarios = [
        (390, 844, 1.5, 4, "cricket"),
        (390, 844, 1.5, 4, "501"),
        (600, 960, 1.5, 3, "cricket"),
        (744, 1133, 0.7, 3, "501"),
        (744, 1133, 1.0, 4, "501"),
        (900, 1200, 1.5, 4, "cricket"),
        (1024, 700, 1.5, 4, "501"),
    ]
    checked = []

    for width, height, scale, count, game_type in scenarios:
        await page.set_viewport_size({"width": width, "height": height})
        await page.evaluate("localStorage.removeItem('blakeout_active_game')")
        await page.reload(wait_until="domcontentloaded")
        await page.wait_for_timeout(250)
        await page.select_option("#numPlayers", str(count))
        for index in range(1, count + 1):
            await page.fill(f"#player{index}", f"Long Player Name Number {index}")
        await set_ui_scale(page, scale)
        await start_game(page, game_type, num_players=str(count))

        # Include four digits so this guard also covers planned 901/1101/1501.
        score_ids = ["homeScore", "awayScore", "player3Score", "player4Score"][:count]
        score_values = ["1501", "1000", "999", "180"][:count]
        await page.evaluate(
            """pairs => pairs.forEach(([id, value]) => {
                document.getElementById(id).textContent = value;
            })""",
            list(zip(score_ids, score_values)),
        )

        metrics = await page.evaluate(
            """({ count, gameType }) => {
                const scoreIds = ['homeScore','awayScore','player3Score','player4Score'].slice(0, count);
                const headerIds = ['homeHeader','awayHeader','player3Header','player4Header'].slice(0, count);
                const rect = el => {
                    const r = el.getBoundingClientRect();
                    return { left:r.left, right:r.right, top:r.top, bottom:r.bottom,
                             width:r.width, height:r.height };
                };
                const scores = scoreIds.map((id, index) => {
                    const el = document.getElementById(id);
                    const owner = document.getElementById(headerIds[index]);
                    const style = getComputedStyle(el);
                    return { id, box:rect(el), owner:rect(owner), clientWidth:el.clientWidth,
                             scrollWidth:el.scrollWidth, fontSize:parseFloat(style.fontSize),
                             display:style.display, visibility:style.visibility };
                });
                const header = document.getElementById('scoreHeader');
                const visibleChildren = [...header.children]
                    .filter(el => getComputedStyle(el).display !== 'none')
                    .map(el => ({ id:el.id || el.className, box:rect(el) }))
                    .sort((a,b) => a.box.left - b.box.left);
                const main = document.getElementById(gameType === '501' ? 'x01Main' : 'cricketMain');
                return {
                    scores, visibleChildren, header:rect(header), main:rect(main),
                    innerWidth:window.innerWidth, innerHeight:window.innerHeight,
                    documentWidth:document.documentElement.scrollWidth
                };
            }""",
            {"count": count, "gameType": game_type},
        )
        tag = f"{game_type}/{count}p/{width}x{height}/{scale}x"
        for score in metrics["scores"]:
            assert score["display"] != "none" and score["visibility"] != "hidden", \
                f"{tag} {score['id']} hidden"
            assert score["box"]["width"] > 0 and score["box"]["height"] > 0, \
                f"{tag} {score['id']} has no size"
            assert score["scrollWidth"] <= score["clientWidth"] + 1, \
                f"{tag} {score['id']} text clips: {score}"
            assert score["fontSize"] >= 18, f"{tag} {score['id']} too small: {score['fontSize']}px"
            assert score["box"]["left"] >= score["owner"]["left"] - 1 \
                and score["box"]["right"] <= score["owner"]["right"] + 1, \
                f"{tag} {score['id']} escaped player header: {score}"

        children = metrics["visibleChildren"]
        for left, right in zip(children, children[1:]):
            assert left["box"]["right"] <= right["box"]["left"] + 1, \
                f"{tag} header columns overlap: {left} vs {right}"
        assert metrics["header"]["left"] >= -1 and metrics["header"]["right"] <= width + 1, \
            f"{tag} header outside viewport: {metrics['header']}"
        assert metrics["header"]["height"] <= height * 0.35, \
            f"{tag} header consumes too much height: {metrics['header']['height']}"
        assert metrics["main"]["height"] >= 80, f"{tag} scoring area collapsed: {metrics['main']}"
        assert metrics["documentWidth"] <= metrics["innerWidth"] + 1, \
            f"{tag} horizontal page overflow: {metrics['documentWidth']} > {metrics['innerWidth']}"
        checked.append(tag)

    return {"scenarios": checked}


async def test_multiplayer_cricket_grid_fit(page):
    # At the hardest supported layout (compact phone, four players, 1.5x),
    # each cricket variant must keep buttons in the center lane and marks in
    # their own player cells. Scrolling vertically is allowed for long boards.
    await page.set_viewport_size({"width": 390, "height": 844})
    checked = {}
    for game_type in ("cricket", "spanish", "minnesota"):
        await page.evaluate("localStorage.removeItem('blakeout_active_game')")
        await page.reload(wait_until="domcontentloaded")
        await page.wait_for_timeout(250)
        await set_ui_scale(page, 1.5)
        await start_game(page, game_type, num_players="4")
        layout = await page.evaluate("""
            () => {
                const rect = el => {
                    const r = el.getBoundingClientRect();
                    return {left:r.left, right:r.right, top:r.top, bottom:r.bottom,
                            width:r.width, height:r.height};
                };
                const failures = [];
                document.querySelectorAll('.cricket-row').forEach((row, rowIndex) => {
                    const lane = row.querySelector('.buttons-container') || row.querySelector('.cricket-buttons');
                    const laneRect = rect(lane);
                    row.querySelectorAll('.cricket-buttons button:not(.fake-spacer)').forEach(button => {
                        const box = rect(button);
                        if (box.left < laneRect.left - 1 || box.right > laneRect.right + 1) {
                            failures.push({kind:'button', row:rowIndex, box, lane:laneRect});
                        }
                    });
                    row.querySelectorAll('.cricket-cell .mark').forEach(mark => {
                        const box = rect(mark);
                        const cell = rect(mark.closest('.cricket-cell'));
                        if (box.left < cell.left - 1 || box.right > cell.right + 1) {
                            failures.push({kind:'mark', row:rowIndex, box, cell});
                        }
                    });
                });
                const main = document.getElementById('cricketMain');
                const controls = document.getElementById('cricketControls');
                return {failures, rows:document.querySelectorAll('.cricket-row').length,
                        main:rect(main), controls:rect(controls), innerHeight:window.innerHeight};
            }
        """)
        assert not layout["failures"], f"{game_type} compact overlap: {layout['failures'][:3]}"
        assert layout["main"]["height"] >= 80, f"{game_type} main collapsed: {layout['main']}"
        assert layout["controls"]["bottom"] <= layout["innerHeight"] + 1, \
            f"{game_type} controls clipped: {layout['controls']}"
        checked[game_type] = layout["rows"]
    return {"rows": checked}


async def test_multiplayer_cricket_marks_visible(page):
    # Regression: real slash/X/O marks used to enlarge beyond their rows and
    # columns at >1x scale. The active lane also rendered as stacked colored
    # boxes, while separator borders cut through the center of the play area.
    scenarios = [
        (390, 844, 4, "cricket"),
        (744, 1133, 3, "cricket"),
        (744, 1133, 4, "cricket"),
        (744, 1133, 4, "spanish"),
        (744, 1133, 4, "minnesota"),
        (1133, 744, 4, "cricket"),
    ]
    checked = []
    for width, height, count, game_type in scenarios:
        await page.set_viewport_size({"width": width, "height": height})
        await page.evaluate("localStorage.removeItem('blakeout_active_game')")
        await page.reload(wait_until="domcontentloaded")
        await page.wait_for_timeout(250)
        await set_ui_scale(page, 1.5)
        await start_game(page, game_type, num_players=str(count))
        await page.evaluate("""
            async () => {
                const state = await import('./js/state.js');
                const cricket = await import('./js/cricket.js');
                state.game.players.forEach((player, playerIndex) => {
                    state.game.cricketTargets.forEach((target, targetIndex) => {
                        const marks = (playerIndex + targetIndex) % 4;
                        const data = player.cricketData[target];
                        data.marks = marks;
                        data.closed = marks >= 3;
                        data.closedInOneTurn = marks >= 3;
                        data.marksBeforeClose = 0;
                    });
                });
                cricket.updateCricketDisplay();
            }
        """)
        metrics = await page.evaluate("""
            () => {
                const rect = element => {
                    const box = element.getBoundingClientRect();
                    return {left:box.left, right:box.right, top:box.top,
                            bottom:box.bottom, width:box.width, height:box.height};
                };
                const failures = [];
                document.querySelectorAll('.cricket-row').forEach((row, rowIndex) => {
                    const rowBox = rect(row);
                    row.querySelectorAll('.cricket-cell').forEach((cell, cellIndex) => {
                        const cellBox = rect(cell);
                        const style = getComputedStyle(cell);
                        if (parseFloat(style.borderLeftWidth) || parseFloat(style.borderRightWidth)) {
                            failures.push({kind:'separator', row:rowIndex, cell:cellIndex,
                                           left:style.borderLeftWidth, right:style.borderRightWidth});
                        }
                        if (cell.classList.contains('active')) {
                            if (style.backgroundImage !== 'none'
                                    || style.backgroundColor !== 'rgba(0, 0, 0, 0)'
                                    || style.boxShadow !== 'none') {
                                failures.push({kind:'active-box', row:rowIndex, cell:cellIndex,
                                               background:style.backgroundColor,
                                               image:style.backgroundImage, shadow:style.boxShadow});
                            }
                        }
                        cell.querySelectorAll('.mark:not(:empty)').forEach(mark => {
                            const box = rect(mark);
                            if (box.left < cellBox.left - 1 || box.right > cellBox.right + 1
                                    || box.top < rowBox.top - 1 || box.bottom > rowBox.bottom + 1) {
                                failures.push({kind:'clipped-mark', row:rowIndex, cell:cellIndex,
                                               box, cellBox, rowBox});
                            }
                            if (box.width < 20 || box.height < 20) {
                                failures.push({kind:'tiny-mark', row:rowIndex, cell:cellIndex, box});
                            }
                        });
                    });
                });
                return {failures, documentWidth:document.documentElement.scrollWidth,
                        viewportWidth:window.innerWidth};
            }
        """)
        tag = f"{game_type}/{count}p/{width}x{height}/1.5x"
        assert not metrics["failures"], f"{tag}: {metrics['failures'][:4]}"
        assert metrics["documentWidth"] <= metrics["viewportWidth"] + 1, \
            f"{tag}: horizontal overflow {metrics}"
        checked.append(tag)
    return {"scenarios": checked}


async def test_header_fit_four_player(page):
    # Header crowding fix: with 4 players the two score boxes sharing a
    # side must not overlap, even with 3-digit scores (900px viewport).
    await dismiss_onboard(page)
    await start_game(page, "cricket", num_players="4")
    await page.wait_for_selector("#cricketMain", state="visible", timeout=3000)
    await page.evaluate("""
        ['homeScore','awayScore','player3Score','player4Score'].forEach((id, i) => {
            document.getElementById(id).textContent = [188, 142, 96, 205][i];
        });
    """)
    boxes = {}
    for pid in ("homeScore", "awayScore", "player3Score", "player4Score"):
        boxes[pid] = await page.locator(f"#{pid}").bounding_box()
        assert boxes[pid], f"{pid} has no bounding box"
    # Left pair and right pair must not intersect horizontally
    assert boxes["homeScore"]["x"] + boxes["homeScore"]["width"] <= boxes["awayScore"]["x"] + 1, \
        f"home/away score boxes overlap: {boxes['homeScore']} vs {boxes['awayScore']}"
    assert boxes["player3Score"]["x"] + boxes["player3Score"]["width"] <= boxes["player4Score"]["x"] + 1, \
        f"p3/p4 score boxes overlap: {boxes['player3Score']} vs {boxes['player4Score']}"
    # And every box stays inside the viewport
    for pid, b in boxes.items():
        assert b["x"] >= 0 and b["x"] + b["width"] <= 900, f"{pid} clipped: {b}"
    return {"boxes": {k: round(v["width"]) for k, v in boxes.items()}}


# ---------------------------------------------------------------- runner

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
        return {"ok": True, "result": result, "console": errors,
                "screenshot": str(shot_path) if keep_screens else None}
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


async def main_async(only, keep_screens):
    OUT.mkdir(exist_ok=True)
    screens = OUT / "screens"
    screens.mkdir(exist_ok=True)

    srv = subprocess.Popen(
        ["python3", "-m", "http.server", str(PORT), "--bind", "127.0.0.1"],
        cwd=str(DEV_ROOT), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    time.sleep(1.2)
    try:
        from playwright.async_api import async_playwright
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            ctx = await browser.new_context(viewport={"width": 900, "height": 1600})

            # Warm-up: first load installs the service worker, which fires a
            # one-time controllerchange → location.reload(). Let that happen
            # on a throwaway page so it can't destroy a test mid-flight.
            warm = await ctx.new_page()
            await warm.goto(f"http://127.0.0.1:{PORT}/index.html",
                            wait_until="domcontentloaded", timeout=10000)
            await warm.wait_for_timeout(1800)
            await warm.close()

            results = {}
            tests = discover()
            names = [only] if only else list(tests.keys())
            for name in names:
                if name not in tests:
                    print(f"!! unknown test: {name}", file=sys.stderr)
                    continue
                page = await ctx.new_page()
                await page.goto(f"http://127.0.0.1:{PORT}/index.html",
                                wait_until="domcontentloaded", timeout=10000)
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
    ap.add_argument("--only", help="run a single test by name (without test_ prefix)")
    ap.add_argument("--keep-screenshots", action="store_true")
    args = ap.parse_args()
    sys.exit(asyncio.run(main_async(args.only, args.keep_screenshots)))


if __name__ == "__main__":
    main()
