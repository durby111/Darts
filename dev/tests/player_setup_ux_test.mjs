// Player setup UX: recent-name suggestions and throw-order controls.
// jsdom check of the real dev/index.html + dev/js/setup.js with every other
// module stubbed. It does not prove rendered layout or real touch behavior.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

import { createRequire } from 'node:module';
const { JSDOM } = createRequire(import.meta.url)(process.env.BLAKEOUT_JSDOM_MODULE || 'jsdom');
const file = name => readFile(new URL(name, import.meta.url), 'utf8');

class MemoryStorage {
    constructor() { this.map = new Map(); }
    getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
    setItem(k, v) { this.map.set(k, String(v)); }
    removeItem(k) { this.map.delete(k); }
    get length() { return this.map.size; }
    key(i) { return [...this.map.keys()][i] ?? null; }
}

async function loadNames(storage = new MemoryStorage(), isDev = true) {
    const context = vm.createContext({ localStorage: storage, globalThis: { localStorage: storage } });
    const build = new vm.SyntheticModule(['IS_DEV_BUILD'], function () { this.setExport('IS_DEV_BUILD', isDev); }, { context });
    const mod = new vm.SourceTextModule(await file('../js/player-names.js'), { context });
    await mod.link(spec => { assert.equal(spec, './build-context.js'); return build; });
    await mod.evaluate();
    return { names: mod.namespace, storage };
}

test('recent names: build-scoped key, newest first, de-duped, defaults skipped, capped', async () => {
    const { names, storage } = await loadNames();
    const list = () => [...names.getRecentNames()];
    assert.equal(names.RECENT_NAMES_KEY, 'blakeout_dev_recent_player_names');
    names.rememberNames(['Mike', 'Home', 'Away', 'Player 3', 'BotBlake 2', '  Blake  ']);
    names.rememberNames(['mike', 'Jo']);
    assert.deepEqual(list(), ['mike', 'Jo', 'Blake']);
    names.rememberNames(Array.from({ length: 20 }, (_, i) => `P${i}`));
    assert.equal(names.getRecentNames().length, names.RECENT_NAMES_MAX);
    names.clearRecentNames();
    assert.deepEqual(list(), []);
    storage.setItem(names.RECENT_NAMES_KEY, '{not json');
    assert.deepEqual(list(), []);
    const prod = await loadNames(new MemoryStorage(), false);
    assert.equal(prod.names.RECENT_NAMES_KEY, 'blakeout_recent_player_names');
});

test('suggestions: prefix before word-start, excludes other slots and exact match, empty shows recents', async () => {
    const { names: n } = await loadNames();
    const names = { suggestNames: (...a) => [...n.suggestNames(...a)] };
    const pool = ['Mike D', 'Big Mike', 'Mikey', 'Jo', 'Blake', 'mike d'];
    assert.deepEqual(names.suggestNames('mi', pool), ['Mike D', 'Mikey', 'Big Mike']);
    assert.deepEqual(names.suggestNames('mi', pool, { exclude: ['Mikey'] }), ['Mike D', 'Big Mike']);
    assert.deepEqual(names.suggestNames('Mikey', pool), []);
    assert.deepEqual(names.suggestNames('', pool, { limit: 2 }), ['Mike D', 'Big Mike']);
    assert.deepEqual(names.suggestNames('zz', pool), []);
});

