/* ============================================
   Setup Screen Logic
   Form handling, config save/load
   ============================================ */

import { game, initCricket, getConfigs, saveConfigs, getCurrentConfig, applyConfig } from './state.js';
import { showChicagoGameSelection } from './chicago.js';

let onGameStart = null;

export function setGameStartCallback(callback) {
    onGameStart = callback;
}

export function initSetupControls() {
    // Player count change
    document.getElementById('numPlayers').addEventListener('change', function () {
        const count = parseInt(this.value);
        document.getElementById('player2Group').classList.toggle('hidden', count < 2);
        document.getElementById('player3Group').classList.toggle('hidden', count < 3);
        document.getElementById('player4Group').classList.toggle('hidden', count < 4);
    });

    // Game type change
    document.getElementById('gameType').addEventListener('change', function () {
        const isCricket = ['cricket', 'spanish', 'minnesota'].includes(this.value);
        const isX01 = ['301', '501', '701', '801'].includes(this.value);
        const isChicago = this.value === 'chicago';
        const isSpanish = this.value === 'spanish';
        const is121 = this.value === '121';
        document.getElementById('cricketOptions').classList.toggle('hidden', !isCricket);
        document.getElementById('spanishBullsOption').classList.toggle('hidden', !isSpanish);
        document.getElementById('game121Options').classList.toggle('hidden', !is121);
        document.getElementById('finishTypeOptions').classList.toggle('hidden', !isX01 && !isChicago && !is121);
    });

    // Start game
    document.getElementById('startGameBtn').addEventListener('click', startGame);

    // Config buttons
    document.getElementById('saveConfigBtn').addEventListener('click', saveCurrentConfig);
    document.getElementById('loadLastBtn').addEventListener('click', loadLastConfig);

    // UI Scale slider
    const uiScaleSlider = document.getElementById('uiScale');
    const uiScaleLabel = document.getElementById('uiScaleValue');
    if (uiScaleSlider) {
        uiScaleSlider.addEventListener('input', function () {
            const val = parseFloat(this.value);
            if (uiScaleLabel) uiScaleLabel.textContent = val.toFixed(1) + 'x';
            document.documentElement.style.setProperty('--ui-scale', val);
        });
    }

    // Load saved configs on init
    updateSavedConfigsList();
    const configs = getConfigs();
    if (configs.lastConfig) {
        applyConfig(configs.lastConfig);
    }
}

function startGame() {
    const gameType = document.getElementById('gameType').value;
    const numPlayers = parseInt(document.getElementById('numPlayers').value);
    const cricketPoints = document.getElementById('cricketPoints').checked;
    const finishType = document.getElementById('finishType').value;
    const includeBulls = document.getElementById('spanishBulls').checked;

    const isChicago = gameType === 'chicago';
    const is121 = gameType === '121';

    // Auto-save config
    const configs = getConfigs();
    configs.lastConfig = getCurrentConfig();
    saveConfigs(configs);

    // Reset game state
    Object.assign(game, {
        type: gameType,
        players: [],
        currentPlayer: 0,
        currentInput: '',
        cricketPoints: cricketPoints,
        finishType: is121 ? 'double-out' : finishType,
        pendingDarts: [],
        completedRounds: 0,
        undoHistory: [],
        redoHistory: [],
        cricketTargets: [],
        chicago: isChicago ? {
            currentLeg: 1,
            legWins: [],
            gamesPlayed: [],
            gamesRemaining: ['cricket', '301', '501'],
            currentGameType: null,
            whoPicksNext: 0
        } : null,
        game121: is121 ? {
            currentLeg: 1,
            totalLegs: parseInt(document.getElementById('totalLegs121').value),
            dartsPerLeg: parseInt(document.getElementById('dartsPerLeg').value),
            dartsThrown: 0,
            startingScore: 121,
            legResults: [],
            legsWon: []
        } : null
    });

    // Create players
    for (let i = 1; i <= numPlayers; i++) {
        const name = document.getElementById(`player${i}`).value || `Player ${i}`;
        const player = {
            name: name,
            score: 0,
            throws: 0,
            totalMarks: 0,
            history: [],
            lastTurnMarks: {}
        };

        if (isChicago) {
            game.chicago.legWins.push(0);
        } else if (is121) {
            player.score = 121;
            game.game121.legsWon.push(0);
        } else if (['301', '501', '701', '801'].includes(gameType)) {
            player.score = parseInt(gameType);
        } else {
            player.cricketData = initCricket(gameType, includeBulls);
        }

        game.players.push(player);
    }

    // Switch screens
    document.getElementById('setupScreen').style.display = 'none';
    document.getElementById('gameScreen').style.display = 'flex';

    if (isChicago) {
        showChicagoGameSelection();
    } else if (onGameStart) {
        onGameStart();
    }
}

