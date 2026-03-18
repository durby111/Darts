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
        // Single slash — chalk-drawn with double stroke for texture
        return `<span class="${cssClass}${compactClass}">
            <svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
                <path d="M16,72 C22,56 28,44 38,32 C44,25 52,17 60,10" stroke="${color}" stroke-width="8" fill="none" stroke-linecap="round" opacity="0.5"/>
                <path d="M18,70 C24,53 31,40 40,30 C47,22 55,15 62,8" stroke="${color}" stroke-width="7" fill="none" stroke-linecap="round"/>
            </svg>
        </span>`;
    } else if (totalMarks === 2) {
        // X — chalk-drawn with double strokes for gritty texture
        return `<span class="${cssClass}${compactClass}">
            <svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
                <path d="M13,14 C24,22 34,35 43,46 C52,56 61,64 69,70" stroke="${color}" stroke-width="8" fill="none" stroke-linecap="round" opacity="0.5"/>
                <path d="M15,12 C25,20 35,33 44,44 C53,54 62,63 68,68" stroke="${color}" stroke-width="7" fill="none" stroke-linecap="round"/>
                <path d="M67,14 C58,22 48,35 38,46 C28,56 19,64 11,70" stroke="${color}" stroke-width="8" fill="none" stroke-linecap="round" opacity="0.5"/>
                <path d="M69,12 C59,21 49,33 39,44 C29,54 19,63 13,68" stroke="${color}" stroke-width="7" fill="none" stroke-linecap="round"/>
            </svg>
        </span>`;
    } else {
        // Closed — chalk-drawn circle with rough double-stroke
        const circle1 = 'M40,7 C60,5 74,18 75,40 C76,62 62,76 40,75 C18,74 4,60 6,40 C8,18 20,9 40,7 Z';
        const circle2 = 'M40,9 C58,8 72,21 73,40 C74,59 60,73 40,73 C20,73 7,59 8,40 C9,21 22,10 40,9 Z';
        if (!closedInOneTurn && totalMarks >= 3) {
            // Circle with X inside
            return `<span class="${cssClass}${compactClass}">
                <svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
                    <path d="${circle1}" stroke="${color}" stroke-width="6" fill="none" opacity="0.45"/>
                    <path d="${circle2}" stroke="${color}" stroke-width="5" fill="none"/>
                    <path d="M26,26 C32,33 37,39 42,44 C47,49 52,55 56,58" stroke="${color}" stroke-width="6" fill="none" stroke-linecap="round" opacity="0.5"/>
                    <path d="M27,24 C33,31 38,38 43,43 C48,48 53,54 57,57" stroke="${color}" stroke-width="5" fill="none" stroke-linecap="round"/>
                    <path d="M56,26 C50,33 45,39 40,44 C35,49 30,55 26,58" stroke="${color}" stroke-width="6" fill="none" stroke-linecap="round" opacity="0.5"/>
                    <path d="M57,24 C51,31 46,38 41,43 C36,48 31,54 27,57" stroke="${color}" stroke-width="5" fill="none" stroke-linecap="round"/>
                </svg>
            </span>`;
        } else {
            // Just circle — closed in one turn (tappable for boobie dot)
            return `<span class="${cssClass}${compactClass}" data-boobie="true" onclick="this.classList.toggle('show-dot')">
                <svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
                    <path d="${circle1}" stroke="${color}" stroke-width="6" fill="none" opacity="0.45"/>
                    <path d="${circle2}" stroke="${color}" stroke-width="5" fill="none"/>
                    <circle class="boobie-dot" cx="40" cy="40" r="5" fill="${color}" opacity="0"/>
                    <circle class="boobie-ring" cx="40" cy="40" r="9" stroke="${color}" stroke-width="2" fill="none" opacity="0"/>
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
