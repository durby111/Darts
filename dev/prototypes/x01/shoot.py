#!/usr/bin/env python3
"""Render the x01 UI concepts for the design panel.

THROWAWAY, alongside the prototypes it shoots. Not part of the pass/fail
battery in dev/tests/.

Also captures a baseline of the live dev x01 screen (501, 2 players) so the
concepts are judged against what actually ships today rather than memory.
The current finalists are also captured at phone size.

    python3 dev/prototypes/x01/shoot.py

Output: /tmp/blakeout_x01_concepts/
"""

import asyncio
import subprocess
import sys
import time
from pathlib import Path

DEV_ROOT = Path(__file__).resolve().parents[2]
OUT = Path("/tmp/blakeout_x01_concepts")
PORT = 8831
VIEWPORT = {"width": 744, "height": 1133}
PHONE_VIEWPORT = {"width": 390, "height": 844}

CONCEPTS = [
    ("01-oche", "Oche"),
    ("02-broadcast", "Broadcast"),
    ("03-slate", "Slate"),
    ("04-splitthumb", "Split Thumb"),
    ("05-threedarts", "Three Darts"),
    ("06-arcade", "Arcade"),
    ("07-cardstack", "Card Stack"),
    ("08-proconsole", "Pro Console"),
    ("09-hybrid", "Hybrid Total Entry"),
    ("10-hybrid-perdart", "Hybrid Per-Dart"),
    ("11-dc-mode", "DC Mode"),
]

PHONE_CONCEPTS = CONCEPTS[-3:]


async def capture_baseline(page, base):
    """Current dev x01 screen, mid-leg, so the panel sees the real starting point."""
    await page.goto(f"{base}/index.html", wait_until="domcontentloaded")
    await page.wait_for_timeout(1200)
    await page.evaluate("localStorage.removeItem('blakeout_active_game')")
    await page.goto(f"{base}/index.html", wait_until="domcontentloaded")
    await page.wait_for_timeout(900)

    await page.select_option("#gameType", "501")
    await page.select_option("#numPlayers", "2")
    await page.click("#startGameBtn")
    await page.wait_for_timeout(500)

    # Play six visits so the history lanes and checkout bar are populated —
    # an empty board hides most of what the panel needs to judge.
    for total in (60, 41, 81, 60, 45, 26, 26, 60, 60, 45, 59, 54):
        for digit in str(total):
            await page.click(f'[data-digit="{digit}"]')
            await page.wait_for_timeout(40)
        await page.click("#x01EnterBtn")
        await page.wait_for_timeout(140)

    # Leave a partially typed turn so the live preview + delta chip show.
    await page.click('[data-digit="6"]')
    await page.click('[data-digit="0"]')
    await page.wait_for_timeout(350)
    await page.screenshot(path=str(OUT / "00-current.png"))


async def main():
    OUT.mkdir(exist_ok=True)
    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"],
        cwd=str(DEV_ROOT), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.2)
    base = f"http://127.0.0.1:{PORT}"

    try:
        try:
            from playwright.async_api import async_playwright
        except ModuleNotFoundError:
            print("Playwright is required: python3 -m pip install playwright", file=sys.stderr)
            return 2
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            ctx = await browser.new_context(viewport=VIEWPORT, device_scale_factor=2)
            page = await ctx.new_page()

            try:
                await capture_baseline(page, base)
                print("  ok  00-current (live dev x01)")
            except Exception as exc:  # noqa: BLE001 - baseline is best-effort
                print(f"  !!  baseline failed: {exc}")

            for slug, label in CONCEPTS:
                await page.goto(f"{base}/prototypes/x01/{slug}.html",
                                wait_until="networkidle")
                await page.wait_for_timeout(450)
                await page.screenshot(path=str(OUT / f"{slug}.png"))
                print(f"  ok  {slug} ({label})")

            await page.set_viewport_size(PHONE_VIEWPORT)
            for slug, label in PHONE_CONCEPTS:
                await page.goto(f"{base}/prototypes/x01/{slug}.html",
                                wait_until="networkidle")
                await page.wait_for_timeout(250)
                await page.screenshot(path=str(OUT / f"{slug}-phone.png"))
                print(f"  ok  {slug}-phone ({label})")

            await browser.close()
    finally:
        srv.terminate()

    print(f"\nWrote {len(list(OUT.glob('*.png')))} shots to {OUT}")


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