async function setupFixture({ recent = [], configs = { lastConfig: null, savedConfigs: [] } } = {}) {
    const html = await file('../index.html');
    const dom = new JSDOM(html, { url: 'https://blakeoutdarts.com/dev/', pretendToBeVisual: true, runScripts: 'outside-only' });
    const { window } = dom;
    const context = dom.getInternalVMContext();
    const source = await file('../js/setup.js');
    const realNames = new vm.SourceTextModule(await file('../js/player-names.js'), { context });
    const imports = [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)];
    const stubs = new Map();
    const overrides = {
        getConfigs: () => configs, getRosterCache: () => [], onRosterChange: () => () => {},
        initFirebase: () => Promise.resolve(), getInitState: () => ({ state: 'error' }),
        loadActiveGame: () => null, findPlayerByName: () => null, recordingSession: () => null,
        supportsBot: () => true, getGame: () => ({ minPlayers: 1, maxPlayers: 4 })
    };
    for (const [, list, spec] of imports) {
        if (spec === './player-names.js') continue;
        const exportNames = list.split(',').map(s => s.trim()).filter(Boolean);
        stubs.set(spec, new vm.SyntheticModule(exportNames, function () {
            for (const name of exportNames) this.setExport(name, overrides[name] || (() => undefined));
        }, { context }));
    }
    const build = new vm.SyntheticModule(['IS_DEV_BUILD'], function () { this.setExport('IS_DEV_BUILD', true); }, { context });
    await realNames.link(() => build);
    const setup = new vm.SourceTextModule(source, { context });
    await setup.link(spec => spec === './player-names.js' ? realNames : stubs.get(spec));
    await setup.evaluate();
    // Seed recents in the page's own localStorage (jsdom provides one per origin).
    window.localStorage.clear();
    if (recent.length) window.localStorage.setItem('blakeout_dev_recent_player_names', JSON.stringify(recent));
    setup.namespace.initSetupControls();
    return { window, document: window.document, setup };
}

const names = doc => [1, 2, 3, 4].map(n => doc.getElementById(`player${n}`).value);

test('setup screen: inline recent-name chips fill text only and move to the next default slot', async () => {
    const { document, window } = await setupFixture({ recent: ['Mike', 'Mary', 'Blake'] });
    assert.equal(document.getElementById('player1').hasAttribute('list'), false, 'native datalist popup removed');
    const input = document.getElementById('player1');
    input.focus();
    input.value = 'M';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    const strip = document.getElementById('player1Suggestions');
    assert.equal(strip.hidden, false);
    const chips = [...strip.querySelectorAll('[data-suggested-name]')].map(c => c.textContent);
    assert.deepEqual(chips, ['Mike', 'Mary']);
    strip.querySelector('[data-suggested-name="Mary"]').click();
    assert.equal(input.value, 'Mary');
    assert.equal(strip.hidden, true);
    assert.equal(document.activeElement, document.getElementById('player2'));
    // Slot 2 suggestions leave out the name already used in slot 1.
    const second = [...document.querySelectorAll('#player2Suggestions [data-suggested-name]')].map(c => c.textContent);
    assert.deepEqual(second, ['Mike', 'Blake']);
});

test('setup screen: tap a handle then a destination moves that player; arrows still work', async () => {
    const { document, window } = await setupFixture();
    document.getElementById('numPlayers').value = '4';
    document.getElementById('numPlayers').dispatchEvent(new window.Event('change'));
    ['Alpha', 'Bravo', 'Charlie', 'Delta'].forEach((v, i) => { document.getElementById(`player${i + 1}`).value = v; });
    document.getElementById('player3Skill').value = 'hard';
    const handle = i => document.querySelector(`[data-player-drag-index="${i}"]`);
    handle(2).click();
    assert.ok(document.getElementById('player3Group').classList.contains('player-row--picked'));
    assert.equal(handle(2).getAttribute('aria-pressed'), 'true');
    handle(0).click();
    assert.deepEqual(names(document), ['Charlie', 'Alpha', 'Bravo', 'Delta']);
    assert.equal(document.getElementById('player1Skill').value, 'hard', 'skill moves with the player');
    assert.equal(document.querySelectorAll('.player-row--picked').length, 0);
    // Tapping the same handle twice cancels.
    handle(1).click(); handle(1).click();
    assert.deepEqual(names(document), ['Charlie', 'Alpha', 'Bravo', 'Delta']);
    document.querySelector('#player4Group [data-player-order-action="up"]').click();
    assert.deepEqual(names(document), ['Charlie', 'Alpha', 'Delta', 'Bravo']);
    const numbers = [...document.querySelectorAll('[data-player-order-number]')].map(n => n.textContent);
    assert.deepEqual(numbers, ['1st', '2nd', '3rd', '4th']);
    const labels = [...document.querySelectorAll('[data-player-order-label]')].map(n => n.textContent);
    assert.deepEqual(labels, ['Throws 1st', 'Throws 2nd', 'Throws 3rd', 'Throws 4th']);
});

