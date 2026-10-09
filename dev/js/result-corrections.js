// Pure, opt-in correction planning. No Firebase, DOM, clock, random IDs or writes.
// Nothing imports this module in the live app. A future storage adapter must load
// authoritative snapshots, enforce authorization/rules and commit plans atomically.
import { createPreview, recordResult } from './brackets/engine.js';

const INDEX_KEYS = ['schemaVersion', 'tournamentId', 'ownerId', 'revision', 'correctionEpoch', 'heads'];
const HEAD_KEYS = ['activeResultId', 'state', 'generation', 'operationId'];
const EXPECTED_KEYS = ['tournamentRevision', 'indexRevision', 'correctionEpoch', 'activeResultId'];
const OUTCOME_KEYS = ['winnerId', 'scoreA', 'scoreB', 'forfeit'];
const REASONS = new Set(['score_entry_error', 'wrong_winner', 'recording_error', 'other']);
const STATES = new Set(['active', 'manual', 'invalidated']);
const clone = value => structuredClone(value);
const own = (value, key) => Object.hasOwn(value, key);
const physicalKey = record => JSON.stringify([record.source, record.id]);

function fail(code, message) {
    throw Object.assign(new Error(message), { code: `correction/${code}` });
}
function object(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
        fail('invalid-input', `${label} must be a plain object.`);
    }
}
function keys(value, allowed, label) {
    object(value, label);
    if (Object.keys(value).length !== allowed.length || allowed.some(key => !own(value, key))) {
        fail('invalid-input', `${label} has missing or unsupported fields.`);
    }
}
function identifier(value, label, match = false) {
    const pattern = match ? /^[A-Za-z0-9_.-]{1,128}$/ : /^[A-Za-z0-9_-]{1,128}$/;
    if (typeof value !== 'string' || !pattern.test(value)
        || ['__proto__', 'prototype', 'constructor'].includes(value)) {
        fail('invalid-input', `${label} is not a stable ID.`);
    }
}
function natural(value, label) {
    if (!Number.isSafeInteger(value) || value < 0) fail('invalid-input', `${label} must be a nonnegative safe integer.`);
}
function increment(value, label) {
    natural(value, label);
    if (value === Number.MAX_SAFE_INTEGER) fail('invalid-input', `${label} cannot advance safely.`);
    return value + 1;
}
function canonical(value, stack = new Set()) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
    if (!Array.isArray(value)) object(value, 'JSON value');
    if (stack.has(value)) fail('invalid-input', 'JSON snapshots cannot contain cycles.');
    stack.add(value);
    try {
        if (Array.isArray(value)) return `[${Array.from(value, item => canonical(item, stack)).join(',')}]`;
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key], stack)}`).join(',')}}`;
    } finally { stack.delete(value); }
}
function equal(a, b) { return canonical(a) === canonical(b); }
function validateHead(head) {
    keys(head, HEAD_KEYS, 'Result head');
    natural(head.generation, 'Head generation');
    if (!STATES.has(head.state)) fail('invalid-input', 'Unknown result-head state.');
    if (head.state === 'active') identifier(head.activeResultId, 'Active result ID');
    else if (head.activeResultId !== null) fail('invalid-input', 'Excluded heads cannot retain an active result.');
    if (head.operationId !== null) identifier(head.operationId, 'Head operation ID');
    if (head.state !== 'active' && (!head.operationId || head.generation === 0)) {
        fail('invalid-input', 'Excluded heads require an operation and positive generation.');
    }
}

/** Exact metadata-only schema. This is not a deployed Firestore schema. */
export function validateResultIndex(index) {
    keys(index, INDEX_KEYS, 'Result index');
    if (index.schemaVersion !== 1) fail('invalid-input', 'Unsupported result-index version.');
    identifier(index.tournamentId, 'Tournament ID');
    identifier(index.ownerId, 'Organizer ID');
    natural(index.revision, 'Index revision');
    natural(index.correctionEpoch, 'Correction epoch');
    object(index.heads, 'Result heads');
    if (Object.keys(index.heads).length > 63) fail('invalid-input', 'A doubles result index supports at most 63 matches.');
    const activeIds = new Set(), operations = new Set();
    for (const [matchId, head] of Object.entries(index.heads)) {
        identifier(matchId, 'Match ID', true);
        validateHead(head);
        if (head.generation > index.revision) fail('invalid-input', 'Head generation exceeds its index revision.');
        if (head.activeResultId && activeIds.has(head.activeResultId)) fail('invalid-input', 'One result cannot be active for two matches.');
        if (head.operationId && operations.has(head.operationId)) fail('invalid-input', 'One operation cannot own two match heads.');
        if (head.activeResultId) activeIds.add(head.activeResultId);
        if (head.operationId) operations.add(head.operationId);
    }
    if (index.correctionEpoch > index.revision) fail('invalid-input', 'Correction epoch exceeds its index revision.');
    return clone(index);
}

