# Historical record: October 8–15 readiness milestones

This preserves dated evidence and release scope, including then-current blockers.
It is not current feature status or standing publication authorization. See
[Feature readiness](FEATURE_READINESS.md), [Backlog](BACKLOG.md), and the
[project guide](../README.md) for current guidance.

---

# Feature readiness — October 15, 2026

## Device-local tournaments (October 15)

A separate [device-local tournament flow](LOCAL_TOURNAMENTS.md) now supports
blind-draw partners, game selection by bracket/round/match, real scorer return,
reloadable local persistence, guarded corrections and double-elimination finals.
The existing sample pages and real cloud gates remain unchanged. This does not
establish real-account, Firebase, cross-device or physical-touch readiness.

## Account and saved-record milestone (October 12)

The DEV adapter now binds profile writes, casual-result transactions, receipt
delivery and private reads to the initiating authentication session. A sign-out
or replacement session (including the same UID signing in again) stops subsequent
work and prevents returning old private data. Superseded signup/sign-in responses
cannot republish old credentials or send verification to a replacement account.
Already committed results remain immutable; the original owner can retry the
same result ID to complete missing receipts. These client checks supplement the
existing server rules; they do not cancel requests already sent to Firebase.

Browser contracts cover the new session races (19 assertions), signup/sign-in,
verification/reset transport, scoring-to-record saves, reload, offline retry,
and record retrieval in a fresh browser context with no copied game/auth state.
That fresh-context test shares a **mock server document snapshot**, not a live
Firebase connection. Real Chromium runs the UI and adapter. The bracket suite's
Start & Lock setup now installs its throwing native-confirm stub without
accidentally invoking it through Playwright; all its original assertions remain.
The platform/scoring runners also accept installed Chromium alongside Chrome.
DEV cache is v62; sample previews and their theme behavior remain available.

Validation uses Node 24 with jsdom 30.1.2 for the 16 source/DOM suites, and
Playwright with system Chromium for the platform, scoring, 24-case bracket and
16-group navigation suites. The new session regression also fails against the
previous `0c431fe` adapter as expected. Browser fixtures intercept provider
traffic; physical touch hardware is not covered.

**Remaining release checks:** real accounts/cloud recording are still gated.
No Firebase rules, provider configuration, keys, collection access, production
assets or production Coming soon gates changed. The existing emulator checks
are retained, but this environment could not download Google's Firestore emulator
(HTTP 403); no emulator result is claimed for this milestone. Live site retrieval
is also proxy-blocked. Mock transport tests send no real verification/reset mail.

Before a real-account rollout, validate the unchanged rules with an accessible
local Firestore emulator, then obtain action-time approval for enabling DEV real
account/record access and an explicit test recipient for verification/reset mail.
Use that controlled test to verify email action completion, server-authorized
save/read ownership and a second real device. No migration, rule relaxation or
new provider grants are required or proposed by this code change.

## Additional local validation (October 12)

The official CLI's bundled Auth emulator is available even though its Firestore
JAR download is blocked. Local Auth REST tests and the actual Firebase Auth SDK
10.13.2 with the DEV platform adapter passed signup, verification, reset,
wrong-password rejection, auth persistence/reload and independent-browser sign-in.
No real email or live writes occurred; Firestore remains unverified by emulator.
See [REAL_ACCOUNT_ROLLOUT.md](REAL_ACCOUNT_ROLLOUT.md) for exact artifact/checksum,
reproduction commands, shared-production-project implications and the concrete
approval bundle. That document does not authorize or enable a rollout.

## Tournament/link session milestone (October 12)

All verified tournament mutations now guard the initiating account at transaction
entry, each asynchronous read, every retry/write and completion. Guest joins use
their own named guest session guard, independent of the signed-in account.
Owner-only roster reads become public/redacted after a session replacement even
when the UID is unchanged. A commit already accepted by the server is not undone.
Email-link completion checks the credential session before/after token refresh
and preserves newer URL/email continuation state. Concurrent link sends cannot
replace a newer remembered address.

47 new deterministic browser assertions cover these races, retries and committed
write boundaries; the actual Firebase Auth SDK/emulator also completes an email
link in a second browser context. Existing account, bracket and scoring tests are
retained. DEV cache is v63. Real feature gates, backend settings and production
remain unchanged. See [SEPARATE_BACKEND_SETUP.md](SEPARATE_BACKEND_SETUP.md) for
an exact unexecuted isolated-project setup proposal and access blocker.

