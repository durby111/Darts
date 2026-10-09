/** Focused Node VM regression checks, not browser/visual tests.
 * Run: node --experimental-vm-modules dev/tests/feature_recording_gate_test.mjs
 * Repeat with --production to exercise the same source at the root URL.
 * Uses the real bridge, casual, state and scoring-record modules. DOM, navigation,
 * setup/UI dependencies and feature flags are explicit test-only doubles.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const dev = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const production = process.argv.includes('--production');
const baseURL = `https://example.test/${production ? '' : 'dev/'}`;
const prefix = production ? 'blakeout_' : 'blakeout_dev_';
const otherPrefix = production ? 'blakeout_dev_' : 'blakeout_';
const nodes = new Map();
class Element {
    constructor(tag = 'div') {
        this.tagName = tag.toUpperCase(); this.children = []; this.events = new Map();
        this.attributes = new Map(); this.style = {}; this.hidden = false;
        this.disabled = false; this.checked = false; this.textContent = '';
    }
    set id(value) { this._id = value; nodes.set(value, this); }
    get id() { return this._id; }
    append(...children) { children.forEach(child => { child.parentElement = this; this.children.push(child); }); }
    prepend(child) { child.parentElement = this; this.children.unshift(child); }
    before(child) { this.parentElement.append(child); }
    after(child) { this.parentElement.append(child); }
    replaceChildren(...children) { this.children = []; this.append(...children); }
    setAttribute(key, value) { this.attributes.set(key, value); }
    toggleAttribute(key, value) { if (value) this.attributes.set(key, ''); else this.attributes.delete(key); }
    addEventListener(name, fn) { this.events.set(name, [...(this.events.get(name) || []), fn]); }
    async fire(name, event = {}) { for (const fn of this.events.get(name) || []) await fn(event); }
    async click() { if (!this.disabled) await this.fire('click'); }
    querySelector(selector) { return nodes.get(selector.slice(1)) || null; }
    set innerHTML(html) {
        this._html = html; this.children = [];
        for (const match of html.matchAll(/<(\w+)[^>]*\bid="([^"]+)"[^>]*>/g)) {
            const child = new Element(match[1]); child.id = match[2]; this.append(child);
        }
    }
    get innerHTML() { return this._html || ''; }
}
const documentEvents = new Map();
const body = new Element('body');
const document = {
    body, head: new Element('head'), createElement: tag => new Element(tag),
    getElementById: id => nodes.get(id) || null,
    querySelector: selector => nodes.get(selector) || nodes.get(selector.slice(1)) || null,
    addEventListener(name, fn) { documentEvents.set(name, [...(documentEvents.get(name) || []), fn]); },
    dispatchEvent(event) { for (const fn of documentEvents.get(event.type) || []) fn(event); }
};
for (const id of ['setupScreen', 'gameScreen', 'playSection', 'gameType', 'playAgainBtn', 'newGameBtn',
    'winnerCancelBtn', 'winnerName', '#winnerModal .modal-content', '#gameMenuModal h2']) {
    const element = new Element(); element.id = id; body.append(element);
}
nodes.get('gameType').value = '501';
const counts = { reads: 0, writes: 0, removals: 0, confirms: 0, imports: 0, resume: 0, launches: 0, cricket: 0 };
const localStorage = {};
Object.defineProperties(localStorage, {
    getItem: { value(key) { counts.reads++; return this[key] ?? null; } },
    setItem: { value(key, value) { counts.writes++; this[key] = String(value); } },
    removeItem: { value(key) { counts.removals++; delete this[key]; } },
    key: { value(index) { return Object.keys(this)[index] ?? null; } },
    length: { get() { return Object.keys(this).length; } }
});
localStorage[otherPrefix + 'active_game'] = '{"untouched":"other-build"}';
localStorage[prefix + 'match_launch'] = '{"tournamentId":"t1","matchId":"m1","revision":7}';
localStorage[otherPrefix + 'casual_history'] = JSON.stringify([{ resultId: 'other-result', ownerId: 'OTHER_BUILD', gameType: '501', savedAt: 1 }]);
localStorage[prefix + 'casual_history'] = JSON.stringify([{ resultId: 'own-result', ownerId: 'THIS_BUILD', gameType: '301', savedAt: 1 }]);
const location = { search: '?tournamentMatch=1', href: baseURL + '?tournamentMatch=1' };
const flags = { brackets: false, accounts: false };
const modals = [];
let uuid = 0;
const context = vm.createContext({ document, localStorage, location, URL, URLSearchParams, console,
    crypto: { randomUUID: () => `record-${++uuid}` },
    CustomEvent: class { constructor(type, detail = {}) { this.type = type; Object.assign(this, detail); } },
    confirm: () => { counts.confirms++; return true; },
    alert: text => { throw Error(`Unexpected alert: ${text}`); }, setTimeout
});
const cache = new Map();
function stub(id, exports) {
    const module = new vm.SyntheticModule(Object.keys(exports), function () {
        for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
    }, { context, identifier: id });
    cache.set(id, module);
}
let state, records;
stub('feature-availability.js', { isFeatureAvailable: name => flags[name] === true });
stub('ui.js', { showModal: id => modals.push(['show', id]), hideModal: id => modals.push(['hide', id]) });
stub('teams.js', { currentThrower: () => { throw Error('Unexpected team-mode call'); } });
stub('cricket.js', { updateCricketDisplay: () => counts.cricket++ });
stub('brackets/labels.js', { registrationLabels: () => new Map() });
stub('setup.js', {
    resumeGame: () => counts.resume++,
    launchTournamentScorer: (session, ledger) => {
        counts.launches++; state.game.tournament = session; state.game.scoringRecords = ledger;
        records.beginScoringLeg(session.gameType);
    }
});
function getModule(id) {
    if (cache.has(id)) return cache.get(id);
    const module = new vm.SourceTextModule(fs.readFileSync(path.join(dev, 'js', id), 'utf8'), {
        context, identifier: id,
        initializeImportMeta: meta => { meta.url = `${baseURL}js/${id}`; },
        importModuleDynamically: async specifier => {
            const target = path.posix.normalize(path.posix.join(path.posix.dirname(id), specifier));
            if (target === 'platform.js') { counts.imports++; throw Error('Platform import reached'); }
            const dependency = getModule(target);
            if (dependency.status === 'unlinked') await dependency.link(linker);
            if (dependency.status === 'linked') await dependency.evaluate();
            return dependency;
        }
    });
    cache.set(id, module); return module;
}
function linker(specifier, referencing) {
    return getModule(path.posix.normalize(path.posix.join(path.posix.dirname(referencing.identifier), specifier)));
}
const bridgeModule = getModule('tournament-bridge.js');
await bridgeModule.link(linker); await bridgeModule.evaluate();
const bridge = bridgeModule.namespace;
const casual = cache.get('casual-recording.js').namespace;
state = cache.get('state.js').namespace; records = cache.get('scoring-records.js').namespace;
let passed = 0;
const pass = name => { passed++; console.log(`PASS ${name}`); };
const bytes = () => JSON.stringify(localStorage);
const beforeLaunch = bytes();
bridge.initTournamentBridge();
await bridge.launchRequestedMatch();
assert.equal(counts.reads, 0); assert.equal(counts.imports, 0); assert.equal(counts.confirms, 0);
assert.equal(bytes(), beforeLaunch);
assert.match(nodes.get('tournamentBridgeNotice').textContent, /coming soon/i);
assert.ok(documentEvents.has('scorerLegWon'));
pass('URL/direct launch stops before launch-record reads, auth, confirmation or storage changes; scorer listeners still attach');

const players = [{ id: 'p1', playerId: 'v1', name: 'One', score: 301, history: [] },
    { id: 'p2', playerId: 'v2', name: 'Two', score: 301, history: [] }];
const teams = players.map((person, i) => ({ id: `s${i}`, name: person.name, members: [person] }));
const baseSession = () => ({ resultId: 'r1', ownerId: 'owner', tournamentId: 't1', matchId: 'm1',
    gameType: '301', bestOf: 3, teams: structuredClone(teams), legWins: [0, 0],
    legComplete: false, winnerIndex: null, status: 'scoring' });
state.resetGameState({ type: '301', players: structuredClone(players), tournament: baseSession(), recording: null });
records.beginScoringLeg('301');
state.saveActiveGame();
const saved = state.loadActiveGame();
state.restoreActiveGame(saved);
records.recordTurn({ points: 60, darts: 3 });
document.dispatchEvent(new context.CustomEvent('scorerLegWon', { detail: { winnerIndex: 0 } }));
assert.equal(state.game.tournament.legWins[0], 1);
assert.equal(state.game.scoringRecords.legs[0].winnerId, 's0');
assert.equal(state.loadActiveGame().scoringRecords.legs[0].turns[0].points, 60);
bridge.renderTournamentControls();
assert.equal(nodes.get('tournamentNextLeg').disabled, false);
await nodes.get('tournamentNextLeg').click();
assert.equal(counts.launches, 1); assert.equal(state.game.scoringRecords.legs.length, 2);
assert.equal(state.game.scoringRecords.legs[0].turns[0].points, 60);
assert.equal(state.game.tournament.legComplete, false);
assert.equal(state.game.currentPlayer, 1);
assert.equal(localStorage[otherPrefix + 'active_game'], '{"untouched":"other-build"}');
pass('real state/record modules resume locally, record turns, complete/persist a leg and retain prior ledger when Next leg is used');

state.game.type = 'cricket';
bridge.renderTournamentControls();
await nodes.get('tournamentMissDart').click();
assert.equal(state.game.pendingDarts.at(-1).target, 'MISS');
assert.equal(counts.cricket, 1);
state.game.type = '301';
document.dispatchEvent(new context.CustomEvent('scorerLegWon', { detail: { winnerIndex: 0 } }));
bridge.renderTournamentControls();
for (const id of ['tournamentReturn', 'tournamentResultReturn', 'tournamentSaveResult']) {
    assert.equal(nodes.get(id).disabled, true, id);
    assert.match(nodes.get(id).textContent, /Coming soon/);
}
const resultState = JSON.stringify(state.game), resultStorage = bytes();
const confirmsBefore = counts.confirms, writesBefore = counts.writes;
await nodes.get('tournamentReturn').fire('click'); // Intentionally invoke handler despite native disabled state.
await nodes.get('tournamentResultReturn').fire('click');
await bridge.saveTournamentResult();
assert.equal(location.href, baseURL + '?tournamentMatch=1');
assert.equal(JSON.stringify(state.game), resultState); assert.equal(bytes(), resultStorage);
assert.equal(counts.confirms, confirmsBefore); assert.equal(counts.writes, writesBefore); assert.equal(counts.imports, 0);
pass('local Miss dart stays usable; both Brackets returns and completed tournament cloud save are natively disabled and callback-guarded');

for (const status of ['pending', 'saving', 'saved']) {
    state.game.tournament.status = status;
    bridge.renderTournamentControls();
    assert.equal(nodes.get('recordingGateClose').disabled, false);
    assert.ok(nodes.get('tournamentResultPanel').children.includes(nodes.get('recordingGateClose')));
    const snapshot = JSON.stringify(state.game), stored = bytes();
    await nodes.get('recordingGateClose').click();
    assert.deepEqual(modals.at(-1), ['hide', 'winnerModal']);
    assert.equal(JSON.stringify(state.game), snapshot);
    assert.equal(bytes(), stored);
}
pass('completed pending/saving/saved results retain an enabled local exit without changing saved data');

const inputSeeds = structuredClone(players), inputTeams = structuredClone(teams);
nodes.get('gameType').value = '301';
const prepared = await casual.prepareCasualRecording(inputSeeds, inputTeams, true);
assert.equal(prepared.playerSeeds, inputSeeds); assert.equal(prepared.teams, inputTeams); assert.equal(prepared.recording, null);
assert.equal(nodes.has('casualLinkModal'), false); assert.equal(counts.imports, 0);
pass('forced casual preparation returns original normal-play inputs without opening profile setup or importing platform');

state.game.tournament = null;
state.game.recording = { ...baseSession(), source: 'casual', resultId: 'casual-r1', bestOf: 1, legWins: [1, 0],
    legComplete: true, winnerIndex: 0, status: 'pending', pendingResult: { retained: true } };
state.saveActiveGame();
const casualState = JSON.stringify(state.game), casualStorage = bytes();
await casual.saveCasualResult();
assert.equal(JSON.stringify(state.game), casualState); assert.equal(bytes(), casualStorage);
assert.equal(counts.confirms, confirmsBefore); assert.equal(counts.imports, 0);
assert.equal(nodes.get('casualSaveResult').disabled, true);
assert.match(nodes.get('tournamentResultPanel').children[0].textContent, /stay on this device/);
casual.initCasualRecording();
assert.equal(nodes.get('recordCasualStats').disabled, true);
assert.equal(nodes.get('recordCasualStats').checked, false);
assert.ok(nodes.get('recordCasualStats').parentElement.children.some(child => child.textContent === 'Coming soon'));
assert.match(nodes.get('casualRecordingHint').textContent, /coming soon/i);
assert.ok(nodes.get('casualRecoveryList').children.length > 0);
const historyText = nodes.get('casualRecoveryList').children.map(child => child.textContent).join(' ');
assert.match(historyText, /THIS_BUILD/); assert.doesNotMatch(historyText, /OTHER_BUILD/);
assert.equal(nodes.get('casualResume-casual-r1').disabled, false);
const recoveryData = value => { const snapshot = JSON.parse(value); delete snapshot.timestamp; return JSON.stringify(snapshot); };
const recoveryBefore = recoveryData(localStorage[prefix + 'casual_casual-r1']);
await nodes.get('casualResume-casual-r1').click();
assert.equal(counts.resume, 1); assert.equal(state.game.recording.resultId, 'casual-r1');
assert.equal(state.game.recording.pendingResult.retained, true);
assert.equal(recoveryData(localStorage[prefix + 'casual_casual-r1']), recoveryBefore);
assert.equal(localStorage[otherPrefix + 'active_game'], '{"untouched":"other-build"}');
assert.equal(counts.removals, 0);
pass('casual cloud save cannot mutate pending results; optional stats shows Coming soon while local recovery remains resumable');

flags.accounts = true; flags.brackets = false;
bridge.renderTournamentControls();
assert.equal(nodes.get('casualSaveResult').disabled, false);
state.game.tournament = { ...baseSession(), legWins: [2, 0], legComplete: true, winnerIndex: 0 };
state.game.recording = null;
bridge.renderTournamentControls();
assert.equal(nodes.get('tournamentReturn').disabled, true);
assert.equal(nodes.get('tournamentSaveResult').disabled, true);
flags.accounts = false; flags.brackets = true;
bridge.renderTournamentControls();
assert.equal(nodes.get('tournamentReturn').disabled, false);
assert.equal(nodes.get('tournamentSaveResult').disabled, true);
const mixedReads = counts.reads;
await bridge.launchRequestedMatch();
assert.equal(counts.reads, mixedReads); assert.equal(counts.imports, 0);
flags.accounts = true;
bridge.renderTournamentControls();
assert.equal(nodes.get('tournamentReturn').disabled, false);
assert.equal(nodes.get('tournamentResultReturn').disabled, false);
assert.equal(nodes.get('tournamentSaveResult').disabled, false);
pass('test-only mixed/enabled flags preserve independent controls and still require both flags for tournament launch/save');
console.log(`\n${passed}/${passed} focused VM groups passed at ${production ? 'production root' : 'DEV'} URL. No browser, visual, Firebase or full scorer integration pass is implied.`);
