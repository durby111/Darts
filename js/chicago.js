/* ============================================
   Chicago Mode
   Best of 3 legs, alternating game picker
   ============================================ */

import { game, initCricket } from './state.js';
import { showModal, hideModal, showWinner, updateUndoRedoButtons } from './ui.js';

export function initChicagoControls() {
    // Chicago game selection buttons
    document.querySelectorAll('[data-chicago]').forEach(btn => {
        btn.addEventListener('click', () => {
            selectChicagoGame(btn.dataset.chicago);
        });
    });

    // Continue button after leg win
    document.getElementById('chicagoContinueBtn').addEventListener('click', continueChicago);

    // Listen for leg win events from cricket/x01
    document.addEventListener('chicagoLegWin', (e) => {
        handleChicagoLegWin(e.detail.winnerIndex);
    });
}

export function showChicagoGameSelection() {
    const picker = game.chicago.whoPicksNext;
    const playerName = game.players[picker].name;
    const remaining = game.chicago.gamesRemaining;

    document.getElementById('chicagoGameTitle').textContent = `Leg ${game.chicago.currentLeg} - Choose Game`;
    document.getElementById('chicagoPlayerPicking').textContent = `${playerName}'s pick`;

    document.getElementById('chicagoCricketBtn').style.display = remaining.includes('cricket') ? 'block' : 'none';
    document.getElementById('chicago301Btn').style.display = remaining.includes('301') ? 'block' : 'none';
    document.getElementById('chicago501Btn').style.display = remaining.includes('501') ? 'block' : 'none';

    showModal('chicagoGameModal');
}

function selectChicagoGame(selectedGame) {
    hideModal('chicagoGameModal');

    game.chicago.gamesRemaining = game.chicago.gamesRemaining.filter(g => g !== selectedGame);
    game.chicago.gamesPlayed.push(selectedGame);
    game.chicago.currentGameType = selectedGame;

    initChicagoLeg(selectedGame);
}

function initChicagoLeg(gameType) {
    game.players.forEach(player => {
        player.score = 0;
        player.throws = 0;
        player.totalMarks = 0;
        player.history = [];
        player.lastTurnMarks = {};

        if (['301', '501'].includes(gameType)) {
            player.score = parseInt(gameType);
            delete player.cricketData;
        } else if (gameType === 'cricket') {
            player.cricketData = initCricket('cricket');
        }
    });

    game.currentPlayer = 0;
    game.completedRounds = 0;
    game.pendingDarts = [];
    game.currentInput = '';
    game.undoHistory = [];
    game.redoHistory = [];

    // Dispatch event so app.js can call updateDisplay
    document.dispatchEvent(new CustomEvent('chicagoLegReady'));
}

function handleChicagoLegWin(winnerIndex) {
    const winner = game.players[winnerIndex];
    game.chicago.legWins[winnerIndex]++;

    // Check if match is won (2 leg wins)
    const maxWins = Math.max(...game.chicago.legWins);
    if (maxWins >= 2) {
        showWinner(winner.name, false, true);
        return;
    }

    // Show leg winner modal
    document.getElementById('chicagoLegTitle').textContent = `Leg ${game.chicago.currentLeg} Complete!`;
    document.getElementById('chicagoLegWinner').textContent = `${winner.name} wins!`;

    const scoreDisplay = game.players.map((p, i) => `${p.name}: ${game.chicago.legWins[i]}`).join(' - ');
    document.getElementById('chicagoMatchScore').textContent = scoreDisplay;

    showModal('chicagoLegModal');
}

function continueChicago() {
    hideModal('chicagoLegModal');

    game.chicago.currentLeg++;
    game.chicago.whoPicksNext = (game.chicago.whoPicksNext + 1) % game.players.length;

    showChicagoGameSelection();
}
