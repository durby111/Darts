// TV spectator board view model: read-only, same-device, synthetic tournament.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as engine from '../js/brackets/engine.js';
import { buildBoard, chooseEvent, readEvents, TOURNAMENT_KEY, ACTIVE_GAME_KEY } from '../local/tv-model.js';

function tournament(id = 'synthetic-tv', people = 8) {
    let t = engine.createTournament({ id, ownerId: 'device-organizer', title: 'Synthetic Open', date: '2026-11-19', gameType: '501', bestOf: 3 });
    t = engine.saveRoster(t, Array.from({ length: people }, (_, i) => ({ id: 'p' + i, name: i < 2 ? 'Sam' : 'Guest ' + i, tag: String(Math.floor(i / 2) + 1), paid: i % 2 === 0, checkedIn: true, standby: false })));
    return engine.startTournament(t);
}
// A storage double that fails the test on ANY write or enumeration.
function readOnlyStorage(values) {
    const reads = [];
    return { reads, getItem: key => { reads.push(key); return values[key] ?? null; },
        setItem() { throw Error('TV board wrote to storage'); }, removeItem() { throw Error('TV board removed storage'); },
        clear() { throw Error('TV board cleared storage'); }, key() { throw Error('TV board enumerated storage'); } };
}
const store = (events, game) => ({ [TOURNAMENT_KEY]: JSON.stringify({ version: 1, events: Object.fromEntries(events.map(e => [e.id, e])), results: {}, corrections: [] }), ...(game ? { [ACTIVE_GAME_KEY]: JSON.stringify(game) } : {}) });
const session = (t, match, extra = {}) => ({ tournamentId: t.id, matchId: match.id, localOnly: true, gameType: '501', bestOf: 3, status: 'scoring', legWins: [1, 0], legComplete: false,
    teams: [{ id: match.teamA }, { id: match.teamB }], ...extra });

const t = tournament();
const ready = t.matches.filter(m => m.status === 'ready');
assert.equal(ready.length, 2);
const game = { type: '501', currentPlayer: 1, timestamp: 1700000000000, players: [{ name: 'x', score: 301 }, { name: 'y', score: 420 }], tournament: session(t, ready[0]) };

// Current match, score, legs, thrower.
let storage = readOnlyStorage(store([t], game));
let board = buildBoard(storage);
assert.deepEqual([...new Set(storage.reads)].sort(), [ACTIVE_GAME_KEY, TOURNAMENT_KEY].sort(), 'only the two device-local keys are read');
assert.equal(board.event.title, 'Synthetic Open');
assert.equal(board.current.code, ready[0].code);
assert.deepEqual(board.current.sides.map(s => [s.score, s.legs, s.throwing]), [[301, 1, false], [420, 0, true]]);
assert.deepEqual([board.current.game, board.current.bestOf, board.current.scoreLabel, board.current.awaitingSave], ['501', 3, 'left', false]);
assert.equal(board.inProgressMatchId, ready[0].id);
// Duplicate names get the same numbered event labels as the organizer page.
const everyTeam = [...board.current.sides, ...board.onDeck.flatMap(m => m.teams)];
assert.deepEqual(everyTeam.find(team => team.members.some(name => name.includes('Sam'))).members, ['(1) Sam', '(2) Sam']);
// On deck: every other ready match, and never the one in progress.
assert.deepEqual(board.onDeck.map(m => m.code), [ready[1].code]);
assert.equal(board.onDeck[0].teams.every(team => team.members.length === 2), true);
console.log('PASS current match score/legs/thrower and on-deck from saved device data');

// Organizer-only flags never reach the board model's display fields.
const display = JSON.stringify({ current: board.current, onDeck: board.onDeck, event: board.event, champion: board.champion });
for (const secret of ['paid', 'checkedIn', 'standby']) assert.ok(!display.includes(secret), `${secret} must not be exposed`);
console.log('PASS paid/check-in/standby flags are not exposed');

