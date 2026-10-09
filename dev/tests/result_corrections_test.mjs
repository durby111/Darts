/**
 * Dependency-free, local-only acceptance tests for the opt-in correction seam.
 * Run: node --test dev/tests/result_corrections_test.mjs
 * No browser, Firebase, persistent storage, service worker or network is used.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createTournament, saveRoster, startTournament, recordResult,
} from '../js/brackets/engine.js';
import {
    validateResultIndex, planCompletedResultCorrection, planResultInvalidation,
    projectEffectiveRecords, classifyPendingResult,
} from '../js/result-corrections.js';

const copy = value => structuredClone(value);
const OWNER = 'verified-owner';
const ACTOR = Object.freeze({ uid: OWNER, emailVerified: true, isAnonymous: false });
const MATCH_FIELDS = ['winnerId', 'scoreA', 'scoreB', 'forfeit'];
const INDEX_FIELDS = ['schemaVersion', 'tournamentId', 'ownerId', 'revision', 'correctionEpoch', 'heads'];
const HEAD_FIELDS = ['activeResultId', 'state', 'generation', 'operationId'];
function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
    }
    return value;
}
function throwsCode(fn, code) {
    assert.throws(fn, error => error?.code === `correction/${code}`,
        `Expected correction/${code}`);
}
function find(tournament, code) {
    const match = tournament.matches.find(item => item.code === code);
    assert.ok(match, `Missing fixture match ${code}`);
    return match;
}
function start(count = 4, options = {}) {
    let tournament = createTournament({
        id: 'event-1', ownerId: OWNER, title: 'Correction acceptance fixture',
        date: '2026-10-05', gameType: 'chicago', bestOf: 3, ...options,
    });
    tournament = saveRoster(freeze(tournament), freeze(Array.from({ length: count * 2 }, (_, i) => ({
        id: `entry-${i}`, playerId: i % 2 ? `player-${i}` : null,
        name: `Player ${i}`, tag: `${options.tagPrefix || ''}${Math.floor(i / 2) + 1}`,
        // Match the current engine's paid-and-checked-in start contract.
        paid: true, checkedIn: true, standby: false,
    }))));
    const random = Math.random;
    try {
        Math.random = () => 0.999999;
        return startTournament(freeze(tournament));
    } finally { Math.random = random; }
}
function scores(tournament, match, side = 'A', { forfeit = false, loserScore = 0 } = {}) {
    const threshold = Math.floor(tournament.bestOf / 2) + 1;
    return {
        winnerId: match[`team${side}`],
        scoreA: forfeit ? null : side === 'A' ? threshold : loserScore,
        scoreB: forfeit ? null : side === 'B' ? threshold : loserScore,
        forfeit,
    };
}
function play(tournament, code, side = 'A', options = {}) {
    return recordResult(freeze(tournament), code, scores(tournament, find(tournament, code), side, options));
}
function until(tournament, predicate, side = 'A') {
    let iterations = 0;
    while (!predicate(tournament)) {
        assert.ok(++iterations <= 63, 'Fixture must terminate within the bracket bound');
        const ready = tournament.matches.find(match => match.status === 'ready');
        assert.ok(ready, 'Fixture needs another ready match');
        tournament = play(tournament, ready.id, side);
    }
    return tournament;
}
function completed(count = 4, options = {}) {
    const live = start(count, options);
    const match = live.matches.find(item => item.status === 'ready');
    return { tournament: play(live, match.id), matchId: match.id };
}
function record(tournament, matchId, id = 'result-original', overrides = {}) {
    const match = find(tournament, matchId);
    return {
        source: 'tournament', id, tournamentId: tournament.id, ownerId: tournament.ownerId,
        matchId, winnerId: match.winnerId, createdAt: '2026-10-04T10:00:00Z',
        perPlayer: [
            { playerId: 'player-1', matches: 1, darts: 9, points: 180, marks: 2, busts: 1 },
            { playerId: 'player-3', matches: 1, darts: 8, points: 120, marks: 3, busts: 0 },
        ],
        legs: [{ id: 'leg-1', turns: [{ playerId: 'player-1', points: 60, darts: 3, bust: false }] }],
        ...overrides,
    };
}
function index(tournament, heads = {}, overrides = {}) {
    return {
        schemaVersion: 1, tournamentId: tournament.id, ownerId: tournament.ownerId,
        revision: 7, correctionEpoch: 3, heads, ...overrides,
    };
}
function head(id, overrides = {}) {
    return { activeResultId: id, state: 'active', generation: 0, operationId: null, ...overrides };
}
function argsFor(tournament, matchId, overrides = {}) {
    const original = record(tournament, matchId);
    return {
        tournament, actor: ACTOR, index: null, matchId, operationId: 'operation-1',
        expected: {
            tournamentRevision: tournament.revision, indexRevision: 0,
            correctionEpoch: 0, activeResultId: original.id,
        },
        reasonCode: 'wrong_winner', records: [original], recordsComplete: true, priorEvent: null,
        outcome: scores(tournament, find(tournament, matchId), 'B'),
        ...overrides,
    };
}
function fixture(count = 4, overrides = {}) {
    const { tournament, matchId } = completed(count);
    return argsFor(tournament, matchId, overrides);
}
function invalidationArgs(args) {
    const { outcome, ...rest } = args;
    return rest;
}
function withIndex(args, currentIndex) {
    const currentHead = currentIndex.heads[args.matchId];
    return {
        ...args, index: currentIndex,
        expected: {
            tournamentRevision: args.tournament.revision, indexRevision: currentIndex.revision,
            correctionEpoch: currentIndex.correctionEpoch,
            activeResultId: currentHead?.state === 'active' ? currentHead.activeResultId : null,
        },
    };
}
function project(records, tournamentIndexes, extras = {}) {
    return projectEffectiveRecords({ records, recordsComplete: true, tournamentIndexes, ...extras });
}
function pendingArgs(tournament = start(4), extras = {}) {
    const match = tournament.matches.find(item => item.status === 'ready');
    assert.ok(match);
    return {
        tournament, actor: ACTOR, index: null, records: [], recordsComplete: true,
        pending: {
            resultId: 'pending-result', matchId: match.id, ownerId: OWNER,
            tournamentId: tournament.id, correctionEpoch: 0,
            localTurns: [{ playerId: 'player-1', points: 40, darts: 2 }],
        }, ...extras,
    };
}
function classify(args, status, reason) {
    const before = copy(args);
    const result = classifyPendingResult(freeze(args));
    assert.deepEqual(result, { status, reason, preserveLocal: true });
    assert.deepEqual(args, before, 'Lifecycle classification must not change or prune local data');
    return result;
}
function totals(records) {
    return records.reduce((sum, item) => {
        sum.matches++;
        for (const counter of item.perPlayer) {
            for (const key of ['darts', 'points', 'marks']) sum[key] += counter[key] || 0;
        }
        return sum;
    }, { matches: 0, darts: 0, points: 0, marks: 0 });
}

// Pure planning, authorization, compare-and-swap and audit invariants.
test('manual planning accepts frozen snapshots and creates a detached deterministic plan', () => {
    const args = freeze(fixture());
    const before = copy(args);
    const first = planCompletedResultCorrection(args);
    assert.deepEqual(first, planCompletedResultCorrection(args));
    assert.deepEqual(args, before);
    assert.equal(first.status, 'planned');
    assert.equal(first.needsCommit, true);
    assert.notEqual(first.tournament, args.tournament);
    assert.equal(first.tournament.revision, args.tournament.revision + 1);
    assert.equal(first.index.revision, 1);
    assert.equal(first.index.correctionEpoch, 1);
    assert.deepEqual(first.index.heads[args.matchId], {
        activeResultId: null, state: 'manual', generation: 1, operationId: args.operationId,
    });
    assert.equal(first.event.committedTournamentRevision, first.tournament.revision);
    assert.equal(first.event.committedIndexRevision, first.index.revision);
    assert.equal(first.event.committedCorrectionEpoch, first.index.correctionEpoch);
    assert.deepEqual(first.event.beforeOutcome,
        Object.fromEntries(MATCH_FIELDS.map(key => [key, find(args.tournament, args.matchId)[key]])));
    assert.deepEqual(first.event.afterOutcome, args.outcome);
    assert.equal(first.event.beforeHead, null);
    assert.deepEqual(first.event.afterHead, first.index.heads[args.matchId]);
    assert.deepEqual(first.excludedRecordIds, ['result-original']);
    assert.ok(first.affectedMatchIds.includes(args.matchId));
    first.tournament.registrations[0].name = 'detached';
    first.event.afterHead.state = 'invalidated';
    first.event.request.expected.activeResultId = 'detached';
    assert.deepEqual(args, before);
    assert.equal(first.index.heads[args.matchId].state, 'manual');
});

test('planner and projector use neither the clock nor random identifiers', () => {
    const args = fixture();
    const expected = planCompletedResultCorrection(args);
    const RealDate = globalThis.Date;
    const random = Math.random;
    const uuid = globalThis.crypto.randomUUID;
    try {
        globalThis.Date = class ForbiddenDate {
            constructor() { throw new Error('Clock access is forbidden'); }
            static now() { throw new Error('Clock access is forbidden'); }
        };
        Math.random = () => { throw new Error('Randomness is forbidden'); };
        globalThis.crypto.randomUUID = () => { throw new Error('Random ID generation is forbidden'); };
        assert.deepEqual(planCompletedResultCorrection(freeze(args)), expected);
        assert.equal(planResultInvalidation(invalidationArgs(args)).needsCommit, true);
        assert.equal(project(args.records, { 'event-1': null }).activeRecords.length, 1);
    } finally {
        globalThis.Date = RealDate;
        Math.random = random;
        globalThis.crypto.randomUUID = uuid;
    }
});

test('statistics invalidation preserves every tournament field even after downstream completion', () => {
    let tournament = until(start(8), value => value.status === 'complete');
    tournament = { ...tournament, extraMetadata: { preserve: ['all', 'fields'], count: 17 } };
    const selected = tournament.matches.find(item => item.status === 'complete');
    const args = freeze(invalidationArgs(argsFor(tournament, selected.id)));
    const result = planResultInvalidation(args);
    assert.deepEqual(result.tournament, tournament);
    assert.equal(result.tournament.revision, tournament.revision);
    assert.deepEqual(result.affectedMatchIds, []);
    assert.deepEqual(result.event.beforeOutcome, result.event.afterOutcome);
    assert.equal(result.event.committedTournamentRevision, tournament.revision);
    assert.equal(result.index.heads[selected.id].state, 'invalidated');
    assert.deepEqual(totals(project(args.records, { 'event-1': result.index }).activeRecords),
        { matches: 0, darts: 0, points: 0, marks: 0 });
});

test('existing index advances exactly once, retains unrelated heads and selected generation', () => {
    let args = fixture(8);
    const other = args.tournament.matches.find(item => item.id !== args.matchId && item.status === 'ready').id;
    args.tournament = play(args.tournament, other);
    const current = index(args.tournament, {
        [args.matchId]: head('result-original', { generation: 4, operationId: 'old-operation' }),
        [other]: head('unrelated-result'),
    });
    args = freeze(withIndex(args, current));
    const result = planCompletedResultCorrection(args);
    assert.equal(result.index.revision, current.revision + 1);
    assert.equal(result.index.correctionEpoch, current.correctionEpoch + 1);
    assert.equal(result.index.heads[args.matchId].generation, 5);
    assert.deepEqual(result.index.heads[other], current.heads[other]);
    assert.deepEqual(result.event.beforeHead, current.heads[args.matchId]);
    result.index.heads[other].activeResultId = 'detached';
    assert.equal(current.heads[other].activeResultId, 'unrelated-result');
});

test('manual correction bootstraps a completed manual-only legacy match with no recorded statistics', () => {
    const args = fixture();
    args.records = [];
    args.expected.activeResultId = null;
    const result = planCompletedResultCorrection(freeze(args));
    assert.deepEqual(result.excludedRecordIds, []);
    assert.equal(result.index.heads[args.matchId].state, 'manual');
    throwsCode(() => planResultInvalidation(invalidationArgs(args)), 'no-active-result');
});

test('manual outcome change never fabricates a replacement score ledger or counters', () => {
    const args = freeze(fixture());
    const result = planCompletedResultCorrection(args);
    assert.deepEqual(Object.keys(result).sort(), [
        'affectedMatchIds', 'event', 'excludedRecordIds', 'index', 'needsCommit', 'status', 'tournament',
    ].sort());
    assert.deepEqual(Object.keys(result.index).sort(), INDEX_FIELDS.toSorted());
    assert.equal(result.index.heads[args.matchId].activeResultId, null);
    assert.equal(JSON.stringify(result.event).includes('perPlayer'), false);
    assert.equal(JSON.stringify(result.event).includes('turns'), false);
    const projection = project(args.records, { 'event-1': result.index });
    assert.deepEqual(projection.activeRecords, []);
    assert.equal(projection.auditRecords[0].status, 'manual-correction');
    assert.deepEqual(projection.auditRecords[0].record, args.records[0]);
    assert.deepEqual(totals(projection.activeRecords), { matches: 0, darts: 0, points: 0, marks: 0 });
});

for (const [name, actor] of [
    ['another verified user', { ...ACTOR, uid: 'other-owner' }],
    ['a lookalike display owner', { ...ACTOR, uid: 'other-owner', displayName: OWNER }],
    ['an unverified owner', { ...ACTOR, emailVerified: false }],
    ['an anonymous owner', { ...ACTOR, isAnonymous: true }],
    ['missing verification', { uid: OWNER, isAnonymous: false }],
    ['missing anonymous flag', { uid: OWNER, emailVerified: true }],
    ['truthy verification strings', { ...ACTOR, emailVerified: 'true' }],
    ['a null actor', null],
]) {
    test(`both planners reject ${name}`, () => {
        const args = fixture(4, { actor });
        throwsCode(() => planCompletedResultCorrection(args), 'unauthorized');
        throwsCode(() => planResultInvalidation(invalidationArgs(args)), 'unauthorized');
    });
}
for (const field of ['tournamentRevision', 'indexRevision', 'correctionEpoch', 'activeResultId']) {
    test(`both planners reject stale ${field}`, () => {
        const base = fixture();
        const args = withIndex(base, index(base.tournament, { [base.matchId]: head('result-original') }));
        args.expected[field] = field === 'activeResultId' ? 'other-result' : args.expected[field] + 1;
        throwsCode(() => planCompletedResultCorrection(args), 'stale-state');
        throwsCode(() => planResultInvalidation(invalidationArgs(args)), 'stale-state');
    });
}

test('confirmed legacy absence and confirmed operation receipt absence must be explicit', () => {
    const args = fixture();
    for (const field of ['index', 'priorEvent']) {
        const omitted = { ...args };
        delete omitted[field];
        assert.throws(() => planCompletedResultCorrection(omitted), `Missing ${field} must fail closed`);
    }
    for (const recordsComplete of [undefined, false, 'true']) {
        throwsCode(() => planCompletedResultCorrection({ ...args, recordsComplete }), 'incomplete-snapshot');
    }
    throwsCode(() => planCompletedResultCorrection({ ...args, records: null }), 'incomplete-snapshot');
});

test('planners reject foreign indexes and foreign or overbroad selected record snapshots', () => {
    const args = fixture();
    for (const changes of [{ ownerId: 'foreign-owner' }, { tournamentId: 'foreign-event' }]) {
        throwsCode(() => planCompletedResultCorrection({ ...args, index: index(args.tournament, {}, changes) }), 'wrong-index');
    }
    for (const changes of [
        { source: 'casual' }, { ownerId: 'foreign-owner' },
        { tournamentId: 'foreign-event' }, { matchId: 'foreign-match' },
    ]) {
        throwsCode(() => planCompletedResultCorrection({ ...args, records: [{ ...args.records[0], ...changes }] }), 'wrong-record');
    }
    const other = args.tournament.matches.find(item => item.id !== args.matchId);
    throwsCode(() => planCompletedResultCorrection({
        ...args, records: [...args.records, record(args.tournament, other.id, 'other-result')],
    }), 'wrong-record');
});

test('reason codes are bounded and invalidation cannot carry a new outcome', () => {
    const args = fixture();
    for (const reasonCode of ['my private medical note', '', null, 'WRONG_WINNER']) {
        throwsCode(() => planCompletedResultCorrection({ ...args, reasonCode }), 'invalid-input');
    }
    for (const reasonCode of ['score_entry_error', 'wrong_winner', 'recording_error', 'other']) {
        assert.equal(planCompletedResultCorrection({ ...args, reasonCode }).event.request.reasonCode, reasonCode);
    }
    throwsCode(() => planResultInvalidation(args), 'invalid-input');
});

for (const [name, mutate] of [
    ['missing expected fields', args => { delete args.expected.correctionEpoch; }],
    ['extra expected fields', args => { args.expected.privateNote = 'secret'; }],
    ['fractional tournament revision', args => { args.expected.tournamentRevision = 1.5; }],
    ['negative index revision', args => { args.expected.indexRevision = -1; }],
    ['unsafe correction epoch', args => { args.expected.correctionEpoch = Number.MAX_SAFE_INTEGER + 1; }],
    ['blank operation ID', args => { args.operationId = ''; }],
    ['path operation ID', args => { args.operationId = 'operations/private'; }],
    ['prototype operation ID', args => { args.operationId = '__proto__'; }],
    ['overlong operation ID', args => { args.operationId = 'x'.repeat(129); }],
    ['extra outcome field', args => { args.outcome.rawTurns = []; }],
    ['missing outcome field', args => { delete args.outcome.forfeit; }],
    ['nonboolean forfeit', args => { args.outcome.forfeit = 'false'; }],
    ['negative score', args => { args.outcome.scoreA = -1; }],
    ['fractional score', args => { args.outcome.scoreA = 0.5; }],
    ['infinite score', args => { args.outcome.scoreA = Infinity; }],
    ['foreign winner', args => { args.outcome.winnerId = 'foreign-team'; }],
    ['scores inconsistent with winner', args => { args.outcome.scoreA = 2; args.outcome.scoreB = 0; }],
    ['tied scores', args => { args.outcome.scoreA = 2; args.outcome.scoreB = 2; }],
    ['forfeit with scores', args => { args.outcome.forfeit = true; }],
]) {
    test(`manual planning rejects ${name}`, () => {
        const args = fixture();
        mutate(args);
        assert.throws(() => planCompletedResultCorrection(freeze(args)));
    });
}

test('same outcome requires statistics invalidation; legal forfeit and score edits are supported', () => {
    const args = fixture();
    args.outcome = scores(args.tournament, find(args.tournament, args.matchId), 'A');
    throwsCode(() => planCompletedResultCorrection(args), 'no-outcome-change');
    args.outcome.scoreB = 1;
    assert.equal(planCompletedResultCorrection(args).event.afterOutcome.scoreB, 1);
    args.outcome = scores(args.tournament, find(args.tournament, args.matchId), 'B', { forfeit: true });
    assert.deepEqual(planCompletedResultCorrection(args).event.afterOutcome, args.outcome);
});

// Idempotence is payload-bound and must never rewind newer lifecycle state.
test('replaying the exact operation receipt has no second effect', () => {
    const args = fixture();
    const initial = planCompletedResultCorrection(args);
    const replay = planCompletedResultCorrection(freeze({
        ...args, tournament: initial.tournament, index: initial.index, priorEvent: initial.event,
    }));
    assert.equal(replay.status, 'already-applied');
    assert.equal(replay.needsCommit, false);
    assert.equal(replay.event, null);
    assert.deepEqual(replay.tournament, initial.tournament);
    assert.deepEqual(replay.index, initial.index);
    assert.deepEqual(replay.affectedMatchIds, []);
    assert.deepEqual(replay.excludedRecordIds, []);
});

test('statistics invalidation receipts are also idempotent without a bracket revision bump', () => {
    const args = invalidationArgs(fixture());
    const initial = planResultInvalidation(args);
    const replay = planResultInvalidation({
        ...args, tournament: initial.tournament, index: initial.index, priorEvent: initial.event,
    });
    assert.equal(replay.status, 'already-applied');
    assert.equal(replay.needsCommit, false);
    assert.equal(replay.tournament.revision, args.tournament.revision);
});

for (const [name, change] of [
    ['reason', args => { args.reasonCode = 'other'; }],
    ['outcome', args => { args.outcome.scoreA = 1; }],
    ['match', args => { args.matchId = 'GF1'; }],
    ['operation ID', args => { args.operationId = 'other-operation'; }],
    ['expected state', args => { args.expected.correctionEpoch += 1; }],
]) {
    test(`operation receipt rejects reused ID with changed ${name}`, () => {
        const base = fixture();
        const args = withIndex(base, index(base.tournament, { [base.matchId]: head('result-original') }));
        const initial = planCompletedResultCorrection(args);
        const retry = { ...copy(args), tournament: initial.tournament, index: initial.index, priorEvent: initial.event };
        change(retry);
        throwsCode(() => planCompletedResultCorrection(retry), 'operation-conflict');
    });
}

test('operation receipt cannot be reused for another correction type', () => {
    const args = fixture();
    const initial = planCompletedResultCorrection(args);
    throwsCode(() => planResultInvalidation({
        ...invalidationArgs(args), tournament: initial.tournament, index: initial.index, priorEvent: initial.event,
    }), 'operation-conflict');
});

test('old operation replay reports superseded and does not rewind a newer correction', () => {
    const args = fixture();
    const first = planCompletedResultCorrection(args);
    const secondArgs = withIndex(argsFor(first.tournament, args.matchId, { operationId: 'operation-2' }), first.index);
    secondArgs.outcome = scores(first.tournament, find(first.tournament, args.matchId), 'A', { loserScore: 1 });
    const second = planCompletedResultCorrection(secondArgs);
    const replay = planCompletedResultCorrection({
        ...args, tournament: second.tournament, index: second.index, priorEvent: first.event,
    });
    assert.equal(replay.status, 'superseded');
    assert.equal(replay.needsCommit, false);
    assert.deepEqual(replay.tournament, second.tournament);
    assert.deepEqual(replay.index, second.index);
    assert.equal(replay.index.heads[args.matchId].operationId, 'operation-2');
    assert.equal(replay.index.heads[args.matchId].generation, 2);
});

test('competing stale operation and retry without its existing receipt both fail closed', () => {
    const args = fixture();
    const initial = planCompletedResultCorrection(args);
    const current = { ...args, tournament: initial.tournament, index: initial.index };
    throwsCode(() => planCompletedResultCorrection(current), 'missing-operation-receipt');
    throwsCode(() => planCompletedResultCorrection({ ...current, operationId: 'competing-operation' }), 'stale-state');
});

for (const field of ['revision', 'correctionEpoch']) {
    test(`replay refuses an index ${field} older than its receipt`, () => {
        const base = fixture();
        const args = withIndex(base, index(base.tournament, { [base.matchId]: head('result-original') }));
        const initial = planCompletedResultCorrection(args);
        const old = copy(initial.index);
        old[field] -= 1;
        throwsCode(() => planCompletedResultCorrection({
            ...args, tournament: initial.tournament, index: old, priorEvent: initial.event,
        }), 'incomplete-snapshot');
    });
}

test('replay refuses missing, older and conflicting same-generation heads and old tournament snapshots', () => {
    const args = fixture();
    const initial = planCompletedResultCorrection(args);
    const retry = { ...args, tournament: initial.tournament, index: initial.index, priorEvent: initial.event };
    const absent = copy(initial.index);
    delete absent.heads[args.matchId];
    throwsCode(() => planCompletedResultCorrection({ ...retry, index: absent }), 'incomplete-snapshot');
    const older = copy(initial.index);
    older.heads[args.matchId] = head('result-original');
    throwsCode(() => planCompletedResultCorrection({ ...retry, index: older }), 'incomplete-snapshot');
    const conflict = copy(initial.index);
    conflict.heads[args.matchId].operationId = 'conflicting-operation';
    throwsCode(() => planCompletedResultCorrection({ ...retry, index: conflict }), 'incomplete-snapshot');
    throwsCode(() => planCompletedResultCorrection({ ...retry, tournament: args.tournament }), 'incomplete-snapshot');
});

// Engine integration and conservative complete-descendant protection.
for (let count = 2; count <= 32; count++) {
    test(`${count}-team engine bracket: correction reroutes both paths and keeps structure and byes honest`, () => {
        const args = freeze(fixture(count));
        const actual = planCompletedResultCorrection(args);
        const expected = recordResult(args.tournament, args.matchId, args.outcome);
        assert.deepEqual(actual.tournament, expected);
        assert.deepEqual(actual.tournament.matches.map(item => [item.id, item.sourceA, item.sourceB]),
            args.tournament.matches.map(item => [item.id, item.sourceA, item.sourceB]));
        const changed = actual.tournament.matches.filter((item, i) => JSON.stringify(item) !== JSON.stringify(args.tournament.matches[i]));
        assert.deepEqual(actual.affectedMatchIds, changed.map(item => item.id));
        for (const match of actual.tournament.matches.filter(item => item.status === 'bye')) {
            assert.equal(match.scoreA, null);
            assert.equal(match.scoreB, null);
            assert.equal(match.forfeit, false);
        }
        assert.equal(actual.index.revision, 1);
        assert.equal(actual.index.correctionEpoch, 1);
        assert.deepEqual(Object.keys(actual.index.heads), [args.matchId]);
        const oldMatch = find(args.tournament, args.matchId);
        const newMatch = find(actual.tournament, args.matchId);
        assert.notEqual(newMatch.winnerId, oldMatch.winnerId);
        const loser = newMatch.winnerId === newMatch.teamA ? newMatch.teamB : newMatch.teamA;
        for (const match of actual.tournament.matches) {
            for (const side of ['A', 'B']) {
                const source = match[`source${side}`];
                if (source?.matchCode !== args.matchId || match.status === 'void') continue;
                assert.equal(match[`team${side}`], source.outcome === 'winner' ? newMatch.winnerId : loser);
            }
        }
    });
    test(`${count}-team finished bracket: any earlier completed ancestor is blocked but stats invalidation remains safe`, () => {
        const tournament = until(start(count), value => value.status === 'complete');
        const match = tournament.matches.find(item => item.status === 'complete' && item.id !== 'GF1' && item.id !== 'GF2');
        const args = argsFor(tournament, match.id);
        assert.throws(() => planCompletedResultCorrection(args), /dependent|descendant/i);
        const sameWinner = { ...args, outcome: scores(tournament, match, 'A', { loserScore: 1 }) };
        assert.throws(() => planCompletedResultCorrection(sameWinner), /dependent|descendant/i);
        assert.deepEqual(planResultInvalidation(invalidationArgs(args)).tournament, tournament);
    });
}

test('noncomplete ready, pending, bye and void matches cannot be corrected or invalidated', () => {
    const tournament = start(5);
    for (const status of ['ready', 'pending', 'bye', 'void']) {
        const match = tournament.matches.find(item => item.status === status);
        assert.ok(match, `Fixture covers ${status}`);
        const args = argsFor(tournament, match.id);
        // Validate status independently from whether an unplayed match has resolved teams.
        args.outcome = { winnerId: 'team-1', scoreA: 2, scoreB: 0, forfeit: false };
        throwsCode(() => planCompletedResultCorrection(args), 'not-complete');
        throwsCode(() => planResultInvalidation(invalidationArgs(args)), 'not-complete');
    }
    const args = fixture();
    args.matchId = 'missing-match';
    throwsCode(() => planCompletedResultCorrection(args), 'not-complete');
});

test('GF1 change reopens a void GF2 and changes complete tournament back to live', () => {
    let tournament = until(start(4), value => find(value, 'GF1').status === 'ready');
    tournament = play(tournament, 'GF1', 'A');
    assert.equal(tournament.status, 'complete');
    assert.equal(find(tournament, 'GF2').status, 'void');
    const result = planCompletedResultCorrection(argsFor(tournament, 'GF1'));
    assert.equal(result.tournament.status, 'live');
    const gf1 = find(result.tournament, 'GF1'), gf2 = find(result.tournament, 'GF2');
    assert.equal(gf2.status, 'ready');
    assert.equal(gf2.teamA, gf1.teamB);
    assert.equal(gf2.teamB, gf1.teamA);
    assert.ok(result.affectedMatchIds.includes('GF2'));
});

test('GF1 change voids an unplayed ready GF2 and completes the tournament', () => {
    let tournament = until(start(4), value => find(value, 'GF1').status === 'ready');
    tournament = play(tournament, 'GF1', 'B');
    const args = argsFor(tournament, 'GF1');
    args.outcome = scores(tournament, find(tournament, 'GF1'), 'A');
    const result = planCompletedResultCorrection(args);
    assert.equal(result.tournament.status, 'complete');
    assert.equal(find(result.tournament, 'GF2').status, 'void');
    assert.equal(find(result.tournament, 'GF2').winnerId, null);
    assert.equal(find(result.tournament, 'GF2').teamA, null);
    assert.equal(find(result.tournament, 'GF2').teamB, null);
});

test('completed GF2 blocks any GF1 outcome edit; the GF2 leaf itself remains correctable', () => {
    let tournament = until(start(4), value => find(value, 'GF1').status === 'ready');
    tournament = play(play(tournament, 'GF1', 'B'), 'GF2', 'A');
    const gf1Args = argsFor(tournament, 'GF1');
    gf1Args.outcome = scores(tournament, find(tournament, 'GF1'), 'A');
    assert.throws(() => planCompletedResultCorrection(gf1Args), /dependent|descendant/i);
    const gf2 = planCompletedResultCorrection(argsFor(tournament, 'GF2'));
    assert.equal(gf2.tournament.status, 'complete');
    assert.equal(find(gf2.tournament, 'GF2').winnerId, find(tournament, 'GF2').teamB);
});

for (const [name, mutate] of [
    ['reversed match order', tournament => tournament.matches.reverse()],
    ['missing source target', tournament => { find(tournament, 'GF1').sourceA.matchCode = 'not-present'; }],
    ['self-reference cycle', tournament => { find(tournament, 'GF1').sourceA = { matchCode: 'GF1', outcome: 'winner' }; }],
    ['multi-match cycle', tournament => { find(tournament, 'W1.1').sourceA = { matchCode: 'GF1', outcome: 'loser' }; }],
    ['duplicate match ID', tournament => { tournament.matches[1].id = tournament.matches[0].id; }],
    ['duplicate match code', tournament => { tournament.matches[1].code = tournament.matches[0].code; }],
    ['unsupported source outcome', tournament => { find(tournament, 'GF1').sourceA.outcome = 'third'; }],
]) {
    test(`manual planning fails closed on ${name}`, () => {
        const args = copy(fixture(8));
        mutate(args.tournament);
        assert.throws(() => planCompletedResultCorrection(freeze(args)));
    });
}

test('reversed finished topology cannot hide a transitive played descendant', () => {
    const tournament = until(start(8), value => value.status === 'complete');
    const earliest = tournament.matches.find(item => item.status === 'complete');
    const args = argsFor(tournament, earliest.id);
    args.tournament = copy(tournament);
    args.tournament.matches.reverse();
    assert.throws(() => planCompletedResultCorrection(freeze(args)));
});

// Exact public metadata schema, bounds and numeric overflow.
test('public result index validates a detached exact metadata-only schema', () => {
    const tournament = start(4);
    const original = freeze(index(tournament, { 'W1.1': head('record-1') }));
    const validated = validateResultIndex(original);
    assert.deepEqual(validated, original);
    assert.notEqual(validated, original);
    assert.notEqual(validated.heads, original.heads);
    assert.deepEqual(Object.keys(validated).sort(), INDEX_FIELDS.toSorted());
    assert.deepEqual(Object.keys(validated.heads['W1.1']).sort(), HEAD_FIELDS.toSorted());
    validated.heads['W1.1'].activeResultId = 'detached';
    assert.equal(original.heads['W1.1'].activeResultId, 'record-1');
});

for (const privateField of ['reasonCode', 'privateNote', 'email', 'participants', 'playerIds', 'perPlayer', 'turns', 'ledger', 'flags']) {
    test(`public index rejects private ${privateField} at top level and in a head`, () => {
        const tournament = start(4);
        const original = index(tournament, { 'W1.1': head('record-1') });
        throwsCode(() => validateResultIndex({ ...original, [privateField]: 'private' }), 'invalid-input');
        const nested = copy(original);
        nested.heads['W1.1'][privateField] = 'private';
        throwsCode(() => validateResultIndex(nested), 'invalid-input');
    });
}
for (const field of INDEX_FIELDS) {
    test(`public index requires ${field}`, () => {
        const value = index(start(4));
        delete value[field];
        throwsCode(() => validateResultIndex(value), 'invalid-input');
    });
}
for (const field of HEAD_FIELDS) {
    test(`public head requires ${field}`, () => {
        const value = index(start(4), { 'W1.1': head('record-1') });
        delete value.heads['W1.1'][field];
        throwsCode(() => validateResultIndex(value), 'invalid-input');
    });
}

test('head and revision value validation rejects invalid states, IDs and numeric domains', () => {
    const original = index(start(4), { 'W1.1': head('record-1') });
    for (const field of ['revision', 'correctionEpoch']) {
        for (const value of [-1, 0.5, NaN, Infinity, '1', null, Number.MAX_SAFE_INTEGER + 1]) {
            throwsCode(() => validateResultIndex({ ...original, [field]: value }), 'invalid-input');
        }
    }
    for (const changes of [
        { state: 'deleted' }, { activeResultId: null }, { activeResultId: 'path/id' },
        { generation: -1 }, { generation: 0.1 }, { generation: Number.MAX_SAFE_INTEGER + 1 },
        { operationId: 'private/note' },
        { state: 'manual', activeResultId: 'record-1', generation: 1, operationId: 'op-1' },
        { state: 'invalidated', activeResultId: null, generation: 0, operationId: 'op-1' },
        { state: 'invalidated', activeResultId: null, generation: 1, operationId: null },
    ]) {
        throwsCode(() => validateResultIndex({ ...original, heads: { 'W1.1': head('record-1', changes) } }), 'invalid-input');
    }
    for (const id of ['', '__proto__', 'prototype', 'constructor', 'x'.repeat(129), 'path/id']) {
        throwsCode(() => validateResultIndex({ ...original, tournamentId: id }), 'invalid-input');
        throwsCode(() => validateResultIndex({ ...original, heads: { [id]: head('record-1') } }), 'invalid-input');
    }
    for (const value of [null, [], new Map(), Object.create({ revision: 0 })]) {
        throwsCode(() => validateResultIndex(value), 'invalid-input');
    }
    throwsCode(() => validateResultIndex({ ...original, schemaVersion: 2 }), 'invalid-input');
    assert.equal(validateResultIndex({ ...original, tournamentId: 'x'.repeat(128) }).tournamentId.length, 128);
});

test('public index accepts at most the 63 matches of a 32-team bracket', () => {
    const tournament = start(32);
    assert.equal(tournament.matches.length, 63);
    const heads = Object.fromEntries(tournament.matches.map((match, i) => [match.id, head(`result-${i}`)]));
    assert.equal(Object.keys(validateResultIndex(index(tournament, heads)).heads).length, 63);
    throwsCode(() => validateResultIndex(index(tournament, { ...heads, extra: head('extra-result') })), 'invalid-input');
});

for (const field of ['revision', 'correctionEpoch', 'generation']) {
    test(`planning rejects ${field} overflow without mutating input`, () => {
        let args = fixture();
        const current = index(args.tournament, { [args.matchId]: head('result-original') });
        if (field === 'generation') current.heads[args.matchId].generation = Number.MAX_SAFE_INTEGER;
        else current[field] = Number.MAX_SAFE_INTEGER;
        current.revision = Number.MAX_SAFE_INTEGER;
        validateResultIndex(current); // The input is valid; only the required advance overflows.
        args = freeze(withIndex(args, current));
        const before = copy(args);
        throwsCode(() => planCompletedResultCorrection(args), 'invalid-input');
        throwsCode(() => planResultInvalidation(invalidationArgs(args)), 'invalid-input');
        assert.deepEqual(args, before);
    });
}

test('manual tournament revision overflow rejects, while stats invalidation need not advance it', () => {
    const args = fixture();
    args.tournament = { ...args.tournament, revision: Number.MAX_SAFE_INTEGER };
    args.expected.tournamentRevision = Number.MAX_SAFE_INTEGER;
    throwsCode(() => planCompletedResultCorrection(freeze(args)), 'invalid-input');
    assert.deepEqual(planResultInvalidation(invalidationArgs(args)).tournament, args.tournament);
});

// Physical deduplication is separate from logical version selection.
test('physical duplicates collapse by source and ID only when their entire payload agrees', () => {
    const args = fixture();
    const original = args.records[0];
    const reordered = Object.fromEntries(Object.entries(original).reverse());
    const result = project(freeze([original, copy(original), reordered]), freeze({ 'event-1': null }));
    assert.equal(result.activeRecords.length, 1);
    assert.equal(result.auditRecords.length, 1);
    assert.deepEqual(result.activeRecords[0], original);
    assert.equal(result.auditRecords[0].status, 'active-legacy');
    assert.deepEqual(planCompletedResultCorrection({ ...args, records: [original, copy(original)] }).excludedRecordIds,
        [original.id]);
});

for (const [name, change] of [
    ['counter', record => { record.perPlayer[0].points += 1; }],
    ['raw turn', record => { record.legs[0].turns[0].darts = 2; }],
    ['timestamp', record => { record.createdAt = '2099-01-01T00:00:00Z'; }],
    ['logical match', record => { record.matchId = 'another-match'; }],
    ['logical tournament', record => { record.tournamentId = 'another-event'; }],
    ['owner', record => { record.ownerId = 'another-owner'; }],
    ['array order', record => { record.perPlayer.reverse(); }],
]) {
    test(`duplicate physical ID with conflicting ${name} is rejected before projection or planning`, () => {
        const args = fixture();
        const conflicting = copy(args.records[0]);
        change(conflicting);
        const records = freeze([...args.records, conflicting]);
        throwsCode(() => project(records, { 'event-1': null, 'another-event': null }), 'duplicate-id');
        throwsCode(() => planCompletedResultCorrection({ ...args, records }), 'duplicate-id');
    });
}

test('an explicit head picks one logical version regardless of order or newest timestamp', () => {
    const args = fixture();
    const old = { ...args.records[0], createdAt: '2099-01-01T00:00:00Z' };
    const active = record(args.tournament, args.matchId, 'result-current', { createdAt: '2001-01-01T00:00:00Z' });
    const current = index(args.tournament, { [args.matchId]: head(active.id, { generation: 2, operationId: 'scored-operation' }) });
    for (const records of [[old, active, copy(active)], [active, old]]) {
        const result = project(freeze(records), freeze({ 'event-1': current }));
        assert.deepEqual(result.activeRecords, [active]);
        assert.equal(result.auditRecords.length, 2);
        assert.deepEqual(result.excludedRecords.map(item => [item.record.id, item.status, item.contributes]),
            [[old.id, 'superseded', false]]);
        assert.deepEqual(totals(result.activeRecords), totals([active]));
    }
    const planned = planCompletedResultCorrection(withIndex({ ...args, records: [old, active] }, current));
    assert.deepEqual(planned.excludedRecordIds, [active.id, old.id].sort());
});

test('manual and invalidated heads exclude all historical versions but preserve their raw audit data', () => {
    const args = fixture();
    const records = freeze([args.records[0], record(args.tournament, args.matchId, 'result-other')]);
    for (const [state, status] of [['manual', 'manual-correction'], ['invalidated', 'invalidated']]) {
        const current = index(args.tournament, {
            [args.matchId]: head(null, { state, generation: 2, operationId: 'excluded-operation' }),
        });
        const result = project(records, { 'event-1': current });
        assert.deepEqual(result.activeRecords, []);
        assert.deepEqual(result.excludedRecords.map(item => item.record), records);
        assert.deepEqual(result.auditRecords.map(item => [item.status, item.contributes]), [[status, false], [status, false]]);
        assert.deepEqual(totals(result.activeRecords), { matches: 0, darts: 0, points: 0, marks: 0 });
        result.auditRecords[0].record.perPlayer[0].points = 999;
        assert.equal(records[0].perPlayer[0].points, 180);
    }
});

test('projected active, excluded and audit records are detached from caller inputs', () => {
    const args = fixture();
    const original = freeze(args.records[0]);
    const result = project([original], { 'event-1': null });
    result.activeRecords[0].perPlayer[0].points = 999;
    assert.equal(original.perPlayer[0].points, 180);
    assert.equal(result.auditRecords[0].record.perPlayer[0].points, 180);
});

test('missing index lookups and missing active targets fail closed without fallback', () => {
    const args = fixture();
    throwsCode(() => project(args.records, {}), 'missing-index');
    const current = index(args.tournament, { [args.matchId]: head('result-missing') });
    throwsCode(() => project(args.records, { 'event-1': current }), 'missing-active-result');
    throwsCode(() => planCompletedResultCorrection(withIndex(args, current)), 'missing-active-result');
    throwsCode(() => project(args.records, { 'event-1': undefined }), 'invalid-input');
    throwsCode(() => project(args.records, { 'event-1': { ...current, tournamentId: 'other-event' } }), 'wrong-index');
    throwsCode(() => project(args.records, { 'event-1': { ...current, ownerId: 'other-owner' } }), 'wrong-record');
});

test('unrelated public heads do not require private records outside the authorized snapshot', () => {
    const args = fixture();
    const current = index(args.tournament, { 'GF1': head('private-unrelated-result') });
    assert.deepEqual(project(args.records, { 'event-1': current }).activeRecords, args.records);
    assert.deepEqual(project([], { 'event-1': current }).activeRecords, []);
});

test('legacy records need explicit index absence and an unambiguous single logical record', () => {
    const args = fixture();
    const other = record(args.tournament, args.matchId, 'second-legacy-result');
    for (const current of [null, index(args.tournament)]) {
        throwsCode(() => project([...args.records, other], { 'event-1': current }), 'ambiguous-legacy');
    }
    throwsCode(() => planCompletedResultCorrection({ ...args, records: [...args.records, other] }), 'ambiguous-legacy');
    assert.deepEqual(project(args.records, { 'event-1': null }).activeRecords, args.records);
});

test('source-qualified identity keeps tournament and casual records with the same ID separate', () => {
    const args = fixture();
    const casual = { ...copy(args.records[0]), source: 'casual', ownerId: 'casual-owner', matchId: 'casual-match' };
    delete casual.tournamentId;
    const active = project([...args.records, casual, copy(casual)], { 'event-1': null });
    assert.equal(active.activeRecords.length, 2);
    assert.equal(active.auditRecords.length, 2);
    assert.deepEqual(active.activeRecords.map(item => item.source), ['tournament', 'casual']);
    const invalidated = planResultInvalidation(invalidationArgs(args));
    const result = project([...args.records, casual], { 'event-1': invalidated.index });
    assert.deepEqual(result.activeRecords, [casual]);
    assert.equal(result.excludedRecords.length, 1);
    assert.equal(result.excludedRecords[0].record.source, 'tournament');
});

test('separate tournaments and matches do not logically collapse', () => {
    const args = fixture();
    const otherMatch = args.tournament.matches.find(item => item.id !== args.matchId).id;
    const records = [
        ...args.records,
        record(args.tournament, otherMatch, 'different-match-result'),
        record(args.tournament, args.matchId, 'different-tournament-result', { tournamentId: 'event-2', ownerId: 'owner-2' }),
    ];
    assert.equal(project(records, { 'event-1': null, 'event-2': null }).activeRecords.length, 3);
});

test('projector requires complete decoded trusted-source records', () => {
    const args = fixture();
    for (const recordsComplete of [false, undefined, 'true']) {
        throwsCode(() => project(args.records, { 'event-1': null }, { recordsComplete }), 'incomplete-snapshot');
    }
    for (const changes of [
        { source: undefined }, { source: 'unknown' }, { perPlayer: '{}' }, { perPlayer: null },
        { id: 'bad/path' }, { ownerId: '' }, { matchId: '' }, { tournamentId: '' },
    ]) {
        throwsCode(() => project([{ ...args.records[0], ...changes }], { 'event-1': null }), 'invalid-input');
    }
});

// Pending game lifecycle never authorizes saving, recreates IDs or prunes local state.
test('uncommitted current-epoch ready session preserves local recovery', () => {
    const args = pendingArgs();
    classify(args, 'uncommitted', 'no-record-found');
});

test('already-active pending ID remains recognizable even after unrelated epoch changes', () => {
    const { tournament, matchId } = completed();
    const active = record(tournament, matchId, 'pending-result');
    const current = index(tournament, { [matchId]: head(active.id) }, { revision: 10, correctionEpoch: 9 });
    const args = pendingArgs(start(), {
        tournament, index: current, records: [active],
        pending: { resultId: active.id, matchId, ownerId: OWNER, tournamentId: tournament.id, correctionEpoch: 0, localTurns: [1, 2, 3] },
    });
    classify(args, 'already-active', 'record-still-active');
});

for (const state of ['manual', 'invalidated']) {
    test(`${state} pending record reports superseded and is never treated as saved again`, () => {
        const { tournament, matchId } = completed();
        const original = record(tournament, matchId, 'pending-result');
        classify(pendingArgs(start(), {
            tournament, records: [original],
            index: index(tournament, { [matchId]: head(null, { state, generation: 1, operationId: 'correction-op' }) }),
            pending: { resultId: original.id, matchId, ownerId: OWNER, tournamentId: tournament.id, correctionEpoch: 0, localTurns: [{ points: 180 }] },
        }), 'superseded', 'record-excluded');
    });
}

test('a pending record superseded by a newer active version stays excluded', () => {
    const { tournament, matchId } = completed();
    const original = record(tournament, matchId, 'pending-result');
    const newer = record(tournament, matchId, 'new-result');
    classify(pendingArgs(start(), {
        tournament, records: [original, newer], index: index(tournament, { [matchId]: head(newer.id) }),
        pending: { resultId: original.id, matchId, ownerId: OWNER, tournamentId: tournament.id, correctionEpoch: 0, localTurns: [180] },
    }), 'superseded', 'record-excluded');
});

test('an uncommitted session from an earlier correction epoch becomes a preserved conflict', () => {
    const args = pendingArgs();
    args.index = index(args.tournament, {}, { correctionEpoch: 1 });
    classify(args, 'conflict', 'correction-epoch-changed');
});

for (const correctionEpoch of [undefined, null, -1, 0.5, '0', Number.MAX_SAFE_INTEGER + 1]) {
    test(`uncommitted legacy/invalid epoch ${String(correctionEpoch)} requires review`, () => {
        const args = pendingArgs();
        args.pending.correctionEpoch = correctionEpoch;
        classify(args, 'conflict', 'legacy-session-needs-review');
    });
}

test('legacy committed single record can still be identified as already active', () => {
    const { tournament, matchId } = completed();
    const original = record(tournament, matchId, 'pending-result');
    classify(pendingArgs(start(), {
        tournament, records: [original],
        pending: { resultId: original.id, matchId, ownerId: OWNER, tournamentId: tournament.id, localTurns: [1] },
    }), 'already-active', 'record-still-active');
});

for (const [field, value] of [['ownerId', 'another-owner'], ['tournamentId', 'another-event']]) {
    test(`pending ${field} mismatch is a preserved conflict`, () => {
        const args = pendingArgs();
        args.pending[field] = value;
        classify(args, 'conflict', 'owner-or-tournament-changed');
    });
}

test('same-epoch uncommitted session cannot attach to an already completed or lifecycle-headed match', () => {
    const { tournament, matchId } = completed();
    classify(pendingArgs(start(), {
        tournament,
        pending: { resultId: 'never-written', matchId, ownerId: OWNER, tournamentId: tournament.id, correctionEpoch: 0, localTurns: [1] },
    }), 'conflict', 'match-no-longer-unrecorded');
    const args = pendingArgs();
    args.index = index(args.tournament, {
        [args.pending.matchId]: head(null, { state: 'manual', generation: 1, operationId: 'manual-op' }),
    }, { correctionEpoch: 0 });
    classify(args, 'conflict', 'match-no-longer-unrecorded');
});

test('missing match and another committed active record are preserved pending conflicts', () => {
    const missing = pendingArgs();
    missing.pending.matchId = 'missing-match';
    classify(missing, 'conflict', 'match-missing');
    const { tournament, matchId } = completed();
    const original = record(tournament, matchId);
    classify(pendingArgs(start(), {
        tournament, records: [original],
        pending: { resultId: 'uncommitted-other-id', matchId, ownerId: OWNER, tournamentId: tournament.id, correctionEpoch: 0, localTurns: [1] },
    }), 'conflict', 'match-no-longer-unrecorded');
});

test('pending classification rejects missing active targets, incomplete reads, ambiguous legacy and unauthorized actors', () => {
    const args = pendingArgs();
    throwsCode(() => classifyPendingResult({ ...args, recordsComplete: false }), 'incomplete-snapshot');
    throwsCode(() => classifyPendingResult({ ...args, actor: { ...ACTOR, uid: 'someone-else' } }), 'unauthorized');
    const played = play(args.tournament, args.pending.matchId);
    throwsCode(() => classifyPendingResult({
        ...args, tournament: played, index: index(played, { [args.pending.matchId]: head('missing-result') }),
    }), 'missing-active-result');
    throwsCode(() => classifyPendingResult({
        ...args, records: [record(args.tournament, args.pending.matchId), record(args.tournament, args.pending.matchId, 'other-legacy')],
    }), 'ambiguous-legacy');
});

test('a head that points to an observed record belonging to another match fails closed everywhere', () => {
    const tournament = until(start(4), value => value.status === 'complete');
    const args = argsFor(tournament, tournament.matches.find(item => item.status === 'complete').id);
    const current = index(args.tournament, { GF1: head(args.records[0].id) });
    throwsCode(() => project(args.records, { 'event-1': current }), 'wrong-record');
    const planner = { ...args, index: current, expected: { ...args.expected, indexRevision: current.revision, correctionEpoch: current.correctionEpoch } };
    throwsCode(() => planCompletedResultCorrection(planner), 'wrong-record');
    throwsCode(() => planResultInvalidation(invalidationArgs(planner)), 'wrong-record');
    throwsCode(() => classifyPendingResult({
        tournament: args.tournament, actor: ACTOR, index: current, records: args.records, recordsComplete: true,
        pending: { resultId: args.records[0].id, matchId: args.matchId, ownerId: OWNER, tournamentId: args.tournament.id, correctionEpoch: current.correctionEpoch },
    }), 'wrong-record');
});

test('cross-tournament active pointers cannot relabel an observed record or select the same ID twice', () => {
    const args = fixture();
    const foreign = index(args.tournament, { [args.matchId]: head(args.records[0].id) }, { tournamentId: 'event-2' });
    throwsCode(() => project(args.records, { 'event-1': null, 'event-2': foreign }), 'wrong-record');
    const local = index(args.tournament, { [args.matchId]: head(args.records[0].id) });
    throwsCode(() => project(args.records, { 'event-1': local, 'event-2': foreign }), 'wrong-index');
});

test('public index rejects duplicate active record and operation assignments or impossible revision relationships', () => {
    const tournament = start(4);
    throwsCode(() => validateResultIndex(index(tournament, {
        'W1.1': head('same-result'), 'W1.2': head('same-result'),
    })), 'invalid-input');
    throwsCode(() => validateResultIndex(index(tournament, {
        'W1.1': head('result-a', { operationId: 'same-operation' }),
        'W1.2': head('result-b', { operationId: 'same-operation' }),
    })), 'invalid-input');
    throwsCode(() => validateResultIndex(index(tournament, {
        'W1.1': head('result-a', { generation: 8 }),
    }, { revision: 7 })), 'invalid-input');
    throwsCode(() => validateResultIndex(index(tournament, {}, { revision: 7, correctionEpoch: 8 })), 'invalid-input');
});

test('a canonical-looking bracket cannot remove completed GF2 dependencies to bypass the descendant guard', () => {
    let tournament = until(start(4), value => find(value, 'GF1').status === 'ready');
    tournament = play(play(tournament, 'GF1', 'B'), 'GF2', 'A');
    const args = argsFor(copy(tournament), 'GF1');
    const reset = find(args.tournament, 'GF2');
    reset.sourceA = { teamId: reset.teamA };
    reset.sourceB = { teamId: reset.teamB };
    args.outcome = scores(args.tournament, find(args.tournament, 'GF1'), 'A');
    throwsCode(() => planCompletedResultCorrection(freeze(args)), 'invalid-topology');
});

test('changing selected completed participants while leaving sources unchanged cannot silently rewrite identity', () => {
    const args = fixture(8);
    const match = find(args.tournament, args.matchId);
    const outsider = args.tournament.teams.find(team => ![match.teamA, match.teamB].includes(team.id));
    args.tournament = copy(args.tournament);
    find(args.tournament, args.matchId).teamB = outsider.id;
    args.outcome = scores(args.tournament, find(args.tournament, args.matchId), 'A', { loserScore: 1 });
    assert.throws(() => planCompletedResultCorrection(freeze(args)), /participants|sources|unsafe|recorded play/i);
});

for (const [name, mutate] of [
    ['wrong committed index revision', receipt => { receipt.committedIndexRevision += 1; }],
    ['wrong committed epoch', receipt => { receipt.committedCorrectionEpoch += 1; }],
    ['wrong committed tournament revision', receipt => { receipt.committedTournamentRevision += 1; }],
    ['wrong resulting generation', receipt => { receipt.afterHead.generation += 1; }],
    ['wrong resulting lifecycle state', receipt => { receipt.afterHead.state = 'invalidated'; }],
    ['wrong resulting outcome', receipt => { receipt.afterOutcome.scoreA = 1; }],
    ['missing excluded original record', receipt => { receipt.excludedRecordIds = []; }],
    ['duplicate excluded record IDs', receipt => { receipt.excludedRecordIds.push(receipt.excludedRecordIds[0]); }],
]) {
    test(`receipt replay refuses ${name}`, () => {
        const args = fixture();
        const initial = planCompletedResultCorrection(args);
        const receipt = copy(initial.event);
        mutate(receipt);
        throwsCode(() => planCompletedResultCorrection({
            ...args, tournament: initial.tournament, index: initial.index, priorEvent: receipt,
        }), 'incomplete-snapshot');
    });
}

test('an already-applied receipt must still match the current selected outcome', () => {
    const args = fixture();
    const initial = planCompletedResultCorrection(args);
    const changed = copy(initial.tournament);
    find(changed, args.matchId).scoreA = 1;
    throwsCode(() => planCompletedResultCorrection({
        ...args, tournament: changed, index: initial.index, priorEvent: initial.event,
    }), 'incomplete-snapshot');
});

test('receipt replay cannot reuse its operation ID on a later generation', () => {
    const args = fixture();
    const initial = planCompletedResultCorrection(args);
    const changed = copy(initial.index);
    changed.revision += 1;
    changed.correctionEpoch += 1;
    changed.heads[args.matchId].generation += 1;
    throwsCode(() => planCompletedResultCorrection({
        ...args, tournament: initial.tournament, index: changed, priorEvent: initial.event,
    }), 'incomplete-snapshot');
});

test('decoded records reject non-JSON data, cycles and sparse arrays instead of guessing duplicate equivalence', () => {
    const args = fixture();
    const cycle = {};
    cycle.self = cycle;
    for (const extra of [NaN, Infinity, undefined, () => {}, new Date('2020-01-01'), cycle, [1, , 3]]) {
        throwsCode(() => project([{ ...args.records[0], extra }], { 'event-1': null }), 'invalid-input');
    }
});

test('explicit undefined operation receipt never stands in for confirmed absence', () => {
    const args = fixture(4, { priorEvent: undefined });
    throwsCode(() => planCompletedResultCorrection(args), 'incomplete-snapshot');
    throwsCode(() => planResultInvalidation(invalidationArgs(args)), 'incomplete-snapshot');
});

test('legacy casual match labels are bounded text and do not acquire tournament-only ID restrictions', () => {
    const args = fixture();
    const casual = { ...args.records[0], source: 'casual', matchId: 'Friday darts / doubles' };
    delete casual.tournamentId;
    assert.deepEqual(project([casual, copy(casual)], {}).activeRecords, [casual]);
    for (const matchId of ['', 'x'.repeat(513), null, 12]) {
        throwsCode(() => project([{ ...casual, matchId }], {}), 'invalid-input');
    }
});

test('an active indexed result cannot certify a ready rather than completed bracket match', () => {
    const args = pendingArgs();
    const current = index(args.tournament, { [args.pending.matchId]: head(args.pending.resultId) });
    throwsCode(() => classifyPendingResult({
        ...args, index: current, records: [record(args.tournament, args.pending.matchId, args.pending.resultId)],
    }), 'incomplete-snapshot');
    const selected = fixture();
    const ready = selected.tournament.matches.find(item => item.status === 'ready');
    const contradictory = index(selected.tournament, { [ready.id]: head('contradictory-result') });
    throwsCode(() => planCompletedResultCorrection({ ...selected, index: contradictory }), 'incomplete-snapshot');
    throwsCode(() => planResultInvalidation({ ...invalidationArgs(selected), index: contradictory }), 'incomplete-snapshot');
});

test('a legacy committed ID on a ready match is a preserved consistency conflict', () => {
    const args = pendingArgs();
    args.records = [record(args.tournament, args.pending.matchId, args.pending.resultId)];
    classify(args, 'conflict', 'bracket-record-inconsistent');
});

test('an index with a nonexistent bracket match is rejected by planners and pending classification', () => {
    const args = fixture();
    const current = index(args.tournament, { nonexistent: head('not-a-record') });
    throwsCode(() => planCompletedResultCorrection({ ...args, index: current }), 'wrong-index');
    throwsCode(() => planResultInvalidation({ ...invalidationArgs(args), index: current }), 'wrong-index');
    const pending = pendingArgs();
    throwsCode(() => classifyPendingResult({ ...pending, index: current }), 'wrong-index');
});

test('legacy records from one tournament cannot silently disagree about its organizer', () => {
    const args = fixture();
    const other = args.tournament.matches.find(match => match.id !== args.matchId);
    const foreign = record(args.tournament, other.id, 'foreign-owner-record', { ownerId: 'another-owner' });
    throwsCode(() => project([...args.records, foreign], { 'event-1': null }), 'wrong-record');
});

test('a completed loser-path descendant through a structural bye blocks correction with no played immediate child', () => {
    let tournament = play(start(5), 'W1.2');
    tournament = play(tournament, 'W2.2');
    assert.equal(find(tournament, 'L1.1').status, 'bye');
    assert.equal(find(tournament, 'W2.1').status, 'ready');
    assert.equal(find(tournament, 'L2.2').status, 'ready');
    tournament = play(tournament, 'L2.2');
    const immediate = tournament.matches.filter(match =>
        [match.sourceA, match.sourceB].some(source => source?.matchCode === 'W1.2'));
    assert.equal(immediate.some(match => match.status === 'complete'), false);
    const args = argsFor(tournament, 'W1.2');
    assert.throws(() => planCompletedResultCorrection(args), /dependent|descendant/i);
    args.outcome = scores(tournament, find(tournament, 'W1.2'), 'A', { loserScore: 1 });
    assert.throws(() => planCompletedResultCorrection(args), /dependent|descendant/i);
    assert.deepEqual(planResultInvalidation(invalidationArgs(args)).tournament, tournament);
});

test('a sibling completed match remains byte-for-byte unchanged during a legal leaf correction', () => {
    let tournament = play(start(8), 'W1.1');
    tournament = play(tournament, 'W1.2');
    const before = copy(find(tournament, 'W1.2'));
    const result = planCompletedResultCorrection(argsFor(tournament, 'W1.1'));
    assert.deepEqual(find(result.tournament, 'W1.2'), before);
    assert.equal(result.affectedMatchIds.includes('W1.2'), false);
});

test('corrections accept actual engine tag-derived team IDs containing URI-encoded punctuation', () => {
    const { tournament, matchId } = completed(4, { tagPrefix: 'Saturday / doubles & ' });
    const args = argsFor(tournament, matchId);
    assert.ok(args.outcome.winnerId.includes('%'));
    const result = planCompletedResultCorrection(args);
    assert.equal(find(result.tournament, matchId).winnerId, args.outcome.winnerId);
});

for (const gameType of ['301', '501', 'cricket', 'spanish', 'minnesota']) {
    test(`${gameType} correction obeys the engine's best-of-seven scoring format`, () => {
        const { tournament, matchId } = completed(4, { gameType, bestOf: 7 });
        const args = argsFor(tournament, matchId);
        assert.equal(args.outcome.scoreB, 4);
        assert.deepEqual(planCompletedResultCorrection(args).tournament,
            recordResult(tournament, matchId, args.outcome));
        assert.throws(() => planCompletedResultCorrection({ ...args, outcome: { ...args.outcome, scoreB: 2 } }), /scores|best-of/i);
    });
}
