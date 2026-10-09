/** Local structural/settings checks only. These are NOT browser/visual tests.
 * Run: node --experimental-vm-modules dev/tests/dot_better_static_test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const dev = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => fs.readFileSync(path.join(dev, name), 'utf8');
let passed = 0;
function pass(name) { passed++; console.log(`PASS ${name}`); }

// Execute the actual settings module, replacing only its modal dependency
// with an inert unit-test double. Storage and DOM are explicit test fixtures.
const storage = new Map([['blakeout_dev_active_game', '{"sentinel":"unchanged"}']]);
const attrs = new Map();
const handlers = new Map();
const row = { innerHTML: '', addEventListener: (name, fn) => handlers.set(name, fn) };
const root = { setAttribute: (k, v) => attrs.set(k, v),
    style: { removeProperty() {}, setProperty() {} } };
const context = vm.createContext({ document: { documentElement: root,
    getElementById: id => id === 'scoreSkinChoices' ? row : null },
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    alert: () => { throw new Error('Unexpected alert'); } });
const settings = new vm.SourceTextModule(read('js/settings.js'), { context });
const modal = new vm.SyntheticModule(['showModal', 'hideModal'], function () {
    this.setExport('showModal', () => {}); this.setExport('hideModal', () => {});
}, { context });
const appearance = new vm.SourceTextModule(read('js/score-appearance.js'), { context });
await appearance.link(() => { throw new Error('Preference helper must be dependency-free'); });
await settings.link(specifier => {
    if (specifier === './ui.js') return modal;
    assert.equal(specifier, './score-appearance.js');
    return appearance;
});
await settings.evaluate();
assert.deepEqual(Array.from(settings.namespace.SCORE_SKINS, s => s.id),
    ['modern', 'classic', 'dc', 'dot-better']);
assert.equal(settings.namespace.SCORE_SKINS[3].label, 'Dot Better');
assert.equal(settings.namespace.getScoreSkin(), 'modern');
settings.namespace.initSettings();
assert.equal(attrs.get('data-scoreboard-mode'), 'modern');
pass('optional fourth choice; Modern remains the default');

for (const skin of ['modern', 'classic', 'dc', 'dot-better']) {
    handlers.get('click')({ target: { closest: () => ({ dataset: { scoreSkin: skin } }) } });
    assert.equal(storage.get('blakeout_x01_skin'), skin);
    assert.equal(settings.namespace.getScoreSkin(), skin);
    assert.equal(attrs.get('data-scoreboard-mode'), skin);
    assert.equal(attrs.get('data-x01-skin'), skin);
    assert.equal((row.innerHTML.match(/aria-pressed="true"/g) || []).length, 1);
    assert.ok(row.innerHTML.includes(`data-score-skin="${skin}" aria-pressed="true"`));
    settings.namespace.applyScoreSkin(); // reconstruct from saved setting
    assert.equal(attrs.get('data-scoreboard-mode'), skin);
}
assert.equal(storage.get('blakeout_dev_active_game'), '{"sentinel":"unchanged"}');
assert.equal(storage.size, 2);
pass('all four choices persist, preserve active-game storage, and render pressed state');

handlers.get('click')({ target: { closest: () => ({ dataset: { scoreSkin: 'invalid' } }) } });
assert.equal(storage.get('blakeout_x01_skin'), 'dot-better');
storage.set('blakeout_x01_skin', 'invalid');
assert.equal(settings.namespace.getScoreSkin(), 'modern');
context.localStorage.getItem = () => { throw new Error('Storage disabled'); };
assert.equal(settings.namespace.getScoreSkin(), 'modern');
pass('invalid choice rejected; invalid/unavailable storage falls back to Modern');

const css = read('css/dot-better.css').replace(/\/\*[\s\S]*?\*\//g, '');
let depth = 0, start = 0, selectors = 0;
for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') {
        const prelude = css.slice(start, i).trim();
        assert.ok(prelude.startsWith('@media') ||
            prelude.startsWith(':root[data-scoreboard-mode="dot-better"] #gameScreen[data-scoreboard-family') ||
            prelude.startsWith(':root[data-scoreboard-mode="dot-better"]:has(#gameScreen[data-scoreboard-family]) :is(#winnerModal, #chicagoLegModal'),
            `Unscoped CSS rule: ${prelude}`);
        if (!prelude.startsWith('@media')) selectors++;
        depth++; start = i + 1;
    } else if (css[i] === '}') {
        assert.ok(depth > 0, 'Unmatched CSS close brace');
        depth--; start = i + 1;
    }
}
assert.equal(depth, 0);
assert.ok(selectors > 40);
assert.ok(css.includes('min-height: 44px'));
assert.ok(css.includes('grid-template-rows: repeat(5, minmax(44px, 1fr))'));
assert.ok(css.includes('height: 48px') && css.includes('flex: 0 0 48px'));
assert.ok(!/https?:|@import/.test(css));
pass(`${selectors} additive CSS rules scoped to Dot Better/game family; balanced braces; local-only assets`);

const resultGate = ':root[data-scoreboard-mode="dot-better"]:has(#gameScreen[data-scoreboard-family])';
const paletteCSS = read('css/scoreboard-palettes.css').replace(/\/\*[\s\S]*?\*\//g, '');
const paletteRule = paletteCSS.slice(0, paletteCSS.indexOf('}') + 1);
assert.ok(paletteRule.includes(`${resultGate} :is(#winnerModal, #chicagoLegModal, #game121SummaryModal)`));
assert.ok(paletteRule.includes('--color-surface: #1d242d;'));
assert.ok(paletteRule.includes('--color-text: #f5f7fc;'));
assert.ok(!/(?:^|\n)\s*(?:display|padding|gap|width|height|overflow|background):/.test(paletteRule));
assert.ok(!css.includes('data-scoreboard-mode="modern"]:has'));
assert.match(css, /#game121SummaryModal\)\s*\{\s*--color-primary:\s*#8cc8ff;/);
assert.match(css, /#game121SummaryModal\)\s*\{\s*--color-primary:\s*#8cc8ff;\s*--color-success-dark:\s*#24476b;\s*color:\s*var\(--color-text\);/);
assert.match(css, /#tournamentNextLeg\)\s*\{\s*background:\s*#286eb7;\s*color:\s*#fff;/);
pass('eligible result dialogs share palette only, with light status ink and accessible blue actions');

const html = read('index.html');
assert.equal((html.match(/href="css\/dot-better.css"/g) || []).length, 1);
assert.equal((html.match(/href="css\/scoreboard-palettes.css"/g) || []).length, 1);
const swContext = vm.createContext({ URL, self: { location: { href: 'https://example.test/dev/sw.js', origin: 'https://example.test' }, addEventListener() {} } });
vm.runInContext(read('sw.js') + '\nthis.result = {CACHE_NAME, ASSETS};', swContext);
assert.ok(swContext.result.CACHE_NAME.startsWith('blakeout-dev-'));
assert.ok(swContext.result.ASSETS.includes('./css/dot-better.css'));
for (const asset of ['./css/scoreboard-palettes.css', './js/score-appearance.js', './js/feature-appearance.js']) {
    assert.ok(swContext.result.ASSETS.includes(asset));
}
for (const asset of swContext.result.ASSETS) {
    assert.ok(fs.existsSync(path.resolve(dev, asset)), `Missing precache asset: ${asset}`);
}
for (const match of html.matchAll(/<link[^>]+href="(css\/[^"]+)"/g)) {
    assert.ok(fs.existsSync(path.join(dev, match[1])), `Missing linked stylesheet ${match[1]}`);
}
pass('stylesheet linked once; DEV cache includes it; all listed precache assets exist');

// The revised optional layout has one growing middle history viewport.
assert.match(css, /#x01Controls\s*\{\s*order:\s*2;/);
assert.match(css, /\.x01-main\s*\{\s*order:\s*1;/);
assert.ok(css.includes('flex: 1 1 0;'));
assert.ok(css.includes('grid-template-rows: minmax(0, 1fr);'));
assert.match(css, /> :first-child\s*\{\s*margin-top:\s*auto;/);
assert.ok(!css.includes('column-reverse'));
pass('declared layout is header → flexible history → bottom keypad; short histories bottom-align');

// Execute the existing renderer body with explicit DOM fixtures. This checks
// ordering, retention and scroll intent; it does not measure browser layout.
const rendererSource = read('js/x01.js').split('function renderX01ScoreHistory() {')[1]
    .split('// --- Checkout Suggestion ---')[0];
const laneIds = ['p1HistoryCol', 'p2HistoryCol', 'roundNumCol', 'p3HistoryCol', 'p4HistoryCol'];
for (const count of [1, 2, 3, 4]) {
    const nodes = Object.fromEntries(['x01Main', ...laneIds].map(id => [id, {
        style: {}, classList: { add() {}, remove() {} }, innerHTML: '',
        scrollTop: 0, scrollHeight: 1092,
    }]));
    const sampleGame = { players: Array.from({ length: count }, (_, player) => ({
        history: Array.from({ length: 20 }, (_, r) => (player + 1) * 100 + r + 1)
    })), currentPlayer: 0, completedRounds: 20 };
    const before = JSON.stringify(sampleGame);
    vm.runInNewContext('function renderX01ScoreHistory() {' + rendererSource + '\nrenderX01ScoreHistory();', {
        game: sampleGame, document: { getElementById: id => nodes[id] },
        isCountUpGame: () => false, setTimeout: callback => callback(),
    });
    assert.equal(JSON.stringify(sampleGame), before, 'Rendering mutated records');
    const ids = count === 1 ? ['p1HistoryCol'] : count === 2 ? ['p1HistoryCol', 'p3HistoryCol']
        : count === 3 ? ['p1HistoryCol', 'p2HistoryCol', 'p3HistoryCol']
            : ['p1HistoryCol', 'p2HistoryCol', 'p3HistoryCol', 'p4HistoryCol'];
    ids.forEach((id, player) => {
        const html = nodes[id].innerHTML;
        assert.equal((html.match(/class="score-history-entry/g) || []).length, 21);
        const values = [...html.matchAll(/>(\d+)<\/div>/g)].map(m => Number(m[1]));
        assert.deepEqual(values, sampleGame.players[player].history);
        assert.equal(nodes[id].scrollTop, nodes[id].scrollHeight);
    });
    assert.equal(nodes.roundNumCol.scrollTop, nodes.roundNumCol.scrollHeight);
    assert.equal((nodes.roundNumCol.innerHTML.match(/class="round-number/g) || []).length, 21);
}
pass('actual history renderer retains 20 chronological turns per player and scrolls every lane to newest');

function luminance(hex) {
    const n = parseInt(hex.slice(1), 16);
    const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => {
        v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
    });
    return .2126*c[0] + .7152*c[1] + .0722*c[2];
}
const contrasts = [
    ['score', '#f5f7fc', '#20354c'], ['key', '#f5f7fc', '#303c4b'],
    ['quick key', '#b9ddff', '#24405d'], ['history', '#e5edf8', '#252e39'],
    ['history heading', '#bfccdc', '#1d242d'], ['bust history', '#ffcfad', '#4f362b'],
    ['miss history', '#d4deed', '#252e39'], ['Enter', '#ffffff', '#286eb7'],
    ['Cricket Undo', '#f5f7fc', '#805029'], ['Cricket mark', '#8cc8ff', '#20354c'],
    ['121 darts warning', '#d9823c', '#1d242d'],
    ['121 new-record row', '#f5f7fc', '#24476b'],
].map(([name, fg, bg]) => {
    const a=luminance(fg), b=luminance(bg), ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    assert.ok(ratio >= 4.5, `${name} contrast ${ratio}`);
    return `${name} ${ratio.toFixed(2)}:1`;
});
pass('declared main text color pairs meet 4.5:1: ' + contrasts.join(', '));
console.log(`\n${passed}/${passed} static/unit groups passed. No browser, touch, layout, offline-runtime, or scoring-regression pass is implied.`);
