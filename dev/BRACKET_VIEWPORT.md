# Dynamic bracket view (DEV draft)

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
  feature-unlock mechanism. Prepared DEV SW v58 precaches the new view module.

## Verified locally

Run from the repository root with an existing JSDOM installation:

```sh
BLAKEOUT_JSDOM_MODULE=/path/to/jsdom \
node --experimental-vm-modules dev/tests/bracket_viewport_test.mjs
```

Thirteen interaction groups pass: full graph bounds; phone/landscape resize;
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

## Rendered-browser gate (not passed yet)

The existing browser suite now checks full-height Fit as well as width. A new
`viewport_pan_zoom` case covers actual mouse drag, touch pinch via Chromium input,
refresh persistence, four viewport sizes and eight light/dark/style combinations:

```sh
python dev/tests/brackets_ui_test.py --only spectator_and_layout
python dev/tests/brackets_ui_test.py --only viewport_pan_zoom
```

This runtime can serve the local fixtures, but Chromium cannot launch: its
process singleton socket is denied with `Operation not permitted`. The supported
escalation retry produced the same failure. Browser assertions never ran.

Before release, use a supported browser environment to run those tests and
inspect the sample preview. Check the 32-team overview and both sides at phone
portrait/landscape, tablet and desktop sizes; all four styles with Arctic and a
dark theme; drag starting over score/source controls; pinch then one-finger pan;
source jumps and keyboard Tab; resize and live refresh; empty/recovery; and
browser Back/Forward or scenario reload. Confirm a real mobile/tablet pinch
separately from emulated input. Keep this draft unpublished until review.