function indexFor(tournament, index) {
    if (index === null) return {
        schemaVersion: 1, tournamentId: tournament.id, ownerId: tournament.ownerId,
        revision: 0, correctionEpoch: 0, heads: {},
    };
    const validated = validateResultIndex(index);
    if (validated.tournamentId !== tournament.id || validated.ownerId !== tournament.ownerId) {
        fail('wrong-index', 'The result index belongs to another tournament or organizer.');
    }
    if (Object.keys(validated.heads).some(id => !tournament.matches.some(match => match.id === id))) {
        fail('wrong-index', 'The result index contains a match outside this bracket.');
    }
    if (Object.entries(validated.heads).some(([id, head]) => head.state === 'active'
        && tournament.matches.find(match => match.id === id).status !== 'complete')) {
        fail('incomplete-snapshot', 'An active recorded result belongs to a match that is not complete.');
    }
    return validated;
}
function authorize(tournament, actor) {
    object(tournament, 'Tournament');
    identifier(tournament.id, 'Tournament ID');
    identifier(tournament.ownerId, 'Organizer ID');
    natural(tournament.revision, 'Tournament revision');
    if (!actor || actor.emailVerified !== true || actor.isAnonymous !== false || actor.uid !== tournament.ownerId) {
        fail('unauthorized', 'Only the verified tournament organizer can plan this change.');
    }
    if (!['live', 'complete'].includes(tournament.status) || !Array.isArray(tournament.matches)) {
        fail('invalid-input', 'A started tournament snapshot is required.');
    }
    validateTopology(tournament);
}
function validateTopology(tournament) {
    if (!Array.isArray(tournament.teams) || tournament.teams.length < 2 || tournament.teams.length > 32
        || tournament.matches.length < 1 || tournament.matches.length > 63) {
        fail('invalid-topology', 'A supported doubles bracket snapshot is required.');
    }
    const teamIds = new Set(tournament.teams.map(team => team.id)), ids = new Set(), codes = new Set();
    if (teamIds.size !== tournament.teams.length || [...teamIds].some(id => typeof id !== 'string' || !id)) {
        fail('invalid-topology', 'Bracket teams require unique IDs.');
    }
    for (const match of tournament.matches) {
        object(match, 'Match');
        identifier(match.id, 'Match ID', true);
        identifier(match.code, 'Match code', true);
        if (ids.has(match.id) || codes.has(match.code)) fail('invalid-topology', 'Bracket matches require unique IDs and codes.');
        if (!['pending', 'ready', 'complete', 'bye', 'void'].includes(match.status)) fail('invalid-topology', 'Unknown match state.');
        for (const source of [match.sourceA, match.sourceB]) {
            if (source === null) continue;
            object(source, 'Bracket source');
            if (own(source, 'teamId')) {
                keys(source, ['teamId'], 'Team source');
                if (!teamIds.has(source.teamId)) fail('invalid-topology', 'A source refers to an unknown team.');
            } else {
                keys(source, ['matchCode', 'outcome'], 'Match source');
                if (!codes.has(source.matchCode) || !['winner', 'loser'].includes(source.outcome)) {
                    fail('invalid-topology', 'Match sources must reference an earlier match in canonical order.');
                }
            }
        }
        for (const team of [match.teamA, match.teamB, match.winnerId]) {
            if (team !== null && !teamIds.has(team)) fail('invalid-topology', 'A match refers to an unknown team.');
        }
        if (match.status === 'complete' && (!match.teamA || !match.teamB || match.teamA === match.teamB
            || ![match.teamA, match.teamB].includes(match.winnerId))) {
            fail('invalid-topology', 'A completed played match needs two teams and their winner.');
        }
        ids.add(match.id);
        codes.add(match.code);
    }
    if (!codes.has('GF1') || !codes.has('GF2')) fail('invalid-topology', 'Grand-final matches are missing.');
    // The engine also has implicit GF2 behavior. Merely accepting an acyclic
    // graph is insufficient: removing GF2's GF1 edges could hide a played final.
    // Compare the current engine's canonical shape, ignoring randomized seed IDs.
    const shape = createPreview({ status: 'registration', registrations: Array.from({ length: teamIds.size * 2 }, (_, i) => ({
        id: `shape-${i}`, playerId: null, name: `Shape ${i}`, tag: String(Math.floor(i / 2)),
        paid: false, checkedIn: true, standby: false,
    })) }).matches;
    const seeded = new Set();
    if (shape.length !== tournament.matches.length) fail('invalid-topology', 'The bracket does not have the canonical match set.');
    for (const [position, expected] of shape.entries()) {
        const actual = tournament.matches[position];
        if (['id', 'code', 'bracket', 'round', 'position'].some(key => actual[key] !== expected[key])) {
            fail('invalid-topology', 'The bracket does not use the canonical match order and IDs.');
        }
        for (const side of ['sourceA', 'sourceB']) {
            if (expected[side] && own(expected[side], 'teamId')) {
                if (!actual[side] || !own(actual[side], 'teamId') || seeded.has(actual[side].teamId)) {
                    fail('invalid-topology', 'Each registered team must occupy one canonical seed.');
                }
                seeded.add(actual[side].teamId);
            } else if (!equal(actual[side], expected[side])) {
                fail('invalid-topology', 'The bracket has a changed dependency or bye path.');
            }
        }
    }
    if (seeded.size !== teamIds.size) fail('invalid-topology', 'A registered team is missing from the bracket seeds.');
}
function outcome(match) {
    return Object.fromEntries(OUTCOME_KEYS.map(key => [key, match[key]]));
}
function validateOutcome(value) {
    keys(value, OUTCOME_KEYS, 'Manual outcome');
    if (typeof value.winnerId !== 'string' || !value.winnerId || value.winnerId.length > 512) {
        fail('invalid-input', 'A winner team ID is required.');
    }
    if (typeof value.forfeit !== 'boolean') fail('invalid-input', 'Forfeit must be boolean.');
    for (const key of ['scoreA', 'scoreB']) {
        if (value[key] !== null) natural(value[key], key);
    }
    return clone(value);
}
function recordsByIdentity(records, complete) {
    if (complete !== true || !Array.isArray(records)) fail('incomplete-snapshot', 'A complete, decoded result snapshot is required.');
    const unique = new Map();
    for (const record of records) {
        object(record, 'Result');
        if (!['tournament', 'casual'].includes(record.source)) fail('invalid-input', 'Every result must have an explicit trusted source.');
        identifier(record.id, 'Result ID');
        identifier(record.ownerId, 'Result owner ID');
        if (record.source === 'tournament') identifier(record.matchId, 'Result match ID', true);
        else if (typeof record.matchId !== 'string' || !record.matchId.trim() || record.matchId.length > 128) {
            fail('invalid-input', 'Casual match IDs must be nonempty text of at most 128 characters.');
        }
        if (!Array.isArray(record.perPlayer)) fail('invalid-input', 'Result counters must be decoded arrays.');
        if (record.source === 'tournament') identifier(record.tournamentId, 'Result tournament ID');
        canonical(record); // Accept decoded JSON data only, never functions, NaN or cycles.
        const key = physicalKey(record);
        if (unique.has(key) && !equal(unique.get(key), record)) fail('duplicate-id', 'Conflicting payloads share one result ID.');
        unique.set(key, record);
    }
    return [...unique.values()];
}
function selectedRecords(records, complete, tournament, matchId, index) {
    const decoded = recordsByIdentity(records, complete);
    if (decoded.some(record => record.source !== 'tournament' || record.tournamentId !== tournament.id
        || record.matchId !== matchId || record.ownerId !== tournament.ownerId)) {
        fail('wrong-record', 'The selected snapshot must contain only this organizer’s records for this match.');
    }
    for (const [headMatchId, head] of Object.entries(index.heads)) {
        if (headMatchId !== matchId && decoded.some(record => record.id === head.activeResultId)) {
            fail('wrong-record', 'A selected record is assigned to another match head.');
        }
    }
    return decoded;
}
function activeRecord(records, head) {
    if (!head) {
        if (records.length > 1) fail('ambiguous-legacy', 'Multiple legacy records for this match require review.');
        return records[0] || null;
    }
    if (head.state !== 'active') return null;
    const active = records.find(record => record.id === head.activeResultId);
    if (!active) fail('missing-active-result', 'The active result is missing. Refresh; do not use an older version.');
    return active;
}
function validateExpected(expected) {
    keys(expected, EXPECTED_KEYS, 'Expected state');
    for (const key of ['tournamentRevision', 'indexRevision', 'correctionEpoch']) natural(expected[key], key);
    if (expected.correctionEpoch > expected.indexRevision) fail('invalid-input', 'Expected correction epoch exceeds its index revision.');
    if (expected.activeResultId !== null) identifier(expected.activeResultId, 'Expected active result ID');
}
function requestFor(args, type) {
    identifier(args.matchId, 'Match ID', true);
    identifier(args.operationId, 'Operation ID');
    validateExpected(args.expected);
    if (!REASONS.has(args.reasonCode)) fail('invalid-input', 'Choose a supported correction reason code.');
    if (type === 'invalidate' && args.outcome !== undefined) fail('invalid-input', 'Statistics invalidation cannot change an outcome.');
    return {
        operationId: args.operationId, tournamentId: args.tournament.id, matchId: args.matchId,
        actorId: args.actor.uid, type, reasonCode: args.reasonCode, expected: clone(args.expected),
        outcome: type === 'manual' ? validateOutcome(args.outcome) : null,
    };
}
function replayPlan(tournament, index, request, priorEvent) {
    if (priorEvent === undefined || priorEvent === null) return null;
    keys(priorEvent, ['schemaVersion', 'request', 'beforeOutcome', 'afterOutcome', 'beforeHead', 'afterHead',
        'committedTournamentRevision', 'committedIndexRevision', 'committedCorrectionEpoch', 'excludedRecordIds'], 'Prior correction event');
    if (priorEvent.schemaVersion !== 1 || !equal(priorEvent.request, request)) {
        fail('operation-conflict', 'This operation ID has already been used for a different request.');
    }
    validateHead(priorEvent.afterHead);
    if (priorEvent.beforeHead !== null) validateHead(priorEvent.beforeHead);
    validateOutcome(priorEvent.beforeOutcome);
    validateOutcome(priorEvent.afterOutcome);
    for (const key of ['committedTournamentRevision', 'committedIndexRevision', 'committedCorrectionEpoch']) natural(priorEvent[key], key);
    if (priorEvent.afterHead.state !== (request.type === 'manual' ? 'manual' : 'invalidated')
        || priorEvent.afterHead.generation !== increment(priorEvent.beforeHead?.generation || 0, 'Prior head generation')
        || priorEvent.committedIndexRevision !== increment(request.expected.indexRevision, 'Expected index revision')
        || priorEvent.committedCorrectionEpoch !== increment(request.expected.correctionEpoch, 'Expected correction epoch')
        || priorEvent.committedTournamentRevision !== request.expected.tournamentRevision + (request.type === 'manual' ? 1 : 0)
        || !equal(priorEvent.afterOutcome, request.type === 'manual' ? request.outcome : priorEvent.beforeOutcome)
        || (request.type === 'manual' && equal(priorEvent.beforeOutcome, request.outcome))
        || (request.type === 'invalidate' && request.expected.activeResultId === null)
        || (priorEvent.beforeHead && priorEvent.beforeHead.generation > request.expected.indexRevision)
        || (priorEvent.beforeHead && priorEvent.beforeHead.activeResultId !== request.expected.activeResultId)
        || !Array.isArray(priorEvent.excludedRecordIds) || new Set(priorEvent.excludedRecordIds).size !== priorEvent.excludedRecordIds.length
        || (request.expected.activeResultId && !priorEvent.excludedRecordIds.includes(request.expected.activeResultId))) {
        fail('incomplete-snapshot', 'The correction receipt is inconsistent with its request.');
    }
    priorEvent.excludedRecordIds.forEach(id => identifier(id, 'Excluded result ID'));
    if (priorEvent.afterHead.operationId !== request.operationId
        || index.revision < priorEvent.committedIndexRevision
        || index.correctionEpoch < priorEvent.committedCorrectionEpoch
        || tournament.revision < priorEvent.committedTournamentRevision) {
        fail('incomplete-snapshot', 'The correction receipt and current state do not agree.');
    }
    const head = index.heads[request.matchId];
    if (!head || head.generation < priorEvent.afterHead.generation) fail('incomplete-snapshot', 'The correction head is missing or older than its receipt.');
    const active = equal(head, priorEvent.afterHead);
    if (!active && head.generation === priorEvent.afterHead.generation) fail('incomplete-snapshot', 'The correction head conflicts with its receipt.');
    if ((!active && head.operationId === request.operationId)
        || (active && !equal(outcome(tournament.matches.find(match => match.id === request.matchId)), priorEvent.afterOutcome))) {
        fail('incomplete-snapshot', 'The current bracket or operation head disagrees with the correction receipt.');
    }
    return {
        status: active ? 'already-applied' : 'superseded', needsCommit: false,
        tournament: clone(tournament), index: clone(index), event: null,
        affectedMatchIds: [], excludedRecordIds: [],
    };
}

