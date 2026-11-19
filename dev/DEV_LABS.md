# DEV labs — November 19, 2026

Three DEV-only additions. None exists under the production root, and none adds a
backend, permission, sign-in, credential, third-party service or cloud write.
Scoring rules, saved statistics, access controls and layout defaults are unchanged.

| Feature | Where | Source |
| --- | --- | --- |
| 501 post-game coach | Winner dialog of a DEV 501 game, collapsed “501 coach recap · DEV” | `js/coach/` , `css/coach.css` |
| TV spectator board | `/dev/local/tv/` (linked from `/dev/local/brackets/`) | `local/tv/`, `local/tv.js`, `local/tv-model.js`, `css/tv-board.css` |
| Scorecard reader | `/dev/scorecard/` (linked from `/dev/local/brackets/`) | `scorecard/`, `js/scorecard/`, `css/scorecard.css` |

## 501 post-game coach

The X01 scorer stores one number per turn (the turn total), bust/miss flags and,
in team play, the thrower's name. It does **not** store individual darts,
segments, doubles aimed at or checkout attempts. The recap is arithmetic on what
is stored and nothing else:

- result, turns recorded, points scored, average per turn, highest turn, bust
  turns, 100+/140+/180 turn counts, first-three-turn average, and the number of
  turns that began on 170 or less (described as time in finishing range, not as
  missed doubles);
- darts and average per dart appear **only** when a recorded/tournament session
  stored a complete dart count for that leg;
- per-thrower turn averages appear only when thrower names were recorded.

No accuracy, checkout percentage, first-nine or per-dart figure is produced. If a
side's turn list does not reproduce its final score, that side shows no numbers.
One drill is chosen per side by fixed rules from those numbers (bust count, turns
in finishing range, early-versus-overall pace, average per turn) and states the
number it is based on. With fewer than three turns it says the drill is general.

The module is loaded by a guarded dynamic import, reads the in-memory game only,
and writes nothing. It applies to `501` only — not 301, Chicago legs or the 121 game.

## TV spectator board

A read-only page showing the current match and live score, on-deck (ready)
matches and the bracket for a device-local tournament.

**Same-device only.** It reads the two values the organizer page and local
scorer already keep in this browser (`blakeout_dev_local_tournaments_v1`,
`blakeout_dev_local_active_game`). Use it by opening `/dev/local/tv/` in a second
window of the *same browser* on the device that runs the scorer, then send that
window to the TV by HDMI (extended display) or mirror the device's screen. It
refreshes on the browser `storage` event and a 2-second poll.

Cross-device viewing (a TV stick, a phone across the room) would need new sync
and public or account-scoped access; that is deliberately not built.

- No storage writes of any kind, no Web Locks, no service-worker registration,
  no network request, no scoring/correction controls.
- Shows team and player display names only; paid, check-in and standby flags are
  not shown.
- A scorer session is shown as live only while it matches a ready match and its
  saved pairing. Missing numbers show “—”, never zero. With two live events and no
  scorer running it asks which to show.
- Unreadable saved data is reported and left untouched.

## Scorecard reader

Photo → editable league-result draft → mandatory manual review → local export.

- The photo is held in memory for the page view (an object URL). It is not
  uploaded, not stored, and not sent to any OCR/AI service.
- **Automatic reading limit.** No OCR engine is bundled. The page offers
  “Read text on this device” only when the browser itself provides the on-device
  `TextDetector` API. Most desktop browsers and all iOS browsers do not; the
  Chromium used for testing does not. That API is not designed for handwriting
  and has not been exercised against a real device or a real card here — only
  against a mocked detector with a synthetic image. Where it is unavailable or
  fails, the reader is a manual-entry form beside the photo.
- Every detected value is flagged “⚑ Check” until a person confirms or edits
  it; doubtful readings (non-numeric score, unreadable character, digit in a
  name, conflicting repeat, low detector confidence) are flagged “⚠ Uncertain”
  and kept exactly as read. Missing values stay blank and flagged; a winner is
  never inferred from scores, and totals are never corrected — mismatches are
  shown as warnings.
- Lines that fit no field are listed verbatim and must be dismissed by hand.
- The draft cannot be marked reviewed while any flag is open, and requires the
  “I compared every field” checkbox. Any later edit re-opens the review.
- Export is a downloaded JSON file / on-page text for copying by hand. Nothing is
  written to a league tracker. Draft text autosaves to
  `blakeout_dev_scorecard_draft_v1` in this browser only.
- The recognised text layout (`Date:`, `Home:`, `Away:`, numbered
  `N. Game: A vs B | 1-0 | W: Home` rows, `Totals:`) is a synthetic convention.
  It has not been fitted to any real league's card.

## Tests

```sh
node dev/tests/coach_recap_test.mjs
node dev/tests/tv_board_model_test.mjs
node dev/tests/scorecard_draft_test.mjs
node dev/tests/labs_browser_test.mjs      # rendered Chromium, external requests blocked
```

All data is synthetic (`dev/tests/fixtures/scorecard/synthetic-card.json`,
generated tournaments, invented names). The browser suite plays a real 501 leg
through the keypad, runs a real organizer → local scorer → save flow with the TV
board open in a second window, and drives the scorecard review end to end.

## Not verified

- Physical TV/HDMI output, screen mirroring, across-the-room readability, real
  touch hardware, iOS/Safari and Android.
- A real scorecard photo, real handwriting, or a real `TextDetector`.
- Offline use was checked in desktop Chromium with the real DEV service worker
  (all three features load with the network off). An installed PWA on a tablet
  or phone was not checked.
- Whether the drill rules are good coaching; they are fixed arithmetic rules.