test('setup screen: Clear recent player names empties only that list', async () => {
    const { document, window } = await setupFixture({ recent: ['Mike'] });
    window.localStorage.setItem('blakeout_configs', '{"lastConfig":null,"savedConfigs":[]}');
    document.getElementById('clearRecentNamesBtn').click();
    assert.equal(window.localStorage.getItem('blakeout_dev_recent_player_names'), null);
    assert.ok(window.localStorage.getItem('blakeout_configs'));
    assert.match(document.getElementById('clearRecentNamesStatus').textContent, /cleared on this device/);
});

test('blocked storage getter/read/write/remove never breaks setup; clear reports failure', async () => {
    const context = vm.createContext({});
    Object.defineProperty(context, 'localStorage', { get() { throw new Error('blocked'); } });
    const build = new vm.SyntheticModule(['IS_DEV_BUILD'], function () { this.setExport('IS_DEV_BUILD', true); }, { context });
    const mod = new vm.SourceTextModule(await file('../js/player-names.js'), { context });
    await mod.link(() => build); await mod.evaluate();
    assert.deepEqual([...mod.namespace.getRecentNames()], []);
    assert.doesNotThrow(() => mod.namespace.rememberNames(['Alpha']));
    assert.equal(mod.namespace.clearRecentNames(), false);
    const { document, window } = await setupFixture({ recent: ['Alpha'] });
    window.Storage.prototype.removeItem = () => { throw new Error('blocked'); };
    document.getElementById('clearRecentNamesBtn').click();
    assert.match(document.getElementById('clearRecentNamesStatus').textContent, /Could not clear/);
    window.close();
});

test('keyboard chip focus survives input blur, Escape closes, presets are not suggestions', async () => {
    const { document: d, window: w } = await setupFixture({ recent: ['Alpha'], configs: { lastConfig: { player1: 'Private preset' }, savedConfigs: [] } });
    const input = d.getElementById('player1'), strip = d.getElementById('player1Suggestions');
    input.focus(); const chip = strip.querySelector('button');
    assert.equal(strip.textContent, 'Alpha'); chip.focus();
    assert.equal(strip.hidden, false); assert.equal(d.activeElement, chip);
    chip.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(strip.hidden, true); assert.equal(d.activeElement, input);
    input.blur(); input.focus(); d.getElementById('clearRecentNamesBtn').click();
    input.blur(); input.focus(); assert.equal(strip.hidden, true);
    assert.equal(strip.textContent, ''); w.close();
});

test('tap selection cancels with Escape or player count change; bot slots do not show chips', async () => {
    const { document: d, window: w } = await setupFixture({ recent: ['Alpha'] });
    const handle = d.querySelector('[data-player-drag-index="0"]');
    handle.click(); d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.equal(handle.getAttribute('aria-pressed'), 'false');
    handle.click(); d.getElementById('numPlayers').dispatchEvent(new w.Event('change'));
    assert.equal(handle.getAttribute('aria-pressed'), 'false');
    handle.click(); d.getElementById('teamMode').checked = true;
    d.getElementById('teamMode').dispatchEvent(new w.Event('change'));
    assert.equal(handle.getAttribute('aria-pressed'), 'false');
    d.getElementById('player1Skill').value = 'hard'; d.getElementById('player1').focus();
    assert.equal(d.getElementById('player1Suggestions').hidden, true); w.close();
});
