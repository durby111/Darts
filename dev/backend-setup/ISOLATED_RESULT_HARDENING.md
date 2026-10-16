# Local result hardening — October 16, 2026

This work builds on `d0fcfd48c5277094f2c3dfbd41a8cbf71d91f05f`. It is local only;
no code/rules deployment, gates, provider settings, accounts, records or mail were
changed in a live environment. The target of finishing today is not a release
commitment. The Firestore emulator remains unavailable; the denied download was
not retried.

## Concrete changes

The DEV adapter encodes `legScores` and optional `records` as canonical JSON
strings at the storage boundary, with exact keys for summaries, legs and turns.
The UI/export API decodes them back to arrays/objects. Real turn IDs, guest slots,
nullable guest player IDs, actual darts, points, marks, busts, winner sides and
Minnesota cutthroat flags remain represented. Local scoring and saved-game
storage are not converted or truncated. Oversized or malformed cloud payloads
fail explicitly instead of losing data.

All nested ledger fields now have a defined type and range. No arbitrary note,
email, credential or unknown object field can be written through this adapter.
Turn player IDs must be null (guest) or present in the result participant list.
Candidate rules mirror the canonical structure with full-string grammars and
payload limits. Stored legacy arrays/maps and foreign markers are rejected on
read/retry; there is no automatic migration. The new wire format is intended for
the empty isolated project, not existing production records.

Results and receipts now persist the exact isolated project/app backend marker.
The rules require it, including checking the referenced result on receipt create.
The marker is public and copyable; it is not authentication or proof of origin.
Ownership and verified identity checks remain necessary. Old active games and
recovery payloads stay local, and the earlier session guard still prevents replay.

The DEV worker cache is bumped and includes the new pure codec module. Production
files, root Firebase rules/config, all real-account/provider gates and the old
email Worker remain unchanged.

## Evidence and limits

`result_payload_test.mjs` checks the codec, round trips, malformed nested fields,
foreign participant IDs, actual-dart bounds, canonical reads, guest/minnesota
cases, a 1,000-turn ledger and extracted rule grammars. Its grammar tests use JS
regex, **not Firestore/RE2**. Platform browser tests add persisted marker checks,
malformed-write atomicity and rejection/non-migration of a stored foreign record.
Browser Firebase/OAuth boundaries remain mocked.

The separate candidate rules suite now contains **155** synthetic allow/deny
cases. The former permissive nested-field case is now expected-deny; new cases
cover canonical ledgers, private/unknown nested fields, unrelated identities,
invalid numeric/boolean values, escaped IDs, missing/foreign markers and receipt
marker mismatch. **All emulator enforcement cases and compilation are skipped**
until a permitted emulator is provisioned. Completed checks: 30 codec/negative/source-grammar checks, full mocked platform
account suite (including 44 feature assertions), 62 scorer/recording browser
groups, four isolation groups, 16 navigation groups, seven local-tournament flows
(including real offline service-worker use), 13 mocked provider groups and five
production-artifact groups. One fresh-device mock run timed out under concurrent
load; the full rerun passed. Both logs are retained. The full jsdom suite was not
rerun because its local dependency is no longer installed; no download was made.

No live email, Google sign-in, Firestore rules enforcement, cross-device account,
physical touch or rules-expression-budget success is claimed. No change to Mike's
Firebase Console is needed to complete this local work.

## Remaining scope decision and recommendation

Keep the proposed initial pilot to email/Google accounts and casual saved results;
leave online tournaments gated. Do not call client/organizer-entered scores
independently verified or certified.

For participant validation, recommend **at most four linked registered participants
per cloud casual result for the initial pilot**, with four explicit server-side
profile-existence checks. Guests and larger device-local games can remain playable.
This cap is **a recommendation only, not implemented**: the current candidate
preserves all 128 linked-participant functionality. Approval of the narrower cloud
pilot is needed before imposing a new limit. If all 128 participants must be
supported with authoritative validation at result creation, use a reviewed trusted
writer that validates all participants and the ledger before publishing immutable
results/receipts; that is a separate backend implementation decision.

Current protection for the large format: the client checks every selected profile;
the rules enforce ID/counter shape, and each receipt verifies that recipient's
profile exists. An arbitrary client can still store an owner-private result naming
a nonexistent UID, but cannot create a receipt for it. Participant consent and
actual-score truth are not proven even when profiles exist. A malicious scorekeeper
can select other valid participants and make assertions about their play; a trusted
writer would also need explicit consent/business rules to prevent that.

Next infrastructure requirement is unchanged: an approved official Firestore
emulator artifact plus supported launcher, or an approved running loopback emulator,
in this same executor. Then compile and run all synthetic cases plus actual-adapter
integration, query and largest-ledger budget checks. Only after those checks and
scope decisions should an exact DEV-only live-trial approval be requested.
