/* ============================================
   X01 Games (301, 501, 701, 801)
   Checkout chart, calculator mode, score history
   ============================================ */

import { game, saveGameState, undoWithCooldown, redoWithCooldown } from './state.js';
import { updateUndoRedoButtons, updatePlayerHeaders, updateRoundBadge, showWinner, show121MatchSummary } from './ui.js';
import { handle121LegEnd } from './game121.js';

// --- Checkout Chart (verbatim) ---
const checkoutChart = {
    170: 'T20 T20 Bull', 167: 'T20 T19 Bull', 164: 'T20 T18 Bull',
    161: 'T20 T17 Bull', 160: 'T20 T20 D20', 158: 'T20 T20 D19',
    157: 'T20 T19 D20', 156: 'T20 T20 D18', 155: 'T20 T19 D19',
    154: 'T20 T18 D20', 153: 'T20 T19 D18', 152: 'T20 T20 D16',
    151: 'T20 T17 D20', 150: 'T20 T18 D18', 149: 'T20 T19 D16',
    148: 'T20 T20 D14', 147: 'T20 T17 D18', 146: 'T20 T18 D16',
    145: 'T20 T19 D14', 144: 'T20 T20 D12', 143: 'T20 T17 D16',
    142: 'T20 T14 D20', 141: 'T20 T19 D12', 140: 'T20 T20 D10',
    139: 'T20 T13 D20', 138: 'T20 T18 D12', 137: 'T20 T19 D10',
    136: 'T20 T20 D8', 135: 'T20 T17 D12', 134: 'T20 T14 D16',
    133: 'T20 T19 D8', 132: 'T20 T16 D12', 131: 'T20 T13 D16',
    130: 'T20 T18 D8', 129: 'T19 T16 D12', 128: 'T18 T14 D16',
    127: 'T20 T17 D8', 126: 'T19 T19 D6', 125: 'T20 T19 D4',
    124: 'T20 T16 D8', 123: 'T19 T16 D9', 122: 'T18 T18 D7',
    121: 'T20 T11 D14', 120: 'T20 20 D20', 119: 'T19 T12 D13',
    118: 'T20 18 D20', 117: 'T20 17 D20', 116: 'T20 16 D20',
    115: 'T20 15 D20', 114: 'T20 14 D20', 113: 'T20 13 D20',
    112: 'T20 12 D20', 111: 'T20 11 D20', 110: 'T20 10 D20',
    109: 'T20 9 D20', 108: 'T20 16 D16', 107: 'T19 10 D20',
    106: 'T20 6 D20', 105: 'T20 5 D20', 104: 'T18 10 D20',
    103: 'T20 3 D20', 102: 'T20 10 D16', 101: 'T20 1 D20',
    100: 'T20 D20', 99: 'T19 10 D16', 98: 'T20 D19',
    97: 'T19 D20', 96: 'T20 D18', 95: 'T19 D19',
    94: 'T18 D20', 93: 'T19 D18', 92: 'T20 D16',
    91: 'T17 D20', 90: 'T18 D18', 89: 'T19 D16',
    88: 'T20 D14', 87: 'T17 D18', 86: 'T18 D16',
    85: 'T15 D20', 84: 'T20 D12', 83: 'T17 D16',
    82: 'T14 D20', 81: 'T19 D12', 80: 'T20 D10',
    79: 'T13 D20', 78: 'T18 D12', 77: 'T19 D10',
    76: 'T20 D8', 75: 'T17 D12', 74: 'T14 D16',
    73: 'T19 D8', 72: 'T16 D12', 71: 'T13 D16',
    70: 'T18 D8', 69: 'T19 D6', 68: 'T20 D4',
    67: 'T17 D8', 66: 'T10 D18', 65: 'T19 D4',
    64: 'T16 D8', 63: 'T13 D12', 62: 'T10 D16',
    61: 'T15 D8', 60: '20 D20', 59: '19 D20',
    58: '18 D20', 57: '17 D20', 56: '16 D20',
    55: '15 D20', 54: '14 D20', 53: '13 D20',
    52: '12 D20', 51: '11 D20', 50: 'Bull',
    49: '9 D20', 48: '16 D16', 47: '15 D16',
    46: '6 D20', 45: '13 D16', 44: '12 D16',
    43: '3 D20', 42: '10 D16', 41: '9 D16',
    40: 'D20', 39: '7 D16', 38: 'D19',
    37: '5 D16', 36: 'D18', 35: '3 D16',
    34: 'D17', 33: '1 D16', 32: 'D16',
    31: '15 D8', 30: 'D15', 29: '13 D8',
    28: 'D14', 27: '11 D8', 26: 'D13',
    25: '9 D8', 24: 'D12', 23: '7 D8',
    22: 'D11', 21: '5 D8', 20: 'D10',
    19: '3 D8', 18: 'D9', 17: '1 D8',
    16: 'D8', 15: '7 D4', 14: 'D7',
    13: '5 D4', 12: 'D6', 11: '3 D4',
    10: 'D5', 9: '1 D4', 8: 'D4',
    7: '3 D2', 6: 'D3', 5: '1 D2',
    4: 'D2', 3: '1 D1', 2: 'D1'
};

