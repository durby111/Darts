# Player setup review (November 1)

DEV-only reconciliation of Duet's first-pass patch against `489e22c`.
Existing drag handles and arrows are enlarged, not duplicated. Handles also
support tap-to-pick/tap-to-place, same-handle cancellation and Escape. Reordering
retains each player's Human/BotBlake skill. Team-mode changes cancel a picked row.

Name suggestions are inline buttons sourced only from the build-scoped recent
name list on this browser/device. Classic human names entered at Start are kept
up to 12 entries; defaults and BotBlake names are omitted. Suggestions do not use
account profiles, roster caches, last configurations or saved presets. Selecting
one fills display text only. Clear removes only the recent list and reports
blocked-storage failures; presets, games and history remain untouched.

Review corrections: restored corrupted control glyphs from the baseline, kept
chip buttons available through keyboard focus, guarded storage access, removed
fallback suggestion sources, removed the fixture's catch-all initialization
suppression, and updated the DEV worker cache to v80. No production-root,
authentication, backend or scoring implementation changes.

## Validation

Eight unit/DOM groups pass in `player_setup_ux_test.mjs`. Rendered Chromium tests
pass ten groups, including setup ordering and all seven scenarios translated
from `botblake_review_test.py`: settings pause, builder typing, ten supported
game modes, initial player/config ordering, Cutthroat targeting, team average
undo/redo/reload and keyboard navigation. External requests are blocked and a
fresh isolated browser context is used for each case. No real accounts are used.

Layout checks include 744x1133, 390x1133 and 1280x1133, name inputs at least 160px
wide, controls at least 44px, no horizontal overflow, mouse drag, keyboard chips,
touch-emulated tap order, Start and Play Again. Physical tablet touch is untested.
Offline module closure passes for 62 modules. Syntax/whitespace checks pass.

The Windows baseline has six existing failures, reproduced before this patch:
`brackets_confirmations_test` and `start_lock_feedback_test` (fixture extraction),
`feature_availability_test` (python3 EACCES), `mock_preview_test` (path separators),
`platform_appearance_test` (literal-color count), `production_release_test`
(historical production state comparison). Other static suites pass. The original
Python rendered runners could not run here because Python Playwright is absent;
the Node runner preserves the relevant assertions using installed Playwright.

## Commands

Use Node with jsdom and Playwright installed outside application assets. Set
`BLAKEOUT_JSDOM_MODULE` and `BLAKEOUT_PLAYWRIGHT_MODULE` to their module locations
if they are not resolvable normally. `BLAKEOUT_CHROMIUM` optionally selects an
installed Chromium/Chrome executable; `BLAKEOUT_QA_OUTPUT` saves local screenshots
and JSON evidence. The rendered runner is separate from static suite execution.

```sh
node --experimental-vm-modules dev/tests/player_setup_ux_test.mjs
node --experimental-vm-modules dev/tests/offline_module_graph_test.mjs
node dev/tests/player_setup_ux_browser_test.mjs
```

Before broader release, check keyboard/touch on the actual shared tablet, including
typing with its on-screen keyboard, dragging, canceling a move, choosing a recent
name, clearing names and switching Human/BotBlake/team modes. Existing accounts
and histories must remain separate from these display-name suggestions.
