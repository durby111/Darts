/* ============================================
   Cricket Module
   Standard Cricket, Spanish Cricket, Minnesota Cricket
   ============================================ */

import { game, saveGameState, undoWithCooldown } from './state.js';
import { getMarkSymbol, updateUndoRedoButtons, updatePlayerHeaders, updateRoundBadge, showWinner } from './ui.js';

// --- Internal Helpers ---

function calculatePendingScore() {
    const player = game.players[game.currentPlayer];
    let score = 0;

    // Snapshot original marks
    const originalMarks = {};
    game.cricketTargets.forEach(t => {
        originalMarks[t] = player.cricketData[t].marks;
    });

    for (const dart of game.pendingDarts) {
        const target = dart.target;
        const multiplier = dart.multiplier;
        const data = player.cricketData[target];
        const maxMarks = data.maxMarks;

        if (dart.specialScore !== undefined) {
            score += dart.specialScore;
            data.marks = Math.min(data.marks + 1, maxMarks);
            continue;
        }

        const marksBefore = data.marks;
        const newMarks = marksBefore + multiplier;
        data.marks = Math.min(newMarks, maxMarks);

        if (game.cricketPoints) {
            const excessBefore = Math.max(0, marksBefore - maxMarks);
            const excessAfter = Math.max(0, newMarks - maxMarks);
            const pointMarks = excessAfter - excessBefore;

            if (pointMarks > 0) {
                // Check if all opponents have closed this target
                const allOpponentsClosed = game.players.every((p, i) => {
                    if (i === game.currentPlayer) return true;
                    return p.cricketData[target].closed;
                });

                if (!allOpponentsClosed) {
                    const pointValue = target === 'Bull' ? 25 : parseInt(target);
                    score += pointMarks * pointValue;
                }
            }
        }
    }

    // Restore original marks
    game.cricketTargets.forEach(t => {
        player.cricketData[t].marks = originalMarks[t];
    });

    return score;
}

function updateCricketGrid() {
    const grid = document.getElementById('cricketGrid');
    const numPlayers = game.players.length;
    const isSpanish = game.type === 'spanish';
    const isMinnesota = game.type === 'minnesota';
    const isCompact = isSpanish || isMinnesota;
    const specialTargets = ['Triples', 'Doubles', 'Beds'];

    let html = '';

    game.cricketTargets.forEach((target, targetIndex) => {
        const isSpecial = specialTargets.includes(target);

        // Check if all players have closed this target
        const allClosed = game.players.every(p => p.cricketData[target].closed);

        // Build buttons
        let buttonsHtml = '';
        if (isSpecial) {
            const btnLabel = target === 'Triples' ? 'T' : target === 'Doubles' ? 'D' : 'Beds';
            buttonsHtml = `<button class="cricket-num-btn${allClosed ? ' dimmed' : ''}" data-target="${target}" data-multiplier="1">${btnLabel}</button>`;
        } else {
            const displayNum = target === 'Bull' ? 'B' : target;
            buttonsHtml = `<button class="cricket-dt-btn${allClosed ? ' dimmed' : ''}" data-target="${target}" data-multiplier="2">D</button>`;
            buttonsHtml += `<button class="cricket-num-btn${allClosed ? ' dimmed' : ''}" data-target="${target}" data-multiplier="1">${displayNum}</button>`;
            if (target !== 'Bull') {
                buttonsHtml += `<button class="cricket-dt-btn${allClosed ? ' dimmed' : ''}" data-target="${target}" data-multiplier="3">T</button>`;
            }
        }

        // Build player mark cells
        const playerCells = [];
        for (let i = 0; i < numPlayers; i++) {
            const p = game.players[i];
            const cricketData = p.cricketData[target];
            const marks = cricketData.marks;
            const closedInOneTurn = cricketData.closedInOneTurn;

            let cellHtml = getMarkSymbol(marks, 0, closedInOneTurn, isCompact, target);

            // Pending indicators for current player
            if (i === game.currentPlayer) {
                let pendingMarks = 0;
                for (const dart of game.pendingDarts) {
                    if (dart.target === target) {
                        pendingMarks += dart.specialScore !== undefined ? 1 : dart.multiplier;
                    }
                }
                if (pendingMarks > 0) {
                    cellHtml += `<span class="pending-indicator" style="color: green;">+${pendingMarks}</span>`;
                }
            } else {
                // Grey previous turn indicators
                if (p.lastTurnMarks && p.lastTurnMarks[target] !== undefined) {
                    if (targetIndex === 0 && p.lastTurnMarks['MISS'] !== undefined) {
                        cellHtml += `<span class="pending-indicator" style="color: grey;">MISS</span>`;
                    } else if (p.lastTurnMarks[target] > 0) {
                        cellHtml += `<span class="pending-indicator" style="color: grey;">+${p.lastTurnMarks[target]}</span>`;
                    }
                } else if (targetIndex === 0 && p.lastTurnMarks && p.lastTurnMarks['MISS'] !== undefined) {
                    cellHtml += `<span class="pending-indicator" style="color: grey;">MISS</span>`;
                }
            }

            playerCells.push(`<div class="cricket-cell">${cellHtml}</div>`);
        }

        // Layout class
        let rowClass = 'cricket-row';
        if (numPlayers === 2) rowClass += ' two-player';
        else if (numPlayers === 3) rowClass += ' three-player';
        else if (numPlayers === 4) rowClass += ' four-player';
        if (isSpanish) rowClass += ' spanish';
        if (isMinnesota) rowClass += ' minnesota';

        // Build row based on player count
        if (numPlayers === 1) {
            html += `<div class="${rowClass}">`;
            html += playerCells[0];
            html += `<div class="cricket-buttons">${buttonsHtml}</div>`;
            html += `<div class="cricket-cell"></div>`;
            html += `</div>`;
        } else if (numPlayers === 2) {
            html += `<div class="${rowClass}">`;
            html += playerCells[0];
            html += `<div class="cricket-buttons">${buttonsHtml}</div>`;
            html += playerCells[1];
            html += `</div>`;
        } else if (numPlayers === 3) {
            html += `<div class="${rowClass}">`;
            html += playerCells[0];
            html += `<div class="buttons-container"><div class="cricket-buttons">${buttonsHtml}</div></div>`;
            html += playerCells[1];
            html += playerCells[2];
            html += `</div>`;
        } else if (numPlayers === 4) {
            html += `<div class="${rowClass}">`;
            html += playerCells[0];
            html += playerCells[1];
            html += `<div class="buttons-container"><div class="cricket-buttons">${buttonsHtml}</div></div>`;
            html += playerCells[2];
            html += playerCells[3];
            html += `</div>`;
        }
    });

    grid.innerHTML = html;
}

