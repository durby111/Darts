/* ============================================
   Golf Mode

   Each "hole" = a number on the board (1 → totalHoles). Each
   player throws 3 darts at the hole's number; the result of each
   dart contributes strokes (lower-is-better) or stableford points
   (higher-is-better).

   Stroke play (standard golf scoring):
     triple = 1 stroke (eagle)
     double = 2 strokes (birdie)
     single = 3 strokes (par)
     miss   = 5 strokes (penalty)

   Stableford points:
     triple = 4 pts (eagle)
     double = 3 pts (birdie)
     single = 1 pt  (par)
     miss   = 0 pts

   Misses are implied — target_game.js fills the remaining dart slots
   with the miss penalty at END TURN, so a player who only registered
   one single takes 3 strokes for the hit + 2 misses × penalty.
   ============================================ */

import { game } from './state.js';
import { showWinner } from './ui.js';

const STROKE_PLAY = { single: 3, double: 2, triple: 1, miss: 5 };
const STABLEFORD = { single: 1, double: 3, triple: 4, miss: 0 };

export function initGolfState(variant) {
    return {
        variant: variant || '18hole',  // '9hole' | '18hole' | 'stableford'
        currentHole: 1
    };
}

function totalHoles(variant) {
    return variant === '9hole' ? 9 : 18;
}

function scoringTable() {
    const g = game.golf;
    if (!g || g.variant !== 'stableford') return STROKE_PLAY;
    return STABLEFORD;
}

export function currentTarget() {
    const g = game.golf;
    if (!g) return null;
    return { label: 'Hole', value: g.currentHole, kind: 'number' };
}

export function describeHitButtons() {
    const g = game.golf;
    const isStableford = g && g.variant === 'stableford';
    if (isStableford) {
        return {
            single: 'Single (+1pt)',
            double: 'Double (+3pt)',
            triple: 'Triple (+4pt)',
            tripleEnabled: true
        };
    }
    return {
        single: 'Single (3)',
        double: 'Double (2)',
        triple: 'Triple (1)',
        tripleEnabled: true
    };
}

// Strokes / points for a single dart of the given kind on the current
// hole. (Hole number is irrelevant in golf — each hit kind is worth a
// fixed amount.)
export function pointsForHit(kind) {
    return scoringTable()[kind] || 0;
}

// What an unhit dart slot is worth at END TURN (3 strokes per miss in
// stroke play, 0 in stableford).
export function missPenalty() {
    return scoringTable().miss;
}

// Stroke play is lower-is-better; stableford is higher-is-better. The
// winner search uses this to know which extreme to pick.
export function isLowerBetter() {
    const g = game.golf;
    return !(g && g.variant === 'stableford');
}

// score already includes implied misses (computed by target_game.js).
export function commitTurn(score) {
    const g = game.golf;
    const player = game.players[game.currentPlayer];
    player.score += score;
    player.history.push({ hole: g.currentHole, score });

    const isLastPlayer = game.currentPlayer === game.players.length - 1;
    game.currentPlayer = (game.currentPlayer + 1) % game.players.length;
    if (!isLastPlayer) return { matchOver: false };

    g.currentHole++;
    if (g.currentHole > totalHoles(g.variant)) {
        return finishMatch();
    }
    return { matchOver: false };
}

function finishMatch() {
    const scores = game.players.map(p => p.score);
    const target = isLowerBetter() ? Math.min(...scores) : Math.max(...scores);
    const winners = game.players.filter(p => p.score === target).map(p => p.name);
    showWinner(winners.join(' & '), false, true);
    return { matchOver: true };
}
