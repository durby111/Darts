/* ============================================
   App Entry Point
   Screen routing, display dispatcher, PWA
   ============================================ */

import { game, undoWithCooldown, redoWithCooldown } from './state.js';
import { updateUndoRedoButtons, updatePlayerHeaders, showModal, hideModal } from './ui.js';
import { updateCricketDisplay, initCricketControls } from './cricket.js';
import { updateX01Display, initX01Controls, clearInput } from './x01.js';
import { initChicagoControls } from './chicago.js';
import { initSetupControls, setGameStartCallback, showSetup, playAgain } from './setup.js';

// --- Master Display Updater ---

function updateDisplay() {
    const effectiveType = game.chicago ? game.chicago.currentGameType : game.type;
    const isCricket = ['cricket', 'spanish', 'minnesota'].includes(effectiveType);

    // Show/hide game areas
    document.getElementById('cricketMain').classList.toggle('hidden', !isCricket);
    document.getElementById('x01Main').classList.toggle('hidden', isCricket);
    document.getElementById('cricketControls').classList.toggle('hidden', !isCricket);
    document.getElementById('x01Controls').classList.toggle('hidden', isCricket);

    if (isCricket) {
        updateCricketDisplay();
    } else {
        updateX01Display();
    }

    updateUndoRedoButtons();
}

// --- Game Start Callback ---

setGameStartCallback(() => {
    updateDisplay();
    updateUndoRedoButtons();
});

// --- Score Keypad Modal (Minnesota) ---

let keypadInput = '';
let keypadTarget = '';

function initKeypadControls() {
    // Listen for showScoreKeypad events from cricket.js
    document.addEventListener('showScoreKeypad', (e) => {
        keypadTarget = e.detail.target;
        keypadInput = '';
        document.getElementById('scoreKeypadTitle').textContent = `Enter Score for ${keypadTarget}`;
        document.getElementById('keypadDisplay').textContent = '0';
        showModal('scoreKeypadModal');
    });

    // Keypad buttons
    document.querySelectorAll('[data-keypad]').forEach(btn => {
        btn.addEventListener('click', () => {
            const val = btn.dataset.keypad;
            if (val === 'CLR') {
                keypadInput = '';
                document.getElementById('keypadDisplay').textContent = '0';
            } else if (val === 'OK') {
                const scoreValue = parseInt(keypadInput) || 0;
                if (scoreValue < 0 || scoreValue > 180) return;

                game.pendingDarts.push({
                    target: keypadTarget,
                    multiplier: 1,
                    specialScore: scoreValue
                });

                hideModal('scoreKeypadModal');
                keypadInput = '';
                keypadTarget = '';
                updateDisplay();
            } else {
                keypadInput += val;
                if (parseInt(keypadInput) > 180) keypadInput = '180';
                document.getElementById('keypadDisplay').textContent = keypadInput || '0';
            }
        });
    });

    document.getElementById('keypadCancelBtn').addEventListener('click', () => {
        hideModal('scoreKeypadModal');
        keypadInput = '';
        keypadTarget = '';
    });
}

// --- Game Menu ---

function initGameMenuControls() {
    document.getElementById('menuBtn').addEventListener('click', () => {
        // Update redo button visibility
        const redoBtn = document.getElementById('gameMenuRedoBtn');
        redoBtn.style.display = game.redoHistory && game.redoHistory.length > 0 ? 'block' : 'none';
        showModal('gameMenuModal');
    });

    document.getElementById('gameMenuUndoBtn').addEventListener('click', () => {
        hideModal('gameMenuModal');
        undoWithCooldown(() => {
            updateDisplay();
            updateUndoRedoButtons();
            // Update X01 input if needed
            const effectiveType = game.chicago ? game.chicago.currentGameType : game.type;
            if (!['cricket', 'spanish', 'minnesota'].includes(effectiveType)) {
                document.getElementById('inputDisplay').textContent = game.currentInput || '0';
            }
        });
    });

    document.getElementById('gameMenuRedoBtn').addEventListener('click', () => {
        hideModal('gameMenuModal');
        redoWithCooldown(() => {
            updateDisplay();
            updateUndoRedoButtons();
        });
    });

    document.getElementById('gameMenuResumeBtn').addEventListener('click', () => {
        hideModal('gameMenuModal');
    });

    document.getElementById('gameMenuNewGameBtn').addEventListener('click', () => {
        hideModal('gameMenuModal');
        playAgain();
    });

    document.getElementById('gameMenuExitBtn').addEventListener('click', () => {
        hideModal('gameMenuModal');
        showSetup();
    });
}

// --- Winner Modal ---

function initWinnerModalControls() {
    document.getElementById('winnerCancelBtn').addEventListener('click', () => {
        hideModal('winnerModal');
        // Undo the winning action instead of leaving corrupted state
        undoWithCooldown(() => {
            updateDisplay();
            updateUndoRedoButtons();
        });
    });

    document.getElementById('playAgainBtn').addEventListener('click', () => {
        playAgain();
    });

    document.getElementById('newGameBtn').addEventListener('click', () => {
        showSetup();
    });
}

// --- Chicago Events ---

function initChicagoEvents() {
    document.addEventListener('chicagoLegReady', () => {
        updateDisplay();
        updateUndoRedoButtons();
    });
}

// --- 121 Game Events ---

function initGame121Events() {
    document.addEventListener('game121LegReady', () => {
        updateDisplay();
        updateUndoRedoButtons();
    });
}

// --- Undo/Redo for Cricket (global buttons) ---

function initGlobalUndoRedo() {
    document.getElementById('undoBtn').addEventListener('click', () => {
        undoWithCooldown(() => {
            updateDisplay();
            updateUndoRedoButtons();
        });
    });

    document.getElementById('redoBtn').addEventListener('click', () => {
        redoWithCooldown(() => {
            updateDisplay();
            updateUndoRedoButtons();
        });
    });
}

// --- PWA Service Worker ---

function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(() => {
            // Service worker registration failed — app still works without it
        });
    }
}

// --- Init ---

document.addEventListener('DOMContentLoaded', () => {
    initSetupControls();
    initCricketControls();
    initX01Controls();
    initChicagoControls();
    initKeypadControls();
    initGameMenuControls();
    initWinnerModalControls();
    initChicagoEvents();
    initGame121Events();
    initGlobalUndoRedo();
    registerServiceWorker();
});
