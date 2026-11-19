// TV spectator board — pure, read-only view model. DEV only.
// Input is a storage-like object exposing getItem(); this module never calls
// setItem/removeItem, takes no locks, and makes no network request. It reads the
// same two device-local values the organizer page and local scorer already write.
import { matchFormat } from '../js/brackets/engine.js';
import { registrationLabels } from '../js/brackets/labels.js';

export const TOURNAMENT_KEY = 'blakeout_dev_local_tournaments_v1';
export const ACTIVE_GAME_KEY = 'blakeout_dev_local_active_game';

const GAME_LABELS = { '301': '301', '501': '501', cricket: 'Cricket', spanish: 'Spanish Cricket', minnesota: 'Minnesota Cricket', chicago: 'Chicago' };
const BRACKET_LABELS = { winners: 'Winners bracket', losers: 'Losers bracket', final: 'Grand final', reset: 'Grand final reset' };
const SCORE_LABELS = { '301': 'left', '501': 'left' };

export function gameLabel(type) { return GAME_LABELS[type] || String(type || 'Game'); }

export function readEvents(storage) {
    let raw;
    try { raw = storage.getItem(TOURNAMENT_KEY); } catch { return { events: [], error: 'Browser storage is unavailable on this page.' }; }
    if (!raw) return { events: [], error: null };
    try {
        const data = JSON.parse(raw);
        if (data.version !== 1 || !data.events || typeof data.events !== 'object') throw Error('unsupported');
        return { events: Object.values(data.events).filter(e => e && typeof e.id === 'string' && Array.isArray(e.matches)), error: null };
    } catch { return { events: [], error: 'Saved tournaments could not be read. Nothing was changed; open the organizer page to check them.' }; }
}

function readActive(storage) {
    try {
        const game = JSON.parse(storage.getItem(ACTIVE_GAME_KEY));
        return game && typeof game === 'object' ? game : null;
    } catch { return null; }
}

function teamView(event, teamId, labels) {
    const team = event.teams.find(item => item.id === teamId);
    if (!team) return { id: teamId || null, name: 'Not decided', members: [] };
    // Names only. Paid, check-in and standby flags are organizer data and are never exposed here.
    return { id: team.id, name: team.name, members: team.memberIds.map(id => labels.get(id) || 'Unknown player') };
}

function formatOf(event, match) {
    try { return matchFormat(event, match); } catch { return null; }
}

function matchView(event, match, labels) {
    const format = formatOf(event, match);
    return {
        id: match.id, code: match.code, bracket: BRACKET_LABELS[match.bracket] || 'Match',
        game: format ? gameLabel(format.gameType) : 'Game not set', bestOf: format?.bestOf ?? null,
        teams: [teamView(event, match.teamA, labels), teamView(event, match.teamB, labels)],
    };
}

// The scorer on this device is the only source of a live score. A session is
// shown only when it still matches a ready match and its saved team pairing.
function currentMatch(event, game, labels) {
    const session = game?.tournament;
    if (!session || session.localOnly !== true || session.tournamentId !== event.id) return null;
    if (!['scoring', 'pending', 'saving'].includes(session.status)) return null;
    const match = event.matches.find(item => item.id === session.matchId && item.status === 'ready');
    if (!match || session.teams?.[0]?.id !== match.teamA || session.teams?.[1]?.id !== match.teamB) return null;
    const view = matchView(event, match, labels);
    const players = Array.isArray(game.players) ? game.players : [];
    const legType = typeof game.type === 'string' ? game.type : session.gameType;
    view.legGame = gameLabel(legType);
    view.scoreLabel = SCORE_LABELS[legType] || 'points';
    view.awaitingSave = session.status !== 'scoring';
    view.sides = view.teams.map((team, index) => {
        const score = players[index]?.score;
        const legs = session.legWins?.[index];
        return {
            ...team,
            // A missing number is shown as unknown, never as zero.
            score: Number.isFinite(score) ? score : null,
            legs: Number.isSafeInteger(legs) ? legs : null,
            throwing: !view.awaitingSave && !session.legComplete && game.currentPlayer === index,
        };
    });
    view.updatedAt = Number.isFinite(game.timestamp) ? game.timestamp : null;
    return view;
}

export function chooseEvent(events, requestedId, game) {
    if (requestedId) return events.find(event => event.id === requestedId) || null;
    const scoring = events.find(event => event.id === game?.tournament?.tournamentId && event.status === 'live');
    if (scoring) return scoring;
    const live = events.filter(event => event.status === 'live');
    if (live.length === 1) return live[0];
    return events.length === 1 ? events[0] : null;
}

export function buildBoard(storage, requestedId = null) {
    const { events, error } = readEvents(storage);
    const game = readActive(storage);
    const list = events.map(event => ({ id: event.id, title: event.title, date: event.date, status: event.status }));
    const event = chooseEvent(events, requestedId, game);
    if (!event) return { error, events: list, event: null, requestedMissing: !!requestedId && !error };
    const labels = registrationLabels(event.registrations || []);
    const current = event.status === 'live' ? currentMatch(event, game, labels) : null;
    const onDeck = event.status === 'live'
        ? event.matches.filter(match => match.status === 'ready' && match.id !== current?.id).map(match => matchView(event, match, labels))
        : [];
    const final = [...event.matches].reverse().find(match => ['reset', 'final'].includes(match.bracket) && match.status === 'complete');
    return {
        error, events: list, requestedMissing: false,
        event: { id: event.id, title: event.title, date: event.date, status: event.status },
        current, onDeck,
        champion: event.status === 'complete' && final?.winnerId ? teamView(event, final.winnerId, labels) : null,
        tournament: event, inProgressMatchId: current?.id || null,
    };
}
