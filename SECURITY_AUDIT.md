# BlakeOut — Security Audit

**Date:** 2026-07-26
**Scope:** production root (`durby111.github.io/Darts/`) and `dev/`, at commit `c358145`.
**Method:** source review of `js/`, `sw.js`, `index.html`, plus live verification
against the Firebase project `blakeout` using the public web config.

Findings apply to **both** dev and production unless noted — the two builds share
one Firebase project and the same client code.

---

## Summary

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 1 | 🔴 High | Roster is world-readable / writable / deletable by any anonymous user | ✅ **Fixed** 2026-07-26 (private rosters) — *rules must be published* |
| 2 | 🔴 High | Stored XSS — unescaped player names in the winner modal | ✅ **Fixed** 2026-07-26 (`ui.js`, dev + prod) |
| 3 | 🟠 Medium | Firebase API key has no HTTP referrer restriction | **Open** — console-only, owner action |
| 4 | 🟠 Medium | No Content-Security-Policy | **Deferred** by owner |
| 5 | 🟡 Low | Service worker caches all cross-origin GET responses | ✅ **Fixed** 2026-07-26 (`sw.js`, dev + prod) |
| 6 | ℹ️ Info | Identity is self-asserted | Accepted tradeoff — no action |

Clean: no `eval`, no `new Function`, no `document.write`, no `srcdoc`; every
`target="_blank"` already carries `rel="noopener"`; no secrets in the client
beyond the intentionally-public Firebase web config.

---

## 1. 🔴 Roster is world-readable, writable and deletable — ✅ FIXED 2026-07-26

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

**Resolution (2026-07-26, dev + production).** Owner decisions: emails are
load-bearing (cross-device identity + planned emailing), the app is public, and
"each roster should be private to that user", with link-sharing acceptable.

The single global `roster` collection was therefore replaced with **private
per-install rosters**:

```
rosters/{rosterId}/players/{playerId}      rosterId = 128 random bits
```

- `rosterId` lives in `localStorage['blakeout_roster_id']`, minted on first use.
- `/rosters` is never listed, and collection-group queries on `players` are
  refused because those need a recursive-wildcard rule we deliberately omit.
  A roster is reachable only by someone who already knows its id.
- Sharing is opt-in via *Manage Players → Share roster* (`?roster=<id>`), which
  adopts the roster then strips the id from the address bar. Malformed ids are
  rejected rather than used as a path segment.
- Names are capped at 40 chars client-side and in rules; writes are restricted
  to exactly `email`/`name`/`updatedAt`.
- The old `roster` collection is locked shut in rules.

Covered by `test_private_roster_scoping` (id shape, stability, per-device
uniqueness, share-link adoption, URL scrubbing, hostile-id rejection).

> ⚠️ **Residual risk — capability-link security.** Anyone holding a roster link
> has full read/write/delete on that roster, like an unlisted video URL. This
> is the strongest model that preserves zero-friction anonymous use; real
> per-account isolation would require non-anonymous sign-in. Accepted by owner.
>
> ⚠️ **Action required:** the code is deployed but the exposure is not closed
> until the updated rules in `CLAUDE.md` are published. Until then the old
> global `roster` collection remains world-readable.

---

## 2. 🔴 Stored XSS in the winner modal — ✅ FIXED 2026-07-26

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

**Resolution (2026-07-26, dev + production):** `escapeHtml` added to `ui.js`;
both sinks now escape the name, the Chicago score line and every 121 leg row.
Covered by `test_player_name_xss`, which drives both summaries with an
`<img src=x onerror=...>` name and asserts the handler never fires, no `<img>`
element is created, the markup is escaped, and the name still reads correctly
as text. **Verified exploitable before the fix** — against the previous `ui.js`
the test failed with "injected handler executed", i.e. the payload really did
run.

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

## 5. 🟡 Service worker caches all cross-origin GETs — ✅ FIXED 2026-07-26

**Where:** `sw.js` fetch handler — caches *every* successful GET, including
third-party responses, into Cache Storage.

**Impact:** low. Bloats storage and persists third-party responses on shared
devices longer than necessary.

**Remediation:** scope the `cache.put` to same-origin requests plus the gstatic
SDK. One conditional; re-verify the offline path afterwards.

**Resolution (2026-07-26, dev + production):** added an `isCacheable()` gate —
same-origin, plus `https://www.gstatic.com/firebasejs/` so the SDK stays
available offline. Firestore and identitytoolkit responses are no longer
cached. Covered by `test_sw_caches_only_own_assets`, which evaluates the real
predicate out of `sw.js` against sample URLs.

---

## 6. ℹ️ Identity is self-asserted

Whoever types an email is treated as that player — no password, PIN or magic
link. Already documented in `CLAUDE.md` as a deliberate tradeoff for casual bar
play. **No action** unless stats ever need to be tamper-proof.

---

## Suggested order

1. ~~**#2 (XSS)**~~ — ✅ done 2026-07-26.
2. ~~**#1 (roster privacy)**~~ — ✅ code done 2026-07-26; **rules still to be published**.
3. **#3 (API key)** — console-only, quick win.
4. ~~**#5 (SW caching)**~~ — ✅ done 2026-07-26.
5. **#4 (CSP)** — deferred by owner; largest and least certain.

## Related pending item

The `/usage` monthly-counter rules (see `CLAUDE.md`) are **still unpublished**,
so the telemetry counter records nothing. Not a security issue, but it lives in
the same rules file and is worth doing in the same sitting.
