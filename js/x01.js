/* ============================================
    X01 Games + round-based total-score entry (Count Up)
   Checkout chart, calculator mode, score history
   ============================================ */

import { game, saveGameState, saveActiveGame, undoWithCooldown, redoWithCooldown } from './state.js';
import { updateUndoRedoButtons, updatePlayerHeaders, updateRoundBadge, showWinner, show121MatchSummary } from './ui.js';
import { handle121LegEnd, record121Round } from './game121.js';
import { currentThrower, advanceRotation } from './teams.js';

function activeThrowerName() {
    if (!game.teamMode) return null;
    const t = currentThrower(game.currentPlayer);
    return t ? t.name : null;
}

function isCountUpGame() {
    return game.type === 'countup' && !!game.countUp;
}

function isGotchaGame() {
    return game.type === 'gotcha' && !!game.gotcha;
}

function isSharkTankGame() {
    return game.type === 'sharktank' && !!game.sharkTank;
}

function isAdditiveScoreGame() {
    return isCountUpGame() || isGotchaGame() || isSharkTankGame();
}

function makeHistoryEntry(score, bust = false, thrower = null, miss = false) {
    // Keep the legacy number form when no extra data is needed, so existing
    // games and the X01 history renderer's `typeof === 'object'` check both
    // stay correct.
    if (!bust && !thrower && !miss) return score;
    const entry = { score };
    if (bust) entry.bust = true;
    if (miss) entry.miss = true;
    if (thrower) entry.thrower = thrower;
    return entry;
}

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

// --- Expression-Based Input ---
// Supports expressions like: 3*19+6+2*7 = 77
let expressionStr = '';

// --- Remaining-Score Entry Mode ---
// Tapping the ACTIVE player's score in the header flips the keypad into
// "remaining" mode: the player types what's LEFT on the board (e.g. 32)
// and the app computes the turn score (157 - 32 = 125) on ENTER. Entering
// digits without tapping the score works exactly like before.
let remainingMode = false;

function setRemainingMode(on) {
    if (isAdditiveScoreGame()) return;
    remainingMode = on;
    updateInputDisplay();
}

function toggleRemainingMode() {
    setRemainingMode(!remainingMode);
}

// --- Turn-commit debounce ---
// MISS/BUST/ENTER all commit a turn and advance to the next player. A jittery
// double-tap on a tablet would otherwise burn a whole turn for the next player.
// Disable the three buttons briefly after any of them fires.
let turnCommitLocked = false;
let turnCommitTimer = null;
const TURN_COMMIT_COOLDOWN_MS = 700;

function lockTurnCommit() {
    turnCommitLocked = true;
    const ids = ['x01MissBtn', 'x01BustBtn', 'x01EnterBtn'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = true;
    });
    if (turnCommitTimer) clearTimeout(turnCommitTimer);
    turnCommitTimer = setTimeout(() => {
        turnCommitLocked = false;
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.disabled = false;
        });
    }, TURN_COMMIT_COOLDOWN_MS);
}

function addDigit(digit) {
    expressionStr += digit;
    updateInputDisplay();
}

function addOperator(op) {
    // Only add operator if expression is non-empty and doesn't end with operator
    if (expressionStr.length === 0) return;
    const last = expressionStr[expressionStr.length - 1];
    if (last === '+' || last === '*') return;
    expressionStr += op;
    updateInputDisplay();
}

function evaluateExpression(str) {
    if (!str || str.length === 0) return 0;
    // Clean trailing operators
    str = str.replace(/[+*]+$/, '');
    if (!str) return 0;
    // Split by + then evaluate each term (which may contain *)
    const terms = str.split('+');
    let total = 0;
    for (const term of terms) {
        const factors = term.split('*');
        let product = 1;
        for (const f of factors) {
            const n = parseInt(f);
            if (isNaN(n)) return 0;
            product *= n;
        }
        total += product;
    }
    return total;
}

// --- Live running total ---
// Dart-by-dart entry should feel like the board is already updating: as
// soon as digits land, the ACTIVE player's header score shows where the
// turn would leave them (and a ±delta chip shows the damage). Nothing is
// committed until ENTER — this is purely a preview that any clear/undo
// restores.
const SCORE_EL_IDS = ['homeScore', 'awayScore', 'player3Score', 'player4Score'];
const DELTA_EL_IDS = ['homeDelta', 'awayDelta', 'player3Delta', 'player4Delta'];

