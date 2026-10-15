# Device-local tournament acceptance — October 15, 2026

Entry: `/dev/local/brackets/`, also linked from the existing sample brackets page.
This is an explicit device-local mode, not a Firebase deployment or account rollout.
The existing sample pages and real-account/real-bracket feature gates remain unchanged.

## Organizer flow

1. Create an event and choose its default game and odd best-of length.
2. Enter the people, check them in and mark playing people paid. Place unmatched
   people on standby. Blind draw requires an even 4–64 playing people.
3. Draw partners, review the two-person teams, and save the roster. Drawing can be
   canceled or repeated before starting; starting locks the saved roster.
4. Start the event. Before scoring, optionally choose games for a whole winners,
   losers, final or reset bracket; a particular round; or an individual match.
   A match override takes priority over round, then bracket, then event default.
5. Select a ready match and launch the scorer. Score the actual turns, save the
   result, and return to the bracket. Byes advance without a played win/result.
6. A completed match can be corrected only before a dependent match has been
   played. Corrections retain the original scorer receipt and a before/after
   audit entry. They do not rewrite the original dart ledger or account stats.

Supported scorer formats: 301, 501, Cricket, Spanish Cricket, Minnesota Cricket
and Chicago. Chicago is always best-of three. Other formats accept odd lengths
from 1 to 99. Changing formats cannot invalidate a played match or a match with
scoring already in progress on this device. There is no automatic credential,
identity, payment or competition certification in local mode.

## Persistence and isolation

`local/platform.js` stores the tournament, receipts and correction audit in one
versioned localStorage value, `blakeout_dev_local_tournaments_v1`. Web Locks
serialize writes across tabs; expected revisions reject stale edits. A failed
storage write leaves the previous stored value intact. Receipts make repeated
saves idempotent and reject a different payload using an existing result ID.
An old receipt retry cannot revert a newer correction.

Local active games and recovery copies use `blakeout_dev_local_*` keys. They do
not import, overwrite or remove production or ordinary DEV active-game data.
The local scorer bypasses Firebase initialization. Local pages use the device
adapter, not the account platform; all people are tournament-local guests.
No Firebase config, rules, OAuth, provider switches or real feature gates changed.

The DEV worker precaches the local shell and scorer. Once installation succeeds,
local tournament/scorer navigation can reopen offline, including event query
URLs. Storage and cached pages are still device/browser-specific. Clearing site
storage, browser eviction, another device, or private browsing can lose access;
this implementation is not cloud backup or cross-device synchronization.

## Browser evidence

`tests/local_tournament_flow_test.py` operates the rendered app in Chromium:
enters every name, draws partners, saves/reloads, starts, selects formats, opens
matches, enters scores through the on-screen keypad, saves and returns to the
actual bracket. Read-only state inspection verifies the visible actions; it does
not set score totals, call engine result methods to progress matches, or select
bracket winners in place of scorer play. The single explicit correction in each
run uses the visible correction form after a real scorer result.

| People | Teams | Winners byes | Scorer matches to champion | Finals path |
| --- | --- | --- | --- | --- |
| 12 | 6 | 2 | 11 | GF1 lower winner, GF2 played |
| 16 | 8 | 0 | 14 | GF1 upper winner, GF2 void |
| 22 | 11 | 5 | 21 | GF1 lower winner, GF2 played |

Each run checks paired membership exactly once, canceled/repeated draw/start,
mid-match reload and closed-tab reopen, undo/re-entry of a winning turn, repeated
Save, lost acknowledgment after receipt commit followed by reload/retry,
correction and immutable original ledger, final reload, two losses for
each eliminated team, unchanged original data sentinels, and no external network
requests. Both winners and losers rounds use organizer-selected 301/501 formats,
including a best-of-three individual override in the 12-person run.

`tests/local_tournament_games_test.py` separately plays an actual scorer match
in all six supported formats, including all three Chicago legs, with duplicate
names in the roster. Every dart is entered through rendered controls. It compares
the stored receipt to the exact scorer ledger and verifies bracket advancement.
An additional 301 case uses the real service worker with the browser offline for
launch, scoring, save, return and reload.

`tests/local_tournament_edges_test.py` is supplementary adapter/engine boundary
coverage, not a substitute for full UI play: invalid/standby draws, input
immutability, format precedence, concurrent writes, stale revisions, injected
quota failure, receipt replay/mismatch, correction guards, in-progress format
rejection, malformed storage, two rendered conflicting tabs and a mobile layout.

During testing, repeated Save exposed a click-through bug: rerendering could
move Return into the second tap's position. A short guard across tournament
transition controls prevents that. Failed saves explicitly release the guard
so recovery can be retried immediately. Receipt comparison is also canonicalized
because recovery can restore identical record properties in a different order.
The lost-acknowledgment test reloads and retries the actual scorer receipt. Full
flows were rerun after fixes.

Additional regressions passed: all 16 JavaScript suites; 62 existing scorer/bridge
checks (with mocked Firebase boundaries); the platform browser suite; 16 DEV
navigation/production-boundary groups; and 8 bracket-engine groups including
186 completed engine simulations across 2–32 teams. These are supplementary
evidence, separate from the rendered full-tournament runs above.

Screenshots, Playwright traces, final event/receipt JSON and logs are retained in
`/workspace/scratch/darts-local-tournaments-20261015/` in the execution workspace.

## Remaining readiness limits

- Physical touch hardware, iOS/Safari and Android browsers were not exercised.
  Chromium viewport checks do not establish physical touch behavior.
- No real Firebase/Firestore writes, rule compilation or cross-device persistence
  were tested or enabled. Backend isolation/rules rollout remains separate work.
- Google/Apple OAuth and real email delivery remain disabled/unverified here.
- DEV publication and direct live-site verification are recorded separately from
  local browser evidence. A successful Pages job alone does not prove a user's
  cached device has loaded the new build.
