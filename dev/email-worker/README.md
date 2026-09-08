# BlakeOut development auth-email Worker

`worker.js` is a single, dependency-free ES module for the existing
`https://blakeout-email-dev.dartsblakeout.workers.dev` Worker. This directory does
not deploy anything. No Node/npm, Wrangler, Firebase Admin SDK, or additional
IAM permissions are required.

## Deployment status

The Worker is deployed with both encrypted secrets and the initialized
`EMAIL_LIMITS` D1 binding. On September 7, 2026, the owner confirmed receipt of
a real password-reset email with the BlakeOut sender and logo. The DEV frontend
uses this Worker for verification and password resets; optional email-link
sign-in still uses Firebase. No paid plan was enabled.

The initial live failure came from Workers rejecting `redirect: 'error'`;
provider requests now use `manual` and explicitly reject 3xx. After uploads,
confirm the deployed version in a live `/health` invocation log before consuming
an email test attempt: the previous version can briefly remain at the edge.
Health alone does not prove provider delivery, and receiving an email alone
does not prove its recipient completed account verification.

## Dashboard setup (operator steps; not run by these files)

1. In Cloudflare **Storage & databases → D1**, create a dedicated database,
   **`blakeout-email-limits`**. In its SQL console, execute `schema.sql`.
2. On the **existing** Worker, add a D1 binding named **`EMAIL_LIMITS`**, selecting
   that database. Do not share it with production email traffic.
3. Preserve the existing encrypted secrets **`RESEND_API_KEY`** and
   **`FIREBASE_SERVICE_ACCOUNT`**. The latter is the full service-account JSON;
   never paste either secret into source code, tickets, browser scripts, or logs.
   The account must be
   `blakeout-dev-email@blakeout.iam.gserviceaccount.com` in project `blakeout`,
   with only `firebaseauth.users.get` and `firebaseauth.users.sendEmail`.
4. Paste the entire `worker.js` into the Worker's JavaScript module editor.
   Use a current Worker compatibility date (WebCrypto, fetch, and
   `AbortSignal.timeout` are required). Save/deploy only when approved.
5. Firebase Authentication must have Email/Password enabled,
   `blakeoutdarts.com` authorized, and its email action handler left at
   `https://blakeout.firebaseapp.com/__/auth/action`. The Worker fixes
   `continueUrl` and the Google API `Referer` to
   `https://blakeoutdarts.com/dev/accounts/`; callers cannot override them.
   If the project's API key has website restrictions, ensure that live referrer
   and the default hosted Firebase action-handler origin are permitted as
   appropriate for Firebase's hosted handler. Do not loosen API restrictions
   globally or replace the hosted handler with an unimplemented dev page.
6. `GET /health` is safe to check without sending email. It returns
   HTTP 200 `{"status":"ready"}` only after validating the Resend key's local
   syntax, the service-account JSON and pinned identity, importing its RSA private
   key, and querying the required D1 schema. Any failure returns only HTTP 503
   `{"status":"not-ready"}`. It never calls Google or Resend, so readiness does
   **not** prove that credentials are unrevoked, IAM is correct, or delivery works.

No DNS changes are needed: `blakeoutdarts.com` already has verified Resend
SPF/DKIM and DMARC quarantine. The sender is exactly
`BlakeOut <noreply@blakeoutdarts.com>`; replies go to the existing
`DartsBlakeOut@gmail.com`. HTML uses the existing dev logo; a plain-text
alternative is always supplied.

## HTTP contract

The only browser origin allowed is **`https://blakeoutdarts.com`**, with no
credentials CORS flag. Requests without an Origin are allowed, but Origin is
never authentication. Cloudflare must supply `CF-Connecting-IP`; missing or
malformed addresses fail closed. Do not expose an alternate origin server or a
proxy that lets callers spoof that header.

| Route | Request | Success |
| --- | --- | --- |
| `GET /health` | No body/auth | `{"status":"ready"}`; nonready is HTTP 503 `{"status":"not-ready"}` |
| `POST /verify-email` | `Content-Type: application/json`, body `{}`, `Authorization: Bearer <Firebase ID token>` | `{"status":"sent"}` only after Resend acceptance |
| `POST /reset-password` | `Content-Type: application/json`, body `{"email":"user@example.com"}`; no auth required | `{"status":"accepted"}` for existing, absent, disabled, passwordless, or account-throttled recipients |

Successful preflight: `OPTIONS` on either POST route, with the allowed Origin,
`Access-Control-Request-Method: POST`, and only `authorization`/`content-type`
requested headers. Other methods, paths, query strings, unexpected JSON fields,
non-object JSON, non-UTF-8 input, and bodies over 1,024 bytes are rejected.
Email input supports ordinary ASCII mailbox syntax (not quoted/Unicode addresses).

