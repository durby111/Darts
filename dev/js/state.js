/* ============================================
   State Management
   Game state, undo/redo, localStorage configs
   ============================================ */

// Singleton game state
export let game = {
    type: '501',
    players: [],
    currentPlayer: 0,
    currentInput: '',
    cricketPoints: true,
    cricketTargets: [],
    finishType: 'double-out',
    pendingDarts: [],
    completedRounds: 0,
    undoHistory: [],
    redoHistory: [],
    chicago: null,
    game121: null
};

// Undo/Redo cooldown
const BUTTON_COOLDOWN = 500;
let undoCooldown = false;
let redoCooldown = false;

export function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

export function resetGameState(newState) {
    Object.assign(game, newState);
}

// --- Undo/Redo System ---

export function saveGameState() {
    const state = {
        players: deepClone(game.players),
        currentPlayer: game.currentPlayer,
        completedRounds: game.completedRounds,
        pendingDarts: deepClone(game.pendingDarts),
        currentInput: game.currentInput,
        timestamp: Date.now()
    };
    game.undoHistory.push(state);
    game.redoHistory = [];

    // Persist live game to localStorage
    saveActiveGame();
}

export function undoLastAction(onAfterRestore) {
    if (game.undoHistory.length === 0) return;

    const currentState = {
        players: deepClone(game.players),
        currentPlayer: game.currentPlayer,
        completedRounds: game.completedRounds,
        pendingDarts: deepClone(game.pendingDarts),
        currentInput: game.currentInput,
        timestamp: Date.now()
    };
    game.redoHistory.push(currentState);

    const previousState = game.undoHistory.pop();
    game.players = previousState.players;
    game.currentPlayer = previousState.currentPlayer;
    game.completedRounds = previousState.completedRounds;
    game.pendingDarts = previousState.pendingDarts;
    game.currentInput = previousState.currentInput;

    if (onAfterRestore) onAfterRestore();
}

export function redoLastAction(onAfterRestore) {
    if (game.redoHistory.length === 0) return;

    const currentState = {
        players: deepClone(game.players),
        currentPlayer: game.currentPlayer,
        completedRounds: game.completedRounds,
        pendingDarts: deepClone(game.pendingDarts),
        currentInput: game.currentInput,
        timestamp: Date.now()
    };
    game.undoHistory.push(currentState);

    const nextState = game.redoHistory.pop();
    game.players = nextState.players;
    game.currentPlayer = nextState.currentPlayer;
    game.completedRounds = nextState.completedRounds;
    game.pendingDarts = nextState.pendingDarts;
    game.currentInput = nextState.currentInput;

    if (onAfterRestore) onAfterRestore();
}

export function undoWithCooldown(onAfterRestore) {
    if (undoCooldown || game.undoHistory.length === 0) return;
    undoCooldown = true;
    undoLastAction(onAfterRestore);
    setTimeout(() => { undoCooldown = false; }, BUTTON_COOLDOWN);
}

export function redoWithCooldown(onAfterRestore) {
    if (redoCooldown || game.redoHistory.length === 0) return;
    redoCooldown = true;
    redoLastAction(onAfterRestore);
    setTimeout(() => { redoCooldown = false; }, BUTTON_COOLDOWN);
}

export function canUndo() {
    return game.undoHistory.length > 0;
}

export function canRedo() {
    return game.redoHistory.length > 0;
}

// --- Cricket Initialization ---

export function initCricket(type, includeBulls = false) {
    let targets;
    if (type === 'cricket') {
        targets = ['20', '19', '18', '17', '16', '15', 'Bull'];
    } else if (type === 'spanish') {
        targets = includeBulls
            ? ['20', '19', '18', '17', '16', '15', '14', '13', '12', '11', '10', 'Bull']
            : ['20', '19', '18', '17', '16', '15', '14', '13', '12', '11', '10'];
    } else {
        // Minnesota
        targets = ['20', '19', '18', '17', '16', '15', 'Bull', 'Triples', 'Doubles', 'Bed'];
    }

    game.cricketTargets = targets;

    const data = {};
    targets.forEach(t => {
        data[t] = {
            marks: 0,
            closed: false,
            closedInOneTurn: false,
            // marks already on the target at the START of the turn that closed it
            // (0 = closed in one turn, 1 = had a slash, 2 = had an X). Drives the
            // closed-cell rendering: empty O / O-with-slash / O-with-X.
            marksBeforeClose: 0,
            showBoobie: false,
            maxMarks: 3
        };
    });
    return data;
}

