# BlakeOut — Project Context

A vanilla-JS PWA for scoring darts games (Cricket, X01, Spanish, Minnesota,
Chicago, 121). Runs in a tablet by the dartboard. No bundler, no framework —
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

### Firestore rules currently published

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /roster/{email} {
      allow read: if request.auth != null;
      allow create, update: if request.auth != null
        && request.resource.data.email == email
        && request.resource.data.name is string
        && request.resource.data.name.size() > 0;
      allow delete: if request.auth != null;
    }
  }
}
```

The `email == doc id` check matters: even players added without an email get
a synthetic id (`noemail-{hex}`) stored as both the doc id and the email field
so this rule passes. UI labels them "(no email — local only)".

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
- Game types: `cricket`, `spanish`, `minnesota`, `301`, `501`, `701`, `801`,
  `chicago`, `121`. Cricket/Spanish/Minnesota share the cricket scoring
  module; the 30x's are X01; Chicago and 121 are their own modules.
- Cricket targets per type are defined in `state.js:initCricket()`.
- Each player carries `{ name, score, throws, totalMarks, history,
  lastTurnMarks, cricketData?, rosterEmail? }`. `rosterEmail` (added Phase 1)
  is what Phase 3 will key stats against.
- Active game is auto-saved to localStorage on every dart so a refresh /
  app-update doesn't lose state.

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

### Phase 2 — Team builder w/ drag-and-drop  ⏳ NEXT
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
