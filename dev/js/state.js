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
    teams: null,
    tournament: null,
    scoringRecords: null,
    x01Input: null
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
        tournament: game.tournament ? deepClone(game.tournament) : null,
        scoringRecords: game.scoringRecords ? deepClone(game.scoringRecords) : null,
        x01Input: game.x01Input ? deepClone(game.x01Input) : null,
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
    game.tournament = state.tournament || null;
    game.scoringRecords = state.scoringRecords || null;
    game.x01Input = state.x01Input || null;
}

export function saveGameState() {
    game.undoHistory.push(snapshot());
    game.redoHistory = [];

    // Tournament engines persist after mutation, with this undo entry included.
    if (!game.tournament) saveActiveGame();
}

export function undoLastAction(onAfterRestore) {
    if (game.tournament && ['pending', 'saving', 'saved'].includes(game.tournament.status)) return;
    if (game.undoHistory.length === 0) return;
    game.redoHistory.push(snapshot());
    restore(game.undoHistory.pop());
    if (onAfterRestore) onAfterRestore();
    saveActiveGame();
    document.dispatchEvent(new CustomEvent('scorerRestored'));
}

export function redoLastAction(onAfterRestore) {
    if (game.tournament && ['pending', 'saving', 'saved'].includes(game.tournament.status)) return;
    if (game.redoHistory.length === 0) return;
    game.undoHistory.push(snapshot());
    restore(game.redoHistory.pop());
    if (onAfterRestore) onAfterRestore();
    saveActiveGame();
    document.dispatchEvent(new CustomEvent('scorerRestored'));
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

const ACTIVE_GAME_KEY = 'blakeout_dev_active_game';
const ACTIVE_GAME_IMPORT_KEY = 'blakeout_dev_active_game_imported';
const MATCH_RECOVERY_PREFIX = 'blakeout_dev_match_';

function archivePreviousTournament(nextResultId = null) {
    const stored = localStorage.getItem(ACTIVE_GAME_KEY);
    if (!stored) return;
    let previous;
    try { previous = JSON.parse(stored); } catch { return; }
    const tournament = previous.tournament;
    if (tournament?.resultId && tournament.resultId !== nextResultId && tournament.status !== 'saved') {
        localStorage.setItem(MATCH_RECOVERY_PREFIX + tournament.resultId, stored);
    }
}

function compactTournamentSnapshot(snapshot) {
    if (!snapshot.tournament) return snapshot;
    if (snapshot.tournament.status === 'saved') {
        snapshot.undoHistory = [];
        snapshot.redoHistory = [];
        delete snapshot.tournament.pendingResult;
        snapshot.scoringRecords = snapshot.scoringRecords && {
            id: snapshot.scoringRecords.id,
            legs: snapshot.scoringRecords.legs.map(({ id, gameType, winnerId }) => ({ id, gameType, winnerId, turns: [] }))
        };
        snapshot.players.forEach(player => { player.history = []; });
        return snapshot;
    }
    if (['pending', 'saving'].includes(snapshot.tournament.status)) {
        // Confirmation already locks undo. The immutable ledger also supplies pendingResult.records.
        snapshot.undoHistory = [];
        snapshot.redoHistory = [];
        if (snapshot.tournament.pendingResult?.records) {
            delete snapshot.tournament.pendingResult.records;
            snapshot.pendingRecordsFromLedger = true;
        }
        return snapshot;
    }

    // Undo/redo ledgers are prefixes of the current leg; store raw turns only once.
    // Keep an explicit fallback for unusual/non-prefix legacy histories.
    const activeLegs = new Map((snapshot.scoringRecords?.legs || []).map(leg => [leg.id, leg]));
    const pool = new Map(activeLegs);
    for (const entry of [...snapshot.undoHistory, ...snapshot.redoHistory]) {
        for (const leg of entry.scoringRecords?.legs || []) {
            if (!pool.has(leg.id) || pool.get(leg.id).turns.length < leg.turns.length) pool.set(leg.id, leg);
        }
    }
    const compactHistory = history => history.map(entry => {
        const records = entry.scoringRecords;
        if (!records || !records.legs.every(leg => leg.turns.every((turn, i) => pool.get(leg.id)?.turns[i]?.id === turn.id))) return entry;
        const { scoringRecords, ...rest } = entry;
        return {
            ...rest,
            scoringCursor: {
                id: records.id,
                legs: records.legs.map(leg => ({ id: leg.id, winnerId: leg.winnerId, turnCount: leg.turns.length }))
            }
        };
    });
    snapshot.undoHistory = compactHistory(snapshot.undoHistory);
    snapshot.redoHistory = compactHistory(snapshot.redoHistory);
    const values = [];
    const valueIds = new Map();
    const intern = value => {
        const key = JSON.stringify(value);
        if (!valueIds.has(key)) {
            valueIds.set(key, values.length);
            values.push(value);
        }
        return valueIds.get(key);
    };
    const shareContext = history => history.map(entry => {
        const { players, teams, tournament, ...rest } = entry;
        return {
            ...rest,
            playerRefs: players.map(player => {
                if (!player.cricketData) return intern(player);
                const { cricketData, ...fields } = player;
                return intern({ ...fields, cricketDataRef: intern(cricketData) });
            }),
            tournamentContextRef: intern({ teams, tournament })
        };
    });
    snapshot.undoHistory = shareContext(snapshot.undoHistory);
    snapshot.redoHistory = shareContext(snapshot.redoHistory);
    snapshot.historyValuePool = values;
    snapshot.scoringRecordPool = [...pool.values()].filter(leg => leg !== activeLegs.get(leg.id));
    return snapshot;
}

function expandTournamentSnapshot(snapshot) {
    const pool = new Map([
        ...(snapshot.scoringRecords?.legs || []),
        ...(snapshot.scoringRecordPool || [])
    ].map(leg => [leg.id, leg]));
    const expandHistory = history => (history || []).map(entry => {
        if (entry.playerRefs) {
            const { playerRefs, tournamentContextRef, ...rest } = entry;
            entry = {
                ...rest,
                ...deepClone(snapshot.historyValuePool[tournamentContextRef]),
                players: playerRefs.map(index => {
                    const player = deepClone(snapshot.historyValuePool[index]);
                    if (player.cricketDataRef === undefined) return player;
                    const { cricketDataRef, ...fields } = player;
                    return { ...fields, cricketData: deepClone(snapshot.historyValuePool[cricketDataRef]) };
                })
            };
        }
        if (!entry.scoringCursor) return entry;
        const { scoringCursor, ...rest } = entry;
        return {
            ...rest,
            scoringRecords: {
                id: scoringCursor.id,
                legs: scoringCursor.legs.map(cursor => {
                    const leg = pool.get(cursor.id);
                    if (!leg || cursor.turnCount > leg.turns.length) throw new Error('Incomplete tournament undo ledger.');
                    return { ...leg, winnerId: cursor.winnerId, turns: leg.turns.slice(0, cursor.turnCount) };
                })
            }
        };
    });
    if (snapshot.pendingRecordsFromLedger && snapshot.tournament?.pendingResult) {
        snapshot.tournament.pendingResult.records = deepClone(snapshot.scoringRecords);
    }
    return {
        ...snapshot,
        undoHistory: expandHistory(snapshot.undoHistory),
        redoHistory: expandHistory(snapshot.redoHistory)
    };
}

function pruneSavedRecoveries(confirmedResultId) {
    localStorage.removeItem(MATCH_RECOVERY_PREFIX + confirmedResultId);
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
    for (const key of keys) {
        if (!key?.startsWith(MATCH_RECOVERY_PREFIX)) continue;
        let saved;
        try { saved = JSON.parse(localStorage.getItem(key)); } catch { continue; }
        if (saved?.tournament?.status === 'saved') localStorage.removeItem(key);
    }
}

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
        tournament: game.tournament ? deepClone(game.tournament) : null,
        scoringRecords: game.scoringRecords ? deepClone(game.scoringRecords) : null,
        x01Input: game.x01Input ? deepClone(game.x01Input) : null,
        undoHistory: game.tournament ? game.undoHistory : [],
        redoHistory: game.tournament ? game.redoHistory : [],
        timestamp: Date.now()
    };
    try {
        archivePreviousTournament(game.tournament?.resultId);
        const stored = JSON.stringify(compactTournamentSnapshot(snapshot));
        localStorage.setItem(ACTIVE_GAME_IMPORT_KEY, '1');
        localStorage.setItem(ACTIVE_GAME_KEY, stored);
        if (game.tournament?.status === 'saved') {
            pruneSavedRecoveries(game.tournament.resultId);
        } else if (game.tournament && ['pending', 'saving'].includes(game.tournament.status)) {
            localStorage.setItem(MATCH_RECOVERY_PREFIX + game.tournament.resultId, stored);
        }
        return true;
    } catch (e) {
        console.warn('[BlakeOut] Failed to save game:', e);
        if (game.tournament) {
            document.dispatchEvent(new CustomEvent('tournamentStorageError'));
        }
        return false;
    }
}

