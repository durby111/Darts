/* ============================================
   Target Game UI Controller
   Shared front-end for Baseball + Bermuda Triangle.

   Per turn:
   - Player has up to 3 darts. Each scoring dart taps Single / Double /
     Triple. Misses just aren't recorded; CLEAR resets the in-progress
     turn. UNDO removes the last hit; if no in-progress hits, UNDO
     rolls back the previous turn via the state.js snapshot stack.
   - END TURN commits the score for the active player.

   On Bermuda's Doubles/Triples rings, hits open a number picker modal
   so the player records the actual face value (single dart still counts
   for one hit in the 3-dart budget).
   ============================================ */

import { game, saveGameState, undoLastAction, saveActiveGame } from './state.js';
import { updatePlayerHeaders, showModal, hideModal } from './ui.js';
import {
    currentTarget as bbTarget,
    describeHitButtons as bbButtons,
    commitTurn as bbCommit
} from './baseball.js';
import {
    currentTarget as bmTarget,
    describeHitButtons as bmButtons,
    commitTurn as bmCommit
} from './bermuda.js';
import {
    currentTarget as golfTarget,
    describeHitButtons as golfButtons,
    pointsForHit as golfPoints,
    missPenalty as golfMissPenalty,
    commitTurn as golfCommit
} from './golf.js';

const DARTS_PER_TURN = 3;

let onChange = null;
let turnHits = [];            // [{ kind, points }]

function isBaseball() { return game.type === 'baseball' && !!game.baseball; }
function isBermuda() { return game.type === 'bermuda' && !!game.bermuda; }
function isGolf() { return game.type === 'golf' && !!game.golf; }

function currentTarget() {
    if (isBaseball()) return bbTarget();
    if (isBermuda()) return bmTarget();
    if (isGolf()) return golfTarget();
    return null;
}

function describeButtons() {
    if (isBaseball()) return bbButtons();
    if (isBermuda()) return bmButtons();
    if (isGolf()) return golfButtons();
    return { single: 'Single', double: 'Double', triple: 'Triple', tripleEnabled: true };
}

function pointsForBaseball(kind) {
    return kind === 'triple' ? 3 : kind === 'double' ? 2 : 1;
}

function pointsForBermudaNumber(target, kind, faceValue) {
    if (!target) return 0;
    if (target.kind === 'ring') {
        const mult = target.value === 'D' ? 2 : 3;
        return mult * faceValue;
    }
    if (target.kind === 'number') {
        if (kind === 'triple') return target.value * 3;
        if (kind === 'double') return target.value * 2;
        return target.value;
    }
    if (target.kind === 'bull') {
        if (target.value === 25) return kind === 'double' ? 50 : 25;
        if (target.value === 'BULL') return 50;
    }
    return 0;
}

function turnTotal() {
    const hitSum = turnHits.reduce((sum, h) => sum + h.points, 0);
    if (isGolf()) {
        // Unhit dart slots count as misses in golf — fold them into the
        // displayed and committed total so the player sees the full
        // stroke cost (or stableford yield) before tapping END TURN.
        const misses = DARTS_PER_TURN - turnHits.length;
        return hitSum + misses * golfMissPenalty();
    }
    return hitSum;
}

function clearTurn() {
    turnHits = [];
}

function dartsUsed() { return turnHits.length; }

function recordHit(kind, points) {
    if (dartsUsed() >= DARTS_PER_TURN) return;
    turnHits.push({ kind, points });
    refresh();
}

function applyHit(kind) {
    if (dartsUsed() >= DARTS_PER_TURN) return;
    const buttons = describeButtons();
    if (kind === 'triple' && buttons.tripleEnabled === false) return;
    if (kind === 'double' && buttons.doubleEnabled === false) return;

    if (isBermuda()) {
        const t = currentTarget();
        if (t && t.kind === 'ring') {
            // Open face-value picker. Multiplier is implicit (D=×2, T=×3).
            openBermudaFacePicker(t);
            return;
        }
        const points = pointsForBermudaNumber(t, kind, t && t.kind === 'number' ? t.value : 0);
        recordHit(kind, points);
        return;
    }

    if (isBaseball()) {
        recordHit(kind, pointsForBaseball(kind));
        return;
    }

    if (isGolf()) {
        recordHit(kind, golfPoints(kind));
    }
}

function undoBtnAction() {
    if (turnHits.length > 0) {
        turnHits.pop();
        refresh();
        return;
    }
    // No in-turn hits — try rolling back the previous committed turn.
    undoLastAction(() => {
        refresh();
    });
}

function endTurn() {
    saveGameState();   // snapshot for cross-turn UNDO
    const total = turnTotal();
    const anyHit = turnHits.length > 0;
    let result = { matchOver: false };
    if (isBaseball()) {
        result = bbCommit(total);
    } else if (isBermuda()) {
        result = bmCommit(total, anyHit);
    } else if (isGolf()) {
        result = golfCommit(total);
    }
    clearTurn();
    saveActiveGame();
    if (result.matchOver) return;
    if (onChange) onChange();
}

// --- Bermuda face-value picker ---

let pendingFaceTarget = null;

function openBermudaFacePicker(target) {
    pendingFaceTarget = target;
    const grid = document.getElementById('bermudaFacePickerGrid');
    if (grid) {
        const numbers = [];
        for (let i = 1; i <= 20; i++) numbers.push(i);
        grid.innerHTML = numbers.map(n => `<button data-face="${n}">${n}</button>`).join('');
    }
    const title = document.getElementById('bermudaFacePickerTitle');
    if (title) {
        title.textContent = target.value === 'D'
            ? 'Pick the number you doubled'
            : 'Pick the number you tripled';
    }
    showModal('bermudaFacePickerModal');
}

