COHERENT DISABLED OWNER-RETURN CANDIDATE — 2026-10-18
This directory supersedes the disconnected owner-return consumer draft.
No release config, routes, service-worker assets, live rules or identities changed.
The API requires the existing demo project and matching Auth/Firestore apps.

ONE COMPLETE PATH
1. Existing tournamentDevice.create produces immutable tdEvents topology/roster;
   existing pairingAdapter.createGame/pair/claim produces qrGames phone identity.
2. historyAdapter.createContext derives canonical t_<eventId> or g_<qrGameId>
   from authenticated source ownership, then atomically creates head + public
   link directory. Caller cannot create a second alias for the same source.
3. mountPhoneConsent fetches context scope and renders existing explicit consent
   UI. confirm rechecks displayed UID/scope, verifies actual roster or QR claim,
   then atomically creates immutable binding + timestamped grant and updates
   only that owner's public link entry. It never trusts a submitted owner UID.
4. submit reads canonical context/head/link directory and existing operation.
   It uses the real tournament projector/planner and validates revision. A first
   record atomically creates occurrence + immutable operation + advanced head.
   Occurrence captures first acceptance time, immutable member-binding snapshot,
   exact playing roster and participant IDs. Corrections retain that occurrence.
   Undo retains its immutable audit; rerecord after undo creates a new occurrence.
   Upstream correction can replace teams only after descendant results are undone.
5. Owner return lists own immutable grants (grants), then discovers eligible
   occurrences and their immutable operations in 50-row pages. No client must
   know another user's UID or guess source operation IDs. Fixed participants/
   timestamp indexes avoid a new index for every Firebase UID.
6. sync materializes each owner's own counter/history snapshot transactionally.
   It validates grant timing at FIRST acceptance, binding/roster, source operation,
   revocation and destination revision. Duplicate/older deliveries are no-ops.
   Each private destination is owner/context/occurrence, avoiding cross-event ID
   collisions. No result write requires the player's phone to remain online.

Known-player or guest scoring without consent is still committed; no private
attribution is fabricated. No linked player is silently removed from input.
casualInput converts the existing scoringResult perPlayer array into a UID-keyed
map, rejecting duplicate counters. Casual 501/Cricket identities without grants
remain in the canonical result but cannot create personal receipts. Immutable
first participants cannot be removed by a correction; undo/replacement is needed.
Tournament audit retains before/after, match, revision, authoritative time, actor
and honest unknown tablet-human. Public binding IDs are NOT private receipts,
credentials or proof of personal approval of a score. Tablet has no private
history/resume read or materialization API/rule grant.

CONSENT/RACES
Separate named-tournament and game-seat scopes; binding proves roster UID or
actual QR seat/handle and cannot be overwritten. Grant timestamps equal request
server time. Grant must predate first result strictly; equal timestamps deny.
Revocation before/equal first result denies new attribution. Later revocation
preserves corrections/undo to already accepted occurrences, but a new occurrence
must independently qualify. Renewal creates a new immutable grant; no backfill.
Account changes during reads reject. Source/link races retry the transaction.
Every new source operation is coupled to a head revision; write-only orphan
source/occurrence and head-only writes are denied by paired getAfter conditions.
Immutable operation is the durable delivery source: no post-commit fanout needed.
A crash before commit persists none; after commit owner discovery can recover it.
Sync reports processed count, NOT a global completion watermark: concurrent new
source operations are picked up on subsequent scans. It never claims every
concurrent write was included in one traversal.

STATIC RULE ACCESS ACCOUNTING (no cache credit, not emulator measurements)
                                    Max per write    Atomic request estimate
Context + head + links creation             6                  <=9
Phone first binding + grant + link          5                  <=14
Grant revocation                           1                   1
Tournament first result/head                9                  17
Tournament correction/undo                  6                  12
Casual first result/head                    5                  13
Casual correction/undo                      4                  10
Private owner materialization               8                  11
- Tournament head: operation getAfter1, context1, original event active/board2,
  occurrence getAfter1, links1, participants event1, roster event1, result event1.
  Occurrence create adds operation getAfter1 + head getAfter1 + prior head1.
  Operation create adds head getAfter1 + prior head1. Transaction read guards
  add context1 each for state, operation and links (3). Total17.
- Correction reuses immutable occurrence (1); no participant/roster/links rule
  reads; transaction reads occurrence with context guard1. Total12.
- Owner write: eligibility grant1+occurrence1+context1+revocation exists/get2,
  projection operation1+context1, current-history exists1 =8. Transaction reads
  occurrence with context guard1 and operation with context+occurrence2 =3.
- Binding create: context1 + source active1 + QR grant UID/handle/expiry3 =5.
  Grant create: context twice2 + source active1 + binding getAfter1 =4.
  Link update: binding getAfter twice2. Transaction read guards binding exists1,
  links context1 and QR grant exists1 =3. Total14.
- Discovery: grants owner/path-only guard0; occurrence list context1 plus resource
  participant filter; operation list context1 + fixed occurrence1. Query index
  behavior and rule query inference MUST be verified in emulator, not assumed.
These bounds do not vary with 128 other-player consent documents because none
are read. Payload/map size <=128; per-owner counters shape/range checked at the
private projection boundary. Source scores remain scorekeeper-declared, not
certified results. Canonical operation creation/immutability is independently
rule-validated; malformed counter projections cannot become private history.

FILES / REPRODUCE
adapter.mjs: real Firebase SDK transaction/query API, injected dependencies.
phone.mjs: explicit phone UI wired to this adapter, no public route.
candidate.fragment.rules + compose_rules.py: append only new hc* namespace to
 existing candidate; do not change original collection grants.
indexes.candidate.json: fixed candidate discovery index, NOT deployed.
node --test dev/history-attribution/coherent/test_flow.mjs
python3 dev/history-attribution/coherent/test_source_contract.py
python3 dev/history-attribution/coherent/compose_rules.py > /tmp/coherent.rules

OFFLINE EVIDENCE
10 real-adapter/real-engine/phone-DOM flows with in-memory SDK transport passed: complete
501 lifecycle; forged identity/stale/post-result/cross-owner attempts; guests;
actual upstream replacement; expiry/closed context; Cricket/wrong seat; >50
occurrences and duplicate delivery; in-flight account replacement; known-player
no-consent retention; actual phone acknowledgement to persisted grant. They do not execute Firestore rules or actual transactions.
Five source-contract checks pass (not a Firestore parser). Source tests prove
composition preserves all earlier rule text and release config stays disconnected.
Existing model/temporal contracts remain additional supporting tests.
Logs: /workspace/blakeout-recovery/attribution-evidence/coherent-flow.log.

ENFORCEMENT GATE — NOT RUN
Official emulator download remains proxy403. No rule compilation, actual SDK
query/index acceptance, server-time races, permission-denied matrix, or measured
rule budget is claimed. Retain every one of ../EMULATOR-ACCEPTANCE.txt's44 cases;
CASE-MAPPING.txt maps them to this actual implementation, including the changed
immutable operation-as-outbox representation. No source seeding may substitute
for producer tests. Initial tdEvents/qrGames must be created through their
existing authenticated adapters, not admin-created trusted-result shortcuts.
Only emulator synthetic auth setup may use the emulator admin interface.
No paid service or user laptop is needed; production activation remains separate.