export function loadActiveGame() {
    try {
        let stored = localStorage.getItem(ACTIVE_GAME_KEY);
        if (!localStorage.getItem(ACTIVE_GAME_IMPORT_KEY)) {
            if (stored === null) {
                const legacy = localStorage.getItem('blakeout_active_game');
                let parsed;
                try { parsed = JSON.parse(legacy); } catch { /* Invalid legacy data is not imported. */ }
                if (parsed && typeof parsed.type === 'string' && Array.isArray(parsed.players) && parsed.players.length) {
                    // Preserve the entire snapshot, including a legacy DEV tournament ledger.
                    localStorage.setItem(ACTIVE_GAME_KEY, legacy);
                    stored = legacy;
                }
            }
            localStorage.setItem(ACTIVE_GAME_IMPORT_KEY, '1');
        }
        if (!stored) return null;
        return expandTournamentSnapshot(JSON.parse(stored));
    } catch {
        return null;
    }
}

export function clearActiveGame() {
    try {
        archivePreviousTournament();
        localStorage.setItem(ACTIVE_GAME_IMPORT_KEY, '1');
        localStorage.removeItem(ACTIVE_GAME_KEY);
    } catch (error) {
        console.warn('[BlakeOut] Failed to clear DEV game:', error);
    }
}

export function restoreActiveGame(snapshot) {
    snapshot = expandTournamentSnapshot(snapshot);
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
        undoHistory: snapshot.undoHistory || [],
        redoHistory: snapshot.redoHistory || [],
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
        teams: snapshot.teams || null,
        tournament: snapshot.tournament || null,
        scoringRecords: snapshot.scoringRecords || null,
        x01Input: snapshot.x01Input || null
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
