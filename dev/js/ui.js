/* ============================================
   Shared UI Helpers
   Modals, SVG marks, display helpers
   ============================================ */

import { game, canUndo, canRedo } from './state.js';

// --- SVG Mark Symbols ---
// Chalk filter is defined once in index.html as a global <svg> with id="chalk"

export function getMarkSymbol(marks, pendingMarks = 0, closedInOneTurn = true, isCompact = false, target = '', showBoobie = false, playerIndex = -1) {
    const totalMarks = marks + pendingMarks;
    const isPending = pendingMarks > 0;
    const color = isPending ? 'var(--color-pending)' : 'var(--color-primary)';
    const cssClass = isPending ? 'mark pending' : 'mark';
    const compactClass = isCompact ? (game.type === 'minnesota' ? ' minnesota' : ' spanish') : '';

    if (totalMarks === 0) {
        return `<span class="${cssClass}${compactClass}"></span>`;
    } else if (totalMarks === 1) {
        // Single slash — heavy chalk stroke with rough edges
        return `<span class="${cssClass}${compactClass}">
            <svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
                <g filter="url(#chalk)">
                    <path d="M12,76 C16,65 20,56 26,46 C32,36 40,26 48,18 C54,12 60,7 66,3" stroke="${color}" stroke-width="13" fill="none" stroke-linecap="round" opacity="0.3"/>
                    <path d="M14,74 C18,62 23,52 29,42 C35,32 42,23 50,16 C55,11 61,7 67,4" stroke="${color}" stroke-width="11" fill="none" stroke-linecap="round" opacity="0.5"/>
                    <path d="M16,72 C20,60 25,50 31,40 C37,30 44,22 52,14 C57,10 62,6 68,3" stroke="${color}" stroke-width="9" fill="none" stroke-linecap="round"/>
                </g>
            </svg>
        </span>`;
    } else if (totalMarks === 2) {
        // X — heavy chalk crossed strokes
        return `<span class="${cssClass}${compactClass}">
            <svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
                <g filter="url(#chalk)">
                    <path d="M8,10 C16,16 24,26 34,38 C44,50 54,60 68,72" stroke="${color}" stroke-width="13" fill="none" stroke-linecap="round" opacity="0.3"/>
                    <path d="M10,8 C18,15 26,25 36,37 C46,49 56,60 70,71" stroke="${color}" stroke-width="11" fill="none" stroke-linecap="round" opacity="0.5"/>
                    <path d="M12,7 C20,14 28,24 38,36 C48,48 58,59 71,69" stroke="${color}" stroke-width="9" fill="none" stroke-linecap="round"/>
                    <path d="M72,10 C64,16 56,26 46,38 C36,50 26,60 12,72" stroke="${color}" stroke-width="13" fill="none" stroke-linecap="round" opacity="0.3"/>
                    <path d="M70,8 C62,15 54,25 44,37 C34,49 24,60 10,71" stroke="${color}" stroke-width="11" fill="none" stroke-linecap="round" opacity="0.5"/>
                    <path d="M69,7 C61,14 53,24 43,36 C33,48 23,59 9,69" stroke="${color}" stroke-width="9" fill="none" stroke-linecap="round"/>
                </g>
            </svg>
        </span>`;
    } else {
        // Closed — heavy chalk circle
        const c1 = 'M40,3 C64,1 79,15 80,40 C81,66 65,80 40,79 C15,78 1,64 3,40 C5,15 17,5 40,3 Z';
        const c2 = 'M40,7 C60,5 75,18 76,40 C77,62 63,76 40,75 C17,74 4,60 6,40 C8,18 20,9 40,7 Z';
        const c3 = 'M40,11 C57,10 71,21 72,40 C73,59 60,72 40,71 C20,70 8,57 9,40 C10,21 23,12 40,11 Z';
        if (!closedInOneTurn && totalMarks >= 3) {
            // Circle with X inside
            return `<span class="${cssClass}${compactClass}">
                <svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
                    <g filter="url(#chalk)">
                        <path d="${c1}" stroke="${color}" stroke-width="8" fill="none" opacity="0.25"/>
                        <path d="${c2}" stroke="${color}" stroke-width="7" fill="none" opacity="0.5"/>
                        <path d="${c3}" stroke="${color}" stroke-width="5.5" fill="none"/>
                        <path d="M22,22 C28,28 34,34 40,40 C46,46 52,52 60,60" stroke="${color}" stroke-width="8" fill="none" stroke-linecap="round" opacity="0.3"/>
                        <path d="M24,20 C30,27 36,33 42,40 C48,46 54,53 58,58" stroke="${color}" stroke-width="7" fill="none" stroke-linecap="round"/>
                        <path d="M60,22 C54,28 48,34 42,40 C36,46 30,52 22,60" stroke="${color}" stroke-width="8" fill="none" stroke-linecap="round" opacity="0.3"/>
                        <path d="M58,20 C52,27 46,33 40,40 C34,46 28,53 24,58" stroke="${color}" stroke-width="7" fill="none" stroke-linecap="round"/>
                    </g>
                </svg>
            </span>`;
        } else {
            // Just circle — closed in one turn (tappable for boobie dot)
            const dotClass = showBoobie ? ' show-dot' : '';
            return `<span class="${cssClass}${compactClass}${dotClass}" data-boobie="true" data-boobie-player="${playerIndex}" data-boobie-target="${target}">
                <svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
                    <g filter="url(#chalk)">
                        <path d="${c1}" stroke="${color}" stroke-width="8" fill="none" opacity="0.25"/>
                        <path d="${c2}" stroke="${color}" stroke-width="7" fill="none" opacity="0.5"/>
                        <path d="${c3}" stroke="${color}" stroke-width="5.5" fill="none"/>
                    </g>
                    <circle class="boobie-dot" cx="40" cy="40" r="7" fill="${color}" opacity="0"/>
                    <circle class="boobie-ring" cx="40" cy="40" r="12" stroke="${color}" stroke-width="2.5" fill="none" opacity="0"/>
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
    const el = document.getElementById(modalId);
    if (el) el.style.display = 'flex';
}

export function hideModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.style.display = 'none';
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

    // Set header layout class (include game type for Minnesota auto-sizing)
    let headerClass = numPlayers === 4 ? 'score-header four-player' :
                      numPlayers === 3 ? 'score-header three-player' :
                      numPlayers === 2 ? 'score-header two-player' : 'score-header one-player';
    if (game.type === 'minnesota') headerClass += ' minnesota';
    scoreHeader.className = headerClass;

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
