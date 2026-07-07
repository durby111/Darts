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

            await browser.close()
    finally:
        srv.terminate()
        srv.wait()
    print(f"shots → {OUT}")


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