// No scorer session → nothing invented; both ready matches are on deck.
board = buildBoard(readOnlyStorage(store([t])));
assert.equal(board.current, null); assert.equal(board.onDeck.length, 2);
// Stale/foreign sessions are not shown as live.
for (const bad of [
    { ...game, tournament: session(t, ready[0], { status: 'saved' }) },
    { ...game, tournament: session(t, ready[0], { localOnly: false }) },
    { ...game, tournament: session(t, ready[0], { tournamentId: 'other' }) },
    { ...game, tournament: session(t, ready[0], { teams: [{ id: ready[0].teamB }, { id: ready[0].teamA }] }) },
    { ...game, tournament: session(t, { ...ready[0], id: 'GF1' }) },
    { type: '501', players: [{ score: 1 }] },
]) assert.equal(buildBoard(readOnlyStorage(store([t], bad))).current, null);
// Missing numbers are unknown, not zero.
board = buildBoard(readOnlyStorage(store([t], { ...game, players: [{ name: 'x' }], tournament: session(t, ready[0], { legWins: undefined }) })));
assert.deepEqual(board.current.sides.map(s => [s.score, s.legs]), [[null, null], [null, null]]);
board = buildBoard(readOnlyStorage(store([t], { ...game, tournament: session(t, ready[0], { status: 'pending' }) })));
assert.equal(board.current.awaitingSave, true); assert.equal(board.current.sides.some(s => s.throwing), false);
// Chicago-style: the leg being thrown is labelled from the scorer, the match format from the event.
board = buildBoard(readOnlyStorage(store([t], { ...game, type: 'cricket' })));
assert.deepEqual([board.current.legGame, board.current.game, board.current.scoreLabel], ['Cricket', '501', 'points']);
console.log('PASS stale or mismatched scorer sessions are hidden; unknown values stay unknown');

// Completed event: champion from the recorded final, no current/on-deck.
let done = t;
while (done.status === 'live') {
    const m = done.matches.find(x => x.status === 'ready');
    done = engine.recordResult(done, m.id, { winnerId: m.teamA, scoreA: 2, scoreB: 0 });
}
board = buildBoard(readOnlyStorage(store([done], game)));
const final = [...done.matches].reverse().find(m => ['reset', 'final'].includes(m.bracket) && m.status === 'complete');
assert.equal(board.champion.id, final.winnerId); assert.equal(board.current, null); assert.deepEqual(board.onDeck, []);
// Registration: nothing playing.
const open = engine.createTournament({ id: 'open', ownerId: 'device-organizer', title: 'Not started', date: '2026-11-20', gameType: '501', bestOf: 1 });
board = buildBoard(readOnlyStorage(store([open])));
assert.deepEqual([board.event.status, board.current, board.onDeck.length, board.champion], ['registration', null, 0, null]);
console.log('PASS champion only from a recorded final; nothing shown before start');

// Event choice: explicit id, else the event being scored, else the only live one; never a guess.
const t2 = tournament('second');
assert.equal(chooseEvent([t, t2], 'second', null).id, 'second');
assert.equal(chooseEvent([t, t2], 'missing', null), null);
assert.equal(chooseEvent([t, t2], null, { tournament: { tournamentId: 'second' } }).id, 'second');
assert.equal(chooseEvent([t, t2], null, null), null, 'two live events and no scorer: ask, do not guess');
assert.equal(chooseEvent([t, done], null, null).id, t.id);
board = buildBoard(readOnlyStorage(store([t, t2])), 'missing');
assert.deepEqual([board.event, board.requestedMissing, board.events.length], [null, true, 2]);
console.log('PASS event selection never guesses between live tournaments');

// Unreadable storage is reported and left untouched.
assert.deepEqual(readEvents(readOnlyStorage({})), { events: [], error: null });
assert.match(readEvents(readOnlyStorage({ [TOURNAMENT_KEY]: '{bad' })).error, /Nothing was changed/);
assert.match(readEvents(readOnlyStorage({ [TOURNAMENT_KEY]: '{"version":2,"events":{}}' })).error, /Nothing was changed/);
assert.match(readEvents({ getItem() { throw Error('denied'); } }).error, /unavailable/);
assert.equal(buildBoard(readOnlyStorage({ [TOURNAMENT_KEY]: store([t])[TOURNAMENT_KEY], [ACTIVE_GAME_KEY]: '{bad' })).current, null);
console.log('PASS malformed storage reported without modification');

// Source scope: no writes, locks, network, service-worker registration, scoring or account imports.
const read = file => fs.readFileSync(new URL(file, import.meta.url), 'utf8');
for (const file of ['../local/tv-model.js', '../local/tv.js']) {
    const source = read(file).replace(/\/\/.*$/gm, '');
    assert.ok(!/setItem|removeItem|\.clear\(|navigator\.locks|fetch\(|XMLHttpRequest|WebSocket|BroadcastChannel|serviceWorker|firebase|indexedDB|getUserMedia|Notification|wakeLock/.test(source), `${file} must stay read-only and local`);
    assert.ok(!/platform\.js|page\.js|tournament-bridge|state\.js|setup\.js/.test(source), `${file} must not import organizer, scorer or account code`);
}
const html = read('../local/tv/index.html');
assert.ok(!/<form|<input|importmap|https?:\/\//i.test(html), 'TV page has no inputs, forms or external resources');
assert.match(html, /does not sync to other devices and nothing is published/);
assert.ok(!fs.existsSync(new URL('../../local/tv', import.meta.url)) && !fs.existsSync(new URL('../../local/tv.js', import.meta.url)), 'TV board must not exist in production');
console.log('PASS TV board is read-only, local and DEV-only');