// --- Live Game Save/Restore (survives page reload, exit to setup, updates) ---

export function saveActiveGame() {
    const snapshot = {
        type: game.type,
        players: deepClone(game.players),
        currentPlayer: game.currentPlayer,
        currentInput: game.currentInput,
        cricketPoints: game.cricketPoints,
        cricketTargets: game.cricketTargets,
        finishType: game.finishType,
        pendingDarts: deepClone(game.pendingDarts),
        completedRounds: game.completedRounds,
        chicago: game.chicago ? deepClone(game.chicago) : null,
        game121: game.game121 ? deepClone(game.game121) : null,
        timestamp: Date.now()
    };
    try {
        localStorage.setItem('blakeout_active_game', JSON.stringify(snapshot));
    } catch (e) {
        console.warn('[BlakeOut] Failed to save game:', e);
    }
}

export function loadActiveGame() {
    const stored = localStorage.getItem('blakeout_active_game');
    if (!stored) return null;
    try {
        return JSON.parse(stored);
    } catch {
        return null;
    }
}

export function clearActiveGame() {
    localStorage.removeItem('blakeout_active_game');
}

export function restoreActiveGame(snapshot) {
    Object.assign(game, {
        type: snapshot.type,
        players: snapshot.players,
        currentPlayer: snapshot.currentPlayer,
        currentInput: snapshot.currentInput || '',
        cricketPoints: snapshot.cricketPoints,
        cricketTargets: snapshot.cricketTargets || [],
        finishType: snapshot.finishType,
        pendingDarts: snapshot.pendingDarts || [],
        completedRounds: snapshot.completedRounds || 0,
        undoHistory: [],
        redoHistory: [],
        chicago: snapshot.chicago || null,
        game121: snapshot.game121 || null
    });
}

// --- localStorage Config Management ---

export function getConfigs() {
    const stored = localStorage.getItem('blakeout_configs');
    return stored ? JSON.parse(stored) : { lastConfig: null, savedConfigs: [] };
}

export function saveConfigs(configs) {
    try {
        localStorage.setItem('blakeout_configs', JSON.stringify(configs));
    } catch (e) {
        console.warn('[BlakeOut] Failed to save configs:', e);
    }
}

export function getCurrentConfig() {
    return {
        gameType: document.getElementById('gameType').value,
        finishType: document.getElementById('finishType').value,
        numPlayers: document.getElementById('numPlayers').value,
        player1: document.getElementById('player1').value,
        player2: document.getElementById('player2').value,
        player3: document.getElementById('player3').value,
        player4: document.getElementById('player4').value,
        cricketPoints: document.getElementById('cricketPoints').checked,
        spanishBulls: document.getElementById('spanishBulls').checked,
        dartsPerLeg: document.getElementById('dartsPerLeg').value,
        totalLegs121: document.getElementById('totalLegs121').value,
        uiScale: document.getElementById('uiScale')?.value || '1.0',
        timestamp: Date.now()
    };
}

export function applyConfig(config) {
    document.getElementById('gameType').value = config.gameType || '501';
    document.getElementById('finishType').value = config.finishType || 'double-out';
    document.getElementById('numPlayers').value = config.numPlayers || '2';
    document.getElementById('player1').value = config.player1 || 'Home';
    document.getElementById('player2').value = config.player2 || 'Away';
    document.getElementById('player3').value = config.player3 || 'Player 3';
    document.getElementById('player4').value = config.player4 || 'Player 4';
    document.getElementById('cricketPoints').checked = config.cricketPoints !== false;
    document.getElementById('spanishBulls').checked = config.spanishBulls || false;
    if (config.dartsPerLeg) document.getElementById('dartsPerLeg').value = config.dartsPerLeg;
    if (config.totalLegs121) document.getElementById('totalLegs121').value = config.totalLegs121;

    // UI Scale
    const scale = config.uiScale || '1.0';
    const scaleSlider = document.getElementById('uiScale');
    const scaleLabel = document.getElementById('uiScaleValue');
    if (scaleSlider) scaleSlider.value = scale;
    if (scaleLabel) scaleLabel.textContent = parseFloat(scale).toFixed(1) + 'x';
    document.documentElement.style.setProperty('--ui-scale', scale);

    // Trigger change events to update visibility
    document.getElementById('numPlayers').dispatchEvent(new Event('change'));
    document.getElementById('gameType').dispatchEvent(new Event('change'));
}
