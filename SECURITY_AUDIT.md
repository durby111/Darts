# BlakeOut — Security Audit

**Date:** 2026-07-26
**Scope:** production root (`durby111.github.io/Darts/`) and `dev/`, at commit `c358145`.
**Method:** source review of `js/`, `sw.js`, `index.html`, plus live verification
against the Firebase project `blakeout` using the public web config.

Findings apply to **both** dev and production unless noted — the two builds share
one Firebase project and the same client code.

---

## Summary

| # | Severity | Finding | Blocked on |
|---|----------|---------|------------|
| 1 | 🔴 High | Roster is world-readable / writable / deletable by any anonymous user | Product decision |
| 2 | 🔴 High | Stored XSS — unescaped player names in the winner modal | Nothing (mechanical) |
| 3 | 🟠 Medium | Firebase API key has no HTTP referrer restriction | Nothing (console only) |
| 4 | 🟠 Medium | No Content-Security-Policy | Needs iteration + broad testing |
| 5 | 🟡 Low | Service worker caches all cross-origin GET responses | Nothing (small) |
| 6 | ℹ️ Info | Identity is self-asserted | Accepted tradeoff — no action |

Clean: no `eval`, no `new Function`, no `document.write`, no `srcdoc`; every
`target="_blank"` already carries `rel="noopener"`; no secrets in the client
beyond the intentionally-public Firebase web config.

---

## 1. 🔴 Roster is world-readable, writable and deletable

**Where:** published Firestore rules, `match /roster/{email}`.

The rule gates every operation on `request.auth != null`. That is **not a trust
boundary in this app**: anonymous sign-in is enabled and the web API key is
public, so anyone can mint a token and satisfy it.

**Verified live (2026-07-26):** from a machine with no referrer, an anonymous
token was minted against the project and the full roster was read back
(2 documents). Read-only — nothing was written or deleted.

**Impact**
- **PII disclosure** — every player's name and email is readable by anyone on
  the internet. Email is the canonical player ID in this app.
- **Destructive** — `allow delete: if request.auth != null` has no ownership
  check, so any anonymous caller can delete any roster entry.
- **Delivery vector for finding #2** — the only write constraint is that `name`
  is a non-empty string, so an attacker can plant markup as a player name.

**Remediation**
Anonymous auth cannot distinguish "our players" from "the internet", so the
realistic mitigations are:
- Remove open `delete`, or require the deleting client to prove ownership.
- Constrain `update` so a caller can only touch a record it created.
- Constrain `name` to a sane length and character set (also blunts #2).
- Consider whether emails need to live in a world-readable collection at all.

**Decision needed:** locking reads to non-anonymous users would break the app as
designed (the roster is meant to sync silently across devices). Tightening
reads therefore requires a product call, not just a rules edit.

---

## 2. 🔴 Stored XSS in the winner modal

**Where:** `js/ui.js` — the only module with no `escapeHtml` helper.

Two `innerHTML` sinks interpolate player names directly:

- `showWinner()` — Chicago match win: `${name}` and `${scoreText}` (built from `p.name`)
- `show121MatchSummary()` — `${winner.name}` and every `p.name`

Every other module escapes correctly (`picker.js`, `setup.js`, `teams.js`,
`game121.js`, `doubledown.js`, `teamcricket.js`). The normal win path uses
`textContent` and is safe — only the Chicago and 121 paths are affected.

**Impact**
Chained with finding #1 this is **remotely exploitable, not self-inflicted**: an
attacker writes a roster entry named `<img src=x onerror=...>`, it syncs to every
device through the `onSnapshot` listener, and executes when that player wins a
Chicago or 121 match. The payload then has access to `localStorage` and the
active Firestore session.

**Remediation**
Add an `escapeHtml` helper to `ui.js` and escape both sinks. Isolated to one
file; no behaviour change. Regression test: a player named `<img onerror>`
must render as literal text.

---

## 3. 🟠 Firebase API key has no referrer restriction

**Verified:** a token request with no `Referer` header succeeded, so the browser
key is unrestricted.

**Impact:** anyone can mint anonymous accounts against the project — auth-list
pollution and Spark-tier quota abuse.

**Remediation:** Firebase Console → Project Settings → API keys → HTTP referrer
allowlist (`durby111.github.io/*` covers prod and dev). Console-only, no code.
Note this raises the bar but is not an authentication control.

---

## 4. 🟠 No Content-Security-Policy

No CSP meta tag in `index.html`.

A CSP would **not** have prevented finding #2 (an injected `onerror` attribute
runs under most practical policies) but it limits exfiltration after a
compromise.

**Remediation:** non-trivial here — the policy must allow the Firebase SDK from
`gstatic.com`, Firestore/identitytoolkit endpoints, inline styles used
throughout, and `data:` URLs for custom wallpapers. Expect iteration, and it
needs testing across all 29 games plus the offline path, since a wrong directive
fails closed.

---

## 5. 🟡 Service worker caches all cross-origin GETs

**Where:** `sw.js` fetch handler — caches *every* successful GET, including
third-party responses, into Cache Storage.

**Impact:** low. Bloats storage and persists third-party responses on shared
devices longer than necessary.

**Remediation:** scope the `cache.put` to same-origin requests plus the gstatic
SDK. One conditional; re-verify the offline path afterwards.

---

## 6. ℹ️ Identity is self-asserted

Whoever types an email is treated as that player — no password, PIN or magic
link. Already documented in `CLAUDE.md` as a deliberate tradeoff for casual bar
play. **No action** unless stats ever need to be tamper-proof.

---

## Suggested order

1. **#2 (XSS)** — mechanical, isolated, no decisions, and it defuses the worst
   consequence of #1.
2. **#1 (rules)** — biggest real exposure. The rules edit is small; the product
   decision about read/delete access is the actual work.
3. **#3 (API key)** — console-only, quick win.
4. **#5 (SW caching)** — small cleanup.
5. **#4 (CSP)** — largest and least certain; do it last, when nothing else is
   in flight.

## Related pending item

The `/usage` monthly-counter rules (see `CLAUDE.md`) are **still unpublished**,
so the telemetry counter records nothing. Not a security issue, but it lives in
the same rules file and is worth doing in the same sitting.
