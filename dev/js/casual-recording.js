import { game, recordingSession, saveActiveGame, restoreActiveGame, localRecordingRecoveries } from './state.js';
import { showModal, hideModal } from './ui.js';
import { RECORDING_GAMES, newRecordId, recordingComplete, recordingWinnerIds, scoringResult } from './scoring-records.js';

const HISTORY_KEY = 'blakeout_dev_casual_history';
let preparing = false;
let saving = false;

function button(text, id, action) {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'btn btn--md btn--neutral';
    element.id = id;
    element.textContent = text;
    element.addEventListener('click', action);
    return element;
}

async function verifiedProfiles() {
    const api = await import('./platform.js');
    await api.initPlatform();
    const account = api.requireVerifiedAccount();
    const profiles = await api.listProfiles();
    if (api.requireVerifiedAccount().uid !== account.uid) throw new Error('The signed-in scorekeeper changed. Try again.');
    return { api, account, profiles };
}

export function initCasualRecording() {
    if (document.getElementById('casualRecordingSetup')) return;
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = new URL('../css/casual-recording.css', import.meta.url).href;
    document.head.append(style);
    const panel = document.createElement('section');
    panel.id = 'casualRecordingSetup';
    panel.className = 'setup-section setup-panel';
    panel.innerHTML = '<label class="casual-recording-toggle"><input type="checkbox" id="recordCasualStats"> Record verified player stats (optional)</label>' +
        '<p id="casualRecordingHint"></p><details id="casualLocalHistory"><summary>Recorded games on this device</summary><div id="casualRecoveryList"></div></details>';
    document.getElementById('playSection').before(panel);
    const updateHint = () => {
        const supported = RECORDING_GAMES.has(document.getElementById('gameType').value);
        document.getElementById('casualRecordingHint').textContent = supported
            ? 'Start Game will let a verified scorekeeper link each person to a profile. Guests and normal offline play still work. Records are scorekeeper-declared, not certified results.'
            : 'This game is not recorded. It remains playable normally, including offline.';
    };
    document.getElementById('gameType').addEventListener('change', updateHint);
    document.getElementById('casualLocalHistory').addEventListener('toggle', renderCasualHistory);
    document.addEventListener('casualRecordingChanged', renderCasualHistory);
    updateHint();
    renderCasualHistory();
}

