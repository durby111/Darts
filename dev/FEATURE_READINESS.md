# Feature readiness — November 3, 2026

The November 3 v2.6.0 candidate promotes the reviewed scorer from DEV main
`13083815d51eaa37d47fe16faf4f71ba9171cde3`, plus cloud-reimplemented startup
warning and bounded static-file recovery fixes. See [release evidence](../docs/RELEASE-20261103.md). Source remains authoritative if it
changes: [production flags](../js/feature-availability.js),
[DEV flags and preview routes](js/feature-availability.js),
[provider switches](js/account-provider-config.js), and
[DEV local adapter](local/platform.js). UI availability flags are not a security boundary.

| Area | Current status | Detail |
| --- | --- | --- |
| Ordinary scoring | Production and DEV available; offline-capable | [Project guide](../README.md) |
| Minnesota Cutthroat | Published to production and DEV | Optional points-to-open-opponents mode; lowest/tied-lowest closed player wins. [Rules/evidence](MINNESOTA_CUTTHROAT.md) |
| Minnesota Play for places | Published to production and DEV | Opt in after first place with 3/4 sides; skip finishers, protect first place and primary records; device-local placement history. [Rules/evidence](MINNESOTA_PLACES.md) |
| Production accounts and brackets | Coming Soon; both flags false | Notices and disabled navigation remain intact |
| DEV accounts/brackets navigation | Accounts enabled in DEV source; brackets gated | DEV account code remains DEV-only. This scorer promotion does not open production accounts or deploy backend changes. |
| Device-local brackets | Published **DEV only** at `/dev/local/brackets/` | Blind draw, format overrides, scorer integration, receipts, guarded local corrections and finals; no cloud or cross-device sync. [Acceptance](LOCAL_TOURNAMENTS.md) |
| Real cloud accounts/records/tournaments | Implementations retained, access gated | Named client apps/collection prefixes are not separate Firebase projects. [Rollout review](REAL_ACCOUNT_ROLLOUT.md) |
| Google/Apple sign-in | Prepared, disabled | Provider and redirect switches false; isolated-project prerequisite. [Provider notes](ACCOUNT_PROVIDERS.md) |
| Separate DEV backend | Proposed; no provisioning established by this work | [Setup handoff and approval boundaries](SEPARATE_BACKEND_SETUP.md) |
| Cloud result corrections / match activity | Not released | Local corrections do not establish cloud correction support. [Correction design](RESULT_CORRECTIONS.md), [activity design](MATCH_ACTIVITY_DESIGN.md) |
| Match-summary emails | Proposal | Existing branded verification/reset infrastructure is a different service; no summary-email rollout |

## Published baseline and evidence

| Change | Commit | Pages deployment |
| --- | --- | --- |
| DEV device-local tournaments | `4c150cc5eafeb771643ea89e014d391332f604b3` | [38824540845](https://github.com/durby111/Darts/actions/runs/38824540845), succeeded |
| Minnesota Cutthroat | `469ccdc8334ff26facdcda6af1904668df775737` | [38841795691](https://github.com/durby111/Darts/actions/runs/38841795691), succeeded |
| Minnesota Play for places | `20154e42bd73026a5dd121b9cfceaf5317007f01` | [38845342378](https://github.com/durby111/Darts/actions/runs/38845342378), succeeded |

The placement release passed 57/57 aggregate checks, 16 JavaScript suites,
62 scorer/bridge checks, targeted placement/recording tests, complete rendered
normal and Cutthroat matches, mobile checks and real cache-upgrade/offline tests.
Production Coming Soon pages and flags were verified locally. These are dated
release results, not a promise that future checkouts pass without running tests.
See [Testing](../docs/TESTING.md) for reproducible commands and evidence limits.

Physical touch hardware and non-Chromium browsers remain unverified. Direct
live-site inspection was blocked by the executor's HTTP 403 proxy; Pages success
and local rendered verification do not prove a user's cached device loaded the
new release. Browser fixtures do not establish real Firebase authorization,
email delivery, OAuth or multi-device behavior. Backend/config/security changes
and reopening real-account gates require separate explicit authorization.

Earlier cache versions, temporary browser blockers and unpublished statuses are
preserved in [readiness history](FEATURE_READINESS_HISTORY.md) and
[development notes](DEV_NOTES.md). They describe their dated milestones, not the
current status above. [Backlog](BACKLOG.md) tracks remaining work.

## November 3 scorer promotion candidate

See [BotBlake](BOTBLAKE.md) for independently configurable skill levels, Auto,
individual and team setup, supported modes, saved-game behavior, and local tests.
The candidate includes BotBlake, Brisket, player setup, shared presentation, simple scoring, and startup diagnostics. Production Accounts/Brackets, provider transports and security settings retain their existing boundaries. Publication must be confirmed by the exact-commit Pages run.
