#!/usr/bin/env python3
"""Visual QA snapshots for the dev overhaul — themes, picker, new games.
Dumps PNGs to /tmp/blakeout_dev_shots/. Not part of the pass/fail battery."""

import asyncio, subprocess, sys, time
from pathlib import Path

DEV_ROOT = Path(__file__).resolve().parent.parent
OUT = Path("/tmp/blakeout_dev_shots")
PORT = 8829


async def main():
    OUT.mkdir(exist_ok=True)
    srv = subprocess.Popen(
        ["python3", "-m", "http.server", str(PORT), "--bind", "127.0.0.1"],
        cwd=str(DEV_ROOT), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.2)
    try:
        from playwright.async_api import async_playwright
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            ctx = await browser.new_context(viewport={"width": 1280, "height": 800})
            page = await ctx.new_page()
            await page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="domcontentloaded")
            await page.wait_for_timeout(1500)

            # Setup screen in a few themes (picker now lives in the
            # settings modal — set via storage + reload instead)
            for theme in ("sunburst", "volt", "arctic", "miami"):
                await page.evaluate(f"localStorage.setItem('blakeout_theme', '{theme}')")
                await page.reload(wait_until="domcontentloaded")
                await page.wait_for_timeout(500)
                await page.screenshot(path=str(OUT / f"setup_{theme}.png"))

            # Settings modal itself
            await page.click("#settingsBtnSetup")
            await page.wait_for_timeout(500)
            await page.screenshot(path=str(OUT / "settings_modal.png"))
            await page.click("#settingsCloseBtn")
            await page.wait_for_timeout(200)

            # Chaos Cricket game screen in sunburst (bar theme)
            await page.evaluate("localStorage.setItem('blakeout_theme', 'sunburst')")
            await page.reload(wait_until="domcontentloaded")
            await page.wait_for_timeout(500)
            await page.select_option("#gameType", "chaos")
            await page.click("#startGameBtn")
            await page.wait_for_timeout(400)
            await page.screenshot(path=str(OUT / "game_chaos_sunburst.png"))

            # Shanghai game screen in volt
            await page.evaluate("localStorage.removeItem('blakeout_active_game')")
            await page.evaluate("localStorage.setItem('blakeout_theme', 'volt')")
            await page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="domcontentloaded")
            await page.wait_for_timeout(800)
            await page.select_option("#gameType", "shanghai")
            await page.click("#startGameBtn")
            await page.wait_for_timeout(400)
            await page.screenshot(path=str(OUT / "game_shanghai_volt.png"))

            # X01 in arctic (light) — legibility check
            await page.evaluate("localStorage.removeItem('blakeout_active_game')")
            await page.evaluate("localStorage.setItem('blakeout_theme', 'arctic')")
            await page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="domcontentloaded")
            await page.wait_for_timeout(800)
            await page.select_option("#gameType", "501")
            await page.click("#startGameBtn")
            await page.wait_for_timeout(400)
            await page.screenshot(path=str(OUT / "game_501_arctic.png"))

            async def open_standard_game(game_type, theme="blue", players="2",
                                         viewport=None, scale="1.0"):
                if viewport:
                    await page.set_viewport_size(viewport)
                await page.evaluate("localStorage.removeItem('blakeout_active_game')")
                await page.evaluate(
                    "theme => localStorage.setItem('blakeout_theme', theme)", theme)
                await page.goto(f"http://127.0.0.1:{PORT}/index.html",
                                wait_until="domcontentloaded")
                await page.wait_for_timeout(500)
                await page.select_option("#gameType", game_type)
                await page.select_option("#numPlayers", players)
                await page.evaluate("""scale => {
                    document.getElementById('teamMode').checked = false;
                    const slider = document.getElementById('uiScale');
                    slider.value = scale;
                    slider.dispatchEvent(new Event('input', {bubbles:true}));
                }""", scale)
                await page.click("#startGameBtn")
                await page.wait_for_timeout(400)

            # Dedicated and position-sensitive new game UIs.
            await open_standard_game("hammer", "inferno", viewport={"width": 900, "height": 1600})
            await page.screenshot(path=str(OUT / "game_hammer_inferno.png"))

            await open_standard_game("tictactoe", "neon")
            await page.screenshot(path=str(OUT / "game_tictactoe_neon.png"))

            await open_standard_game("doubledown", "royal")
            await page.screenshot(path=str(OUT / "game_doubledown_royal.png"))

            # Hard visibility case: four-digit X01, four players, max scale,
            # compact landscape tablet.
            await open_standard_game(
                "1501", "arctic", players="4",
                viewport={"width": 1024, "height": 700}, scale="1.5")
            await page.screenshot(path=str(OUT / "game_1501_4p_arctic_maxscale.png"))

            # Four-player Cricket with populated slash/X/O marks at max scale.
            # This catches clipped marks, boxed active lanes and stray column
            # separators that an empty-board screenshot cannot reveal.
            await open_standard_game(
                "cricket", "blue", players="4",
                viewport={"width": 744, "height": 1133}, scale="1.5")
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
                        });
                    });
                    cricket.updateCricketDisplay();
                }
            """)
            await page.screenshot(path=str(OUT / "game_cricket_4p_marks_maxscale.png"))

            # Official 2v2 Team Cricket board with all four individual mark
            # columns visible around the shared target lane.
            await page.set_viewport_size({"width": 900, "height": 1600})
            await page.evaluate("localStorage.removeItem('blakeout_active_game')")
            await page.evaluate("localStorage.setItem('blakeout_theme', 'royal')")
            await page.goto(f"http://127.0.0.1:{PORT}/index.html",
                            wait_until="domcontentloaded")
            await page.wait_for_timeout(500)
            await page.select_option("#gameType", "teamcricket")
            await page.click("#startGameBtn")
            await page.wait_for_selector("#teamBuilderScreen", state="visible")
            for name in ("Alpha", "Bravo", "Charlie", "Delta"):
                await page.fill("#teamAddName", name)
                await page.click("#teamAddBtn")
            for name, zone in (("Alpha", 0), ("Bravo", 0),
                               ("Charlie", 1), ("Delta", 1)):
                await page.locator(".team-chip", has_text=name).click()
                await page.click(f"#teamZone{zone}Label")
            await page.click("#teamStartMatchBtn")
            await page.wait_for_timeout(400)
            await page.screenshot(path=str(OUT / "game_teamcricket_royal.png"))

            await browser.close()
    finally:
        srv.terminate()
        srv.wait()
    print(f"shots → {OUT}")


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
