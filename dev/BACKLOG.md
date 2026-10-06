# BlakeOut development status — October 6, 2026

This checklist reconciles HANDOFF_DOT.md with the reviewed checkout. Production
source remains unchanged. Local work is not publication approval.

## Delivered and locally reviewed

| Work | Status | Evidence / remaining check |
| --- | --- | --- |
| Tablet Start/Resume visibility | Published `d5b09ab` | Pages run [37459450018](https://github.com/durby111/Darts/actions/runs/37459450018) succeeded; local 55/55 regressions and 15 layout combinations passed. Actual served site cannot be reached from this executor. |
| Account verification refresh concurrency | Local, unpublished | Shared reload/token request per user, replacement-user refresh and obsolete-session guards; 13 new mock API assertions and delayed account-switch UI test pass. Actual email/link/token propagation still unverified. |
| Playing roster payment requirement | Local, unpublished | Assigned playing members must be paid; standby excluded. Engine and organizer UI checks pass. Existing private flags and schema retained. |
| DEV service worker | Local v44, unpublished | Cache bump accompanies account/payment application changes; production cache/source unchanged. |

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
- [ ] Distinguish duplicate names within each event, not globally; retain stable
  player/registration IDs. Define labels and normalization for organizer edits,
  self-registration, and concurrent signup before implementation.
- [ ] Add roster row numbering and explicit total/playing/standby/unpaired counts.
- [ ] Add owner-only bulk flag controls with revision-safe saves.
- [ ] Improve odd-roster warnings without confusing warnings with pair blockers.
- [ ] Dim unavailable bracket matches and indicate actual active play. Ready
  alone does not establish that a match is being played.
- [ ] Review distance readability on real tablets.
- [ ] Improve ordering/grouping with accessible controls, stable IDs and clear
  behavior after roster lock; confirm the post-lock editing contract.
- [ ] Review Cricket target/marks/+1/+3 row alignment.
- [ ] Consider aggregates if raw-record statistics reads become costly.
- [ ] Match-summary emails remain a proposal, not delivered behavior.
- [ ] Audit orphaned code via import/DOM/cache reachability before removal.
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
  whole site even with DEV-only source changes. The earlier tablet publication
  had explicit approval; no subsequent push/deploy is covered by this checklist.
- Next release scope: DEV account refresh, payment readiness/help text, cache
  v44, their regression tests, and these development notes. Review final scope
  and shared-site impact before publication. Production files stay identical.
