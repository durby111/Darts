/* ============================================
   Shared UI Helpers
   Modals, SVG marks, display helpers
   ============================================ */

import { game, canUndo, canRedo } from './state.js';

// --- SVG Mark Symbols ---
// Hand-drawn-feeling chalk marks built from clean bezier curves.
// The optional "#chalk" filter in index.html adds a subtle texture;
// the paths carry the shape and character, so marks stay crisp.

// Slash path — an asymmetric bottom-left to top-right stroke with a
// gentle curve so it reads as chalk, not as a straight line.
const SLASH_PATH = 'M 14 70 C 24 58, 32 44, 44 30 C 52 22, 60 14, 68 10';
// X strokes — mirrored diagonals with slight bow; drawn in the order
// a person would chalk them (down-right first, then up-right).
const X_PATH_A = 'M 14 12 C 24 22, 36 34, 44 42 C 52 50, 62 62, 70 70';
const X_PATH_B = 'M 70 12 C 60 22, 48 34, 40 42 C 32 50, 22 62, 14 70';
// Circle — drawn as a single closed path with uneven radii so it looks
// hand-drawn. End overlaps start slightly to suggest chalk weight.
const CIRCLE_PATH =
    'M 42 8 C 60 9, 73 22, 73 40 C 73 58, 59 72, 40 72 ' +
    'C 21 72, 8 58, 8 40 C 8 22, 22 8, 42 8 Z';

export function getMarkSymbol(marks, pendingMarks = 0, closedInOneTurn = true, isCompact = false, target = '', showBoobie = false, playerIndex = -1, marksBeforeClose = 0) {
    const totalMarks = marks + pendingMarks;
    const isPending = pendingMarks > 0;
    const color = isPending ? 'var(--color-pending)' : 'var(--color-primary)';
    const cssClass = isPending ? 'mark pending' : 'mark';
    const compactClass = isCompact ? (game.type === 'minnesota' ? ' minnesota' : ' spanish') : '';

    // Shared stroke attrs — round caps/joins give soft ends without noise.
    const stroke = `stroke="${color}" fill="none" stroke-linecap="round" stroke-linejoin="round"`;

    if (totalMarks === 0) {
        return `<span class="${cssClass}${compactClass}"></span>`;
    }

    if (totalMarks === 1) {
        return `<span class="${cssClass}${compactClass}">
            <svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
                <g filter="url(#chalk)">
                    <path d="${SLASH_PATH}" ${stroke} stroke-width="11" opacity="0.35"/>
                    <path d="${SLASH_PATH}" ${stroke} stroke-width="7"/>
                </g>
            </svg>
        </span>`;
    }

    if (totalMarks === 2) {
        return `<span class="${cssClass}${compactClass}">
            <svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
                <g filter="url(#chalk)">
                    <path d="${X_PATH_A}" ${stroke} stroke-width="11" opacity="0.35"/>
                    <path d="${X_PATH_B}" ${stroke} stroke-width="11" opacity="0.35"/>
                    <path d="${X_PATH_A}" ${stroke} stroke-width="7"/>
                    <path d="${X_PATH_B}" ${stroke} stroke-width="7"/>
                </g>
            </svg>
        </span>`;
    }

    // Closed (3+ marks). Three variants based on what was on the cell at the
    // START of the turn that closed it (marksBeforeClose):
    //   0 → closed in one turn → empty O, tappable to toggle a center dot
    //   1 → had a slash before → O with slash inside
    //   2 → had an X before    → O with X inside
    const circleLayer = `
        <path d="${CIRCLE_PATH}" ${stroke} stroke-width="11" opacity="0.3"/>
        <path d="${CIRCLE_PATH}" ${stroke} stroke-width="7"/>`;

    if (!closedInOneTurn && marksBeforeClose === 1) {
        // Inner slash drawn smaller so it sits cleanly inside the circle.
        return `<span class="${cssClass}${compactClass}">
            <svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
                <g filter="url(#chalk)">
                    ${circleLayer}
                    <g transform="translate(40 40) scale(0.55) translate(-40 -40)">
                        <path d="${SLASH_PATH}" ${stroke} stroke-width="11" opacity="0.35"/>
                        <path d="${SLASH_PATH}" ${stroke} stroke-width="9"/>
                    </g>
                </g>
            </svg>
        </span>`;
    }

    if (!closedInOneTurn && marksBeforeClose === 2) {
        return `<span class="${cssClass}${compactClass}">
            <svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
                <g filter="url(#chalk)">
                    ${circleLayer}
                    <g transform="translate(40 40) scale(0.55) translate(-40 -40)">
                        <path d="${X_PATH_A}" ${stroke} stroke-width="11" opacity="0.35"/>
                        <path d="${X_PATH_B}" ${stroke} stroke-width="11" opacity="0.35"/>
                        <path d="${X_PATH_A}" ${stroke} stroke-width="9"/>
                        <path d="${X_PATH_B}" ${stroke} stroke-width="9"/>
                    </g>
                </g>
            </svg>
        </span>`;
    }

    // Closed in one turn — empty O. Tap toggles a filled center dot (boobie).
    const dotClass = showBoobie ? ' show-dot' : '';
    return `<span class="${cssClass}${compactClass}${dotClass}" data-boobie="true" data-boobie-player="${playerIndex}" data-boobie-target="${target}">
        <svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
            <g filter="url(#chalk)">
                ${circleLayer}
                <circle class="boobie-dot" cx="40" cy="40" r="11" fill="${color}" opacity="0"/>
            </g>
        </svg>
    </span>`;
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
    if (!el) return;
    el.style.display = 'flex';
    // Brief input-guard: a tap that OPENS a modal can otherwise drive a
    // phantom click on a button inside the modal that happens to sit at the
    // same screen position as the opener (e.g. cricket "T" → keypad Cancel).
    // We block the modal's content for 300ms; the backdrop still catches
    // events so taps don't pass through to the screen below.
    const content = el.querySelector('.modal-content');
    if (content) {
        content.style.pointerEvents = 'none';
        setTimeout(() => { content.style.pointerEvents = ''; }, 300);
    }
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
