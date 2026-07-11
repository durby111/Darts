/* ============================================
   Hammer Cricket + Team Hammer

   Eight rounds: 20, 19, 18, Wild, 17, 16, 15, Wild.
   Wild targets are random 12–20 or Bull. Dart-position
   multipliers are ×1/×2/×3; final round uses ×1/×3/×5.
   Missing the target with all three darts drops the hammer:
   subtract triple the round target. Highest total wins.
   ============================================ */

import { game } from './state.js';
import { showWinner } from './ui.js';

const BASE_TARGETS = [20, 19, 18, null, 17, 16, 15, null];

function randomWildTarget() {
    const choices = [12, 13, 14, 15, 16, 17, 18, 19, 20, 'Bull'];
    return choices[Math.floor(Math.random() * choices.length)];
}

export function initHammerState() {
    return {
        round: 1,
        targets: BASE_TARGETS.map(target => target == null ? randomWildTarget() : target),
        tiebreaker: false,
        tiebreakerTarget: null
    };
}

export function currentTarget() {
    const hammer = game.hammer;
    if (!hammer) return null;
    const value = hammer.tiebreaker
        ? hammer.tiebreakerTarget
        : hammer.targets[hammer.round - 1];
    return {
        label: hammer.tiebreaker ? 'Tie Breaker' : `Round ${hammer.round} of 8`,
        value,
        kind: value === 'Bull' ? 'bull' : 'number'
    };
}

function faceValue() {
    const target = currentTarget();
    return target?.value === 'Bull' ? 25 : Number(target?.value || 0);
}

export function describeHitButtons() {
    const target = currentTarget();
    const value = faceValue();
    const isBull = target?.value === 'Bull';
    return {
        single: isBull ? 'Outer Bull' : `Single ${target?.value}`,
        double: isBull ? 'Inner Bull' : `Double ${target?.value}`,
        triple: isBull ? '—' : `Triple ${target?.value}`,
        tripleEnabled: !isBull,
        miss: 'Miss Dart',
        missEnabled: true,
        baseSingle: value
    };
}

export function pointsForHit(kind) {
    const value = faceValue();
    if (kind === 'triple') return value * 3;
    if (kind === 'double') return value * 2;
    if (kind === 'single') return value;
    return 0;
}

export function turnScore(hits) {
    const finalRound = game.hammer && (game.hammer.round === 8 || game.hammer.tiebreaker);
    const positionMultipliers = finalRound ? [1, 3, 5] : [1, 2, 3];
    return (hits || []).reduce((total, hit, index) =>
        total + (hit.kind === 'miss' ? 0 : hit.points * positionMultipliers[index]), 0);
}

function hitMarks(hits) {
    return (hits || []).reduce((marks, hit) => {
        if (hit.kind === 'triple') return marks + 3;
        if (hit.kind === 'double') return marks + 2;
        if (hit.kind === 'single') return marks + 1;
        return marks;
    }, 0);
}

function highestMprPlayers(players) {
    const mprs = players.map(player => player.throws
        ? player.totalMarks / player.throws
        : 0);
    const high = Math.max(...mprs);
    return players.filter((player, index) => mprs[index] === high);
}

function finishMatch(afterTiebreaker = false) {
    const high = Math.max(...game.players.map(player => player.score));
    let leaders = game.players.filter(player => player.score === high);

    if (leaders.length > 1 && !afterTiebreaker) {
        game.hammer.tiebreaker = true;
        game.hammer.tiebreakerTarget = randomWildTarget();
        return { matchOver: false };
    }
    if (leaders.length > 1 && afterTiebreaker) {
        leaders = highestMprPlayers(leaders);
    }

    showWinner(leaders.map(player => player.name).join(' & '), false, true);
    return { matchOver: true };
}

export function commitTurn(_displayTotal, hits) {
    const hammer = game.hammer;
    const player = game.players[game.currentPlayer];
    const scoringHits = (hits || []).filter(hit => hit.kind !== 'miss');
    const dropped = scoringHits.length === 0;
    const score = dropped ? -(faceValue() * 3) : turnScore(hits);

    player.score += score;
    player.throws++;
    player.totalMarks += hitMarks(hits);
    player.history.push({
        round: hammer.tiebreaker ? 'TB' : hammer.round,
        target: currentTarget()?.value,
        score,
        dropped,
        hits: (hits || []).map(hit => hit.kind)
    });

    const isLastPlayer = game.currentPlayer === game.players.length - 1;
    game.currentPlayer = (game.currentPlayer + 1) % game.players.length;
    if (!isLastPlayer) return { matchOver: false };

    if (hammer.tiebreaker) {
        return finishMatch(true);
    }
    if (hammer.round < 8) {
        hammer.round++;
        return { matchOver: false };
    }
    return finishMatch(false);
}