function plan(args, type) {
    authorize(args.tournament, args.actor);
    if (!own(args, 'priorEvent') || args.priorEvent === undefined) fail('incomplete-snapshot', 'Load the operation receipt, using explicit null only when it does not exist.');
    const tournament = args.tournament, index = indexFor(tournament, args.index);
    const request = requestFor(args, type);
    const repeated = replayPlan(tournament, index, request, args.priorEvent);
    if (repeated) return repeated;
    if (Object.values(index.heads).some(head => head.operationId === request.operationId)) {
        fail('missing-operation-receipt', 'Load the existing correction receipt before retrying this operation.');
    }
    const match = tournament.matches.find(item => item.id === request.matchId);
    if (!match || match.status !== 'complete') fail('not-complete', 'Only a completed played match can be corrected or invalidated.');
    const records = selectedRecords(args.records, args.recordsComplete, tournament, request.matchId, index);
    const beforeHead = own(index.heads, request.matchId) ? index.heads[request.matchId] : null;
    const active = activeRecord(records, beforeHead);
    const expected = request.expected;
    if (expected.tournamentRevision !== tournament.revision || expected.indexRevision !== index.revision
        || expected.correctionEpoch !== index.correctionEpoch || expected.activeResultId !== (active?.id || null)) {
        fail('stale-state', 'The tournament or active result changed. Reload before planning another operation.');
    }
    if (type === 'invalidate' && !active) fail('no-active-result', 'This match has no active recorded statistics to invalidate.');
    let next = clone(tournament);
    if (type === 'manual') {
        if (equal(outcome(match), request.outcome)) fail('no-outcome-change', 'The outcome is unchanged. Use statistics invalidation if its ledger is wrong.');
        increment(tournament.revision, 'Tournament revision');
        next = recordResult(tournament, request.matchId, request.outcome);
        const changed = next.matches.find(item => item.id === request.matchId);
        if (!changed || changed.status !== 'complete' || !equal(outcome(changed), request.outcome)
            || changed.teamA !== match.teamA || changed.teamB !== match.teamB
            || tournament.matches.some(previous => previous.id !== request.matchId && previous.status === 'complete'
                && !equal(previous, next.matches.find(item => item.id === previous.id)))) {
            fail('unsafe-correction', 'The correction would change other recorded play or the selected match participants.');
        }
    }
    const afterHead = {
        activeResultId: null, state: type === 'manual' ? 'manual' : 'invalidated',
        generation: increment(beforeHead?.generation || 0, 'Head generation'), operationId: request.operationId,
    };
    const nextIndex = {
        ...index, revision: increment(index.revision, 'Index revision'),
        correctionEpoch: increment(index.correctionEpoch, 'Correction epoch'),
        heads: { ...index.heads, [request.matchId]: afterHead },
    };
    validateResultIndex(nextIndex);
    const excludedRecordIds = records.map(record => record.id).sort();
    const event = {
        schemaVersion: 1, request, beforeOutcome: outcome(match),
        afterOutcome: outcome(next.matches.find(item => item.id === request.matchId)),
        beforeHead: clone(beforeHead), afterHead: clone(afterHead),
        committedTournamentRevision: next.revision, committedIndexRevision: nextIndex.revision,
        committedCorrectionEpoch: nextIndex.correctionEpoch, excludedRecordIds,
    };
    return {
        status: 'planned', needsCommit: true, tournament: next, index: nextIndex, event,
        affectedMatchIds: next.matches.filter((item, position) => !equal(item, tournament.matches[position])).map(item => item.id),
        excludedRecordIds: [...excludedRecordIds],
    };
}

