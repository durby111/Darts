/* ============================================
   App Entry Point
   Screen routing, display dispatcher, PWA
   ============================================ */

import { game, undoWithCooldown, redoWithCooldown, saveActiveGame, clearActiveGame } from './state.js';
import { updateUndoRedoButtons, updatePlayerHeaders, showModal, hideModal } from './ui.js';
import { updateCricketDisplay, initCricketControls } from './cricket.js';
import { updateX01Display, initX01Controls, clearInput } from './x01.js';
import { initChicagoControls } from './chicago.js';
import { initSetupControls, setGameStartCallback, showSetup, showSetupAsOverlay, playAgain } from './setup.js';

// --- Safe element helper ---
function on(id, event, handler) {
    const el = document.getElementById(id);
    if (el) {
        el.addEventListener(event, handler);
    }
}

// --- Master Display Updater ---

function updateDisplay() {
    const effectiveType = game.chicago ? game.chicago.currentGameType : game.type;
    const isCricket = ['cricket', 'spanish', 'minnesota'].includes(effectiveType);

    // Show/hide game areas
    const cricketMain = document.getElementById('cricketMain');
    cricketMain.classList.toggle('hidden', !isCricket);
    cricketMain.classList.toggle('minnesota-layout', effectiveType === 'minnesota');
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
    document.addEventListener('showScoreKeypad', (e) => {
        keypadTarget = e.detail.target;
        keypadInput = '';
        document.getElementById('scoreKeypadTitle').textContent = `Enter Score for ${keypadTarget}`;
        document.getElementById('keypadDisplay').textContent = '0';
        showModal('scoreKeypadModal');
    });

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

    on('keypadCancelBtn', 'click', () => {
        hideModal('scoreKeypadModal');
        keypadInput = '';
        keypadTarget = '';
    });
}

// --- Game Menu ---

function initGameMenuControls() {
    on('menuBtn', 'click', () => {
        const redoBtn = document.getElementById('gameMenuRedoBtn');
        if (redoBtn) redoBtn.style.display = game.redoHistory && game.redoHistory.length > 0 ? 'block' : 'none';
        showModal('gameMenuModal');
    });

    on('gameMenuUndoBtn', 'click', () => {
        hideModal('gameMenuModal');
        undoWithCooldown(() => {
            updateDisplay();
            updateUndoRedoButtons();
            const effectiveType = game.chicago ? game.chicago.currentGameType : game.type;
            if (!['cricket', 'spanish', 'minnesota'].includes(effectiveType)) {
                const inputEl = document.getElementById('inputDisplay');
                if (inputEl) inputEl.textContent = game.currentInput || '0';
            }
        });
    });

    on('gameMenuRedoBtn', 'click', () => {
        hideModal('gameMenuModal');
        redoWithCooldown(() => {
            updateDisplay();
            updateUndoRedoButtons();
        });
    });

    on('gameMenuResumeBtn', 'click', () => {
        hideModal('gameMenuModal');
    });

    on('gameMenuNewGameBtn', 'click', () => {
        hideModal('gameMenuModal');
        playAgain();
    });

    on('gameMenuSettingsBtn', 'click', () => {
        hideModal('gameMenuModal');
        // Save game and show setup as overlay — game stays alive underneath
        saveActiveGame();
        showSetupAsOverlay();
    });

    on('gameMenuExitBtn', 'click', () => {
        hideModal('gameMenuModal');
        clearActiveGame();
        showSetup();
    });

    on('gameMenuUpdateBtn', 'click', async () => {
        const btn = document.getElementById('gameMenuUpdateBtn');
        if (btn) {
            btn.textContent = 'Updating...';
            btn.disabled = true;
        }
        try {
            if ('caches' in window) {
                const keys = await caches.keys();
                await Promise.all(keys.map(k => caches.delete(k)));
            }
            if ('serviceWorker' in navigator) {
                const reg = await navigator.serviceWorker.getRegistration();
                if (reg) {
                    await reg.update();
                    if (reg.waiting) reg.waiting.postMessage('skipWaiting');
                }
            }
            setTimeout(() => window.location.reload(true), 300);
        } catch (e) {
            if (btn) {
                btn.textContent = 'Update failed';
                btn.disabled = false;
            }
        }
    });
}

// --- Winner Modal ---

function initWinnerModalControls() {
    on('winnerCancelBtn', 'click', () => {
        hideModal('winnerModal');
        undoWithCooldown(() => {
            updateDisplay();
            updateUndoRedoButtons();
        });
    });

    on('playAgainBtn', 'click', () => {
        playAgain();
    });

    on('newGameBtn', 'click', () => {
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
    // pointerdown matches the rest of the touch-optimized buttons so a tap
    // never gets eaten by scroll-disambiguation or a stray pointerup.
    on('undoBtn', 'pointerdown', (e) => {
        e.preventDefault();
        undoWithCooldown(() => {
            updateDisplay();
            updateUndoRedoButtons();
        });
    });

    on('redoBtn', 'pointerdown', (e) => {
        e.preventDefault();
        redoWithCooldown(() => {
            updateDisplay();
            updateUndoRedoButtons();
        });
    });
}

// --- PWA Service Worker ---

function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    // Reload exactly once when a new SW takes control — standard pattern,
    // avoids multi-tab reload loops from per-tab statechange handlers.
    let reloadedOnce = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloadedOnce) return;
        reloadedOnce = true;
        window.location.reload();
    });

    navigator.serviceWorker.register('./sw.js').then(reg => {
        reg.update().catch(() => {});
        if (reg.waiting) reg.waiting.postMessage('skipWaiting');
        reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            if (!newWorker) return;
            newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                    // New SW installed alongside an existing one — activate it.
                    newWorker.postMessage('skipWaiting');
                }
            });
        });
    }).catch(() => {});
}

function initUpdateButton() {
    const btn = document.getElementById('updateAppBtn');
    const status = document.getElementById('updateStatus');
    if (!btn) return;

    btn.addEventListener('click', async () => {
        if (status) status.textContent = 'Checking for updates...';
        btn.disabled = true;

        try {
            // Unregister service worker entirely for clean slate
            if ('serviceWorker' in navigator) {
                const registrations = await navigator.serviceWorker.getRegistrations();
                for (const reg of registrations) {
                    await reg.unregister();
                }
            }
            // Clear all caches
            if ('caches' in window) {
                const keys = await caches.keys();
                await Promise.all(keys.map(k => caches.delete(k)));
            }
            if (status) status.textContent = 'Reloading with latest version...';
            setTimeout(() => window.location.reload(true), 300);
        } catch (e) {
            if (status) status.textContent = 'Update failed. Try refreshing the page.';
            btn.disabled = false;
        }
    });
}

// --- Init with error isolation ---

function safeInit(name, fn) {
    try {
        fn();
    } catch (e) {
        console.error(`[BlakeOut] ${name} failed:`, e);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    safeInit('setup', initSetupControls);
    safeInit('cricket', initCricketControls);
    safeInit('x01', initX01Controls);
    safeInit('chicago', initChicagoControls);
    safeInit('keypad', initKeypadControls);
    safeInit('gameMenu', initGameMenuControls);
    safeInit('winnerModal', initWinnerModalControls);
    safeInit('chicagoEvents', initChicagoEvents);
    safeInit('game121Events', initGame121Events);
    safeInit('undoRedo', initGlobalUndoRedo);
    safeInit('serviceWorker', registerServiceWorker);
    safeInit('updateButton', initUpdateButton);
});

// Save game on page unload (refresh, close, update)
window.addEventListener('beforeunload', () => {
    if (game.players.length > 0) {
        saveActiveGame();
    }
});
