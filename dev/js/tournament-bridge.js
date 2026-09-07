import { game, saveActiveGame, loadActiveGame, restoreActiveGame, saveGameState } from './state.js';
import { launchTournamentScorer, resumeGame } from './setup.js';
import { showModal, hideModal } from './ui.js';
import { updateCricketDisplay } from './cricket.js';
import { newRecordId, finishScoringLeg, scoringStats, tournamentScoringLocked } from './scoring-records.js';

const LAUNCH_KEY = 'blakeout_dev_match_launch';
const SUPPORTED = new Set(['chicago', '301', '501', 'cricket', 'spanish']);
let saving = false;
let initialized = false;

async function platform() {
    const api = await import('./platform.js');
    await api.initPlatform();
    await api.requireVerifiedAccount();
    const account = api.getAccount();
    if (!account?.uid) throw new Error('Sign in with a verified account first.');
    return { api, account };
}

export function authoritativeMatch(tournament, matchId, ownerId, allowComplete = false) {
    if (!tournament || tournament.ownerId !== ownerId) throw new Error('Only the tournament owner can launch or save this match.');
    if (tournament.status !== 'live' && !(allowComplete && tournament.status === 'complete')) {
        throw new Error('The tournament is not live. Return to brackets to refresh.');
    }
    if (!SUPPORTED.has(tournament.gameType)) throw new Error('This game is not enabled for tournaments.');
    if (!Number.isSafeInteger(tournament.bestOf) || tournament.bestOf < 1 || tournament.bestOf > 99 || tournament.bestOf % 2 !== 1 ||
        (tournament.gameType === 'chicago' && tournament.bestOf !== 3)) throw new Error('Invalid match format.');
    const match = tournament.matches.find(m => m.id === matchId);
    if (!match || (match.status !== 'ready' && !(allowComplete && match.status === 'complete'))) {
        throw new Error('This match is no longer ready. Return to brackets to refresh.');
    }
    const teams = [match.teamA, match.teamB].map(id => {
        const team = tournament.teams.find(t => t.id === id);
        if (!team || !team.memberIds?.length) throw new Error('The match team roster is incomplete.');
        return {
            id: team.id, name: team.name,
            members: team.memberIds.map(id => {
                const member = tournament.registrations.find(r => r.id === id);
                if (!member || !member.checkedIn || member.standby) throw new Error('A team member is no longer eligible.');
                return { id: member.id, playerId: member.playerId || null, name: member.name };
            })
        };
    });
    return { match, teams };
}

function note(text) {
    let node = document.getElementById('tournamentBridgeNotice');
    if (!node) {
        node = document.createElement('div');
        node.id = 'tournamentBridgeNotice';
        node.setAttribute('role', 'status');
        document.getElementById('setupScreen').prepend(node);
    }
    node.textContent = text;
}

function recoverMatch(tournamentId, matchId) {
    const active = loadActiveGame();
    if (active?.tournament?.tournamentId === tournamentId && active.tournament.matchId === matchId) return active;
    let latest = null;
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key.startsWith('blakeout_dev_match_') || key === LAUNCH_KEY) continue;
        try {
            const saved = JSON.parse(localStorage.getItem(key));
            if (saved?.tournament?.tournamentId === tournamentId && saved.tournament.matchId === matchId &&
                (!latest || saved.timestamp > latest.timestamp)) latest = saved;
        } catch { /* A malformed unrelated recovery copy is not a launch request. */ }
    }
    return latest;
}

export async function launchRequestedMatch() {
    try {
        const request = JSON.parse(localStorage.getItem(LAUNCH_KEY));
        if (!request?.tournamentId || !request.matchId) throw new Error('Missing tournament launch request. Return to brackets.');
        note('Verifying tournament ownership and current match online…');
        const { api, account } = await platform();
        const tournament = await api.getTournament(request.tournamentId);
        const existing = recoverMatch(request.tournamentId, request.matchId);
        const retrying = existing && ['pending', 'saving', 'saved'].includes(existing.tournament.status);
        const { teams } = authoritativeMatch(tournament, request.matchId, account.uid, retrying);
        const active = loadActiveGame();
        const replacingOrdinary = active?.players?.length && !active.tournament;
        if (replacingOrdinary && !confirm('Replace your saved ordinary game with this tournament match? Cancel keeps the ordinary game available with Resume.')) {
            note('Tournament launch cancelled. Your ordinary game is unchanged; use Resume to continue.');
            return;
        }
        if (existing) {
            if (JSON.stringify(existing.tournament.teams) !== JSON.stringify(teams) ||
                existing.tournament.gameType !== tournament.gameType || existing.tournament.bestOf !== tournament.bestOf) {
                throw new Error('The team roster or format changed. Your local result is kept, but cannot be applied to this match.');
            }
            restoreActiveGame(existing);
            saveActiveGame();
            resumeGame();
        } else {
            if (tournament.revision !== request.revision) throw new Error('The bracket changed. Refresh brackets and launch again.');
            if (!replacingOrdinary && game.players.length && !confirm('Start this tournament match instead of the current game?')) {
                note('Tournament launch cancelled. Your current game is unchanged.');
                return;
            }
            launchTournamentScorer({
                tournamentId: tournament.id, matchId: request.matchId, revision: tournament.revision,
                ownerId: account.uid, gameType: tournament.gameType, bestOf: tournament.bestOf,
                teams, resultId: newRecordId(), legWins: [0, 0], legComplete: false,
                winnerIndex: null, status: 'scoring'
            });
        }
        renderTournamentControls();
        note('');
    } catch (error) {
        note(`Tournament not launched: ${error.message} Saved matches remain available with Resume; scoring can continue offline, but saving requires online verification.`);
    }
}

