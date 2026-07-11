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
    game121: null,
    baseball: null,
    bermuda: null,
    golf: null,
    shanghai: null,
    countUp: null,
    gotcha: null,
    hammer: null,
    sharkTank: null,
    ticTacToe: null,
    robinHood: null,
    doubleDown: null,
    teamCricket: null,
    // Team mode (Phase 2). When teamMode is true, game.players[] still has
    // exactly two entries — Home and Away — which the scoring engine treats
    // as the two "players". The actual humans throwing live in
    // game.teams[i].members and rotate per-turn.
    teamMode: false,
    teams: null
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

function snapshot() {
    return {
        players: deepClone(game.players),
        currentPlayer: game.currentPlayer,
        completedRounds: game.completedRounds,
        pendingDarts: deepClone(game.pendingDarts),
        currentInput: game.currentInput,
        cricketTargets: deepClone(game.cricketTargets),
        countUp: game.countUp ? deepClone(game.countUp) : null,
        gotcha: game.gotcha ? deepClone(game.gotcha) : null,
        hammer: game.hammer ? deepClone(game.hammer) : null,
        sharkTank: game.sharkTank ? deepClone(game.sharkTank) : null,
        ticTacToe: game.ticTacToe ? deepClone(game.ticTacToe) : null,
        robinHood: game.robinHood ? deepClone(game.robinHood) : null,
        doubleDown: game.doubleDown ? deepClone(game.doubleDown) : null,
        teamCricket: game.teamCricket ? deepClone(game.teamCricket) : null,
        chicago: game.chicago ? deepClone(game.chicago) : null,
        game121: game.game121 ? deepClone(game.game121) : null,
        baseball: game.baseball ? deepClone(game.baseball) : null,
        bermuda: game.bermuda ? deepClone(game.bermuda) : null,
        golf: game.golf ? deepClone(game.golf) : null,
        shanghai: game.shanghai ? deepClone(game.shanghai) : null,
        // Snapshot teams so undo rolls back rotationIndex too.
        teams: game.teams ? deepClone(game.teams) : null,
        timestamp: Date.now()
    };
}

function restore(state) {
    game.players = state.players;
    game.currentPlayer = state.currentPlayer;
    game.completedRounds = state.completedRounds;
    game.pendingDarts = state.pendingDarts;
    game.currentInput = state.currentInput;
    if (state.cricketTargets !== undefined) game.cricketTargets = state.cricketTargets;
    if (state.countUp !== undefined) game.countUp = state.countUp;
    if (state.gotcha !== undefined) game.gotcha = state.gotcha;
    if (state.hammer !== undefined) game.hammer = state.hammer;
    if (state.sharkTank !== undefined) game.sharkTank = state.sharkTank;
    if (state.ticTacToe !== undefined) game.ticTacToe = state.ticTacToe;
    if (state.robinHood !== undefined) game.robinHood = state.robinHood;
    if (state.doubleDown !== undefined) game.doubleDown = state.doubleDown;
    if (state.teamCricket !== undefined) game.teamCricket = state.teamCricket;
    ['chicago', 'game121', 'baseball', 'bermuda', 'golf', 'shanghai'].forEach(key => {
        if (state[key] !== undefined) game[key] = state[key];
    });
    if (state.teams !== undefined) game.teams = state.teams;
}

export function saveGameState() {
    game.undoHistory.push(snapshot());
    game.redoHistory = [];

    // Persist live game to localStorage
    saveActiveGame();
}

export function undoLastAction(onAfterRestore) {
    if (game.undoHistory.length === 0) return;
    game.redoHistory.push(snapshot());
    restore(game.undoHistory.pop());
    if (onAfterRestore) onAfterRestore();
}