// --- Calculator Mode ---
let calcExpression = [];
let calcNextMultiplier = 1;

function addDigit(digit) {
    game.currentInput = (game.currentInput || '') + digit;
    updateCalcDisplay();
}

function quickScore(score) {
    calcExpression = [];
    calcNextMultiplier = 1;
    resetCalcButtons();
    game.currentInput = String(score);
    document.getElementById('inputDisplay').textContent = game.currentInput;
    submitScore();
}

function calcMode(mode) {
    if (mode === '+') {
        if (game.currentInput && game.currentInput !== '0' && game.currentInput !== '') {
            const val = parseInt(game.currentInput) * calcNextMultiplier;
            calcExpression.push(val);
            calcNextMultiplier = 1;
            game.currentInput = '';
            updateCalcDisplay();
        }
    } else if (mode === 'D') {
        calcNextMultiplier = 2;
        document.getElementById('calcDBtn').classList.add('active');
        document.getElementById('calcTBtn').classList.remove('active');
    } else if (mode === 'T') {
        calcNextMultiplier = 3;
        document.getElementById('calcTBtn').classList.add('active');
        document.getElementById('calcDBtn').classList.remove('active');
    }
}

function calcPreset(preset) {
    const presetValues = { 'T20': 60, 'T19': 57, 'D20': 40, 'D16': 32, 'D10': 20 };
    const value = presetValues[preset];
    if (value === undefined) return;

    // If there's current input, add to expression first
    if (game.currentInput && game.currentInput !== '0' && game.currentInput !== '') {
        const val = parseInt(game.currentInput) * calcNextMultiplier;
        calcExpression.push(val);
    }
    calcExpression.push(value);
    calcNextMultiplier = 1;
    game.currentInput = '';
    updateCalcDisplay();
    resetCalcButtons();
}

function updateCalcDisplay() {
    const display = document.getElementById('inputDisplay');
    if (calcExpression.length === 0 && !game.currentInput) {
        display.textContent = '0';
    } else {
        const total = calcExpression.reduce((a, b) => a + b, 0);
        const current = game.currentInput ? parseInt(game.currentInput) * calcNextMultiplier : 0;
        const prefix = calcNextMultiplier === 2 ? 'D' : (calcNextMultiplier === 3 ? 'T' : '');

        if (calcExpression.length > 0) {
            display.textContent = `${total}${game.currentInput ? '+' + prefix + game.currentInput : ''} = ${total + current}`;
        } else if (game.currentInput) {
            display.textContent = prefix + game.currentInput;
        }
    }
}

function resetCalcButtons() {
    document.getElementById('calcDBtn').classList.remove('active');
    document.getElementById('calcTBtn').classList.remove('active');
}

function clearInput() {
    game.currentInput = '';
    calcExpression = [];
    calcNextMultiplier = 1;
    resetCalcButtons();
    document.getElementById('inputDisplay').textContent = '0';
}