function updateScoreDiffIndicator() {
    const player = game.players[game.currentPlayer];
    const pendingScore = calculatePendingScore();
    const currentScore = player.score + pendingScore;

    let maxOpponentScore = 0;
    game.players.forEach((p, i) => {
        if (i !== game.currentPlayer && p.score > maxOpponentScore) {
            maxOpponentScore = p.score;
        }
    });

    const diff = currentScore - maxOpponentScore;
    const indicator = document.getElementById('scoreDiffIndicator');
    if (!indicator) return;

    if (diff === 0) {
        indicator.textContent = '';
        return;
    }

    // Check if only Bull is open
    const openTargets = game.cricketTargets.filter(t => {
        return !game.players.every(p => p.cricketData[t].closed);
    });

    if (openTargets.length === 1 && openTargets[0] === 'Bull' && diff !== 0) {
        const bullsNeeded = Math.ceil(Math.abs(diff) / 25);
        if (diff < 0) {
            indicator.textContent = `${diff} (${bullsNeeded} bull${bullsNeeded !== 1 ? 's' : ''} needed to win)`;
            indicator.style.color = '#ff6666';
        } else {
            indicator.textContent = `+${diff}`;
            indicator.style.color = 'green';
        }
    } else if (diff > 0) {
        indicator.textContent = `+${diff}`;
        indicator.style.color = 'green';
    } else {
        indicator.textContent = `${diff}`;
        indicator.style.color = '#ff6666';
    }
}

function updatePending() {
    const pendingText = document.getElementById('pendingText');
    const enterBtn = document.getElementById('enterBtn');

    if (game.pendingDarts.length === 0) {
        if (pendingText) pendingText.textContent = '';
        if (enterBtn) enterBtn.disabled = true;
        if (game.cricketPoints) updateScoreDiffIndicator();
        return;
    }

    const parts = game.pendingDarts.map(dart => {
        if (dart.specialScore !== undefined) {
            return dart.target;
        }
        const prefix = dart.multiplier === 3 ? 'T' : dart.multiplier === 2 ? 'D' : '';
        const label = dart.target === 'Bull' ? 'B' : dart.target;
        return prefix + label;
    });

    if (pendingText) pendingText.textContent = parts.join(' \u2022 ');
    if (enterBtn) enterBtn.disabled = false;

    if (game.cricketPoints) updateScoreDiffIndicator();
}

