# BlakeOut — Project Context

A vanilla-JS PWA for scoring 29 darts games across Cricket, X01, target,
party, practice, and team modes. Runs on a tablet by the dartboard. No bundler, no framework —
ES modules served as static files from GitHub Pages.

This file is the source of truth for *how the app is supposed to work*. If
something here drifts from reality, the code wins — but update this file in
the same commit.

Brand spelling is **BlakeOut**, with that exact casing and no space, in all
new or updated user-facing text. Do not rename storage keys or identifiers.

---

## Repo layout

```
/                  → live (production) build, served at blakeoutdarts.com/
/dev/              → dev build, served at blakeoutdarts.com/dev/
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

- **GitHub Pages** at `https://blakeoutdarts.com/`. Branch: `main`.
- `www.blakeoutdarts.com` and the repository's `github.io` URL redirect to the
  apex domain after DNS and Pages certificate provisioning complete.
- Push to `main` → ~1 min rebuild → live.
- No build step. Files are served as-is, so any module that doesn't exist on
  disk will 404 in the browser.

## Firebase

- **Project**: `blakeout`
- **Owner account**: `DartsBlakeOut@gmail.com` (same email shown in the app
  footer / used for outbound EmailJS later). 2FA enabled.
- **Plan**: Spark (free). Firestore, existing Anonymous Auth, and verified
  email/password accounts for the isolated DEV tournament integration.
- **Web config** lives in `dev/js/firebase-config.js` and **is committed**.
  Firebase web API keys are not secret — security comes from Firestore rules,
  not key obscurity. The browser key is restricted to
  `https://blakeoutdarts.com/*`, `https://www.blakeoutdarts.com/*`, and
  `https://blakeout.firebaseapp.com/*`, with its existing 25-API allowlist
  preserved. The Firebase host is required by the default email verification
  and password-reset action handler. Added and verified 2026-09-07: invalid-code
  probes reach action validation on both approved hosts; other referrers remain
  blocked. Never remove website restrictions to fix email action links.
- Email branding is not yet configured: Firebase Console rejected sender/subject
  edits on 2026-09-07 with "Email template updates are currently unavailable for
  this project" and directed us to Firebase Support. The built-in verification
  message body is locked, so a logo requires a custom email-sending integration.
  Do not claim a logo, custom sender domain, SPF/DKIM/DMARC changes, or inbox
  placement is configured until independently verified.

### Firestore rules

**Canonical copy: [`firestore.rules`](firestore.rules)** — edit that file, not
a copy pasted into docs. `firebase.json` points at it, so with the Firebase CLI
available it deploys with `firebase deploy --only firestore:rules`; otherwise
paste it into Firebase Console → Firestore Database → Rules → Publish.
The canonical copy was published and verified against the live project on
2026-09-07. The existing production rules remain unchanged; the new DEV rules
passed Google's actual rules compiler/simulator, including 32-team tournament
updates and four-player/12-counter Chicago results. Unauthenticated live reads
allow public tournaments but deny private roster flags, results, and the retired
global roster.

It covers three things:

| Path | Access |
|------|--------|
| `rosters/{rosterId}/players/{playerId}` | Read/write/delete for anyone who knows the 128-bit `rosterId`. Writes restricted to exactly `email`/`name`/`updatedAt`, `email` must equal the doc id, name 1–40 chars. |
| `roster/{document}` | **Denied** — retired global collection from the 2026-07-26 fix. |
| `usage/{period}` | Read for any signed-in client; writes pinned to an exact `+1` on a two-field doc. |

The DEV integration adds separate collections without changing those rules:

| Path | Access |
|------|--------|
| `blakeoutDevProfiles/{uid}` | Verified users can read public display names; only that UID can save its name. No email fields. |
| `blakeoutDevTournaments/{id}` | Public bracket/team data; only the verified owner can create/update, with revision checks. |
| `blakeoutDevRosterPrivate/{id}` | Owner-only paid/check-in/standby flags, atomically revision-paired with the public tournament. |
| `blakeoutDevResults/{id}` | Immutable organizer-recorded dart results, readable only by owner or verified participants. |
| `blakeoutDevSignupState/{id}` | Public membership/revision index; transactional self-joins or owner roster updates only. |
| `blakeoutDevSignups/{id}/players/{uid}` | Public verified or anonymous guest signup; own registration only, with owner removal. No private flags. |
| `blakeoutDevCasualResults/{id}` | Immutable verified-scorekeeper records; private to the scorekeeper and verified participants with receipts. |
| `blakeoutDevCasualReceipts/{resultId}${uid}` | Per-participant access receipt, created only by the original scorekeeper for a declared verified profile. |

### DEV scoring, brackets, and accounts

- `/dev/` remains the ordinary offline scorer. `/dev/brackets/` runs doubles
  double-elimination tournaments; `/dev/accounts/` manages verified profiles
  and tournament/casual dart records. Navigation is also available in Game Menu.
- Winner and Chicago leg-result dialogs use the theme-aware `dev/css/winner.css`
  design: dart emblem, clear winner/score hierarchy, double-bull finish callout,
  touch-sized actions and reduced-motion support. Existing scoring, undo and
  tournament-save behavior is unchanged.
- Tournament and recorded casual games: Chicago, 301, 501, Cricket, Spanish
  Cricket, and Minnesota. Other scorer games remain playable without recording.
- Players join immediately while registration is open, either with a verified
  account or a name-only guest signup. Owners can also register and play.
  New arrivals are unpaid, unchecked, and not standby; only owners change
  those private flags. Unpaired arrivals are visible in the public roster.
  Guests never contribute to lifetime account statistics.
