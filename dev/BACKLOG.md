# BlakeOut backlog — October 16, 2026

Use [Feature readiness](FEATURE_READINESS.md) for released behavior and source
pointers. The [October 8 snapshot](BACKLOG_HISTORY.md) preserves earlier findings,
release IDs and temporary blockers; its unchecked items are not all current.

## Remaining verification and rollout work

- Review real tablet/phone touch, pinch/drag, distance readability and long sessions;
  test Safari/iOS and Android browsers. Chromium viewport tests are not hardware proof.
- Inspect the served production and DEV builds from an unrestricted connection,
  including an existing installed app's cache upgrade. Executor live retrieval is proxy-blocked.
- Complete approved separate-backend setup and emulator/rules validation before
  reopening real DEV cloud accounts. Do not treat named Firebase apps as project isolation.
- With explicit recipient/action authorization, verify real email delivery and
  verification/reset completion, ownership checks and a second real device.
- Keep Google/Apple disabled until isolated-project/provider setup and real OAuth
  verification are separately authorized and completed.
- Finish cloud correction persistence, immutable-record invalidation and statistics
  projections. Device-local tournament corrections are delivered separately.
- Active-match indication remains design work; a ready match is not evidence of play.
- Match-summary emails, scalable account aggregates and advanced/post-lock roster
  editing require their own implementation contracts and scope approval.
- Complete the unused-export/DOM/CSS audit before deleting code. Historical
  single-reference candidates are not proof that an API is unused.
- Review hosting headers/CSP, domain controls, renewal and account MFA separately;
  documentation cleanup does not authorize infrastructure changes.

## Delivered since the old snapshot

DEV sample navigation, session/provider preparation, device-local tournaments,
Minnesota Cutthroat and Minnesota placement continuation have newer evidence in
[Feature readiness](FEATURE_READINESS.md). Start & Lock's earlier browser fixture
failure was corrected; historical failing runs remain recorded as history.
Production Accounts and Brackets still show Coming Soon.
