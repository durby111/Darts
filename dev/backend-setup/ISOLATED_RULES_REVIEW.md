# Isolated DEV rules review candidate

Local preparation only, based on account candidate
`756cf9901c11045019a3ce13c50accf200575fad`. Local compilation, rules enforcement and real-SDK emulator integration have passed.
This is **not deployed or approved for activation**. The root `firestore.rules`, root `firebase.json`,
production application code and all public feature/provider gates are unchanged.
The later local hardening adds DEV-only ledger encoding and stored backend markers.

## Deliverables and deployment separation

- `firestore.isolated-candidate.rules`: separate review candidate for the default
  database of `blakeout-darts-dev` only. The separate `firebase.isolated-dev.json` references it; root config does not.
- `isolated-rules-cases.json`: synthetic initial documents and 155 expected
  allow/deny cases, including explicit known-limitation probes.
- `../tests/isolated_rules_test.py`: source-contract checks and an optional
  localhost-only emulator runner that loads **this candidate**, not root rules.

The candidate narrows the existing DEV wire schemas rather than copying the
production roster/usage permissions. Rules cannot enforce their target project
name from client input; deployment targeting is a separate approval control.
Default-database-only checks are included in every positive authorization path.
Nothing here creates an implicit deployment route or a Firebase CLI alias.

## Authorization design

Every positive grant now requires explicit membership in `devPilotUids()` (empty
in shipped candidate), a nonempty supported UID, verified email and a
Firebase sign-in provider of `password` or `google.com`. Null auth, unverified,
anonymous (even with a forged verified flag), custom and Apple provider fixtures
are denied. Google authorization here does not turn on the app's provider gate.
Authentication claims must be Firebase-issued in a real environment; synthetic
unsigned JWTs are used only by the local emulator test runner.

| Collection | Intended access |
| --- | --- |
| `blakeoutDevProfiles/{uid}` | Verified directory of display names only; only the matching UID can create/update; no deletion. No emails or auth claims. |
| `blakeoutDevTournaments/{id}` | Verified directory/read, owner writes only; initial revision zero, stable owner/creation time, atomic private-roster/signup-state pairing and advancing revision. |
| `blakeoutDevRosterPrivate/{id}` | Organizer-only existing-document get; no list. Writes paired with that organizer's tournament revision. Contains payment/check-in/standby flags. |
| `blakeoutDevSignupState/{id}` | Verified read; owner paired revisions or atomic verified self-signup revision. No anonymous branch. |
| `blakeoutDevSignups/{id}/players/{uid}` | Verified read; self-create using own profile name/UID only while registration is open; owner removal paired with revision/member removal; no updates. |
| `blakeoutDevResults/{id}` | Immutable organizer-created result, tied to owned live tournament, matching game and atomic next revision. Reads limited to owner or declared participants; queries must prove that restriction. |
| `blakeoutDevCasualResults/{id}` | Immutable scorekeeper-created result. Owner read/query; participant get only with their receipt. Unfiltered lists and other-user owner queries denied. |
| `blakeoutDevCasualReceipts/{resultId$uid}` | Immutable receipt created only by the original result owner for a declared participant with an existing profile. Owner/recipient get, recipient-only query. |

No grants exist for `roster`, `rosters`, `usage`, other collection families,
unrelated nested subcollections, or named databases. Recursive fallback denies
all; it cannot override a positive grant, so the allowed matches are explicitly
restricted to the eight families above. Missing-document gets by verified users
support transaction idempotency/creation but do not permit reading another
user's existing private document. A forbidden get versus an allowed missing get
can reveal existence; this is not an absolute existence-hiding design.

Profiles, tournament names/rosters and signup names are intentionally visible to
all listed verified pilot accounts. They are not private account documents. Private
roster flags and result/receipt bodies have the narrower access listed above.
A participant can see the whole declared shared match record, including other
participants' scores. No account emails, credentials or private profile fields
belong in those records.

## Schema/integrity checks and review findings

Packed public tournament strings retain exact-key grammars and reject literal
or escaped email delimiters. Private flags stay separate. Counter strings bind
IDs to declared participants, constrain numeric forms, and retain the 4-player /
12-counter tournament and 128-player / 384-counter casual bounds. Result optional
scores, booleans, record-container keys and winner IDs receive additional shape
checks. Minnesota cutthroat metadata is allowed only for Minnesota results.

