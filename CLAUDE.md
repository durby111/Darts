# BlakeOut — Project Context

A vanilla-JS PWA for scoring 29 darts games across Cricket, X01, target,
party, practice, and team modes. Runs on a tablet by the dartboard. No bundler, no framework —
ES modules served as static files from GitHub Pages.

This file is the source of truth for *how the app is supposed to work*. If
something here drifts from reality, the code wins — but update this file in
the same commit.

---

## Repo layout

```
/                  → live (production) build, served at durby111.github.io/Darts/
/dev/              → dev build, served at durby111.github.io/Darts/dev/
                     ALL active work happens here. Promote to root when stable.
/dev/js/           → ES modules
/dev/css/          → split per concern (variables, layout, components, games)
/dev/index.html    → single-page shell
/dev/sw.js         → service worker (PWA install + offline cache of static assets)
/Screenshots/      → user reference shots, gitignored
```

When making changes, edit `/dev/`. The user copies dev → root manually when
ready to ship.

---

## Hosting & deploy

- **GitHub Pages** at `https://durby111.github.io/Darts/`. Branch: `main`.
- Push to `main` → ~1 min rebuild → live.
- No build step. Files are served as-is, so any module that doesn't exist on
  disk will 404 in the browser.

## Firebase

- **Project**: `blakeout`
- **Owner account**: `DartsBlakeOut@gmail.com` (same email shown in the app
  footer / used for outbound EmailJS later). 2FA enabled.
- **Plan**: Spark (free). Firestore + Anonymous Auth only.
- **Web config** lives in `dev/js/firebase-config.js` and **is committed**.
  Firebase web API keys are not secret — security comes from Firestore rules,
  not key obscurity. If we ever need to lock the key down further, use Firebase
  Console → Project Settings → API key restrictions (HTTP referrer allowlist).

### Firestore rules

**Canonical copy: [`firestore.rules`](firestore.rules)** — edit that file, not
a copy pasted into docs. `firebase.json` points at it, so with the Firebase CLI
available it deploys with `firebase deploy --only firestore:rules`; otherwise
paste it into Firebase Console → Firestore Database → Rules → Publish.

It covers three things:

| Path | Access |
|------|--------|
| `rosters/{rosterId}/players/{playerId}` | Read/write/delete for anyone who knows the 128-bit `rosterId`. Writes restricted to exactly `email`/`name`/`updatedAt`, `email` must equal the doc id, name 1–40 chars. |
| `roster/{document}` | **Denied** — retired global collection from the 2026-07-26 fix. |
| `usage/{period}` | Read for any signed-in client; writes pinned to an exact `+1` on a two-field doc. |

The `email == doc id` check matters: even players added without an email get
a synthetic id (`noemail-{hex}`) stored as both the doc id and the email field
so this rule passes. UI labels them "(no email — local only)".

> **Security note:** `request.auth != null` is *not* a trust boundary here —
> anonymous sign-in is open and the web API key is public, so any caller can
> satisfy it. Roster privacy comes from the **unguessable `rosterId` path**,
> not from auth. See `SECURITY_AUDIT.md` (2026-07-26).

---

## Roster model (private rosters, 2026-07-26)

Each install owns a private roster at `rosters/{rosterId}/players/{playerId}`.

- `rosterId` is 128 bits of `crypto.getRandomValues` held in
  `localStorage['blakeout_roster_id']`, minted on first use.
- **Sharing is opt-in**: *Manage Players → Share roster* copies a
  `?roster=<id>` link. Opening it adopts that roster and strips the id from
  the address bar. Malformed ids are rejected and replaced.
- **Tradeoff — capability-link security.** Anyone holding the link has full
  read/write/delete on that roster, like an unlisted video URL. This is the
  strongest option that keeps zero-friction anonymous use; real per-account
  isolation would require non-anonymous sign-in.
- **Never add a `match /{path=**}/players/{id}` rule** — that would enable
  collection-group queries and re-expose every roster at once.

---

## Monthly usage counter

Answers "roughly how many devices used the app this month?" with no analytics
vendor and nothing about a person. `recordMonthlyUsage()` in `js/firebase.js`
runs once per load after anonymous sign-in and writes a single integer:

```
usage/2026-07       { month: '2026-07',     devices: 42 }   ← production
usage/2026-07-dev   { month: '2026-07-dev', devices: 3 }    ← dev build
```

- **Read it** in Firebase Console → Firestore → `usage`, or call
  `getMonthlyUsage('2026-07')`.
- **Dev and prod share one Firebase project**, so the dev build (detected via
  `body.dev-build`) counts into its own `-dev` doc and can't inflate the real
  number.
- **Gated per device per month** by `localStorage['blakeout_usage_month']`.
  `FieldValue.increment(1)` means simultaneous offline devices merge
  atomically rather than clobbering each other.
- **localhost / 127.0.0.1 never counts** — that's the test battery and hand
  testing.
- This is monthly-active **devices**, not people: one player on a phone and a
  tablet counts twice, and clearing site data lets a device count again. Treat
  it as a trend line, not a headcount.
