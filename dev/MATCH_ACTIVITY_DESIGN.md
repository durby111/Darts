# Explicit active-match state: compatibility and next boundary

Status: design only. No activity writer, activity UI, collection, schema, or
security-rules change is implemented or deployed by this work.

## What exists

The tournament engine, authoritative scorer launch, and immutable-result write
path use `pending`, `ready`, `complete`, `bye`, and `void` match states. `ready`
means both sides are available; it is not evidence that anyone started playing.
A saved local scorer session is likewise not reliable cross-device activity.

`platform.js` encodes matches through an exact field list. The checked-in
`firestore.rules` `devMatchPayload` grammar rejects both `active`/`playing`
status values and additional activity/lease fields. Tournament documents also
have an exact top-level field list; unknown collections/subcollections are
denied. Four negative grammar checks cover the proposed status/field shapes.
These are checked-in Python regex tests, not emulator or live-policy proof.
The deployed policy was not read or changed.

Do not put activity into team names, result scores, `forfeit`, or another field
that happens to pass validation. Do not infer it from Ready or from which card
an organizer selected. A shared/public activity feature cannot safely ship
under the current application/storage contract.

Matches are packed JSON strings, not structured match documents. Rules cannot
directly inspect a decoded match object. A client transaction can check a
server-read match, but that is not a server-enforced match-membership/readiness
policy. Before implementation, choose explicitly between owner-declared
advisory activity and stronger server-validated activity; the latter requires
a structured authorization record or trusted validator as well as new rules.
Do not claim that an owner-declared badge proves physical play.

## Recommended next implementation

Keep activity separate from bracket/results: an additive DEV-only activity
record for each tournament/match, keyed unambiguously by document path such as
`blakeoutDevTournaments/{tournamentId}/activity/{matchId}`. This path is currently
denied and requires explicit new rules. The initial feature should be advisory
presence, not a new exclusive right to submit a result. Existing immutable
result/revision validation must remain authoritative.

An activity record would contain explicit state, an opaque session identifier,
a monotonic generation, and server-authoritative start/last-seen/expiry times.
The session identifier is a correlation value, never an authentication secret.
Only the verified tournament owner may start, refresh, or release activity;
public readers receive no emails, private roster flags, or device details.

- Start only after the owner confirms and initializes a scorer session, and
  after a client transaction reads and validates the current tournament/match, teams,
  ready state, and expected revision. Selecting a card is not a start.
- Display Active only after server acknowledgement. Failed/offline starts stay
  unconfirmed; local scoring can continue under the existing offline behavior.
- Use an expiring heartbeat with a bounded request rate. A proposed initial
  cadence is one minute with a three-minute expiry, subject to free-tier read/
  write budgeting. UI must show stale/unknown after expiry, not indefinitely
  active. Rules must validate timestamps using server request time.
- Transactions compare session/generation. Delayed heartbeats/releases from an
  old session cannot overwrite a newer one. Simultaneous starts must have one
  committed activity owner; another session sees a conflict, not false success.
- Explicitly end activity on acknowledged completion/cancellation. Completed,
  void, or otherwise invalid matches override any lingering activity record.
  Do not depend on tab-unload delivery for cleanup.
- Reconnect must re-read server state. Preserve offline scoring locally and
  never silently discard it or take over another session's activity.

An exclusive scoring lease would be a different feature: it would need a
fencing token in result submission and a decision about offline results after
lease expiry/takeover. It must not be introduced accidentally as part of a
visual Active badge.

## Required local tests before enabling

1. Anonymous, unverified, wrong-owner and cross-event writes denied; private
   fields rejected; public read payload contains only approved activity data.
2. Two starts racing, duplicate requests, lost replies and stale generations
   produce one acknowledged activity state without changing bracket results.
3. Heartbeat expiry, clock skew, offline/reconnect and stale-tab release never
   restore old activity or make Ready imply Active.
4. Cancellation before launch creates no activity; failed acknowledgements do
   not display Active; completed/invalidated matches override stale presence.
5. Existing result idempotency, revision checks, offline recovery, statistics,
   signup revision coupling and correction invariants remain intact.
6. Compile and exercise proposed additive rules in a localhost emulator using
   a demo project; test app compatibility and service-worker upgrades locally.

## Precise stop boundary

The next step is an additive persistence/rules prototype plus emulator tests.
No integrated activity writes or public Active indicator should be enabled
until those pass and the specific rules/schema deployment is approved.
`FIRESTORE_EMULATOR_HOST` is unset here. Today's authorization excludes deployed
security changes and live Firebase writes, so this feature stops at design and
current-schema rejection tests. No network/security permissions were expanded.
