NEW public policy test handoff — no activation/deployment

Base branch: review/combined-local-verified-20261018 (2f30644).
This directory and dev/release/real-player-pilot are the only new changes.
The saved rules file is a proposed candidate, referenced by no Firebase config.

Reproduce and validate locally:
  PYTHONDONTWRITEBYTECODE=1 python3 dev/public-pilot/test_proposal.py
  PYTHONDONTWRITEBYTECODE=1 python3 dev/public-pilot/compose_rules.py > /tmp/public-proposed.rules
  cmp /tmp/public-proposed.rules dev/public-pilot/firestore.public-proposed.rules

Actual enforcement on approved laptop tooling (no downloads or live endpoints):
Set absolute BLAKEOUT_QA_JAVA and BLAKEOUT_QA_JAR to already-approved tools.
Set PUBLIC_POLICY_EVIDENCE to a NEW absolute directory outside the checkout.
  PYTHONDONTWRITEBYTECODE=1 python3 dev/public-pilot/run_tests.py

Requires working unshare -Urn; entire emulator process tree is loopback-only.
Uses demo-blakeout-public-policy, unsigned synthetic claims evaluated by real
Firestore emulator, no real Auth accounts/tokens/emails. Each case clears only
that disposable emulator namespace and seeds synthetic fixtures. Expected 50
allow/deny cases including two overlapping device-role denials, with no skips.
A missing emulator is a failure, never a mocked/automatic pass. Compilation and
new-policy behavior remain UNVERIFIED until this runner exits 0 with its logs.
Existing 59 integration/775 account-rule/24 matcher passes test different rules.

See ../release/real-player-pilot/README.txt for exact proposed scope, required
frontend pagination/own-history integration, quota considerations, user acceptance
and separate activation confirmation. Do not replace live rules with this file.
