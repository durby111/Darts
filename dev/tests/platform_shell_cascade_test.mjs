/** Shipped-order shell element cascade regression, using real HTML/CSSOM.
 * Run: node dev/tests/platform_shell_cascade_test.mjs
 * Requires jsdom; BLAKEOUT_JSDOM_MODULE may name an existing installation.
 * Only the local confirmation module is evaluated; no providers, storage, or
 * network are enabled. This checks matched
 * selectors, specificity, source order and declared color pairs, not rendering.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { JSDOM } = require(process.env.BLAKEOUT_JSDOM_MODULE || 'jsdom');
const dev = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const themes = ['blue', 'red', 'neon', 'sunburst', 'volt', 'inferno', 'miami', 'grape', 'aqua', 'royal', 'shamrock', 'arctic'];
const modes = ['modern', 'classic', 'dc', 'dot-better'];

function splitSelectors(selector) {
    const result = []; let depth = 0, start = 0;
    [...selector].forEach((char, i) => {
        if (char === '(' || char === '[') depth++;
        if (char === ')' || char === ']') depth--;
        if (char === ',' && !depth) { result.push(selector.slice(start, i).trim()); start = i + 1; }
    });
    result.push(selector.slice(start).trim());
    return result;
}
function specificity(selector) {
    // All selectors matching this live shell anchor are simple selectors.
    // Fail explicitly if future styling needs a functional pseudo selector.
    assert.doesNotMatch(selector, /:(?:is|where|not|has)\(/, `Extend specificity coverage for ${selector}`);
    const ids = (selector.match(/#[\w-]+/g) || []).length;
    const classes = (selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) || []).length;
    const types = (selector.match(/(?:^|[\s>+~])[a-zA-Z][\w-]*/g) || []).length;
    return [ids, classes, types];
}
function compare(a, b) {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
}
function winner(element, properties) {
    let selected = null, order = 0;
    for (const sheet of element.ownerDocument.styleSheets) for (const rule of sheet.cssRules) {
        if (!rule.selectorText) continue; // Shell color rules are top-level.
        for (const selector of splitSelectors(rule.selectorText)) {
            if (!element.matches(selector)) continue;
            for (const property of properties) {
                const value = rule.style.getPropertyValue(property);
                if (!value) continue;
                const weight = [rule.style.getPropertyPriority(property) === 'important' ? 1 : 0, ...specificity(selector), order++];
                if (!selected || compare(weight, selected.weight) >= 0) selected = { selector, property, value, weight };
            }
        }
    }
    assert.ok(selected, `No shipped declaration for ${properties}`);
    return selected;
}
function color(value, computed, visited = new Set()) {
    if (value.startsWith('var(')) {
        const name = value.slice(4, -1);
        assert.ok(!visited.has(name), `Cyclic token ${name}`);
        const replacement = computed.getPropertyValue(name).trim();
        assert.ok(replacement, `Unresolved inherited token ${name}`);
        return color(replacement, computed, new Set([...visited, name]));
    }
    assert.match(value, /^#[\da-f]{3}(?:[\da-f]{3})?$/i);
    const hex = value.length === 4 ? value.slice(1).split('').map(c => c + c).join('') : value.slice(1);
    return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
}
function overlay(value, computed) {
    if (value.startsWith('var(')) return overlay(computed.getPropertyValue(value.slice(4, -1)).trim(), computed);
    if (value.startsWith('rgba(')) {
        const rgba = value.slice(5, -1).split(',').map(Number);
        return { rgb: rgba.slice(0, 3), alpha: rgba[3] };
    }
    if (value.startsWith('color-mix(')) {
        const [, ink, percentage] = value.match(/^color-mix\(in srgb, (.*) (\d+)%, transparent\)$/);
        return { rgb: color(ink, computed), alpha: Number(percentage) / 100 };
    }
    return { rgb: color(value, computed), alpha: 1 };
}
function luminance(rgb) {
    return rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
        .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
}
function contrast(a, b) { const [low, high] = [luminance(a), luminance(b)].sort((a, b) => a - b); return (high + .05) / (low + .05); }
let minimum = Infinity, cases = 0, dialogCases = 0, minimumDialog = Infinity;
for (const feature of ['accounts', 'brackets']) {
    const file = path.join(dev, feature, 'index.html');
    const dom = new JSDOM(fs.readFileSync(file, 'utf8'), { runScripts: 'outside-only' });
    try {
        const { document } = dom.window;
        const links = [...document.querySelectorAll('link[rel="stylesheet"]')];
        const paths = links.map(link => link.getAttribute('href'));
        assert.ok(paths.indexOf('../css/platform.css') < paths.indexOf('../css/feature-availability.css'), 'Exercise the actual overriding stylesheet order');
        let platformStyle;
        for (const link of links) {
            const style = document.createElement('style');
            style.textContent = fs.readFileSync(path.resolve(path.dirname(file), link.getAttribute('href')), 'utf8');
            if (link.getAttribute('href') === '../css/platform.css') platformStyle = style;
            link.replaceWith(style);
        }
        const back = document.querySelector('#featureUnavailableShell .back-to-scoring');
        assert.ok(back, 'Use the live closed-shell action, not the inert template');
        for (const theme of themes) for (const mode of modes) {
            document.documentElement.dataset.theme = theme;
            document.documentElement.dataset.scoreboardMode = mode;
            const background = winner(back, ['background', 'background-color']);
            const foreground = winner(back, ['color']);
            assert.equal(background.value, 'var(--platform-button-bg)', `${feature}/${theme}/${mode}: ${background.selector}`);
            assert.equal(foreground.value, 'var(--platform-button-ink)', `${feature}/${theme}/${mode}: ${foreground.selector}`);
            const computed = dom.window.getComputedStyle(back);
            const ratio = contrast(color(foreground.value, computed), color(background.value, computed));
            assert.ok(ratio >= 4.5, `${feature}/${theme}/${mode}: actual winning declared pair ${ratio.toFixed(2)}:1`);
            minimum = Math.min(minimum, ratio);
            cases++;
        }
        back.focus();
        assert.ok(back.matches(':focus-visible'), 'Focus-visible selector fixture must be exercised');
        const focus = winner(back, ['outline', 'outline-color']);
        assert.equal(focus.value, 'var(--platform-focus)');
        assert.equal(focus.selector, '.platform-page .feature-unavailable .back-to-scoring:focus-visible');

        // Evaluate the shared component in this isolated DOM. Only its two ESM
        // export keywords are removed; page scripts remain inert and no account
        // module is loaded. The behavioral suite tests native and fallback paths.
        const source = fs.readFileSync(path.join(dev, 'js/confirm-dialog.js'), 'utf8');
        assert.doesNotMatch(source, /^import\s/m);
        const confirmation = dom.window.eval(`(() => { ${source.replace(/^export (?=function)/gm, '')}\nreturn { confirmDialog, cancelConfirmation }; })()`);
        dom.window.HTMLDialogElement.prototype.showModal = undefined;
        const pending = confirmation.confirmDialog('Confirm this fixture action?', { title: 'Confirmation styling' });
        const dialog = document.querySelector('.platform-confirm');
        const host = document.querySelector('.platform-confirm-fallback');
        assert.ok(dialog?.open && host, 'Exercise the real app-owned fallback DOM');
        assert.equal(dom.window.getComputedStyle(host).position, 'fixed');
        assert.equal(dom.window.getComputedStyle(host).display, 'grid');
        assert.equal(dom.window.getComputedStyle(dialog).overflowY, 'auto');
        assert.equal(dom.window.getComputedStyle(dialog).position, 'relative');
        const nativeBackdrop = [...platformStyle.sheet.cssRules].find(rule => rule.selectorText === '.platform-page dialog::backdrop');
        assert.ok(nativeBackdrop, 'A native dialog backdrop rule must exist');
        const backdropDeclaration = nativeBackdrop.style.getPropertyValue('background');
        assert.equal(backdropDeclaration, 'var(--platform-backdrop, rgba(0, 0, 0, .84))',
            'Native top-layer backdrop has a safe fallback for engines without custom-property inheritance');

        for (const theme of themes) for (const mode of modes) {
            document.documentElement.dataset.theme = theme;
            document.documentElement.dataset.scoreboardMode = mode;
            assert.equal(winner(host, ['background', 'background-color']).value, backdropDeclaration,
                'The native backdrop and generated fallback host must use the same declaration');
            const hostComputed = dom.window.getComputedStyle(host);
            const hostOverlay = overlay('var(--platform-backdrop)', hostComputed);
            if (['dc', 'dot-better'].includes(mode)) {
                assert.deepEqual(hostOverlay.rgb, color('var(--color-bg)', hostComputed), `${feature}/${theme}/${mode} active-palette backdrop`);
                assert.ok(luminance(hostOverlay.rgb) < .02, `${feature}/${theme}/${mode} cannot inherit a pale Arctic veil`);
                assert.ok(hostOverlay.alpha >= .84);
            } else {
                assert.deepEqual(hostOverlay, overlay('var(--bg-image-overlay)', hostComputed), `${feature}/${theme}/${mode} theme overlay preserved`);
            }
            for (const element of [dialog, ...dialog.querySelectorAll('button')]) {
                const foreground = winner(element, ['color']);
                const background = winner(element, ['background', 'background-color']);
                const computed = dom.window.getComputedStyle(element);
                const ratio = contrast(color(foreground.value, computed), color(background.value, computed));
                assert.ok(ratio >= 4.5, `${feature}/${theme}/${mode}/${element.className}: ${ratio.toFixed(2)}:1`);
                minimumDialog = Math.min(minimumDialog, ratio);
                if (element.tagName === 'BUTTON') assert.ok(parseFloat(computed.minHeight) >= 44);
            }
            dialogCases++;
        }
        confirmation.cancelConfirmation();
        assert.equal(await pending, false);
        assert.equal(document.querySelector('.platform-confirm'), null);


        // Negative test fixture: reproduce the former equal-specificity rule
        // in memory and verify this element-level test detects both failures.
        platformStyle.textContent = platformStyle.textContent.replaceAll(
            '.platform-page .feature-unavailable .back-to-scoring', '.platform-page .back-to-scoring');
        document.documentElement.dataset.scoreboardMode = 'modern';
        for (const theme of ['neon', 'royal']) {
            document.documentElement.dataset.theme = theme;
            const background = winner(back, ['background', 'background-color']);
            const foreground = winner(back, ['color']);
            const computed = dom.window.getComputedStyle(back);
            assert.equal(background.value, 'var(--color-primary)');
            assert.equal(foreground.value, 'var(--color-on-primary)');
            assert.ok(contrast(color(foreground.value, computed), color(background.value, computed)) < 4.5,
                `The old cascade fixture must expose the ${theme} contrast regression`);
        }
    } finally { dom.window.close(); }
}
console.log(`PASS ${cases} shipped shell/theme/style combinations preserve shared action colors (minimum declared contrast ${minimum.toFixed(2)}:1)`);
console.log('PASS both shipped shells retain the shared focus token after later availability CSS');
console.log('PASS negative cascade fixture reproduces the old Neon/Royal action contrast failures');
console.log(`PASS ${dialogCases} app-owned dialog/theme/style combinations preserve readable panel/actions (minimum declared contrast ${minimumDialog.toFixed(2)}:1), 44px targets and fallback scroll/position declarations`);
console.log('PASS native/fallback backdrop declarations match across 96 palettes; Arctic DC/Dot Better use dark active-palette backdrops');
console.log('CSS coverage applies to page elements and the shared app-owned <dialog>; any remaining native window.confirm/alert are browser-owned. No rendered/browser QA is implied.');
