/** Local-only preference/module and declared-token acceptance tests.
 * Run: node --experimental-vm-modules dev/tests/platform_appearance_test.mjs
 * No browser, network, account provider, or persistent storage is used.
 * Contrast is calculated from declared sRGB tokens, not browser rendering.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const dev = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(dev, file), 'utf8');
const modes = ['modern', 'classic', 'dc', 'dot-better'];
const themes = ['blue', 'red', 'neon', 'sunburst', 'volt', 'inferno', 'miami', 'grape', 'aqua', 'royal', 'shamrock', 'arctic'];
let passed = 0;
function pass(label) { console.log(`PASS ${label}`); passed++; }

async function boot({ theme, mode, feature = 'accounts', unavailableStorage = false, unlocked = false, failImport = false } = {}) {
    const storage = new Map([
        ['blakeout_dev_active_game', '{"unchanged":true}'],
        ['blakeout_dev_profile', '{"unchanged":true}'],
    ]);
    if (theme !== undefined) storage.set('blakeout_theme', theme);
    if (mode !== undefined) storage.set('blakeout_x01_skin', mode);
    const attributes = new Map(), imports = [], events = [], notices = [];
    let domReads = 0, clones = 0, removed = 0;
    const root = { setAttribute: (name, value) => attributes.set(name, value) };
    const document = {
        documentElement: root,
        body: { dataset: { appFeature: feature } },
        dispatchEvent: event => events.push(event),
        getElementById(id) {
            domReads++;
            if (id === 'featurePageTemplate') return { content: { cloneNode: () => { clones++; return {}; } }, remove: () => removed++ };
            if (id === 'featureUnavailableShell') return { replaceWith() {} };
            throw new Error(`Unexpected UI dependency: ${id}`);
        },
        createElement: () => ({ setAttribute() {} }),
        querySelector: selector => selector === 'main' ? { prepend: notice => notices.push(notice) } : null,
    };
    const context = vm.createContext({ document,
        CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
        localStorage: {
            getItem(key) { if (unavailableStorage) throw new Error('Storage disabled'); return storage.get(key) ?? null; },
            setItem(key, value) { if (unavailableStorage) throw new Error('Storage disabled'); storage.set(key, value); },
        },
    });
    const allowed = new Set(['feature-page.js', 'feature-availability.js', 'feature-appearance.js', 'theme.js', 'score-appearance.js']);
    const cache = new Map();
    function module(file) {
        assert.ok(allowed.has(file), `Appearance must not import scorer, UI, or providers: ${file}`);
        if (!cache.has(file)) {
            const source = file === 'feature-availability.js' && unlocked
                ? 'export const isFeatureAvailable = () => true;'
                : read(`js/${file}`);
            cache.set(file, new vm.SourceTextModule(source, { context, identifier: file,
                importModuleDynamically: async specifier => {
                    imports.push(specifier);
                    if (failImport) throw new Error('Fixture import failure');
                    const loaded = new vm.SyntheticModule([], () => {}, { context });
                    await loaded.link(() => {}); await loaded.evaluate();
                    return loaded;
                },
            }));
        }
        return cache.get(file);
    }
    const entry = module('feature-page.js');
    await entry.link(specifier => module(specifier.replace('./', '')));
    await entry.evaluate();
    await new Promise(resolve => setImmediate(resolve));
    return { storage, attributes, imports, events, notices, domReads, clones, removed, cache };
}

for (const feature of ['accounts', 'brackets']) {
    for (const theme of themes) for (const mode of modes) {
        const result = await boot({ theme, mode, feature });
        assert.equal(result.attributes.get('data-theme'), theme);
        assert.equal(result.attributes.get('data-scoreboard-mode'), mode);
        assert.equal(result.attributes.get('data-x01-skin'), mode);
        assert.equal(result.domReads, 0);
        assert.deepEqual(result.imports, []);
        assert.equal(result.storage.size, 4);
        assert.equal(result.storage.get('blakeout_dev_active_game'), '{"unchanged":true}');
        assert.equal(result.storage.get('blakeout_dev_profile'), '{"unchanged":true}');
        assert.equal(result.storage.get('blakeout_x01_skin'), mode);
        assert.equal(result.events.length, 1);
    }
}
pass('both locked routes restore all 12 themes × 4 styles without feature UI, provider imports, or unrelated storage writes');

for (const fixture of [{}, { theme: 'bad', mode: 'bad' }, { theme: 'arctic', mode: 'dc', unavailableStorage: true }]) {
    const result = await boot(fixture);
    assert.equal(result.attributes.get('data-theme'), 'blue');
    assert.equal(result.attributes.get('data-scoreboard-mode'), 'modern');
    assert.equal(result.domReads, 0);
}
const appearanceSource = read('js/score-appearance.js');
assert.doesNotMatch(appearanceSource, /^import\s/m);
assert.equal((appearanceSource.match(/blakeout_x01_skin/g) || []).length, 1);
assert.doesNotMatch(read('js/settings.js'), /const\s+(SKIN_KEY|DEFAULT_SKIN)/);
pass('missing, invalid, or blocked storage has safe existing defaults; preference helper is dependency-free and key is canonical');

for (const feature of ['accounts', 'brackets']) {
    const result = await boot({ theme: 'arctic', mode: 'dot-better', feature, unlocked: true, failImport: true });
    assert.deepEqual(result.imports, [feature === 'accounts' ? './accounts-page.js' : './brackets/page.js']);
    assert.equal(result.clones, 1);
    assert.equal(result.removed, 1);
    assert.equal(result.notices.length, 1);
    assert.equal(result.notices[0].className, 'platform-notice platform-error');
    assert.equal(result.attributes.get('data-scoreboard-mode'), 'dot-better');
}
pass('enabled test fixtures preserve the entrypoint gate and render a shared themed error after an import failure');

// Small source-token evaluator: it handles exactly the selectors/custom color
// syntax used by these shared sheets. It is not a browser cascade/layout test.
function selectors(value) {
    const result = []; let depth = 0, start = 0;
    [...value].forEach((char, i) => {
        if (char === '(') depth++;
        if (char === ')') depth--;
        if (char === ',' && !depth) { result.push(value.slice(start, i).trim()); start = i + 1; }
    });
    result.push(value.slice(start).trim());
    return result;
}
function rules(source) {
    source = source.replace(/\/\*[\s\S]*?\*\//g, '');
    return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(match => ({
        selectors: selectors(match[1].trim()),
        declarations: Object.fromEntries([...match[2].matchAll(/(--[\w-]+|color-scheme):\s*([^;]+);/g)]
            .map(item => [item[1], item[2].trim()])),
    }));
}
const sheets = ['css/variables.css', 'css/scoreboard-palettes.css', 'css/platform.css'].flatMap(file => rules(read(file)));
function matches(selector, theme, mode, target) {
    if (target === 'root') return selector === ':root' || selector === `:root[data-theme="${theme}"]`;
    if (selector === '.platform-page' || selector === 'body.platform-page') return true;
    if (!selector.startsWith(':root') || !selector.endsWith(' .platform-page') || selector.includes('#gameScreen')) return false;
    const requestedThemes = [...selector.matchAll(/data-theme="([\w-]+)"/g)].map(match => match[1]);
    const requestedModes = [...selector.matchAll(/data-scoreboard-mode="([\w-]+)"/g)].map(match => match[1]);
    return (!requestedThemes.length || requestedThemes.includes(theme)) && (!requestedModes.length || requestedModes.includes(mode));
}
function tokens(theme, mode) {
    const result = {};
    for (const target of ['root', 'body']) for (const rule of sheets) {
        if (rule.selectors.some(selector => matches(selector, theme, mode, target))) Object.assign(result, rule.declarations);
    }
    return result;
}
function color(value, values, seen = new Set()) {
    if (value.startsWith('var(')) {
        const name = value.slice(4, -1);
        assert.ok(!seen.has(name), `Cyclic token ${name}`);
        assert.ok(values[name], `Missing token ${name}`);
        return color(values[name], values, new Set([...seen, name]));
    }
    if (value.startsWith('color-mix(')) {
        const pieces = selectors(value.slice('color-mix('.length, -1));
        assert.equal(pieces[0], 'in srgb');
        const [, left, percentage] = pieces[1].match(/^(.*) (\d+)%$/);
        const a = color(left, values, seen), b = color(pieces[2], values, seen), weight = Number(percentage) / 100;
        return a.map((channel, i) => channel * weight + b[i] * (1 - weight));
    }
    assert.match(value, /^#[\da-f]{3}(?:[\da-f]{3})?$/i);
    const hex = value.length === 4 ? value.slice(1).split('').map(c => c + c).join('') : value.slice(1);
    return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
}
function luminance(channels) {
    return channels.map(channel => channel / 255).map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
        .reduce((sum, channel, i) => sum + channel * [.2126, .7152, .0722][i], 0);
}
function ratio(a, b) { const [low, high] = [luminance(a), luminance(b)].sort((a, b) => a - b); return (high + .05) / (low + .05); }
let minimumText = Infinity, minimumOutcome = Infinity;
for (const theme of themes) for (const mode of modes) {
    const values = tokens(theme, mode), resolved = name => color(`var(${name})`, values);
    assert.equal(values['color-scheme'], theme === 'arctic' && !['dc', 'dot-better'].includes(mode) ? 'light' : 'dark');
    const pairs = [
        ['--color-text', '--color-bg'], ['--color-text', '--color-surface'],
        ['--color-text', '--color-surface-alt'], ['--color-text-muted', '--color-surface-alt'],
        ['--platform-button-ink', '--platform-button-bg'], ['--platform-link', '--color-surface'],
        ['--platform-warning-text', '--color-surface'], ['--platform-success-text', '--color-surface'],
        ['--platform-danger-text', '--platform-error-bg'], ['--color-text', '--platform-notice-bg'],
    ];
    for (const [ink, surface] of pairs) {
        const contrast = ratio(resolved(ink), resolved(surface));
        minimumText = Math.min(minimumText, contrast);
        assert.ok(contrast >= 4.5, `${theme}/${mode} ${ink} on ${surface}: ${contrast.toFixed(2)}:1`);
    }
    for (const token of ['--platform-success-border', '--platform-danger-border', '--platform-focus']) {
        const contrast = ratio(resolved(token), resolved('--color-surface'));
        minimumOutcome = Math.min(minimumOutcome, contrast);
        assert.ok(contrast >= 3, `${theme}/${mode} ${token} non-text contrast: ${contrast.toFixed(2)}:1`);
    }
    assert.deepEqual(resolved('--platform-success-border'), [37, 137, 66]);
    assert.deepEqual(resolved('--platform-danger-border'), [208, 71, 71]);
}
pass(`48 declared palettes meet text/action/status contrast (minimum ${minimumText.toFixed(2)}:1) and focus/outcome contrast (minimum ${minimumOutcome.toFixed(2)}:1)`);

const platform = read('css/platform.css');
assert.equal((platform.match(/#[\da-f]{3,8}\b/gi) || []).length, 2, 'Only fixed semantic outcome outlines may define literals');
for (const feature of ['accounts', 'brackets']) {
    const html = read(`${feature}/index.html`);
    assert.equal((html.match(/href="\.\.\/css\/scoreboard-palettes\.css"/g) || []).length, 1);
    assert.ok(html.indexOf('variables.css') < html.indexOf('scoreboard-palettes.css'));
    assert.ok(html.indexOf('scoreboard-palettes.css') < html.indexOf('platform.css'));
}
for (const marker of ['.platform-error', '.platform-empty', '.platform-page dialog', '.platform-page :focus-visible', '.platform-page .feature-unavailable .back-to-scoring']) assert.ok(platform.includes(marker));
assert.ok(read('js/feature-availability.js').includes('accounts: false'));
assert.ok(read('js/feature-availability.js').includes('brackets: false'));
pass('shared components cover error/empty/app-owned dialog/focus/actions; native prompts remain browser-owned and flags remain closed');
console.log(`\n${passed}/${passed} platform appearance groups passed. Browser, touch, layout, and live backend verification remain separate.`);
