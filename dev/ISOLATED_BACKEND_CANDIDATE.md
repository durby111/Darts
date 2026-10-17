# Isolated DEV account candidate — local only

Prepared October 16, 2026 from main `bed17725c7934216d01d2333cac62f4201d14baa`.
This candidate has not been pushed, deployed, or enabled. Current published
readiness documents describe the published baseline, not this local candidate.

## Reported setup and candidate behavior

Mike reports an empty Standard default Firestore database in NAM5 for
`blakeout-darts-dev`, with deny-all rules, Email/Password and Google enabled,
and Anonymous Auth disabled. These console settings have not been independently
verified or changed by this work. No project, database, account, mail, or record
was created. No rules, authorized domains, API-key restrictions, or Worker
infrastructure were changed.

The supplied public web configuration is in `js/firebase-config.js`, with no
Analytics setup. The only DEV Firebase initializer is the account adapter. It
checks project, app ID and auth domain, including any reused app, then uses the
new named app `blakeout-darts-dev-accounts`. It does not open the old default,
account, or guest apps or their persisted queues. Ordinary scoring initializes
no Firebase app. Cloud roster sharing and anonymous usage sync are disabled;
local scoring and device-local brackets remain available.

Verification and password reset use the Firebase SDK's built-in mail transport.
The former Worker helper remains in the repository but is not imported by the
account adapter; its service URL is disabled. Email-link sign-in and anonymous
online guest signup fail explicitly. Organizer-added guest names and local
bracket guests remain supported. Public account/bracket feature gates and both
Google/Apple provider switches remain off.

New cloud scorer sessions carry the isolated project/app marker. Launch, resume,
and save boundaries reject missing or old markers, including direct adapter
saves, before submitting to Firebase. Existing games, pending payloads, recovery
snapshots, old auth state and old continuation keys are retained. Old linked
UIDs are not remapped or migrated. Recovery/history labels distinguish older
backend records; those records can remain local but cannot be sent to this
project. Fresh recordings require freshly selected profiles. These client markers prevent
accidental replay; they do not replace server-side authorization rules. The DEV service
worker adds the new context module and uses a candidate cache version.

## Verification and limitations

Tests use localhost Chromium and mocked Firebase/OAuth boundaries, with external
provider traffic blocked. They exercise isolation, retained recovery, old-payload
rejection, current account/profile/result behavior, built-in mail API calls,
provider return guards, local scoring and local brackets. Test-only route
fixtures open future-feature gates; shipped gates remain closed.

Completed local checks: 57/57 aggregate browser cases; 16 source/DOM suites; 62 scorer/recording browser groups;
16 navigation/boundary groups; seven local tournament game flows (including
an offline 301 flow); four dedicated backend-isolation groups; 13 mocked OAuth
contract groups; platform/account browser contracts; and all 24 bracket UI cases
(22 in the full run, with the two updated fixture assertions passing focused
reruns). These counts do not represent live Firebase/provider tests.

Later local QA supersedes the original skipped-emulator status: Java 21 and the
existing emulator compiled and enforced the candidate, with real Auth/Firestore
SDK integration under loopback-only network isolation. Baseline evidence and the
later empty-allowlist pilot changes are distinguished in
`backend-setup/PILOT_PREPARATION.md`. No live rules/provider/mail behavior has
been verified. Reported live deny-all rules remain unverified and unchanged.

All changes are under `dev/`. Production assets, production gameplay, root
service worker, root Firebase config, canonical rules, Firebase deployment
configuration, backend Worker code, and existing public gates remain unchanged
from the baseline. Local log and trace paths are recorded in the completion
report; they are executor artifacts, not hosted downloads.

## Exact scope to request before a later live trial

1. Review and prepare narrowly scoped **DEV-project-only** rules for the existing
   verified-account profile, tournament, result and receipt collections, including
   ownership, revision/idempotency and private-data boundaries. Keep legacy
   anonymous roster/usage access denied. Do not deploy the shared root rules
   blindly. Obtain a supported emulator and pass compilation plus allow/deny
   tests before requesting deployment of the exact reviewed rules revision to
   `blakeout-darts-dev` only.
2. Verify the new project's Auth authorized domains, email action return URLs,
   default Firebase auth handler, and web API-key API/referrer restrictions for
   `blakeoutdarts.com`. Request any exact needed changes separately; do not edit
   production keys or settings. Confirm app/config identity and database location
   without recreating resources.
3. Name designated test email addresses and obtain approval to create their DEV
   accounts and send verification/reset emails. Users enter passwords privately.
   Confirm delivery, verification refresh, reset, logout/reload, and second-device
   behavior. No real mail or account creation is authorized by this candidate.
4. Approve an exact reviewed DEV publication and limited account activation only
   after the preceding checks. Preserve production Coming Soon gates and gameplay.
   Leave public Google/Apple switches off unless a separate provider test/activation
   is approved. Do not enable Anonymous Auth.
5. Approve a small named test-record set and its cleanup boundaries. Test ownership,
   unauthorized reads/writes, retries, duplicate prevention, retrieval and second-
   device access. Do not migrate old profiles, UIDs, queues, or saved results.

This is a proposal for later approval, not authorization to execute these steps.
