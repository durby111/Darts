# Dynamic bracket view (DEV)

## Scope

This changes the shared DEV bracket template and view renderer only. The
memory-only `/dev/preview/brackets/` imports that same implementation. Real
feature gates remain closed. No production runtime files, Firebase settings,
records, roster rules, scoring rules, or preview network boundary changed.

## Controls and behavior

- New events default to **Fit entire bracket**, constrained by both available
  width and height. The 32-team, 63-match graph fits as an overview.
- + / − buttons, percentage presets (25–200%), a **100%** reset, and **Fit
  bracket** are always outside the scaled canvas. Continuous gestures allow up
  to 250%, with a minimum low enough to fit the entire current graph.
- Drag with a mouse, pen, or finger to move the bracket. Two fingers pinch and
  pan. The host takes pointer capture after drag intent; implicit capture loss
  from a child must not cancel the transfer. Cancel, blur, and page exit clean up.
- Plain wheel/touchpad scrolling remains native. Ctrl or Command plus wheel
  zooms about the cursor. Pinch tracks its midpoint. Buttons zoom about center.
- Focus the diagram for arrow-key pan, + / − zoom, 0 to fit, and 1 for 100%.
  Left/right toolbar buttons provide an additional non-drag alternative.
- Native scroll extents bound the canvas. Small canvases center; larger canvases
  scroll. The fixed responsive viewing area prevents a width-only fit from
  extending thousands of pixels down the page.
- Resize refits an overview; manually chosen zoom remains stable. Same-event
  polling/redraws retain the world point at the viewport center and keyboard
  focus. Changing events returns to Fit.
- Source jumps reveal and focus the connected match at readable size. Keyboard
  focus also reveals clipped controls. Pointer focus does not zoom before drag
  intent. A gesture cannot accidentally activate a score/source button on release.
- All controls inherit existing theme/style tokens and focus styles, with
  44-pixel minimum toolbar targets. No animated movement is introduced.
- The state is transient: no new storage, provider calls, dependencies, or
  feature-unlock mechanism. DEV SW v59 refreshes the viewport module after the fractional-pan correction.

## Verified locally

Run from the repository root with an existing JSDOM installation:

```sh
BLAKEOUT_JSDOM_MODULE=/path/to/jsdom \
node --experimental-vm-modules dev/tests/bracket_viewport_test.mjs
```

Fifteen interaction groups pass, including rounded-scroll fractional drag, reverse/repeated gestures, edge recovery and native-scroll resynchronization, plus: full graph bounds; phone/landscape resize;
zoom limits and center anchors; two-axis drag and click suppression; click
threshold/cancel/blur; pinch and single-finger continuation; child implicit
capture transfer; cursor-anchored wheel; keyboard/buttons; redraw/event switch;
source jumps; keyboard focus/pointer-focus stability; and empty/recovery states.
The suite imports the actual renderer, engine and controller. Layout metrics,
scroll bounds and pointer-capture effects are explicit test doubles. It is not
rendered-browser, physical-touch, assistive-device, or browser-CSP evidence.

All fourteen existing source/VM/DOM regression suites also pass: account
ownership, appearance, shell cascade, availability, recording gates, build
isolation, Dot Better, winner structure, production audit, shared dialog,
bracket confirmations, preview isolation, Start & Lock, and the correction
core (219 tests). JS syntax, Python test syntax and whitespace checks pass.

## Browser verification and remaining limits (October 10)

The authorized DEV publication uses the existing sample preview; real feature
and production gates remain unchanged. Chromium 151 now runs in the publication
workspace. The earlier draft workspace's socket restriction no longer applies.

The original `viewport_pan_zoom` test initially failed: eight 12.5px horizontal
pointer increments scrolled 104px rather than 100px because incremental writes
read back browser-rounded scroll positions. The controller now retains the
fractional target internally, clamps it to actual scroll bounds, and resets its
baseline after native scrolling, new gestures and layout changes. DEV SW v59
refreshes the corrected module. The original test and its tolerances are unchanged.

Verification of the correction:

- All 15 source/VM/DOM suites pass, including 15 viewport interaction groups.
- Full `python dev/tests/brackets_ui_test.py`: **23/24 passed**.
- Original `viewport_pan_zoom` passes: mouse drag, emulated touch pinch,
  refresh persistence, four viewport sizes and eight appearance combinations.
- New `viewport_fractional_drag` passes: fractional movement on both axes,
  within-gesture reversal, three repeated gestures, opposite-direction drag,
  edge overshoot/reversal, and no accidental result action.
- `spectator_and_layout` passes, including full-height and full-width Fit.
- The sole failure, `start_feedback`, is reproduced on the previously deployed
  `ce61dfb` commit. Its setup `page.evaluate` returns the assigned throwing
  `window.confirm` function, which Playwright invokes; the UI assertions do not
  run. This pre-existing test setup issue is outside the pan correction.

These browser checks use local mocked tournament/provider data. Physical phone
or tablet touch, assistive-device behavior, and live-provider behavior are not
verified. Direct live-site retrieval is blocked in the publication workspace by
proxy HTTP 403 / `ERR_TUNNEL_CONNECTION_FAILED`; GitHub Pages deployment status
is checked separately. Mike will perform physical touch testing on the DEV
sample bracket. No production-readiness claim is made.
