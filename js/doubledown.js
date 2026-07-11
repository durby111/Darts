/* ============================================
   Double Down Cricket

   Phase 1: hit two random doubles from D2–D14.
   Phase 2: close Cricket numbers 15–20 (3 marks each).
   Phase 3: hit Double 1 to win. No points, no Bulls.
   ============================================ */

import {
    game, saveGameState, saveActiveGame,
    undoLastAction
} from './state.js';
import {
    updatePlayerHeaders, updateRoundBadge,
    updateUndoRedoButtons, showWinner
} from './ui.js';
import { advanceRotation } from './teams.js';

const CRICKET_TARGETS = ['20', '19', '18', '17', '16', '15'];
let controlsInitialized = false;

function randomRequiredDoubles() {
    const values = Array.from({ length: 13 }, (_, index) => index + 2);
    for (let i = values.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [values[i], values[j]] = [values[j], values[i]];
    }
    return values.slice(0, 2);
}

function blankProgress() {
    return {
        doubles: [false, false],
        cricket: Object.fromEntries(CRICKET_TARGETS.map(target => [target, 0])),
        doubleOne: false
    };
}

export function initDoubleDownState(playerCount) {
    return {
        requiredDoubles: randomRequiredDoubles(),
        progress: Array.from({ length: playerCount }, blankProgress)
    };
}

function effectiveProgress(playerIndex) {
    const base = game.doubleDown.progress[playerIndex];
    const progress = {
        doubles: base.doubles.slice(),
        cricket: { ...base.cricket },
        doubleOne: base.doubleOne
    };
    game.pendingDarts.forEach(dart => {
        if (dart.miss) return;
        if (dart.kind === 'double-in') progress.doubles[dart.index] = true;
        if (dart.kind === 'cricket') {
            progress.cricket[dart.target] = Math.min(3, progress.cricket[dart.target] + dart.marks);
        }
        if (dart.kind === 'double-one') progress.doubleOne = true;
    });
    return progress;
}

function phaseFor(progress) {
    if (!progress.doubles.every(Boolean)) return 'double-in';
    if (!CRICKET_TARGETS.every(target => progress.cricket[target] >= 3)) return 'cricket';
    return 'double-one';
}

function completedChallenges(progress) {
    return progress.doubles.filter(Boolean).length
        + CRICKET_TARGETS.filter(target => progress.cricket[target] >= 3).length
        + (progress.doubleOne ? 1 : 0);
}

function playerProgressTable() {
    return game.players.map((player, index) => {
        const progress = game.doubleDown.progress[index];
        const doubles = progress.doubles.map((done, doubleIndex) =>
            `${done ? '✓' : '○'} D${game.doubleDown.requiredDoubles[doubleIndex]}`).join('  ');
        const closed = CRICKET_TARGETS.filter(target => progress.cricket[target] >= 3).length;
        return `<div class="double-down-player${index === game.currentPlayer ? ' active' : ''}">
            <span>${escapeHtml(player.name)}</span>
            <span>${doubles}</span>
            <span>${closed}/6 closed</span>
            <span>${progress.doubleOne ? '✓ D1' : '○ D1'}</span>
        </div>`;
    }).join('');
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
}

function renderDoubleIn(progress) {
    const buttons = game.doubleDown.requiredDoubles.map((value, index) => {
        const complete = progress.doubles[index];
        return `<button class="double-down-target${complete ? ' complete' : ''}"
                data-double-down-kind="double-in" data-double-index="${index}" ${complete ? 'disabled' : ''}>
            <span>D${value}</span><small>${complete ? 'Complete' : 'Hit this double'}</small>
        </button>`;
    }).join('');
    return `<div class="double-down-targets double-in-targets">${buttons}</div>`;
}

function renderCricket(progress) {
    return `<div class="double-down-cricket-grid">${CRICKET_TARGETS.map(target => {
        const marks = progress.cricket[target];
        return `<div class="double-down-cricket-row${marks >= 3 ? ' complete' : ''}">
            <span class="double-down-number">${target}</span>
            <span class="double-down-marks">${marks}/3</span>
            <span class="double-down-hit-buttons">
                <button data-double-down-kind="cricket" data-target="${target}" data-marks="1" ${marks >= 3 ? 'disabled' : ''}>S</button>
                <button data-double-down-kind="cricket" data-target="${target}" data-marks="2" ${marks >= 3 ? 'disabled' : ''}>D</button>
                <button data-double-down-kind="cricket" data-target="${target}" data-marks="3" ${marks >= 3 ? 'disabled' : ''}>T</button>
            </span>
        </div>`;
    }).join('')}</div>`;
}

function renderDoubleOne() {
    return `<div class="double-down-targets">
        <button class="double-down-target double-one-target" data-double-down-kind="double-one">
            <span>D1</span><small>Hit Double 1 to win</small>
        </button>
    </div>`;
}

function updatePending() {
    const text = document.getElementById('doubleDownPending');
    if (!text) return;
    const used = game.pendingDarts.length;
    const names = game.pendingDarts.map(dart => {
        if (dart.miss) return 'MISS';
        if (dart.kind === 'double-in') return `D${game.doubleDown.requiredDoubles[dart.index]}`;
        if (dart.kind === 'double-one') return 'D1';
        const prefix = dart.marks === 3 ? 'T' : dart.marks === 2 ? 'D' : 'S';
        return prefix + dart.target;
    });
    text.textContent = names.length
        ? `${names.join(' • ')} — ${3 - used} dart${3 - used === 1 ? '' : 's'} left`
        : 'Record up to three darts, then end the turn.';
}

