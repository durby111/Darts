import { game, saveGameState, saveActiveGame } from './state.js';
import { activeBot, hasBots, supportsBot, x01Turn, cricketTurn, SUPPORTED_CRICKET } from './botblake-engine.js';
import { submitBotX01 } from './x01.js';
import { cricketConfirm } from './cricket.js';

// One pending turn per exact state. Re-check immediately before committing.
// Undo pauses automation so corrections and redo remain usable.
export function initBotBlake() {
    const status = document.createElement('div');
    status.id = 'botStatus'; status.setAttribute('role', 'status');
    const label = document.createElement('span');
    const resume = document.createElement('button');
    resume.className = 'btn btn--sm btn--neutral'; resume.textContent = 'Continue BotBlake';
    status.append(label, resume);
    document.getElementById('gameScreen').prepend(status);
    let paused = false, key = '', due = 0, lastPlayers = game.players;
    resume.addEventListener('click', () => { paused = false; key = ''; });
    document.addEventListener('botMatchStarted', () => { paused = false; key = ''; });
    document.addEventListener('scorerRestored', () => { paused = !!activeBot(game); key = ''; });
    const visible = id => { const el = document.getElementById(id); return el && getComputedStyle(el).display !== 'none'; };
    const eligible = () => !document.hidden && hasBots(game) && supportsBot(game.type) && !game.recording && !game.tournament && activeBot(game) && visible('gameScreen') && !['setupScreen','teamBuilderScreen','winnerModal','gameMenuModal'].some(visible) && !game.players.some(p => SUPPORTED_CRICKET.includes(game.type) ? game.cricketTargets.every(t => p.cricketData[t].closed) && (!game.cricketPoints || game.players.every(q => game.type === 'cutthroat' ? p.score <= q.score : p.score >= q.score)) : p.score === 0);
    // Prevent manual scoring while the bot owns the board; keep menu/undo usable.
    const guard = e => {
        if (!hasBots(game) || !activeBot(game) || !visible('gameScreen') || visible('setupScreen')) return;
        const target = e.target;
        if (target.closest('#botStatus, [id*="undo" i], [id*="redo" i], #menuBtn, #gameMenuModal, #winnerModal')) return;
        if (e.type === 'keydown' || target.closest('#x01Controls, #cricketControls, #cricketMain, #scoreHeader')) { e.preventDefault(); e.stopImmediatePropagation(); }
    };
    ['pointerdown','click','keydown'].forEach(type=>document.addEventListener(type,guard,true));
    setInterval(() => {
        if (game.players !== lastPlayers) { lastPlayers = game.players; key = ''; }
        const ready = eligible();
        status.hidden = !ready;
        resume.hidden = !paused;
        if (!ready) { key = ''; return; }
        const person = game.teamMode ? game.teams[game.currentPlayer].members[game.teams[game.currentPlayer].rotationIndex] : game.players[game.currentPlayer];
        label.textContent = `${person.name} · ${person.bot.skill} skill${paused ? ' — paused after restore. ' : ' — throwing…'}`;
        if (paused) return;
        const nextKey = JSON.stringify([game.type,game.players,game.teams,game.currentPlayer,game.completedRounds,game.pendingDarts,game.undoHistory.length]);
        if (nextKey !== key) { key = nextKey; due = Date.now()+1100; return; }
        if (Date.now()<due) return;
        key = '';
        if (SUPPORTED_CRICKET.includes(game.type)) {
            // Commit one atomic three-dart turn; the existing engine owns scoring/wins.
            const darts = cricketTurn(game);
            if (!darts.length) return;
            saveGameState(); game.pendingDarts = darts; cricketConfirm();
        } else submitBotX01(x01Turn(game));
        saveActiveGame();
    }, 100);
}
