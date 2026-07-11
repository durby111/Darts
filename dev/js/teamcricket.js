/* ============================================
   Team Cricket / 400

   Exactly two teams of two. Every human owns individual
   marks; teammates share one score. Both teammates must
   close a target before the team scores on it. A team can
   lead by at most 400 points.

   Traditional: both teammates close the board to win.
   New: one teammate may close the board to win.
   Both require equal or more team points.
   ============================================ */

import {
    game, saveGameState, saveActiveGame,
    undoLastAction
} from './state.js';
import {
    getMarkSymbol, updatePlayerHeaders,
    updateRoundBadge, updateUndoRedoButtons,
    showWinner
} from './ui.js';
import { currentThrower, advanceRotation } from './teams.js';

const TARGETS = ['20', '19', '18', '17', '16', '15', 'Bull'];
const SPREAD_LIMIT = 400;
let controlsInitialized = false;

function blankMarks() {
    return Object.fromEntries(TARGETS.map(target => [target, 0]));
}

export function initTeamCricketState(teams, rules) {
    return {
        rules: rules === 'new' ? 'new' : 'traditional',
        targets: TARGETS.slice(),
        memberMarks: teams.map(team => team.members.map(blankMarks)),
        spreadLimit: SPREAD_LIMIT
    };
}

function activeMemberIndex(teamIndex = game.currentPlayer) {
    const team = game.teams[teamIndex];
    return team.rotationIndex % team.members.length;
}

function pendingMarksFor(target) {
    return game.pendingDarts.reduce((total, dart) =>
        total + (dart.target === target ? dart.multiplier : 0), 0);
}

function effectiveMarks(teamIndex, memberIndex, target) {
    const base = game.teamCricket.memberMarks[teamIndex][memberIndex][target];
    if (teamIndex !== game.currentPlayer || memberIndex !== activeMemberIndex()) return base;
    return Math.min(3, base + pendingMarksFor(target));
}

function teamClosedTarget(teamIndex, target, pending = true) {
    return game.teamCricket.memberMarks[teamIndex].every((marks, memberIndex) => {
        const value = pending ? effectiveMarks(teamIndex, memberIndex, target) : marks[target];
        return value >= 3;
    });
}

function opponentClosedTarget(teamIndex, target) {
    return teamClosedTarget(1 - teamIndex, target, false);
}

function rawPendingPoints() {
    const teamIndex = game.currentPlayer;
    const memberIndex = activeMemberIndex();
    const local = { ...game.teamCricket.memberMarks[teamIndex][memberIndex] };
    let points = 0;

    game.pendingDarts.forEach(dart => {
        const before = local[dart.target];
        const after = before + dart.multiplier;
        local[dart.target] = Math.min(3, after);
        const excess = Math.max(0, after - 3) - Math.max(0, before - 3);
        if (!excess) return;

        const partnerIndex = memberIndex === 0 ? 1 : 0;
        const partnerClosed = game.teamCricket.memberMarks[teamIndex][partnerIndex][dart.target] >= 3;
        const activeClosed = local[dart.target] >= 3;
        if (partnerClosed && activeClosed && !opponentClosedTarget(teamIndex, dart.target)) {
            points += excess * (dart.target === 'Bull' ? 25 : Number(dart.target));
        }
    });
    return points;
}

function pendingPoints() {
    const raw = rawPendingPoints();
    const teamIndex = game.currentPlayer;
    const room = game.players[1 - teamIndex].score + SPREAD_LIMIT - game.players[teamIndex].score;
    return Math.max(0, Math.min(raw, room));
}

function memberHeading(teamIndex, memberIndex) {
    const member = game.teams[teamIndex].members[memberIndex];
    const active = teamIndex === game.currentPlayer && memberIndex === activeMemberIndex();
    return `<div class="team-cricket-member-heading${active ? ' active' : ''}">
        <span>${escapeHtml(member.name)}</span><small>${teamIndex === 0 ? 'HOME' : 'AWAY'}</small>
    </div>`;
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[character]));
}

function markCell(teamIndex, memberIndex, target) {
    const stored = game.teamCricket.memberMarks[teamIndex][memberIndex][target];
    const pending = teamIndex === game.currentPlayer && memberIndex === activeMemberIndex()
        ? pendingMarksFor(target)
        : 0;
    const active = teamIndex === game.currentPlayer && memberIndex === activeMemberIndex();
    return `<div class="team-cricket-mark-cell${active ? ' active' : ''}">
        ${getMarkSymbol(stored, pending, true, false, target, false, teamIndex * 2 + memberIndex)}
    </div>`;
}

function targetButtons(target) {
    const label = target === 'Bull' ? 'B' : target;
    return `<div class="team-cricket-target-buttons">
        <button data-team-cricket-target="${target}" data-team-cricket-mult="2">D</button>
        <button data-team-cricket-target="${target}" data-team-cricket-mult="1">${label}</button>
        ${target === 'Bull'
            ? '<span class="team-cricket-button-spacer"></span>'
            : `<button data-team-cricket-target="${target}" data-team-cricket-mult="3">T</button>`}
    </div>`;
}

function renderBoard() {
    const headings = document.getElementById('teamCricketHeadings');
    if (headings) {
        headings.innerHTML = memberHeading(0, 0) + memberHeading(0, 1)
            + '<div class="team-cricket-center-heading">TARGET</div>'
            + memberHeading(1, 0) + memberHeading(1, 1);
    }
    const grid = document.getElementById('teamCricketGrid');
    if (!grid) return;
    grid.innerHTML = TARGETS.map(target => `<div class="team-cricket-row">
        ${markCell(0, 0, target)}
        ${markCell(0, 1, target)}
        ${targetButtons(target)}
        ${markCell(1, 0, target)}
        ${markCell(1, 1, target)}
    </div>`).join('');
}

