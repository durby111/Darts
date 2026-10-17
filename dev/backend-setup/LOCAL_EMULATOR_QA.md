# Isolated local adapter QA

This harness runs the actual DEV adapter and bracket engine with Firebase SDK
10.13.2 against local Auth and Firestore emulators. It never deploys, logs into
Firebase, changes a live backend, or enables account/provider gates.

## Prerequisites

Linux with working unprivileged user/network namespaces (`unshare -Urn`), `ip`,
Node, Python with the repository's Playwright requirements, system Chrome, Java
21, and the official Firestore emulator JAR. Provision dependencies before testing;
the runner makes no downloads. It fails if network isolation cannot be established.

Install the pinned `dev/tests/qa-tooling/package.json` and lockfile in a separate QA
tooling directory with `npm ci --ignore-scripts --no-audit --no-fund`. Supply an
existing Playwright Node module separately. Do not put node_modules in app assets.

Set these absolute paths for the local machine:

```sh
export BLAKEOUT_QA_NODE=/path/to/node
export BLAKEOUT_QA_JAVA=/path/to/java21/bin/java
export BLAKEOUT_QA_JAR=/path/to/cloud-firestore-emulator-v1.19.8.jar
export BLAKEOUT_QA_MODULES=/path/to/qa/node_modules
export BLAKEOUT_QA_PLAYWRIGHT=/path/to/node_modules/playwright
export BLAKEOUT_QA_CHROME=/path/to/google-chrome
export BLAKEOUT_QA_PYTHON=/path/to/venv/bin/python
export BLAKEOUT_QA_OUTPUT=/absolute/path/to/evidence
python3 dev/tests/isolated_adapter_run.py --full
```

Without `--full`, run rules, large ledger, real adapter integration and all Node
source/DOM tests. `--full` additionally runs the platform browser contracts,
isolated backend browser test and aggregate DEV regression battery. The old Auth
SDK-only test stubs Firestore and is not evidence for this candidate.

Every test logs its exit status. `results.json` records failures and explicit
skips; a skip is not a pass. `network.json` captures the isolated interface list;
`sources.json` fingerprints code before/after execution. No emulator exports or
real user browser profiles are imported. Synthetic emulator state is ephemeral.

## Test boundaries

The browser verifies the served adapter matches the worktree bytes. Backend
project/app constants and corresponding candidate-rule markers are translated to
`demo-blakeout-adapter-task3` / `demo-app`; all validation logic is retained. The shipped pilot UID list is empty. Tests
first prove default denial, then explicitly insert only synthetic fixture UIDs
into ephemeral emulator rules, test revocation, and retain owner/privacy checks.
The real-SDK suite uses emulator-generated UIDs; it never edits the shipped list.
Local SDK wrappers attach Auth/Firestore emulators before use. No Firestore data
or transaction implementation is stubbed. Deliberate fault injections include
one ABORTED commit, denied commits/receipt writes, a held commit and a paused read.

All processes run in a fresh network namespace with only loopback. Browser routes
add a second allowlist, disable service workers and block WebSockets. Firebase
WebChannel offline connectivity probes to `www.google.com/images/cleardot.gif`
are recorded and aborted. The namespace prevents other browser/emulator traffic
from reaching the host network. Auth socket overloads have independent guard tests.

## Revision and offline behavior

A server `permission-denied` cannot safely become `platform/revision-conflict`.
The adapter retains the denial and original cause. Only a fresh authorized owner
read in the same session can add `revisionChanged` guidance. Revoked rules,
failed diagnostics, unchanged revision and session loss retain the original error.
The diagnostic never retries a write or relaxes authorization.

Use actual browser offline mode to test disconnection. `disableNetwork()` alone
was insufficient to stop transaction RPCs in the tested SDK/emulator combination.
A direct SDK write is an explicit positive queue control; it queues and replays.
Adapter transactions fail offline and do not replay after reconnect. A new explicit
online update must be requested. Signout guards cannot undo a server-accepted commit
or cancel every arbitrary direct SDK queue.

## Remaining deployment gates

Passing local tests is not approval to publish or run real accounts. A separately
authorized DEV pilot must verify real Google/email flows, domains, deployed rules,
project/IAM configuration, provider availability, quotas and real-device behavior.
No production deployment, live rule mutation, account creation or data migration
is part of this workflow. Scorekeeper declarations remain unverified claims about
play; rules do not certify darts or participant consent. Existing privacy and
schema limits remain documented in ISOLATED_RULES_REVIEW.md.

The offline deployment guard tests run with the rules suite. See `PILOT_PREPARATION.md`
for exact targeting/hash checks and essential user prerequisites.
