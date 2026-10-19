Staged DEV integration, not activated

Entry: index.html -> entry.mjs -> openDevHistorySession.
HISTORY_DEV_RELEASE.enabled is false; browser exits before loading Firebase SDK.
Existing accounts/brackets/provider switches and service worker are unchanged.
Existing scorer/roster hooks are present behind the additional history=false flag. No live Firebase work performed.

When separately approved and activated at the configured DEV URL:
#view=history: verified owner grant discovery, refresh/materialization, revoke.
#view=consent&context=t_EVENT&registration=ROSTER: named tournament consent.
#view=consent&context=g_GAME&registration=ROSTER&seat=1&invitation=HANDLE:
  game-seat history consent; view=claim first performs explicit QR seat claim.
#view=desk&role=board or role=organizer: canonical coherent-state tournament desk.
No personal submitter login at board. Guarded board provisioning code is in board-setup.mjs; live setup remains unapproved.
Changing a route role cannot confer backend permissions. Rules remain authoritative.

Adapter environment defaults to synthetic demo. Live DEV requires exact known
project/app/auth domain, matching Auth+Firestore apps, actual default DB instance,
fixed coherent-v1 namespace and explicit DEV environment. Unknown config fails.
Emulator entry points retain their separate existing SDK emulator connection code.

historyDesk uses hcContexts state, never silently substitutes tdEvents state.
Do not run original tournamentDevice.submit alongside coherent submit for one
active event: they maintain different heads. Final lifecycle integration must
select one authoritative write path for each event and prevent mixed UI paths.
The source adapter remains available for source creation and event-role reads.

Available cloud checks:
node --test dev/history-attribution/test_*.mjs dev/history-attribution/coherent/test_flow.mjs dev/history-attribution/dev-ui/test_*.mjs
PYTHONDONTWRITEBYTECODE=1 python3 dev/history-attribution/coherent/test_source_contract.py
python3 dev/history-attribution/dev-ui/test_browser.py
node --experimental-vm-modules --test dev/tournament-device/permission-denied.test.mjs dev/tests/feature_availability_test.mjs dev/tests/profile_directory_platform_test.mjs dev/tests/accounts_page_test.mjs

New UI tests use synthetic SDK/DOM transports. Pinned-SDK guard test checks real
SDK instance identity without any connection. Chromium checks the real disabled
route and synthetic phone interaction with no external requests. None is new
Firestore enforcement evidence. See APPROVAL-PROPOSAL.txt for exact independent
laptop rules-hash evidence and remaining implementation/approval/acceptance gates.

Current completion status and exactly four remaining release gates: RELEASE-CHECKLIST.txt.
