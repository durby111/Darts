# Laptop source preservation — resume-before-lifecycle

Snapshot of local commit `9aed21633987101685e97202519ad7d7586e1f76`. This backup branch is not a deployment or integration into main. Main has newer independent work; merge deliberately.

Original histories and exact pilot configuration remain on MD-Home. The public backup omits the real pilot UID from rules, static contracts and notes; rules have an empty, fail-closed pilot list. The manifest records the exported rules hash. All other candidate source is preserved. The original tested isolated rules SHA256 is `171a038cc0f7442a93cd35aea8080a71ee4ccca4e9f6409a4980adfb51da5d11`; the sanitized copy differs and is not claimed as a newly tested configuration.

No live credentials, emulator state, browser authentication, customer records, logs or local environment files are included. Existing public client Firebase configuration is not a server credential.

Resume acceptance evidence before export: 18 lifecycle groups, zero skipped; production guard 5/5. QR submission checkpoint evidence: 49 integration groups and 775 regression checks. These are recorded prior runs, not rerun for backup; applicability depends on the candidate. Real-account and physical-device acceptance remains incomplete.

Use the scripts and documentation under `dev/tests`, `dev/backend-setup`, and where present `dev/tournament-device` / `dev/qr-firebase` for local synthetic-only reproduction. No deploy or live Firebase tests are authorized by this backup.