The following are **unresolved design limits, not passing security claims**:

1. Nested ledgers now use canonical JSON wire strings with exact schemas at every
   leg/turn level. Unknown keys, free text, out-of-range turn values, unrelated
   player IDs and noncanonical reads are rejected by the adapter. The candidate
   rules have corresponding full-string grammars, size/leg limits and ID
   membership checks. The former expected-allow nested-extra-field probe is now
   expected-deny. This resolves the proposed schema gap; Firestore emulator enforcement, RE2 behavior and the supplied expression-budget
   fixtures now pass; this does not prove live-project configuration.
   It does not certify that declared turns or aggregate scores happened.
2. Packed tournament JSON cannot establish that the declared result participant
   list truly belongs to the chosen ready match, or that counters match darts.
   Existing-profile checks and owner/revision/game checks prevent some mistakes,
   but an organizer can still fabricate statistics or choose participants.
   This is a scorekeeper-declared data model, not certified results or participant
   consent. A trusted match/result validator or normalized schema would be needed
   for that stronger promise. Do not represent rules as enforcing the UI engine.
3. A 128-person casual result cannot perform 128 profile-document lookups in one
   rules evaluation. Its participant IDs/counters are validated structurally;
   each independently created receipt checks profile existence. An owner can
   store a result containing a nonexistent UID, but cannot create its receipt.
   The suite includes an expected-allow probe documenting this limitation.
4. The supplied expressions, access-call limits, RE2 grammars, query proofs and
   largest-result fixtures now pass the local Firestore emulator. Unrepresented
   workloads and live-project settings still need separate verification.
5. The adapter now writes the exact project/app `backendKey` into results and
   receipts, and candidate rules require it on creation and receipt linkage.
   Reads/retries in the adapter reject foreign or missing markers rather than
   upgrading old records. This is schema consistency and accidental replay
   protection, **not attestation**: a malicious client can copy the public marker.
   Existing local saves remain intact; no old data or queued results are migrated.
6. Removing public tournament reads deliberately blocks logged-out cloud browsing.
   This is compatible with a restricted verified-account trial, not a public
   spectator release. The shipped feature gates remain off.

## Exact synthetic test plan

Run from the repository root:

```sh
python3 dev/tests/isolated_rules_test.py
```

With no emulator configured the runner explicitly skips enforcement. Use the
fail-closed network-isolated runner documented in `LOCAL_EMULATOR_QA.md` for
meaningful evidence. The 155 original fixtures remain unchanged. Each runs four
times: default empty membership denies all, explicitly listed synthetic actors
retain the original expected decisions, verified unlisted actors are denied,
and removed membership denies the original actors again. Provider/verification
negative fixtures are included in the synthetic list so those checks remain
independent. Test lists are substituted only into ephemeral demo emulator rules.
No real UID is inserted into the on-disk candidate.

The checked-in matrix defines exact actors, paths, payloads, seed overrides and
expected decisions for: six disallowed auth states; all eight path families;
legacy/unrelated/subcollection denial; profile spoofing, email/extra-field/name
bounds; private roster isolation; atomic create/update and stale/owner changes;
self-join identity/name/open-state/idempotency; owner/participant/unrelated result
reads and scoped queries; immutable writes/deletes; counter membership and shape;
receipt ownership/path/participant/profile checks; missing receipt denial;
Minnesota metadata; tournament lifecycle/revision; four-player twelve-counter
transactions; 128/384 casual boundaries and overflow; the remaining missing-profile residual-risk expected-allow probe; strict ledger
negative cases; foreign/missing backend markers; and receipt marker linkage.

## Evidence, deployment prerequisites and cleanup

Baseline commit `19c552b110c2394d083172c78e17dbbfa0b5a211` passed 155 rule
cases, a 1000-turn ledger, 26 real-SDK integration groups, all 19 Node test files,
and browser regression suites. That baseline did not restrict named pilots.
The pilot change has separate evidence; do not relabel baseline logs as pilot tests.
See `PILOT_PREPARATION.md` for the new candidate hash, offline guard, tests,
required owner decisions, revocation limits and cleanup boundaries.