## Provider sign-in preparation (October 12)

DEV Google/Apple UI and adapter paths are implemented with both provider switches
and redirects disabled. The adapter also refuses provider sign-in against the
old shared Firebase project. Cancellation, popup blocking, collision, repeated
clicks, stale account sessions and redirect return validation are covered by
local mocked browser tests. No linking by email or automatic credential linking
is implemented. DEV cache is v64; production and real feature gates are unchanged.
See [ACCOUNT_PROVIDERS.md](ACCOUNT_PROVIDERS.md) for exact switches, setup needs
and the explicit limit that actual Google/Apple OAuth remains untested.

## Current DEV entry status (October 10)

DEV menus and direct Brackets / Players & Records routes are open to interactive
sample tests. They are labeled sample data; changes are in memory only. This
supersedes the older UI gate description below, not backend-readiness limits.
Real sign-in, email, cloud writes, exports and scorer launch from sample events
remain off. Production Coming soon gates are unchanged.

## Release boundary

This is local DEV work based on production commit
`19d030f95b86fc3ae902c499f2278b421a75b20d` (tree
`b5208efac3c22515fc427ee47328eefa5752e692`). This release contains DEV assets only.
Production bytes and both real Coming soon gates are unchanged. The availability
flags are UI release controls, not a security boundary.

## Implemented and locally verified

- **Accounts:** action/session ownership stops late responses from changing a
  replacement user's screen. Latest-request ownership protects records and
  exports; profile saves and email outcomes stay with the initiating session.
  Signup and resend share verification busy state. Current-session errors remain
  visible, including errors after an expected sign-in transition. Providers are
  neither changed nor retried implicitly.
- **Brackets:** recovered Start & Lock feedback now explains unsaved drafts,
  invalid pairs, check-in/payment blockers, canceled confirmation, pending save,
  failure and success. A blocked or canceled attempt cannot shuffle or write.
  Late owner responses cannot restore private feedback after an account change.
  Current paid-player, roster ordering, labels and revision rules are retained.
- **Shared appearance:** preference-only modules restore the main app's 12 themes
  and Modern, Classic, DC and Dot Better styles on standalone pages. Canonical
  DC/Dot Better palette values are shared with the scorer without changing them.
  Feature components use semantic tokens for forms, buttons, loading/status,
  empty/error states, focus and app-owned dialogs. Won/Lost outlines retain
  green/red semantics. A shipped-order cascade regression protects the shell's
  Back to scoring button from the later availability stylesheet.
- **Shared confirmations:** all eight bracket confirmations use an app-owned,
  theme-aware dialog with Cancel focus, Close/Escape, focus containment, touch
  targets, scrolling and repeat/abort cleanup. Approval stays bound to the exact
  account object/session, event revision, selected match and draft/form values.
  Callers recheck after awaiting; stale success and error feedback is suppressed.
- **Sample preview:** `/dev/preview/accounts/` and `/dev/preview/brackets/` reuse
  the real templates/UI with a memory-only adapter. Exact import-map and resolver
  checks fail closed; no provider imports, credentials, email, result export or
  scorer launch. Preview state never persists; existing SW may cache static
  assets. All feedback/dialogs explicitly identify sample data. See
  [preview/README.md](preview/README.md) for supported scenarios and limits.
- **Correction foundation:** the unchanged, storage-free prototype is recovered;
  see [RESULT_CORRECTIONS.md](RESULT_CORRECTIONS.md). It is not imported by any
  app entrypoint, storage adapter or service worker and does not enable editing
  or invalidating real records.
- **Backdrop follow-up:** actual cloud-browser QA found Arctic's pale overlay
  behind the optional dark styles. The platform-only backdrop now follows the
  active DC/Dot Better background; Modern/Classic retain their theme overlays.
- **Cache:** prepared DEV v57 includes the shared appearance modules and palette
  sheet plus the shared dialog. Preview routes are not precached. Production
  cache and build-isolated saved-game behavior are unchanged.

## Reproducible evidence

Run from the repository root with Node's VM modules enabled. The shell cascade,
Start & Lock, shared dialog, bracket confirmation and mock preview tests require
an existing `jsdom` install. If it is outside normal Node module resolution, set
`BLAKEOUT_JSDOM_MODULE=/absolute/path/to/jsdom` before these commands.