function x01Miss() {
    calcExpression = [];
    calcNextMultiplier = 1;
    resetCalcButtons();
    game.currentInput = '0';
    document.getElementById('inputDisplay').textContent = '0';
    submitScore();
}

function x01Bust() {
    saveGameState();
    const player = game.players[game.currentPlayer];
    player.history.push({ score: 0, bust: true });
    game.currentPlayer = (game.currentPlayer + 1) % game.players.length;
    clearInput();
    if (game.currentPlayer === 0) {
        game.completedRounds++;
    }
    updateX01Display();
    updateUndoRedoButtons();
}

// --- Core Score Submission (with bug fixes) ---

function submitScore() {
    // Calculate total from calculator expression
    let expressionTotal = calcExpression.reduce((a, b) => a + b, 0);
    const currentVal = game.currentInput ? parseInt(game.currentInput) * calcNextMultiplier : 0;
    const score = expressionTotal + currentVal;

    // Reset calculator state
    calcExpression = [];
    calcNextMultiplier = 1;
    resetCalcButtons();

    if (score < 0 || score > 180) {
        const indicator = document.getElementById('finishIndicator');
        indicator.textContent = 'Invalid score (max 180)';
        indicator.style.color = 'var(--color-danger)';
        setTimeout(() => { indicator.textContent = ''; }, 2000);
        clearInput();
        return;
    }

    saveGameState();

    const player = game.players[game.currentPlayer];
    const newScore = player.score - score;
    const finishType = game.finishType || 'open';
    const isFirstThrow = player.history.length === 0;

    // Double In check
    if (finishType === 'double-in-out' && isFirstThrow) {
        const validDoubleIns = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 50];
        if (!validDoubleIns.includes(score)) {
            const indicator = document.getElementById('finishIndicator');
            indicator.textContent = 'MUST START WITH DOUBLE!';
            indicator.style.color = 'var(--color-danger)';
            setTimeout(() => { indicator.textContent = ''; updateX01Display(); }, 3000);
            clearInput();
            return;
        }
    }

    // Bust check: below 0 or left on 1 (can't finish with double from 1)
    if (newScore < 0 || newScore === 1) {
        player.history.push({ score: score, bust: true });

        const indicator = document.getElementById('finishIndicator');
        indicator.textContent = 'BUST!';
        indicator.style.color = 'var(--color-danger)';
        setTimeout(() => { indicator.textContent = ''; }, 2000);

        clearInput();
        game.currentPlayer = (game.currentPlayer + 1) % game.players.length;
        if (game.currentPlayer === 0) game.completedRounds++;
        updateX01Display();
        updateUndoRedoButtons();
        return;
    }

    // BUG FIX: newScore === 0 is ALWAYS a win. Trust the player.
    // Apply score
    player.score = newScore;
    player.history.push(score);

    // Handle 121 game dart counting
    if (game.game121) {
        game.game121.dartsThrown += 3;
    }

    // Win check
    if (player.score === 0) {
        if (game.game121) {
            handle121LegEnd(true, score);
            return;
        }
        showWinner(player.name);
        return;
    }

    // 121 game: check if darts ran out
    if (game.game121 && game.game121.dartsThrown >= game.game121.dartsPerLeg) {
        handle121LegEnd(false);
        return;
    }

    clearInput();
    game.currentPlayer = (game.currentPlayer + 1) % game.players.length;
    if (game.currentPlayer === 0) game.completedRounds++;

    updateX01Display();
    updateUndoRedoButtons();
}

// --- Score History Rendering ---