function realHeaderScore(index) {
    return isSharkTankGame()
        ? Math.max(0, 6 - (game.sharkTank.bites[index] || 0))
        : game.players[index].score;
}

function updateLivePreview() {
    // Always start from a clean slate so a cleared/undone entry can never
    // leave a projected number sitting in the header.
    SCORE_EL_IDS.forEach((id, index) => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('score-preview', 'score-preview-bust');
        const deltaEl = document.getElementById(DELTA_EL_IDS[index]);
        if (deltaEl) {
            deltaEl.textContent = '';
            deltaEl.classList.remove('bust');
        }
    });

    const controls = document.getElementById('x01Controls');
    if (!controls || controls.classList.contains('hidden')) return;

    const index = game.currentPlayer;
    const player = game.players[index];
    const scoreEl = document.getElementById(SCORE_EL_IDS[index]);
    if (!player || !scoreEl) return;

    scoreEl.textContent = realHeaderScore(index);
    // Shark Tank headers show bites left, not points — nothing to project.
    if (!expressionStr || isSharkTankGame()) return;

    const typed = evaluateExpression(expressionStr);
    let projected;
    let scored = typed;
    let bust = false;

    if (remainingMode) {
        // Typed value is what's LEFT on the board.
        projected = typed;
        scored = player.score - typed;
        bust = scored < 0 || scored > 180;
    } else if (isGotchaGame()) {
        const target = game.gotcha.target || 301;
        const attempted = player.score + typed;
        projected = attempted > target ? player.score - (attempted - target) : attempted;
    } else if (isCountUpGame()) {
        projected = player.score + typed;
    } else {
        projected = player.score - typed;
        bust = projected < 0;
    }

    scoreEl.textContent = bust ? 'BUST' : projected;
    scoreEl.classList.add('score-preview');
    if (bust) scoreEl.classList.add('score-preview-bust');

    const deltaEl = document.getElementById(DELTA_EL_IDS[index]);
    if (deltaEl) {
        if (bust) {
            deltaEl.textContent = 'BUST';
            deltaEl.classList.add('bust');
        } else if (typed > 0 || expressionStr) {
            const sign = isAdditiveScoreGame() ? '+' : '\u2212';
            deltaEl.textContent = `${sign}${Math.abs(scored)}`;
        }
    }
}

function updateInputDisplay() {
    const display = document.getElementById('inputDisplay');
    if (remainingMode) {
        const player = game.players[game.currentPlayer];
        if (!expressionStr) {
            display.textContent = 'LEFT → ?';
        } else {
            const remaining = evaluateExpression(expressionStr);
            const scored = player.score - remaining;
            display.textContent = `LEFT ${remaining} = ${scored >= 0 ? scored : '?'} scored`;
        }
        display.classList.add('remaining-mode');
        updateMissEnterVisibility();
        updateLivePreview();
        return;
    }
    display.classList.remove('remaining-mode');
    if (!expressionStr) {
        display.textContent = '0';
    } else {
        const total = evaluateExpression(expressionStr);
        // Show expression and result
        const displayExpr = expressionStr.replace(/\*/g, '×');
        if (expressionStr.includes('+') || expressionStr.includes('*')) {
            display.textContent = `${displayExpr} = ${total}`;
        } else {
            display.textContent = displayExpr;
        }
    }
    updateMissEnterVisibility();
    updateLivePreview();
}

function updateMissEnterVisibility() {
    // MISS collapses once digits are typed (ENTER takes its slot), but
    // BUST stays available in every state — busting is player-declared
    // and must never require the MISS button.
    const missBtn = document.getElementById('x01MissBtn');
    const enterBtn = document.getElementById('x01EnterBtn');
    const bustBtn = document.getElementById('x01BustBtn');
    const hasInput = expressionStr.length > 0;
    if (missBtn) missBtn.style.display = hasInput ? 'none' : '';
    if (enterBtn) enterBtn.style.display = hasInput ? '' : 'none';
    if (bustBtn) bustBtn.style.display = isAdditiveScoreGame() ? 'none' : '';
}

