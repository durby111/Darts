import { game, recordingSession } from './state.js';
import { currentThrower } from './teams.js';

export function newRecordId() {
    return crypto.randomUUID();
}

export const RECORDING_GAMES = new Set(['chicago', '301', '501', 'cricket', 'spanish', 'minnesota']);

export function beginScoringLeg(gameType) {
    const session = recordingSession();
    if (!session) return;
    game.scoringRecords ||= { id: session.resultId, legs: [] };
    game.scoringRecords.legs.push({ id: newRecordId(), gameType, winnerId: null, turns: [] });
    session.legComplete = false;
}

export function recordTurn({ points = 0, darts, marks = 0, bust = false }) {
    const session = recordingSession();
    if (!session) return;
    if (!Number.isInteger(darts) || darts < 1 || darts > 3) {
        throw new Error('Actual darts thrown (1–3) are required.');
    }
    const leg = game.scoringRecords?.legs.at(-1);
    if (!leg || leg.winnerId) throw new Error('This leg is not open for scoring.');
    const human = game.teamMode ? currentThrower(game.currentPlayer) : game.players[game.currentPlayer];
    leg.turns.push({
        id: newRecordId(), registrationId: human?.id || null,
        playerId: human?.playerId || null,
        teamId: session.teams[game.currentPlayer].id,
        points: bust ? 0 : points, darts, marks, bust
    });
}

export function finishScoringLeg(winnerIndex) {
    const session = recordingSession();
    if (!session) return;
    const leg = game.scoringRecords?.legs.at(-1);
    if (!leg || leg.winnerId) return;
    if (!session.teams[winnerIndex]) throw new Error('A recorded leg needs an identified winning side.');
    leg.winnerId = session.teams[winnerIndex].id;
    session.legComplete = true;
    session.legWins[winnerIndex]++;
    session.winnerIndex = winnerIndex;
}

export function scoringStats(records) {
    const totals = new Map();
    for (const leg of records.legs) {
        for (const turn of leg.turns) {
            if (!turn.playerId) continue;
            const key = JSON.stringify([turn.playerId, leg.gameType]);
            const stat = totals.get(key) || {
                playerId: turn.playerId, gameType: leg.gameType, points: 0, darts: 0, marks: 0
            };
            stat.points += turn.points;
            stat.darts += turn.darts;
            stat.marks += turn.marks;
            totals.set(key, stat);
        }
    }
    return [...totals.values()];
}

export function tournamentScoringLocked() {
    const session = recordingSession();
    return !!(session && (session.legComplete || ['pending', 'saving', 'saved'].includes(session.status)));
}

export function requireActualDarts() {
    if (!recordingSession()) return undefined;
    const value = Number(document.getElementById('tournamentActualDarts')?.value);
    if (Number.isInteger(value) && value >= 1 && value <= 3) return value;
    alert('Select the actual darts thrown (1–3), including misses and the bust/checkout dart. Turn totals cannot determine dart count.');
    return null;
}

export function recordingComplete() {
    const session = recordingSession();
    if (!session) return false;
    if (session.source === 'casual' && game.chicago?.gamesRemaining.length === 0) return session.legComplete;
    return Math.max(...session.legWins) >= Math.floor(session.bestOf / 2) + 1;
}

export function recordingWinnerIds() {
    const session = recordingSession();
    if (!session) return [];
    const high = Math.max(...session.legWins);
    return session.teams.filter((_, i) => session.legWins[i] === high).map(t => t.id);
}

export function scoringResult() {
    const session = recordingSession();
    return {
        gameType: session.gameType,
        legScores: game.scoringRecords.legs.map(({ id, gameType, winnerId }) => ({ id, gameType, winnerId })),
        records: JSON.parse(JSON.stringify(game.scoringRecords)),
        participantIds: [...new Set(session.teams.flatMap(t => t.members.map(m => m.playerId)).filter(Boolean))],
        perPlayer: scoringStats(game.scoringRecords)
    };
}

export function pendingDartCount() {
    return game.pendingDarts.reduce((total, dart) => total + (dart.target === 'Bed' ? 3 : 1), 0);
}

export function clearActualDarts() {
    const input = document.getElementById('tournamentActualDarts');
    if (input) input.value = '';
}