- Failures are non-fatal. If the rules above aren't published the write is
  rejected, the local marker is rolled back so a later load retries, and the
  app carries on. **The counter reads 0 until the rules are published.**

---

## Identity model

- **Email is the canonical player ID** when present (lowercased + trimmed).
  Same email on two devices = same player, lifetime stats merge automatically.
- **Email is optional**. No-email players get a per-device synthetic id. Their
  stats accrue but won't follow them across devices — there's no way to
  reconcile them with another device's "Anna" entry.
- **No password / PIN / magic link**. Whoever's email is entered is the
  attributed player. This is appropriate for casual bar play and stat
  tracking; not appropriate if these stats ever need to be tamper-proof.
- **Anonymous device auth** (`signInAnonymously`) happens silently on first
  load — Firestore rules require an authenticated principal to write, but the
  player never sees this.

---

## Offline-first model

Critical: the app must always be playable with no network.

- Firestore SDK is offline-first by default. `enableIndexedDbPersistence` is
  called once at init. Local writes queue in IndexedDB and replay when the
  device reconnects.
- Roster edits offline → sync on reconnect.
- (Phase 3) Stats updates use `FieldValue.increment()` so deltas from multiple
  devices merge atomically even after both were offline simultaneously.
- (Phase 4) Email sends are queued in IndexedDB; `flushQueue()` runs on app
  start and on `window.addEventListener('online', ...)`.

If Firebase init fails entirely (no network at all on first ever load, or
config missing), the app still works — `firebase.js` uses dynamic imports
inside `initFirebase()` so a missing module can't break `setup.js`. The
roster section just shows "(offline)".

---

## Game model

- `state.js` exposes a single mutable `game` object — the current match.
- `js/registry.js` is the source of truth for 29 game modes and routes each to
  `cricket`, `x01`, `score`, `target`, `special`, `tictactoe`, `doubledown`,
  or `teamcricket` engines. The picker, setup options, and boot smoke tests are
  registry-driven.
- Cricket targets per type are defined in `state.js:initCricket()`.
- Each player carries `{ name, score, throws, totalMarks, history,
  lastTurnMarks, cricketData?, rosterEmail? }`. `rosterEmail` (added Phase 1)
  is what Phase 3 will key stats against.
- Active game is auto-saved to localStorage on every dart so a refresh /
  app-update doesn't lose state.

## v2.4 production release (2026-07-11)

- 29 games, including 901/1101/1501, Count Up, Cricket Quickie, Cut-Throat,
  Wild Card, Gotcha!, Hammer + Team Hammer, Shark Tank, Tic Tac Toe, Robin
  Hood, Double Down, and official Team Cricket/400.
- Unified Settings modal: 12 themes, bundled/custom wallpapers, and 0.7×–1.5×
  UI scaling. Setup supports drag/arrow/random throw ordering.
- 3/4-player score headers and Cricket marks are responsive across phone and
  tablet portrait/landscape. Multiplayer marks are constrained to their row
  and lane; active-row boxes and intrusive separator lines were removed.
- Setup is grouped into clear Game, Game Options, Players, Presets, Play, and
  App Maintenance panels.
- Validation at promotion: 40/40 dev tests plus the production smoke battery;
  service worker cache `blakeout-v29`.

---

## v2.4.1 production release (2026-07-25)

- **X01 live turn preview** — typing a dart projects the active player's
  header score in real time (`updateLivePreview()` in `js/x01.js`), with a
  `−60` / `+80` delta chip and a pending accent on the score plate. Nothing
  commits until ENTER; over-throwing previews `BUST` instead of a negative.
  Covers remaining-score mode, Count Up and Gotcha overshoot; Shark Tank is
  skipped because its headers show bites.
- **X01 keypad style setting** — Settings now offers Modern (default) or
  Classic next to Theme / Wallpaper / UI Scale. Classic is the original pad
  and stays the base layer in `css/games.css`; Modern is an override block
  keyed on `:root[data-x01-skin="modern"]`, the same attribute mechanism as
  `data-theme`, persisted to `localStorage['blakeout_x01_skin']`. Add new
  X01 chrome to the classic base first, then override it in the skin block.
- **Setup screen refresh** — card widens to 860px on tablets/desktop, the
  game grid auto-fits columns and scrolls inside its own panel so 29 games
  no longer bury Start Game, panels/labels gained contrast, and the rules
  ⓘ popover is now a viewport-clamped fixed element (the scrolling grid
  would clip an absolutely-positioned one).
- **Support button** — the bare `$MikeDurbin` link is now a "🍺 Buy me a
  beer" pill (`#supportBtn`) in the Buy-Me-a-Coffee convention: fixed amber
  branding in every theme, 48px tap target, `rel="noopener noreferrer"`.