export function planCompletedResultCorrection(args) { return plan(args, 'manual'); }
export function planResultInvalidation(args) { return plan(args, 'invalidate'); }

/** Confirmed missing indexes are explicit null values, never omitted/failed reads.
 * Project only the caller-authorized, complete result snapshot. Index entries for
 * other matches do not authorize loading those players' private records.
 */
export function projectEffectiveRecords({ records, recordsComplete, tournamentIndexes }) {
    object(tournamentIndexes, 'Tournament index snapshots');
    const indexes = new Map(), activePointers = new Map();
    for (const [id, value] of Object.entries(tournamentIndexes)) {
        identifier(id, 'Tournament ID');
        if (value === null) indexes.set(id, null);
        else {
            const index = validateResultIndex(value);
            if (index.tournamentId !== id) fail('wrong-index', 'The index key and tournament ID disagree.');
            for (const [matchId, head] of Object.entries(index.heads)) {
                if (head.activeResultId && activePointers.has(head.activeResultId)) fail('wrong-index', 'One tournament result is active in multiple indexes.');
                if (head.activeResultId) activePointers.set(head.activeResultId, [id, matchId]);
            }
            indexes.set(id, index);
        }
    }
    const decoded = recordsByIdentity(records, recordsComplete), groups = new Map(), organizers = new Map();
    for (const record of decoded.filter(item => item.source === 'tournament')) {
        const pointer = activePointers.get(record.id);
        if (pointer && (pointer[0] !== record.tournamentId || pointer[1] !== record.matchId)) {
            fail('wrong-record', 'An observed result disagrees with the tournament or match that references it.');
        }
        if (!indexes.has(record.tournamentId)) fail('missing-index', 'A tournament index lookup is missing. Refresh before calculating totals.');
        const index = indexes.get(record.tournamentId);
        if (index && index.ownerId !== record.ownerId) fail('wrong-record', 'The result organizer does not match its index.');
        if (organizers.has(record.tournamentId) && organizers.get(record.tournamentId) !== record.ownerId) {
            fail('wrong-record', 'Records for one tournament disagree about its organizer.');
        }
        organizers.set(record.tournamentId, record.ownerId);
        const key = JSON.stringify([record.tournamentId, record.matchId]);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(record);
    }
    const statuses = new Map();
    for (const records of groups.values()) {
        const first = records[0], index = indexes.get(first.tournamentId);
        const head = index && own(index.heads, first.matchId) ? index.heads[first.matchId] : null;
        const active = activeRecord(records, head);
        for (const record of records) {
            const status = active?.id === record.id ? (head ? 'active' : 'active-legacy')
                : head.state === 'manual' ? 'manual-correction' : head.state === 'invalidated' ? 'invalidated' : 'superseded';
            statuses.set(physicalKey(record), status);
        }
    }
    const auditRecords = decoded.map(record => {
        const status = record.source === 'casual' ? 'active' : statuses.get(physicalKey(record));
        return { record: clone(record), status, contributes: ['active', 'active-legacy'].includes(status) };
    });
    return {
        activeRecords: auditRecords.filter(item => item.contributes).map(item => clone(item.record)),
        excludedRecords: auditRecords.filter(item => !item.contributes).map(clone),
        auditRecords,
    };
}

