# Firebase QR pairing candidate — emulator only

Separate branch `local/qr-firebase-candidate`, based on the preserved synthetic
prototype `544dd2f`. Nothing in `dev/qr-seat/`, the existing account adapter,
root/DEV configuration, shipped rules or release switches is modified.

## Implemented boundary

`adapter.mjs` uses Firebase SDK transactions and a supplied Auth/Firestore
instance, rejects non-demo projects and requires matching Auth/Firestore apps.
`emulator-session.mjs` uses the existing pinned SDK version 10.13.2,
separate named board/phone apps, in-memory Auth and hardcoded loopback emulators
in project `demo-blakeout-adapter-task3`. It has no live mode and requests no
real credentials. The browser tests create only synthetic emulator users.

`compose_rules.py` produces a review candidate by adding the fragment to the
existing account rules and excluding board-role UIDs from every existing
`devVerified()` grant. Both pairing role lists are empty on disk. Tests replace
them only in ephemeral emulator rules. Even accidentally putting a board UID
in the existing account pilot list must not grant it profile/history access.
No custom claims, Anonymous Auth, Admin SDK credential or token-minting service
is required for this local design.

Schema (all within the isolated default database):

| Path | Purpose / access |
| --- | --- |
| `qrGames/{game}` | Board UID and terminal active/ended state; owning board manages it |
| `qrGames/{game}/seats/{seat}` | Current invitation handle; own board writes |
| `qrInvites/{handle}` | Game, seat, expiry and open/claimed state; approved players get by handle, never list |
| `qrSecrets/{handle}` | Board-only matching code; player cannot read it |
| `qrGames/{game}/grants/{seat}` | Claimed UID, handle, code and expiry; owner board or that player gets |
| `qrGames/{game}/members/{uid}` | Per-game uniqueness record tying UID to seat/handle |
| `qrGames/{game}/checkins/{seat}` | Minimal scoped action proving server enforcement of current grant; no scores |

Phone confirmation supplies the displayed UID/game/seat/code. The adapter
rejects account changes and the rules independently derive UID from Auth.
Atomic invitation consumption + grant creation + member creation prevents
replay, competing claims and duplicate seats for one UID in one game.
Invitation rotation changes the seat handle. A claim expires within 120 seconds;
the grant lasts at most four hours. Client clocks may cause conservative
rejection; server `request.time` is authoritative. Leave/remove atomically
delete the grant and member. End is terminal and rejects all future claims and
check-ins, including against retained grant records. Expired/ended records may
still be read by authorized owners for UI state; they cannot authorize check-ins.

No Firebase player token appears in grant documents. The board holds its OWN
restricted Firebase Auth credential; this is not a credential-free display.
Only the owner board can control its game, and board role grants no account,
profile, tournament or history collection permissions.

## Event/team integration contract — proposed, not implemented

The accounts/resume task owns the authoritative event and roster design. Use a
stable Firebase UID for each identified human, separate from team/roster-entry
IDs and the display's board UID. Guests remain explicit null/unlinked identities.
An event contains teams; each team contains multiple roster members. A match/game
references the event and teams, and each active player-seat selection references
the roster member and UID. A board Auth user must never stand in for that roster.

This candidate binds grants to opaque game + seat + UID + invitation handle.
It tests the same UID joining a new game independently after the previous game
ends. A previous game's grant never authorizes the next game. It does NOT yet
validate event membership/team selection, bind a game to an event, identify
multiple simultaneous occupants of a team seat, aggregate history, write results,
or resume a scorer across browsers. The current four player seats are a local
game constraint, not a four-team event limit or proof of 20-team support.

Before integrating, agree the canonical eventId/gameId/teamId/rosterEntryId/UID
contract with the accounts candidate; add immutable game/event/roster bindings
and enforce them at claims and results. A game session's revision/ownership and
result idempotency remain the accounts/resume task's responsibility. Retain
accepted historical attribution after grant revocation; do not reinterpret
existing scores or migrate old UIDs. Store credentials nowhere in roster data.

## Reproduce

Set absolute paths `BLAKEOUT_QA_NODE`, `BLAKEOUT_QA_JAVA` (Java 21),
`BLAKEOUT_QA_JAR` (official Firestore emulator), `BLAKEOUT_QA_MODULES` (existing
`dev/tests/qa-tooling` dependencies), `BLAKEOUT_QA_PLAYWRIGHT`,
`BLAKEOUT_QA_CHROME`, and `QR_EVIDENCE` (outside the checkout). Then run:

```
python3 dev/qr-firebase/run_tests.py
```

The runner requires `unshare -Urn` and creates a loopback-only network namespace;
failure stops the run. It bundles the real SDK locally, starts isolated emulators,
creates fresh headless browser contexts and shuts everything down afterward.
It records source hashes, network interfaces, emulator logs, explicit denials,
race outcomes and exit codes. It then runs all five phases of the existing
155-case account rule matrix (775 decisions) against the merged rules. Nothing downloads or
connects to live Firebase. The emulator's privileged fixture endpoints are used
only for synthetic account verification, fixture data and time-expiry fixtures;
claims and adversarial operations use authenticated client SDKs and actual rules.

## Integration and live prerequisites

The current deliverable is an adapter/rules implementation and browser-driven SDK
integration suite, not a rendered real-Auth QR UI. The preserved synthetic QR UI
and independently decoded QR evidence remain separate. Wire its explicit consent
screens to this adapter only in a separate reviewed integration; keep the accounts
task's newer provider/configuration changes and never replace its platform module.
For real phone integration, expose a narrow authenticated dependency seam from
the existing named phone app, retain project/app guards, and initialize a separate
board app with deliberate persistence. No accounts-source change is included here.

Before any real test: inspect the current DEV project/rules/plan and account
candidate; review the final merged rules and populated board/player UID lists;
authorize the dedicated real board account, exact named participants and data
retention; publish only reviewed DEV assets/rules on an approved HTTPS origin.
Reconcile any later account-rule edits rather than deploying this older base.
No live configuration, credentials, emails, deployment or billing is authorized
by this branch. Real mobile/Auth provider behavior remains untested.

Known pilot limits: client-written Firestore cannot robustly rate-limit failed
six-digit code attempts, since denied writes cannot increment an attempt counter.
Keep this restricted to explicit pilot UIDs; this is not public abuse protection.
No automatic expired-document cleanup, event roster enforcement, result writer,
full account-session revocation service or production threat-model claim exists.
Role removal rejects future server operations but cannot erase already-read data.
The check-in is a testable narrow action, not permission to submit history.
