# Pure result-correction core

`js/result-corrections.js` is an **unintegrated, storage-free prototype**. No app
page, scorer, service worker, Firebase adapter or rules file imports it. It does
not enable corrections, change stored schemas, perform writes or alter lifetime
records. Production and DEV behavior are unchanged until a separately reviewed
integration is implemented and authorized for release.

## Recovered foundation validation (2026-10-09)

The preserved original module and its 219-test suite first passed unchanged
against their original engine. The module was then copied unchanged into this
DEV checkout. Against the current engine, the original suite initially failed
all 219 tests while constructing tournaments: its shared start fixture marked
playing registrations `paid: false`, which the current engine correctly rejects.

The only test adjustment sets that fixture to `paid: true` and explains why.
All **219 tests pass** against the current engine with this adjustment. No test
assertion, planner implementation, engine rule, authorization requirement or
feature-availability flag was relaxed. The module's separate synthetic topology
preview still uses unpaid registrations because previews do not start play.

This is DEV-only groundwork. Brackets and Players & Records remain unavailable
behind their existing Coming soon gates. No app entrypoint, service-worker
cache, storage adapter, Firebase rules or production file was wired to this
module. The checks below establish pure-function compatibility only; they do
not establish a safe, deployed correction workflow.

## Supported first slice

- Plan a manual outcome correction for a completed tournament match only while
  the existing engine permits it. Completed downstream play blocks correction,
  including a same-winner score edit
- Plan statistics-only invalidation without changing any bracket field, even
  after downstream play
- Select effective records for lifetime calculations while preserving excluded
  originals in audit/export output
- Classify pending result identity/lifecycle without saving, deleting or pruning
  any local recovery data

No cascade resets, participant reassignment, replacement dart/turn ledger,
casual-result corrections or restoration workflow are implemented. Correcting
an outcome excludes its existing recorded statistics; it creates **no fabricated
counters**. Invalidating statistics preserves the official outcome and all
subsequent matches while excluding the whole recorded match from lifetime totals.

## Trust boundary

These pure functions validate supplied data and business invariants. An `actor`
object is **not authentication**, and a returned plan is **not authorization**.
A future adapter must load a verified account and complete authoritative
snapshots inside its transaction, enforce actual security rules, and atomically
commit the relevant event/index/tournament updates. Client-supplied flags cannot
establish those facts.

Records must be decoded and validated by the existing storage boundary first.
`platform.js` already validates counter grammar, capacity, participant membership
and numeric limits. This module does not duplicate or certify that arithmetic.
It requires explicit collection-derived `source`, stable physical identity and
decoded `perPlayer` arrays, and preserves record data unchanged.

## Planner input

Both planners receive one argument with:

- `tournament`: authoritative decoded owner snapshot, using this engine's current
  canonical doubles topology, with 2–32 teams
- `actor`: `{ uid, emailVerified: true, isAnonymous: false }`; UID must equal the
  tournament owner
- `index`: the confirmed lifecycle index, or explicit `null` when no index exists
- `records`: the complete, caller-authorized tournament records for **only the
  selected match**, with `source`, `id`, `ownerId`, `tournamentId`, `matchId` and
  decoded `perPlayer`
- `recordsComplete: true`: caller's explicit confirmation that the query completed
  and all its pages were loaded; a failed/partial query is never an empty result
- `matchId`, `operationId`, and `reasonCode`
- `expected`: `{ tournamentRevision, indexRevision, correctionEpoch,
  activeResultId }`; use zero index revision/epoch for a confirmed absent index,
  and null active ID only when the selected match has no active recorded result
- `priorEvent`: the authoritative receipt for this operation ID, or explicit
  `null` after a successful lookup confirms absence. Omitted/undefined is rejected

`reasonCode` is one of `score_entry_error`, `wrong_winner`, `recording_error`, or
`other`. It belongs to the proposed private audit event, not the public index.

`planCompletedResultCorrection` additionally requires exact `outcome` fields:
`{ winnerId, scoreA, scoreB, forfeit }`. Scores and winner must satisfy the
existing engine. A forfeit requires both scores to be null. An unchanged outcome
is rejected; use statistics invalidation if only the ledger is erroneous.

`planResultInvalidation` rejects an `outcome` argument and requires an active
recorded result. The tournament it returns is a deep copy with **every field,
including its revision, unchanged**.

## Proposed index contract

This is a local data contract, **not a deployed Firestore schema**:

```javascript
{
  schemaVersion: 1,
  tournamentId,
  ownerId,
  revision,
  correctionEpoch,
  heads: {
    [matchId]: {
      activeResultId, // ID for state "active"; null otherwise
      state,          // "active", "manual", or "invalidated"
      generation,
      operationId
    }
  }
}
```

`validateResultIndex` returns an independent validated copy. Unknown keys are
rejected, including notes, private roster flags, participants and raw data. At
most 63 match heads are allowed. IDs, safe-integer revisions, generations,
epochs, duplicate active result pointers and duplicate operation pointers are
checked. The epoch cannot exceed the index revision; a head generation cannot
exceed its index revision. Excluded heads require a non-null operation ID and
positive generation.

The planner also checks that heads refer to actual matches in the supplied
bracket. A result referenced by one head cannot be interpreted as legacy data
for a different match. Public metadata must never authorize reading private
result contents.

The pure planner validates canonical match IDs/order, dependencies, bye paths,
final/reset wiring, seed membership and uniqueness. This matters because the
existing engine's descendant guard assumes topological order and its GF2 logic
has an implicit dependency on GF1. It additionally checks that a correction
preserves every other completed match byte-for-byte, and leaves the selected
match complete with the requested outcome and unchanged participants.

