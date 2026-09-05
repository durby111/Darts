# BlakeOut v2.4.2-dev — Overhaul Notes

Dev-only release. Production (repo root) untouched — promote by copying
`/dev/` → root as usual, and fold these notes into `CLAUDE.md` at that time.

## September 4 Follow-Up List

- [x] Commit and push approved dry-erase Cricket marks: `773fd53` (dev only).
- [ ] Enable GitHub Pages **Enforce HTTPS** and verify HTTP redirects to HTTPS.
  Live HEAD and GET checks on September 4 returned HTTP 200 with the app at
  `http://blakeoutdarts.com/`, without redirecting. HTTPS certificate validation
  succeeded; HTTPS `www` redirects to the apex domain.
- [ ] Audit unused/orphaned app code in `dev/` and remove confirmed leftovers.
  Trace imports from the app entry point, registry dispatch, DOM/event hooks,
  dynamic CSS classes, and service-worker assets before deleting anything.
  Preserve tests, prototypes, configuration, and production files. Validate
  affected flows and the all-games boot test after removals.
- [ ] Review hosting hardening: live responses have no CSP, HSTS,
  X-Frame-Options, X-Content-Type-Options, or explicit Referrer-Policy header;
  the live HTML has no CSP meta policy either. CSP was previously deferred;
  revisit deliberately with Firebase, wallpaper, and offline regression checks.
- [ ] Verify GitHub/domain-registrar MFA, domain renewal/lock, and Pages domain
  verification in the owner accounts. These settings were not checked here.

Roster share links grant read/write/delete access to anyone holding the link.
The checked-in Firestore rules retain that capability-link model. The prior
audit records deployed-rule and API-key restriction checks on August 30;
those console settings and deployed rules were not reverified September 4.

## September 4 Setup Refresh (Dev Release)

- Theme-aware game library and match column replace the stacked setup card.
- Compact player rows, selected-game title, and fixed phone start bar.
- Existing games, favorites, rules, presets, roster, themes, wallpapers and
  scoreboard settings remain available. Setup styles live in `css/setup.css`.
- Rules popovers ignore queued scroll events from before they opened.
- Chicago now persists next-leg selection and result dialogs; reload restores
  those dialogs without incrementing leg wins again.
- Dev cache is `blakeout-dev-v37`. Production files remain unchanged.
- Responsive screenshots checked at 390x844, 744x1133 and 1280x800 across
  seven themes. `setup_refresh_layout` makes the core geometry checks repeatable.

---

## Architecture: game registry

`js/registry.js` is now the single source of truth for game modes. Every
game is one entry: `{ id, label, sub, icon, engine, category, tags, desc }`.

Engines:

| engine    | scoring module               | notes |
|-----------|------------------------------|-------|
| `cricket` | `cricket.js` + `state.js:initCricket()` | cricket, spanish, minnesota, **chaos** |
| `x01`     | `x01.js`                     | 301–1501 variants (numeric id parses to start score) |
| `score`   | `x01.js` turn-total keypad   | Count Up; reusable for future score-entry games |
| `target`  | `target_game.js` dispatcher  | baseball, bermuda, golf, **shanghai** |
| `special` | own module                   | chicago, 121 |

Hard-coded type lists (`['cricket','spanish','minnesota']`…) were removed
from `app.js` / `setup.js` in favor of `isCricketGame()` / `isX01Game()` /
`isTargetGame()`. **To add a game**: registry entry → options panel (optional)
→ engine hooks. `syncSelectWithRegistry()` auto-injects missing `<option>`s,
so the hidden select can't drift from the registry.

Target-engine lifecycle hooks (implement all four, wire into
`target_game.js`): `currentTarget()`, `describeHitButtons()`,
`pointsForHit(kind)`, `commitTurn(total, hits)`.

## Game picker (`js/picker.js`)

Search (label/sub/desc/tags), category chips, favorites
(`blakeout_game_favs`), recents (`blakeout_recent_games`, last 4, recorded in
`beginMatch`), and ⚡ Quick Start (re-applies `lastConfig` and starts).
The hidden `#gameType` select remains the state carrier; the picker only
reads/writes it and fires `change`.

## New games

**Chaos Cricket** (`chaos`, cricket engine)
- 6 unique random numbers (1–20, sorted desc) + Bull, drawn at game start
  (`state.js:generateChaosTargets`). All players share one board (stamped in
  `setup.js:beginMatch`). Standard marks/close/points rules. Play Again re-rolls.

