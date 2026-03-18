/* ============================================
   Shared UI Helpers
   Modals, SVG marks, display helpers
   ============================================ */

import { game, canUndo, canRedo } from './state.js';

// --- SVG Mark Symbols ---

// SVG filter for chalk grain texture — shared across all marks
const CHALK_FILTER = `<defs><filter id="chalk" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" result="noise"/><feDisplacementMap in="SourceGraphic" in2="noise" scale="3" xChannelSelector="R" yChannelSelector="G"/></filter></defs>`;

export function getMarkSymbol(marks, pendingMarks = 0, closedInOneTurn = true, isCompact = false, target = '', showBoobie = false, playerIndex = -1) {
    const totalMarks = marks + pendingMarks;
    const isPending = pendingMarks > 0;
    const color = isPending ? 'var(--color-pending)' : 'var(--color-primary)';
    const cssClass = isPending ? 'mark pending' : 'mark';
    const compactClass = isCompact ? (game.type === 'minnesota' ? ' minnesota' : ' spanish') : '';
    const f = ' filter="url(#chalk)"';

    // Beds uses same slash/X/circle progression as standard targets
    if (target === 'Bed') {
        // Fall through to standard mark logic below
    }

    if (totalMarks === 0) {
        return `<span class="${cssClass}${compactClass}"></span>`;
    } else if (totalMarks === 1) {
        // Single slash — rough chalk with triple overlapping strokes
        return `<span class="${cssClass}${compactClass}">
            <svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
                ${CHALK_FILTER}
                <g${f}>
                    <path d="M14,74 C19,60 24,50 32,38 C38,30 46,21 54,14 C58,11 61,8 64,6" stroke="${color}" stroke-width="10" fill="none" stroke-linecap="round" opacity="0.35"/>
                    <path d="M16,72 C21,57 27,46 35,34 C41,26 49,17 57,10 C60,8 63,6 66,5" stroke="${color}" stroke-width="9" fill="none" stroke-linecap="round" opacity="0.6"/>
                    <path d="M18,70 C23,55 30,43 38,32 C44,24 52,16 59,9" stroke="${color}" stroke-width="7" fill="none" stroke-linecap="round"/>
                </g>
            </svg>
        </span>`;
    } else if (totalMarks === 2) {
        // X — rough chalk with triple overlapping strokes per arm
        return `<span class="${cssClass}${compactClass}">
            <svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
                ${CHALK_FILTER}
                <g${f}>
                    <path d="M10,12 C20,18 30,30 40,42 C50,54 60,64 72,72" stroke="${color}" stroke-width="10" fill="none" stroke-linecap="round" opacity="0.3"/>
                    <path d="M12,10 C22,17 32,29 42,41 C52,53 62,63 70,70" stroke="${color}" stroke-width="9" fill="none" stroke-linecap="round" opacity="0.55"/>
                    <path d="M14,9 C24,16 34,28 44,40 C54,52 63,62 69,68" stroke="${color}" stroke-width="7" fill="none" stroke-linecap="round"/>
                    <path d="M70,12 C60,18 50,30 40,42 C30,54 20,64 8,72" stroke="${color}" stroke-width="10" fill="none" stroke-linecap="round" opacity="0.3"/>
                    <path d="M68,10 C58,17 48,29 38,41 C28,53 18,63 10,70" stroke="${color}" stroke-width="9" fill="none" stroke-linecap="round" opacity="0.55"/>
                    <path d="M66,9 C56,16 46,28 36,40 C26,52 17,62 11,68" stroke="${color}" stroke-width="7" fill="none" stroke-linecap="round"/>
                </g>
            </svg>
        </span>`;
    } else {
        // Closed — rough chalk circle with heavy strokes
        const circle1 = 'M40,5 C62,3 78,16 79,40 C80,64 64,79 40,78 C16,77 2,62 4,40 C6,16 18,7 40,5 Z';
        const circle2 = 'M40,8 C59,6 74,19 75,40 C76,61 62,75 40,74 C18,73 5,59 7,40 C9,19 21,10 40,8 Z';
        const circle3 = 'M40,11 C56,10 70,22 71,40 C72,58 59,71 40,70 C21,69 9,56 10,40 C11,22 24,13 40,11 Z';
        if (!closedInOneTurn && totalMarks >= 3) {
            // Circle with X inside
            return `<span class="${cssClass}${compactClass}">
                <svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
                    ${CHALK_FILTER}
                    <g${f}>
                        <path d="${circle1}" stroke="${color}" stroke-width="7" fill="none" opacity="0.3"/>
                        <path d="${circle2}" stroke="${color}" stroke-width="6" fill="none" opacity="0.55"/>
                        <path d="${circle3}" stroke="${color}" stroke-width="5" fill="none"/>
                        <path d="M24,24 C30,30 35,36 40,42 C45,48 50,54 58,60" stroke="${color}" stroke-width="7" fill="none" stroke-linecap="round" opacity="0.35"/>
                        <path d="M26,22 C32,29 37,35 42,41 C47,47 52,53 57,58" stroke="${color}" stroke-width="6" fill="none" stroke-linecap="round"/>
                        <path d="M58,24 C52,30 47,36 42,42 C37,48 32,54 24,60" stroke="${color}" stroke-width="7" fill="none" stroke-linecap="round" opacity="0.35"/>
                        <path d="M56,22 C50,29 45,35 40,41 C35,47 30,53 26,58" stroke="${color}" stroke-width="6" fill="none" stroke-linecap="round"/>
                    </g>
                </svg>
            </span>`;
        } else {
            // Just circle — closed in one turn (tappable for boobie dot)
            const dotClass = showBoobie ? ' show-dot' : '';
            return `<span class="${cssClass}${compactClass}${dotClass}" data-boobie="true" data-boobie-player="${playerIndex}" data-boobie-target="${target}">
                <svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
                    ${CHALK_FILTER}
                    <g${f}>
                        <path d="${circle1}" stroke="${color}" stroke-width="7" fill="none" opacity="0.3"/>
                        <path d="${circle2}" stroke="${color}" stroke-width="6" fill="none" opacity="0.55"/>
                        <path d="${circle3}" stroke="${color}" stroke-width="5" fill="none"/>
                        <circle class="boobie-dot" cx="40" cy="40" r="6" fill="${color}" opacity="0"/>
                        <circle class="boobie-ring" cx="40" cy="40" r="11" stroke="${color}" stroke-width="2.5" fill="none" opacity="0"/>
                    </g>
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
