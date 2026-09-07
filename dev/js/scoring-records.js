import { game } from './state.js';
import { currentThrower } from './teams.js';

export function newRecordId() {
    return crypto.randomUUID();
}

export function beginScoringLeg(gameType) {
    if (!game.tournament) return;
    game.scoringRecords ||= { id: game.tournament.resultId, legs: [] };
    game.scoringRecords.legs.push({ id: newRecordId(), gameType, winnerId: null, turns: [] });
    game.tournament.legComplete = false;
}

export function recordTurn({ points = 0, darts, marks = 0, bust = false }) {
    if (!game.tournament) return;
    if (!Number.isInteger(darts) || darts < 1 || darts > 3) {
        throw new Error('Actual darts thrown (1–3) are required.');
    }
    const leg = game.scoringRecords?.legs.at(-1);
    if (!leg || leg.winnerId) throw new Error('This leg is not open for scoring.');
    const human = game.teamMode ? currentThrower(game.currentPlayer) : game.players[game.currentPlayer];
    leg.turns.push({
        id: newRecordId(), registrationId: human?.id || null,
        playerId: human?.playerId || null,
        teamId: game.teams?.[game.currentPlayer]?.id || null,
        points: bust ? 0 : points, darts, marks, bust
    });
}

export function finishScoringLeg(winnerIndex) {
    if (!game.tournament) return;
    const leg = game.scoringRecords?.legs.at(-1);
    if (!leg || leg.winnerId) return;
    leg.winnerId = game.tournament.teams[winnerIndex].id;
    game.tournament.legComplete = true;
    game.tournament.legWins[winnerIndex]++;
    game.tournament.winnerIndex = winnerIndex;
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
    return !!(game.tournament && (game.tournament.legComplete || game.tournament.status === 'saved'));
}

export function requireActualDarts() {
    if (!game.tournament) return undefined;
    const value = Number(document.getElementById('tournamentActualDarts')?.value);
    if (Number.isInteger(value) && value >= 1 && value <= 3) return value;
    alert('Select the actual darts thrown (1–3), including misses and the bust/checkout dart. Turn totals cannot determine dart count.');
    return null;
}

export function clearActualDarts() {
    const input = document.getElementById('tournamentActualDarts');
    if (input) input.value = '';
}
