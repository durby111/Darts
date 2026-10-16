# Minnesota — Play for places

After first place wins a Minnesota game with three or four sides, the winner
screen offers **Play for places**. Normal and Cutthroat Minnesota both support
it. It is optional; Play again and New game retain their existing behavior.

Starting continuation fixes first place and establishes a new undo boundary.
Remaining sides keep their marks and scores and play in their existing order,
skipping finishers. Only remaining opponents count toward the high-score
(normal) or low-score (Cutthroat) win condition, including ties. The last
remaining side receives the final place automatically. A side already closed
and qualified earns its place when its next turn arrives, without an invented
dart. The original winner remains the winner displayed on the final screen.

Undo/redo during continuation corrects placement darts/turns, not first place.
Before choosing continuation, the existing Undo winning turn action still
corrects an unrecorded first-place result. Completed placement screens instead
show Undo last placement. Reload and offline resume preserve the continuation,
including pending special-row keypad input and undo/redo history. Play again
clears the continuation for the new game.

The current team setup supports two teams, so it does not offer third-place
continuation. Placement turn records retain the thrower identity if a saved
multiside team game is used; rotation continues through the existing team logic.
No new team-count UI or tournament format is introduced.

## Records and isolation

Primary scoring records, winner, leg totals, saved/pending result payload and
submission status are protected during placement undo/redo. Supplemental turns
are not appended to the closed primary leg and are not included in cloud or
lifetime stats. A stable device-local record uses the current build's active
storage prefix plus `_places_` and a unique continuation ID. Retry, reload and
undo update that same record. It remains on the device after Play again; there
is no new history browser or cloud publication UI in this change.

Production changes are limited to `js/cricket.js`, `js/state.js`, `js/setup.js`,
`js/scoring-records.js` and the service-worker cache version. Shared DEV modules
match production. Accounts/Brackets Coming Soon pages and feature flags,
Firebase, security rules and backend configuration remain unchanged. Cache
versions are `blakeout-v57-minnesota-places` and
`blakeout-dev-v67-minnesota-places`.

## Verification

- `minnesota_places_test.py`: rendered production and DEV, three/four players,
  normal/Cutthroat, offered/active/completed reload, fixed first place, turn
  skipping, undo/redo, idempotency, final winner, mobile layout and Play again.
- `minnesota_places_edges_test.py`: seeded near-win fixtures plus rendered inputs
  for recorded primary-result protection, later saved status, special keypad
  interruption, penalties, persistent unique placement record, score eligibility
  and ties, original winner correction, already-closed next turn, two-team flow.
- `minnesota_places_full_test.py`: production normal and Cutthroat matches from
  empty boards through first and second using actual dart controls, assigning
  third without seeded boards or scores.
- `minnesota_places_mobile_test.py`: long-name mobile offer/continuation/result
  layout, reachable opt-in button and text-only handling of player names.
- `minnesota_release_test.py`: scoped production diff, unchanged gates/backend,
  real service-worker upgrade, DEV data preservation and offline placement resume.
- Existing JavaScript, scorer/bridge and aggregate browser regressions run
  separately. External backend calls are blocked in browser tests.

Evidence is retained under `/workspace/scratch/minnesota-places-20261016/`.
Physical touch, non-Chromium browsers and real account/backend writes are not
covered. Deployment and direct live-site verification are reported separately.

Final checks passed: aggregate 57/57; 16 JavaScript suites; existing scorer/bridge
62 checks; eight production/DEV placement combinations; six edge-case groups;
two complete production matches; mobile long-name checks; real cache-upgrade
and offline placement recovery checks; existing Cutthroat and local-tournament
regressions. Production Coming Soon pages and disabled gates were also rendered
locally and verified. No remaining test failure is known.