function renderX01ScoreHistory() {
    const numPlayers = game.players.length;
    const x01Main = document.getElementById('x01Main');

    x01Main.classList.remove('three-player', 'four-player');
    if (numPlayers === 3) x01Main.classList.add('three-player');
    else if (numPlayers === 4) x01Main.classList.add('four-player');

    const p1Col = document.getElementById('p1HistoryCol');
    const p2Col = document.getElementById('p2HistoryCol');
    const roundCol = document.getElementById('roundNumCol');
    const p3Col = document.getElementById('p3HistoryCol');
    const p4Col = document.getElementById('p4HistoryCol');

    // Column visibility based on player count
    if (numPlayers === 2) {
        p2Col.style.display = 'none';
        p3Col.style.display = 'flex';
        p4Col.style.display = 'none';
    } else if (numPlayers === 3) {
        p2Col.style.display = 'none';
        p3Col.style.display = 'flex';
        p4Col.style.display = 'flex';
    } else if (numPlayers === 4) {
        p2Col.style.display = 'flex';
        p3Col.style.display = 'flex';
        p4Col.style.display = 'flex';
    } else {
        p2Col.style.display = 'none';
        p3Col.style.display = 'none';
        p4Col.style.display = 'none';
    }

    // Find max rounds
    let maxRounds = 0;
    game.players.forEach(p => {
        if (p.history.length > maxRounds) maxRounds = p.history.length;
    });
    maxRounds = Math.max(maxRounds, 1);

    // Build round numbers
    let roundHtml = '';
    for (let r = 1; r <= maxRounds; r++) {
        const isCurrent = (r === maxRounds && game.players[game.currentPlayer].history.length < maxRounds);
        roundHtml += `<div class="round-number${isCurrent ? ' current' : ''}">${r}</div>`;
    }
    if (game.players[game.currentPlayer].history.length === maxRounds) {
        roundHtml += `<div class="round-number current">${maxRounds + 1}</div>`;
    }
    roundCol.innerHTML = roundHtml;

    // Build player columns
    const buildPlayerColumn = (playerIndex, isLeft) => {
        const player = game.players[playerIndex];
        if (!player) return '';

        let html = '';
        const totalRounds = game.players[game.currentPlayer].history.length === maxRounds ? maxRounds + 1 : maxRounds;

        for (let r = 0; r < totalRounds; r++) {
            const entry = player.history[r];
            const isCurrent = r === player.history.length && game.currentPlayer === playerIndex;
            const arrow = isCurrent && isLeft ? ' ◄' : (isCurrent && !isLeft ? '► ' : '');

            if (entry !== undefined) {
                const scoreVal = typeof entry === 'object' ? entry.score : entry;
                const isBust = typeof entry === 'object' && entry.bust;
                html += `<div class="score-history-entry${isBust ? ' bust' : ''}">${isLeft ? '' : arrow}${scoreVal}${isLeft ? arrow : ''}</div>`;
            } else if (isCurrent) {
                html += `<div class="score-history-entry current">${isLeft ? '' : arrow}--${isLeft ? arrow : ''}</div>`;
            } else {
                html += `<div class="score-history-entry"></div>`;
            }
        }
        return html;
    };

    // Assign columns based on player count
    p1Col.innerHTML = buildPlayerColumn(0, true);
    if (numPlayers === 2) {
        p3Col.innerHTML = buildPlayerColumn(1, false);
    } else if (numPlayers === 3) {
        p3Col.innerHTML = buildPlayerColumn(1, false);
        p4Col.innerHTML = buildPlayerColumn(2, false);
    } else if (numPlayers === 4) {
        p2Col.innerHTML = buildPlayerColumn(1, true);
        p3Col.innerHTML = buildPlayerColumn(2, false);
        p4Col.innerHTML = buildPlayerColumn(3, false);
    }

    // Auto-scroll all columns to show latest scores
    setTimeout(() => {
        [p1Col, p2Col, p3Col, p4Col, roundCol].forEach(col => {
            if (col && col.style.display !== 'none') {
                col.scrollTop = col.scrollHeight;
            }
        });
    }, 10);
}

// --- Checkout Suggestion ---