// --- Exported Functions ---

export function updateCricketDisplay() {
    const pendingScore = calculatePendingScore();
    const numPlayers = game.players.length;

    // Score element IDs mapped by player index
    const scoreIds = ['homeScore', 'awayScore', 'player3Score', 'player4Score'];
    const mprIds = [['homeMPR', 'homeMPR2'], ['awayMPR', 'awayMPR2'], ['player3MPR', 'player3MPR2'], ['player4MPR', 'player4MPR2']];

    game.players.forEach((player, i) => {
        // Update score
        const scoreEl = document.getElementById(scoreIds[i]);
        if (scoreEl) {
            const displayScore = i === game.currentPlayer ? player.score + pendingScore : player.score;
            scoreEl.textContent = displayScore;
        }

        // Calculate and display MPR
        const mpr = player.throws > 0 ? (player.totalMarks / player.throws).toFixed(1) : '0.0';
        mprIds[i].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = mpr;
        });
    });

    updateCricketGrid();
    updatePending();
    updateRoundBadge();
    updatePlayerHeaders();
}

export function hitTarget(target, multiplier) {
    // Max 3 pending darts
    if (game.pendingDarts.length >= 3) return;

    const specialTargets = ['Triples', 'Doubles', 'Beds'];
    const isSpecial = specialTargets.includes(target);

    // Minnesota Beds rule
    if (target === 'Beds' && game.pendingDarts.length > 0 && game.pendingDarts.some(d => d.target !== 'Beds')) {
        return;
    }
    if (target !== 'Beds' && game.pendingDarts.length > 0 && game.pendingDarts.some(d => d.target === 'Beds')) {
        return;
    }

    // Save state before each dart for individual undo
    saveGameState();

    const player = game.players[game.currentPlayer];

    if (isSpecial) {
        const cricketData = player.cricketData[target];
        const maxMarks = cricketData.maxMarks;

        // Check if player already closed it AND opponents haven't all closed
        const playerClosed = cricketData.marks >= maxMarks;
        const allOpponentsClosed = game.players.every((p, i) => {
            if (i === game.currentPlayer) return true;
            return p.cricketData[target].closed;
        });

        if (playerClosed && !allOpponentsClosed) {
            // Dispatch custom event to show score keypad
            const event = new CustomEvent('showScoreKeypad', {
                detail: { target, multiplier }
            });
            document.dispatchEvent(event);
        } else {
            game.pendingDarts.push({ target, multiplier: 1 });
        }
    } else {
        game.pendingDarts.push({ target, multiplier });
    }

    updateCricketDisplay();
    updateUndoRedoButtons();
}