function quickScore(score) {
    // If the user is mid-expression, don't silently drop their typed value.
    // Require them to clear or submit first.
    if (expressionStr.length > 0) {
        const indicator = document.getElementById('finishIndicator');
        if (indicator) {
            indicator.textContent = 'Clear input first (UNDO) or press ENTER';
            indicator.style.color = 'var(--color-warning)';
            setTimeout(() => { indicator.textContent = ''; updateX01Display(); }, 2000);
        }
        return;
    }
    game.currentInput = String(score);
    document.getElementById('inputDisplay').textContent = game.currentInput;
    submitScore();
}

function clearInput() {
    game.currentInput = '';
    expressionStr = '';
    remainingMode = false;
    const display = document.getElementById('inputDisplay');
    display.textContent = '0';
    display.classList.remove('remaining-mode');
    updateMissEnterVisibility();
    updateLivePreview();
}

// Reset ALL input-side state between matches. The win path returns early
// without clearInput(), so the winning throw would otherwise still be on
// screen (and module state like remainingMode would leak) when the next
// game starts. Called from beginMatch().
function resetX01Input() {
    game.currentInput = '';
    expressionStr = '';
    remainingMode = false;
    const display = document.getElementById('inputDisplay');
    if (display) {
        display.textContent = '0';
        display.classList.remove('remaining-mode');
    }
    const indicator = document.getElementById('finishIndicator');
    if (indicator) indicator.textContent = '';
    updateMissEnterVisibility();
    updateLivePreview();
}

function x01Miss() {
    // No guard here — submitScore() locks for us.
    expressionStr = '';
    remainingMode = false;
    game.currentInput = '0';
    document.getElementById('inputDisplay').textContent = '0';
    submitScore({ miss: true });
}

function x01Bust() {
    if (isAdditiveScoreGame()) return;
    if (turnCommitLocked) return;
    lockTurnCommit();
    saveGameState();
    const thrower = activeThrowerName();
    const player = game.players[game.currentPlayer];
    remainingMode = false;
    player.history.push(makeHistoryEntry(0, true, thrower));

    // 121 mode: a busted turn still consumes 3 darts from the player's allotment.
    if (game.game121) {
        game.game121.dartsThrown += 3;
        if (game.game121.dartsThrown >= game.game121.dartsPerLeg) {
            handle121LegEnd(false);
            return;
        }
    }

    if (game.teamMode) advanceRotation(game.currentPlayer);
    game.currentPlayer = (game.currentPlayer + 1) % game.players.length;
    if (game.currentPlayer === 0) {
        game.completedRounds++;
    }
    clearInput();
    saveActiveGame();
    updateX01Display();
    updateUndoRedoButtons();
}

function submitCountUpScore(score, opts, player, thrower) {
    player.score += score;
    player.history.push(makeHistoryEntry(score, false, thrower, !!opts.miss));

    const isLastPlayer = game.currentPlayer === game.players.length - 1;
    const totalRounds = game.countUp.totalRounds || 8;
    if (isLastPlayer && game.completedRounds + 1 >= totalRounds) {
        game.completedRounds = totalRounds;
        clearInput();
        saveActiveGame();
        updateX01Display();
        updateUndoRedoButtons();
        const high = Math.max(...game.players.map(p => p.score));
        const winners = game.players.filter(p => p.score === high).map(p => p.name);
        showWinner(winners.join(' & '), false, true);
        return;
    }

    if (game.teamMode) advanceRotation(game.currentPlayer);
    game.currentPlayer = (game.currentPlayer + 1) % game.players.length;
    if (game.currentPlayer === 0) game.completedRounds++;
    clearInput();
    saveActiveGame();
    updateX01Display();
    updateUndoRedoButtons();
}

function submitGotchaScore(score, opts, player, thrower) {
    const startingScore = player.score;
    const attemptedScore = startingScore + score;
    const target = game.gotcha.target || 301;
    let finalScore = attemptedScore;
    let overshoot = 0;
    const bombed = [];

    if (attemptedScore > target) {
        overshoot = attemptedScore - target;
        finalScore = startingScore - overshoot;
    } else if (score > 0 && !opts.miss && attemptedScore < target) {
        game.players.forEach((opponent, index) => {
            if (index !== game.currentPlayer && opponent.score === attemptedScore) {
                opponent.score = 0;
                bombed.push(opponent.name);
            }
        });
    }

    player.score = finalScore;
    player.history.push({
        score,
        gotchaScore: finalScore,
        ...(opts.miss ? { miss: true } : {}),
        ...(thrower ? { thrower } : {}),
        ...(overshoot ? { overshoot } : {}),
        ...(bombed.length ? { bombed } : {})
    });

    if (finalScore === target) {
        clearInput();
        saveActiveGame();
        updateX01Display();
        updateUndoRedoButtons();
        showWinner(player.name);
        return;
    }

    if (game.teamMode) advanceRotation(game.currentPlayer);
    game.currentPlayer = (game.currentPlayer + 1) % game.players.length;
    if (game.currentPlayer === 0) game.completedRounds++;
    clearInput();
    saveActiveGame();
    updateX01Display();
    updateUndoRedoButtons();
}