Errors (except the readiness response above) have only
`{"error":{"code":"fixed/namespaced-code","message":"safe display text"}}`.
Messages are fixed local text, never provider error messages:

- `400 auth/invalid-email` or `email/invalid-request`; `413`/`415 email/invalid-request`
- `401 auth/requires-recent-login` (bad, expired, revoked, wrong-project, anonymous,
  non-password-sign-in ID tokens, or changed/disabled/non-password accounts)
- `403 email/origin-not-allowed` or `email/invalid-request`
- `404 email/not-found`, `405 email/method-not-allowed`
- `409 auth/email-already-verified` (authoritative verification record; no send)
- `429 email/rate-limited` for IP/global limits or verification account limits;
  includes `Retry-After: 60`, exposed to the allowed browser origin. This is an
  advisory minimum retry delay, not a promise that hourly/daily/monthly quotas
  will have reset.
- `502 email/unavailable` for provider failures
- `503 email/unavailable` for configuration/runtime failures

Reset success does not confirm existence or delivery. Account-level throttling
is intentionally also `accepted`; IP/global exhaustion is always `429`,
independent of existence. Provider failures remain visible as generic errors;
this is not a constant-time endpoint and does not promise timing-side-channel
resistance. Network retries are not automatic and may consume additional quota.
Resend acceptance is not an inbox-delivery guarantee.

## Security and free-tier limits

Verification checks the Firebase RSA signature, issuer, audience, token times,
password sign-in provider, and project. Every verification performs an uncached
privileged `accounts:lookup` by UID, checking disabled state, current email,
password provider, and `auth_time >= validSince` (revocation). It never marks
an account verified. Reset looks up the normalized address before generating a
link; unknown/unusable accounts do not receive email.

Google OAuth uses a native-WebCrypto signed service-account JWT and the
`cloud-platform` scope required by the project `sendOobCode` REST endpoint.
Scopes do not grant extra IAM permissions. Both privileged calls use fixed
project URLs. `returnOobLink:true` generates the Firebase action without asking
Firebase to email it. Returned links are validated against the fixed hosted
handler, expected action, and continuation before being included in Resend HTML
and text. Caller-supplied senders, content, redirect URLs, and email recipients
for verification are not accepted.

OAuth and public signing-key caches are single-entry, bounded to at most one
hour, with concurrent requests coalesced. Public-key refresh honors Google's
max-age up to that bound. An unknown key ID fails closed until refresh.
No request, recipient, action link, ID token, credential, or provider body is
logged or returned by this Worker. Failed server operations emit only a
sanitized console diagnostic containing a fixed stage, numeric upstream HTTP
status (or `0` when unavailable), and an allowlisted reason. Keep dashboard
request-body/header logging and third-party tracing disabled. Resend/Firebase
necessarily process recipients and authentication actions.

## Diagnosing a generic provider failure

Health does not test OAuth, IAM, Firebase action configuration, or Resend sending.
A ready Worker can therefore still return `502 email/unavailable`. Repaste the
updated **entire `worker.js`** into the existing Worker to enable sanitized
diagnostics. No schema, binding, frontend, credential, IAM, or DNS changes are
needed merely to add these diagnostics.

For a subsequently **explicitly approved** email attempt, inspect only the
Worker's console diagnostic, for example:

```json
{"stage":"generate_link","httpStatus":403,"reason":"IAM_PERMISSION_DENIED"}
```

Do not repeat sends just to investigate, export full request events, expose
Authorization headers, paste service-account JSON, or share provider response
bodies. The failed request made before this diagnostic code was deployed cannot
be retrospectively assigned a stage from its generic HTTP response.

| Stage / safe reason | What to check without sending another email |
| --- | --- |
| `oauth` / `invalid_grant` or `invalid_client` | Service-account key/account status and clock; local health cannot confirm Google still accepts the key. Do not disclose the key. |
| `account_lookup` / `IAM_PERMISSION_DENIED` or `PERMISSION_DENIED` | Existing account's role binding on **blakeout**, specifically `firebaseauth.users.get`. Do not grant broad admin roles. |
| `generate_link` / permission reasons | Existing `firebaseauth.users.sendEmail` permission and project binding. |
| Google stages / `SERVICE_DISABLED` or `ACCESS_TOKEN_SCOPE_INSUFFICIENT` | Identity Toolkit API enablement or deployed OAuth scope. Source uses the documented `cloud-platform` scope; scope alone never grants IAM access. |
| `generate_link` / `UNAUTHORIZED_DOMAIN` or `INVALID_CONTINUE_URI` | Firebase's authorized domain and fixed `https://blakeoutdarts.com/dev/accounts/` continuation. |
| `validate_link` / `unexpected_handler` or `unexpected_continue_url` | Firebase Authentication email-template action-handler configuration. It must remain `https://blakeout.firebaseapp.com/__/auth/action`; the Worker does not substitute an arbitrary handler or log the generated link. |
| `resend` / `validation_error` with 403 | Verified sender domain belongs to the same Resend account as the key, and that key can send from it. Never log the provider's explanatory message, which may contain addresses. |
| `resend` / `restricted_api_key`, `suspended_api_key`, or `invalid_permission` | Key status and sending/domain permissions in Resend. Sending-only access is sufficient; do not expand to full access for this Worker. |
| `resend` / quota or rate-limit reasons | Account-wide free-tier usage and other applications sharing that account. No automatic retries or paid upgrade are authorized. |
| Any stage / `network_error`, `invalid_json`, or `invalid_response` | Transport failure or incompatible provider response. The log contains neither response text nor exception details. |
| Any stage / `redirect_rejected` with 3xx | The provider returned a redirect. The Worker rejects it before body parsing and never follows or logs its destination. |