function seriesComplete() {
    return game.tournament && Math.max(...game.tournament.legWins) >= Math.floor(game.tournament.bestOf / 2) + 1;
}

function button(label, id, handler) {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'btn';
    node.id = id;
    node.textContent = label;
    node.addEventListener('click', handler);
    return node;
}

function returnToBrackets() {
    if (!saveActiveGame() || !confirm('Return to brackets? Unsaved scoring stays on this device; no result will be sent.')) return;
    const url = new URL('../brackets/', import.meta.url);
    url.searchParams.set('id', game.tournament.tournamentId);
    location.href = url.href;
}

function nextLeg() {
    if (!game.tournament?.legComplete || seriesComplete() || saving) return;
    if (!confirm('Confirm this leg and start the next leg? Previous legs will be retained.')) return;
    if (!saveActiveGame()) return;
    const tournament = game.tournament;
    const records = game.scoringRecords;
    tournament.legComplete = false;
    tournament.winnerIndex = null;
    hideModal('winnerModal');
    launchTournamentScorer(tournament, records);
    game.currentPlayer = (records.legs.length - 1) % 2;
    saveActiveGame();
    document.dispatchEvent(new CustomEvent('chicagoLegReady'));
    renderTournamentControls();
}

export async function saveTournamentResult() {
    if (!seriesComplete() || saving || game.tournament.status === 'saved') return;
    if (!confirm('Save this tournament result and the registered players’ actual dart statistics?')) return;
    const session = game.tournament;
    const winnerId = session.teams[session.winnerIndex].id;
    session.pendingResult ||= {
        matchId: session.matchId, gameType: session.gameType, winnerId,
        scoreA: session.legWins[0], scoreB: session.legWins[1],
        legScores: game.scoringRecords.legs.map(({ id, gameType, winnerId }) => ({ id, gameType, winnerId })),
        records: JSON.parse(JSON.stringify(game.scoringRecords)),
        participantIds: [...new Set(session.teams.flatMap(t => t.members.map(m => m.playerId)).filter(Boolean))],
        perPlayer: scoringStats(game.scoringRecords)
    };
    session.status = 'pending';
    if (!saveActiveGame()) return;
    saving = true;
    session.status = 'saving';
    renderTournamentControls('Verifying and saving…');
    try {
        const { api, account } = await platform();
        const tournament = await api.getTournament(session.tournamentId);
        const { teams } = authoritativeMatch(tournament, session.matchId, account.uid, true);
        if (account.uid !== session.ownerId || JSON.stringify(teams) !== JSON.stringify(session.teams) ||
            tournament.gameType !== session.gameType || tournament.bestOf !== session.bestOf) {
            throw new Error('The owner, teams, or format changed. Local result retained for review.');
        }
        const { recordResult } = await import('./brackets/engine.js');
        await api.saveMatchResult(session.tournamentId, tournament.revision, session.resultId,
            session.pendingResult, current => {
                authoritativeMatch(current, session.matchId, account.uid);
                return recordResult(current, session.matchId, { winnerId, scoreA: session.legWins[0], scoreB: session.legWins[1] });
            });
        session.status = 'saved';
        game.undoHistory = [];
        game.redoHistory = [];
        saveActiveGame();
        renderTournamentControls('Result saved. You can return to brackets.');
    } catch (error) {
        session.status = 'pending';
        saveActiveGame();
        renderTournamentControls(`Not saved: ${error.message}. Your result is kept on this device. Reconnect and retry Save tournament result.`);
    } finally {
        saving = false;
        const save = document.getElementById('tournamentSaveResult');
        if (save) save.disabled = session.status === 'saved';
    }
}