export function cricketConfirm() {
    if (game.pendingDarts.length === 0) return;

    const player = game.players[game.currentPlayer];
    const lastTurnMarks = {};
    let isBlakeout = false;

    // Process all pending darts
    for (const dart of game.pendingDarts) {
        const target = dart.target;
        const multiplier = dart.multiplier;
        const cricketData = player.cricketData[target];
        const maxMarks = cricketData.maxMarks;
        const marksBefore = cricketData.marks;

        if (dart.specialScore !== undefined) {
            // Special score from Minnesota keypad
            player.score += dart.specialScore;
            cricketData.marks = Math.min(cricketData.marks + 1, maxMarks);
        } else {
            const newMarks = marksBefore + multiplier;

            // Points for marks beyond maxMarks
            if (game.cricketPoints && newMarks > maxMarks) {
                const excessBefore = Math.max(0, marksBefore - maxMarks);
                const excessAfter = Math.max(0, newMarks - maxMarks);
                const pointMarks = excessAfter - excessBefore;

                if (pointMarks > 0) {
                    const allOpponentsClosed = game.players.every((p, i) => {
                        if (i === game.currentPlayer) return true;
                        return p.cricketData[target].closed;
                    });

                    if (!allOpponentsClosed) {
                        const pointValue = target === 'Bull' ? 25 : parseInt(target);
                        player.score += pointMarks * pointValue;
                    }
                }
            }

            cricketData.marks = Math.min(newMarks, maxMarks);
        }

        // Track closure
        if (cricketData.marks >= maxMarks && !cricketData.closed) {
            cricketData.closed = true;
            // Track closedInOneTurn: marks went from 0 to maxMarks in one turn
            if (marksBefore === 0 && cricketData.marks >= maxMarks) {
                cricketData.closedInOneTurn = true;
            } else {
                cricketData.closedInOneTurn = false;
            }
        }

        // Track marks for grey indicators
        if (!lastTurnMarks[target]) lastTurnMarks[target] = 0;
        lastTurnMarks[target] += dart.specialScore !== undefined ? 1 : multiplier;

        // Check for BlakeOut: last dart was double Bull
        if (dart === game.pendingDarts[game.pendingDarts.length - 1]) {
            if (target === 'Bull' && multiplier === 2) {
                isBlakeout = true;
            }
        }
    }

    // Update throws (1 per turn, not per dart) and total marks
    player.throws++;
    let turnMarks = 0;
    Object.values(lastTurnMarks).forEach(v => { turnMarks += v; });
    player.totalMarks += turnMarks;

    // Check win: all targets closed AND score >= all opponents' scores (if cricketPoints)
    const allTargetsClosed = game.cricketTargets.every(t => player.cricketData[t].closed);
    if (allTargetsClosed) {
        let hasWon = true;
        if (game.cricketPoints) {
            hasWon = game.players.every((p, i) => {
                if (i === game.currentPlayer) return true;
                return player.score >= p.score;
            });
        }
        if (hasWon) {
            player.lastTurnMarks = lastTurnMarks;
            updateCricketDisplay();
            showWinner(player.name, isBlakeout);
            return;
        }
    }

    // Save lastTurnMarks for the grey indicators
    player.lastTurnMarks = lastTurnMarks;

    // Move to next player
    const nextPlayer = (game.currentPlayer + 1) % game.players.length;

    // Clear next player's lastTurnMarks
    game.players[nextPlayer].lastTurnMarks = null;

    // Increment round when back to player 0
    if (nextPlayer === 0) {
        game.completedRounds++;
    }

    game.currentPlayer = nextPlayer;
    game.pendingDarts = [];

    saveGameState();
    updateCricketDisplay();
    updateUndoRedoButtons();
}

export function cricketMiss() {
    // 2-second cooldown on miss button
    const missBtn = document.getElementById('missBtn');
    if (missBtn && missBtn.disabled) return;
    if (missBtn) {
        missBtn.disabled = true;
        setTimeout(() => { missBtn.disabled = false; }, 2000);
    }

    saveGameState();

    const player = game.players[game.currentPlayer];

    // Clear pending darts
    game.pendingDarts = [];

    // Increment throws (1 per turn)
    player.throws++;

    // Set lastTurnMarks for miss indicator
    player.lastTurnMarks = { 'MISS': 0 };

    // Move to next player
    const nextPlayer = (game.currentPlayer + 1) % game.players.length;

    // Clear next player's lastTurnMarks
    game.players[nextPlayer].lastTurnMarks = null;

    // Increment round when back to player 0
    if (nextPlayer === 0) {
        game.completedRounds++;
    }

    game.currentPlayer = nextPlayer;
    game.pendingDarts = [];

    saveGameState();
    updateCricketDisplay();
    updateUndoRedoButtons();
}

export function initCricketControls() {
    // Back/Undo button
    const backBtn = document.getElementById('cricketBackBtn');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            undoWithCooldown(() => {
                updateCricketDisplay();
                updateUndoRedoButtons();
            });
        });
    }

    // Miss button
    const missBtn = document.getElementById('missBtn');
    if (missBtn) {
        missBtn.addEventListener('click', () => {
            cricketMiss();
        });
    }

    // Enter/Confirm button
    const enterBtn = document.getElementById('enterBtn');
    if (enterBtn) {
        enterBtn.addEventListener('click', () => {
            cricketConfirm();
        });
    }

    // Event delegation for cricket grid buttons
    const cricketGrid = document.getElementById('cricketGrid');
    if (cricketGrid) {
        cricketGrid.addEventListener('click', (e) => {
            const btn = e.target.closest('.cricket-num-btn, .cricket-dt-btn');
            if (!btn) return;

            const target = btn.getAttribute('data-target');
            const multiplier = parseInt(btn.getAttribute('data-multiplier'));
            if (target && !isNaN(multiplier)) {
                hitTarget(target, multiplier);
            }
        });
    }
}