- **Update delivery fix** — same-origin JS/CSS carry no version query string
  and ES module imports can't get one without rewriting every specifier, so
  GitHub Pages' `max-age` could serve a stale module to a freshly loaded
  `index.html`. The service worker now precaches with `cache: 'reload'` and
  revalidates same-origin `.js`/`.css`/`.json` with `cache: 'no-cache'`.
- Validation at promotion: 43/43 dev tests plus 18/18 production smoke;
  service worker cache `blakeout-v32`.

---

## Cricket marks visual spec

The closed-cell rendering mirrors how a chalkboard scorekeeper would draw it,
based on the marks count at the **start of the closing turn** (`marksBeforeClose`):

| Marks in current turn | Visual |
|---|---|
| 1 | slash `/` |
| 2 | X (double slash) |
| 3 in same turn | empty O — tap to toggle a center dot (boobie) |
| Previously had 1, then closed | O with a slash inside |
| Previously had 2, then closed | O with an X inside |

`getMarkSymbol()` in `dev/js/ui.js` is the renderer. `marksBeforeClose` is
captured in `cricket.js` at the moment of closure.

---

## 4-phase delivery plan (the big feature push)

### Phase 1 — Roster + Firebase + footer  ✅ DONE
- Firestore-backed player roster, collapsible card on setup screen
- Datalist autocomplete on player1–4 inputs from local roster cache
- `rosterEmail` stamped on each `game.players[i]` for Phase 3 attribution
- Footer credit: "Created by Mike D." + Cash App `$MikeDurbin` + mailto
- Email is OPTIONAL on roster entries (synthetic id used if blank)
- Default player names: Home, Away, Player 3, Player 4

### Phase 2 — Team builder w/ drag-and-drop  ✅ DONE
- 2 teams (Home / Away), each holds 1+ members → 2v3 supported
- New screen between setup and game start
- Pointer-based DnD (no library); tap-to-assign fallback for accessibility
- Game model gains `game.teams = [{ name, members: [email, ...],
  rotationIndex }]`
- Whole turn each member, then swap teams (real-world rotation)
- `game.players[]` stays as the engine's "team-as-player" view; per-dart
  attribution to the actual thrower lands on each dart record

### Phase 3 — Lifetime stats per player  ⏳
- Match-end hooks: `cricket.js:showWinner`, `x01.js:showWinner`,
  `chicago.js` match win, `game121.js` match summary
- New `dev/js/stats.js`: compute per-player deltas from `game`, write to
  Firestore via `updateDoc(playerRef, { 'stats.x01.totalScore':
  increment(score), ... })`
- Stats viewer in setup: dropdown picks a roster member, shows career table

### Phase 4 — Emailed summaries + offline queue  ⏳
- EmailJS in browser (free tier). Service id / template id / public key
  entered once on setup, persisted to Firestore `config/email`
- `dev/js/email.js`: `queueSummary()` writes to IndexedDB store
  `pending_emails`; `flushQueue()` runs on app start + `online` event
- `recordMatchEnd` from Phase 3 enqueues one summary per emailed player
- Players without an email are skipped silently

---

## Decisions that have been confirmed

- Backend: Firebase (Firestore + Anonymous Auth). Free tier covers this app
  many times over.
- Email backend: EmailJS, not Firebase Trigger Email extension (less vendor
  lock-in for Phase 4).
- Team rotation: whole turn each member, then swap teams.
- Delivery: 4 phases, each independently usable and committable.
- Email is optional on roster entries; no-email players are local-only.

---

## Patterns to reuse

- localStorage namespacing: `blakeout_configs`, `blakeout_active_game` (see
  `state.js`). Phase 4 will add `blakeout_pending_emails`.
- `setGameStartCallback` hand-off (`setup.js` → `app.js`): reuse for the
  team-builder → game transition in Phase 2.
- Custom event dispatch (used by `chicago.js`, `game121.js`): reuse for
  match-end → stats/email signaling.

---

## Touch / input gotchas

- All in-game buttons (cricket grid, miss/enter, undo/redo) use
  `pointerdown` rather than `click`. `click` adds a scroll-disambiguation
  delay over scrollable ancestors and can be eaten by a stray `pointerup`.
- When a modal opens via `showModal`, its `.modal-content` gets
  `pointer-events: none` for 300ms. Without this, a tap that *opens* the
  modal can drive a phantom click on a button inside it that happens to
  sit at the same screen position (the original report: cricket "T" button
  → keypad Cancel button at same coords → modal flashed open then closed).
  If you add a modal that contains a quickly-tappable confirm, leave the
  guard in — the 300ms is invisible in practice.

## Things NOT to do

- Don't statically import gitignored files. Anything that *might* not exist
  on the deploy must use dynamic `import()` inside a try/catch.
- Don't add gameplay logic to `firebase.js` or `email.js` — those are
  transport/storage wrappers. Keep them dumb.
- Don't break the offline path. Every new feature has to work with the
  network unplugged; if it can't, it has to degrade gracefully.
- Don't silently swallow errors in user-triggered actions (Add Player, Save
  Stats, etc.). Show an alert or inline message — silent failures look like
  the app is broken.
