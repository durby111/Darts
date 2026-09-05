/* ============================================
   Shared UI Helpers
   Modals, SVG marks, display helpers
   ============================================ */

import { game, canUndo, canRedo } from './state.js';
import { currentThrower } from './teams.js';

// --- SVG Mark Symbols ---
const MARKER_SLASH = {
    body: 'M 8 68 Q 25 43 41 26 Q 55 12 66 6 L 73 12 L 69 17 Q 52 30 43 42 Q 28 59 18 74 L 10 73 Z',
    streaks: 'M 13 68 Q 29 46 44 29 Q 58 16 67 12 M 23 61 Q 38 40 50 29 M 48 28 L 61 17',
    edge: 'M 18 71 Q 33 51 45 38 Q 61 21 69 16'
};
const MARKER_DOWN = {
    body: 'M 9 8 L 18 8 Q 35 27 48 40 Q 64 55 75 68 L 73 75 L 65 73 Q 50 56 37 44 Q 21 26 8 15 Z',
    streaks: 'M 14 12 Q 31 31 43 43 Q 62 60 70 71 M 18 20 Q 30 34 36 38 M 46 48 L 62 64',
    edge: 'M 11 17 Q 28 37 38 46 Q 53 60 64 72'
};
const MARKER_UP = {
    body: 'M 65 7 L 74 10 L 74 15 Q 58 30 44 46 Q 30 61 17 75 L 8 73 L 9 66 Q 25 51 37 37 Q 54 18 65 7 Z',
    streaks: 'M 13 69 Q 30 51 41 40 Q 58 20 69 12 M 26 57 Q 42 40 50 30 M 53 25 L 63 15',
    edge: 'M 18 72 Q 33 55 46 42 Q 63 23 72 16'
};
const MARKER_CIRCLE = {
    body: 'M 43 5 C 63 5 77 21 77 40 C 77 61 61 77 40 77 C 18 76 4 61 5 40 C 5 20 21 4 43 5 Z M 42 16 C 27 14 15 25 15 40 C 14 56 25 66 40 66 C 56 67 67 55 66 40 C 66 26 57 16 42 16 Z',
    streaks: 'M 39 10 C 19 9 9 25 10 42 C 9 60 23 71 39 72 C 57 73 72 60 72 42 C 73 24 60 10 45 10 M 18 23 C 13 31 13 45 17 52 M 48 69 C 59 67 69 56 69 46',
    edge: 'M 44 6 C 63 7 76 22 75 40 M 6 43 C 6 62 21 75 40 75',
    overlap: 'M 38 5 Q 48 4 54 8 L 50 18 Q 44 15 38 16 Z'
};

const MARKER_CLOSING_CIRCLE = {
    ...MARKER_CIRCLE,
    streaks: 'M 36 9 C 21 11 10 25 11 41 M 10 48 C 14 65 29 73 44 71 C 62 70 73 55 72 39 M 70 31 C 67 18 57 10 44 11 M 18 57 Q 24 65 34 67 M 74 39 Q 74 51 68 60'
};

const CLOSED_MARK_PLACEMENTS = [
    'translate(37 41) rotate(-7) scale(0.76 0.81) translate(-40 -40)',
    'translate(42 38) rotate(5) scale(0.8 0.73) translate(-40 -40)',
    'translate(39 43) rotate(-3) scale(0.74 0.79) translate(-40 -40)'
];

function markerInk(shape, inset = false) {
    return `<g class="marker-ink">
        <path d="${shape.body}" fill="currentColor" fill-rule="evenodd" stroke="currentColor" stroke-width="${inset ? 3 : 0}" stroke-linejoin="round" opacity="0.88"/>
        <path d="${shape.edge}" fill="none" stroke="#000" stroke-width="1.3" opacity="0.24"/>
        <path d="${shape.streaks}" fill="none" stroke="#fff" stroke-width="0.9" opacity="0.38" stroke-linecap="round"/>
        ${shape.overlap ? `<path d="${shape.overlap}" fill="#000" opacity="0.2"/>` : ''}
    </g>`;
}

