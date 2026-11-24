// Real DEV scorer, HTML controls, history and local saves in an isolated DOM.
// Run: node --experimental-vm-modules dev/tests/x01_miss_guard_test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const { JSDOM, VirtualConsole } = createRequire(import.meta.url)(
    process.env.BLAKEOUT_JSDOM_MODULE || 'jsdom'
);
const dev = new URL('../', import.meta.url);

async function setup() {
    const errors = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', error => errors.push(error));
    const dom = new JSDOM(fs.readFileSync(new URL('index.html', dev), 'utf8'), {
        url: 'https://example.test/dev/',
        runScripts: 'outside-only',
        virtualConsole
    });
    const w = dom.window;
    let now = 0;
    let nextId = 0;
    const timers = new Map();
    const alerts = [];
    Object.assign(w, {
        structuredClone,
        fetch() { throw Error('Network forbidden'); },
        alert(message) { alerts.push(message); },
        setTimeout(fn, ms) { timers.set(++nextId, { at: now + ms, fn }); return nextId; },
        clearTimeout(id) { timers.delete(id); }
    });
    const clockTo = ms => {
        assert.ok(ms >= now);
        while (true) {
            const next = [...timers].filter(([, timer]) => timer.at <= ms)
                .sort(([, a], [, b]) => a.at - b.at)[0];
            if (!next) break;
            timers.delete(next[0]);
            now = next[1].at;
            next[1].fn();
        }
        now = ms;
    };
    const context = dom.getInternalVMContext();
    const files = new Map();
    function source(url) {
        if (files.has(url.href)) return files.get(url.href);
        const module = new vm.SourceTextModule(fs.readFileSync(url, 'utf8'), {
            context,
            identifier: url.href,
            initializeImportMeta(meta) {
                meta.url = 'https://example.test/dev/' + url.href.slice(dev.href.length);
            },
            importModuleDynamically() { throw Error('Unexpected dynamic import'); }
        });
        files.set(url.href, module);
        return module;
    }
    const entry = source(new URL('js/x01.js', dev));
    await entry.link((specifier, caller) => source(new URL(specifier, caller.identifier)));
    await entry.evaluate();
    const state = source(new URL('js/state.js', dev)).namespace;
    const records = source(new URL('js/scoring-records.js', dev)).namespace;
    const get = id => w.document.getElementById(id);
    const players = () => ['One', 'Two', 'Three']
        .map((name, n) => ({ id: 'p' + n, name, score: 501, history: [] }));
    const start = extra => {
        state.resetGameState({ type: '501', players: players(), ...extra });
        get('x01Controls').classList.remove('hidden');
        entry.namespace.resetX01Input();
        entry.namespace.updateX01Display();
    };
    entry.namespace.initX01Controls();
    start();
    // Deliberately deliver pointerdown even on disabled/hidden controls to
    // cover already queued or unusual touch events at the handler boundary.
    const tap = target => (typeof target === 'string' ? get(target) : target)
        .dispatchEvent(new w.PointerEvent('pointerdown', {
            bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true
        }));
    return { dom, w, errors, alerts, state, records, get, start, tap, clockTo };
}

async function check(name, fn) {
    const t = await setup();
    try {
        await fn(t);
        assert.deepEqual(t.errors, []);
        console.log('PASS ' + name);
    } finally {
        t.dom.window.close();
    }
}
const MISS = 'x01MissBtn', ENTER = 'x01EnterBtn', BUST = 'x01BustBtn';
const counts = state => Array.from(state.game.players, p => p.history.length);

