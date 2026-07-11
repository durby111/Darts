# BlakeOut v2.3-dev — Overhaul Notes

Dev-only release. Production (repo root) untouched — promote by copying
`/dev/` → root as usual, and fold these notes into `CLAUDE.md` at that time.

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

## Bug fixes (dev)

- `playAgain()` corrupted every non-cricket/x01 game (stamped `cricketData`,
  left stale baseball/chicago/121 state). Now rebuilds through `beginMatch()`.
- `saveActiveGame()`/`restoreActiveGame()` dropped baseball/bermuda/golf
  state → resume lost the inning/target/hole. Now persisted (plus shanghai).
- First-ever SW install triggered a `controllerchange` reload mid-setup.
  Now only reloads when a previous SW was controlling the page.
- Config presets now persist variant selects (baseball/bermuda/golf/shanghai).

## Tests

- `tests/dev_test.py` — 33-test Playwright battery (registry/picker,
  favorites/recents, chaos, shanghai ×2, themes/settings, throw order,
  responsive 3/4-player visibility, play-again/resume regressions, core
  cricket + x01). `python3 dev/tests/dev_test.py`.
- `tests/visual_qa.py` — screenshot dump for theme/legibility review.
- Legacy `scripts/headless_test.py --target dev`: 15/18 — the 3 failures are
  stale count assertions in the prod-tree script (12 cards → now 14 games,
  3 themes → now 12). Update those numbers when promoting.

## Known limitations / next steps

- Round badge shows leg/round only for cricket/x01/121/chicago; target games
  show their stage in the main panel instead.
- Legacy test counts (above) will need a bump at promote time.
- Candidates next: per-game quick-rules modal from registry `desc`,
  stats hooks for chaos/shanghai match ends (Phase 3), theme preview on
  long-press, favorites-first ordering in the grid.
