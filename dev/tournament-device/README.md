# Scoped tournament result desk — local/emulator candidate

This separate candidate implements Mike's clarified workflow: anyone may walk
up to an assigned shared tablet, enter a tournament match result, and advance
the bracket immediately. No submitter login or organizer approval is required.
The tablet has its own restricted device identity. An authenticated organizer
can use the same result-entry UI as an alternative.

The original synthetic QR prototype and Firebase seat-grant candidate are
preserved. This directory does not change application release gates, root/DEV
Firebase configuration, the accounts adapter, production rules, deployment
configuration, provider settings or any live service.

## Authority, audit and correction

- Organizer creates a sanitized event projection through the existing bracket
  engine, with fixed teams, registration IDs, match topology and device UID.
  Teams are doubles: 2 people each, 2–20 teams in this candidate.
- Only that event's assigned device or organizer can change its result state.
  The device can read the event projection and audit; it cannot read/write
  account profiles, private roster, result history or owner-private resume data.
- Each result/correction/undo atomically increments the event revision and creates
  one immutable audit record. Rules independently check the current competitive
  sources, teams, winner, best-of score, attribution, exact changed match and
  before/after values. Missing, forged, altered or deleted audit entries fail.
- The audit records event, match, server time, before/after, revision, operation
  ID, reason and authenticated principal. Shared-tablet entries explicitly have
  `source=shared-device-unknown-human` and `humanUid=null`. The device principal
  is not presented as the person who tapped. Organizer entries record that
  authenticated organizer UID. Neither mode certifies the physical score.
- Current results are replayed through the existing engine for immediate bracket
  advancement. No broad snapshot write or arbitrary roster edit is granted to
  the tablet. Structural bye sources are normalized once in the immutable
  organizer template; runtime rules check immediate competitive sources.
- A correction/undo is blocked if completed descendants exist. The UI identifies
  those matches in reverse order. Users must explicitly undo dependent completed
  matches first; each step receives its own audit. There is no silent cascading
  deletion of completed games. Unplayed waiting/ready slots recalculate normally.
- The preview shows the tournament, match, teams, registrations, scores,
  attribution and affected matches. Explicit confirmation is required. A changed
  selection, event revision, session or player-attribution state requires a new
  review. Repeating an accepted operation ID is idempotent. Concurrent edits
  cannot silently overwrite each other.
- Organizer can end entry or revoke the device. End prevents further result
  changes/consent; prior audit remains. Device revocation removes its event
  access while retaining the organizer's alternative. Completed bracket status
  alone does not close corrections; explicit end makes the event read-only.

## QR identifies roster players, not the result submitter

An optional QR carries only event and registration IDs in its URL fragment.
The signed-in phone shows its actual UID and the exact roster slot and named
tournament. A mismatched account cannot confirm. Consent is explicitly for
**history attribution across this tournament**, up to 12 hours; it is not
approval of each score and is not silently upgraded from the earlier game-seat
grant. Registrations without an expected UID remain guest/unlinked.

Consent is optional for scoring. Every accepted result snapshots each of its four
registrations and the currently consented UID, or null. Revocation/expiry stops
future UID attribution without blocking result entry. Existing immutable audit
entries retain the attribution accepted at that time. Reusing the same UID or
registration label in another event does not transfer consent. Duplicate names
never determine identity. Roster assignments are frozen for this event instance;
roster-edit/reassignment workflows are not included.

The existing local QR encoder is reused with its retained license. The rendered
QR is independently decodable. Loopback URLs do not establish physical-phone
camera/network behavior. Authentication setup is provided by the synthetic test
harness, not a deployed login page; components export the consent-from-URL entry
for later integration into the approved phone Auth flow.

## Data contract and accounts integration

| Path | Role |
| --- | --- |
| `tdEvents/{eventId}` | Immutable public projection, owner/device assignment and terminal entry flag |
| `.../state/current` | Revision, completed competitive match results, last operation ID |
| `.../audit/{operationId}` | Immutable accepted record/correction/undo and original attribution |
| `.../identities/{registrationId}` | Verified phone's explicit named-event attribution consent |

Use existing `tournament.id` as eventId, bracket `match.id` as matchId, stable
registration IDs and `team.memberIds`, and Firebase UID only as human identity.
These are end-of-match tournament records, not per-dart phone scoring. Do not
substitute a device UID for the roster or confuse event revision/operation IDs
with owner-private active scorer session IDs/revisions.

`resume.rules.fragment` is pinned to the owner-private collection from accounts
commit `9aed216`. It is included only to test isolation. This candidate does not
merge or write the accounts/resume checkout. The full UI and write path for
existing `/dev/brackets/`, private account-history pages, historical counters,
immutable legacy result IDs and owner-private active-game autosave remain
unwired. Current match results and auditable UID attribution exist in the new
event collections; do not claim they already appear in account history.

Before integrating, the accounts owner must choose one authoritative result
write path for a live tournament, map accepted event/match audit operations into
its result/correction history model, and reconcile undo with historical counters.
Do not run this projection alongside independent legacy result writes for the
same event or give the tablet account privileges to bridge the gap. Reconcile
later resume-rule changes explicitly rather than deploying this pinned version.

## Run and verify

Set the same explicit tool variables used by `dev/qr-firebase/run_tests.py`:
`BLAKEOUT_QA_NODE`, `BLAKEOUT_QA_JAVA`, `BLAKEOUT_QA_JAR`,
`BLAKEOUT_QA_MODULES`, `BLAKEOUT_QA_PLAYWRIGHT`, `BLAKEOUT_QA_CHROME`, and
`QR_EVIDENCE` outside this checkout. Run:

```
python3 dev/tournament-device/run_tests.py
```

The runner requires a fresh `unshare -Urn` loopback-only network namespace. It
bundles Firebase 10.13.2 locally and uses real Auth/Firestore emulators, fresh
headless browser contexts and synthetic accounts. It makes no downloads or
live calls. Saved role lists are empty; tests inject fixture UIDs only into
emulator memory. The adapter and session entry reject non-demo projects.

Tests cover visible shared-tablet/organizer entry, QR/consent, duplicate names,
attribution revocation/expiry, four linked players, immediate advancement,
concurrent edits/idempotency, audit forgery/immutability, dependency-blocked undo,
reverse-order undo, event/device isolation and private snapshot/history denial.
A 20-team doubles event runs all results through actual SDK/rules including a
reset final. The existing 155-case account matrix runs five phases (775 cases).
Source hashes, interface/routes, logs, screenshots and exact outcomes are saved.

Independently decode the rendered QR using a Python environment with Pillow and
system libzbar: `python dev/tournament-device/decode_qr.py "$QR_EVIDENCE"`.

## Live prerequisites and limits

No real account/device provisioning, publication, rules deployment or billing
change is authorized or performed. A future pilot needs review of exact merged
rules and projections, explicit organizer/device/player UIDs, approved HTTPS
hosting/Auth wiring, retention/cleanup, and real-device testing. This design uses
existing Firebase client/rules capabilities; no Functions or new paid backend is
introduced. Current live access, plan and quotas were not inspected.

The organizer is trusted to initialize a valid sanitized template; rules do not
prove that an organizer-created arbitrary template matches a real event.
Anyone at an authorized tablet can deliberately enter a wrong score or unwind
results in permitted order—the audit supports correction, not person-level
nonrepudiation. Devices need deliberate session custody and revocation. Offline
transactions fail rather than silently queueing progression; offline tournament
operation is not implemented here. Long-running audit retention/quota behavior,
other team sizes/formats, physical mobile login and production throughput are
not certified by the local tests.
