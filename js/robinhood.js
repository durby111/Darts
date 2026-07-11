/* ============================================
   Robin Hood

   Ten rounds of bullseyes only. Outer Bull = 100,
   Inner Bull = 200. Highest score after round 10 wins.
   ============================================ */

import { game } from './state.js';
import { showWinner } from './ui.js';

export function initRobinHoodState() {
    return { round: 1, totalRounds: 10 };
}

export function currentTarget() {
    const robin = game.robinHood;
    if (!robin) return null;
    return { label: `Round ${robin.round} of ${robin.totalRounds}`, value: 'Bull', kind: 'bull' };
}

export function describeHitButtons() {
    return {
        single: 'Outer Bull (+100)',
        double: 'Inner Bull (+200)',
        triple: '—',
        tripleEnabled: false
    };
}

export function pointsForHit(kind) {
    if (kind === 'double') return 200;
    if (kind === 'single') return 100;
    return 0;
}

export function commitTurn(turnScore, hits) {
    const robin = game.robinHood;
    const player = game.players[game.currentPlayer];
    player.score += turnScore;
    player.throws++;
    player.history.push({
        round: robin.round,
        score: turnScore,
        outerBulls: hits.filter(hit => hit.kind === 'single').length,
        innerBulls: hits.filter(hit => hit.kind === 'double').length
    });

    const isLastPlayer = game.currentPlayer === game.players.length - 1;
    game.currentPlayer = (game.currentPlayer + 1) % game.players.length;
    if (!isLastPlayer) return { matchOver: false };

    game.completedRounds++;
    if (robin.round < robin.totalRounds) {
        robin.round++;
        return { matchOver: false };
    }

    const high = Math.max(...game.players.map(candidate => candidate.score));
    const winners = game.players.filter(candidate => candidate.score === high).map(candidate => candidate.name);
    showWinner(winners.join(' & '), false, true);
    return { matchOver: true };
}