export async function prepareCasualRecording(playerSeeds, teams, force = false) {
    const gameType = document.getElementById('gameType').value;
    if ((!force && !document.getElementById('recordCasualStats')?.checked) || !RECORDING_GAMES.has(gameType)) {
        return { playerSeeds, teams, recording: null };
    }
    if (preparing) return null;
    preparing = true;
    // Slot IDs are scoped by the result ID; account identity always uses playerId.
    const sides = teams
        ? teams.map((t, i) => ({ id: `side-${i + 1}`, name: t.name, members: t.members.map((m, j) => ({ ...m, id: `human-${i + 1}-${j + 1}`, playerId: null })) }))
        : playerSeeds.map((p, i) => ({ id: `side-${i + 1}`, name: p.name, members: [{ ...p, id: `human-${i + 1}-1`, playerId: null }] }));
    const slots = sides.flatMap(side => side.members.map(member => ({ side, member })));
    document.getElementById('casualLinkModal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'casualLinkModal';
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'casualLinkTitle');
    const content = document.createElement('div');
    content.className = 'modal-content';
    content.innerHTML = '<h2 id="casualLinkTitle">Link people to verified profiles</h2>' +
        '<p>Choose by verified player ID—not by a matching name or email. Leave guests unlinked. A verified scorekeeper may record without playing.</p>' +
        '<p id="casualLinkStatus" role="status"></p><div id="casualLinkSlots"></div><div id="casualLinkActions"></div>';
    modal.append(content);
    document.body.append(modal);
    const status = content.querySelector('#casualLinkStatus');
    const selectors = slots.map(({ side, member }, i) => {
        const label = document.createElement('label');
        label.className = 'casual-link-slot';
        const name = document.createElement('span');
        name.textContent = teams ? `${side.name} · ${member.name}` : member.name;
        const select = document.createElement('select');
        select.id = `casualLink${i}`;
        select.add(new Option('Guest — no account statistics', ''));
        label.append(name, select);
        content.querySelector('#casualLinkSlots').append(label);
        return select;
    });
    let verifiedOwner = null;
    const load = async () => {
        status.textContent = 'Loading verified profiles online…';
        try {
            const { account, profiles } = await verifiedProfiles();
            verifiedOwner = account.uid;
            selectors.forEach(select => {
                const selected = select.value;
                select.replaceChildren(new Option('Guest — no account statistics', ''));
                profiles.forEach(profile => select.add(new Option(`${profile.name} · ID ${profile.id}`, profile.id)));
                if (profiles.some(p => p.id === selected)) select.value = selected;
            });
            status.textContent = `Verified scorekeeper ID: ${account.uid}. ${slots.length} human slots; scroll the list to review each one.`;
        } catch (error) {
            verifiedOwner = null;
            status.textContent = `${error.message} You can retry, or play normally without recording.`;
        }
    };
    const prepared = new Promise(resolve => {
        let finished = false;
        const finish = value => {
            if (finished) return;
            finished = true;
            hideModal('casualLinkModal');
            preparing = false;
            resolve(value);
        };
        const start = button('Start recorded game', 'casualLinkStart', async () => {
            start.disabled = true;
            try {
                const { account, profiles } = await verifiedProfiles();
                if (!verifiedOwner || account.uid !== verifiedOwner) throw new Error('Reload profiles for the current verified scorekeeper.');
                if (document.getElementById('gameType').value !== gameType) throw new Error('The selected game changed. Cancel and start again.');
                const linked = selectors.map(s => s.value).filter(Boolean);
                if (!linked.length) throw new Error('Link at least one verified player, or choose Play without recording.');
                if (new Set(linked).size !== linked.length) throw new Error('A verified player may occupy only one human slot.');
                if (linked.some(id => !profiles.some(p => p.id === id))) throw new Error('A selected profile is no longer available. Reload profiles.');
                slots.forEach(({ member }, i) => { member.playerId = selectors[i].value || null; });
                const recording = {
                    source: 'casual', resultId: newRecordId(), ownerId: account.uid,
                    gameType, bestOf: gameType === 'chicago' ? 3 : 1,
                    teams: sides.map(side => ({ ...side, members: side.members.map(({ id, playerId, name }) => ({ id, playerId, name })) })),
                    legWins: sides.map(() => 0), legComplete: false, winnerIndex: null, status: 'scoring'
                };
                finish({
                    playerSeeds: teams ? playerSeeds : sides.map(side => side.members[0]),
                    teams: teams ? sides : null, recording
                });
            } catch (error) {
                status.textContent = error.message;
            } finally {
                start.disabled = false;
            }
        });
        content.querySelector('#casualLinkActions').append(
            start,
            button('Reload verified profiles', 'casualLinkReload', load),
            button('Play without recording', 'casualLinkSkip', () => finish({ playerSeeds, teams, recording: null })),
            button('Cancel', 'casualLinkCancel', () => finish(null))
        );
    });
    showModal('casualLinkModal');
    void load();
    return prepared;
}

function savedHistory() {
    const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    if (!Array.isArray(history) || history.some(item => !item || typeof item.resultId !== 'string')) {
        throw new Error('The saved-game index is not a valid history list.');
    }
    return history;
}

function rememberSaved(session) {
    try {
        const history = savedHistory();
        const item = { resultId: session.resultId, ownerId: session.ownerId, gameType: session.gameType, savedAt: Date.now() };
        localStorage.setItem(HISTORY_KEY, JSON.stringify([item, ...history.filter(x => x.resultId !== item.resultId)].slice(0, 50)));
        return true;
    } catch (error) {
        console.warn('[Casual recording] Could not update the local saved-game index.', error);
        return false;
    }
}

