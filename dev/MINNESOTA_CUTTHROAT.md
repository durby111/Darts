# Minnesota Cutthroat — scoped release, October 16, 2026

Choose **Minnesota**, then enable **Cutthroat** in the game options. This is an
option on the existing game, not a separate registry game. Normal Minnesota
remains the default, including old saved setups without the new option.

Cutthroat requires at least two players or teams and always enables points.
Excess number/Bull marks and the actual entered score for a closed Triples,
Doubles or Bed row penalize each opponent whose corresponding row is open.
Closed opponents are immune; the thrower's own score does not increase. Close
all rows and have the lowest or tied-lowest score to win.

The option survives saved setup, pending darts/keypad input, active-game reload,
team rotation, undo/redo and play again. A visible scorer notice identifies the
mode. Local tournament defaults, bracket overrides, round overrides and individual
match overrides carry the same option. An explicit normal-Minnesota override
does not inherit Cutthroat from the event default. An active scorer's mode cannot
be changed underneath it.

Recorded scoring uses the correct low-score early-win check, including when a
later dart in the visit lowers the thrower's relative position by penalizing an
opponent. Darts entered after the actual winning dart are excluded. A non-winning
partial visit rolls back until all actual darts are entered. Scoring marks count
physical marks once, not once per penalized opponent; recorded `points` are total
penalties delivered. Minnesota Cutthroat receipts/legs are explicitly labeled.
No real account/lifetime-stat rollout is part of this release.

## Scope

Production changes are restricted to `index.html`, `sw.js`, and shared
`js/cricket.js`, `js/setup.js`, `js/state.js`, `js/scoring-records.js`, and
`js/registry.js`. Production worker cache: `blakeout-v56-minnesota-cutthroat`.
DEV worker cache: `blakeout-dev-v66-minnesota-cutthroat`.

Production account and bracket Coming Soon gates, Firebase configuration,
permissions/rules, email services and the production tournament bridge remain
unchanged. Device-local tournament integration is confined to DEV. Existing
storage keys, saved presets and other-build active games are preserved.

## Evidence

- `tests/minnesota_cutthroat_test.py`: rendered production and DEV source; three
  and four players, number and all special-row penalties, closed-row immunity,
  pending previews, undo/redo, reload, lowest/tied-lowest wins, higher-score
  rejection, normal Minnesota wins, saved setup and legacy presets, minimum
  player controls, two-person teams and rotation. DEV additionally plays actual
  Cutthroat and normal Minnesota scorer matches through a local tournament to a
  champion, testing all format override levels and exact receipt labels.
- `tests/minnesota_recorded_edges_test.py`: explicitly seeded near-win boards
  with rendered dart entry, partial-visit rollback, early-win truncation,
  points/marks/darts accounting, undo/recommit/save, interrupted special keypad,
  and rejection of a mode change while scoring is in progress.
- `tests/minnesota_release_test.py`: production file allowlist, unchanged gates
  and backend files, real worker installation/cache cleanup, retained presets
  and DEV save, 390px mobile layout and actual offline Cutthroat resume.
- Existing JavaScript suites, scorer/bridge checks, navigation tests, bracket
  engine tests and local tournament boundary tests are run separately. The full
  aggregate runner now uses available Chromium and blocks external requests so
  local regressions cannot contact a real backend.

The initial team-rotation test clicked an existing member at the center of the
zone instead of placing the next player. Targeting the visible zone label fixed
that test interaction; actual two-person team rotation passed. The aggregate
runner initially lacked its bundled Playwright browser; it now uses installed
Chromium without needing a browser download.

Screenshots, traces and logs are retained in
`/workspace/scratch/minnesota-cutthroat-20261016/`. Near-win fixtures are separate
from the end-to-end local tournament, whose wins come from actual scorer input.
Physical touch devices and non-Chromium browsers have not been exercised. Live
site checks and Pages deployment status are reported separately from local
browser evidence. No real Firebase, OAuth, email or account writes are tested.

Aggregate harness corrections: the service-worker predicate now evaluates its
real scope helper instead of an incomplete extracted function. Winner layout
checks distinguish the deliberately clipped watermark from content overflow;
the original assertion also failed on unchanged commit `4c150cc`. The winner
fixture now expects cloud saving to remain disabled by existing DEV gates.
The QR test uses the pinned `zxing-cpp==3.1.1` dependency. No runtime winner
styling or feature-gate changes were made for these harness corrections.

Final verification: aggregate 57/57; 16 JavaScript suites; scorer/bridge 62
checks; navigation 16/16; bracket engine 8/8 (186 completed simulations);
local tournament edge tests 7 groups; focused Minnesota production 5 groups,
DEV 6 groups, recorded edges 3 groups; production release/offline checks passed.