function updateCheckoutSuggestion() {
    const suggestionEl = document.getElementById('checkoutSuggestion');
    const player = game.players[game.currentPlayer];
    const score = player.score;
    const finishType = game.finishType || 'open';

    // Double-out: show chart entry for scores 2-170
    if ((finishType === 'double-out' || finishType === 'double-in-out') && score >= 2 && score <= 170) {
        const checkout = checkoutChart[score];
        if (checkout) {
            suggestionEl.textContent = `Checkout: ${checkout}`;
            suggestionEl.style.display = 'block';
            return;
        }
    }

    // Open finish
    if (finishType === 'open' && score <= 180 && score > 0) {
        if (score <= 60) {
            suggestionEl.textContent = `Finish with ${score}`;
        } else if (score <= 120) {
            suggestionEl.textContent = `${score - 60} + 60 or T20 + ${score - 60}`;
        } else {
            suggestionEl.textContent = `Score ${score} to win`;
        }
        suggestionEl.style.display = 'block';
        return;
    }

    suggestionEl.style.display = 'none';
}

// --- Master Display Update ---

function updateX01Display() {
    const numPlayers = game.players.length;

    // Update scores in header
    document.getElementById('homeScore').textContent = game.players[0].score;
    document.getElementById('awayScore').textContent = numPlayers >= 2 ? game.players[1].score : 0;
    if (numPlayers >= 3) document.getElementById('player3Score').textContent = game.players[2].score;
    if (numPlayers >= 4) document.getElementById('player4Score').textContent = game.players[3].score;

    // Update round badge
    updateRoundBadge();

    // Update finish indicator
    const finishIndicator = document.getElementById('finishIndicator');
    const currentPlayer = game.players[game.currentPlayer];
    const finishType = game.finishType || 'open';

    if (game.game121) {
        const dartsLeft = game.game121.dartsPerLeg - game.game121.dartsThrown;
        finishIndicator.textContent = `${dartsLeft} dart${dartsLeft !== 1 ? 's' : ''} left | Start: ${game.game121.startingScore}`;
        finishIndicator.style.color = dartsLeft <= 3 ? 'var(--color-undo)' : 'var(--color-primary-light)';
    } else if (finishType === 'double-in-out' && currentPlayer.history.length === 0) {
        finishIndicator.textContent = 'DOUBLE IN REQUIRED';
        finishIndicator.style.color = 'var(--color-warning)';
    } else if ((finishType === 'double-out' || finishType === 'double-in-out') && currentPlayer.score <= 170) {
        // BUG FIX: was <= 40, now <= 170
        finishIndicator.textContent = 'DOUBLE OUT TO FINISH';
        finishIndicator.style.color = 'var(--color-pending)';
    } else {
        finishIndicator.textContent = '';
    }

    renderX01ScoreHistory();
    updateCheckoutSuggestion();
    updatePlayerHeaders();
}

// --- Event Listener Setup ---

function initX01Controls() {
    // Digit buttons
    document.querySelectorAll('[data-digit]').forEach(btn => {
        btn.addEventListener('click', () => addDigit(btn.dataset.digit));
    });

    // Quick score buttons
    document.querySelectorAll('[data-quick]').forEach(btn => {
        btn.addEventListener('click', () => quickScore(parseInt(btn.dataset.quick)));
    });

    // Calculator buttons
    document.querySelectorAll('[data-calc]').forEach(btn => {
        btn.addEventListener('click', () => calcMode(btn.dataset.calc));
    });

    // Preset buttons
    document.querySelectorAll('[data-preset]').forEach(btn => {
        btn.addEventListener('click', () => calcPreset(btn.dataset.preset));
    });

    // Control buttons
    document.getElementById('x01BackBtn').addEventListener('click', clearInput);
    document.getElementById('x01EnterBtn').addEventListener('click', submitScore);
    document.getElementById('x01MissBtn').addEventListener('click', x01Miss);
    document.getElementById('x01BustBtn').addEventListener('click', x01Bust);

    // Undo/Redo
    document.getElementById('undoBtnX01').addEventListener('click', () => {
        undoWithCooldown(() => {
            updateX01Display();
            updateUndoRedoButtons();
            document.getElementById('inputDisplay').textContent = game.currentInput || '0';
        });
    });

    document.getElementById('redoBtnX01').addEventListener('click', () => {
        redoWithCooldown(() => {
            updateX01Display();
            updateUndoRedoButtons();
            document.getElementById('inputDisplay').textContent = game.currentInput || '0';
        });
    });
}

export { updateX01Display, initX01Controls, submitScore, clearInput };
