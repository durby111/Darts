# Testing BlakeOut

Run commands from the repository root. Tests are split between pure/source/DOM
checks and rendered Chromium checks; neither establishes real provider behavior.
[Feature readiness](../dev/FEATURE_READINESS.md) records the latest release evidence.

## Environment

The October 16 release used Node 24, jsdom 30.1.2, Python 3 and system Chromium
with Playwright. Python pins are in [requirements.txt](../dev/tests/requirements.txt).
Install QA dependencies outside application assets, for example:

```sh
python3 -m venv /tmp/blakeout-qa-python
/tmp/blakeout-qa-python/bin/pip install -r dev/tests/requirements.txt
. /tmp/blakeout-qa-python/bin/activate
npm install --prefix /tmp/blakeout-qa-node jsdom@30.1.2
export BLAKEOUT_JSDOM_MODULE=/tmp/blakeout-qa-node/node_modules/jsdom
```

Use the virtual environment's Python for commands below. The aggregate runner
uses `chromium` from PATH if present, otherwise Playwright's bundled browser.
Several focused runners explicitly use `/usr/bin/chromium`; check their launch
configuration before using another environment. If using the bundled browser,
install it with `python -m playwright install chromium`. Browser/dependency or
socket restrictions are blockers, not passing test results.

## Source and DOM checks

```sh
for test in dev/tests/*test.mjs; do
  node --experimental-vm-modules "$test" || exit 1
done
```

This covers 16 suites at the documented baseline, including production module
linking, availability gates, storage isolation, preview contracts and bracket/UI
logic. jsdom and static CSS checks do not prove rendered layout or touch behavior.

## Rendered regression checks

```sh
python3 dev/tests/dev_test.py
python3 dev/tests/scoring_bridge_test.py
python3 dev/tests/dev_test_navigation_test.py
python3 dev/tests/bracket_engine_test.py
```

The aggregate runner starts its own localhost server (port 8823), blocks external
requests and reports to `/tmp/blakeout_dev_test/report.json`. Use
`--only winner_screen` or another discovered test name for a focused rerun.
Run one aggregate instance at a time. Scorer/bridge fixtures mock Firebase;
passing them is not evidence of live cloud writes or deployed rules.

For the Minnesota feature and production update path:

```sh
python3 dev/tests/minnesota_places_test.py
python3 dev/tests/minnesota_places_edges_test.py
python3 dev/tests/minnesota_places_full_test.py
python3 dev/tests/minnesota_places_mobile_test.py
python3 dev/tests/minnesota_release_test.py
python3 dev/tests/minnesota_recorded_edges_test.py
MN_BUILDS='' python3 dev/tests/minnesota_cutthroat_test.py
MN_BUILDS='dev/' python3 dev/tests/minnesota_cutthroat_test.py
```

The release test pins the pre-placement baseline and expected worker cache names;
review those assertions deliberately when preparing a subsequent release.
Near-win fixtures test boundaries. The full-match suite separately enters every
closure through rendered controls. Placement records stay device-local and do
not append to the original closed scoring ledger.

Device-local tournament coverage is documented in
[LOCAL_TOURNAMENTS.md](../dev/LOCAL_TOURNAMENTS.md):
`local_tournament_flow_test.py`, `local_tournament_games_test.py` and
`local_tournament_edges_test.py` under `dev/tests/`. Broader feature suites include
`platform_test.py` and `brackets_ui_test.py`; keep their provider fixtures intact.
The older `scripts/headless_test.py` is supplementary production smoke coverage,
not a replacement for current release and feature tests.

## Evidence and limits

Some focused scripts write traces/screenshots under `/workspace/scratch/`.
These are executor artifacts, not repository files or public CI downloads.
Preserve results and state whether each check passed, failed or was blocked.
For documentation-only edits, validate relative links, referenced paths and the
Markdown-only diff; gameplay suites need not be rerun without runtime changes.

- Physical touch, iOS/Safari, Android behavior and distance readability require
  separate device checks. Mouse interactions and mobile viewport sizes are not equivalent.
- Mocked transport tests send no real mail and do not verify OAuth, Firebase
  rules, production data access or cross-device persistence.
- Firestore emulator download/validation has previously been proxy-blocked;
  record that limitation instead of claiming compilation passed.
- Live `blakeoutdarts.com` retrieval was proxy-blocked during the October 16
  releases. A successful Pages deployment is separate from direct live inspection.
- Do not clear user site storage, enable real-account gates or change security
  settings to make a test pass. Real backend/email testing requires its own
  explicit authorization and controlled setup.
