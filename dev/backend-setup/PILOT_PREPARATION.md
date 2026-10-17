# Offline named-pilot preparation

No deployment, real account, email, credential action or UI activation is included.
Every positive Firestore client grant now requires a UID in `devPilotUids()`.
The on-disk list is **empty**. No real participant has been invented or enrolled.
Verified password/Google claims, default-database, schema, ownership, revision,
atomicity and privacy checks still apply after membership passes.

## Exact target and offline guard

- Project: `blakeout-darts-dev`; database: `(default)`.
- Web app: `1:901185136996:web:89d4f413520e66ff773271`.
- Candidate SHA256: `a5a1b1d6638fc271b4f941db7382e2a95f5d01af2bd57b1b9bd4efa7cfd96745`.
- Separate config: `firebase.isolated-dev.json`; pinned identity/hash:
  `isolated-pilot-manifest.json`. Root `firebase.json` still selects root rules.

From repository root, this command validates files locally and performs no network,
login or subprocess operation:

```sh
python3 dev/backend-setup/prepare_isolated_pilot.py \
  --project blakeout-darts-dev \
  --expected-sha256 a5a1b1d6638fc271b4f941db7382e2a95f5d01af2bd57b1b9bd4efa7cfd96745
```

The guard refuses production, aliases, wrong hashes, altered manifest/config,
symlinked files and an empty-list activation command. With an explicitly reviewed
nonempty list (maximum 20 UIDs), `--prepare-command` only prints an exact DEV-only,
Firestore-rules-only command; it never executes it. Changed candidate bytes require
a new reviewed hash/manifest and tests. A manually invoked Firebase CLI bypasses
this offline helper: it is an operator safeguard, not IAM isolation or live approval.
Do not use the root deployment config or a blanket deployment.

## Evidence separation and reproduction

Baseline HEAD `19c552b110c2394d083172c78e17dbbfa0b5a211` and existing backups/logs
remain the pre-pilot evidence. This change adds pilot membership and has its own
`task-3/evidence/pilot-final` output; baseline browser results are not newly rerun
pilot results. No UI/runtime application code changed in this step.

The isolated runner (`LOCAL_EMULATOR_QA.md`) now executes 12 offline guard checks,
all 155 original enforcement cases in four phases (620 decisions), the 1000-turn
ledger, actual Auth/Firestore SDK adapter integration and all 19 Node suites.
Phases are shipped-empty denial, original decisions for listed synthetic actors,
verified-unlisted denial, then denial after removal. All original owner/nonowner,
participant/outsider, private-roster, receipt and invalid-provider cases remain.
The SDK test also proves empty-list denial and server read/write revocation in the
same authenticated session, then restores only synthetic emulator UIDs.
Synthetic substitutions exist only in ephemeral demo-project emulator memory;
no test UID is written into the candidate. No live Firebase request is permitted.

## Essential user prerequisites before a live pilot

1. Provide an existing owner-authenticated read-only DEV console view. No authorized
   CLI account or accessible browser session was available at inspection. Verify
   project/app, default database location, live rules, providers, authorized domains,
   email action URLs and key restrictions; reported NAM5/deny-all settings are not
   independently verified. No new permissions or sign-in is implicit here.
2. Name consenting test participants and approve their DEV account creation and
   verification/reset emails separately. Passwords are entered privately by users.
   Obtain exact Firebase UIDs from those approved accounts; email strings/display
   names are not membership identities. Auth creation can happen while Firestore
   remains denied. Never migrate production/legacy UIDs or queues.
3. Approve precise pilot feature scope, shared display names/UIDs and shared match
   records, a small record inventory, retention and cleanup ownership. The current
   data model records scorekeeper assertions; participant consent/score truth and
   full 128-player profile validation are not certified. Membership restricts the
   caller, not every UID a scorekeeper may declare in a result.
4. Prepare and retest the exact populated rules bytes and updated hash/config before
   requesting narrowly scoped live rule-deployment approval. UI/provider activation,
   settings changes and real-device/second-device tests require their own concrete
   approved scope. Existing public gates remain off; never enable Anonymous Auth.

## Revocation and cleanup

Removing a UID (or restoring the empty list) requires a separately approved rules
publication. It denies subsequent server-authorized operations after propagation;
this does not revoke Firebase Auth sessions, prevent Auth signup, erase already
cached/downloaded records, or undo accepted writes. Firebase Admin/IAM principals
bypass client rules and are outside this restriction. Restoring an old permissive
rules version would reopen access: rollback must preserve the pilot restriction.

No automatic cleanup is included. Profiles/results/receipts intentionally deny
client deletion. Before pilot authorization, inventory exact synthetic/live test
records and their project/path/owner, agree retention, and approve narrowly scoped
owner-console/admin deletion and Auth-account removal separately. Do not grant the
client broad delete rights, delete unrelated records, or reuse production data.
