# Startup warning and simple scoring — DEV

This implementation is DEV only. It has not been tested on the reported
old iPad or Galaxy tablet. No browser-version minimum is claimed. Exact device,
OS, browser and normal-tab/Home-Screen details are still needed.

## Startup warning

The static notice and inline ES5-style script run independently of the modern
module graph. JavaScript-disabled clients retain a static explanation. Probes
check modules and APIs used by current scoring (including Array.at,
Object.hasOwn and crypto.randomUUID). Missing capabilities get a capability
warning; failed module loads, parse errors and caught initialization errors get
a generic failure message. A 12-second delay is explicitly not a diagnosis of
an unsupported browser. Late successful initialization hides that notice.
No reload, cache deletion, storage write or automatic navigation is performed.

The guard cannot report an HTTPS/TLS or certificate failure that prevents the
HTML from reaching the device. Feature probes are not full compatibility proof.
No security setting or browser protection should be weakened to load this app.

## Simple scoring

`compat/index.html` is self-contained HTML/CSS/classic JavaScript; no modules,
framework, font/CDN, Firebase, account, bot or network dependency is needed after
the page loads. It offers 301/501 and Minnesota, one to four players, turn totals, straight out
or explicitly confirmed double out, bust, undo (including a winning turn), and
confirmed replacement. No standalone standard Cricket, double-in, teams, tournament or account
history support is claimed. Totals trust the scorer rather than reconstructing
dart combinations. Unlike modern total-entry's trust-based zero checkout,
simple double-out mode explicitly asks whether the last dart was a double and
treats leaving one as a bust. This is visible in its finish selector and label.

Minnesota follows the authoritative `js/state.js` target definitions and
`js/cricket.js` scoring: 20 through 15, Bull, Triples, Doubles and Bed; three marks
close each row. Number/Bull excess marks score while opponents remain open.
Special rows take one mark per qualifying dart/Bed and actual points once closed;
the qualifying values follow the existing recorded-scorer validation. A Bed uses
the whole three-dart turn. Normal scoring adds points to the scorer; Cutthroat
penalizes each open opponent and needs at least two players. Closing every row
and tying or beating all opponents wins. Miss replaces X01's bust action.
Pending darts are saved, and undo reverses individual darts or a turn confirmation.
This preview ends at the first winner: optional placement continuation, teams,
statistics and scoring without points are not included.

Scores use only `blakeout_dev_simple_game_v1`; there is no modern-save import,
migration or overwrite. Invalid saves remain stored until explicit replacement.
Storage failure leaves the current game usable in memory with a warning. Losing
or closing that page can then lose its simple-mode game. No cross-tab concurrency
is promised; use one simple-mode scoring tab per device.

Implementation uses ES5 syntax, JSON, basic DOM events and textContent, with
ordinary block layout and 48px controls. Engine tests remove modern APIs from
the VM before scoring. This is a smaller compatibility surface, not proof of a
specific Safari/Android version. Real devices must also negotiate the site's
HTTPS connection. First loading needs the site; old browsers without service
workers do not gain guaranteed offline reopening. The DEV worker precaches the
page for browsers supporting it; its existing activation policy is unchanged.

## Validation

`node dev/tests/startup_compat_test.mjs` uses installed Playwright/Chromium;
set BLAKEOUT_PLAYWRIGHT_MODULE and BLAKEOUT_CHROMIUM when not normally resolved.
BLAKEOUT_QA_OUTPUT optionally saves screenshots outside application assets.
All page resources come from local files in an isolated context; external traffic
is blocked. Tests cover static/disabled-JS fallback, capability failures, missing
and malformed modules, slow/late startup, blocked/corrupt storage, scoring,
rotation, checkout, undo, repeated input, cancel/reset, reload, narrow layout,
text safety and preservation of modern saves. Screenshots were visually reviewed.
An optional BLAKEOUT_ACORN_MODULE enables an ES5 grammar audit; no parser is
installed here, so that additional audit was not run. No dependency installed.

Minnesota has pure-engine closure, excess-score, special-row, Bed, dart-limit,
winning/tied-score, undo and serialization tests. Rendered tests exercise pending
save/reload and correction, and compare ten normal/Cutthroat scoring fixtures
directly with the existing modern scorer. Legacy capability simulations are not
physical Safari/Android validation.

Release procedure: review the exact DEV diff and retain test evidence before
the authorized GitHub/DEV publication. Do not promote the full DEV tree to
production. This release's worker cache is v81. Deployment status must be
verified separately against the exact merged commit and live bytes.