function submitSharkTankScore(score, opts, player, thrower) {
    const shark = game.sharkTank;
    const playerIndex = game.currentPlayer;
    shark.roundScores[playerIndex] = score;
    player.history.push({
        score,
        sharkRound: shark.round,
        ...(opts.miss ? { miss: true } : {}),
        ...(thrower ? { thrower } : {})
    });
    if (game.teamMode) advanceRotation(playerIndex);

    const active = game.players
        .map((_, index) => index)
        .filter(index => !shark.eliminated[index]);
    const pending = active.find(index => shark.roundScores[index] == null);
    if (pending !== undefined) {
        game.currentPlayer = pending;
        clearInput();
        saveActiveGame();
        updateX01Display();
        updateUndoRedoButtons();
        return;
    }

    const high = Math.max(...active.map(index => shark.roundScores[index]));
    const leaders = active.filter(index => shark.roundScores[index] === high);
    const biteDeltas = game.players.map(() => 0);
    if (leaders.length > 1) {
        active.forEach(index => { biteDeltas[index] = 1; });
    } else {
        const leader = leaders[0];
        active.forEach(index => {
            if (index === leader) return;
            biteDeltas[index] = high >= shark.roundScores[index] * 2 ? 2 : 1;
        });
    }

    active.forEach(index => {
        shark.bites[index] += biteDeltas[index];
        if (shark.bites[index] >= 6) shark.eliminated[index] = true;
        const entry = game.players[index].history.at(-1);
        if (entry && typeof entry === 'object') entry.bites = biteDeltas[index];
    });

    const survivors = active.filter(index => !shark.eliminated[index]);
    shark.roundScores = game.players.map(() => null);
    game.completedRounds = shark.round;
    shark.round++;
    clearInput();

    if (survivors.length <= 1) {
        saveActiveGame();
        updateX01Display();
        updateUndoRedoButtons();
        const winnerNames = survivors.length
            ? [game.players[survivors[0]].name]
            : active.map(index => game.players[index].name);
        showWinner(winnerNames.join(' & '), false, true);
        return;
    }

    game.currentPlayer = survivors[0];
    saveActiveGame();
    updateX01Display();
    updateUndoRedoButtons();
}

// --- Core Score Submission (with bug fixes) ---

