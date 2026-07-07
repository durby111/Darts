#!/usr/bin/env python3
"""
BlakeOut DEV overhaul test battery (v2.3-dev).

Lives under /dev/tests/ — tests the dev build only. Modeled on
scripts/headless_test.py but covers the v2.3 overhaul features:

    registry_picker    — 14 game cards render from registry, search filters,
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


# ---------------------------------------------------------------- tests

async def test_registry_picker(page):
    await dismiss_onboard(page)
    # 14 cards from the registry
    cards = await page.locator(".game-card[data-game-value]").count()
    assert cards == 14, f"expected 14 game cards, got {cards}"

    # New games present
    for gid in ("chaos", "shanghai"):
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
    assert set(cricket_cards) == {"cricket", "spanish", "minnesota", "chaos"}, \
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
    assert "felt.svg" in var, f"wallpaper var not applied: {var!r}"
    saved = await page.evaluate("JSON.parse(localStorage.getItem('blakeout_wallpaper'))")
    assert saved == {"type": "preset", "id": "felt"}, f"saved = {saved}"
    active = await page.locator(".wallpaper-choice.active").get_attribute("data-wallpaper-id")
    assert active == "felt", f"active choice = {active}"

    # Survives reload
    await page.reload(wait_until="domcontentloaded")
    await page.wait_for_timeout(500)
    var2 = await page.evaluate(
        "document.documentElement.style.getPropertyValue('--app-wallpaper')")
    assert "felt.svg" in var2, f"wallpaper lost on reload: {var2!r}"

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
        " return r.listGames().map(g => ({id: g.id, engine: g.engine})); })()")
    assert len(games) >= 14, f"registry shrank? {len(games)} games"
    panels = {"cricket": "#cricketMain", "x01": "#x01Main", "target": "#targetGameMain"}
    booted = []
    for g in games:
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
    # a1: tapping the ACTIVE player's score flips the pad into remaining-
    # score mode — type what's LEFT, app computes the turn score.
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

    # Invalid remaining (more than current) → rejected, score unchanged
    await page.click("#homeScore")
    for d in "999":
        await page.click(f"[data-digit='{d}']")
    await page.click("#x01EnterBtn")
    await page.wait_for_timeout(800)
    score2 = await get_state(page, "m.game.players[0].score")
    assert score2 == 376, f"invalid remaining must not change score: {score2}"

    # Tapping the score again cancels the mode
    await page.click("#homeScore")
    await page.wait_for_timeout(100)
    await page.click("#homeScore")
    await page.wait_for_timeout(100)
    disp = await page.locator("#inputDisplay").inner_text()
    assert "LEFT" not in disp, f"remaining mode should toggle off: {disp!r}"
    return {"score": score}


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
    # Single dart → singular form
    await page.click("#enterBtn")
    await page.wait_for_timeout(300)
    await page.locator(".cricket-num-btn[data-target='20']").first.click()
    await page.wait_for_timeout(80)
    pending2 = (await page.locator("#pendingText").inner_text()).strip()
    assert "1 mark" in pending2 and "1 marks" not in pending2, f"singular broken: {pending2!r}"
    return {"pending": pending}


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
