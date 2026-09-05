/* ============================================
   Setup Screen Logic
   Form handling, config save/load
   ============================================ */

import { game, initCricket, getConfigs, saveConfigs, getCurrentConfig, applyConfig, saveActiveGame, loadActiveGame, clearActiveGame, restoreActiveGame } from './state.js';
import { showChicagoGameSelection, resumeChicago } from './chicago.js';
import {
    initFirebase, onRosterChange, getRosterCache,
    upsertPlayer, deletePlayer, findPlayerByName, getInitState, isRealEmail,
    getRosterShareUrl
} from './firebase.js';
import { showTeamBuilder, setTeamsConfirmedCallback } from './teams.js';
import { initBaseballState } from './baseball.js';
import { initBermudaState } from './bermuda.js';
import { initGolfState } from './golf.js';
import { initShanghaiState } from './shanghai.js';
import { initHammerState } from './hammer.js';
import { initTicTacToeState, resetTicTacToeInput } from './tictactoe.js';
import { initRobinHoodState } from './robinhood.js';
import { initDoubleDownState } from './doubledown.js';
import { initTeamCricketState } from './teamcricket.js';
import { initThemePickerUI } from './theme.js';
import { getGame, isCricketGame, isX01Game, isScoreGame, isTargetGame } from './registry.js';
import { initGamePicker, refreshPicker, recordRecentGame } from './picker.js';
import { resetX01Input } from './x01.js';

let onGameStart = null;
let overlayMode = false;

const PLAYER_ORDER_DRAG_THRESHOLD = 8;
let playerOrderDrag = null;

function playerCount() {
    const raw = parseInt(document.getElementById('numPlayers')?.value || '2');
    return Math.max(1, Math.min(4, raw));
}

function ordinal(value) {
    return value === 1 ? '1st' : value === 2 ? '2nd' : value === 3 ? '3rd' : `${value}th`;
}

function renderPlayerOrderControls() {
    const count = playerCount();
    for (let index = 0; index < 4; index++) {
        const row = document.getElementById(`player${index + 1}Group`);
        const input = document.getElementById(`player${index + 1}`);
        if (!row || !input) continue;

        const label = row.querySelector('[data-player-order-label]');
        if (label) label.textContent = `Throws ${ordinal(index + 1)}`;

        const displayName = input.value.trim() || `Player ${index + 1}`;
        const handle = row.querySelector('[data-player-drag-index]');
        if (handle) handle.setAttribute('aria-label', `Drag ${displayName} in throw order`);

        const up = row.querySelector('[data-player-order-action="up"]');
        const down = row.querySelector('[data-player-order-action="down"]');
        if (up) {
            up.disabled = index === 0 || index >= count;
            up.setAttribute('aria-label', `Move ${displayName} earlier`);
        }
        if (down) {
            down.disabled = index >= count - 1;
            down.setAttribute('aria-label', `Move ${displayName} later`);
        }
    }

    const randomize = document.getElementById('randomizePlayersBtn');
    if (randomize) randomize.disabled = count < 2;
}

function movePlayerInOrder(fromIndex, toIndex) {
    const count = playerCount();
    if (fromIndex < 0 || fromIndex >= count || toIndex < 0 || toIndex >= count) return;
    if (fromIndex === toIndex) {
        renderPlayerOrderControls();
        return;
    }

    const values = Array.from({ length: count }, (_, index) =>
        document.getElementById(`player${index + 1}`).value
    );
    const [moved] = values.splice(fromIndex, 1);
    values.splice(toIndex, 0, moved);
    values.forEach((value, index) => {
        document.getElementById(`player${index + 1}`).value = value;
    });
    renderPlayerOrderControls();
}

function shufflePlayerOrder() {
    const count = playerCount();
    if (count < 2) return;
    const values = Array.from({ length: count }, (_, index) =>
        document.getElementById(`player${index + 1}`).value
    );
    const original = values.slice();
    for (let i = values.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [values[i], values[j]] = [values[j], values[i]];
    }
    // A random button that appears to do nothing feels broken. If the
    // shuffle lands on the original order, rotate once instead.
    if (values.every((value, index) => value === original[index])) {
        values.push(values.shift());
    }
    values.forEach((value, index) => {
        document.getElementById(`player${index + 1}`).value = value;
    });
    renderPlayerOrderControls();
}