**Shanghai** (`shanghai`, target engine, `js/shanghai.js`)
- Rounds 1→7 (or 1→20 marathon). 3 darts at the round number;
  score = face × multiplier. Single + Double + Triple in one turn = instant
  win (detected from the per-dart `hits` array passed by `target_game.js`).
  Otherwise highest total after the last round wins.

**Long X01 + Count Up**
- 901 / 1101 / 1501 are registry-driven X01 modes; numeric ids initialize
  their starting score without extra engine code.
- Count Up uses the shared numeric turn-total keypad through the `score`
  engine. Scores add from zero for 8 rounds; highest score wins and ties are
  supported. X01-only Bust, checkout, and remaining-score controls are hidden.

**Batch A Cricket variants**
- Cricket Quickie: standard 15–20 + Bull with a strict 10-round limit and no
  spread cap. A normal Cricket win can end early; at the limit, board marks
  rank first and points break equal-mark ties.
- Cut-Throat Cricket: extra marks penalize every opponent who still has the
  target open. Points are forced on; close the board with the lowest or tied
  lowest score to win.
- Wild Card Cricket: six unique values from 7–20 + fixed Bull. Every row that
  nobody has marked rerolls after each player turn; a marked row locks in
  place. Undo snapshots include the target board, and resume/play-again work.

**Gotcha!** (`gotcha`, score engine)
- 2–4 players race from 0 to exactly 301 using the shared turn-total keypad.
- Matching an opponent's live score bombs them to 0. Going over 301 deducts
  only the overage from the player's pre-turn score and cannot trigger bombs.
- Gotcha state, bombed opponents, overshoots, undo and active-game resume are
  persisted; X01-only Bust/checkout/remaining-entry controls are suppressed.

**Hammer Cricket + Team Hammer** (`hammer.js`, target engine)
- Official 8-round sequence: 20, 19, 18, Wild, 17, 16, 15, Wild; Wild is
  random 12–20 or Bull. Dart positions multiply ×1/×2/×3, with ×1/×3/×5
  in the final round. All-miss turns subtract triple the target.
- An explicit Miss Dart button preserves dart position. A tied top score gets
  a Wild tie-break round; remaining ties use MPR, with true ties supported.
- Team Hammer forces exactly 2 members per side through registry team metadata;
  members rotate full turns while sharing team score and hammer penalties.
- Undo snapshots now include every engine's stage state, so cross-turn undo
  restores Hammer rounds and also fixes stage restoration for existing target
  games rather than restoring scores alone.

**Shark Tank** (`sharktank`, score engine)
- 2–4 surfers enter 3-dart totals (Bulls count 0). The unique round leader is
  safe; lower scores take 1 bite, or 2 when the leader scored at least double.
  A tied top score bites every active player.
- Headers show surfboard lives remaining (6→0). Six bites eliminates a player;
  eliminated surfers are skipped and the last survivor wins. Round scores,
  bite deltas, eliminations, undo and active-game resume are persisted.

**Tic Tac Toe Darts** (`tictactoe.js`, dedicated engine)
- Exactly 2 players. Bull is fixed in the center; 8 unique random numbers fill
  the board. Single/Double/Triple = 1/2/3 marks (Bull supports 1/2 only).
- Four marks claims a square; first line of three wins. A full Cats board is
  awarded by squares claimed, with a true tie supported.
- Dedicated high-contrast 3×3 touch board includes multiplier selection,
  explicit misses, per-dart undo, player mark previews, persistence and resume.

**Robin Hood** (`robinhood.js`, target engine)
- Ten rounds, three darts per player at the Bull. Outer Bull = 100 and Inner
  Bull = 200; Triple is disabled. Highest score after round 10 wins, including
  tied winners. Team thrower rotation, undo, persistence and resume are wired.

**Double Down Cricket** (`doubledown.js`, dedicated engine)
- Shared random pair from D2–D14 starts the match. Each side must hit both,
  then close 15–20 with standard 1/2/3 marks, then hit D1 to win.
- The board moves between phases immediately inside a turn, supports explicit
  misses, per-dart undo, player/team rotation, progress summaries, persistence
  and resume. Header values show completed challenges out of 9.

**Team Cricket / 400** (`teamcricket.js`, dedicated engine)
- Forces exactly 2 vs 2. All four humans own separate 15–20 + Bull marks;
  each pair shares one header score. Turns rotate A1/B1/A2/B2.
