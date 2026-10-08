/** Focused structural checks only, NOT browser/layout/accessibility certification.
 * Run: node dev/tests/winner_celebration_static_test.mjs
 * No browser, network, npm install, real match, or account is used.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dev = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => fs.readFileSync(path.join(dev, name), 'utf8');
const css = read('css/winner-celebration.css').replace(/\/\*[\s\S]*?\*\//g, '');
let passed = 0;
const pass = name => { passed++; console.log(`PASS ${name}`); };

// Check delimiter/quote structure before inspecting rules. This deliberately
// does not claim to replace a browser's CSS parser or rendered computed style.
const stack = [];
let quote = null;
for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === '\\') { i++; continue; }
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if ('({['.includes(c)) stack.push(c);
    if (')}]'.includes(c)) assert.equal(stack.pop(), { ')': '(', '}': '{', ']': '[' }[c]);
}
assert.equal(quote, null);
assert.equal(stack.length, 0);
assert.ok(!/@import|url\s*\(|https?:/i.test(css));

function splitTop(source, separator) {
    const result = [];
    let level = 0, start = 0, string = null;
    for (let i = 0; i < source.length; i++) {
        const c = source[i];
        if (c === '\\') { i++; continue; }
        if (string) { if (c === string) string = null; continue; }
        if (c === '"' || c === "'") { string = c; continue; }
        if (c === '(' || c === '[') level++;
        if (c === ')' || c === ']') level--;
        if (c === separator && level === 0) { result.push(source.slice(start, i).trim()); start = i + 1; }
    }
    result.push(source.slice(start).trim());
    return result.filter(Boolean);
}

function blocks(source) {
    const result = [];
    let level = 0, start = 0, bodyStart = 0, prelude;
    // This stylesheet uses no braces in strings or data URIs.
    for (let i = 0; i < source.length; i++) {
        if (source[i] === '{') {
            if (level === 0) { prelude = source.slice(start, i).trim(); bodyStart = i + 1; }
            level++;
        } else if (source[i] === '}' && --level === 0) {
            result.push({ prelude, body: source.slice(bodyStart, i) });
            start = i + 1;
        }
    }
    assert.equal(source.slice(start).trim(), '', 'Unexpected text outside CSS rules');
    return result;
}

const properties = new Set(('animation animation-duration animation-delay transition aspect-ratio background ' +
    'background-repeat border border-radius border-width box-sizing color content display font-size height inset ' +
    'left margin opacity overflow overflow-x overscroll-behavior pointer-events position right stroke-dasharray ' +
    'stroke-dashoffset top transform transform-box transform-origin width z-index').split(' '));
function declarations(body) {
    return splitTop(body, ';').map(declaration => {
        const colon = declaration.indexOf(':');
        assert.ok(colon > 0, `Missing declaration colon: ${declaration}`);
        const name = declaration.slice(0, colon).trim();
        const value = declaration.slice(colon + 1).trim();
        assert.ok(properties.has(name) || /^--win-[\w-]+$/.test(name), `Unexpected property: ${name}`);
        assert.ok(value.length, `Empty declaration: ${name}`);
        return { name, value };
    });
}

const rules = [], keyframes = new Map();
function walk(source, media = '') {
    for (const { prelude, body } of blocks(source)) {
        if (prelude.startsWith('@media ')) {
            walk(body, prelude);
        } else if (prelude.startsWith('@keyframes ')) {
            const name = prelude.slice(11).trim();
            assert.match(name, /^win-[a-z-]+$/);
            assert.ok(!keyframes.has(name), `Duplicate keyframes: ${name}`);
            keyframes.set(name, blocks(body).map(frame => {
                assert.match(frame.prelude, /^(from|to|\d+%)$/);
                return declarations(frame.body);
            }));
        } else {
            assert.ok(!prelude.startsWith('@'), `Unexpected at-rule: ${prelude}`);
            for (const selector of splitTop(prelude, ',')) {
                assert.match(selector, /^(#winnerModal |#chicagoLegModal |:is\(#winnerModal, #chicagoLegModal\) )/);
                rules.push({ selector, media, declarations: declarations(body) });
            }
        }
    }
}
walk(css);
assert.ok(rules.length >= 30 && keyframes.size >= 8);
pass(`${rules.length} result-dialog-only selectors; balanced CSS structure; local-only effects`);

const animated = rules.filter(rule => rule.declarations.some(d => d.name === 'animation' && d.value !== 'none !important'));
for (const { selector, declarations: values } of animated) {
    assert.ok(!/button|modal-buttons|ResultPanel/.test(selector), `Action has a reveal animation: ${selector}`);
    const value = values.find(d => d.name === 'animation').value;
    const name = value.split(/\s+/)[0];
    assert.ok(keyframes.has(name), `Missing keyframes ${name}`);
    assert.ok(!/infinite|alternate|reverse/.test(value));
    assert.match(value, /\bboth\b/);
}
for (const { declarations: values } of rules) {
    for (const { name, value } of values) {
        if (name.startsWith('animation')) {
            for (const match of value.matchAll(/(^|\s)([.\d]+)s(?=\s|$)/g)) {
                assert.ok(Number(match[2]) > 0 && Number(match[2]) <= 2.5, `Unbounded time: ${value}`);
            }
        }
    }
}
for (const [name, frames] of keyframes) {
    let peakPassed = false, previousOpacity = -1;
    for (const frame of frames) {
        for (const d of frame) {
            assert.ok(['transform', 'opacity', 'stroke-dashoffset'].includes(d.name), `Layout/paint animation in ${name}`);
            if (d.name === 'opacity') {
                const next = Number(d.value);
                assert.ok(next >= 0 && next <= 1);
                if (next < previousOpacity) peakPassed = true;
                assert.ok(!peakPassed || next <= previousOpacity, `Repeated luminance peak in ${name}`);
                previousOpacity = next;
            }
        }
    }
}
assert.ok(!keyframes.get('win-name-settle').flat().some(d => d.name === 'opacity'));
pass(`${keyframes.size} finite transform/opacity/SVG-draw sequences; no hidden names, control reveals, or repeating flashes`);

for (const { selector, media, declarations: values } of rules) {
    for (const { name, value } of values) {
        assert.ok(!/#(?:[0-9a-f]{3,8})\b|\brgba?\(|\bhsla?\(/i.test(value), `Hard-coded palette in ${selector}`);
        if (name === 'pointer-events') {
            assert.equal(value, 'none');
            assert.ok(/::before|::after|\.winner-emblem/.test(selector));
        }
        if (name === 'opacity' && value === '0') assert.match(selector, /::(before|after)$/);
        if (name === 'display') {
            assert.match(media, /prefers-reduced-motion|forced-colors/);
            assert.match(selector, /::(before|after)$/);
        }
        if (name === 'z-index') assert.equal(value, '-1');
        if (name === 'position') assert.notEqual(value, 'fixed');
    }
}
assert.ok(read('css/winner.css').includes('isolation: isolate;'));
assert.ok(/\.modal-content\s*\{[^}]*overflow-y:\s*auto;/.test(read('css/components.css')));
assert.ok(!/overflow(?:-y)?:\s*(hidden|clip)/.test(css));
pass('decorations cannot intercept input; isolated background layers; theme tokens only; vertical scroller retained');

const reduced = rules.filter(rule => rule.media.includes('prefers-reduced-motion: reduce'));
for (const suffix of ['.winner-modal-content', '.winner-modal-content *', '.winner-modal-content::before',
    '.winner-modal-content::after', '.winner-modal-content *::before', '.winner-modal-content *::after']) {
    const rule = reduced.find(rule => rule.selector === `:is(#winnerModal, #chicagoLegModal) ${suffix}`);
    assert.ok(rule, `Missing reduced-motion target: ${suffix}`);
    assert.ok(rule.declarations.some(d => d.name === 'animation' && d.value === 'none !important'));
}
assert.ok(reduced.some(rule => rule.selector === '#winnerModal .winner-emblem::after' &&
    rule.declarations.some(d => d.name === 'display' && d.value === 'none')));
assert.ok(rules.some(rule => rule.media.includes('(max-height: 650px)') &&
    rule.selector === '#winnerModal .winner-emblem' && rule.declarations.some(d => d.name === 'height' && d.value === '64px')));
assert.ok(rules.filter(rule => rule.media.includes('max-width: 360px')).every(rule => rule.media.includes('min-height: 651px')));
pass('reduced-motion cancels all card/descendant/pseudo animations; compact-height rule wins on small phones');

const html = read('index.html');
const emblem = html.match(/<div class="winner-emblem" aria-hidden="true">([\s\S]*?)<\/div>/)?.[1];
assert.ok(emblem);
assert.match(emblem, /viewBox="0 0 80 80"/);
assert.equal((emblem.match(/<circle /g) || []).length, 3);
assert.equal((emblem.match(/<path /g) || []).length, 1);
assert.equal((emblem.match(/cx="36" cy="44"/g) || []).length, 3);
const ui = read('js/ui.js');
assert.match(ui, /function showModal\(modalId\)[\s\S]*?el\.style\.display = 'flex';/);
assert.match(ui, /function hideModal\(modalId\)[\s\S]*?el\.style\.display = 'none';/);
assert.match(ui, /setTimeout\(\(\) => \{ content\.style\.pointerEvents = ''; \}, 300\)/);
pass('existing aria-hidden dartboard geometry matches strike origin; display:none lifecycle and 300ms input guard remain');

console.log(`\n${passed}/${passed} structural groups passed. Runtime, visual layout, repeat-open behavior, physical-device performance and accessibility remain unverified.`);