function submitScore(opts = {}) {
    // Guard against double-tap. x01Miss/x01Bust already locked in their
    // wrapper; direct ENTER presses and quickScore paths land here.
    if (turnCommitLocked) return;
    lockTurnCommit();

    // Calculate total from expression or direct input
    let score;
    if (expressionStr) {
        score = evaluateExpression(expressionStr);
    } else {
        score = game.currentInput ? parseInt(game.currentInput) : 0;
    }

    // Remaining mode: the typed value is what's LEFT on the board, not
    // what was thrown. Convert to a turn score before the normal flow so
    // history/undo/stats look identical to typing the turn score.
    if (remainingMode && expressionStr) {
        const remaining = score;
        const current = game.players[game.currentPlayer].score;
        score = current - remaining;
        if (remaining < 0 || remaining > current || score > 180) {
            const indicator = document.getElementById('finishIndicator');
            indicator.textContent = `Invalid: ${remaining} left of ${current} isn't possible`;
            indicator.style.color = 'var(--color-danger)';
            setTimeout(() => { indicator.textContent = ''; updateX01Display(); }, 2000);
            expressionStr = '';
            clearInput();
            return;
        }
    }
    expressionStr = '';
    remainingMode = false;
    // Drop the live preview immediately — paths that end the leg return
    // early, so the projected number must not outlive the entry.
    updateLivePreview();

    if (score < 0 || score > 180) {
        const indicator = document.getElementById('finishIndicator');
        indicator.textContent = 'Invalid score (max 180)';
        indicator.style.color = 'var(--color-danger)';
        setTimeout(() => { indicator.textContent = ''; }, 2000);
        clearInput();
        return;
    }

    saveGameState();

    const thrower = activeThrowerName();
    const player = game.players[game.currentPlayer];

    if (isCountUpGame()) {
        submitCountUpScore(score, opts, player, thrower);
        return;
    }
    if (isGotchaGame()) {
        submitGotchaScore(score, opts, player, thrower);
        return;
    }
    if (isSharkTankGame()) {
        submitSharkTankScore(score, opts, player, thrower);
        return;
    }

    const newScore = player.score - score;

    // X01 rules at the dart-segment level (Double-In / Double-Out / what
    // counts as a finish) can't be enforced from a turn total — the app
    // sees a single number, not which segments were hit. The player is
    // responsible for following the rules. The only check we still apply
    // is the one that's purely arithmetic: you can't subtract more than
    // you have left (newScore would go negative). That's a mathematical
    // bust, not a rules call.
    if (newScore < 0) {
        player.history.push(makeHistoryEntry(score, true, thrower));

        const indicator = document.getElementById('finishIndicator');
        indicator.textContent = `BUST! ${score} > ${player.score} remaining`;
        indicator.style.color = 'var(--color-danger)';
        setTimeout(() => { indicator.textContent = ''; updateX01Display(); }, 2500);

        // 121: a bust still consumes 3 darts from the player's allotment.
        if (game.game121) {
            game.game121.dartsThrown += 3;
            if (game.game121.dartsThrown >= game.game121.dartsPerLeg) {
                handle121LegEnd(false);
                return;
            }
        }

        clearInput();
        if (game.teamMode) advanceRotation(game.currentPlayer);
        game.currentPlayer = (game.currentPlayer + 1) % game.players.length;
        if (game.currentPlayer === 0) game.completedRounds++;
        saveActiveGame();
        updateX01Display();
        updateUndoRedoButtons();
        return;
    }

    // BUG FIX: newScore === 0 is ALWAYS a win. Trust the player.
    // Apply score
    player.score = newScore;
    player.history.push(makeHistoryEntry(score, false, thrower, !!opts.miss));

    // Handle 121 game dart counting + round tallies (180s, 100+, etc.)
    if (game.game121) {
        game.game121.dartsThrown += 3;
        record121Round(score);
    }

    // Win check
    if (player.score === 0) {
        if (game.game121) {
            handle121LegEnd(true, score);
            return;
        }
        saveActiveGame();
        showWinner(player.name);
        return;
    }

    // 121 game: check if darts ran out
    if (game.game121 && game.game121.dartsThrown >= game.game121.dartsPerLeg) {
        handle121LegEnd(false);
        return;
    }

    clearInput();
    if (game.teamMode) advanceRotation(game.currentPlayer);
    game.currentPlayer = (game.currentPlayer + 1) % game.players.length;
    if (game.currentPlayer === 0) game.completedRounds++;

    saveActiveGame();
    updateX01Display();
    updateUndoRedoButtons();
}

// --- Score History Rendering ---