export async function saveCasualResult() {
    const session = game.recording;
    if (!session || !recordingComplete() || session.status === 'saved' || saving) return;
    if (!confirm('Save these scorekeeper-declared casual results and actual dart statistics? They are not certified competition results.')) return;
    const winnerIds = recordingWinnerIds();
    game.scoringRecords.winnerIds = winnerIds;
    session.pendingResult ||= {
        ...scoringResult(), matchId: session.resultId,
        winnerId: winnerIds.length === 1 ? winnerIds[0] : null
    };
    session.status = 'pending';
    if (!saveActiveGame()) return;
    saving = true;
    session.status = 'saving';
    const notify = message => document.dispatchEvent(new CustomEvent('casualRecordingChanged', { detail: { message } }));
    notify('Verifying and saving casual result…');
    try {
        const { api, account, profiles } = await verifiedProfiles();
        if (account.uid !== session.ownerId) throw new Error('Sign in as the original verified scorekeeper to save this record.');
        if (session.pendingResult.participantIds.some(id => !profiles.some(p => p.id === id))) throw new Error('A linked player profile is no longer available.');
        await api.saveCasualResult(session.resultId, session.pendingResult);
        session.status = 'saved';
        game.undoHistory = [];
        game.redoHistory = [];
        saveActiveGame();
        const historySaved = rememberSaved(session);
        notify(historySaved
            ? 'Casual result saved. Local history is in setup; linked players can view their statistics in Accounts.'
            : 'Result saved to the cloud, but the local history index could not be updated. Linked players can still view their statistics in Accounts.');
    } catch (error) {
        session.status = 'pending';
        saveActiveGame();
        notify(`Not saved: ${error.message}. Kept on this device; reconnect and retry Save casual result.`);
    } finally {
        saving = false;
        const save = document.getElementById('casualSaveResult');
        if (save) save.disabled = session.status === 'saved';
    }
}

export function renderCasualHistory() {
    const list = document.getElementById('casualRecoveryList');
    if (!list) return;
    list.replaceChildren();
    const recoveries = localRecordingRecoveries();
    for (const saved of recoveries) {
        const session = saved.recording;
        const row = document.createElement('div');
        row.className = 'casual-history-row';
        const label = document.createElement('span');
        label.textContent = `${session.gameType.toUpperCase()} · ${session.status === 'saved' ? 'Saved' : 'Local / not sent'} · ${session.teams.map(t => t.name).join(' vs ')}`;
        row.append(label, button('Resume', `casualResume-${session.resultId}`, async () => {
            if (recordingSession()?.status === 'saving') {
                alert('Wait for the current result save to finish before resuming another game.');
                return;
            }
            if (game.players.length && recordingSession()?.resultId !== session.resultId &&
                !confirm('Resume this recorded game instead? Any current recorded game will remain on this device.')) return;
            restoreActiveGame(saved);
            if (!saveActiveGame()) return;
            const { resumeGame } = await import('./setup.js');
            resumeGame();
        }));
        list.append(row);
    }
    try {
        const history = savedHistory();
        if (history.length) {
            for (const saved of history.filter(item => !recoveries.some(r => r.recording.resultId === item.resultId))) {
                const row = document.createElement('p');
                row.textContent = `${saved.gameType.toUpperCase()} · Saved ${new Date(saved.savedAt).toLocaleString()} · Scorekeeper ID ${saved.ownerId}`;
                list.append(row);
            }
            const note = document.createElement('p');
            note.textContent = `${history.length} recent confirmed casual records on this device. Linked players can view their full statistics in Accounts.`;
            list.append(note);
        }
    } catch (error) {
        console.warn('[Casual recording] Could not read the local saved-game index.', error);
        const warning = document.createElement('p');
        warning.setAttribute('role', 'alert');
        warning.textContent = 'Saved-game history could not be read on this device. Pending games above are separate and have not been removed; cloud records remain available in Accounts.';
        list.append(warning);
    }
    if (!list.children.length) list.textContent = 'No local recorded games yet.';
}
