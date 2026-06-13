/* ============================================
   Baseball Mode

   Standard darts baseball:
   - 9 innings; inning N targets the number N
   - Each player throws 3 darts per inning
   - Single = 1 run, Double = 2 runs, Triple = 3 runs
   - Most runs after 9 innings wins

   Variants supported via game.baseball.variant:
   - 'standard': as above
   - 'extras':   ties trigger extra innings at 15+, rotating, until decided
   - 'stretch':  inning 7 targets the bullseye instead of 7
                 outer bull = +1, inner bull (50) = +2; triple disabled
   ============================================ */

import { game } from './state.js';
import { showWinner } from './ui.js';

const TOTAL_INNINGS = 9;

export function initBaseballState(variant) {
    return {
        variant: variant || 'standard',
        inning: 1,
        inExtras: false,
        extraInning: 0,
        turnHits: 0
    };
}

export function currentTarget() {
    const bb = game.baseball;
    if (!bb) return null;
    if (bb.inExtras) {
        // Extra innings cycle through 15, 16, 17, 18, 19, 20, 25 ...
        const extras = [15, 16, 17, 18, 19, 20, 25];
        return { label: 'Extra ' + (bb.extraInning + 1), value: extras[bb.extraInning % extras.length] };
    }
    if (bb.variant === 'stretch' && bb.inning === 7) {
        return { label: 'Stretch (Bull)', value: 'Bull' };
    }
    return { label: 'Inning ' + bb.inning, value: bb.inning };
}

export function describeHitButtons() {
    const bb = game.baseball;
    if (!bb) return { single: 'Single (+1)', double: 'Double (+2)', triple: 'Triple (+3)', tripleEnabled: true };
    if (bb.variant === 'stretch' && bb.inning === 7 && !bb.inExtras) {
        return {
            single: 'Outer Bull (+1)',
            double: 'Inner Bull (+2)',
            triple: '—',
            tripleEnabled: false
        };
    }
    return { single: 'Single (+1)', double: 'Double (+2)', triple: 'Triple (+3)', tripleEnabled: true };
}

export function commitTurn(runs) {
    const bb = game.baseball;
    const player = game.players[game.currentPlayer];
    player.score += runs;
    player.history.push({
        inning: bb.inExtras ? ('X' + (bb.extraInning + 1)) : bb.inning,
        runs
    });
    bb.turnHits = 0;

    const isLastPlayer = game.currentPlayer === game.players.length - 1;
    game.currentPlayer = (game.currentPlayer + 1) % game.players.length;

    if (!isLastPlayer) return { matchOver: false };

    // End of inning — advance.
    if (bb.inExtras) {
        bb.extraInning++;
        if (isResolved()) return finishMatch();
        return { matchOver: false };
    }

    if (bb.inning < TOTAL_INNINGS) {
        bb.inning++;
        return { matchOver: false };
    }

    // Reached end of regulation.
    if (bb.variant === 'extras' && !isResolved()) {
        bb.inExtras = true;
        bb.extraInning = 0;
        return { matchOver: false };
    }

    return finishMatch();
}

function isResolved() {
    const scores = game.players.map(p => p.score);
    const max = Math.max(...scores);
    return scores.filter(s => s === max).length === 1;
}

function finishMatch() {
    const scores = game.players.map(p => p.score);
    const max = Math.max(...scores);
    const winners = game.players.filter(p => p.score === max).map(p => p.name);
    showWinner(winners.join(' & '), false, true);
    return { matchOver: true };
}