function renderX01ScoreHistory() {
    const numPlayers = game.players.length;
    const x01Main = document.getElementById('x01Main');
    const scoreMatchOver = isCountUpGame()
        && game.completedRounds >= (game.countUp.totalRounds || 8);

    x01Main.classList.remove('three-player', 'four-player');
    if (numPlayers === 3) x01Main.classList.add('three-player');
    else if (numPlayers === 4) x01Main.classList.add('four-player');

    const p1Col = document.getElementById('p1HistoryCol');
    const p2Col = document.getElementById('p2HistoryCol');
    const roundCol = document.getElementById('roundNumCol');
    const p3Col = document.getElementById('p3HistoryCol');
    const p4Col = document.getElementById('p4HistoryCol');

    // Column visibility based on player count
    // Layout: 1 | Round | 2  (2-player)
    //          1 | 2 | Round | 3  (3-player)
    //          1 | 2 | Round | 3 | 4  (4-player)
    if (numPlayers === 1) {
        p2Col.style.display = 'none';
        p3Col.style.display = 'none';
        p4Col.style.display = 'none';
    } else if (numPlayers === 2) {
        p2Col.style.display = 'none';
        p3Col.style.display = 'flex';
        p4Col.style.display = 'none';
    } else if (numPlayers === 3) {
        p2Col.style.display = 'flex';
        p3Col.style.display = 'flex';
        p4Col.style.display = 'none';
    } else if (numPlayers === 4) {
        p2Col.style.display = 'flex';
        p3Col.style.display = 'flex';
        p4Col.style.display = 'flex';
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
        const isCurrent = !scoreMatchOver
            && r === maxRounds
            && game.players[game.currentPlayer].history.length < maxRounds;
        roundHtml += `<div class="round-number${isCurrent ? ' current' : ''}">${r}</div>`;
    }
    if (!scoreMatchOver && game.players[game.currentPlayer].history.length === maxRounds) {
        roundHtml += `<div class="round-number current">${maxRounds + 1}</div>`;
    }
    roundCol.innerHTML = roundHtml;

    // Build player columns
    const buildPlayerColumn = (playerIndex, isLeft) => {
        const player = game.players[playerIndex];
        if (!player) return '';

        let html = '';
        const totalRounds = !scoreMatchOver
            && game.players[game.currentPlayer].history.length === maxRounds
            ? maxRounds + 1
            : maxRounds;

        for (let r = 0; r < totalRounds; r++) {
            const entry = player.history[r];
            const isCurrent = !scoreMatchOver
                && r === player.history.length
                && game.currentPlayer === playerIndex;
            const arrow = isCurrent && isLeft ? ' ◄' : (isCurrent && !isLeft ? '► ' : '');

            if (entry !== undefined) {
                const scoreVal = typeof entry === 'object' ? entry.score : entry;
                const isBust = typeof entry === 'object' && entry.bust;
                const isMiss = typeof entry === 'object' && entry.miss;
                // Distinct symbols: miss = ⊘ (circle-slash), bust = ✖
                let cellText = scoreVal;
                let cellClass = '';
                if (isBust) { cellText = '✖ BUST'; cellClass = ' bust'; }
                else if (isMiss) { cellText = '⊘ MISS'; cellClass = ' miss'; }
                html += `<div class="score-history-entry${cellClass}">${isLeft ? '' : arrow}${cellText}${isLeft ? arrow : ''}</div>`;
            } else if (isCurrent) {
                html += `<div class="score-history-entry current">${isLeft ? '' : arrow}--${isLeft ? arrow : ''}</div>`;
            } else {
                html += `<div class="score-history-entry"></div>`;
            }
        }
        return html;
    };

    // Assign columns based on player count
    // Layout matches header: 1 | [2] | Round | 3 | [4]
    p1Col.innerHTML = buildPlayerColumn(0, true);
    if (numPlayers === 2) {
        p3Col.innerHTML = buildPlayerColumn(1, false);
    } else if (numPlayers === 3) {
        p2Col.innerHTML = buildPlayerColumn(1, true);
        p3Col.innerHTML = buildPlayerColumn(2, false);
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
    if (isAdditiveScoreGame()) {
        suggestionEl.style.display = 'none';
        return;
    }
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

    // Open finish — any single segment 1-20 or 25/50 is a legal last dart.
    if (finishType === 'open' && score <= 180 && score > 0) {
        if (score <= 20) {
            suggestionEl.textContent = `Finish: ${score}`;
        } else if (score === 25 || score === 50) {
            suggestionEl.textContent = score === 50 ? 'Finish: Bull' : 'Finish: 25';
        } else if (score <= 60) {
            suggestionEl.textContent = `Finish: T${Math.ceil(score / 3)} or similar`;
        } else if (score <= 80) {
            suggestionEl.textContent = `T20 + ${score - 60}`;
        } else if (score <= 120) {
            const remainder = score - 60;
            suggestionEl.textContent = remainder <= 60
                ? `T20 + T${Math.ceil(remainder / 3)} (or similar)`
                : `Score ${score} to win`;
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
    const displayScore = index => isSharkTankGame()
        ? Math.max(0, 6 - (game.sharkTank.bites[index] || 0))
        : game.players[index].score;

    // Update scores in header
    document.getElementById('homeScore').textContent = displayScore(0);
    document.getElementById('awayScore').textContent = numPlayers >= 2 ? displayScore(1) : 0;
    if (numPlayers >= 3) document.getElementById('player3Score').textContent = displayScore(2);
    if (numPlayers >= 4) document.getElementById('player4Score').textContent = displayScore(3);

    // Hide MPR displays in X01 (not relevant)
    const mprIds = ['homeMPR', 'homeMPR2', 'awayMPR', 'awayMPR2', 'player3MPR', 'player3MPR2', 'player4MPR', 'player4MPR2'];
    mprIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    // Update round badge
    updateRoundBadge();

    // Update finish indicator
    const finishIndicator = document.getElementById('finishIndicator');
    const currentPlayer = game.players[game.currentPlayer];
    const finishType = game.finishType || 'open';

    if (isCountUpGame()) {
        const totalRounds = game.countUp.totalRounds || 8;
        const round = Math.min(game.completedRounds + 1, totalRounds);
        finishIndicator.textContent = `ROUND ${round} OF ${totalRounds} — ENTER 3-DART TOTAL`;
        finishIndicator.style.color = 'var(--color-primary-light)';
    } else if (isGotchaGame()) {
        const needed = (game.gotcha.target || 301) - currentPlayer.score;
        finishIndicator.textContent = `${needed} TO 301 — MATCH A RIVAL TO BOMB THEM`;
        finishIndicator.style.color = 'var(--color-warning)';
    } else if (isSharkTankGame()) {
        const bites = game.sharkTank.bites[game.currentPlayer] || 0;
        finishIndicator.textContent = `ROUND ${game.sharkTank.round} — ${6 - bites} BITES LEFT — BULLS SCORE 0`;
        finishIndicator.style.color = bites >= 4 ? 'var(--color-danger)' : 'var(--color-primary-light)';
    } else if (game.game121) {
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
    updateLivePreview();
}

// --- Event Listener Setup ---

// Safe element event binding
function onEl(id, event, handler) {
    const el = document.getElementById(id);
    if (el) el.addEventListener(event, handler);
}

function initX01Controls() {
    // Scoring buttons use pointerdown so they fire the instant the finger
    // lands — bypasses click's scroll-disambiguation delay.
    const bindDown = (btn, fn) => {
        btn.addEventListener('pointerdown', (e) => { e.preventDefault(); fn(); });
    };

    // Digit buttons
    document.querySelectorAll('[data-digit]').forEach(btn => {
        bindDown(btn, () => addDigit(btn.dataset.digit));
    });

    // Operator buttons (× and +)
    document.querySelectorAll('[data-op]').forEach(btn => {
        bindDown(btn, () => addOperator(btn.dataset.op));
    });

    // Quick score buttons
    document.querySelectorAll('[data-quick]').forEach(btn => {
        bindDown(btn, () => quickScore(parseInt(btn.dataset.quick)));
    });

    // Control buttons
    const enterEl = document.getElementById('x01EnterBtn');
    if (enterEl) bindDown(enterEl, submitScore);
    const missEl = document.getElementById('x01MissBtn');
    if (missEl) bindDown(missEl, x01Miss);
    const bustEl = document.getElementById('x01BustBtn');
    if (bustEl) bindDown(bustEl, x01Bust);

    // Active-score replacement supports both natural workflows:
    //   1. Type what's LEFT, then tap the current score to replace it now.
    //   2. Tap the current score first, type what's LEFT, then press ENTER.
    // Non-active headers and additive score games are ignored.
    ['homeScore', 'awayScore', 'player3Score', 'player4Score'].forEach((id, idx) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('pointerdown', (e) => {
            const controls = document.getElementById('x01Controls');
            if (!controls || controls.classList.contains('hidden')) return;
            if (isAdditiveScoreGame()) return;
            if (idx !== game.currentPlayer) return;
            e.preventDefault();
            if (expressionStr.length > 0) {
                remainingMode = true;
                submitScore();
            } else {
                toggleRemainingMode();
            }
        });
    });

    // Undo/Redo (Undo also acts as Back — clears input first, then undoes last action)
    onEl('undoBtnX01', 'click', () => {
        if (expressionStr.length > 0) {
            clearInput();
        } else {
            undoWithCooldown(() => {
                updateX01Display();
                updateUndoRedoButtons();
                clearInput();
            });
        }
    });

    onEl('redoBtnX01', 'click', () => {
        redoWithCooldown(() => {
            updateX01Display();
            updateUndoRedoButtons();
            clearInput();
        });
    });

    // Initialize Miss/Enter visibility
    updateMissEnterVisibility();
}

export { updateX01Display, initX01Controls, submitScore, clearInput, resetX01Input };
