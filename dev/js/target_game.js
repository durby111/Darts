/* ============================================
   Target Game UI Controller
   Shared front-end for Baseball + Bermuda Triangle.

   Per turn:
   - Player throws 3 darts.
   - Taps Single / Double / Triple for each dart that hit.
   - "This turn" total accumulates as they tap.
   - END TURN applies the total to the active player's score and
     hands off via the game module (baseball.js / bermuda.js).

   CLEAR resets the in-progress turn. UNDO rolls back the last hit.
   ============================================ */

import { game, saveActiveGame } from './state.js';
import { updatePlayerHeaders } from './ui.js';
import {
    currentTarget as bbTarget,
    describeHitButtons as bbButtons,
    commitTurn as bbCommit
} from './baseball.js';
import {
    currentTarget as bmTarget,
    describeHitButtons as bmButtons,
    pointsForHit as bmPoints,
    commitTurn as bmCommit
} from './bermuda.js';

let onChange = null;          // updateDisplay callback from app.js
let turnHits = [];            // [{ kind: 'single'|'double'|'triple', points }]

function isBaseball() { return game.type === 'baseball' && !!game.baseball; }
function isBermuda() { return game.type === 'bermuda' && !!game.bermuda; }

function currentTarget() {
    if (isBaseball()) return bbTarget();
    if (isBermuda()) return bmTarget();
    return null;
}

function describeButtons() {
    if (isBaseball()) return bbButtons();
    if (isBermuda()) return bmButtons();
    return { single: 'Single', double: 'Double', triple: 'Triple', tripleEnabled: true };
}

function pointsFor(kind) {
    if (isBaseball()) {
        // 1/2/3 runs per hit, regardless of inning target.
        return kind === 'triple' ? 3 : kind === 'double' ? 2 : 1;
    }
    if (isBermuda()) return bmPoints(kind);
    return 0;
}

function turnTotal() {
    return turnHits.reduce((sum, h) => sum + h.points, 0);
}

function clearTurn() {
    turnHits = [];
}

function applyHit(kind) {
    const buttons = describeButtons();
    if (kind === 'triple' && buttons.tripleEnabled === false) return;
    if (kind === 'double' && buttons.doubleEnabled === false) return;
    const points = pointsFor(kind);
    turnHits.push({ kind, points });
    refresh();
}

function undoHit() {
    if (!turnHits.length) return;
    turnHits.pop();
    refresh();
}

function endTurn() {
    const total = turnTotal();
    const anyHit = turnHits.length > 0;
    let result = { matchOver: false };
    if (isBaseball()) {
        result = bbCommit(total);
    } else if (isBermuda()) {
        result = bmCommit(total, anyHit);
    }
    clearTurn();
    saveActiveGame();
    if (result.matchOver) return;     // ui.js winner modal will take it from here
    if (onChange) onChange();
}

export function initTargetGameControls(updateDisplay) {
    onChange = updateDisplay;
    document.querySelectorAll('[data-hit]').forEach(btn => {
        btn.addEventListener('pointerdown', e => {
            e.preventDefault();
            applyHit(btn.dataset.hit);
        });
    });
    const undoBtn = document.getElementById('targetUndoBtn');
    if (undoBtn) undoBtn.addEventListener('pointerdown', e => { e.preventDefault(); undoHit(); });
    const clearBtn = document.getElementById('targetClearBtn');
    if (clearBtn) clearBtn.addEventListener('pointerdown', e => { e.preventDefault(); clearTurn(); refresh(); });
    const endBtn = document.getElementById('targetEndTurnBtn');
    if (endBtn) endBtn.addEventListener('pointerdown', e => { e.preventDefault(); endTurn(); });
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

    // Per-game hint line
    const hint = document.getElementById('targetHint');
    if (hint) {
        if (isBaseball()) {
            hint.textContent = target && target.value === 'Bull'
                ? 'Inning 7 stretch — hit the bullseye. Outer = 1 run, inner (50) = 2 runs.'
                : 'Hit the inning number. Single = 1 run, Double = 2, Triple = 3.';
        } else if (isBermuda()) {
            if (!target) {
                hint.textContent = '';
            } else if (target.kind === 'ring') {
                hint.textContent = `Score on the ${target.label} ring. Each hit scores the (double or triple) face value × multiplier.`;
            } else if (target.kind === 'bull') {
                hint.textContent = 'Bullseye stage — outer = 25, inner = 50. Miss all 3 and your score halves.';
            } else {
                hint.textContent = `Score on ${target.label}. Single = ${target.value}, Double = ${target.value * 2}, Triple = ${target.value * 3}.`;
            }
        }
    }

    setLabel('hitSingleBtn', buttons.single, buttons.singleEnabled !== false);
    setLabel('hitDoubleBtn', buttons.double, buttons.doubleEnabled !== false);
    setLabel('hitTripleBtn', buttons.triple, buttons.tripleEnabled !== false);

    setText('targetTurnScore', String(turnTotal()));
    const undoBtn = document.getElementById('targetUndoBtn');
    if (undoBtn) undoBtn.disabled = !turnHits.length;

    updatePlayerHeaders();

    // Headers display the running score in #*Score; updatePlayerHeaders only
    // handles names + active state, so write the score totals here.
    const numPlayers = game.players.length;
    setText('homeScore', String(game.players[0].score));
    if (numPlayers >= 2) setText('awayScore', String(game.players[1].score));
    if (numPlayers >= 3) setText('player3Score', String(game.players[2].score));
    if (numPlayers >= 4) setText('player4Score', String(game.players[3].score));
}

// Public: app.js calls this on initial mount / after game state changes.
export function updateTargetGameDisplay() {
    refresh();
}
