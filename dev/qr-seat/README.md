# BlakeOut QR seat pairing — local DEV prototype

Review branch: `local/qr-seat-prototype`, based on `3011d48`. This is an isolated
clone; the tested app and header candidate were not edited. All changes live in
`dev/qr-seat/`. No Firebase SDK, cloud connection, OAuth provider, mail, billing,
allowlist, rules, push or deployment is involved.

## Run and review

```sh
python3 dev/qr-seat/server.py
# Open http://127.0.0.1:8874
python3 dev/qr-seat/test_pairing.py
# With Playwright installed and /opt/google/chrome/chrome available:
python3 dev/qr-seat/test_browser.py
```

Start local demo → Pair phone beside a guest seat → Open simulated phone.
Choose a synthetic account and Google/email option, verify account/name, game,
board and seat, then enter the six-digit code from the board. Nothing signs in
until that explicit confirmation. Leave, Remove player, and End game revoke
participation. Every new pairing asks for account selection, even when a prior
synthetic phone session exists. Unverified is an intentional negative fixture.
Guest seats require no account and remain the default.

The QR is real and generated locally with a vendored QR encoder, but its URL is
loopback-only: scanning on a physical phone cannot reach this server. Use the
simulated phone link for local review. The browser test uses distinct temporary
phone/display contexts, not connected Chrome or its user profile. Real devices
need an approved HTTPS origin and reachable backend later.

## Architecture choice

A trusted pairing backend owns short-lived handles and participation grants.
The local Python service is a **synthetic mock**, not Firebase Auth or a deployable
identity verifier. Its single lock serializes validation and mutation so exactly
one concurrent claim can win. Production needs a transactional datastore across
all instances; a process lock is not sufficient there.

- The board has an independent, random board-session credential; never a player
  UID custom token or player login. It can manage only its own demo game.
- QR URL fragment carries a 256-bit random handle, never login tokens, email,
  UID or matching code. Fragment avoids HTTP request/referrer transmission; the
  phone posts the handle only to the claim service. Request logging is disabled.
- Pairings expire after 120 seconds, are bound to game + seat, and are consumed
  atomically. Rotation, removal and end-game invalidate pending handles. The
  matching code is board-only; inspecting a handle does not reveal it.
- Claims require a verified identity and explicit UID/game/seat/code match.
  Live code must derive UID/verification from validated Firebase credentials,
  never a client-selected fixture. Name is display metadata; UID is the history
  key. One account can occupy only one seat in the demo game.
- Board gets UID, display name and a game/seat participation record. It receives
  no phone session credential and cannot read an inbox or payment data. A grant
  is not a Firebase token and does not authorize general account APIs.
- Grants expire after four hours and revoke on leave/remove/end. A result writer
  must validate the current grant at submission, not trust a cached client UID.
  Revocation affects future participation, not historical records.
- Board/phone session data is separate in sessionStorage and restored on reload.
  Phone reload after a successful claim checks current participation. Before a
  claim, reload requires explicit account choice again. Server restart clears
  all state and fails closed. No existing app storage is read or modified.

A rules-only design would still need carefully scoped display identity, atomic
claim writes, expiry/owner checks and a way to resist abuse. Backend claims are
preferred because one trusted operation can validate identity, rate limits,
seat ownership and consent. The prototype's per-token/action limiter is only a
local demonstration; it is not resistant to token rotation or distributed abuse.

## Test boundaries

`test_pairing.py` covers expiry at the boundary, replay, eight concurrent claims,
wrong seat/game/account/code, remove/leave/end revocation, reload state, grant
expiry, unverified rejection, QR rotation, pending end-game, duplicate identity,
board authorization and a basic rate limit. `test_browser.py` exercises rendered
board/phone flow and real reloads with all non-loopback page requests blocked.
Screenshots are written to `/tmp/blakeout-qr-evidence/`.

The prototype is a standalone pairing review surface. It does not attach to the
existing scorer, write history, verify real OAuth, send email, emulate Firestore
rules, or establish iOS/Android camera behavior. No live security conclusion can
be drawn from synthetic identity acceptance.

## Concrete prerequisites before live implementation

1. Review UX and agree on a no-cost backend hosting path. Any new hosting,
   billing, provider, rules or deployment needs separate approval. Do not enable
   Blaze just to use callable functions.
2. Implement a phone-only Firebase adapter: verified email/password and Google
   basic identity scopes; no Gmail/payment scopes, no Apple. Use explicit account
   selection and confirm the identity again after auth resolves. Choose phone
   persistence deliberately and never initialize player auth on the board.
3. Choose the phone HTTPS origin and redirect strategy with the accounts owner.
   GitHub Pages plus cross-origin Firebase redirect helpers has third-party
   storage constraints. An approved Firebase-hosted companion is an option;
   it has not been created. Test popup/redirect on actual mobile browsers.
4. Implement authenticated board sessions, durable transactional handle claims,
   server credential validation, distributed rate limits, expired-record cleanup,
   abuse controls and restricted game/result endpoints. Deny display access to
   account data. Emulator-test those actual security rules and endpoints.
5. Wire seat grants into the existing casual-recording/result boundary using
   stable Firebase UID, guest null IDs and server-side authorization at write
   time. Define result finalization/idempotency and corrections; retain existing
   data and provider gates. Do not silently upgrade a guest to an account.
6. Independently authorize and test live setup, deployment and limited real-device
   acceptance. This branch is not deployment approval.

## Source basis (reviewed 2026-10-17)

- [Firebase redirect best practices](https://firebase.google.com/docs/auth/web/redirect-best-practices): third-party storage restrictions and hosting alternatives.
- [Firebase auth persistence](https://firebase.google.com/docs/auth/web/auth-state-persistence): choose session/local/in-memory persistence explicitly for phone auth.
- [Firebase callable functions](https://firebase.google.com/docs/functions/callable): auth context is available to backend handlers; authorization remains application logic.

QR encoding source comes from the existing local `qrcode-terminal` dependency's
QRCode vendor directory (Kazuhiko Arase); source notices and licenses are retained
in `qr.js` and `QR-LICENSE`. No CDN or QR analytics service is used.

## Recorded local result

2026-10-17: all 11 service cases passed. The isolated rendered browser suite
passed with no JavaScript errors, including account switching, wrong code,
claim, board/phone reloads, removal, leave and end. A same-tab QR rescan bug found
by that suite was fixed before the successful rerun. Board and phone screenshots
were visually reviewed. The test screenshots contain synthetic fixture data only.
