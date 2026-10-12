# DEV real-account rollout review — October 12, 2026

This is a review bundle, not approval or an enabled rollout. Current `main`
`78d3043` still exposes sample account/bracket pages. No live accounts, mail,
Firestore writes, provider grants or security configuration were changed during
this validation.

## Actual isolation boundary

`dev/js/firebase-config.js` and `js/firebase-config.js` identify the same Firebase
project (`blakeout`) and web app. Both use the default Firestore database.
`blakeout-dev-accounts` is a **named client app**, not a separate Firebase project,
Auth tenant or database. It separates its local authentication persistence from
the scorer's default anonymous app; `blakeout-dev-guests` is another client app.

Real DEV accounts would inhabit the shared project Auth user store and consume
shared quotas. Branded verification/reset uses the existing DEV Cloudflare
Worker and Resend, with the fixed `/dev/accounts/` continuation. The Firebase
Auth action handler/domain, provider settings and API-key restrictions are
project-level infrastructure. The repository documents prior live setup; this
review has not revalidated current console configuration.

Firestore collection names separate DEV records, but this is not complete
security isolation. Existing production roster and usage rules accept any
`request.auth != null` subject to their other conditions. A DEV account also
satisfies that condition (for a roster, the caller still needs its valid opaque
roster ID). The UI flags are release controls, not authorization boundaries.

## Concrete proposed shared-project rollout (NOT executed)

Only after the validation below, seek approval for this exact scope:

1. In `dev/js/feature-availability.js`, set `accounts: true`; retain
   `brackets: false`, both sample preview routes, and production flags unchanged.
   Existing feature-page and navigation code will then open real Accounts.
   This same flag enables the optional verified-player recording flow in DEV
   scoring. Update sample-only wording where applicable, regression expectations,
   and the DEV service-worker version. Publish these DEV files through Pages.
2. Use the **existing** password Auth provider, Firebase project/default database,
   web config and branded Worker URL. No rules deployment, new API-key access,
   OAuth/IAM grants, secrets, billing or Firebase settings changes are proposed.
   Read-only verification of current provider/domain/rule configuration is still
   required before assuming the documented September setup remains current.
3. A public `accounts: true` rollout is available to all visitors, not a private
   tester allowlist. It permits real signup/sign-in, verification/reset requests,
   own-profile saves, verified-user profile directory reads, and scorekeeper
   creation of immutable casual results plus participant access receipts under
   the current rules. Profiles expose names and stable UIDs to verified users.
   Results are private to their scorekeeper and authorized recipients.
4. Before any agent-driven live test, explicitly approve the exact test email
   address(es), signup versus existing-account sign-in, one verification request,
   one reset request, and the disposable profile/result/receipt records to create.
   The user enters passwords. No arbitrary real recipients or customer data.
   Verification/reset affects a shared-project Auth identity; never reset an
   existing production-used account as an incidental test.
5. Test records cannot be deleted through current client rules. Any later
   privileged cleanup needs its own enumerated records and authorization. Do not
   loosen rules to enable cleanup. Turning the UI flag off plus another cache
   version is a frontend rollback only: it does not remove records, revoke
   sessions or disable direct SDK/API access.

If strict production isolation or a private tester allowlist is required, do
not approve the above as though it provided that boundary. A separate Firebase
project/tenant or actual backend access policy needs a separate concrete design
and security/configuration approval; none is created or proposed implicitly.

## Local emulator status and exact Firestore blocker

Available: Java 21, Node 24, Chromium/Playwright, and official npm
`firebase-tools@14.15.2`. Its bundled Node Auth emulator starts successfully at
`127.0.0.1:9099` using **demo-blakeout-readiness**, UI disabled. The new
`dev/tests/auth_emulator_test.py` uses only that fixed loopback endpoint and a
`demo-` project. It validates signup/unverified state, verification action,
password sign-in, incorrect-password rejection, password reset, old-password
rejection, stable UID and reset-code reuse rejection. It deletes only its own
synthetic `@example.invalid` emulator account. No real email is sent.