## Planner output and replay

A new plan returns:

```javascript
{
  status: "planned", needsCommit: true,
  tournament, index, event,
  affectedMatchIds, excludedRecordIds
}
```

A manual correction advances tournament revision once through the engine.
Statistics-only invalidation leaves tournament revision untouched. Both advance
index revision, correction epoch and the selected head generation once. All
increments reject safe-integer overflow. `affectedMatchIds` describes bracket
state changes; it is empty for statistics-only invalidation. The event still
identifies the selected match.

The event preserves the normalized request, before/after outcome and head,
committed revisions/epoch, and excluded result IDs. It contains no clock-derived
timestamp, random ID or invented score ledger. The caller supplies a stable
operation ID before attempting a transaction.

A retry with the same authoritative receipt and identical normalized request
returns `already-applied`, `needsCommit: false`, `event: null`. If a later
operation has superseded its head, it returns `superseded` without rewinding
anything. Reusing an operation ID with a different actor/target/reason/expected
state/outcome rejects. Inconsistent receipt/current-state combinations reject.
The future adapter must enforce globally unique receipts and must not claim a
receipt lookup was absent when it failed.

## Effective-record projection

`projectEffectiveRecords({ records, recordsComplete: true, tournamentIndexes })`
accepts the complete set of records the caller is authorized to read.
`tournamentIndexes` maps each represented tournament ID to its validated index
or explicit `null` for a confirmed absent legacy index. Missing/failed index
reads reject; do not translate them into null.

It returns independent `activeRecords`, `excludedRecords` and `auditRecords`.
Audit entries have `{ record, status, contributes }`. Status is `active`,
`active-legacy`, `superseded`, `manual-correction`, or `invalidated`.
Only `activeRecords` may feed lifetime counters and match counts. Audit/export
can preserve all originals and exclusion status.

Selection rules:

- Physical identity is `[source, documentId]`. Identical observations dedupe;
  conflicting payloads for one physical ID reject
- Logical tournament identity is `[tournamentId, matchId]`. An explicit active
  head chooses one version. Missing referenced records reject instead of falling
  back to old data
- A null active head in `manual`/`invalidated` state excludes all versions
- With no head, exactly one legacy record is allowed; multiple IDs require review
- Source namespaces are separate. Casual owner/receipt copies dedupe by physical
  ID; distinct casual IDs remain separate even if their match IDs match
- No version is chosen using timestamps

The index may describe other matches for which the current user has no record.
Projection does not fetch, require, or grant access to those players' data. A
missing active record is checked within represented logical matches. The adapter
remains responsible for complete authorized result queries; the pure function
cannot discover records omitted from its input.

## Pending recovery classification

`classifyPendingResult({ tournament, actor, index, records, recordsComplete,
pending })` uses match-scoped records and a pending descriptor containing
`resultId`, `matchId`, `tournamentId`, `ownerId`, and `correctionEpoch`.

It returns `already-active`, `superseded`, `uncommitted`, or `conflict`, with a
reason and **always** `preserveLocal: true`. It recognizes prior commitment
before checking stale launch epochs, so a committed but excluded record does
not look like a never-saved game. Newer epochs block uncommitted sessions even
when the same teams remain. A legacy session without an epoch requires review.

This classification establishes identity/lifecycle only. It is not confirmation
that a local pending payload equals a cloud record, that teams/game format still
match, or that a save is authorized. The adapter must perform those checks and
obtain a confirmed result before marking a local session saved. The pure module
never prunes local state.

## Verification

Dependency-free unit/invariant suite, using the actual engine (verified with Node 24.19.0):

```sh
node --test dev/tests/result_corrections_test.mjs
node --check dev/js/result-corrections.js
git diff --check
```

No Firebase, browser, npm dependencies, network, clocks or persistent writes are
required by the suite. Node is used only as an available test runtime; there is
no bundler or new application dependency. Browser compatibility, screen readers,
real auth, Firestore compilation/access rules, quotas and deployment are separate
integration checks.

## Integration gates

The current adapter exposes ordinary tournament updates and immutable-result
saves, but no lifecycle-head or correction-event persistence API. The current
rules deny updates/deletes to result documents and define no correction index
or event collections. Preserve that immutable-record policy; adding a separate
validated lifecycle protocol requires its own implementation and review. Do not
send the returned plan through the generic tournament updater, since it does
not atomically commit the index and event or prevent older readers from counting
excluded records.

1. Define and prove the real transaction/head/event protocol with the actual
   Firestore compiler/emulator, including size and lookup/expression budgets
2. Block generic completed-bracket mutations that omit lifecycle bookkeeping,
   and bind newly scored results to their head assignment atomically
3. Preserve public/private/signup revision pairing where tournament data changes
4. Make operation receipt lookup, query completion and index absence explicit;
   never turn network failure into an empty legacy snapshot
5. Route lifetime counts and exports through the projector, preserving exclusion
   annotations and provenance
6. Address old cached account readers before enabling correction writes; a cache
   bump alone cannot guarantee cross-version consistency
7. Integrate correction epoch and explicit saved/superseded/conflicting outcomes
   into scorer retries while retaining all pending local data
8. Test owner/participant/spectator privacy, concurrent operations, receipt retry,
   offline recovery, maximum-size fixtures, and actual tablet/browser behavior
9. Obtain separate publication/deployment authorization

No correction UI, rules deployment, collection migration, causal replay,
replacement ledger, casual invalidation or live operation is included here.
