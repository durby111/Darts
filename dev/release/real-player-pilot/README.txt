Public-signup DEV pilot policy — REVIEW ONLY, activation NOT authorized

Mike selected 'Anyone' on 2026-10-18. This supersedes the invited-only/five-tester
proposal from e885eab/f08d4d1. Public signup is the selected development policy;
there is no tester-count cap or account invitation list. The inert JSON still
has additionalTesterAccessEnabled=false and requires separate activation
confirmation. No application, Auth setting, live rules or membership was changed.

Selected onboarding and private-data boundary
Anyone may sign up. Private account/history operations require an authenticated
UID, verified email and password or Google provider; anonymous/unverified claims
are denied. Existing local guest/offline play remains available without account
history. Public signup does not make private history public. Names-only profile
records are visible to verified users through bounded pages; no email is stored.
Actual Auth signup behavior must be accepted with the UI and provider settings.
This JSON is a proposal, not an authorization mechanism or a live kill switch.

Concrete proposed access changes
See dev/public-pilot/firestore.public-proposed.rules and its deterministic
compose_rules.py. Base: combined closed candidate at 2f30644. Only profile and
casual result/receipt collection guards change to publicVerified (no invitation
membership). All other original gates remain: legacy cloud tournaments, private
resume, QR roles, tournament operators and board assignment are not broadened.
The QR/device audit, revision/dependency undo and latest lifecycle fragments are
byte-for-byte retained. Board identities are explicitly excluded from public
account grants even when verified. Empty device/operator/player role lists stay.

Initial proposed history scope: casual 501 and Cricket, own UID only. Each new
result's participantIds must equal [request.auth.uid]; counters must match that
game; new receipts must be for that UID. This is a proposed anti-abuse change
requiring review: the old trusted-scorekeeper model could let any public signup
inject history for another player. Public signup does not authorize that.
Keep multiplayer scoring/guests local, and permit only explicitly opted-in own
history until consent for other players is integrated. Do not repurpose
named-tournament QR consent as consent for unrelated casual games. Existing
owner/receipt-linked reads remain private and immutable history remains intact.
This narrower write policy also denies new 301 history writes; Mike's known
301 acceptance is not acceptance of this new scope. Confirm this scope before
activation or revise/test the whitelist deliberately. No automatic grandfathering
or guess of the private live owner's identity is included.

Profiles/history/receipt LIST queries require limit 1..50. This bounds individual
responses, not total usage or scraping. Existing unbounded client queries are
NOT compatible with these proposed rules. No frontend gate has been flipped.

Exact proposed activation sequence — user confirmation remains a final gate
1. Pin reviewed public rules hash and isolated target blakeout-darts-dev/default;
   recover exact currently deployed owner-only policy/config as rollback snapshot.
   The sanitized combined source is not the live owner configuration. Never deploy
   root firestore.rules or overwrite existing access with empty legacy role lists.
2. Run NEW public matrix with actual emulator compiler/enforcement; inspect all
   50 cases and any additions, then rerun device/lifecycle/account regression
   against the proposed composition with adjusted public expectations. Prior
   closed-allowlist 59/775/24 evidence does not cover this policy.
3. Integrate on current main e731a77, preserving its offline fixes/tests. Update
   dev/js/platform.js listProfiles/listMyResults with limit(50), stable cursor
   pagination and load-more UI; stop querying held legacy collections for public
   users. Update casual-recording.js and accounts-page.js to record only the
   authenticated player's own UID, explain guests/other-player consent and the
   two-game scope, preserve pending retry/idempotency and avoid silent truncation.
   Current listMyResults queries legacy results in parallel: a denied branch
   would reject the whole request. Fix this before enabling public policy.
4. UI must allow signup but hold private history until verified identity is
   refreshed. Accept password signup/verification, Google linkage and completed
   reset in Mike's authorized local session. No emails were triggered here.
5. Test two real approved verified accounts: cross-user isolation, both games,
   local guests, own linked history only, multiple saves, pagination >50 results,
   retry/reconnect and second-device reads. Test unverified/anonymous denials and
   disabled/removed account behavior. Token revocation can lag cached tokens;
   do not claim immediate revocation or remote deletion of downloaded data.
6. Review Spark abuse/usage plan below; agree operational thresholds and response
   owner. Inspect actual project plan/Auth mode/limits without changing billing.
7. Present exact frontend diff, rules diff/hash, target config, scope and rollback
   to Mike for confirmation. Only then separately authorize DEV publication and
   isolated rules activation. Do not infer those approvals from 'Anyone'.
8. After separately authorized activation, verify served source/cache, live
   allow/deny behavior and usage. Public opening remains OFF until then.

Rollback preparation
Retain exact prior owner-only rules and current frontend/cache hashes. If rollout
fails, separately authorize restoring that exact policy and reviewed DEV frontend
revert/cache bump. Do not delete users/history or clear local recovery. Removing
public Firestore grants does not disable Firebase Auth signup; treat those as
separate controls. No rollback action is executed by this packet.

Spark exposure and practical guards (official docs checked 2026-10-18)
Firestore Standard free quota: 50,000 document reads/day, 20,000 writes/day,
20,000 deletes/day, 1 GiB stored data and 10 GiB monthly outbound transfer.
Source: https://firebase.google.com/docs/firestore/quotas
A self-history save normally needs result+receipt writes (at least two), plus
reads/retries/rules lookups. Quota math is not a promised number of users/games.
Repeated reads, valid profile edits or many verified accounts can exhaust the
shared free quota; list limits and verification are NOT server rate limiting.
Additional rules document lookups can consume reads even for rejected requests.
Source: https://firebase.google.com/docs/firestore/pricing

Proposed rules already retain payload/schema bounds, immutable results, own-UID
writes, game whitelist and new page bounds. Before activation: debounce/cache
name lookup; cursor-page history on demand; avoid broad listeners/polling; bounded
retry with backoff and manual retry after resource-exhausted; retain unsynced
results locally; display sync failure honestly; monitor usage with manual pause
thresholds (suggest 50% investigate, 75% pause public writes pending review).
These thresholds are operational proposals, not implemented automatic limits.
A malicious verified user can still drain quotas; accept that risk or add and
emulator-test stronger server-enforced per-UID quotas before opening. A client
cooldown alone does not prevent adversarial traffic. No paid service is proposed.

Firebase Auth publishes 100 new accounts/hour/IP and separate email/link limits;
limits vary with configuration. The 3,000 DAU instrumentless limit specifically
applies to Auth WITH Identity Platform on Spark; do not assume this project mode.
Source: https://firebase.google.com/docs/auth/limits
Review existing email-worker limits and avoid automatic verification/reset loops.
Do not enable billing, SMS, Functions, TTL jobs or external anti-abuse services.
App Check is a possible separately reviewed defense, not user authorization or a
complete abuse guarantee; provider quotas/settings need review. It is NOT enabled
by this candidate. Source: https://firebase.google.com/docs/app-check

Evidence status
The transferred public rules/test tree passed on the approved laptop: 50 public
cases, 5 REST protocol/nonadmin controls and 9 actual SDK cases, exit0, no skips.
Exact rules/helper hashes were matched in cloud; see
../../public-pilot/VERIFIED-READINESS.txt for source provenance and scope.
Cloud static checks remain separate; no cloud emulator pass is claimed.
Prior closed59/775 and matcher24 results remain closed-policy/unit evidence.
Frontend1018b7b has local DOM/VM coverage but was NOT included in this backend
verification. Full merged frontend/backend and real-player acceptance remain
pending, alongside history-query pagination, explicit self-only setup and consent.
Activation remains disabled and requires separate concrete confirmation.