function markerCross(inset = false) {
    return `${markerInk(MARKER_DOWN, inset)}${markerInk(MARKER_UP, inset)}
        <path d="M 39 34 L 47 42 L 40 50 L 32 42 Z" fill="#000" opacity="0.24"/>`;
}

export function getMarkSymbol(marks, pendingMarks = 0, closedInOneTurn = true, isCompact = false, target = '', showBoobie = false, playerIndex = -1, marksBeforeClose = 0) {
    const totalMarks = marks + pendingMarks;
    const isPending = pendingMarks > 0;
    const color = isPending ? 'var(--color-pending)' : 'var(--color-primary)';
    const cssClass = isPending ? 'mark pending' : 'mark';
    const compactClass = isCompact ? (game.type === 'minnesota' ? ' minnesota' : ' spanish') : '';

    if (totalMarks === 0) {
        return `<span class="${cssClass}${compactClass}"></span>`;
    }

    if (totalMarks === 1) {
        return `<span class="${cssClass}${compactClass}">
            <svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
                <g color="${color}" filter="url(#chalk)">
                    ${markerInk(MARKER_SLASH)}
                </g>
            </svg>
        </span>`;
    }

    if (totalMarks === 2) {
        return `<span class="${cssClass}${compactClass}">
            <svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
                <g color="${color}" filter="url(#chalk)">
                    ${markerCross()}
                </g>
            </svg>
        </span>`;
    }

    // Closed (3+ marks). Three variants based on what was on the cell at the
    // START of the turn that closed it (marksBeforeClose):
    //   0 → closed in one turn → empty O, tappable to toggle a center dot
    //   1 → had a slash before → O with slash inside
    //   2 → had an X before    → O with X inside
    const circleLayer = markerInk(MARKER_CIRCLE);
    const placementIndex = ((Number.parseInt(target, 10) || 0) + Math.max(0, playerIndex)) % CLOSED_MARK_PLACEMENTS.length;
    const closedPlacement = CLOSED_MARK_PLACEMENTS[placementIndex];

    if (!closedInOneTurn && marksBeforeClose === 1) {
        return `<span class="${cssClass}${compactClass}">
            <svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
                <g color="${color}" filter="url(#chalk)">
                    <g transform="${closedPlacement}">
                        ${markerInk(MARKER_SLASH, true)}
                    </g>
                    ${circleLayer}
                </g>
            </svg>
        </span>`;
    }

    if (!closedInOneTurn && marksBeforeClose === 2) {
        return `<span class="${cssClass}${compactClass}">
            <svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
                <g color="${color}" filter="url(#chalk)">
                    <g transform="translate(40 40) scale(0.88) translate(-40 -40)">
                        ${markerCross()}
                    </g>
                    <path d="M 11 55 Q 15 61 22 65 L 26 71 Q 15 68 9 59 Z M 62 14 Q 71 18 75 29 L 71 32 Q 68 22 60 19 Z" fill="currentColor" opacity="0.2"/>
                    ${markerInk(MARKER_CLOSING_CIRCLE)}
                    <path d="M 12 60 Q 16 64 22 66 M 66 19 Q 70 22 72 27" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" opacity="0.3"/>
                </g>
            </svg>
        </span>`;
    }

    // Closed in one turn — empty O. Tap toggles a filled center dot (boobie).
    const dotClass = showBoobie ? ' show-dot' : '';
    return `<span class="${cssClass}${compactClass}${dotClass}" data-boobie="true" data-boobie-player="${playerIndex}" data-boobie-target="${target}">
        <svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
            <g color="${color}" filter="url(#chalk)">
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

// Player names are free text AND arrive from the shared Firestore roster,
// which any signed-in client can write. Anything interpolated into innerHTML
// must go through this. Prefer textContent where the markup allows it.
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

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
        const scoreText = game.players
            .map((p, i) => `${escapeHtml(p.name)}: ${game.chicago.legWins[i]}`)
            .join(' - ');
        document.getElementById('winnerName').innerHTML =
            `${escapeHtml(name)}<br><span style="font-size:1.2rem;color:var(--color-primary);">Chicago Match Winner!</span>` +
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
        summaryHtml += `${escapeHtml(p.name)}: ${g121.legsWon[i]} leg${g121.legsWon[i] !== 1 ? 's' : ''}<br>`;
    });

    const checkouts = g121.legResults.filter(r => r.winner >= 0);
    if (checkouts.length > 0) {
        const highestCheckout = Math.max(...checkouts.map(r => r.checkout));
        summaryHtml += `Highest checkout: ${highestCheckout}`;
    }
    summaryHtml += `</span>`;

    document.getElementById('winnerName').innerHTML = `${escapeHtml(winner.name)}<br>${summaryHtml}`;
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

    updateThrowerLines();
}

function updateThrowerLines() {
    // Team mode renders a "Throwing: Name" / "Next: Name" sub-line under each
    // team name. Headers are reused across matches, so we also have to remove
    // the lines when team mode is off.
    const slots = [
        { headerId: 'homeHeader', lineId: 'homeThrower', teamIdx: 0 },
        { headerId: 'awayHeader', lineId: 'awayThrower', teamIdx: 1 }
    ];
    const on = game.teamMode && game.teams && game.teams.length === 2;
    slots.forEach(({ headerId, lineId, teamIdx }) => {
        const header = document.getElementById(headerId);
        if (!header) return;
        let line = document.getElementById(lineId);
        if (!on) {
            if (line) line.remove();
            return;
        }
        const thrower = currentThrower(teamIdx);
        if (!thrower) {
            if (line) line.remove();
            return;
        }
        if (!line) {
            line = document.createElement('div');
            line.id = lineId;
            line.className = 'thrower-name';
            const nameEl = header.querySelector('.player-name');
            if (nameEl && nameEl.nextSibling) {
                header.insertBefore(line, nameEl.nextSibling);
            } else {
                header.appendChild(line);
            }
        }
        const isActive = game.currentPlayer === teamIdx;
        line.textContent = (isActive ? 'Throwing: ' : 'Next: ') + thrower.name;
        line.classList.toggle('active', isActive);
    });
}

// --- Round Badge ---

export function updateRoundBadge() {
    const badge = document.getElementById('roundBadge');
    if (game.chicago) {
        badge.textContent = `L${game.chicago.currentLeg}`;
    } else if (game.game121) {
        const dartsLeft = game.game121.dartsPerLeg - game.game121.dartsThrown;
        badge.textContent = `L${game.game121.currentLeg} (${dartsLeft})`;
    } else if (game.countUp) {
        badge.textContent = Math.min(game.completedRounds + 1, game.countUp.totalRounds || 8);
    } else if (game.type === 'quickie') {
        badge.textContent = Math.min(game.completedRounds + 1, 10);
    } else if (game.hammer) {
        badge.textContent = game.hammer.tiebreaker ? 'TB' : game.hammer.round;
    } else if (game.sharkTank) {
        badge.textContent = game.sharkTank.round;
    } else if (game.robinHood) {
        badge.textContent = game.robinHood.round;
    } else if (game.baseball) {
        badge.textContent = game.baseball.inExtras ? ('X' + (game.baseball.extraInning + 1)) : game.baseball.inning;
    } else if (game.golf) {
        badge.textContent = game.golf.currentHole;
    } else if (game.shanghai) {
        badge.textContent = game.shanghai.round;
    } else if (game.bermuda) {
        badge.textContent = game.bermuda.targetIndex + 1;
    } else {
        badge.textContent = game.completedRounds + 1;
    }
}
