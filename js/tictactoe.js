/* ============================================
   Tic Tac Toe Darts

   Bull occupies the center; eight unique numbers fill the
   remaining squares. Four marks claims a square (S=1,
   D=2, T=3; outer Bull=1, inner Bull=2). First line wins.
   If all squares are claimed without a line, most squares wins.
   ============================================ */

import {
    game, saveGameState, saveActiveGame,
    undoLastAction
} from './state.js';
import {
    updatePlayerHeaders, updateRoundBadge,
    updateUndoRedoButtons, showWinner
} from './ui.js';

const WIN_LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
];

let selectedMultiplier = 1;
let controlsInitialized = false;

function randomTargets() {
    const numbers = Array.from({ length: 20 }, (_, index) => index + 1);
    for (let i = numbers.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
    }
    const picked = numbers.slice(0, 8).map(String);
    picked.splice(4, 0, 'Bull');
    return picked;
}

export function initTicTacToeState() {
    const targets = randomTargets();
    return {
        targets,
        cells: targets.map(target => ({ target, marks: [0, 0], owner: null }))
    };
}

function pendingMarksFor(cellIndex, playerIndex) {
    return game.pendingDarts.reduce((total, dart) => {
        if (dart.miss || dart.cellIndex !== cellIndex || dart.playerIndex !== playerIndex) return total;
        return total + dart.multiplier;
    }, 0);
}

function displayMarks(cell, cellIndex, playerIndex) {
    if (cell.owner != null) return cell.marks[playerIndex];
    return Math.min(4, cell.marks[playerIndex] + pendingMarksFor(cellIndex, playerIndex));
}

function cellHtml(cell, index) {
    const ownerClass = cell.owner == null ? '' : ` owner-${cell.owner}`;
    const targetLabel = cell.target === 'Bull' ? 'BULL' : cell.target;
    const ownerMark = cell.owner === 0 ? '✕' : cell.owner === 1 ? '○' : '';
    return `
        <button type="button" class="tic-cell${ownerClass}" data-tic-cell="${index}"
                ${cell.owner != null ? 'disabled' : ''} aria-label="${targetLabel} square">
            <span class="tic-owner">${ownerMark}</span>
            <span class="tic-target">${targetLabel}</span>
            <span class="tic-marks">
                <span class="tic-x">✕ ${displayMarks(cell, index, 0)}/4</span>
                <span class="tic-o">○ ${displayMarks(cell, index, 1)}/4</span>
            </span>
        </button>`;
}

function updatePendingText(message = '') {
    const pending = document.getElementById('ticPendingText');
    if (!pending) return;
    if (message) {
        pending.textContent = message;
        return;
    }
    const used = game.pendingDarts.length;
    const names = game.pendingDarts.map(dart => {
        if (dart.miss) return 'MISS';
        const prefix = dart.multiplier === 3 ? 'T' : dart.multiplier === 2 ? 'D' : 'S';
        return prefix + game.ticTacToe.cells[dart.cellIndex].target;
    });
    pending.textContent = names.length
        ? `${names.join(' • ')} — ${3 - used} dart${3 - used === 1 ? '' : 's'} left`
        : 'Choose Single, Double or Triple, then tap a square.';
}

