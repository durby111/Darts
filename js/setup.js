/* ============================================
   Setup Screen Logic
   Form handling, config save/load
   ============================================ */

import { game, initCricket, getConfigs, saveConfigs, getCurrentConfig, applyConfig, saveActiveGame, loadActiveGame, clearActiveGame, restoreActiveGame } from './state.js';
import { showChicagoGameSelection } from './chicago.js';
import {
    initFirebase, onRosterChange, getRosterCache,
    upsertPlayer, deletePlayer, findPlayerByName, getInitState, isRealEmail
} from './firebase.js';
import { showTeamBuilder, setTeamsConfirmedCallback } from './teams.js';
import { initBaseballState } from './baseball.js';
import { initBermudaState } from './bermuda.js';

let onGameStart = null;
let overlayMode = false;

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

    // Team Mode toggle — hides per-player inputs and the count selector;
    // Start Game then routes through the team builder.
    const teamModeCb = document.getElementById('teamMode');
    if (teamModeCb) {
        teamModeCb.addEventListener('change', applyTeamModeVisibility);
        applyTeamModeVisibility();
    }

    // When the team builder confirms a roster, finish the match start.
    setTeamsConfirmedCallback((teams) => {
        document.getElementById('teamBuilderScreen').style.display = 'none';
        beginMatchFromTeams(teams);
    });

    // Game type change
    document.getElementById('gameType').addEventListener('change', function () {
        const isCricket = ['cricket', 'spanish', 'minnesota'].includes(this.value);
        const isX01 = ['301', '501', '701', '801'].includes(this.value);
        const isChicago = this.value === 'chicago';
        const isSpanish = this.value === 'spanish';
        const is121 = this.value === '121';
        const isBaseball = this.value === 'baseball';
        const isBermuda = this.value === 'bermuda';
        document.getElementById('cricketOptions').classList.toggle('hidden', !isCricket);
        document.getElementById('spanishBullsOption').classList.toggle('hidden', !isSpanish);
        document.getElementById('game121Options').classList.toggle('hidden', !is121);
        document.getElementById('baseballOptions').classList.toggle('hidden', !isBaseball);
        document.getElementById('bermudaOptions').classList.toggle('hidden', !isBermuda);
        document.getElementById('finishTypeOptions').classList.toggle('hidden', !isX01 && !isChicago && !is121);
    });

    // Baseball variant hint updater
    const baseballHints = {
        standard: 'Standard 9 innings: each player throws 3 darts per inning at the inning\'s number (1–9). Single = 1 run, Double = 2 runs, Triple = 3 runs. Highest total runs after 9 innings wins.',
        extras: 'Same as standard, but if players are tied after 9 innings the game enters extra innings (15, 16, 17, 18, 19, 20, 25, repeating) until one player leads after a full inning.',
        stretch: 'Standard 1–9, except inning 7 targets the bullseye instead of the 7. Outer bull = +1 run, inner bull (50) = +2 runs. Triple disabled for inning 7.'
    };
    const baseballVariantEl = document.getElementById('baseballVariant');
    const baseballHintEl = document.getElementById('baseballVariantHint');
    if (baseballVariantEl && baseballHintEl) {
        baseballVariantEl.addEventListener('change', () => {
            baseballHintEl.textContent = baseballHints[baseballVariantEl.value] || '';
        });
    }

    // Bermuda variant hint updater
    const bermudaHints = {
        classic: 'Classic: 12, 13, 14, 15, Double, 16, 17, 18, Triple, 19, 20, 25 (bull), Bullseye. Each turn = 3 darts at that target; score = sum × multiplier. If all 3 darts miss on the Double/Triple/25/Bullseye stages, your score halves. Highest score at the end wins.',
        simple: 'Simple: 9 targets only (12 → 20). No halving on a miss — just no points scored that turn. Faster and more forgiving for casual play.',
        halveit: 'Halve-It: same target list as Classic, but if you miss on ANY target with all 3 darts your score halves. Most competitive version.'
    };
    const bermudaVariantEl = document.getElementById('bermudaVariant');
    const bermudaHintEl = document.getElementById('bermudaVariantHint');
    if (bermudaVariantEl && bermudaHintEl) {
        bermudaVariantEl.addEventListener('change', () => {
            bermudaHintEl.textContent = bermudaHints[bermudaVariantEl.value] || '';
        });
    }

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

    // Resume game button
    const resumeBtn = document.getElementById('resumeGameBtn');
    if (resumeBtn) {
        resumeBtn.addEventListener('click', resumeGame);
    }

    // Back to Game button (shown when settings opened from active game)
    const backToGameBtn = document.getElementById('backToGameBtn');
    if (backToGameBtn) {
        backToGameBtn.addEventListener('click', () => {
            overlayMode = false;
            backToGameBtn.classList.add('hidden');
            // Apply any scale changes the user made
            applyGameTypeScale();
            resumeGame();
        });
    }

    // Load saved configs on init
    updateSavedConfigsList();
    const configs = getConfigs();
    if (configs.lastConfig) {
        applyConfig(configs.lastConfig);
    }

    // Show resume button if there's a saved game
    updateResumeButton();

    // Roster (Firestore) — non-blocking. App still works if Firebase fails.
    initRosterUI();
    initFirebase().catch(err => {
        const status = document.getElementById('rosterStatus');
        if (status) status.textContent = '(offline — check Firebase setup)';
        console.warn('[Setup] Firebase init error:', err);
    });
    onRosterChange(renderRoster);
}

