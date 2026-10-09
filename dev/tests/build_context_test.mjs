/** Source/unit checks; no browser, external accounts, or real storage.
 * Run: node --experimental-vm-modules dev/tests/build_context_test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const dev = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => fs.readFileSync(path.join(dev, name), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
let passed = 0;
function pass(name) { passed++; console.log(`PASS ${name}`); }

function storageFixture(entries = []) {
    const data = new Map(entries);
    const access = [];
    const methods = {
        getItem(key) { access.push(['get', key]); return data.get(String(key)) ?? null; },
        setItem(key, value) { access.push(['set', key]); data.set(String(key), String(value)); },
        removeItem(key) { access.push(['remove', key]); data.delete(String(key)); },
        key(index) { return [...data.keys()][index] ?? null; }
    };
    const storage = new Proxy({}, {
        get(_, key) { return key === 'length' ? data.size : methods[key] || data.get(key); },
        ownKeys() { return [...data.keys()]; },
        getOwnPropertyDescriptor(_, key) {
            return data.has(key) ? { enumerable: true, configurable: true } : undefined;
        }
    });
    return { data, access, storage };
}

async function modules(base, fixture = storageFixture()) {
    const context = vm.createContext({ URL, console, localStorage: fixture.storage,
        document: { dispatchEvent() {} }, CustomEvent: class { constructor(type) { this.type = type; } },
        setTimeout, clearTimeout, Date, Math });
    const create = name => new vm.SourceTextModule(read(`js/${name}.js`), {
        context, identifier: `${base}js/${name}.js`,
        initializeImportMeta(meta) { meta.url = `${base}js/${name}.js`; }
    });
    const build = create('build-context');
    await build.link(() => { throw new Error('Unexpected build-context dependency'); });
    await build.evaluate();
    const state = create('state');
    await state.link(specifier => {
        assert.equal(specifier, './build-context.js');
        return build;
    });
    await state.evaluate();
    return { build: build.namespace, state: state.namespace, fixture };
}

function snapshot(extra = {}) {
    return {
        type: '501', players: [
            { name: 'Home', score: 267, throws: 3, totalMarks: 0, history: [60, 84, 90], rosterEmail: 'home@example.test' },
            { name: 'Away', score: 401, throws: 2, totalMarks: 0, history: [60, 40] }
        ], currentPlayer: 1, currentInput: '', cricketPoints: true, cricketTargets: [],
        finishType: 'double-out', pendingDarts: [], completedRounds: 2,
        teamMode: true, teams: [
            { name: 'Home', members: [{ name: 'Alex', rosterEmail: 'alex@example.test' }], rotationIndex: 0 },
            { name: 'Away', members: [{ name: 'Sam' }, { name: 'Lee' }], rotationIndex: 1 }
        ], timestamp: 123456789, ...extra
    };
}

const untouched = [
    ['blakeout_dev_active_game', JSON.stringify(snapshot({ currentInput: 'dev-sentinel' }))],
    ['blakeout_dev_active_game_imported', 'dev-marker'],
    ['blakeout_dev_match_pending', '{"sentinel":"match"}'],
    ['blakeout_dev_casual_pending', '{"sentinel":"casual"}'],
    ['blakeout_dev_casual_history', '[{"resultId":"kept"}]'],
    ['blakeout_configs', '{"lastConfig":{"gameType":"301"},"savedConfigs":[]}'],
    ['blakeout_roster_id', '0123456789abcdef0123456789abcdef'],
    ['blakeout_x01_skin', 'dot-better'],
    ['blakeout_theme', 'red'],
    ['blakeout_wallpaper', '{"type":"none"}'],
    ['blakeout_121_leaderboard', '[{"name":"Alex","score":121}]']
];

for (const [base, isDev] of [
    ['https://example.test/', false], ['https://example.test/dev/', true],
    ['https://example.test/Darts/', false], ['https://example.test/Darts/dev/', true],
    ['https://example.test/development/', false]
]) {
    const { build } = await modules(base);
    assert.equal(build.APP_BASE_URL, base);
    assert.equal(build.IS_DEV_BUILD, isDev);
    assert.equal(build.BUILD_STORAGE.activeGame, isDev ? 'blakeout_dev_active_game' : 'blakeout_active_game');
    assert.equal(build.BUILD_STORAGE.legacyImport, isDev ? 'blakeout_dev_active_game_imported' : null);
    assert.ok(Object.isFrozen(build.BUILD_STORAGE));
}
pass('module URL determines root/DEV storage and exact app scope');

{
    const raw = JSON.stringify(snapshot({ currentInput: '60' }));
    const fixture = storageFixture([['blakeout_active_game', raw], ...untouched]);
    const { state } = await modules('https://example.test/', fixture);
    const loaded = state.loadActiveGame();
    assert.equal(fixture.data.get('blakeout_active_game'), raw, 'load must not rewrite the legacy save');
    state.restoreActiveGame(loaded);
    assert.equal(state.game.currentInput, '60');
    assert.equal(state.game.x01Input, null, 'do not reinterpret an already committed legacy quick score');
    assert.equal(state.saveActiveGame(), true);
    const saved = JSON.parse(fixture.data.get('blakeout_active_game'));
    for (const key of ['players', 'teams', 'currentPlayer', 'currentInput', 'pendingDarts', 'completedRounds', 'finishType']) {
        assert.deepEqual(saved[key], JSON.parse(raw)[key], key);
    }
    state.clearActiveGame();
    assert.equal(state.loadActiveGame(), null, 'production must not fall back to DEV');
    for (const [key, value] of untouched) assert.equal(fixture.data.get(key), value, key);
    assert.ok(!fixture.access.some(([, key]) => key?.startsWith('blakeout_dev_')), 'production must not read or mutate DEV values');
    assert.ok(!fixture.data.has('null') && !fixture.data.has('undefined'));
}
pass('production load/save/clear retains legacy data and leaves all DEV/settings/roster/records keys untouched');

{
    const fixture = storageFixture(untouched);
    const { state } = await modules('https://example.test/', fixture);
    assert.equal(state.loadActiveGame(), null);
    assert.equal(fixture.data.has('blakeout_active_game'), false);
    assert.equal(fixture.access.length, 1);
    assert.deepEqual(fixture.access[0], ['get', 'blakeout_active_game']);
}
pass('absent production save never imports DEV or writes an import marker');

{
    const raw = JSON.stringify(snapshot());
    const fixture = storageFixture([['blakeout_active_game', raw]]);
    const { state } = await modules('https://example.test/dev/', fixture);
    assert.equal(state.loadActiveGame().players[0].score, 267);
    assert.equal(fixture.data.get('blakeout_dev_active_game'), raw, 'one-time import is byte-for-byte');
    assert.equal(fixture.data.get('blakeout_dev_active_game_imported'), '1');
    state.restoreActiveGame(state.loadActiveGame());
    state.game.players[0].score = 207;
    assert.equal(state.saveActiveGame(), true);
    assert.equal(fixture.data.get('blakeout_active_game'), raw);
    assert.equal(state.loadActiveGame().players[0].score, 207);
    state.clearActiveGame();
    assert.equal(state.loadActiveGame(), null, 'cleared DEV game must not reimport production');
    assert.equal(fixture.data.get('blakeout_active_game'), raw);
}
pass('DEV legacy import stays one-time, byte-preserving, and production-read-only');

for (const legacy of ['not JSON', 'null', '{"type":"501","players":[]}']) {
    const fixture = storageFixture([['blakeout_active_game', legacy]]);
    const { state } = await modules('https://example.test/dev/', fixture);
    assert.equal(state.loadActiveGame(), null);
    assert.equal(fixture.data.get('blakeout_active_game'), legacy);
    assert.equal(fixture.data.has('blakeout_dev_active_game'), false);
}
{
    const raw = JSON.stringify(snapshot());
    const devRaw = JSON.stringify(snapshot({ currentInput: 'existing DEV' }));
    const fixture = storageFixture([['blakeout_active_game', raw], ['blakeout_dev_active_game', devRaw]]);
    const { state } = await modules('https://example.test/dev/', fixture);
    assert.equal(state.loadActiveGame().currentInput, 'existing DEV');
    assert.equal(fixture.data.get('blakeout_dev_active_game'), devRaw);
    assert.equal(fixture.data.get('blakeout_active_game'), raw);
}
pass('invalid legacy snapshots are not imported; existing DEV wins without modifying either snapshot');

for (const base of ['https://example.test/', 'https://example.test/dev/']) {
    const { state, build, fixture } = await modules(base);
    const special = snapshot({
        type: 'chicago', chicago: { currentLeg: 2, currentGameType: 'cricket', gamesRemaining: ['501'], legWins: [1, 0], lastLegWinnerIndex: null },
        pendingDarts: [{ target: '20', multiplier: 3 }],
        x01Input: { expressionStr: '3*19+6+', remainingMode: true },
        minnesotaInput: { target: 'Bed', input: '120' },
        game121: { currentLeg: 2 }, baseball: { inning: 4 }, bermuda: { targetIndex: 3 },
        golf: { currentHole: 5 }, shanghai: { round: 6 }, countUp: { round: 2 }, gotcha: { target: 301 },
        hammer: { round: 2 }, sharkTank: { bites: [1, 2] }, ticTacToe: { board: [null] },
        robinHood: { round: 3 }, doubleDown: { round: 4 }, teamCricket: { round: 5 }
    });
    state.restoreActiveGame(special);
    assert.equal(state.saveActiveGame(), true);
    const loaded = state.loadActiveGame();
    for (const [key, value] of Object.entries(special)) {
        if (key !== 'timestamp') assert.deepEqual(plain(loaded[key]), value, `${base} ${key}`);
    }
    assert.equal(JSON.parse(fixture.data.get(build.BUILD_STORAGE.activeGame)).x01Input.expressionStr, '3*19+6+');
}
pass('both builds round-trip scores, teams, pending darts, engine states, explicit expression and remaining mode');

for (const base of ['https://example.test/', 'https://example.test/dev/']) {
    const ownDev = base.endsWith('/dev/');
    const otherPrefix = ownDev ? 'blakeout_' : 'blakeout_dev_';
    const otherPending = JSON.stringify(snapshot({ recording: { source: 'casual', resultId: 'other', status: 'pending' } }));
    const otherSaved = JSON.stringify(snapshot({ recording: { source: 'casual', resultId: 'other-saved', status: 'saved' } }));
    const fixture = storageFixture([
        [`${otherPrefix}casual_other`, otherPending], [`${otherPrefix}match_other-saved`, otherSaved],
        [`${otherPrefix}active_game`, otherPending]
    ]);
    if (ownDev) fixture.data.set('blakeout_dev_active_game_imported', '1');
    const { state, build } = await modules(base, fixture);
    assert.equal(state.localRecordingRecoveries('casual').length, 0);
    const pending = snapshot({ recording: { source: 'casual', resultId: 'own', status: 'pending', pendingResult: { records: { legs: [] } } }, scoringRecords: { id: 'own', legs: [] } });
    state.restoreActiveGame(pending);
    assert.equal(state.saveActiveGame(), true);
    const recoveryKey = build.BUILD_STORAGE.casualRecoveryPrefix + 'own';
    assert.ok(fixture.data.has(recoveryKey));
    assert.equal(state.localRecordingRecoveries('casual').length, 1);
    assert.equal(state.loadActiveGame().recording.pendingResult.records.id, 'own');
    state.game.recording.status = 'saved';
    assert.equal(state.saveActiveGame(), true);
    assert.equal(fixture.data.has(recoveryKey), false);
    assert.equal(fixture.data.get(`${otherPrefix}casual_other`), otherPending);
    assert.equal(fixture.data.get(`${otherPrefix}match_other-saved`), otherSaved);
    assert.equal(fixture.data.get(`${otherPrefix}active_game`), otherPending);
}
pass('recording recovery and pruning stay within their build and preserve the other build’s active/pending/saved data');

for (const [base, ownNames] of [
    ['https://example.test/', ['blakeout-v38', 'blakeout-v39-production']],
    ['https://example.test/dev/', ['blakeout-dev-v54-winner', 'blakeout-dev-v55-gates']]
]) {
    const { build } = await modules(base);
    const names = ['blakeout-v38', 'blakeout-v39-production', 'blakeout-dev-v54-winner', 'blakeout-dev-v55-gates', 'other-app-v1', 'blakeout-assets'];
    const deleted = [];
    await build.clearBuildCaches({ keys: async () => names, delete: async key => { deleted.push(key); return true; } });
    assert.deepEqual(deleted, ownNames);
    const own = { scope: base };
    const unrelated = [{ scope: 'https://example.test/dev/sub-app/' }, { scope: 'https://other.test/' }];
    const root = { scope: 'https://example.test/' }, devReg = { scope: 'https://example.test/dev/' };
    assert.equal(await build.getBuildServiceWorker({ getRegistrations: async () => [...unrelated, base.endsWith('/dev/') ? root : devReg, own] }), own);
    assert.equal(await build.getBuildServiceWorker({ getRegistrations: async () => [...unrelated, base.endsWith('/dev/') ? root : devReg] }), null);
}
pass('cache deletion targets only own cache family; SW selection requires exact same-origin app scope');

const app = read('js/app.js');
assert.equal((app.match(/await clearBuildCaches\(caches\)/g) || []).length, 2);
assert.equal((app.match(/await getBuildServiceWorker\(navigator.serviceWorker\)/g) || []).length, 2);
assert.ok(!app.includes('caches.delete(') && !app.includes('getRegistrations()'));
assert.match(app, /register\(new URL\('sw\.js', APP_BASE_URL\)\.href, \{ scope: APP_BASE_URL \}\)/);
pass('both Update buttons and registration use the audited build-scoped helpers');

console.log(`\n${passed}/${passed} source/unit groups passed (not browser validation)`);