function chooseFaceValue(face) {
    if (!pendingFaceTarget) {
        hideModal('bermudaFacePickerModal');
        return;
    }
    const points = pointsForBermudaNumber(pendingFaceTarget, 'single', face);
    const kindLabel = pendingFaceTarget.value === 'D' ? 'double' : 'triple';
    recordHit(kindLabel, points);
    pendingFaceTarget = null;
    hideModal('bermudaFacePickerModal');
}

// --- Init / refresh ---

export function initTargetGameControls(updateDisplay) {
    onChange = updateDisplay;
    document.querySelectorAll('[data-hit]').forEach(btn => {
        btn.addEventListener('pointerdown', e => {
            e.preventDefault();
            applyHit(btn.dataset.hit);
        });
    });
    const undoBtn = document.getElementById('targetUndoBtn');
    if (undoBtn) undoBtn.addEventListener('pointerdown', e => { e.preventDefault(); undoBtnAction(); });
    const clearBtn = document.getElementById('targetClearBtn');
    if (clearBtn) clearBtn.addEventListener('pointerdown', e => { e.preventDefault(); clearTurn(); refresh(); });
    const endBtn = document.getElementById('targetEndTurnBtn');
    if (endBtn) endBtn.addEventListener('pointerdown', e => { e.preventDefault(); endTurn(); });

    // Bermuda face picker
    const grid = document.getElementById('bermudaFacePickerGrid');
    if (grid) {
        grid.addEventListener('click', e => {
            const btn = e.target.closest('[data-face]');
            if (!btn) return;
            chooseFaceValue(parseInt(btn.dataset.face, 10));
        });
    }
    const cancelFace = document.getElementById('bermudaFacePickerCancelBtn');
    if (cancelFace) cancelFace.addEventListener('click', () => {
        pendingFaceTarget = null;
        hideModal('bermudaFacePickerModal');
    });
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function setLabel(id, text, enabled) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.disabled = enabled === false;
}

function refresh() {
    const target = currentTarget();
    const buttons = describeButtons();
    setText('targetStage', target ? target.label.split(' ')[0] : '—');
    setText('targetValue', target ? String(target.value).replace(/^BULL$/, 'Bull') : '—');

    const hint = document.getElementById('targetHint');
    if (hint) {
        const dartsLeft = DARTS_PER_TURN - dartsUsed();
        const dartsLine = `${dartsLeft} dart${dartsLeft === 1 ? '' : 's'} left this turn.`;
        if (isBaseball()) {
            const ctxLine = target && target.value === 'Bull'
                ? 'Inning 7 stretch — hit the bullseye. Outer = 1 run, inner (50) = 2 runs.'
                : 'Hit the inning number. Single = 1 run, Double = 2, Triple = 3.';
            hint.textContent = `${ctxLine} ${dartsLine}`;
        } else if (isBermuda()) {
            let ctxLine = '';
            if (target && target.kind === 'ring') {
                ctxLine = target.value === 'D'
                    ? 'Doubles ring. Tap "Any Double" for each dart that lands in a double — you\'ll pick the number.'
                    : 'Triples ring. Tap "Any Triple" for each dart that lands in a triple — you\'ll pick the number.';
            } else if (target && target.kind === 'bull') {
                ctxLine = 'Bullseye stage — outer = 25, inner = 50. Miss all 3 and your score halves.';
            } else if (target && target.kind === 'number') {
                ctxLine = `Hit ${target.label}. Single = ${target.value}, Double = ${target.value * 2}, Triple = ${target.value * 3}.`;
            }
            hint.textContent = `${ctxLine} ${dartsLine}`;
        } else if (isGolf()) {
            const stableford = game.golf && game.golf.variant === 'stableford';
            const ctxLine = stableford
                ? `Hit ${target ? target.value : '—'}. Triple = +4 pts, Double = +3, Single = +1, miss = 0. Highest score wins.`
                : `Hit ${target ? target.value : '—'}. Triple = 1 stroke, Double = 2, Single = 3, miss = 5. Lowest score wins.`;
            hint.textContent = `${ctxLine} ${dartsLine}`;
        }
    }

    const noDartsLeft = dartsUsed() >= DARTS_PER_TURN;
    setLabel('hitSingleBtn', buttons.single, buttons.singleEnabled !== false && !noDartsLeft);
    setLabel('hitDoubleBtn', buttons.double, buttons.doubleEnabled !== false && !noDartsLeft);
    setLabel('hitTripleBtn', buttons.triple, buttons.tripleEnabled !== false && !noDartsLeft);

    setText('targetTurnScore', String(turnTotal()));

    const undoBtn = document.getElementById('targetUndoBtn');
    if (undoBtn) {
        const canCrossTurnUndo = turnHits.length === 0 && game.undoHistory && game.undoHistory.length > 0;
        undoBtn.disabled = !turnHits.length && !canCrossTurnUndo;
    }

    updatePlayerHeaders();

    const numPlayers = game.players.length;
    setText('homeScore', String(game.players[0].score));
    if (numPlayers >= 2) setText('awayScore', String(game.players[1].score));
    if (numPlayers >= 3) setText('player3Score', String(game.players[2].score));
    if (numPlayers >= 4) setText('player4Score', String(game.players[3].score));
}

export function updateTargetGameDisplay() {
    clearTurn();          // entering a fresh turn — wipe any stale local state
    refresh();
}