export function renderTournamentControls(message = '') {
    const session = game.tournament;
    const screen = document.getElementById('gameScreen');
    screen.toggleAttribute('data-tournament', !!session);
    let controls = document.getElementById('tournamentScoringControls');
    if (!controls) {
        controls = document.createElement('section');
        controls.id = 'tournamentScoringControls';
        controls.setAttribute('aria-label', 'Tournament scoring');
        screen.prepend(controls);
    }
    controls.hidden = !session;
    for (const id of ['playAgainBtn', 'newGameBtn']) {
        document.getElementById(id).hidden = !!session;
    }
    document.getElementById('winnerCancelBtn').hidden = !!session && ['pending', 'saving', 'saved'].includes(session.status);
    let panel = document.getElementById('tournamentResultPanel');
    if (!panel) {
        panel = document.createElement('section');
        panel.id = 'tournamentResultPanel';
        document.querySelector('#winnerModal .modal-content').append(panel);
    }
    panel.replaceChildren();
    panel.hidden = !session;
    let returnButton = document.getElementById('tournamentReturn');
    if (!returnButton) {
        returnButton = button('Return to tournament brackets', 'tournamentReturn', returnToBrackets);
        document.querySelector('#gameMenuModal h2').after(returnButton);
    }
    returnButton.hidden = !session;
    if (!session) return;
    if (session.legComplete) {
        document.getElementById('winnerName').textContent = `${session.teams[session.winnerIndex].name} wins — ${session.legWins.join(' – ')}`;
    }
    controls.replaceChildren();
    const effectiveType = game.chicago?.currentGameType || game.type;
    const status = document.createElement('span');
    status.className = 'tournament-series';
    status.textContent = `Series ${session.legWins.join(' – ')} · best of ${session.bestOf}`;
    controls.append(status);
    const label = document.createElement('label');
    label.className = 'tournament-darts-label';
    label.textContent = 'Actual darts';
    label.hidden = !['301', '501'].includes(effectiveType);
    const select = document.createElement('select');
    select.id = 'tournamentActualDarts';
    select.innerHTML = '<option value="">Choose</option><option value="1">1</option><option value="2">2</option><option value="3">3</option>';
    label.append(select);
    const miss = button('Miss dart', 'tournamentMissDart', () => {
        const type = game.chicago?.currentGameType || game.type;
        if (!['cricket', 'spanish'].includes(type) || tournamentScoringLocked() || game.pendingDarts.length >= 3) return;
        saveGameState();
        game.pendingDarts.push({ target: 'MISS', multiplier: 0 });
        saveActiveGame();
        updateCricketDisplay();
    });
    miss.hidden = !['cricket', 'spanish'].includes(effectiveType);
    controls.append(label, miss, button('Help', 'tournamentHelp', () => showModal('tournamentHelpModal')));
    if (!document.getElementById('tournamentHelpModal')) {
        const help = document.createElement('div');
        help.id = 'tournamentHelpModal';
        help.className = 'modal';
        help.style.display = 'none';
        help.setAttribute('role', 'dialog');
        help.setAttribute('aria-modal', 'true');
        help.setAttribute('aria-labelledby', 'tournamentHelpTitle');
        const content = document.createElement('div');
        content.className = 'modal-content';
        content.innerHTML = '<h2 id="tournamentHelpTitle">Tournament scoring</h2>' +
            '<p><strong>301 / 501:</strong> select the actual darts thrown on every turn, including misses and the bust or checkout dart. Follow the selected finish rules.</p>' +
            '<p><strong>Cricket / Spanish:</strong> enter every dart in order, using Miss dart for individual misses. Press ENTER after three darts or the winning dart. The regular MISS button records a whole three-dart missed turn.</p>' +
            '<p>Progress stays on this device offline. Guests play without account statistics. Results are sent only after you confirm Save tournament result. Use Menu to return to brackets.</p>';
        content.append(button('Back to scoring', 'tournamentHelpClose', () => hideModal('tournamentHelpModal')));
        help.append(content);
        document.body.append(help);
    }
    const text = document.createElement('p');
    text.setAttribute('role', 'status');
    text.textContent = message || `Series: ${session.legWins.join(' – ')}. ${session.status === 'saved' ? 'Saved.' : 'Not yet sent.'}`;
    panel.append(text);
    if (session.legComplete && !seriesComplete() && !game.chicago) {
        panel.append(button('Next leg', 'tournamentNextLeg', nextLeg));
    }
    if (seriesComplete()) {
        const save = button('Save tournament result', 'tournamentSaveResult', saveTournamentResult);
        save.disabled = saving || session.status === 'saved';
        panel.append(save);
    }
    panel.append(button('Return to brackets', 'tournamentResultReturn', returnToBrackets));
}

export function initTournamentBridge() {
    if (initialized) return;
    initialized = true;
    document.addEventListener('scorerLegWon', event => {
        finishScoringLeg(event.detail.winnerIndex);
        if (game.tournament) saveActiveGame();
    });
    document.addEventListener('scorerWinnerShown', () => renderTournamentControls());
    document.addEventListener('chicagoLegReady', () => renderTournamentControls());
    document.addEventListener('scorerRestored', () => {
        renderTournamentControls();
        if (game.tournament?.legComplete && (!game.chicago || seriesComplete())) showModal('winnerModal');
        else hideModal('winnerModal');
    });
    document.addEventListener('tournamentStorageError', () => {
        alert('Local storage is full or unavailable. This tournament cannot be safely saved. Keep this page open and free storage before continuing.');
    });
    if (new URLSearchParams(location.search).get('tournamentMatch') === '1') launchRequestedMatch();
}