export function showSetup() {
    document.getElementById('winnerModal').style.display = 'none';
    document.getElementById('gameMenuModal').style.display = 'none';
    document.getElementById('gameScreen').style.display = 'none';
    document.getElementById('setupScreen').style.display = 'flex';
    updateSavedConfigsList();
}

export function playAgain() {
    const currentGameType = game.type;
    const currentPlayers = game.players.map(p => p.name);
    const currentCricketPoints = game.cricketPoints;
    const currentFinishType = game.finishType;
    const includeBulls = document.getElementById('spanishBulls').checked;

    Object.assign(game, {
        type: currentGameType,
        players: [],
        currentPlayer: 0,
        currentInput: '',
        cricketPoints: currentCricketPoints,
        finishType: currentFinishType,
        pendingDarts: [],
        completedRounds: 0,
        undoHistory: [],
        redoHistory: [],
        chicago: null,
        game121: null
    });

    currentPlayers.forEach(name => {
        const player = {
            name: name,
            score: 0,
            throws: 0,
            totalMarks: 0,
            history: [],
            lastTurnMarks: {}
        };

        if (['301', '501', '701', '801'].includes(currentGameType)) {
            player.score = parseInt(currentGameType);
        } else {
            player.cricketData = initCricket(currentGameType, includeBulls);
        }

        game.players.push(player);
    });

    document.getElementById('winnerModal').style.display = 'none';
    if (onGameStart) onGameStart();
}

// --- Config Management ---

function saveCurrentConfig() {
    const config = getCurrentConfig();
    const configName = prompt('Enter a name for this configuration:', `Game ${new Date().toLocaleDateString()}`);
    if (!configName) return;

    config.name = configName;
    const configs = getConfigs();
    configs.savedConfigs.push(config);
    configs.lastConfig = config;
    saveConfigs(configs);
    updateSavedConfigsList();
}

function loadLastConfig() {
    const configs = getConfigs();
    if (!configs.lastConfig) return;
    applyConfig(configs.lastConfig);
}

function loadSavedConfig(index) {
    const configs = getConfigs();
    if (configs.savedConfigs[index]) {
        applyConfig(configs.savedConfigs[index]);
        configs.lastConfig = configs.savedConfigs[index];
        saveConfigs(configs);
    }
}

function deleteSavedConfig(index) {
    const configs = getConfigs();
    const configName = configs.savedConfigs[index]?.name || 'this config';
    if (confirm(`Delete "${configName}"?`)) {
        configs.savedConfigs.splice(index, 1);
        saveConfigs(configs);
        updateSavedConfigsList();
    }
}

function updateSavedConfigsList() {
    const configs = getConfigs();
    const container = document.getElementById('savedConfigsList');

    document.getElementById('loadLastBtn').disabled = !configs.lastConfig;

    if (configs.savedConfigs.length === 0) {
        container.innerHTML = '';
        return;
    }

    let html = '<div style="color:var(--color-text-muted);font-size:var(--font-sm);margin-bottom:var(--space-sm);">Saved Configurations:</div>';
    configs.savedConfigs.forEach((config, index) => {
        html += `<div class="config-item">
            <span>${config.name}</span>
            <button class="btn btn--sm btn--primary" data-load-config="${index}">Load</button>
            <button class="btn btn--sm btn--danger" data-delete-config="${index}">X</button>
        </div>`;
    });
    container.innerHTML = html;

    // Add event listeners
    container.querySelectorAll('[data-load-config]').forEach(btn => {
        btn.addEventListener('click', () => loadSavedConfig(parseInt(btn.dataset.loadConfig)));
    });
    container.querySelectorAll('[data-delete-config]').forEach(btn => {
        btn.addEventListener('click', () => deleteSavedConfig(parseInt(btn.dataset.deleteConfig)));
    });
}
