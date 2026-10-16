# Google and Apple sign-in — DEV preparation

Implemented behind the real-account gate and independent provider switches.
**Neither provider is enabled in code.** No Firebase Console provider, OAuth
credential, Apple Developer resource, backend config, rules or production asset
was changed. Real account access remains sample-only until isolated-backend validation;
ordinary scoring and device-local DEV brackets have separate availability. See
[Feature readiness](FEATURE_READINESS.md).

## Behavior and release controls

`js/account-provider-config.js` has `google.enabled: false`, `apple.enabled: false`
and both `redirectEnabled: false`. The adapter additionally requires its Firebase
app's project to be exactly `blakeout-darts-dev`; it rejects the old shared
`blakeout` project even if a provider switch is accidentally enabled. Disabled
providers have disabled, explicitly unavailable buttons. Sample previews cannot
start provider auth or consume redirect results.

Once separately enabled, popup sign-in uses Firebase GoogleAuthProvider or
OAuthProvider('apple.com'). Google asks the user to choose an account; Apple
requests name/email only. Firebase verification claims and the stable UID still
control records and profile access. No profile name is silently overwritten.
The app does not enumerate email sign-in methods, extract credentials from
collision errors, link credentials, or merge profiles/results by matching email.
An existing signed-in account must sign out first. Firebase itself resolves its
provider-to-UID associations; this client does not implement a linking flow.

One provider request runs at a time. UI locks other sign-in actions while pending.
Any account transition releases the old request's UI ownership; successful
accounts render through the account subscription. Late errors cannot overwrite
a replacement user's feedback, even when both users have the same provider.
Provider errors are mapped to safe messages; raw customData, email/credential
payloads and provider tokens are not copied into page messages or our storage.
Cancel, blocked popup, disabled provider, unauthorized domain, network failure
and existing-account collision are handled without automatic retry/linking.

Redirect is a separate release switch, not an automatic popup fallback. Only a
second explicit click can start it after a blocked popup, and only when configured.
A tab-scoped marker contains provider/project/start time only. Return processing
requires the expected project/provider, expires after 30 minutes, consumes the
marker once, and verifies the returned account session. Missing, malformed,
expired or mismatched returns cannot fabricate successful sign-in or trigger a
retry. Firebase manages its own normal authentication persistence. Already-sent
provider requests cannot be undone by client-side session checks.

## Setup still required; no setup was performed here

- **Google:** Owner must enable Google in the isolated project's Authentication
  sign-in methods, choose the support email, and confirm domains/key restrictions.
  Code activation must wait for the isolated config and Firestore validation.
  [Firebase Google setup](https://firebase.google.com/docs/auth/web/google-signin)
- **Apple:** Confirm Apple Developer setup, app/Services ID, approved website and
  return URL, team/key identifiers and secure private-key handling before enabling
  Apple in Firebase. Never place an Apple private key in frontend code or chat.
  Review Apple's private-email-relay requirements for account email delivery.
  The disabled button is not a claim that this setup exists.
  [Firebase Apple setup](https://firebase.google.com/docs/auth/web/apple)
- **Redirect:** Keep disabled until a supported auth-domain/hosting setup and
  real-browser storage behavior are verified. GitHub Pages with a separate
  firebaseapp.com auth domain does not by itself establish reliable redirect
  behavior in browsers blocking third-party storage. Any hosting/proxy/domain
  changes require their own review; popup or email/password remains the default.
  [Firebase redirect guidance](https://firebase.google.com/docs/auth/web/redirect-best-practices)
- Linking existing accounts is a separate future consent flow. No account linking,
  production migration, OAuth grants or provider secrets were created here.

## Evidence and limits

`tests/account_providers_test.py` drives the actual account UI and adapter in
Chromium with mocked Firebase/OAuth boundaries: default-off and shared-project
refusal, cancellation/config/network/collision messages, repeated-call exclusion,
Google selection, Apple scopes/unverified claims, explicit redirect fallback,
return consumption and malformed/stale/expired returns. External network is
blocked; these tests do **not** prove actual Google/Apple OAuth or Console setup.

`tests/accounts_page_test.mjs` additionally covers UI locking, disabled-provider
restoration, explicit redirect consent and stale response ownership. Preview,
navigation, appearance and existing platform tests remain in use. No actual
Google/Apple consent screen, popup delivery, redirect delivery, Apple relay mail,
physical touch device or live provider/backend write is claimed as verified.