- Both teammates must close a target before excess marks score, and scoring
  stops once both opponents close it. The lead is hard-capped at 400 points.
- Traditional rules require both teammates to close the board; New rules need
  one closer. Both require equal or more team points. The setup option persists
  in presets; member marks, team score, rotation, undo and resume all persist.
- Compact max-scale coverage verifies all four mark columns stay visible at
  390×844 and 1.5× UI scale.

## Lifecycle hardening

- Play Again now has explicit reset assertions for Count Up, Gotcha, Hammer,
  Team Hammer, Shark Tank, Tic Tac Toe, Robin Hood, Double Down, and Team
  Cricket, including preserved team membership/order with reset rotations.
- Real reload/resume tests cover both dedicated board engines (Tic Tac Toe and
  Double Down), in addition to existing target-game resume coverage.
- Team rotation and actual-human history attribution are centralized in
  `target_game.js`, so Baseball, Bermuda, Golf, Shanghai, Hammer, and Robin
  Hood all rotate members consistently instead of only alternating team scores.

## Multiplayer Cricket visual fix

- 3/4-player grid tracks now use shrinkable `minmax(0, …)` lanes, and chalk
  marks are constrained by both their row height and player-column width at
  1.1×–1.5× scale. This prevents clipping, row overlap, and horizontal overflow.
- Removed the stacked active-player background boxes and full-height separator
  lines from 3/4-player Cricket boards; the active header remains the clear cue.
- A populated-mark responsive matrix covers 3/4 players, portrait/landscape,
  390–1133px viewports, Cricket/Spanish/Minnesota, and 1.5× scale.

## Setup-menu section clarity

- Game, Game Options, Players, Presets, Play, and App Maintenance now render as
  separate surface panels with consistent spacing, accent rails, and divider
  headings. Manage Players uses the same visual language.
- The Game Options panel automatically disappears for modes with no options,
  avoiding an empty section. Presets has an explicit open/closed arrow.
- Responsive tests verify panel separation and no horizontal overflow at 390px.

## Portrait player setup hotfix

- Portrait tablets show four standard players in balanced 2×2 cards instead
  of a left-stacked row layout. Phones use a single-column card stack.
- Each card contains its drag handle, throw-position label, arrow fallback, and
  a full-width name field. Pointer drag uses both X and Y to target 2×2 cards.

## Scoring interaction hotfix

- Restored per-target `+N` pending-mark badges in Cricket and Team Cricket.
- X01 supports both replacement workflows: tap score then type remaining and
  Enter, or type the remaining score first and tap the active score to commit.

## Themes

12 total (3 original + 9 bright bar-visible: sunburst, volt, inferno, miami,
grape, aqua, royal, shamrock, arctic-light). New contrast tokens
`--color-on-primary` / `--color-on-success` carry ink color on bright fills;
they default to white in `:root` and flip to dark ink in high-luminance
themes. Anything painted `--color-primary`/`--color-success` must use them.
Also fixed: `.card` bg and setup scrim were hardcoded dark (broke Arctic) —
now `--color-surface` mix + `--bg-image-overlay`.

## Settings + throw order (v2.4-dev)

- Unified Settings modal is available from setup and the in-game menu. It
  contains themes, UI scale, bundled wallpaper presets, no wallpaper, and a
  canvas-downscaled custom upload.
- Standard 2–4 player setup supports handle drag, ▲/▼ fallback controls, and
  randomization. The input slots themselves are the canonical throw order,
  so presets, Quick Start, `beginMatch()` and Play Again preserve it.
- Team setup supports drag insertion within a team as well as across teams,
  ▲/▼ fallback controls, independent within-team randomization, and the
  existing Home/Away first-team swap.
- 3/4-player headers size scores against each actual grid column and constrain
  max-scale marks/buttons on compact screens. Responsive tests cover phone,
  tablet, portrait, landscape, 0.7×–1.5× scale and four-digit X01 scores.

## X01 live turn preview

- Typing a dart immediately projects the active player's header score
  (`x01.js:updateLivePreview()`): the `.score-big` box switches to the
  "pending" accent and a `.score-delta` chip shows `−60` / `+60`. Nothing is
  committed until ENTER, so this is entry feedback only.
- Works dart-by-dart within a turn (`3×20 + 20` → 441 → 421), in remaining-
  score mode (typed value *is* the projection), and in the additive games
  (Count Up adds; Gotcha models the overshoot rebound). Shark Tank headers
  show bites, so they are skipped.
