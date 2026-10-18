DISABLED LOCAL CHECKPOINT — no routes, SDK connections, rules or permission changes.

model.mjs: explicit consent binding and revisioned attribution projection.
integration.mjs: existing QR claim -> game/seat identity binding (NOT consent);
existing tournament engine + accepted audit -> validated result operation;
existing casual scoring result -> personal 501/Cricket operation with seat bindings;
phone consent view showing distinct game/seat versus named-tournament scope.

Phone confirmation is mandatory for attribution, not for entering a result.
Missing/expired/revoked consent or changed roster suppresses new attribution,
without stopping unlinked/guest scoring. Accepted match ownership is frozen:
later consent never backfills old matches and roster changes never reassign them.
Revocation stops new match attribution. Corrections/undo to previously accepted
matches still replace/tombstone those same owners' receipts, preserving truthful
history and the original consent snapshot. The phone explicitly explains this.
Each receipt has stable UID/event/match key and increasing event revision;
replays produce no second receipt; old receipt deliveries cannot overwrite newer.
Each owner's casual receipt includes only that owner's counters. Full public
result/audit data stays separate. No private resume data is accepted.

Model tests use injected authoritative time/identity/consent snapshots. They are
NOT security enforcement. No Firebase access model is implemented or activated.
Tablet-facing operation preparation has no history-read or resume API. The
owner receipt reducer is a separate conceptual consumer; ownerUid argument is
not a substitute for authenticated server-side ownership enforcement.

COMMAND (cached jsdom from this cloud workspace):
node --test dev/history-attribution/test_model.mjs
12/12 pass: distinct scopes; phone identity/revision/ack; expiry/revoke/absence;
replay; stale concurrent revision and retry; correction after revoke/roster change;
undo/dependencies; no retroactive attribution; invalid submitter/private payload;
phone DOM; actual bracket-engine event/audit bridge; 501/Cricket owner counters.
Raw log: /workspace/blakeout-recovery/attribution-evidence/model-dom.log.
Concurrent test is deterministic competing revision simulation, not Firestore concurrency.

SECURITY/INTEGRATION WORK REMAINING BEFORE ACTIVATION:
- Persist explicit phone consent using authenticated authoritative bindings and
  server timestamps; existing QR grants alone are insufficient authorization.
- Atomically couple accepted result revision, consent snapshot and outbox receipt
  production, with no gap between authorization and commit. Public event result
  data must not become authority merely because a browser supplied it.
- Implement a narrowly authorized receipt-delivery/read path. Do not let tablets
  invoke unrestricted private-history writes or reads. Keep resume isolated.
- Validate correction/undo receipts against immutable accepted result ownership
  and source revisions; keep original audit immutable. Ensure crash recovery can
  redeliver committed receipts even though client replay emits no new receipt.
- Bound/compact event projection and operation history before Firestore storage;
  this in-memory ledger is deliberately not a Firestore document schema.
- Integrate scorer/Accounts routes only after enforcement tests pass. No gate
  toggle is sufficient authorization and ENABLED=false alone is not a boundary.
- Real Firestore rules, transaction races, expiry time, outbox crash recovery and
  cross-user denials remain unverified: official emulator download is proxy403.

This checkpoint does not claim durable personal history or a production-safe
storage adapter is complete. No rules were edited and no credentials created.
