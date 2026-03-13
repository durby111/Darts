/* ============================================
   Shared UI Helpers
   Modals, SVG marks, display helpers
   ============================================ */

import { game, canUndo, canRedo } from './state.js';

// --- SVG Mark Symbols ---

export function getMarkSymbol(marks, pendingMarks = 0, closedInOneTurn = true, isCompact = false, target = '') {
    const totalMarks = marks + pendingMarks;
    const isPending = pendingMarks > 0;
    const color = isPending ? 'var(--color-pending)' : 'var(--color-primary)';
    const cssClass = isPending ? 'mark pending' : 'mark';
    const compactClass = isCompact ? (game.type === 'minnesota' ? ' minnesota' : ' spanish') : '';

    // Beds uses same slash/X/circle progression as standard targets
    if (target === 'Bed') {
        // Fall through to standard mark logic below
    }

    if (totalMarks === 0) {
        return `<span class="${cssClass}${compactClass}"></span>`;
    } else if (totalMarks === 1) {
        // Single slash — hand-drawn curved stroke
        return `<span class="${cssClass}${compactClass}">
            <svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">
                <path d="M14,50 C18,38 24,26 30,20 C36,14 42,11 46,9" stroke="${color}" stroke-width="7" fill="none" stroke-linecap="round"/>
            </svg>
        </span>`;
    } else if (totalMarks === 2) {
        // X — two hand-drawn curved strokes
        return `<span class="${cssClass}${compactClass}">
            <svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">
                <path d="M11,11 C18,17 24,25 30,31 C36,37 43,44 49,49" stroke="${color}" stroke-width="7" fill="none" stroke-linecap="round"/>
                <path d="M49,11 C43,17 36,25 30,31 C24,37 18,44 11,49" stroke="${color}" stroke-width="7" fill="none" stroke-linecap="round"/>
            </svg>
        </span>`;
    } else {
        // Closed — hand-drawn circle (with or without X inside)
        const circlePath = 'M30,7 C46,7 54,17 53,30 C52,43 44,53 30,53 C16,53 7,43 8,30 C9,17 16,7 30,7 Z';
        if (!closedInOneTurn && totalMarks >= 3) {
            // Circle with X inside
            return `<span class="${cssClass}${compactClass}">
                <svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">
                    <path d="${circlePath}" stroke="${color}" stroke-width="5" fill="none"/>
                    <path d="M19,19 C24,24 28,29 31,32 C34,35 38,40 41,42" stroke="${color}" stroke-width="5" fill="none" stroke-linecap="round"/>
                    <path d="M41,19 C36,24 32,29 29,32 C26,35 22,40 19,42" stroke="${color}" stroke-width="5" fill="none" stroke-linecap="round"/>
                </svg>
            </span>`;
        } else {
            // Just circle — closed in one turn
            return `<span class="${cssClass}${compactClass}">
                <svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">
                    <path d="${circlePath}" stroke="${color}" stroke-width="5" fill="none"/>
                </svg>
            </span>`;
        }
    }
}

// --- Undo/Redo Button State ---

export function updateUndoRedoButtons() {
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');
    const undoBtnX01 = document.getElementById('undoBtnX01');
    const redoBtnX01 = document.getElementById('redoBtnX01');

    const hasUndo = canUndo();
    const hasRedo = canRedo();

    if (undoBtn) undoBtn.disabled = !hasUndo;
    if (redoBtn) {
        redoBtn.disabled = !hasRedo;
        redoBtn.style.display = hasRedo ? 'inline-block' : 'none';
    }
    // X01 undo button doubles as Back (clear input), so never fully disable
    if (undoBtnX01) undoBtnX01.disabled = false;
    if (redoBtnX01) {
        redoBtnX01.disabled = !hasRedo;
        redoBtnX01.style.display = hasRedo ? 'inline-flex' : 'none';
    }
}

// --- Modals ---

export function showModal(modalId) {
    document.getElementById(modalId).style.display = 'flex';
}

export function hideModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

