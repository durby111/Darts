# Online DEV account pilot — prepared, not published

Only `[LOCAL PILOT UID OMITTED]` is listed in the candidate Firestore rules.
Project: `blakeout-darts-dev`; database: `(default)`; app:
`1:901185136996:web:89d4f413520e66ff773271`.
Exact candidate SHA256:
`171a038cc0f7442a93cd35aea8080a71ee4ccca4e9f6409a4980adfb51da5d11`.
The separate `firebase.isolated-dev.json` and manifest pin this scope.

## What will open

The local candidate enables `/dev/accounts/` and increments only the DEV service
worker cache to `blakeout-dev-v70-named-account-pilot`. Production accounts and
brackets remain off; DEV brackets remain a sample route; Google/Apple app switches
remain off. Password signup now reflects the observed DEV policy (10–4096 with
uppercase/lowercase/number/special character), without forcing existing sign-in
passwords through signup checks. Firebase remains authoritative.

From the published `/dev/js/platform.js`, verification/reset actions return to
`https://blakeoutdarts.com/dev/accounts/`. No localhost is hardcoded in the app.
The temporary localhost Auth-only bootstrap is separate and is not part of this
publication. Its server remains running until Mike confirms it is no longer needed.

The accounts UI is public, including signup/reset controls. Only the named,
verified UID can use the eight DEV Firestore collection families. Rules also permit
that UID's valid tournament operations even though the DEV bracket UI remains
closed. Auth signup itself is not restricted by Firestore rules. Initial test data
should be a synthetic profile/display name and one casual result, with no other
person's identity, payment flags, production records or historical migration.

## Evidence supplied by Mike, not independently read through browser tools

- Correct DEV default database currently has deny-all rules.
- Email/password and Google Auth providers enabled.
- Authorized domains include localhost, the two DEV Firebase domains and the
  custom BlakeOutDarts.com entry. Do not add it again or broaden the domain list.
- Password-policy screen showed Require, min 10/max 4096, all four character
  classes required, force-upgrade on sign-in unchecked. Screen appearance does not
  independently prove persistence; server policy errors remain authoritative.
- First DEV account created through the user-submitted Auth-only form; verification
  email received and completed; exact UID supplied by Mike.

Branded, polished verification/reset emails are an explicit requirement before
production launch. Current Firebase emails are accepted only for this DEV test;
no production readiness claim or old Worker reactivation is included.

## Exact approval and publication boundary

Mike approved publishing only the reviewed hash above to the
DEV default database, granting the existing eight-family rules solely to the named
verified UID. No other UID, production project, IAM, provider or billing change. The exact
plaintext file and DEV Rules console were opened for his manual publication;
publication is not yet independently confirmed.
The validated helper can print the exact command without executing it:

```sh
python3 dev/backend-setup/prepare_isolated_pilot.py \
  --project blakeout-darts-dev \
  --expected-sha256 171a038cc0f7442a93cd35aea8080a71ee4ccca4e9f6409a4980adfb51da5d11 \
  --prepare-command
```

Firebase CLI has no authorized account; supported browser tools expose no Chrome
tabs. With approval, Mike can publish the exact file in the DEV Firestore Rules
console, or connect the supported Chrome extension for the existing session.
No credential extraction, remote-debugging setup or new login is implied.

Frontend publication is separate: GitHub Pages serves `durby111/Darts` main at
`blakeoutdarts.com`. The rescued candidate checkout has no remote. The existing
`/home/md/Documents/Darts/blakeout` checkout was observed at
`062f2f6208e820c614be4ce6f686185afb4eff79` with untracked `HANDOFF_DOT.md`.
Do not overwrite, reset or push that checkout blindly. Read the current remote
head, reconcile only reviewed DEV changes into an isolated publication branch,
preserve all root/production assets, and verify the matching Pages build and
served DEV source after the scoped publication. This file does not authorize
additional writes or publication outside the user's DEV intent.

Changing the frontend gate cannot undo granted server access. A rollback must
retain the named-UID restriction or restore deny-all. Removing access does not
remove cached records or revoke Auth sessions. Cleanup remains separately scoped.

## Verified GitHub publication route

The existing GitHub connector successfully read `durby111/Darts` without a new
login. Remote `main` was verified as `bed17725c7934216d01d2333cac62f4201d14baa`,
matching this candidate's baseline; base tree is
`bd75bfee4eed8a4eb15be4b4ae071b0d9f8ea07f`. Recheck the head immediately before writing.
Use one atomic tree/commit containing only the 15 runtime files listed in the
local `activation/online-runtime-manifest.json`, then update the ref with the
expected previous SHA (no force). Verify the resulting changed-file list and
Pages run. Connector read success is verified; no write was attempted here.

Do not publish the whole local branch. Backend setup/rules, tests, evidence,
bootstrap route, plaintext handoff and logs stay local. Root assets stay byte-identical.
The separate backend rules publication and site publication are not interchangeable.