// --- Roster UI ---

function initRosterUI() {
    const addBtn = document.getElementById('rosterAddBtn');
    const nameInput = document.getElementById('rosterAddName');
    const emailInput = document.getElementById('rosterAddEmail');

    const submit = async () => {
        const name = nameInput.value.trim();
        const email = emailInput.value.trim();
        if (!name) {
            alert('Name is required. Email is optional but enables cross-device stats.');
            return;
        }
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            alert('That email looks invalid. Leave it blank or fix the format.');
            return;
        }
        addBtn.disabled = true;
        try {
            await upsertPlayer({ name, email });
            nameInput.value = '';
            emailInput.value = '';
        } catch (err) {
            alert('Failed to save: ' + (err.message || err));
        } finally {
            addBtn.disabled = false;
        }
    };
    if (addBtn) addBtn.addEventListener('click', submit);
    [nameInput, emailInput].forEach(el => {
        if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    });
}

function renderRoster(roster) {
    // Refresh the autocomplete datalist used by the player slots.
    const datalist = document.getElementById('rosterDatalist');
    if (datalist) {
        datalist.innerHTML = roster
            .map(p => `<option value="${escapeHtml(p.name)}">`)
            .join('');
    }

    // Refresh the manage-players list.
    const list = document.getElementById('rosterList');
    if (list) {
        if (roster.length === 0) {
            list.innerHTML = '<div class="roster-empty">No players yet. Add one below.</div>';
        } else {
            list.innerHTML = roster.map(p => {
                const emailLabel = isRealEmail(p.email) ? p.email : '(no email — local only)';
                return `
                <div class="roster-row" data-email="${escapeHtml(p.email)}">
                    <div class="roster-row-info">
                        <span class="roster-row-name">${escapeHtml(p.name)}</span>
                        <span class="roster-row-email">${escapeHtml(emailLabel)}</span>
                    </div>
                    <button class="btn btn--sm btn--danger" data-roster-delete="${escapeHtml(p.email)}">X</button>
                </div>`;
            }).join('');
            list.querySelectorAll('[data-roster-delete]').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const email = btn.dataset.rosterDelete;
                    if (!confirm(`Remove ${email}? (lifetime stats stay in the cloud and return if re-added.)`)) return;
                    try { await deletePlayer(email); }
                    catch (err) { alert('Delete failed: ' + (err.message || err)); }
                });
            });
        }
    }

    const status = document.getElementById('rosterStatus');
    if (status) {
        const init = getInitState();
        if (init.state === 'error') status.textContent = '(offline)';
        else status.textContent = roster.length ? `(${roster.length})` : '';
    }
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function updateResumeButton() {
    const resumeBtn = document.getElementById('resumeGameBtn');
    if (!resumeBtn) return;
    const saved = loadActiveGame();
    if (saved && saved.players && saved.players.length > 0) {
        const gameLabel = saved.type.toUpperCase();
        const players = saved.players.map(p => p.name).join(' vs ');
        resumeBtn.textContent = `Resume ${gameLabel} (${players})`;
        resumeBtn.classList.remove('hidden');
    } else {
        resumeBtn.classList.add('hidden');
    }
}

function resumeGame() {
    const saved = loadActiveGame();
    if (!saved) return;

    restoreActiveGame(saved);

    // Apply game-type scale override
    applyGameTypeScale(saved.type);

    // Switch screens
    document.getElementById('setupScreen').style.display = 'none';
    document.getElementById('gameScreen').style.display = 'flex';

    if (onGameStart) onGameStart();
}

function applyGameTypeScale() {
    // Apply user's scale setting — game-type sizes are baked into CSS
    const userScale = parseFloat(document.getElementById('uiScale')?.value || '1.0');
    document.documentElement.style.setProperty('--ui-scale', userScale);
}

function applyTeamModeVisibility() {
    const on = document.getElementById('teamMode')?.checked;
    document.getElementById('numPlayersGroup').classList.toggle('hidden', !!on);
    document.getElementById('player1Group').classList.toggle('hidden', !!on);
    document.getElementById('player2Group').classList.toggle('hidden', !!on);
    document.getElementById('player3Group').classList.toggle('hidden', !!on);
    document.getElementById('player4Group').classList.toggle('hidden', !!on);

    // When toggling team mode off, restore the player count-based visibility.
    if (!on) {
        const count = parseInt(document.getElementById('numPlayers').value);
        document.getElementById('player2Group').classList.toggle('hidden', count < 2);
        document.getElementById('player3Group').classList.toggle('hidden', count < 3);
        document.getElementById('player4Group').classList.toggle('hidden', count < 4);
    }
}

