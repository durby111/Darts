# Isolated DEV rules review candidate

Local preparation only, based on account candidate
`756cf9901c11045019a3ce13c50accf200575fad`. This is **not compiled, deployed,
or approved for activation**. The root `firestore.rules`, root `firebase.json`,
production application code and all public feature/provider gates are unchanged.
The later local hardening adds DEV-only ledger encoding and stored backend markers.

## Deliverables and deployment separation

- `firestore.isolated-candidate.rules`: separate review candidate for the default
  database of `blakeout-darts-dev` only. No Firebase configuration references it.
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

Every positive grant requires a nonempty supported UID, verified email and a
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
all verified test accounts. They are not private account documents. Private
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
   expected-deny. This resolves the proposed schema gap; **Firestore enforcement,
   RE2 behavior and expression budgets remain unverified** until emulator tests.
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
4. Expressions, access-call counts/caching, RE2 grammar support and query proofs
   have not been tested in Firestore. Largest-result budget fixtures are included.
   An emulator compilation or budget failure must be fixed before live approval.
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

With no emulator configured this runs source checks and explicitly skips all
155 enforcement cases. Once an approved existing emulator is provisioned in
this same executor, set `FIRESTORE_EMULATOR_HOST=127.0.0.1:<approved-port>` and
run the same command. No Firebase CLI or credentials are needed by the runner.
Do not retry the denied download or choose an alternate mirror/environment.

The runner uses a unique `demo-blakeout-isolated-rules-<pid>` project and a literal
loopback endpoint. It does not use proxies or live endpoints. It loads only the
candidate rules, clears only that synthetic emulator namespace between cases,
and seeds the case's synthetic documents via the emulator admin identity. Every
actual tested action uses its specified unprivileged auth fixture. A permission
denial must be HTTP 403, not a parse/server error. A permitted missing get may be
404; other allowed operations must be 200. Failures stop the suite. No production
or customer data is read or required.

The checked-in matrix defines exact actors, paths, payloads, seed overrides and
expected decisions for: six disallowed auth states; all eight path families;
legacy/unrelated/subcollection denial; profile spoofing, email/extra-field/name
bounds; private roster isolation; atomic create/update and stale/owner changes;
self-join identity/name/open-state/idempotency; owner/participant/unrelated result
reads and scoped queries; immutable writes/deletes; counter membership and shape;
receipt ownership/path/participant/profile checks; missing receipt denial;
Minnesota metadata; tournament lifecycle/revision; four-player twelve-counter
transactions; 128/384 casual boundaries and overflow; the remaining missing-profile residual-risk expected-allow probe; strict ledger
negative cases; foreign/missing backend markers; and receipt marker linkage. This is a concrete test plan, not an assertion that the
rules already enforce its expectations.

After this suite can run, additional required emulator integration work is to run
the actual adapter against these candidate rules (not mocked SDKs), including
concurrent signup/start/save, multi-receipt interruption/retry, fresh/reused auth,
query indexes, offline reconnect, and the new strict nested-ledger wire format. Real mail/OAuth, actual-device and cross-device behavior remain separate.

## Evidence and exact blocker

Inspection of this executor found Java at `/usr/bin/java` but no `firebase`
executable, no cached Firestore emulator JAR in the inspected workspace/temp,
Firebase cache or installed-tool locations, no installed `firebase-tools` package,
and no `FIRESTORE_EMULATOR_HOST`. No downloads, alternate hosts/proxies or new
environments were used. The previous emulator-download rejection was not retried.

Completed: candidate source-contract tests, synthetic matrix structure/uniqueness,
Python syntax check and `git diff --check`. No compilation or emulator case ran.
Canonical root rules/config and all public gates remain byte-identical to the
preceding local account candidate. DEV runtime changes are covered separately in
`ISOLATED_RESULT_HARDENING.md`; no production runtime changed.

Next provisioning requirement: provide an approved Firestore emulator JAR plus
its supported local launcher/version (or an already-running approved loopback
Firestore emulator) **in this executor**. Its compiled-rules endpoint and actual
allow/deny behavior must then pass the candidate suite. No Firebase Console
change is needed merely to finish this local preparation. The new nested-ledger enforcement must be proven and the
participant-integrity limits above addressed or explicitly scoped before
requesting a live trial. Any later deployment request must name the exact tested
rules hash, `blakeout-darts-dev` default database, designated synthetic/live test
accounts and records, and cleanup scope; mail, settings changes and DEV activation
remain separately unauthorized.