function playerDropIndexAt(x, y) {
    const rows = Array.from({ length: playerCount() }, (_, index) =>
        document.getElementById(`player${index + 1}Group`)
    ).filter(Boolean);
    const containing = rows.findIndex(row => {
        const rect = row.getBoundingClientRect();
        return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    });
    if (containing >= 0) return containing;

    let nearestIndex = 0;
    let nearestDistance = Infinity;
    rows.forEach((row, index) => {
        const rect = row.getBoundingClientRect();
        const distance = Math.hypot(
            x - (rect.left + rect.width / 2),
            y - (rect.top + rect.height / 2)
        );
        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestIndex = index;
        }
    });
    return nearestIndex;
}

function clearPlayerOrderDragClasses() {
    document.querySelectorAll('.player-row--dragging, .player-row--drop-target').forEach(row => {
        row.classList.remove('player-row--dragging', 'player-row--drop-target');
    });
}

function onPlayerOrderPointerMove(event) {
    if (!playerOrderDrag || event.pointerId !== playerOrderDrag.pointerId) return;
    const distance = Math.hypot(
        event.clientX - playerOrderDrag.startX,
        event.clientY - playerOrderDrag.startY
    );
    if (!playerOrderDrag.dragging && distance < PLAYER_ORDER_DRAG_THRESHOLD) return;
    event.preventDefault();
    playerOrderDrag.dragging = true;
    playerOrderDrag.toIndex = playerDropIndexAt(event.clientX, event.clientY);
    clearPlayerOrderDragClasses();
    document.getElementById(`player${playerOrderDrag.fromIndex + 1}Group`)
        ?.classList.add('player-row--dragging');
    document.getElementById(`player${playerOrderDrag.toIndex + 1}Group`)
        ?.classList.add('player-row--drop-target');
}

function finishPlayerOrderDrag(event, cancelled = false) {
    if (!playerOrderDrag || event.pointerId !== playerOrderDrag.pointerId) return;
    const finished = playerOrderDrag;
    playerOrderDrag = null;
    document.removeEventListener('pointermove', onPlayerOrderPointerMove);
    document.removeEventListener('pointerup', onPlayerOrderPointerUp);
    document.removeEventListener('pointercancel', onPlayerOrderPointerCancel);
    clearPlayerOrderDragClasses();
    if (!cancelled && finished.dragging) {
        movePlayerInOrder(finished.fromIndex, finished.toIndex);
    }
}

function onPlayerOrderPointerUp(event) {
    finishPlayerOrderDrag(event);
}

function onPlayerOrderPointerCancel(event) {
    finishPlayerOrderDrag(event, true);
}

function initPlayerOrderControls() {
    document.querySelectorAll('[data-player-drag-index]').forEach(handle => {
        handle.addEventListener('pointerdown', event => {
            if (event.button !== undefined && event.button !== 0) return;
            event.preventDefault();
            playerOrderDrag = {
                pointerId: event.pointerId,
                fromIndex: parseInt(handle.dataset.playerDragIndex),
                toIndex: parseInt(handle.dataset.playerDragIndex),
                startX: event.clientX,
                startY: event.clientY,
                dragging: false
            };
            document.addEventListener('pointermove', onPlayerOrderPointerMove, { passive: false });
            document.addEventListener('pointerup', onPlayerOrderPointerUp);
            document.addEventListener('pointercancel', onPlayerOrderPointerCancel);
        });
    });

    document.querySelectorAll('[data-player-order-action]').forEach(button => {
        button.addEventListener('click', () => {
            const index = parseInt(button.dataset.playerIndex);
            const offset = button.dataset.playerOrderAction === 'up' ? -1 : 1;
            movePlayerInOrder(index, index + offset);
        });
    });
    document.getElementById('randomizePlayersBtn')?.addEventListener('click', shufflePlayerOrder);
    for (let index = 1; index <= 4; index++) {
        document.getElementById(`player${index}`)?.addEventListener('input', renderPlayerOrderControls);
    }
    renderPlayerOrderControls();
}