await check('0/350/900/1499 ms MISS burst advances once; 1500 ms re-arms', ({ tap, clockTo, state, get }) => {
    tap(MISS);
    for (const ms of [350, 900, 1499]) {
        clockTo(ms);
        assert.equal(get(MISS).disabled, true);
        tap(MISS);
        assert.equal(state.game.currentPlayer, 1);
        assert.deepEqual(counts(state), [1, 0, 0]);
        assert.equal(state.game.undoHistory.length, 1);
        assert.equal(state.loadActiveGame().players[1].history.length, 0);
    }
    assert.equal(state.game.players[0].history[0].miss, true);
    assert.equal(state.game.players[0].score, 501);
    assert.match(get('p1HistoryCol').textContent, /MISS/);
    clockTo(1500);
    assert.equal(get(MISS).disabled, false);
    tap(MISS);
    assert.equal(state.game.currentPlayer, 2);
    assert.deepEqual(counts(state), [1, 1, 0]);
});

await check('normal ENTER re-arms at 700 ms; ignored MISS leaves live typing and persisted draft intact', ({ tap, clockTo, state, get, w }) => {
    tap(MISS);
    clockTo(400);
    for (const digit of ['6', '0']) tap(w.document.querySelector('#x01Controls [data-digit="' + digit + '"]'));
    clockTo(699);
    assert.equal(get(ENTER).disabled, true);
    assert.equal(get(BUST).disabled, true);
    tap(MISS);
    assert.equal(get('inputDisplay').textContent, '60');
    assert.equal(state.loadActiveGame().x01Input.expressionStr, '60');
    clockTo(700);
    assert.equal(get(ENTER).disabled, false);
    assert.equal(get(BUST).disabled, false);
    assert.equal(get(MISS).disabled, true);
    tap(MISS);
    assert.equal(get('inputDisplay').textContent, '60');
    tap(ENTER);
    assert.equal(state.game.players[1].score, 441);
    assert.deepEqual(counts(state), [1, 1, 0]);
    assert.equal(state.game.currentPlayer, 2);
    clockTo(1399);
    assert.equal(get(ENTER).disabled, true);
    clockTo(1400);
    assert.equal(get(ENTER).disabled, false);
    assert.equal(get(MISS).disabled, true);
});

await check('MISS timer cannot unlock a normal turn’s overlapping guard', ({ tap, clockTo, state, get }) => {
    tap(MISS);
    clockTo(1450);
    tap(BUST);
    assert.equal(state.game.players[1].history[0].bust, true);
    clockTo(1500);
    assert.equal(get(MISS).disabled, true);
    tap(MISS);
    assert.deepEqual(counts(state), [1, 1, 0]);
    clockTo(2150);
    assert.equal(get(MISS).disabled, false);
    tap(MISS);
    assert.deepEqual(counts(state), [1, 1, 1]);
    assert.equal(state.game.completedRounds, 1);
});

await check('recorded turn requests actual darts, then stores one miss without consuming the next selection',
        ({ start, tap, state, records, get, alerts, clockTo, w }) => {
    // The recording bridge normally renders this selector after match start.
    const darts = w.document.createElement('select');
    darts.id = 'tournamentActualDarts';
    darts.innerHTML = '<option value="">Choose</option><option value="2">2</option><option value="3">3</option>';
    w.document.querySelector('#x01Controls').append(darts);
    start({ recording: { resultId: 'synthetic', gameType: '501', source: 'casual',
        teams: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], legWins: [0, 0, 0] } });
    records.beginScoringLeg('501');
    tap(MISS);
    assert.equal(alerts.length, 1);
    assert.equal(get(MISS).disabled, false);
    assert.deepEqual(counts(state), [0, 0, 0]);
    get('tournamentActualDarts').value = '3';
    tap(MISS);
    assert.equal(state.game.scoringRecords.legs[0].turns.length, 1);
    assert.equal(state.game.scoringRecords.legs[0].turns[0].darts, 3);
    assert.equal(state.game.scoringRecords.legs[0].turns[0].points, 0);
    assert.equal(state.game.scoringRecords.legs[0].turns[0].teamId, 'a');
    assert.equal(get('tournamentActualDarts').value, '');
    get('tournamentActualDarts').value = '2';
    clockTo(900);
    tap(MISS);
    assert.equal(state.game.scoringRecords.legs[0].turns.length, 1);
    assert.equal(get('tournamentActualDarts').value, '2');
    assert.equal(alerts.length, 1);
});
