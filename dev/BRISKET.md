# Brisket — local DEV candidate

Burt's game uses the existing Cricket engine. The confirmed default is **1–6
plus Bull, with points**. Three marks close a target; further marks score that
target's actual face value while an opponent has it open. Bull remains 25 per
excess mark, with single/double Bull and no triple. Close all targets with at
least the opponents' scores to win. Disabling points gives the existing closure
race behavior.

Choose a starting number from 1 through 15 for exactly six consecutive targets.
Every range is labeled: 1–6, 2–7, …, 7–12, …, 13–18, 14–19, 15–20. Bull can be
turned off. There is no wrapping, seventh numbered target, physical opposite
mapping or ounce-themed variant. The approximate spoken 13–19 example is
represented by explicitly labeled six-number ranges, not silently seven numbers.

The setup and in-game header show a small native SVG tattoo-style heart/dart
badge reading “Burt,” with accessible idea credit. No biographical information,
external image request or new dependency is included. It is hidden in other games.

Range/Bull preferences travel with presets. Active saves already contain their
exact Cricket targets and pending darts, so reopening a game does not reinterpret
it through the latest setup selection. Existing save keys and ordinary Cricket
behavior are retained. Like ordinary unrecorded Cricket, its undo stack works
during the session but is not retained across reload; scores and pending darts
are retained. No history/account access or bot support is opened. Simple mode
remains 301/501/Minnesota; Brisket appears only in the modern DEV game list.

## Checks

`node dev/tests/brisket_test.mjs` checks all 15 range definitions and invalid
starts, default Bull and ordinary Cricket isolation, then six isolated rendered
groups: defaults/presets, picker/credit/layout, scoring/undo/save recovery,
closed-number and Bull points, victory, and points-off play. It uses installed
Playwright/Chromium with all external traffic blocked and synthetic storage.
Set BLAKEOUT_PLAYWRIGHT_MODULE and BLAKEOUT_CHROMIUM if needed; optional
BLAKEOUT_QA_OUTPUT holds screenshots outside the source tree.

Shared checks: startup/simple-mode suite (16 rendered groups), modern setup
ordering/Start/Play Again, player-setup unit suite (8), build isolation (9),
BotBlake engine tests and offline module closure (62 modules). Screenshot layouts
were reviewed at 744px and 390px. The expected modern picker count is now 30.

No physical-device/Safari acceptance, real-account testing, publication or
production promotion is claimed. This candidate's DEV cache is v82; deployed
DEV remains v81 until a separately authorized GitHub-first release.