export function updateTicTacToeDisplay() {
    const grid = document.getElementById('ticTacToeGrid');
    if (grid) grid.innerHTML = game.ticTacToe.cells.map(cellHtml).join('');

    const scoreIds = ['homeScore', 'awayScore'];
    scoreIds.forEach((id, playerIndex) => {
        const claimed = game.ticTacToe.cells.filter(cell => cell.owner === playerIndex).length;
        const el = document.getElementById(id);
        if (el) el.textContent = String(claimed);
    });
    ['homeMPR', 'homeMPR2', 'awayMPR', 'awayMPR2'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    document.querySelectorAll('[data-tic-mult]').forEach(button => {
        button.classList.toggle('active', Number(button.dataset.ticMult) === selectedMultiplier);
    });
    const noDartsLeft = game.pendingDarts.length >= 3;
    document.querySelectorAll('[data-tic-mult], [data-tic-cell], #ticMissBtn').forEach(control => {
        if (control.matches('[data-tic-cell]') && game.ticTacToe.cells[Number(control.dataset.ticCell)].owner != null) return;
        control.disabled = noDartsLeft;
    });
    const undo = document.getElementById('ticUndoBtn');
    if (undo) undo.disabled = !game.undoHistory.length;
    updatePendingText();
    updatePlayerHeaders();
    updateRoundBadge();
    updateUndoRedoButtons();
}

function recordDart(cellIndex, miss = false) {
    if (game.pendingDarts.length >= 3) return;
    const cell = miss ? null : game.ticTacToe.cells[cellIndex];
    if (!miss && (!cell || cell.owner != null)) return;
    if (!miss && cell.target === 'Bull' && selectedMultiplier === 3) {
        updatePendingText('Bull has no triple — choose Single or Double.');
        return;
    }
    saveGameState();
    game.pendingDarts.push(miss
        ? { miss: true, playerIndex: game.currentPlayer }
        : { cellIndex, multiplier: selectedMultiplier, playerIndex: game.currentPlayer });
    updateTicTacToeDisplay();
}

function winningPlayer() {
    for (const line of WIN_LINES) {
        const owner = game.ticTacToe.cells[line[0]].owner;
        if (owner != null && line.every(index => game.ticTacToe.cells[index].owner === owner)) {
            return owner;
        }
    }
    return null;
}

function catsWinner() {
    if (!game.ticTacToe.cells.every(cell => cell.owner != null)) return null;
    const counts = [0, 1].map(playerIndex =>
        game.ticTacToe.cells.filter(cell => cell.owner === playerIndex).length);
    if (counts[0] === counts[1]) return [0, 1];
    return [counts[0] > counts[1] ? 0 : 1];
}

function commitTurn() {
    saveGameState();
    const playerIndex = game.currentPlayer;
    const claimed = [];
    game.pendingDarts.forEach(dart => {
        if (dart.miss) return;
        const cell = game.ticTacToe.cells[dart.cellIndex];
        if (cell.owner != null) return;
        cell.marks[playerIndex] = Math.min(4, cell.marks[playerIndex] + dart.multiplier);
        if (cell.marks[playerIndex] >= 4) {
            cell.owner = playerIndex;
            claimed.push(dart.cellIndex);
        }
    });
    game.players[playerIndex].throws++;
    game.players[playerIndex].history.push({
        round: game.completedRounds + 1,
        darts: game.pendingDarts.map(dart => ({ ...dart })),
        claimed
    });
    game.pendingDarts = [];

    const lineWinner = winningPlayer();
    if (lineWinner != null) {
        saveActiveGame();
        updateTicTacToeDisplay();
        showWinner(game.players[lineWinner].name, false, true);
        return;
    }
    const catWinners = catsWinner();
    if (catWinners) {
        saveActiveGame();
        updateTicTacToeDisplay();
        showWinner(catWinners.map(index => game.players[index].name).join(' & '), false, true);
        return;
    }

    game.currentPlayer = 1 - game.currentPlayer;
    if (game.currentPlayer === 0) game.completedRounds++;
    selectedMultiplier = 1;
    saveActiveGame();
    updateTicTacToeDisplay();
}

function undoAction() {
    undoLastAction(() => updateTicTacToeDisplay());
}

export function initTicTacToeControls() {
    if (controlsInitialized) return;
    controlsInitialized = true;

    const grid = document.getElementById('ticTacToeGrid');
    grid?.addEventListener('pointerdown', event => {
        const cell = event.target.closest('[data-tic-cell]');
        if (!cell) return;
        event.preventDefault();
        recordDart(Number(cell.dataset.ticCell));
    });
    document.querySelectorAll('[data-tic-mult]').forEach(button => {
        button.addEventListener('pointerdown', event => {
            event.preventDefault();
            selectedMultiplier = Number(button.dataset.ticMult);
            updateTicTacToeDisplay();
        });
    });
    document.getElementById('ticMissBtn')?.addEventListener('pointerdown', event => {
        event.preventDefault();
        recordDart(null, true);
    });
    document.getElementById('ticUndoBtn')?.addEventListener('pointerdown', event => {
        event.preventDefault();
        undoAction();
    });
    document.getElementById('ticEndTurnBtn')?.addEventListener('pointerdown', event => {
        event.preventDefault();
        commitTurn();
    });
}

export function resetTicTacToeInput() {
    selectedMultiplier = 1;
}