function startGame() {
    // Warn if there's an active game being overlaid
    if (overlayMode) {
        if (!confirm('Starting a new game will end your current game. Continue?')) return;
        overlayMode = false;
        const backBtn = document.getElementById('backToGameBtn');
        if (backBtn) backBtn.classList.add('hidden');
    }

    // Auto-save config so it survives the team-builder detour too.
    const configs = getConfigs();
    configs.lastConfig = getCurrentConfig();
    saveConfigs(configs);

    if (document.getElementById('teamMode')?.checked) {
        showTeamBuilder();
        return;
    }

    // Classic flow: gather names from the per-player inputs and start now.
    const numPlayers = parseInt(document.getElementById('numPlayers').value);
    const players = [];
    for (let i = 1; i <= numPlayers; i++) {
        const name = document.getElementById(`player${i}`).value || `Player ${i}`;
        const rosterMatch = findPlayerByName(name);
        players.push({ name, rosterEmail: rosterMatch ? rosterMatch.email : null });
    }
    beginMatch(players, null);
}

function beginMatchFromTeams(teams) {
    // In team mode, game.players represents the two TEAMS. Members live in
    // game.teams[i].members and rotate per-turn (see teams.js).
    const players = teams.map(t => ({ name: t.name, rosterEmail: null }));
    beginMatch(players, teams);
}

function beginMatch(playerSeeds, teams) {
    const gameType = document.getElementById('gameType').value;
    const cricketPoints = document.getElementById('cricketPoints').checked;
    const finishType = document.getElementById('finishType').value;
    const includeBulls = document.getElementById('spanishBulls').checked;

    const isChicago = gameType === 'chicago';
    const is121 = gameType === '121';
    const isBaseball = gameType === 'baseball';
    const isBermuda = gameType === 'bermuda';

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
        game121: is121 ? (() => {
            const rawLegs = document.getElementById('totalLegs121').value;
            const totalLegs = rawLegs === 'infinite' ? 'infinite' : parseInt(rawLegs);
            const solo = document.getElementById('game121SoloMode').checked;
            return {
                currentLeg: 1,
                totalLegs,
                dartsPerLeg: parseInt(document.getElementById('dartsPerLeg').value),
                dartsThrown: 0,
                startingScore: 121,
                highestStart: 121,
                legLossPenalty: parseInt(document.getElementById('legLossPenalty121').value) || 1,
                soloMode: solo,
                legResults: [],
                legsWon: [],
                roundsByPlayer: {}
            };
        })() : null,
        baseball: isBaseball ? initBaseballState(document.getElementById('baseballVariant').value) : null,
        bermuda: isBermuda ? initBermudaState(document.getElementById('bermudaVariant').value) : null,
        teamMode: !!teams,
        teams: teams ? teams.map(t => ({
            name: t.name,
            members: t.members.map(m => ({ name: m.name, rosterEmail: m.rosterEmail || null })),
            rotationIndex: 0
        })) : null
    });

    playerSeeds.forEach(seed => {
        const player = {
            name: seed.name,
            rosterEmail: seed.rosterEmail || null,
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
        } else if (isBaseball || isBermuda) {
            // score stays at 0; both games accumulate runs/points
        } else {
            player.cricketData = initCricket(gameType, includeBulls);
        }

        game.players.push(player);
    });

    clearActiveGame();
    const scaleSlider = document.getElementById('uiScale');
    const scale = parseFloat(scaleSlider?.value || '1.0');
    document.documentElement.style.setProperty('--ui-scale', scale);

    document.getElementById('setupScreen').style.display = 'none';
    document.getElementById('gameScreen').style.display = 'flex';

    if (isChicago) {
        showChicagoGameSelection();
    } else if (onGameStart) {
        onGameStart();
    }
}

export function showSetup() {
    // Reset overlay mode
    overlayMode = false;
    const backBtn = document.getElementById('backToGameBtn');
    if (backBtn) backBtn.classList.add('hidden');

    // Save active game before leaving
    if (game.players.length > 0) {
        saveActiveGame();
    }
    document.getElementById('winnerModal').style.display = 'none';
    document.getElementById('gameMenuModal').style.display = 'none';
    document.getElementById('gameScreen').style.display = 'none';
    document.getElementById('setupScreen').style.display = 'flex';
    updateSavedConfigsList();
    updateResumeButton();
}

export function showSetupAsOverlay() {
    overlayMode = true;
    const backBtn = document.getElementById('backToGameBtn');
    if (backBtn) backBtn.classList.remove('hidden');
    document.getElementById('setupScreen').style.display = 'flex';
    updateResumeButton();
}

export function playAgain() {
    clearActiveGame();
    const currentGameType = game.type;
    const currentPlayers = game.players.map(p => p.name);
    const currentCricketPoints = game.cricketPoints;
    const currentFinishType = game.finishType;
    const includeBulls = document.getElementById('spanishBulls').checked;

    // Preserve team mode + reset rotation so "Play Again" starts each team
    // from member 0.
    const preservedTeams = game.teamMode && game.teams
        ? game.teams.map(t => ({ name: t.name, members: t.members.slice(), rotationIndex: 0 }))
        : null;

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
        game121: null,
        teamMode: !!preservedTeams,
        teams: preservedTeams
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