`dev/tests/auth_sdk_emulator_test.py` additionally passed with the **actual
Firebase Auth SDK 10.13.2 and unchanged DEV platform.js** in Chromium: signup,
verification refresh, persisted auth after reload, independent-context sign-in,
device-local signout, reset request and new-password sign-in. Firestore alone is
stubbed. All external requests are blocked; the test browser explicitly grants
local-network access only to its loopback test origin. This does not change
Firebase/network policy or access the blocked Google download.

To reproduce the SDK test, install `firebase@10.13.2` and `esbuild@0.25.0` in a
temporary directory, bundle a browser ESM entry containing
`export * from 'firebase/app'; export * from 'firebase/auth';`, then run
`BLAKEOUT_FIREBASE_SDK_BUNDLE=/absolute/path/to/sdk.js python dev/tests/auth_sdk_emulator_test.py`.
The test asserts the actual SDK version. Both Auth suites need only the local
Auth emulator; a temporary Firebase config can use
`{"emulators":{"auth":{"host":"127.0.0.1","port":9099},"ui":{"enabled":false}}}`
and `firebase emulators:start --only auth --project demo-blakeout-readiness --config /absolute/path/to/firebase.json`.
No live Firebase CLI login is needed.

No Firestore emulator JAR was found in the searched workspace, temporary cache,
installed runtime or home caches. Firebase CLI's official artifact metadata is:

- Version/file: `cloud-firestore-emulator-v1.19.8.jar`
- URL: `https://storage.googleapis.com/firebase-preview-drop/emulator/cloud-firestore-emulator-v1.19.8.jar`
- Size: `63634791` bytes
- SHA-256: `9d43599ed6151199e8d604dc87fac51218e49e5f3a48519b1ae560bbe5e3382d`
- Expected cache: `/tmp/darts-emulators/cloud-firestore-emulator-v1.19.8.jar`
- Command attempted: `FIREBASE_EMULATORS_PATH=/tmp/darts-emulators XDG_CONFIG_HOME=/tmp/darts-config /tmp/darts-qa/node_modules/.bin/firebase setup:emulators:firestore`
- Result: `Error: download failed, status 403: Domain forbidden`.

The CLI's optional MOTD endpoint is also blocked; it did not prevent Auth startup.
Official npm dependency installation works. No alternate mirror, proxy bypass,
credential or permission escalation was used to obtain the denied JAR.

Reuse `dev/tests/platform_test.py:emulator_checks` once the approved artifact is
available: it compiles the existing `firestore.rules` into a disposable
`demo-blakeout-platform-<pid>` project and tests profile ownership, private roster
access, atomic revision pairing, immutable results, casual receipts, participant
privacy, verified/anonymous joins and denied unknown collections. The same file
retains `--save-rules-fixtures` and `--print-simulator-fixture` generators. These
are reusable test sources; no successful Firestore emulator run is claimed here.

## Remaining validation and safe next action

- Current browser/mock coverage: signup/sign-in/verification/reset transport,
  account UI replacement and stale-response suppression, 19 adapter session-race
  assertions, immutable score/receipt retry, local game reload, offline/reconnect,
  and fresh-browser-context retrieval from a shared mocked server snapshot.
  The session test fails against the pre-fix adapter as expected.
- These checks do not prove Firestore rule acceptance/query permissions, actual
  cross-device cloud persistence, real inbox delivery or the deployed Firebase
  action handler. Auth emulator evidence is separate from mail/Firestore proof.
- Tournament storage methods and optional email-link completion do not yet have
  the same explicit adapter session checks as the hardened profile/casual flow.
  They retain existing ownership/revision checks and UI protections. Keep real
  Brackets disabled pending a targeted adapter race audit and emulator tests.
- Reuse the existing branded-worker transport suite; do not reinterpret its
  mocked provider results as successful delivery.
- **Safe next action:** provide the official Firestore JAR through an approved
  environment provisioning path (or run the unchanged tests in an environment
  where its official URL is allowed), verify its checksum, start loopback-only
  emulators with a `demo-` project, and run
  `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 python dev/tests/platform_test.py`.
  No live-project credentials or rule deployment is needed. Resolve any actual
  rules failures before requesting the specific live rollout/test approvals above.
