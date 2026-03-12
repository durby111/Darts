/* ============================================
   121 Game Mode
   Double-out within allotted darts per leg
   ============================================ */

import { game } from './state.js';
import { show121MatchSummary, updateUndoRedoButtons } from './ui.js';

export function handle121LegEnd(won, checkoutScore = 0) {
    const g121 = game.game121;
    const playerIndex = game.currentPlayer;

    // Record leg result
    g121.legResults.push({
        winner: won ? playerIndex : -1,
        checkout: checkoutScore,
        startingScore: g121.startingScore,
        dartsUsed: g121.dartsThrown
    });

    if (won) {
        g121.legsWon[playerIndex]++;
        g121.startingScore += 5;
    } else {
        g121.startingScore = Math.max(121, g121.startingScore - 5);
    }

    // Check if match is over
    if (g121.currentLeg >= g121.totalLegs) {
        show121MatchSummary();
        return;
    }

    // Start next leg
    g121.currentLeg++;
    g121.dartsThrown = 0;

    game.players.forEach(p => {
        p.score = g121.startingScore;
        p.history = [];
    });

    // Show leg result indicator
    const indicator = document.getElementById('finishIndicator');
    if (won) {
        indicator.textContent = `LEG WON! Next: ${g121.startingScore}`;
        indicator.style.color = 'var(--color-pending)';
    } else {
        indicator.textContent = `Leg lost. Next: ${g121.startingScore}`;
        indicator.style.color = 'var(--color-undo)';
    }

    setTimeout(() => {
        game.currentInput = '';
        document.getElementById('inputDisplay').textContent = '0';
        game.completedRounds = 0;

        // Dispatch event so app.js can call updateDisplay
        document.dispatchEvent(new CustomEvent('game121LegReady'));
    }, 2000);
}
