/** Actual viewport/diagram modules in JSDOM, with explicit geometry/scroll mocks.
 * These assertions exercise interaction math and DOM integration, not rendered pixels.
 * BLAKEOUT_JSDOM_MODULE=/path/to/jsdom node --experimental-vm-modules dev/tests/bracket_viewport_test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { JSDOM } = require(process.env.BLAKEOUT_JSDOM_MODULE || 'jsdom');
const root = fileURLToPath(new URL('../', import.meta.url));
let passed = 0;
const near = (a, b, label) => assert.ok(Math.abs(a - b) < .001, `${label}: ${a} ~= ${b}`);
async function fresh(count = 32) {
    const dom = new JSDOM('<body></body>', { pretendToBeVisual: true, runScripts: 'outside-only' });
    const w = dom.window, d = w.document, observers = [];
    Object.assign(w, { structuredClone, ResizeObserver: class { constructor(callback) { observers.push(callback); } observe() {} } });
    const template = d.createElement('template');
    template.innerHTML = fs.readFileSync(path.join(root, 'brackets/index.html'), 'utf8');
    d.body.append(template.content.querySelector('#featureTemplate')?.content.cloneNode(true) || template.content.querySelector('template').content.cloneNode(true));
    d.querySelector('#tournament').hidden = false;
    const host = d.querySelector('#diagram');
    const box = { width: 900, height: 600, left: 25, top: 50 }, scroll = { left: 0, top: 0 };
    for (const axis of ['width', 'height']) Object.defineProperty(host, `client${axis[0].toUpperCase() + axis.slice(1)}`, { get: () => box[axis] });
    const extent = axis => parseFloat(host.querySelector('.diagram-spacer')?.style[axis]) || 0;
    for (const [property, axis, dimension] of [['scrollLeft', 'left', 'width'], ['scrollTop', 'top', 'height']]) {
        Object.defineProperty(host, property, { get: () => scroll[axis], set: value => { scroll[axis] = Math.max(0, Math.min(value, extent(dimension) - box[dimension])); } });
    }
    const originalReplace = host.replaceChildren.bind(host);
    host.replaceChildren = (...children) => { originalReplace(...children); scroll.left = scroll.top = 0; };
    host.getBoundingClientRect = () => ({ ...box, right: box.left + box.width, bottom: box.top + box.height });
    const captures = new Set();
    host.setPointerCapture = id => captures.add(id);
    host.hasPointerCapture = id => captures.has(id);
    host.releasePointerCapture = id => captures.delete(id);
    w.HTMLElement.prototype.getBoundingClientRect = function () {
        const canvas = host.querySelector('.diagram-canvas');
        const scale = Number(host.dataset.zoom || 1);
        let x = parseFloat(this.style.left) || 0, y = parseFloat(this.style.top) || 0;
        if (this.closest('.match-card') !== this) {
            x += parseFloat(this.closest('.match-card')?.style.left) || 0;
            y += parseFloat(this.closest('.match-card')?.style.top) || 0;
        }
        const left = box.left + (parseFloat(canvas?.style.left) || 0) + x * scale - host.scrollLeft;
        const top = box.top + (parseFloat(canvas?.style.top) || 0) + y * scale - host.scrollTop;
        const width = (this.classList.contains('match-card') ? 280 : 100) * scale;
        const height = (this.classList.contains('match-card') ? 220 : 24) * scale;
        return { left, top, width, height, right: left + width, bottom: top + height };
    };
    const modules = new Map(), context = dom.getInternalVMContext();
    async function load(filename) {
        if (modules.has(filename)) return modules.get(filename);
        const module = new vm.SourceTextModule(fs.readFileSync(filename, 'utf8'), { context, identifier: filename });
        modules.set(filename, module);
        await module.link(specifier => load(path.resolve(path.dirname(filename), specifier)));
        return module;
    }
    const engineModule = await load(path.join(root, 'js/brackets/engine.js'));
    const diagramModule = await load(path.join(root, 'js/brackets/diagram.js'));
    await engineModule.evaluate(); await diagramModule.evaluate();
    const engine = engineModule.namespace, diagram = diagramModule.namespace;
    const controller = modules.get(path.join(root, 'js/brackets/viewport.js')).namespace.diagramViewport(host);
    const controls = { select: d.querySelector('#diagramScale'), zoomOut: d.querySelector('#diagramZoomOut'), zoomIn: d.querySelector('#diagramZoomIn'), fit: d.querySelector('#diagramFit'), reset: d.querySelector('#diagramReset'), label: d.querySelector('#diagramZoomLabel'), left: d.querySelector('#diagramPanLeft'), right: d.querySelector('#diagramPanRight') };
    controller.configure(controls);
    let tournament = engine.createTournament({ id: 'event', ownerId: 'owner', title: 'Test bracket', date: '2026-10-10', gameType: '501', bestOf: 3 });
    tournament = engine.saveRoster(tournament, Array.from({ length: count * 2 }, (_, i) => ({ id: `p${i}`, name: `Player ${i}`, tag: String(Math.floor(i / 2) + 1), paid: true, checkedIn: true, standby: false })));
    tournament = engine.startTournament(tournament);
    let selected = 0;
    const render = (item = tournament) => diagram.renderDiagram(host, item, { canScore: true, onSelect: () => selected++ });
    render();
    const pointer = (type, id, x, y, target = host, pointerType = 'mouse') => {
        const event = new w.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x + box.left, clientY: y + box.top, button: 0 });
        Object.defineProperties(event, { pointerId: { value: id }, pointerType: { value: pointerType } });
        target.dispatchEvent(event);
    };
    const resize = (width, height) => { Object.assign(box, { width, height }); observers.forEach(callback => callback()); };
    const zoom = () => Number(host.dataset.zoom);
    const world = (x, y) => ({ x: (host.scrollLeft + x - parseFloat(host.querySelector('.diagram-canvas').style.left)) / zoom(), y: (host.scrollTop + y - parseFloat(host.querySelector('.diagram-canvas').style.top)) / zoom() });
    return { dom, w, d, host, box, controls, controller, tournament, render, pointer, resize, zoom, world, selected: () => selected, captures };
}
async function test(name, fn) { const state = await fresh(); try { await fn(state); console.log(`PASS ${name}`); passed++; } finally { state.dom.window.close(); } }
await test('32-team Fit contains both dimensions and centers all 63 matches', ({ host, controls, zoom, box }) => {
    assert.equal(host.querySelectorAll('.match-card').length, 63);
    assert.equal(controls.select.value, 'fit'); assert.ok(zoom() < .1);
    const canvas = host.querySelector('.diagram-canvas');
    assert.ok(parseFloat(canvas.style.width) * zoom() <= box.width - 32 + .01);
    assert.ok(parseFloat(canvas.style.height) * zoom() <= box.height - 32 + .01);
    assert.equal(host.scrollLeft, 0); assert.equal(host.scrollTop, 0);
});
await test('Fit recomputes for phone/landscape and manual zoom remains bounded', ({ resize, controller, zoom, host, controls }) => {
    resize(310, 360); const portrait = zoom();
    resize(760, 260); assert.ok(zoom() < portrait);
    controller.zoomTo(1); host.scrollLeft = 800; host.scrollTop = 1000;
    resize(350, 500); assert.equal(zoom(), 1);
    controller.zoomTo(100); assert.equal(zoom(), 2.5); assert.equal(controls.zoomIn.disabled, true);
    controller.zoomTo(.00001); assert.ok(zoom() > .00001); assert.equal(controls.zoomOut.disabled, true);
});
await test('Zoom buttons preserve the viewport center, plus reset and Fit', ({ controls, host, world, zoom }) => {
    controls.reset.click(); host.scrollLeft = 600; host.scrollTop = 1100;
    const before = world(450, 300); controls.zoomIn.click(); const after = world(450, 300);
    assert.equal(zoom(), 1.25); near(before.x, after.x, 'center x'); near(before.y, after.y, 'center y');
    controls.zoomOut.click(); near(zoom(), 1, 'zoom back');
    controls.fit.click(); assert.equal(controls.select.value, 'fit'); assert.equal(host.scrollTop, 0);
});
await test('Pointer drag pans both axes, clamps bounds and suppresses match activation', ({ host, pointer, controller, selected, w, captures }) => {
    controller.zoomTo(1); host.scrollLeft = 600; host.scrollTop = 1000;
    const button = host.querySelector('.match-action');
    pointer('pointerdown', 1, 250, 200, button); pointer('pointermove', 1, 150, 100); pointer('pointerup', 1, 150, 100);
    near(host.scrollLeft, 700, 'drag x'); near(host.scrollTop, 1100, 'drag y'); assert.equal(captures.size, 0);
    button.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })); assert.equal(selected(), 0);
    button.click(); assert.equal(selected(), 1, 'keyboard/programmatic activation is not swallowed');
    pointer('pointerdown', 2, 200, 200); pointer('pointermove', 2, 100000, 100000); pointer('pointerup', 2, 100000, 100000);
    assert.equal(host.scrollLeft, 0); assert.equal(host.scrollTop, 0);
});
await test('A small movement is a click; pointercancel and blur release gestures', ({ host, pointer, w, selected, captures }) => {
    const button = host.querySelector('.match-action');
    pointer('pointerdown', 1, 50, 50, button); pointer('pointermove', 1, 52, 52); pointer('pointerup', 1, 52, 52);
    button.dispatchEvent(new w.MouseEvent('click', { bubbles: true, detail: 1 })); assert.equal(selected(), 1);
    pointer('pointerdown', 2, 50, 50); pointer('pointermove', 2, 100, 100); pointer('pointercancel', 2, 100, 100);
    assert.equal(host.classList.contains('is-panning'), false); assert.equal(captures.size, 0);
    pointer('pointerdown', 3, 50, 50); pointer('pointermove', 3, 100, 100); w.dispatchEvent(new w.Event('blur'));
    assert.equal(captures.size, 0); assert.equal(host.classList.contains('is-panning'), false);
});
await test('Two-finger pinch zooms, one remaining finger keeps panning', ({ controller, host, pointer, zoom }) => {
    controller.zoomTo(1); host.scrollLeft = 600; host.scrollTop = 1500;
    pointer('pointerdown', 1, 200, 200, host, 'touch'); pointer('pointerdown', 2, 400, 200, host, 'touch');
    pointer('pointermove', 2, 500, 200, host, 'touch'); near(zoom(), 1.5, 'pinch scale');
    pointer('pointerup', 2, 500, 200, host, 'touch'); const left = host.scrollLeft;
    pointer('pointermove', 1, 150, 200, host, 'touch'); near(host.scrollLeft, left + 50, 'continued pan');
    pointer('pointerup', 1, 150, 200, host, 'touch'); assert.equal(host.classList.contains('is-panning'), false);
});
await test('Child implicit-capture loss does not cancel touch pan or pinch transfer', ({ controller, host, pointer, zoom, captures }) => {
    controller.zoomTo(1); host.scrollLeft = 600; host.scrollTop = 1500;
    const child = host.querySelector('.match-action');
    pointer('pointerdown', 1, 200, 200, child, 'touch');
    pointer('pointermove', 1, 150, 200, child, 'touch');
    pointer('lostpointercapture', 1, 150, 200, child, 'touch');
    assert.equal(captures.has(1), true);
    const left = host.scrollLeft;
    pointer('pointermove', 1, 100, 200, host, 'touch'); near(host.scrollLeft, left + 50, 'continued touch pan');
    pointer('pointerdown', 2, 300, 200, child, 'touch');
    pointer('lostpointercapture', 2, 300, 200, child, 'touch');
    pointer('pointermove', 2, 400, 200, host, 'touch'); near(zoom(), 1.5, 'pinch survives transfer');
    pointer('pointerup', 2, 400, 200, host, 'touch'); pointer('pointerup', 1, 100, 200, host, 'touch');
    assert.equal(captures.size, 0);
});
await test('Ctrl-wheel anchors at the cursor; ordinary wheel retains native scrolling', ({ controller, host, w, world, zoom }) => {
    controller.zoomTo(1); host.scrollLeft = 600; host.scrollTop = 1500;
    const before = world(200, 100);
    const wheel = new w.WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 225, clientY: 150, deltaY: -20, ctrlKey: true });
    host.dispatchEvent(wheel); assert.equal(wheel.defaultPrevented, true); assert.ok(zoom() > 1);
    const after = world(200, 100); near(before.x, after.x, 'cursor x'); near(before.y, after.y, 'cursor y');
    const plain = new w.WheelEvent('wheel', { cancelable: true, deltaY: 20 }); host.dispatchEvent(plain); assert.equal(plain.defaultPrevented, false);
});
await test('Keyboard and left/right controls work without intercepting child controls', ({ controls, host, w, zoom }) => {
    controls.reset.click(); host.scrollLeft = 500;
    host.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })); near(host.scrollLeft, 580, 'keyboard pan');
    controls.right.click(); assert.ok(host.scrollLeft > 580); controls.left.click(); near(host.scrollLeft, 580, 'button pan');
    const before = zoom(); host.querySelector('.source-jump').dispatchEvent(new w.KeyboardEvent('keydown', { key: '+', bubbles: true })); assert.equal(zoom(), before);
    host.dispatchEvent(new w.KeyboardEvent('keydown', { key: '+', bubbles: true })); assert.ok(zoom() > before);
    host.dispatchEvent(new w.KeyboardEvent('keydown', { key: '0', bubbles: true })); assert.equal(controls.select.value, 'fit');
});
await test('Redraws keep zoom and position; a different event starts in Fit', ({ controller, host, zoom, render, tournament, controls }) => {
    controller.zoomTo(1.25); host.scrollLeft = 800; host.scrollTop = 1400;
    render({ ...tournament, revision: tournament.revision + 1 });
    assert.equal(zoom(), 1.25); near(host.scrollLeft, 800, 'refresh x'); near(host.scrollTop, 1400, 'refresh y');
    render({ ...tournament, id: 'another-event' }); assert.equal(controls.select.value, 'fit'); assert.equal(host.scrollTop, 0);
});
await test('Source jumps leave tiny overview and focus a readable connected match', ({ host, zoom, d }) => {
    assert.ok(zoom() < .1); host.querySelector('.source-jump').click();
    assert.equal(zoom(), 1); assert.ok(d.activeElement.matches('.match-card'));
    const rect = d.activeElement.getBoundingClientRect(), box = host.getBoundingClientRect();
    assert.ok(rect.left >= box.left && rect.right <= box.right && rect.top >= box.top && rect.bottom <= box.bottom);
});
await test('Keyboard focus survives same-event refresh and pointer focus cannot jump the canvas', ({ controller, host, render, tournament, d, pointer, zoom }) => {
    controller.zoomTo(1);
    const button = host.querySelector('.source-jump'); button.focus();
    const code = button.closest('.match-card').dataset.code, text = button.textContent;
    render({ ...tournament, revision: tournament.revision + 1 });
    assert.equal(d.activeElement.textContent, text);
    assert.equal(d.activeElement.closest('.match-card').dataset.code, code);
    controller.zoomTo('fit');
    const target = host.querySelector('.match-action'), before = zoom();
    pointer('pointerdown', 1, 50, 50, target, 'touch'); target.focus();
    assert.equal(zoom(), before, 'pointer focus does not jump before the drag threshold');
    pointer('pointercancel', 1, 50, 50, host, 'touch');
});
await test('Empty diagrams disable controls and recover on new content', ({ render, tournament, controls, host }) => {
    render({ ...tournament, matches: [] });
    for (const control of Object.values(controls)) if ('disabled' in control) assert.equal(control.disabled, true);
    assert.equal(host.dataset.zoom, undefined); render(tournament); assert.equal(controls.zoomIn.disabled, false);
});
const css = fs.readFileSync(path.join(root, 'css/brackets.css'), 'utf8');
assert.match(css, /touch-action: none/); assert.match(css, /\.diagram-spacer \{[^}]*overflow: hidden/);
assert.match(css, /min-width: 44px; min-height: 44px/); assert.match(css, /\.diagram-viewport:focus-visible/);
assert.ok(fs.readFileSync(path.join(root, 'sw.js'), 'utf8').includes("'./js/brackets/viewport.js'"));
console.log(`\n${passed} viewport interaction groups passed, plus CSS/cache contracts. Geometry is mocked; no physical touch or rendered-browser claim.`);
