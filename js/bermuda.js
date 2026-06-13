/* ============================================
   Bermuda Triangle Mode

   Players hit the current target with 3 darts. Points scored that
   turn = sum of face values × multiplier (single/double/triple), then
   added to player total. Variant rules govern targets and halving.

   Variants:
   - 'classic':  12, 13, 14, 15, Double, 16, 17, 18, Triple, 19, 20,
                 25 (bull), Bullseye. Score halves if all 3 darts miss
                 on the Double/Triple/25/Bullseye stages.
   - 'simple':   12-20 only, no halving.
   - 'halveit':  Same target list as classic, halving on a miss at
                 EVERY target.
   ============================================ */

import { game } from './state.js';
import { showWinner } from './ui.js';

const CLASSIC_TARGETS = [
    { value: 12, label: '12', kind: 'number' },
    { value: 13, label: '13', kind: 'number' },
    { value: 14, label: '14', kind: 'number' },
    { value: 15, label: '15', kind: 'number' },
    { value: 'D', label: 'Doubles', kind: 'ring', halves: true },
    { value: 16, label: '16', kind: 'number' },
    { value: 17, label: '17', kind: 'number' },
    { value: 18, label: '18', kind: 'number' },
    { value: 'T', label: 'Triples', kind: 'ring', halves: true },
    { value: 19, label: '19', kind: 'number' },
    { value: 20, label: '20', kind: 'number' },
    { value: 25, label: '25 (Outer Bull)', kind: 'bull', halves: true },
    { value: 'BULL', label: 'Bullseye (50)', kind: 'bull', halves: true }
];

const SIMPLE_TARGETS = [12, 13, 14, 15, 16, 17, 18, 19, 20]
    .map(n => ({ value: n, label: String(n), kind: 'number' }));

function targetsFor(variant) {
    if (variant === 'simple') return SIMPLE_TARGETS;
    return CLASSIC_TARGETS;
}

export function initBermudaState(variant) {
    return {
        variant: variant || 'classic',
        targetIndex: 0,
        turnScore: 0
    };
}

export function currentTarget() {
    const bm = game.bermuda;
    if (!bm) return null;
    const targets = targetsFor(bm.variant);
    return targets[bm.targetIndex];
}

export function describeHitButtons() {
    const bm = game.bermuda;
    if (!bm) return { single: 'Single', double: 'Double', triple: 'Triple', tripleEnabled: true };
    const t = currentTarget();
    if (!t) return { single: 'Single', double: 'Double', triple: 'Triple', tripleEnabled: true };

    if (t.kind === 'ring') {
        // For Doubles/Triples stages, every dart in the ring counts at face value.
        if (t.value === 'D') return { single: 'Any Double (+2×N)', double: '—', triple: '—', tripleEnabled: false, doubleEnabled: false };
        if (t.value === 'T') return { single: 'Any Triple (+3×N)', double: '—', triple: '—', tripleEnabled: false, doubleEnabled: false };
    }
    if (t.kind === 'bull') {
        if (t.value === 25) return { single: 'Outer (+25)', double: 'Inner (+50)', triple: '—', tripleEnabled: false };
        if (t.value === 'BULL') return { single: 'Inner Bull (+50)', double: '—', triple: '—', tripleEnabled: false, doubleEnabled: false };
    }
    return { single: 'Single (+N)', double: 'Double (+2N)', triple: 'Triple (+3N)', tripleEnabled: true };
}

// Compute points for a single dart hit kind ('single'|'double'|'triple') at
// the current target.
export function pointsForHit(kind) {
    const t = currentTarget();
    if (!t) return 0;
    if (t.kind === 'number') {
        if (kind === 'single') return t.value;
        if (kind === 'double') return t.value * 2;
        if (kind === 'triple') return t.value * 3;
    }
    if (t.kind === 'ring') {
        // For ring stages we can't know which specific number was hit; use a
        // sensible default (face value 20 for a hit on Doubles/Triples), which
        // is the highest-scoring hit. Honest manual scoring isn't possible
        // without per-dart number entry, so we expose the highest-value hit
        // and trust players to be honest. If you want more granularity later,
        // we can add a number sub-keypad.
        const mult = t.value === 'D' ? 2 : 3;
        return mult * 20;
    }
    if (t.kind === 'bull') {
        if (t.value === 25) return kind === 'double' ? 50 : 25;
        if (t.value === 'BULL') return 50;
    }
    return 0;
}

// Commit the accumulated turn score for the active player and advance.
export function commitTurn(turnScore, anyHit) {
    const bm = game.bermuda;
    const player = game.players[game.currentPlayer];
    const t = currentTarget();
    const halves = bm.variant === 'halveit' || (bm.variant === 'classic' && t && t.halves);

    if (turnScore === 0 && halves && anyHit === false) {
        player.score = Math.floor(player.score / 2);
        player.history.push({ target: t ? t.label : '?', scored: 0, halved: true });
    } else {
        player.score += turnScore;
        player.history.push({ target: t ? t.label : '?', scored: turnScore, halved: false });
    }

    const isLastPlayer = game.currentPlayer === game.players.length - 1;
    game.currentPlayer = (game.currentPlayer + 1) % game.players.length;

    if (!isLastPlayer) return { matchOver: false };

    // Advance to next target after all players have thrown.
    const targets = targetsFor(bm.variant);
    bm.targetIndex++;
    if (bm.targetIndex >= targets.length) {
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
