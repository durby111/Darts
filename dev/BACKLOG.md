# BlakeOut development status — October 6, 2026

This checklist reconciles HANDOFF_DOT.md with the reviewed checkout. Production
source remains unchanged. October 6 daytime authorization covers tested DEV-only batches; the shared-site
rebuild is understood. Production source, behavior, configuration and data remain
out of scope. No network or security permission changes are authorized.

Full original-handoff reconciliation and tonight’s actions: [EVENING_AUDIT.md](EVENING_AUDIT.md).

## Delivered and locally reviewed

| Work | Status | Evidence / remaining check |
| --- | --- | --- |
| Tablet Start/Resume visibility | Published `d5b09ab` | Pages run [37459450018](https://github.com/durby111/Darts/actions/runs/37459450018) succeeded; local 55/55 regressions and 15 layout combinations passed. Actual served site cannot be reached from this executor. |
| Account verification refresh concurrency | Published in `b8e8d96` | Shared reload/token request per user, replacement-user refresh and obsolete-session guards; 13 new mock API assertions and delayed account-switch UI test pass. Actual email/link/token propagation still unverified. |
| Playing roster payment requirement | Published in `b8e8d96` | Assigned playing members must be paid; standby excluded. Engine and organizer UI checks pass. Existing private flags and schema retained. |
| DEV service worker | v49 published; v50 accompanies completed-match outlines | Production cache/source unchanged. |
| Organizer row numbering and counts | Published `3e5fbc6` | Draft/standby/pair counts; identity preservation, tablet/mobile containment and signout privacy checks pass. |

## Saved work blocked on transfer

- Start & Lock feedback archive: `libfile_f6200a861c308191b435f5db25a3f9c4`
  (`blakeout-first-pass-review.zip`, reported seven DOM and six engine groups).
- Isolated correction planner/projector: `libfile_d8f216cc6a9c8191a9ad388239af886d`
  (`blakeout-result-correction-core.zip`, reported 219 tests).
- Library authorization succeeds, but prepared downloads fail at proxy CONNECT
  with HTTP 403. No readable archive bytes reached this executor. Reported
  archive test counts are not locally verified test results.
- Environment owner can allow the exact materialization hosts below, or attach
  the original ZIPs directly to the consuming task. No permission change or
  alternate denied-route workaround was performed:
  `oaisdmntprwestus.blob.core.windows.net`,
  `oaisdmntprnorthcentralus.blob.core.windows.net`,
  `oaisdmntpreastus2.blob.core.windows.net`.
- `blakeoutdarts.com` is separately needed for served DEV verification;
  `api.github.com` is needed only for shell API access. Git transport and the
  connected GitHub app already work; reconnecting GitHub is not the fix.

## Result correction integration prerequisites

The saved pure core is not wired to the app. Existing engine correction tests
cover the older leaf-result behavior only. Publishing current local fixes does
not deliver functional result correction.

1. Recover the original archive, inspect its API/contracts and reproduce all
   reported tests before integrating or choosing a persistence schema.
2. Preserve immutable original result records. Design additive owner-authorized
   correction events with stable idempotency keys, expected revisions, and an
   atomic bracket/event write. Preserve safe downstream and active-match guards.
3. Project corrections into account statistics, exports, and tournament display;
   raw result queries currently do not apply correction invalidations. Handle
   in-flight scorer contexts and pending submissions consistently.
4. Exercise duplicate clicks, stale tabs, interrupted/offline retries, lost
   responses, downstream games, authorization, and owner-private data boundaries.
   Never synthesize per-dart history from a manually corrected final score.
5. Prepare additive rules and persistence tests locally if needed. Compile and
   exercise them with a localhost emulator and a demo project before requesting
   specific deployment approval. No live Firebase writes or rules deployment.
6. Expose correction UI only once persistence and projections are complete.

## Remaining handoff priorities

- [ ] Finish visible Start & Lock feedback after recovering the saved patch;
  reproduce before/after behavior rather than assigning an unproven cause.
- [ ] Verify actual account email delivery and verification-link completion,
  including returning on the same and a different device. No recipient is
  authorized for a real email test yet.
- [x] Distinguish matching names with view-only numbered event labels in the
  roster, bracket and scorer. No global name ownership, profile rename, signup
  rejection, or identity deletion. Same snapshot yields the same labels;
  labels may update when registrations/names change and are not identity keys.
- [x] Add roster row numbering and explicit total/non-standby/standby/pair counts.
- [x] Add owner-only bulk flag controls with revision-safe saves.
- [x] Add odd non-standby roster warning without changing Start eligibility.
- [x] Outline completed winners green and losers red, retaining Won/Lost text.
- [x] Subdue pending/not-required bracket cards with dashed borders while
  preserving text readability.
- [ ] Indicate actual active play. Ready alone does not establish that a match
  is being played. [MATCH_ACTIVITY_DESIGN.md](MATCH_ACTIVITY_DESIGN.md) documents
  the packed-schema/rules boundary, proposed advisory activity and tests.
  Current grammar rejects activity statuses/fields; no feature is enabled.
- [ ] Review distance readability on real tablets.
- [x] Add accessible draft row ordering with stable IDs and existing partner
  order preserved. Controls disappear after Start.
- [ ] Any additional drag/grouping or post-lock editing needs a clear contract.
- [x] Align tablet one/two-player Cricket target/marks/turn badges; preserve compact corner badges.
- [x] Fix DC Cricket button containment at high scale; published baseline allowed adjacent-row taps.
- [ ] Consider aggregates if raw-record statistics reads become costly.
- [ ] Match-summary emails remain a proposal, not delivered behavior.
- [ ] Finish detailed unused-export/DOM/CSS audit before removal. Module-level
  audit found all 37 current DEV JavaScript modules reachable from the four HTML
  entrypoints; no orphan module was removed. Four single-reference exports
  (`findPlayerByEmail`, `engineOf`, `listThemes`, `resetGameState`) are candidates,
  not proven dead APIs; compare the saved archives before deleting them.
- [ ] Separately review HTTPS enforcement, hosting headers/CSP, domain renewal,
  account MFA, and domain controls. Do not change settings without authorization.

## Validation and release boundaries

- Original baseline was 54/55 DEV regressions; the sole remaining failure after
  installing the QR test dependency was clipped Start at 744×1133. The tablet
  commit fixes it. Missing QR dependency was an executor setup issue.
- Browser tests use mocked Firebase and block external requests. Mock passes do
  not prove provider behavior, email delivery, or deployed authorization rules.
- Firestore emulator is not configured (`FIRESTORE_EMULATOR_HOST` unset), so the
  suite explicitly skips compilation and live emulator checks. No rules changed.
- DEV is `/dev/` on the shared GitHub Pages main site. A main push rebuilds the
  whole site even with DEV-only source changes. The tablet and account/payment publications
  were explicitly approved. Subsequent tested DEV-only batches are authorized
  through October 6 evening; preserve production and report deployed scope.
- Account/payment release `b8e8d96` passed Pages run `37462591260`.
- Roster count release `3e5fbc6` passed Pages run `37462941482`.
- Bulk flag/warning release `3a45116` passed Pages run `37463707288`.
- Cricket release `3f0946c` passed Pages run `37464754031`; full DEV suite 57/57.
- Draft order release `8cdcaae` passed Pages run `37465245055`.
- Event-label release `6bdc6c2` passed Pages run `37467746048`.
- This audit release: completed winner/loser outlines, contrast/result tests,
  original-handoff reconciliation, and cache v50.
  No stored tournament schema, result schema, security rules or provider settings change.

## Evening DEV test checklist

1. On a tablet, expand setup options, start a game, leave it, and Resume. The
   action buttons should stay reachable in portrait and landscape.
2. At Players & Records, return from a verification email and use Refresh if
   needed. Actual provider delivery/link completion is still unverified here.
3. In an organizer draft, leave one playing member unpaid: Start should show
   a named payment blocker. Mark paid and save. Unpaid standby players should
   not block an otherwise ready roster.
4. Check roster row numbers and counts while adding/removing a player or
   toggling Standby. Try the Paid/Checked-in/Standby column checkboxes: they
   apply to all draft rows, including standby, and require Save. Mixed flags
   show a mixed checkbox. Discard & reload restores the saved roster. An odd
   non-standby count warns without independently blocking Start. Use the row
   arrows to arrange the draft, save, and check that partners/team numbers
   stay intact. Row arrows disappear once the tournament starts.
5. In tablet Cricket, enter T20 and single 19: the +3/+1 badges should align
   with their targets on one/two-player boards. At landscape 1.5× DC mode,
   tap 19 in Spanish Cricket and confirm it records 19, not the row below.
   Phone and three/four-player badges retain their compact corner layout.
6. Add two guests with the same name: the event roster/bracket should show
   distinct numbered labels, and the scorer should use the same thrower labels.
   Saved names remain unchanged; editing/rejoining may renumber labels.
7. Start a short DEV tournament game, reload/resume, and submit once. Local
   interrupted/retry tests pass; real provider behavior still needs observation.
   Check the green Won/red Lost outlines. Do not clear site storage.

Deferred: dedicated Start & Lock feedback, safe correction integration, active-match
indication, real-tablet distance review and advanced/post-lock ordering. The
original feedback/correction archives remain transfer-blocked. Do not expect
result correction functionality from these releases.
