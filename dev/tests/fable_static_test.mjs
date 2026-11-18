/** Local structural checks for the optional Fable style. NOT browser/visual tests.
 * Run: node dev/tests/fable_static_test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dev = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => fs.readFileSync(path.join(dev, name), 'utf8');
let passed = 0;
function pass(name) { passed++; console.log(`PASS ${name}`); }

// Every rule must be gated on the Fable mode and the game screen, so
// the stylesheet cannot leak into Modern, Classic, DC Mode or Dot Better.
const css = read('css/fable.css').replace(/\/\*[\s\S]*?\*\//g, '');
const gate = ':root[data-scoreboard-mode="fable"] #gameScreen';
let depth = 0, start = 0, selectors = 0;
for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') {
        const prelude = css.slice(start, i).trim();
        assert.ok(prelude.startsWith('@media') || prelude.startsWith(gate), `Unscoped CSS rule: ${prelude}`);
        if (!prelude.startsWith('@media')) selectors++;
        depth++; start = i + 1;
    } else if (css[i] === '}') {
        assert.ok(depth > 0, 'Unmatched CSS close brace');
        depth--; start = i + 1;
    }
}
assert.equal(depth, 0);
assert.ok(selectors > 40);
assert.ok(!/https?:|@import/.test(css));
pass(`${selectors} additive CSS rules scoped to Fable/game screen; balanced braces; local-only assets`);

// One feel in every game: each engine's commit key shares the brass ENTER look,
// and UNDO / quiet actions are styled once for all of them.
for (const id of ['#targetEndTurnBtn', '#ticEndTurnBtn', '#doubleDownEndTurnBtn', '#teamCricketEnterBtn', '#enterBtn']) {
    assert.ok(css.includes(id), `Fable must style the commit key ${id}`);
}
assert.match(css, /#gameScreen \.btn--undo\s*\{/);
assert.match(css, /#gameScreen \.btn--miss\s*\{/);
pass('commit, undo and quiet-action keys share one look across every game');

// ENTER is the dominant commit key; the operators are reduced and lifted.
assert.match(css, /#x01EnterBtn\s*\{[^}]*flex:\s*2\.4 1 0;/);
assert.match(css, /\.x01-bottom-row \.btn\s*\{[^}]*min-height:\s*calc\(clamp\(72px,/);
assert.match(css, /\.x01-num-btn\[data-op\]\s*\{[^}]*align-self:\s*start;[^}]*width:\s*72%;/);
assert.match(css, /\.x01-num-btn\[data-op\]\s*\{[^}]*min-height:\s*44px;/);
pass('ENTER is the widest, tallest action; operators are smaller, lifted, and still 44px');

// Palette is shared with eligible result dialogs and does not carry layout.
const palettes = read('css/scoreboard-palettes.css').replace(/\/\*[\s\S]*?\*\//g, '');
const from = palettes.indexOf(':root[data-scoreboard-mode="fable"]');
assert.ok(from > palettes.indexOf(':root[data-scoreboard-mode="dot-better"]'), 'Fable palette must follow existing palettes');
const paletteRule = palettes.slice(from, palettes.indexOf('}', from) + 1);
assert.ok(paletteRule.includes(':root[data-scoreboard-mode="fable"] #gameScreen,'));
for (const id of ['#winnerModal', '#chicagoLegModal', '#chicagoGameModal', '#game121SummaryModal', '#gameMenuModal', '#scoreKeypadModal', '#bermudaFacePickerModal']) {
    assert.ok(paletteRule.includes(id), `Fable palette must reach ${id}`);
}
assert.ok(!paletteRule.includes('#settingsModal'), 'Settings opens from setup too and keeps the theme');
assert.ok(!/(?:^|\n)\s*(?:display|padding|gap|width|height|overflow|background):/.test(paletteRule));
assert.ok(!palettes.includes('data-scoreboard-mode="fable"] .platform-page'));
pass('palette covers every game and in-game dialog; setup and feature pages keep the selected theme');

const html = read('index.html');
assert.equal((html.match(/href="css\/fable.css"/g) || []).length, 1);
assert.ok(html.indexOf('css/dot-better.css') < html.indexOf('css/fable.css'));
assert.ok(/(['"])\.\/css\/fable\.css\1/.test(read('sw.js')));
assert.ok(read('js/score-appearance.js').includes("id: 'fable', label: 'Fable 5.2'"));
pass('stylesheet linked once after existing styles, precached, and registered as a choice');

function luminance(hex) {
    const n = parseInt(hex.slice(1), 16);
    const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => {
        v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
    });
    return .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
}
const contrasts = [
    ['active score', '#fff7e0', '#081510'], ['inactive score', '#cfd6c8', '#081510'],
    ['player name', '#c3cdbd', '#16332b'], ['active name', '#ecd398', '#1d4331'],
    ['digit key', '#16241c', '#e6dcc0'], ['operator key', '#1f1607', '#b98f44'],
    ['quick key', '#ecd398', '#1e4030'], ['history', '#dfe5d6', '#081510'],
    ['bust history', '#f29b91', '#081510'], ['miss history', '#9db0a1', '#081510'],
    ['Enter', '#1a1407', '#c29a4c'], ['Bust', '#ffffff', '#8f342c'],
    ['Miss', '#f6efdc', '#24443a'], ['Undo', '#ecd398', '#2a2412'],
    ['current round', '#1a1407', '#c9a45c'],
].map(([name, fg, bg]) => {
    const a = luminance(fg), b = luminance(bg), ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    assert.ok(ratio >= 4.5, `${name} contrast ${ratio}`);
    return `${name} ${ratio.toFixed(2)}:1`;
});
pass('declared main text color pairs meet 4.5:1: ' + contrasts.join(', '));
console.log(`\n${passed}/${passed} static groups passed. No browser, touch, layout, offline-runtime, or scoring-regression pass is implied.`);
