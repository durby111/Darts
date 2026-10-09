# DEV sample-data preview

Entry points (after an authorized DEV publication):

- `/dev/preview/` — preview links
- `/dev/preview/accounts/` — Players & Records
- `/dev/preview/brackets/` — Brackets

Every page is labeled **Preview · sample data · nothing is saved or sent**.
The real `/dev/accounts/`, `/dev/brackets/`, production pages, and feature flags
are unchanged. The preview is a UI testing surface, not authentication,
persistence, deliverability, backend-permission, or production-readiness proof.

## Implementation and isolation

The classic bootstrap checks import-map support and the exact single-entry map.
The module bootstrap then checks `import.meta.resolve` to confirm the real
platform specifier resolves to the memory fixture before requesting a template.
Missing/ignored/tampered map or missing resolver fails closed, without importing
the real platform or mounting interactive feature forms.

The preview reads the current inert template from the corresponding DEV feature
HTML, mounts it with preview labels/guards, and imports the real account or bracket
page module. The import map substitutes only `dev/js/platform.js` with the
preview's small, memory-only fixture adapter. The real bracket engine, diagram,
labels, account aggregation, shared confirmation dialogs and shared CSS are used
as-is. No copied feature application exists here.

The restrictive CSP permits same-origin scripts/styles and the one exact hashed
inline import map. `connect-src` restricts connections to the same origin (CSP does not distinguish
HTTP methods). Forms, workers, frames, objects, manifests and external provider
origins are blocked. Source and tests verify that the sole application fetch is a
read of static feature HTML with omitted
credentials and redirects rejected. Fixture operations never make requests.
The code does not register, clear, update or precache a service worker. Existing
DEV SW behavior is unchanged and may cache visited static preview assets; no
sample identity, edit or result is serialized. No normal-app asset depends on
the preview.

Credential fields are disabled, read-only text fields without a form name. The
container is inert until actual UI handlers have loaded, with capture-phase
submission/click guards throughout. Auth actions, legacy email-link completion,
JSON export, scorer launch and non-preview links are blocked before their real
handlers. Only an explicitly labeled plain Back to scoring link leaves the
preview. No tournament-launch descriptor or query is created. Shared dialog
messages receive the sample-data label too.

Initial theme/style values are read from saved appearance. Preview controls set
DOM attributes only; neither theme.js (which writes at boot) nor the scorer app
is imported. Invented names are prefixed with `Sample`; no fixture has an actual
email address. No storage key, query parameter, or preview option unlocks real
feature gates.

## What can be tested

Accounts:
- Simulated verified, unverified, signed-out, empty, loading and error states
- Sample profile edit, sign out, refresh and current raw-counter summary layout
- Invented tournament/casual 501, Cricket and Minnesota record presentation

Brackets:
- Registration, live, completed, 32-team, spectator, unverified, empty, loading
  and error scenarios
- Current/history navigation, create a sample tournament, guest registration,
  draft edits, ordering, bulk flags, team pairing, blockers and preview diagram
- Save sample roster in memory, cancel/confirm start and lock, manual scores or
  forfeit, cancel/confirm result save, bracket progression and source jumps
- Current shared app-owned confirmations and 100%/75%/50%/fit diagram controls

The sample owner is already registered in the default event. Create a new sample
event to exercise the owner's Join tournament action. Guest joins are idempotent
within the current page. Spectator fixtures redact private roster flags.

Unsupported: real accounts, credential entry, verification/reset/sign-in emails,
real guest authentication, actual cloud persistence or recovery, real scorekeeper
results, exports, scorer launches, external navigation other than Back to scoring,
backend rules/permissions and cross-device synchronization. Reload/navigation
resets sample state; every scenario switch does the same. Loading remains pending
until another scenario is selected. Error is a deliberate fixture failure.

Query examples:
- `/dev/preview/accounts/?scenario=unverified`
- `/dev/preview/accounts/?scenario=empty`
- `/dev/preview/brackets/?scenario=live`
- `/dev/preview/brackets/?scenario=large`
- `/dev/preview/brackets/?scenario=spectator`

## Verification

Run with an existing JSDOM installation (no package install needed):

```sh
BLAKEOUT_JSDOM_MODULE=/path/to/existing/jsdom \
node --experimental-vm-modules dev/tests/mock_preview_test.mjs
```

The tests cover exact import-map hash/shape, unsupported/ignored mapping and
resolver failures, template failures, fixture graph and revision behavior,
idempotent guest joining and redaction, current templates/modules in JSDOM,
forced export/auth/scorer clicks, legacy auth-link queries, blocked premature
submits, real shared confirmation cancel/approve flows, all scenarios, appearance
read-only behavior, local asset existence and production/DEV gate independence.

JSDOM is not visual/browser CSP enforcement, touch, accessibility-device, live
provider, or offline-runtime verification. Use a public DEV browser review after
publication to check actual responsive layout and CSP/import-map behavior.