Other reason strings fall back to `unclassified_provider_error`; unsupported
exceptions become `runtime / 0 / backend_failure`. No success/account-existence
events are logged, and the browser error contract remains unchanged.

The request contract was checked against Google's public v1 discovery document
and Resend's raw HTTP API: both Google project endpoints use `POST` and the
`cloud-platform` scope; `returnOobLink:true` supports email-based generation
without an `idToken`, and returns `oobLink`. Resend accepts string-array `to`,
raw-API `reply_to`, `html`, and `text`. No confirmed request-payload incompatibility
was found from the generic 502 alone; provider/stage evidence is needed before
changing configuration or loosening validation.

Provider fetches use `redirect: "manual"` and explicitly reject **all 3xx**
responses before parsing. Cloudflare's official
[workerd runtime source](https://github.com/cloudflare/workerd/blob/main/src/workerd/api/http.c++)
(`Request::tryParseRedirect`) accepts only `follow` and `manual`, and its
constructor explicitly rejects `error`. This differs from the Request API
reference listing all three. The previous `redirect: "error"` could therefore
throw locally before reaching OAuth, producing `oauth / 0 / network_error`.
The fix preserves fail-closed redirects for every provider without forwarding
credentials, retrying requests, or changing the client contract.

**D1 is mandatory.** Each reservation uses one atomic SQLite write with
materialized eligibility and `INSERT ... ON CONFLICT`, not read-then-write.
All counters within that reservation increment together or not at all:

| Scope | Limits |
| --- | --- |
| IP | 10 attempts/hour, 25/day |
| Normalized email, shared across both routes | 60-second cooldown, 3/hour, 5/day |
| This Worker globally | 80 attempts/UTC day, 2,400/calendar UTC month |

IP/global quotas are reserved before authentication/account lookup. Invalid
tokens, absent-account resets, account-cooldown retries, and provider failures
consume those quotas. Malformed requests/CORS/preflight/health do not.
Account quotas are reserved before reset lookup, and after authoritative
verification lookup. Global attempt limits conservatively bound actual sends;
there are no email retries after a reservation. Each stage fails closed even
if a preceding stage consumed quota.

Counters contain SHA-256 hashes, not raw IPs/emails; unsalted hashes are **not**
anonymous and should be access-controlled. Expired counters are reused. Optional
maintenance in the D1 console can remove expired rows:

```sql
DELETE FROM email_limits WHERE expires <= unixepoch();
```

Do not clear active counters or replace the database mid-window: that would reset
the budget. These caps leave room under Resend's stated free 100/day, 3,000/month,
but cannot account for other senders using the same Resend account. Keep other
traffic inside the remaining allowance. No paid plan or automatic upgrade is
authorized. Public resets can exhaust the deliberately conservative budget;
WAF/Turnstile would be an additional separately coordinated control.

## Offline validation

From the repository root:

```sh
/home/md/Documents/Darts/.venv/bin/python dev/tests/email_worker_test.py
```

Tests use existing Python/Playwright/Chrome, fresh fake RSA issuer/service-account
keys, mocked fixed Google/Resend endpoints, and real Python SQLite behind a mocked
D1 binding. They exercise actual Worker JavaScript and concurrent reservations
from independent SQLite connections. Browser network is restricted to the local
test server. Runtime files stay in a project-local directory and are removed.
No real secrets, production users, external sends, or Cloudflare writes are used.

References: [sendOobCode](https://cloud.google.com/identity-platform/docs/reference/rest/v1/projects.accounts/sendOobCode),
[lookup](https://cloud.google.com/identity-platform/docs/reference/rest/v1/projects.accounts/lookup),
[Resend send-email API](https://resend.com/docs/api-reference/emails/send-email),
[Resend errors](https://resend.com/docs/api-reference/errors),
[Firebase ID-token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens),
[D1 SQL](https://developers.cloudflare.com/d1/sql-api/sql-statements/).
