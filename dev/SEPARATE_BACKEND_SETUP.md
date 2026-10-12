# Separate DEV backend — proposed setup, October 12, 2026

**Status: nothing provisioned; production unchanged.** This supersedes the shared-
project rollout recommendation, not the evidence in REAL_ACCOUNT_ROLLOUT.md.
Firebase recommends separate projects for development environments; apps within
one project share Auth and other backend resources. [Firebase guidance](https://firebase.google.com/docs/projects/dev-workflows/general-best-practices)

## Access and handoff

The installed Firebase CLI is 14.15.2. Read-only `login:list --json` reported no
account result; `projects:list --json` failed with **"Failed to authenticate,
have you run firebase login?"**. No Firebase/GCP connector or gcloud executable
is available. Project-creation permission, organization policies and project-ID
availability therefore remain unverified. No login, OAuth grant or credential
was initiated. The repository identifies `DartsBlakeOut@gmail.com` as the existing
owner; the human must confirm/use the intended account through Google's UI.

The smallest handoff is for that owner to sign in to Firebase Console and approve
stage A below. Alternatively, explicitly authorize an interactive official CLI
login in an appropriate environment and review Google's presented scopes; never
paste a password, access token, refresh token or service-account key into chat.
No additional human or machine IAM grant is required if the existing owner can
perform setup. Do not request Owner/Editor grants as a workaround if it cannot.

## Stage A: exact initial resource/configuration approval

| Item | Proposed value / boundary |
| --- | --- |
| New project | Project ID `blakeout-darts-dev`, display name **BlakeOut Darts DEV**. Availability unverified; if unavailable, propose an exact replacement before creating it. |
| Plan | **Spark**, no billing account/payment method, no automatic upgrade. Google Analytics disabled. |
| Web app | One new web app named `blakeout-darts-dev-web`. Use its generated web config and browser API key; no service-account private key. |
| Auth | Enable **Email/Password** and **Anonymous** only. Anonymous is required by the existing ordinary DEV scorer; named guest sessions also use it. Keep email-link sign-in, phone, Google/social and SAML/OIDC disabled initially. |
| Auth domains | Retain this new project's generated Firebase domains; add exactly `blakeoutdarts.com` and `www.blakeoutdarts.com`. Do not add localhost or wildcards. |
| Browser key | Restrict the **new key only** to `https://blakeoutdarts.com/*`, `https://www.blakeoutdarts.com/*`, and `https://blakeout-darts-dev.firebaseapp.com/*` (or the actual approved project ID's host). Proposed API allowlist: Identity Toolkit API, Token Service API, Cloud Firestore API. Browser referrers can be reduced to the origin, so do not rely on `/dev/` path restrictions as isolation. Validate the new key without widening production's key. |
| Firestore | One Native/Standard `(default)` database in **`us-central1` (Iowa)**. Region is a proposal requiring approval, not an inferred user preference; changing database location later requires a new database/migration. [Location constraints](https://firebase.google.com/docs/firestore/locations). |
| Initial rules | Deny every client read/write using [the exact prepared rules](backend-setup/firestore.initial-deny.rules). No test/open-access mode. This file is not referenced by the existing firebase.json. |
| Permissions | Owner performs project creation, Firebase enablement, web-app registration, new-project Auth configuration, new-key restriction, database creation and initial deny-rule publication. Scope every action to the new project. No new delegated IAM role, OAuth app, service account or secret is proposed. |
| Not included | No customer/user/data migration, production setting change, Storage, Functions, Hosting, Cloud Run, DNS, Worker, D1, Resend account/key, real signup, email send, website config switch or public feature enablement. |

Suggested approval wording for stage A (not a permission request in this file):

> Under my confirmed owner account, create `blakeout-darts-dev` on Spark without
> billing, one web app, Email/Password and Anonymous Auth with the listed domains
> and new-key restrictions, and a Standard default Firestore database in
> us-central1 with the prepared deny-all rules. Do not connect or enable the site,
> send mail, migrate data, grant new IAM access or change production.

If Google requires a different account, organization permission, paid plan,
additional API/key access or different region, stop and present that exact change.
No approval of stage A authorizes those substitutions.

## Stage B: reviewed DEV integration after rules validation

This needs a separate concrete patch/review; it is not part of stage A:

1. Run the retained Firestore rule/compiler/access tests in an approved emulator
   environment. The official JAR remains blocked here (403); exact version,
   source, checksum and cache path are in REAL_ACCOUNT_ROLLOUT.md. Do not use an
   alternate route to evade that denial. Resolve rule failures before any real
   collection access is enabled.
2. Prepare a config explicitly targeting **only the new project** and publish
   the reviewed rules there. The current canonical rule content can be reused
   for evaluation: its roster/usage and `blakeoutDev*` paths would exist in the
   new database, not grant access to production. Keep production firebase.json,
   rules deployment target and keys unchanged. No user/data import.
3. Switch `dev/js/firebase-config.js` to the new web config. This must cover the
   default DEV scorer as well as named account/guest apps; changing only the
   named app would leave scorer roster/usage writes pointed at production.
   Add tests forbidding any DEV module from falling back to the old project.
4. Keep existing local games/recovery records intact. Identify old pending
   records' original backend and prevent replay into the new project. Isolate
   new backend-bound cached identity/record state before enabling writes; do not
   silently clear or reinterpret existing data.
5. Use **Firebase's built-in verification/reset email** initially:
   `dev/js/account-email-config.js` would explicitly set
   `ACCOUNT_EMAIL_SERVICE_URL = ''`. The existing branded Worker verifies the
   old shared project and must not be reused or reconfigured for the new one.
   Built-in mail is unbranded and needs no new sending secret, IAM service
   account, Cloudflare or Resend resource. Keep optional email-link UI disabled
   to match the proposed provider configuration. Review this user-visible change.
6. Keep real account/bracket gates off until the new project's permissions,
   restricted key and action handler are checked. Approve exact synthetic test
   email addresses, one verification and one reset action per designated account,
   and enumerated profile/result records before an agent performs live testing.
   User supplies passwords through the intended UI. Record cleanup requires its
   own explicit record list and approval; immutable client records are not
   deletable through current rules.
7. Public enablement is another action-time decision. A separate project protects
   production but does **not** make public `/dev/` an invite-only pilot. If an
   allowlist is wanted, prepare real backend authorization for review first;
   a hidden URL or frontend flag is not an access policy. Publish only DEV assets
   and verify the deployment, account isolation, actual second-device records,
   reconnect/retry and continued production gates.

## Cost and optional branded mail

Expected incremental backend cost for a small test is **$0/month on Spark**,
provided its quotas suffice. No paid service or billing upgrade is proposed.
Standard Firestore's no-cost quota includes 1 GiB stored, 50,000 reads/day,
20,000 writes/day and 10 GiB/month egress. [Firebase pricing](https://firebase.google.com/pricing)
Built-in Spark mail limits currently include 1,000 verification emails/day and
150 password resets/day; email-link sign-in is only 5/day, another reason to leave
that optional method off initially. [Auth limits](https://firebase.google.com/docs/auth/limits)
These are published limits, not measured usage guarantees. Recheck at creation.

Branded mail is optional later and **not needed for initial setup**. It would
need a separate DEV Worker/D1 binding and new-project service account with only
`firebaseauth.users.get` and `firebaseauth.users.sendEmail`, secure secret storage,
and an explicitly scoped Resend sending key/domain decision. That would be a
separate permissions/secrets review, never a reuse of production credentials.
Cloudflare offers free Worker/D1 quotas and Resend's free tier lists 3,000 emails
per month/100 per day; existing account usage can consume those shared quotas.
[Cloudflare pricing](https://developers.cloudflare.com/workers/platform/pricing/),
[Resend pricing](https://resend.com/pricing).

## Immediate next action

Get the owner's authenticated setup path and exact stage-A approval, including
project ID and immutable region. Provision nothing while access/approval is
missing. In parallel, have an approved environment supply the official Firestore
emulator artifact and run existing tests. Stage A's deny-all project may be
created without opening data access; stage B must remain blocked on validation
and its separate concrete configuration/rules approval.
