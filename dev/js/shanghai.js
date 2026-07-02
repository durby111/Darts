/* ============================================
   Shanghai Mode

   Rounds 1 → N (7 standard, 20 marathon). Each player throws 3
   darts per round at the round's number.

   Scoring per dart: face value × multiplier
     (round 5: single = 5, double = 10, triple = 15)

   THE SHANGHAI: land a Single, a Double AND a Triple of the round
   number in the same turn → instant win, game over on the spot.

   Otherwise, highest total score after the final round wins.

   Variants (game.shanghai.variant):
   - 'rounds17'  : rounds 1–7 (standard pub rules)
   - 'rounds120' : rounds 1–20 (marathon)
   ============================================ */

import { game } from './state.js';
import { showWinner } from './ui.js';

export function initShanghaiState(variant) {
    return {
        variant: variant || 'rounds17',
        round: 1
    };
}

export function totalRounds(variant) {
    return variant === 'rounds120' ? 20 : 7;
}

export function currentTarget() {
    const sh = game.shanghai;
    if (!sh) return null;
    return { label: 'Round ' + sh.round, value: sh.round, kind: 'number' };
}

export function describeHitButtons() {
    const sh = game.shanghai;
    if (!sh) return { single: 'Single', double: 'Double', triple: 'Triple', tripleEnabled: true };
    const n = sh.round;
    return {
        single: `Single (+${n})`,
        double: `Double (+${n * 2})`,
        triple: `Triple (+${n * 3})`,
        tripleEnabled: true
    };
}

export function pointsForHit(kind) {
    const sh = game.shanghai;
    if (!sh) return 0;
    const mult = kind === 'triple' ? 3 : kind === 'double' ? 2 : 1;
    return sh.round * mult;
}

// True when a turn's hits contain a single, a double and a triple —
// i.e. a Shanghai. hits = [{ kind, points }].
export function isShanghaiTurn(hits) {
    if (!hits || hits.length < 3) return false;
    const kinds = new Set(hits.map(h => h.kind));
    return kinds.has('single') && kinds.has('double') && kinds.has('triple');
}

// Commit the active player's turn. `hits` carries the per-dart kinds so
// the instant-win rule can be checked.
export function commitTurn(turnScore, hits) {
    const sh = game.shanghai;
    const player = game.players[game.currentPlayer];
    player.score += turnScore;
    player.history.push({ round: sh.round, scored: turnScore, shanghai: isShanghaiTurn(hits) });

    if (isShanghaiTurn(hits)) {
        showWinner(`${player.name} — SHANGHAI on ${sh.round}s!`, false, true);
        return { matchOver: true };
    }

    const isLastPlayer = game.currentPlayer === game.players.length - 1;
    game.currentPlayer = (game.currentPlayer + 1) % game.players.length;
    if (!isLastPlayer) return { matchOver: false };

    sh.round++;
    if (sh.round > totalRounds(sh.variant)) {
        return finishMatch();
    }
    return { matchOver: false };
}

function finishMatch() {
    const max = Math.max(...game.players.map(p => p.score));
    const winners = game.players.filter(p => p.score === max).map(p => p.name);
    showWinner(winners.join(' & '), false, true);
    return { matchOver: true };
}