export function updateDoubleDownDisplay() {
    const progress = effectiveProgress(game.currentPlayer);
    const phase = phaseFor(progress);
    const title = document.getElementById('doubleDownPhase');
    const hint = document.getElementById('doubleDownHint');
    const board = document.getElementById('doubleDownBoard');
    const table = document.getElementById('doubleDownPlayers');

    if (title) {
        title.textContent = phase === 'double-in' ? 'DOUBLE IN'
            : phase === 'cricket' ? 'CLOSE 15–20'
            : 'DOUBLE DOWN';
    }
    if (hint) {
        hint.textContent = phase === 'double-in'
            ? `Hit D${game.doubleDown.requiredDoubles[0]} and D${game.doubleDown.requiredDoubles[1]}.`
            : phase === 'cricket'
                ? 'Close every Cricket number. Single = 1, Double = 2, Triple = 3 marks.'
                : 'Only Double 1 wins. Declare other hits as misses or end the turn.';
    }
    if (board) {
        board.innerHTML = phase === 'double-in' ? renderDoubleIn(progress)
            : phase === 'cricket' ? renderCricket(progress)
            : renderDoubleOne();
    }
    if (table) table.innerHTML = playerProgressTable();

    const scoreIds = ['homeScore', 'awayScore', 'player3Score', 'player4Score'];
    game.players.forEach((player, index) => {
        const el = document.getElementById(scoreIds[index]);
        if (el) el.textContent = completedChallenges(
            index === game.currentPlayer ? progress : game.doubleDown.progress[index]);
    });
    ['homeMPR','homeMPR2','awayMPR','awayMPR2','player3MPR','player3MPR2','player4MPR','player4MPR2']
        .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });

    const noDartsLeft = game.pendingDarts.length >= 3;
    document.querySelectorAll('[data-double-down-kind], #doubleDownMissBtn').forEach(button => {
        if (!button.disabled) button.disabled = noDartsLeft;
    });
    const undo = document.getElementById('doubleDownUndoBtn');
    if (undo) undo.disabled = !game.undoHistory.length;
    updatePending();
    updatePlayerHeaders();
    updateRoundBadge();
    updateUndoRedoButtons();
}

function recordDart(button) {
    if (game.pendingDarts.length >= 3) return;
    const kind = button.dataset.doubleDownKind;
    const progress = effectiveProgress(game.currentPlayer);
    if (kind !== phaseFor(progress)) return;

    saveGameState();
    if (kind === 'double-in') {
        game.pendingDarts.push({ kind, index: Number(button.dataset.doubleIndex) });
    } else if (kind === 'cricket') {
        game.pendingDarts.push({ kind, target: button.dataset.target, marks: Number(button.dataset.marks) });
    } else if (kind === 'double-one') {
        game.pendingDarts.push({ kind });
    }
    updateDoubleDownDisplay();
}

function recordMiss() {
    if (game.pendingDarts.length >= 3) return;
    saveGameState();
    game.pendingDarts.push({ miss: true });
    updateDoubleDownDisplay();
}

function commitTurn() {
    saveGameState();
    const progress = game.doubleDown.progress[game.currentPlayer];
    let won = false;
    game.pendingDarts.forEach(dart => {
        if (dart.miss) return;
        if (dart.kind === 'double-in') progress.doubles[dart.index] = true;
        if (dart.kind === 'cricket') {
            progress.cricket[dart.target] = Math.min(3, progress.cricket[dart.target] + dart.marks);
        }
        if (dart.kind === 'double-one') {
            progress.doubleOne = true;
            won = true;
        }
    });
    game.players[game.currentPlayer].throws++;
    game.players[game.currentPlayer].history.push({
        round: game.completedRounds + 1,
        darts: game.pendingDarts.map(dart => ({ ...dart }))
    });
    game.pendingDarts = [];

    if (won) {
        saveActiveGame();
        updateDoubleDownDisplay();
        showWinner(game.players[game.currentPlayer].name, false, true);
        return;
    }

    if (game.teamMode) advanceRotation(game.currentPlayer);
    game.currentPlayer = (game.currentPlayer + 1) % game.players.length;
    if (game.currentPlayer === 0) game.completedRounds++;
    saveActiveGame();
    updateDoubleDownDisplay();
}

export function initDoubleDownControls() {
    if (controlsInitialized) return;
    controlsInitialized = true;
    document.getElementById('doubleDownBoard')?.addEventListener('pointerdown', event => {
        const button = event.target.closest('[data-double-down-kind]');
        if (!button) return;
        event.preventDefault();
        recordDart(button);
    });
    document.getElementById('doubleDownMissBtn')?.addEventListener('pointerdown', event => {
        event.preventDefault();
        recordMiss();
    });
    document.getElementById('doubleDownUndoBtn')?.addEventListener('pointerdown', event => {
        event.preventDefault();
        undoLastAction(() => updateDoubleDownDisplay());
    });
    document.getElementById('doubleDownEndTurnBtn')?.addEventListener('pointerdown', event => {
        event.preventDefault();
        commitTurn();
    });
}