export function redoLastAction(onAfterRestore) {
    if (game.redoHistory.length === 0) return;
    game.undoHistory.push(snapshot());
    restore(game.redoHistory.pop());
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

// Chaos Cricket: draw 6 unique random numbers (1–20) + Bull. Sorted
// descending so the board reads like a normal cricket sheet.
export function generateChaosTargets() {
    const pool = [];
    for (let n = 1; n <= 20; n++) pool.push(n);
    // Fisher–Yates partial shuffle — take 6.
    for (let i = pool.length - 1; i > pool.length - 1 - 6; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const picked = pool.slice(-6).sort((a, b) => b - a).map(String);
    picked.push('Bull');
    return picked;
}

// Wild Card Cricket draws six unique values from 7–20. Unlike Chaos,
// their row positions matter because each still-unmarked value is replaced
// after every turn, so preserve draw order rather than sorting.
export function generateWildcardTargets() {
    const pool = [];
    for (let n = 7; n <= 20; n++) pool.push(n);
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, 6).map(String).concat('Bull');
}

export function createCricketTargetState() {
    return {
        marks: 0,
        closed: false,
        closedInOneTurn: false,
        marksBeforeClose: 0,
        showBoobie: false,
        maxMarks: 3
    };
}

export function initCricket(type, includeBulls = false) {
    let targets;
    if (type === 'cricket' || type === 'quickie' || type === 'cutthroat') {
        targets = ['20', '19', '18', '17', '16', '15', 'Bull'];
    } else if (type === 'spanish') {
        targets = includeBulls
            ? ['20', '19', '18', '17', '16', '15', '14', '13', '12', '11', '10', 'Bull']
            : ['20', '19', '18', '17', '16', '15', '14', '13', '12', '11', '10'];
    } else if (type === 'chaos') {
        targets = generateChaosTargets();
    } else if (type === 'wildcard') {
        targets = generateWildcardTargets();
    } else if (type === 'minnesota') {
        targets = ['20', '19', '18', '17', '16', '15', 'Bull', 'Triples', 'Doubles', 'Bed'];
    } else {
        targets = ['20', '19', '18', '17', '16', '15', 'Bull'];
    }

    game.cricketTargets = targets;

    const data = {};
    targets.forEach(t => {
        data[t] = createCricketTargetState();
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
        baseball: game.baseball ? deepClone(game.baseball) : null,
        bermuda: game.bermuda ? deepClone(game.bermuda) : null,
        golf: game.golf ? deepClone(game.golf) : null,
        shanghai: game.shanghai ? deepClone(game.shanghai) : null,
        countUp: game.countUp ? deepClone(game.countUp) : null,
        gotcha: game.gotcha ? deepClone(game.gotcha) : null,
        hammer: game.hammer ? deepClone(game.hammer) : null,
        sharkTank: game.sharkTank ? deepClone(game.sharkTank) : null,
        ticTacToe: game.ticTacToe ? deepClone(game.ticTacToe) : null,
        robinHood: game.robinHood ? deepClone(game.robinHood) : null,
        doubleDown: game.doubleDown ? deepClone(game.doubleDown) : null,
        teamCricket: game.teamCricket ? deepClone(game.teamCricket) : null,
        teamMode: game.teamMode || false,
        teams: game.teams ? deepClone(game.teams) : null,
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
        game121: snapshot.game121 || null,
        baseball: snapshot.baseball || null,
        bermuda: snapshot.bermuda || null,
        golf: snapshot.golf || null,
        shanghai: snapshot.shanghai || null,
        countUp: snapshot.countUp || null,
        gotcha: snapshot.gotcha || null,
        hammer: snapshot.hammer || null,
        sharkTank: snapshot.sharkTank || null,
        ticTacToe: snapshot.ticTacToe || null,
        robinHood: snapshot.robinHood || null,
        doubleDown: snapshot.doubleDown || null,
        teamCricket: snapshot.teamCricket || null,
        teamMode: snapshot.teamMode || false,
        teams: snapshot.teams || null
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
        baseballVariant: document.getElementById('baseballVariant')?.value,
        bermudaVariant: document.getElementById('bermudaVariant')?.value,
        golfVariant: document.getElementById('golfVariant')?.value,
        shanghaiVariant: document.getElementById('shanghaiVariant')?.value,
        teamCricketRules: document.getElementById('teamCricketRules')?.value,
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
    const variantMap = {
        baseballVariant: 'baseballVariant',
        bermudaVariant: 'bermudaVariant',
        golfVariant: 'golfVariant',
        shanghaiVariant: 'shanghaiVariant',
        teamCricketRules: 'teamCricketRules'
    };
    Object.entries(variantMap).forEach(([key, id]) => {
        const el = document.getElementById(id);
        if (el && config[key]) el.value = config[key];
    });

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
