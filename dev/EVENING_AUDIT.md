# BlakeOut evening audit — October 6, 2026

Historical audit. The October 8 follow-up recovered both original artifacts and
reproduced their tests in the current workspace. Current status and limits are
in [FEATURE_READINESS.md](FEATURE_READINESS.md); the transfer and environment
statements below describe October 6 only.

Reconciled against the original **HANDOFF_DOT.md**, prepared October 3, read
in full through Library (503 lines), the saved-patch descriptions, current source,
and this day's test/deployment evidence. The original handoff and ZIP artifacts
were not overwritten. Later owner authorization permits today's tested DEV-only
batches; it does not permit production promotion or deployed security changes.

## Original backlog reconciliation

| Original requirement | Status tonight | Scope and limits |
| --- | --- | --- |
| Unique player names | Shipped under clarified event-only distinction | Numbered display prefixes distinguish matching names in event roster/bracket/scorer. Names, IDs, profiles and signups remain unchanged. This is not a global name-ownership or duplicate-rejection rule. Labels may renumber when the roster changes. |
| Roster numbering/count | Shipped | Row numbers; explicit total, standby, non-standby and complete/incomplete-pair counts. Draft counts are not claimed as saved cloud state. |
| Paid Start/Lock | Shipped under clarified playing-roster rule | Assigned playing members must be paid. Standby and unassigned unchecked arrivals do not create payment blockers. Existing check-in/pairing rules still apply. |
| Bulk checkmarks | Shipped | Paid, Checked-in and Standby all/none/mixed controls cover all draft rows and require revision-checked Save. |
| Odd roster warning | Shipped | Odd non-standby count is advisory; it does not independently block Start. |
| Visible blocked Start/Lock action | Original patch blocked | Existing inline blockers remain. The separately reproduced ordinary setup Start/Resume clipping was fixed; that is not proof the reported tournament Start/Lock failure is fixed. Missing team tags remain an unconfirmed cause. |
| Bracket states | Partly shipped; activity design only | Pending/not-required cards are subdued; Ready stays Ready. This audit release adds green winner/red loser outlines with Won/Lost text for completed matches, including forfeits. No active-playing state is inferred. |
| Distance readability | Local checks only | Tablet viewport/scale tests pass. Physical readability a couple feet away remains a real-device check. |
| Drag/order/grouping | Partly shipped | Accessible up/down draft controls preserve IDs, team membership and partner order. Drag/drop and grouping after lock are not implemented. Locked roster semantics remain unchanged. |
| Cricket alignment | Partly shipped, tested scope | One/two-player tablet badges align with targets/marks. Phone and three/four-player corner badges remain to avoid overlap; the full original all-layout request is not marked complete. A separate pre-existing DC Spanish touch-target overlap is fixed. |

Other original follow-ups:

- Account refresh concurrency is fixed and mocked flows pass. Genuine branded
  verification-link completion, current owner verification state, and an actual
  password change are not newly proven. Historical September reset-email proof
  is not a substitute for today's provider verification.
- Completed-result correction/invalidation is **not integrated**. Existing pure
  engine leaf-correction tests do not prove immutable cloud-result correction.
- Raw-record aggregates and match-summary emails remain intentionally deferred;
  no measured read-cost trigger or summary-email implementation was introduced.
- HTTPS enforcement, headers/CSP, MFA/domain renewal/lock and infrastructure
  hardening were not changed or newly verified. No billing/plan changes.
- All 37 current DEV JavaScript modules are reachable from entrypoints. Four
  unused-export candidates remain unproven pending saved-archive comparison;
  no module or identity was deleted to manufacture cleanup progress.

## Original artifact work: separate from deployed code

| Artifact/work | Status |
| --- | --- |
| `blakeout-first-pass-review.zip` | Prepared externally; not materialized, inspected, applied or tested here. Reported seven DOM/six engine groups are not local validation. |
| `blakeout-result-correction-core.zip` | Prepared externally; not materialized or integrated here. Reported 219 tests are not locally reproduced. |
| Correction integration prerequisites | Written in BACKLOG.md; no persistence/schema/UI integration. |
| Active-match state | MATCH_ACTIVITY_DESIGN.md plus four current-grammar rejection checks. No activity writer, collection, schema or Active badge. |

Current checked-in match encoding rejects `active`/`playing` and extra fields;
unknown collections are denied. Matches are packed JSON, so stronger server
validation needs a deliberate storage contract. The next activity/correction
boundary is local additive persistence/rules work, emulator validation, then
specific deployment approval. No ready backend release is being presented for
approval tonight. Emulator setup is engineering work, not a request for Mike
to configure Firebase while at work.