export function showWinner(name, isBlakeout = false, isChicagoMatchWin = false) {
    // For Chicago leg wins (not match wins), delegate to chicago module
    if (game.chicago && !isChicagoMatchWin) {
        // This will be handled by chicago.js via the app dispatcher
        const event = new CustomEvent('chicagoLegWin', {
            detail: { winnerIndex: game.players.findIndex(p => p.name === name) }
        });
        document.dispatchEvent(event);
        return;
    }

    document.getElementById('winnerName').textContent = name;
    const blakeoutMsg = document.getElementById('blakeoutMessage');
    blakeoutMsg.style.display = isBlakeout ? 'block' : 'none';

    if (isChicagoMatchWin && game.chicago) {
        const scoreText = game.players.map((p, i) => `${p.name}: ${game.chicago.legWins[i]}`).join(' - ');
        document.getElementById('winnerName').innerHTML =
            `${name}<br><span style="font-size:1.2rem;color:var(--color-primary);">Chicago Match Winner!</span>` +
            `<br><span style="font-size:1rem;color:var(--color-text-muted);">${scoreText}</span>`;
    }

    showModal('winnerModal');
}

export function show121MatchSummary() {
    const g121 = game.game121;
    let maxWins = 0;
    let winnerIndex = 0;
    g121.legsWon.forEach((wins, i) => {
        if (wins > maxWins) {
            maxWins = wins;
            winnerIndex = i;
        }
    });

    const winner = game.players[winnerIndex];
    let summaryHtml = `<span style="font-size:1.2rem;color:var(--color-primary);">121 Game Complete!</span><br>`;
    summaryHtml += `<span style="font-size:1rem;color:var(--color-text-muted);">`;
    game.players.forEach((p, i) => {
        summaryHtml += `${p.name}: ${g121.legsWon[i]} leg${g121.legsWon[i] !== 1 ? 's' : ''}<br>`;
    });

    const checkouts = g121.legResults.filter(r => r.winner >= 0);
    if (checkouts.length > 0) {
        const highestCheckout = Math.max(...checkouts.map(r => r.checkout));
        summaryHtml += `Highest checkout: ${highestCheckout}`;
    }
    summaryHtml += `</span>`;

    document.getElementById('winnerName').innerHTML = `${winner.name}<br>${summaryHtml}`;
    document.getElementById('blakeoutMessage').style.display = 'none';
    showModal('winnerModal');
}

// --- Player Headers ---

export function updatePlayerHeaders() {
    const numPlayers = game.players.length;
    const scoreHeader = document.getElementById('scoreHeader');

    // Set header layout class
    scoreHeader.className = numPlayers === 4 ? 'score-header four-player' :
                            numPlayers === 3 ? 'score-header three-player' :
                            numPlayers === 2 ? 'score-header two-player' : 'score-header one-player';

    // Show/hide player headers based on count
    document.getElementById('awayHeader').style.display = numPlayers >= 2 ? '' : 'none';
    document.getElementById('player3Header').style.display = numPlayers >= 3 ? '' : 'none';
    document.getElementById('player4Header').style.display = numPlayers >= 4 ? '' : 'none';

    // Update names
    document.getElementById('homeName').textContent = game.players[0].name;
    if (numPlayers >= 2) document.getElementById('awayName').textContent = game.players[1].name;
    if (numPlayers >= 3) document.getElementById('player3Name').textContent = game.players[2].name;
    if (numPlayers >= 4) document.getElementById('player4Name').textContent = game.players[3].name;

    // Active/inactive states
    document.getElementById('homeHeader').className = 'player-header home ' +
        (game.currentPlayer === 0 ? 'active' : 'inactive');

    if (numPlayers >= 2) {
        document.getElementById('awayHeader').className = 'player-header away ' +
            (game.currentPlayer === 1 ? 'active' : 'inactive');
    }

    if (numPlayers >= 3) {
        document.getElementById('player3Header').className = 'player-header player3 ' +
            (game.currentPlayer === 2 ? 'active' : 'inactive');
    }
    if (numPlayers >= 4) {
        document.getElementById('player4Header').className = 'player-header player4 ' +
            (game.currentPlayer === 3 ? 'active' : 'inactive');
    }
}

// --- Round Badge ---

export function updateRoundBadge() {
    const badge = document.getElementById('roundBadge');
    if (game.chicago) {
        badge.textContent = `L${game.chicago.currentLeg}`;
    } else if (game.game121) {
        const dartsLeft = game.game121.dartsPerLeg - game.game121.dartsThrown;
        badge.textContent = `L${game.game121.currentLeg} (${dartsLeft})`;
    } else {
        badge.textContent = game.completedRounds + 1;
    }
}
