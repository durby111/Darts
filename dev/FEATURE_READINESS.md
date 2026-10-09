# Feature readiness — October 8, 2026 (Central)

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
- **Cache:** prepared DEV v56 includes the shared appearance modules and palette
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
Start & Lock 12 DOM groups, correction core 219 tests, appearance 5 groups,
shell/dialog cascade 4 groups, availability 5, recording gates 7, build isolation
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