```sh
node --experimental-vm-modules dev/tests/accounts_page_test.mjs
node --experimental-vm-modules dev/tests/platform_appearance_test.mjs
node --experimental-vm-modules dev/tests/platform_shell_cascade_test.mjs
node --experimental-vm-modules dev/tests/feature_availability_test.mjs
node --experimental-vm-modules dev/tests/feature_recording_gate_test.mjs
node --experimental-vm-modules dev/tests/build_context_test.mjs
node --experimental-vm-modules dev/tests/dot_better_static_test.mjs
node dev/tests/winner_celebration_static_test.mjs
node --experimental-vm-modules dev/tests/production_release_test.mjs
node --test dev/tests/result_corrections_test.mjs
node --experimental-vm-modules dev/tests/confirm_dialog_test.mjs
node --experimental-vm-modules dev/tests/brackets_confirmations_test.mjs
node --experimental-vm-modules dev/tests/mock_preview_test.mjs
```

The Start & Lock DOM checks require the existing QA dependency `jsdom`:

```sh
node --experimental-vm-modules dev/tests/start_lock_feedback_test.mjs
# BLAKEOUT_JSDOM_MODULE may point to an already installed jsdom package.
```

All fourteen suites pass for the integrated local candidate: account ownership 14 groups,
Start & Lock 12 DOM groups, correction core 219 tests, appearance 6 groups,
shell/dialog cascade 5 groups, availability 5, recording gates 7, build isolation
9, Dot Better 9, winner structure 5, production artifact audit 5, shared dialog
6, asynchronous bracket confirmation 72 and mock preview isolation/interaction
11. All 41 actual DEV static modules link successfully. JS/Python syntax
and whitespace checks pass. Independent review reproduced the shell contrast
bug before its fix and confirms the existing scorer palettes are unchanged.

Appearance tests cover both feature routes across all 12 themes × four styles.
Declared text/action/status contrast is at least 4.77:1 and focus/outcome outline
contrast is at least 3.48:1. The 96 shell combinations keep action contrast at
least 5.14:1; another 96 dialog/theme/style combinations preserve the panel and
action pairing. These are source-token/cascade calculations, not rendered pixels.

The original Start & Lock archive is intact and readable; current engine checks
include eight groups and 186 tournament simulations. Both the preserved original
correction suite and the current-engine suite pass 219 tests. The only current
fixture adjustment marks playing registrations paid, as current start rules
require; no planner assertion or rule was weakened.

## Next verification step

The shared dialogs and isolated sample previews are implemented and independently
reviewed. Sample-data DEV publication is authorized. After the DEV-only
deployment, verify actual CSP/import-map enforcement and
rendered cloud-browser behavior in portrait/landscape, all four styles, and
light/dark themes. Cover dialogs, loading/empty/error feedback, repeated actions,
cancel/escape, focus and navigation. Keep both real feature gates closed.

Local source, VM and JSDOM evidence is not a claim that the preview is already
live or visually validated. The preview must remain clearly distinguished from
real account, email, cloud record and cross-device readiness.

## Remaining feature/release gates

- Actual account email delivery and verification-link completion on the same and
  another device remain unproven. A real test needs an explicitly authorized
  recipient and action (verification or reset), with user entry/submission for
  password changes. Historical reset-email receipt is not verification proof.
- Actual match activity is a separate storage/rules design; Ready does not mean
  Playing. See [MATCH_ACTIVITY_DESIGN.md](MATCH_ACTIVITY_DESIGN.md).
- Corrections need an atomic authoritative event/index/tournament protocol,
  private audit access, complete result queries, effective-record projections
  for totals/exports and old clients, pending-result epoch/recovery handling,
  and emulator/concurrency/privacy tests. Generic result mutation paths must
  not bypass lifecycle bookkeeping. No backend change is ready for approval.
- Any proposed Firebase rules, auth/access or provider configuration change must
  identify the exact change and its access impact before deployment approval.
  No real account, email or record mutation is part of this batch.
- The original advanced grouping/post-lock editing and summary-email ideas stay
  deferred until their contracts and evidence justify implementation.
- Browser/provider/emulator and physical-tablet checks are distinct from NodeVM,
  source, JSDOM and token tests. Local browser execution remains unavailable due
  to the environment's socket restriction; no bypass was attempted.