## Shipped release evidence

| Release | Pages run |
| --- | --- |
| Tablet setup `d5b09ab` | [37459450018](https://github.com/durby111/Darts/actions/runs/37459450018) — success |
| Account refresh/payment `b8e8d96` | [37462591260](https://github.com/durby111/Darts/actions/runs/37462591260) — success |
| Roster counts `3e5fbc6` | [37462941482](https://github.com/durby111/Darts/actions/runs/37462941482) — success |
| Bulk flags/warning `3a45116` | [37463707288](https://github.com/durby111/Darts/actions/runs/37463707288) — success |
| Cricket fixes `3f0946c` | [37464754031](https://github.com/durby111/Darts/actions/runs/37464754031) — success |
| Draft order `8cdcaae` | [37465245055](https://github.com/durby111/Darts/actions/runs/37465245055) — success |
| Event labels `6bdc6c2` | [37467746048](https://github.com/durby111/Darts/actions/runs/37467746048) — success |

The audit release adds only completed-match outlines, related tests, this
reconciliation, and DEV cache v50. Its final commit/run is recorded in the
executor release evidence and final report after publication.

All non-DEV paths remain byte-identical to base
`062f2f6208e820c614be4ce6f686185afb4eff79`. Main publication rebuilds the shared
Pages site; root source, rules, provider configuration and live data were not
changed. The separate original checkout remains at that base and clean.

## What the tests prove

- Original baseline: 54/55 after fixing the executor's missing QR dependency;
  remaining failure was clipped Start at 744×1133. Tablet fix reached 55/55.
- Full DEV suite after Cricket changes: 57/57. Subsequent changes used relevant
  targeted/integration suites; do not interpret this as a fresh full-suite run
  at every later commit.
- Latest engine: 8/8 groups; platform: 135 API assertions, 48 packed grammar
  checks and account/email UI mocks. Latest bracket UI: 19/19, including this
  audit's result/forfeit outlines and dark/light contrast checks.
- Full scoring integration passed 62 checkpoints before the presentation-only
  switch to numeric prefixes; final prefix/long-name/offline-resume checks were
  rerun successfully afterwards. IDs, result payloads and cloud names stay raw.
- Three touchscreen-emulated viewport flows verified repeated row moves,
  failed-save retention, retry and locking. These are not physical-tablet proof.
- Cache v50 has 63 existing precache assets; the fresh-install/offline probe
  checks removal of older DEV cache, preservation of production cache, and
  successful ordinary offline scoring.
- Firestore emulator/compiler is unconfigured; regex checks are not rule
  compilation or live authorization proof. Provider calls were mocked.
- Pages success is verified. The executor's proxy blocks the live website, so
  served bytes, actual service-worker uptake and live provider behavior remain
  unverified from here. No proxy workaround or permission expansion was used.

## Tonight's short checklist

1. Open **/dev/** on the actual tablet. Keep saved games; **do not clear site
   storage**. Check portrait/landscape Start and Resume reachability.
2. In a DEV draft, leave one playing member unpaid, then mark paid and Save.
   Check that an unpaid standby player does not block an otherwise ready start.
   Try bulk flags and row arrows; verify partners remain unchanged.
3. Add two same-name guests. Check numbered event labels in roster/bracket and
   scorer; reload/resume and confirm the thrower label still distinguishes them.
4. Enter T20 and single 19 in tablet Cricket. In landscape DC mode at 1.5×,
   verify tapping 19 records 19. Check physical readability from playing distance.
5. Complete a DEV match; check green Won/red Lost outlines and bracket advance.
   Ready is not an Active indicator. Result correction is not available.
6. Check your own account's actual verification state. If verification is still
   needed, complete the genuine link flow; automatic tests did not prove it.

## Exact unblock actions

- **ZIP work:** attach the two original ZIPs directly to this consuming task.
  Alternatively, the environment owner can deliberately allow only the required
  materialization hosts listed in BACKLOG.md; no GitHub reconnection is needed.
- **Live-site checks:** test DEV in your own browser, or have the environment
  owner allow `blakeoutdarts.com` for executor verification. Ordinary local tests
  and GitHub deployment verification already work.
- **Agent-sent email test:** explicitly authorize the recipient and a real test
  email first. Do not share passwords, ID tokens or verification links in chat.
- **Backend features:** local prototype/emulator work can be prepared separately;
  a specific tested rules/schema deployment needs approval before enabling
  activity or correction writes. No such deployment occurred today.

No additional feature was added merely to fill time. The outline fix above was
an explicit original requirement found during reconciliation. Remaining work
stops at the documented artifact, backend, physical-device and scope boundaries.