- Over-throwing previews `BUST` in the danger colour instead of a negative.
- The preview is torn down by `clearInput()`, `resetX01Input()`, the top of
  `submitScore()` (so early-return win/leg paths can't strand it) and the end
  of `updateX01Display()`, which also restores the real number.
- Markup: one `.score-delta` span per player header (`#homeDelta` …
  `#player4Delta`). It is `display:none` while empty, and the trailing hidden
  MPR span is now matched by `.score-delta ~ .avg-small` as well as
  `:last-child`.

## Setup screen refresh

- Card widens to 860px above 860px viewport width and gains a backdrop blur,
  so tablets/desktops stop rendering a narrow column on a huge background.
- Game grid auto-fits columns (`minmax(clamp(96px, 28%, 118px), 1fr)`) and
  scrolls inside its own panel (`max-height: min(46vh, 420px)`) with a fade
  mask — 29 games no longer push Start Game a screen and a half down.
- Because the grid scrolls, the rules ⓘ popover is now `position: fixed`,
  appended to `<body>`, clamped to the viewport by `picker.js`, keyed by
  `dataset.gameId` for toggle-off, and closed on grid scroll.
- Panels are more opaque with a top-light gradient; section labels gained an
  accent bar and more weight; the Play panel carries the success accent.
- Header reads as an app bar: logo tile, left-aligned wordmark, and a
  single-line phone layout under 600px.
- Player rows sit two-up on screens ≥720px; order steppers are 30×28.

## Support / tip button

The bare `$MikeDurbin` text link was replaced by a "🥤 Buy me a Monster" pill
(`#supportBtn`) following the Buy-Me-a-Coffee / Ko-fi convention: fixed amber
brand colours in every theme, 48px tap target, `Cash App · $MikeDurbin`
subtitle, and `rel="noopener noreferrer"` on the `_blank` link. It still
points at `https://cash.app/$MikeDurbin`.

## X01 + Cricket scoreboard style (Settings)

The scoring UI now ships in three looks, chosen in Settings next to Theme /
Wallpaper / UI Scale:

- **Classic** — the original pad, untouched. It is still the base layer in
  `css/games.css`, so nothing about it depends on the new option.
- **Modern** (default) — layered on top via `:root[data-x01-skin="modern"]`
  selectors, the same attribute mechanism as `data-theme`. Theme-token keys
  instead of fixed `#ccc` plastic, accented ×/+ modifier keys, quick-score
  chips, a capped 620px centred control column so display/pad/actions share
  an edge, near-square keys (landscape gets 54dvh instead of the 40dvh floor
  that squashed them into slabs), softer history lanes with a round-number
  rail, and gradient player headers with an active accent rail.
- **DC Mode** — a black/red tournament-board treatment for X01 and the
  Cricket family. It covers registry Cricket variants, Hammer/Team Hammer,
  Double Down, and Team Cricket/400 while leaving Baseball and unrelated
  target/party games untouched. `app.js` stamps the semantic
  `data-scoreboard-family` marker used by the scoped CSS.

Persistence: `localStorage['blakeout_x01_skin']` = `modern` | `classic` | `dc`,
applied by `applyScoreSkin()` in `js/settings.js`. The legacy key remains so
existing choices survive; `data-scoreboard-mode` provides the semantic styling
hook. Any new X01 chrome should be added to the classic base and overridden in
the relevant style block only when needed.

## Update delivery

`sw.js` is network-first, but same-origin JS/CSS have no version query string
and ES module imports (`app.js` → `x01.js` → …) can't get one without
rewriting every specifier. GitHub Pages' `max-age` could therefore hand back
a stale module while a fresh `index.html` was already running — which looked
like "the HTML updated but the feature didn't". Now the install step
precaches with `cache: 'reload'`, and the fetch handler revalidates
same-origin `.js`/`.css`/`.json` with `cache: 'no-cache'` (unchanged files
still come back as cheap 304s).

## Monthly usage counter

`recordMonthlyUsage()` in `js/firebase.js` fires once per load after anonymous
sign-in and increments a single integer at `usage/{YYYY-MM}` (production) or
`usage/{YYYY-MM}-dev` (this build, detected via `body.dev-build`) so dev
traffic can't inflate the real number. Gated per device per month by
`localStorage['blakeout_usage_month']`; localhost never counts, which is why
the test drives it through the optional `deps` argument with a stub Firestore.
Requires the `usage` Firestore rules in CLAUDE.md — without them the write is
rejected, the marker rolls back for a later retry, and nothing else breaks.
Monthly-active *devices*, not people.

## Security fixes (2026-07-26)

From `SECURITY_AUDIT.md`:

- **Stored XSS (finding #2)** — `ui.js` was the one module with no `escapeHtml`
  and interpolated player names straight into `innerHTML` in the Chicago
  match-win and 121 summaries. Names are free text *and* arrive from the shared
  roster that any signed-in client can write, so this was remotely triggerable.
  Both sinks now escape. Anything new in `ui.js` that touches `innerHTML` must
  go through `escapeHtml`, or use `textContent`.
- **SW cache scope (finding #5)** — `sw.js` cached every successful
  cross-origin GET. Now gated by `isCacheable()`: same-origin plus
  `gstatic.com/firebasejs/` (kept so the SDK works offline). Firestore and
  identitytoolkit responses are no longer stored.

- **Private rosters (finding #1)** — the single global `roster` collection let
  any anonymous client read every name/email and delete anyone. Replaced with
  `rosters/{rosterId}/players/{playerId}`, where `rosterId` is 128 random bits
  in `localStorage['blakeout_roster_id']`. Sharing is opt-in via *Manage
  Players → Share roster* (`?roster=<id>`, adopted then stripped from the URL).
  **Never add a `match /{path=**}/players/{id}` rule** — that enables
  collection-group queries and would re-expose every roster at once. Residual
  risk is capability-link: anyone with the link can edit that roster.

Console deployment completed 2026-08-30: the updated Firestore rules are live
and verified, and the Firebase browser key is restricted to the apex and `www`
domains. CSP (#4) remains deferred by the owner.

## Bug fixes (dev)

- `playAgain()` corrupted every non-cricket/x01 game (stamped `cricketData`,
  left stale baseball/chicago/121 state). Now rebuilds through `beginMatch()`.
- `saveActiveGame()`/`restoreActiveGame()` dropped baseball/bermuda/golf
  state → resume lost the inning/target/hole. Now persisted (plus shanghai).
- First-ever SW install triggered a `controllerchange` reload mid-setup.
  Now only reloads when a previous SW was controlling the page.
- Config presets now persist variant selects (baseball/bermuda/golf/shanghai).
- Chicago mode: loser of each leg now picks the next game; stale X01 typed inputs
  are reset on leg transition; resuming between legs re-opens game choice modal.
- Round badge now supports all target games (Baseball inning/extras, Golf hole,
  Shanghai round, Bermuda target index).
- Gotcha! overshoot penalty floored at 0 to prevent negative scores.

- The setup QR SVG paints its modules **white** (drawn for the dark background
  photo), so on the light Arctic theme it disappeared into the white card.
  The tile is now always a solid white plate with `filter: invert(1)` on the
  image — invert leaves the transparent ground alone and turns the white
  modules black, giving the canonical dark-on-light QR in every theme instead
  of depending on whatever sits behind it. `test_qr_visible_in_all_themes`
  screenshots the tile per theme and asserts real ink/paper contrast, so it
  fails on the old CSS (Arctic measured a blank 254–255 white square).

## Tests

- `tests/dev_test.py` — 51-test Playwright battery (registry/picker,
  favorites/recents, chaos, shanghai ×2, themes/settings, throw order,
  responsive 3/4-player visibility, play-again/resume regressions, core
  cricket + x01, X01 live preview, scoreboard styles/family scoping, support
  button, monthly usage counter, QR contrast per theme, player-name XSS, SW
  cache scope, private roster scoping, Chicago match flow, round badge support).
  `python3 dev/tests/dev_test.py`.
- `tests/visual_qa.py` — screenshot dump for theme/legibility review.
- Python dependencies are pinned in `tests/requirements.txt`. In an activated
  virtual environment, run `python -m pip install -r dev/tests/requirements.txt`
  and `python -m playwright install chromium` before the battery.
- Legacy `scripts/headless_test.py --target dev` still has stale prod-era count
  assertions (12 game cards / 3 themes versus 29 / 12 in dev). Update the
  production-tree script when promoting.

## Known limitations / next steps

- Legacy test counts (above) will need a bump at promote time.
- Candidates next: per-game quick-rules modal from registry `desc`,
  stats hooks for chaos/shanghai match ends (Phase 3), theme preview on
  long-press, favorites-first ordering in the grid.