function updatePending() {
    const text = document.getElementById('teamCricketPending');
    if (!text) return;
    const points = pendingPoints();
    const hits = game.pendingDarts.map(dart => {
        const prefix = dart.multiplier === 3 ? 'T' : dart.multiplier === 2 ? 'D' : '';
        return prefix + (dart.target === 'Bull' ? 'B' : dart.target);
    });
    const pointText = points ? ` — +${points} team points` : '';
    text.textContent = hits.length
        ? `${hits.join(' • ')}${pointText}`
        : `${currentThrower(game.currentPlayer)?.name || 'Player'} throwing — up to 3 darts`;
}

function rulesLabel() {
    const label = document.getElementById('teamCricketRulesLabel');
    if (!label) return;
    label.textContent = game.teamCricket.rules === 'new'
        ? 'New rules: one teammate may close the board · 400 spread limit'
        : 'Traditional: both teammates must close the board · 400 spread limit';
}

export function updateTeamCricketDisplay() {
    renderBoard();
    const scoreIds = ['homeScore', 'awayScore'];
    game.players.forEach((team, index) => {
        const preview = index === game.currentPlayer ? pendingPoints() : 0;
        const element = document.getElementById(scoreIds[index]);
        if (element) element.textContent = team.score + preview;
    });
    ['homeMPR','homeMPR2','awayMPR','awayMPR2'].forEach(id => {
        const element = document.getElementById(id);
        if (element) element.style.display = 'none';
    });
    const noDartsLeft = game.pendingDarts.length >= 3;
    document.querySelectorAll('[data-team-cricket-target]').forEach(button => {
        button.disabled = noDartsLeft;
    });
    const undo = document.getElementById('teamCricketUndoBtn');
    if (undo) undo.disabled = !game.undoHistory.length;
    rulesLabel();
    updatePending();
    updatePlayerHeaders();
    updateRoundBadge();
    updateUndoRedoButtons();
}

function recordHit(target, multiplier) {
    if (game.pendingDarts.length >= 3) return;
    saveGameState();
    game.pendingDarts.push({ target, multiplier });
    updateTeamCricketDisplay();
}

function memberClosedBoard(teamIndex, memberIndex) {
    return TARGETS.every(target =>
        game.teamCricket.memberMarks[teamIndex][memberIndex][target] >= 3);
}

function teamMeetsClosureRule(teamIndex) {
    if (game.teamCricket.rules === 'new') {
        return game.teamCricket.memberMarks[teamIndex].some((_, memberIndex) =>
            memberClosedBoard(teamIndex, memberIndex));
    }
    return game.teamCricket.memberMarks[teamIndex].every((_, memberIndex) =>
        memberClosedBoard(teamIndex, memberIndex));
}

function teamHasWon(teamIndex) {
    return teamMeetsClosureRule(teamIndex)
        && game.players[teamIndex].score >= game.players[1 - teamIndex].score;
}

function commitTurn() {
    saveGameState();
    const teamIndex = game.currentPlayer;
    const memberIndex = activeMemberIndex();
    const marks = game.teamCricket.memberMarks[teamIndex][memberIndex];
    const points = pendingPoints();
    game.pendingDarts.forEach(dart => {
        marks[dart.target] = Math.min(3, marks[dart.target] + dart.multiplier);
    });
    game.players[teamIndex].score += points;
    game.players[teamIndex].throws++;
    game.players[teamIndex].history.push({
        round: game.completedRounds + 1,
        thrower: currentThrower(teamIndex)?.name || null,
        hits: game.pendingDarts.map(dart => ({ ...dart })),
        points
    });
    game.pendingDarts = [];

    if (teamHasWon(teamIndex)) {
        saveActiveGame();
        updateTeamCricketDisplay();
        showWinner(game.players[teamIndex].name, false, true);
        return;
    }

    advanceRotation(teamIndex);
    game.currentPlayer = 1 - teamIndex;
    if (game.currentPlayer === 0) game.completedRounds++;
    saveActiveGame();
    updateTeamCricketDisplay();
}

function missTurn() {
    saveGameState();
    const teamIndex = game.currentPlayer;
    game.players[teamIndex].throws++;
    game.players[teamIndex].history.push({
        round: game.completedRounds + 1,
        thrower: currentThrower(teamIndex)?.name || null,
        miss: true,
        points: 0
    });
    game.pendingDarts = [];
    advanceRotation(teamIndex);
    game.currentPlayer = 1 - teamIndex;
    if (game.currentPlayer === 0) game.completedRounds++;
    saveActiveGame();
    updateTeamCricketDisplay();
}

export function initTeamCricketControls() {
    if (controlsInitialized) return;
    controlsInitialized = true;
    document.getElementById('teamCricketGrid')?.addEventListener('pointerdown', event => {
        const button = event.target.closest('[data-team-cricket-target]');
        if (!button) return;
        event.preventDefault();
        recordHit(button.dataset.teamCricketTarget, Number(button.dataset.teamCricketMult));
    });
    document.getElementById('teamCricketUndoBtn')?.addEventListener('pointerdown', event => {
        event.preventDefault();
        undoLastAction(() => updateTeamCricketDisplay());
    });
    document.getElementById('teamCricketMissBtn')?.addEventListener('pointerdown', event => {
        event.preventDefault();
        if (game.pendingDarts.length) return;
        missTurn();
    });
    document.getElementById('teamCricketEnterBtn')?.addEventListener('pointerdown', event => {
        event.preventDefault();
        if (!game.pendingDarts.length) return;
        commitTurn();
    });
}