export function setGameStartCallback(callback) {
    onGameStart = callback;
}

export function initSetupControls() {
    initThemePickerUI();
    initGamePicker(quickStartLastGame);
    initPlayerOrderControls();

    // Player count change
    document.getElementById('numPlayers').addEventListener('change', function () {
        const count = parseInt(this.value);
        document.getElementById('player2Group').classList.toggle('hidden', count < 2);
        document.getElementById('player3Group').classList.toggle('hidden', count < 3);
        document.getElementById('player4Group').classList.toggle('hidden', count < 4);
        renderPlayerOrderControls();
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

    // Game type change — option-panel visibility is registry-driven.
    document.getElementById('gameType').addEventListener('change', function () {
        const isCricket = isCricketGame(this.value);
        const isX01 = isX01Game(this.value);
        const isChicago = this.value === 'chicago';
        const isSpanish = this.value === 'spanish';
        const is121 = this.value === '121';
        const isBaseball = this.value === 'baseball';
        const isBermuda = this.value === 'bermuda';
        const isGolf = this.value === 'golf';
        const isShanghai = this.value === 'shanghai';
        const isChaos = this.value === 'chaos';
        const isCutThroat = this.value === 'cutthroat';
        const isTeamCricket = this.value === 'teamcricket';
        document.getElementById('cricketOptions').classList.toggle('hidden', !isCricket);
        document.getElementById('spanishBullsOption').classList.toggle('hidden', !isSpanish);
        document.getElementById('chaosOptions')?.classList.toggle('hidden', !isChaos);
        document.getElementById('game121Options').classList.toggle('hidden', !is121);
        document.getElementById('baseballOptions').classList.toggle('hidden', !isBaseball);
        document.getElementById('bermudaOptions').classList.toggle('hidden', !isBermuda);
        document.getElementById('golfOptions').classList.toggle('hidden', !isGolf);
        document.getElementById('shanghaiOptions')?.classList.toggle('hidden', !isShanghai);
        document.getElementById('finishTypeOptions').classList.toggle('hidden', !isX01 && !isChicago && !is121);
        document.getElementById('teamCricketOptions')?.classList.toggle('hidden', !isTeamCricket);

        // Cut-Throat always sends points to open opponents and requires at
        // least two sides. Restore the normal configurable control when the
        // user switches to another Cricket variant.
        const points = document.getElementById('cricketPoints');
        const pointsLabel = document.getElementById('cricketPointsLabel');
        if (points) {
            points.disabled = isCutThroat;
            if (isCutThroat) points.checked = true;
        }
        if (pointsLabel) {
            pointsLabel.textContent = isCutThroat
                ? 'Points go to open opponents (required)'
                : 'Enable Points';
        }
        const count = document.getElementById('numPlayers');
        const gameDef = getGame(this.value);
        const minPlayers = gameDef?.minPlayers || (isCutThroat ? 2 : 1);
        const maxPlayers = gameDef?.maxPlayers || 4;
        count?.querySelectorAll('option').forEach(option => {
            const value = parseInt(option.value);
            option.disabled = value < minPlayers || value > maxPlayers;
        });
        if (count && parseInt(count.value) < minPlayers) {
            count.value = String(minPlayers);
            count.dispatchEvent(new Event('change'));
        } else if (count && parseInt(count.value) > maxPlayers) {
            count.value = String(maxPlayers);
            count.dispatchEvent(new Event('change'));
        }

        if (teamModeCb) {
            if (gameDef?.requiresTeamMode) {
                teamModeCb.checked = true;
                teamModeCb.disabled = true;
                teamModeCb.dataset.forcedByGame = 'true';
                teamModeCb.dispatchEvent(new Event('change'));
            } else if (teamModeCb.dataset.forcedByGame === 'true') {
                teamModeCb.checked = false;
                teamModeCb.disabled = false;
                delete teamModeCb.dataset.forcedByGame;
                teamModeCb.dispatchEvent(new Event('change'));
            }
        }
        updateGameOptionsSection();
    });
    updateGameOptionsSection();

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

    // Golf variant hint updater
    const golfHints = {
        '18hole': '18 holes (1 → 18). Each player throws 3 darts per hole at the hole\'s number. Triple = 1 stroke (eagle), Double = 2 (birdie), Single = 3 (par), miss = 5. Lowest total strokes wins.',
        '9hole': '9 holes (1 → 9). Quicker round. Same stroke values as standard: Triple = 1, Double = 2, Single = 3, miss = 5. Lowest total strokes wins.',
        stableford: '18 holes, Stableford scoring (higher is better). Triple = 4 pts (eagle), Double = 3 (birdie), Single = 1 (par), miss = 0. Highest total points wins.'
    };
    const golfVariantEl = document.getElementById('golfVariant');
    const golfHintEl = document.getElementById('golfVariantHint');
    if (golfVariantEl && golfHintEl) {
        golfVariantEl.addEventListener('change', () => {
            golfHintEl.textContent = golfHints[golfVariantEl.value] || '';
        });
    }

    // Shanghai variant hint updater
    const shanghaiHints = {
        rounds17: 'Standard: rounds 1→7, 3 darts per round at the round\'s number. Score = face × multiplier. Single + Double + Triple in one turn = SHANGHAI — instant win. Otherwise highest total after round 7 wins.',
        rounds120: 'Marathon: rounds 1→20. Same rules — face × multiplier, and a Single + Double + Triple turn is an instant Shanghai win. Highest total after round 20 wins.'
    };
    const shanghaiVariantEl = document.getElementById('shanghaiVariant');
    const shanghaiHintEl = document.getElementById('shanghaiVariantHint');
    if (shanghaiVariantEl && shanghaiHintEl) {
        shanghaiVariantEl.addEventListener('change', () => {
            shanghaiHintEl.textContent = shanghaiHints[shanghaiVariantEl.value] || '';
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

    // Share roster: hands out the capability link for THIS roster. Anyone
    // with it can view and edit the list, so the copy says so plainly.
    const shareBtn = document.getElementById('rosterShareBtn');
    const shareStatus = document.getElementById('rosterShareStatus');
    if (shareBtn) {
        shareBtn.addEventListener('click', async () => {
            const url = getRosterShareUrl();
            let copied = false;
            try {
                await navigator.clipboard.writeText(url);
                copied = true;
            } catch { /* clipboard blocked — fall back to showing the link */ }
            if (shareStatus) {
                shareStatus.textContent = copied
                    ? 'Link copied — anyone with it can edit this roster.'
                    : url;
            }
        });
    }
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

    if (saved.chicago && resumeChicago()) return;
    if (onGameStart) {
        onGameStart();
    }
}

function applyGameTypeScale() {
    // Apply user's scale setting — game-type sizes are baked into CSS
    const userScale = parseFloat(document.getElementById('uiScale')?.value || '1.0');
    document.documentElement.style.setProperty('--ui-scale', userScale);
}

function applyTeamModeVisibility() {
    const on = document.getElementById('teamMode')?.checked;
    document.getElementById('numPlayersGroup').classList.toggle('hidden', !!on);
    document.getElementById('playerOrderControls')?.classList.toggle('hidden', !!on);
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
    renderPlayerOrderControls();
}

function updateGameOptionsSection() {
    const section = document.getElementById('gameOptionsSection');
    if (!section) return;
    const hasVisibleOptions = Array.from(section.children).some(child =>
        child.classList.contains('form-group') && !child.classList.contains('hidden'));
    section.classList.toggle('hidden', !hasVisibleOptions);
    section.setAttribute('aria-hidden', String(!hasVisibleOptions));
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
    const cricketPoints = gameType === 'cutthroat'
        ? true
        : document.getElementById('cricketPoints').checked;
    const finishType = document.getElementById('finishType').value;
    const includeBulls = document.getElementById('spanishBulls').checked;

    const isChicago = gameType === 'chicago';
    const is121 = gameType === '121';
    const isBaseball = gameType === 'baseball';
    const isBermuda = gameType === 'bermuda';
    const isGolf = gameType === 'golf';
    const isShanghai = gameType === 'shanghai';
    const isCountUp = gameType === 'countup';
    const isGotcha = gameType === 'gotcha';
    const isHammer = gameType === 'hammer' || gameType === 'teamhammer';
    const isSharkTank = gameType === 'sharktank';
    const isTicTacToe = gameType === 'tictactoe';
    const isRobinHood = gameType === 'robinhood';
    const isDoubleDown = gameType === 'doubledown';
    const isTeamCricket = gameType === 'teamcricket';

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
        golf: isGolf ? initGolfState(document.getElementById('golfVariant').value) : null,
        shanghai: isShanghai ? initShanghaiState(document.getElementById('shanghaiVariant')?.value) : null,
        countUp: isCountUp ? { totalRounds: 8 } : null,
        gotcha: isGotcha ? { target: 301 } : null,
        hammer: isHammer ? initHammerState() : null,
        sharkTank: isSharkTank ? {
            round: 1,
            bites: playerSeeds.map(() => 0),
            eliminated: playerSeeds.map(() => false),
            roundScores: playerSeeds.map(() => null)
        } : null,
        ticTacToe: isTicTacToe ? initTicTacToeState() : null,
        robinHood: isRobinHood ? initRobinHoodState() : null,
        doubleDown: isDoubleDown ? initDoubleDownState(playerSeeds.length) : null,
        teamCricket: isTeamCricket && teams
            ? initTeamCricketState(teams, document.getElementById('teamCricketRules')?.value)
            : null,
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
        } else if (isX01Game(gameType)) {
            player.score = parseInt(gameType);
        } else if (isScoreGame(gameType)) {
            // Score-entry games such as Count Up accumulate from zero.
        } else if (isTargetGame(gameType) || isTicTacToe || isDoubleDown || isTeamCricket) {
            // score stays at 0; target games accumulate runs/points/strokes
        } else {
            player.cricketData = initCricket(gameType, includeBulls);
        }

        game.players.push(player);
    });

    // Random-board Cricket variants: every player must share the SAME board.
    // initCricket() randomizes per call, so generate one final board and
    // stamp every player with their own copy of it.
    if (gameType === 'chaos' || gameType === 'wildcard') {
        const shared = initCricket(gameType);   // also sets game.cricketTargets
        game.players.forEach(p => {
            p.cricketData = JSON.parse(JSON.stringify(shared));
        });
    }

    recordRecentGame(gameType);
    refreshPicker();

    // 1e: the previous game's winning throw would otherwise still be in
    // the X01 input display (win path skips clearInput) — wipe all input
    // state at every match start.
    resetX01Input();
    resetTicTacToeInput();

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

    // Rebuild the match through beginMatch() so every engine (cricket,
    // x01, chicago, 121, target games, chaos) re-initializes correctly.
    // The hidden select still holds the current setup; force it to the
    // active game's type in case the user browsed the picker mid-game.
    const select = document.getElementById('gameType');
    if (select && select.value !== game.type) {
        select.value = game.type;
        select.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const seeds = game.players.map(p => ({ name: p.name, rosterEmail: p.rosterEmail || null }));

    // Preserve team mode + reset rotation so "Play Again" starts each team
    // from member 0.
    const preservedTeams = game.teamMode && game.teams
        ? game.teams.map(t => ({ name: t.name, members: t.members.slice(), rotationIndex: 0 }))
        : null;

    document.getElementById('winnerModal').style.display = 'none';
    beginMatch(seeds, preservedTeams);
}

// Quick Start — one tap from the picker: re-apply the last-used config
// (game, players, options) and start immediately.
function quickStartLastGame() {
    const configs = getConfigs();
    if (!configs.lastConfig) return;
    applyConfig(configs.lastConfig);
    startGame();
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