/** Lifecycle classification only, never authorization to save/prune a pending game.
 * The adapter must still check authoritative teams, game format and current auth.
 */
export function classifyPendingResult({ tournament, actor, index, records, recordsComplete, pending }) {
    authorize(tournament, actor);
    const currentIndex = indexFor(tournament, index);
    object(pending, 'Pending result');
    identifier(pending.resultId, 'Pending result ID');
    identifier(pending.matchId, 'Pending match ID', true);
    const keep = (status, reason) => ({ status, reason, preserveLocal: true });
    if (pending.ownerId !== actor.uid || pending.tournamentId !== tournament.id) return keep('conflict', 'owner-or-tournament-changed');
    const match = tournament.matches.find(item => item.id === pending.matchId);
    if (!match) return keep('conflict', 'match-missing');
    const selected = selectedRecords(records, recordsComplete, tournament, pending.matchId, currentIndex);
    const head = own(currentIndex.heads, pending.matchId) ? currentIndex.heads[pending.matchId] : null;
    const active = activeRecord(selected, head);
    if (selected.some(record => record.id === pending.resultId)) {
        if (active?.id === pending.resultId && match.status !== 'complete') return keep('conflict', 'bracket-record-inconsistent');
        return active?.id === pending.resultId ? keep('already-active', 'record-still-active') : keep('superseded', 'record-excluded');
    }
    if (!Number.isSafeInteger(pending.correctionEpoch) || pending.correctionEpoch < 0) return keep('conflict', 'legacy-session-needs-review');
    if (pending.correctionEpoch !== currentIndex.correctionEpoch) return keep('conflict', 'correction-epoch-changed');
    if (head || active || match?.status !== 'ready') return keep('conflict', 'match-no-longer-unrecorded');
    return keep('uncommitted', 'no-record-found');
}