- Guest signup uses a separate `blakeout-dev-guests` anonymous Firebase app.
  One guest identity per device/event is supported; another person on the same
  device should ask the organizer to add them. Account/scorer logins are retained.
  Repeated joins are idempotent, and explicitly removed players can join again.
- The signup index supplies the logical revision while arrivals are not yet
  materialized into the owner's roster. Owner saves atomically merge signups
  and private flags, or remove their signup membership. Dirty owner drafts
  conflict safely rather than silently overwriting newly registered players.
- One matching team number per partner builds pairs. The live preview does
  not start the tournament. Explicit start shuffles once and locks the roster.
  Completed events appear in History. Byes are not played wins.
- The pure `dev/js/brackets/engine.js` has no Firebase dependency. All storage
  goes through `dev/js/platform.js`. Public arrays and result `perPlayer`
  counters use canonical JSON strings on the wire for strict rules grammar
  validation within Firebase's expression budget; callers receive arrays.
  Spectator roster flags are redacted, so never derive teams from them.
- A ready match launches the existing scorer after online owner verification.
  X01 requires actual darts thrown; Cricket includes explicit missed darts.
  Human rotation, busts, undo/redo and Chicago leg changes retain the raw ledger.
  Saving confirms the result and atomically advances the bracket. Local pending
  results survive retries; the same result ID cannot duplicate statistics.
- Casual setup offers opt-in **Record verified player stats**. Select each
  human's verified profile explicitly; names never infer identity. Singles,
  unequal teams, guests, and a non-playing scorekeeper are supported. Minnesota
  Bed counts three actual darts. A completed game requires an explicit save;
  offline results remain recoverable and retries resume receipt delivery.
  The original verified scorekeeper must save the result. The backend accepts
  up to 128 verified participants and 384 counters, rejecting excess explicitly.
- DEV active games use `blakeout_dev_active_game`, with a one-time copy of any
  legacy shared save. The production save is never modified. Lossless snapshot
  packing preserves undo/redo without repeatedly storing the full dart ledger.
  Pending matches remain recoverable; confirmed cloud saves prune redundant
  local backups instead of filling device storage across a tournament.
- Manual bracket results require leg scores (or an explicit forfeit) and do
  not fabricate dart statistics. Completed results are not editable in this
  DEV UI while correction/invalidation of immutable records is pending.
- Account averages derive from summed raw points/darts or marks/darts, not
  averages of averages. Records identify tournament/organizer or
  casual/scorekeeper provenance; they are not certified competition statistics.
  Users can export their records as JSON.
- Verified email/password is the default: sign up, verify the email, then
  sign in normally. Passwords are never placed in app storage. Legacy email
  links still complete, but Spark permits only 5 sign-in emails/day versus
  1,000 verification emails/day ([Firebase limits](https://firebase.google.com/docs/auth/limits)).
  No billing upgrade is required for the current test.
- The named Firebase app `blakeout-dev-accounts` keeps this login separate from
  the existing anonymous scorer. Only DEV collections and assets are added;
  do not promote them to the production root automatically.
- Still pending: completed-result correction with immutable-record invalidation.
- Targeted browser tests (existing Python/Chrome environment):
  `dev/tests/bracket_engine_test.py`, `dev/tests/platform_test.py`,
  `dev/tests/brackets_ui_test.py`, `dev/tests/scoring_bridge_test.py`.

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

## v2.4.2 production release (2026-08-24)

- **DC Mode scoreboard style** — Settings now offers Modern, Classic, and DC
  Mode under X01 & Cricket Style. The persisted legacy key remains
  `blakeout_x01_skin`; `data-scoreboard-mode` is the semantic styling hook.
- DC Mode provides a black/red tournament-board presentation for X01,
  registry Cricket variants, Hammer/Team Hammer, Double Down, and Team
  Cricket/400. Baseball and unrelated target/party games remain unchanged.
- The support button now reads "🥤 Buy me a Monster" while retaining its Cash
  App destination, accessible label, and 48px touch target.
- Responsive coverage includes all seven registry Cricket variants with four
  players plus real Team Hammer and Team Cricket setups at 390×844 / 1.5×.
- Validation at promotion: 49/49 dev tests plus 18/18 production smoke;
  production service worker cache `blakeout-v38`.

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

### Phase 3 — Lifetime stats per player (tournament slice implemented)
- DEV tournament matches now retain actual human dart records and show
  cumulative statistics under Players & Records; see the integration above.
- Verified Firebase UIDs supersede the earlier proposed email/roster identity
  for lifetime statistics. Never claim a verified account by matching a name,
  synthetic guest ID, or legacy roster email.
- Casual-game sync and any scalable aggregate counters remain future work.
  Raw results are immutable and exportable; keep scoring/storage decoupled.

### Phase 4 — Emailed summaries + offline queue  ⏳
- EmailJS in browser (free tier). Service id / template id / public key
  entered once on setup, persisted to Firestore `config/email`
- `dev/js/email.js`: `queueSummary()` writes to IndexedDB store
  `pending_emails`; `flushQueue()` runs on app start + `online` event
- `recordMatchEnd` from Phase 3 enqueues one summary per emailed player
- Players without an email are skipped silently

---

## Decisions that have been confirmed

- Backend: Firebase (Firestore + Anonymous Auth, plus verified DEV accounts).
  Monitor reads, writes, storage and auth quotas before expanding usage.
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
