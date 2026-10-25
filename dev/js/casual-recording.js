import { BACKEND_KEY, requireCurrentBackend } from './backend-context.js';
import { game, recordingSession, saveActiveGame, restoreActiveGame, localRecordingRecoveries } from './state.js';
import { showModal, hideModal } from './ui.js';
import { RECORDING_GAMES, newRecordId, recordingComplete, recordingWinnerIds, scoringResult } from './scoring-records.js';
import { isFeatureAvailable } from './feature-availability.js';
import { BUILD_STORAGE } from './build-context.js';
import { recordingStartProblem } from './recording-start-state.js';

const HISTORY_KEY = BUILD_STORAGE.casualRecoveryPrefix + 'history';
const ACCOUNTS_NOTICE = 'DEV uses sample Players & Records. Cloud saving is unavailable; your recorded games and results stay on this device. Use Resume to continue local scoring.';
function personalHistoryAllowed(gameType, ids, uid) {
    return ['501', 'cricket'].includes(gameType) && ids.length === 1 && ids[0] === uid;
}

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

async function verifiedProfiles(ids = null, cursor = null) {
    if (!isFeatureAvailable('accounts')) throw new Error(ACCOUNTS_NOTICE);
    const api = await import('./platform.js');
    await api.initPlatform();
    const account = api.requireVerifiedAccount();
    const page = ids === null ? await api.listProfilePage(cursor) : { profiles: await api.getProfilesByIds(ids), nextCursor: null };
    const profiles = page.profiles;
    if (api.requireVerifiedAccount().uid !== account.uid) throw new Error('The signed-in scorekeeper changed. Try again.');
    return { api, account, profiles, nextCursor: page.nextCursor };
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
    if (isFeatureAvailable('history')) {
        const label = document.createElement('label');
        label.innerHTML = '<input type="checkbox" id="sharedHistoryRecording"> Use approved shared-tablet history (501 / Cricket)';
        panel.append(label);
    }
    const toggle = document.getElementById('recordCasualStats');
    if (!isFeatureAvailable('accounts')) {
        toggle.checked = false;
        toggle.disabled = true;
        toggle.setAttribute('aria-describedby', 'casualRecordingHint');
        const badge = document.createElement('span');
        badge.className = 'feature-coming-soon-badge';
        badge.textContent = 'Cloud off';
        toggle.parentElement.append(badge);
    }
    const updateHint = () => {
        if (!isFeatureAvailable('accounts')) {
            document.getElementById('casualRecordingHint').textContent = ACCOUNTS_NOTICE;
            return;
        }
        const supported = RECORDING_GAMES.has(document.getElementById('gameType').value);
        document.getElementById('casualRecordingHint').textContent = supported
            ? 'Start Game lets you choose profile links. Private cloud history supports 501 and Cricket with only your own account linked; other recorded games stay on this device. Guests and normal offline play still work. Records are scorekeeper-declared, not certified results.'
            : 'This game is not recorded. It remains playable normally, including offline.';
    };
    document.getElementById('gameType').addEventListener('change', updateHint);
    document.getElementById('casualLocalHistory').addEventListener('toggle', renderCasualHistory);
    document.addEventListener('casualRecordingChanged', renderCasualHistory);
    updateHint();
    renderCasualHistory();
}

export async function prepareCasualRecording(playerSeeds, teams, force = false) {
    if (!isFeatureAvailable('accounts')) return { playerSeeds, teams, recording: null };
    const gameType = document.getElementById('gameType').value;
    if ((!force && !document.getElementById('recordCasualStats')?.checked) || !RECORDING_GAMES.has(gameType)) {
        return { playerSeeds, teams, recording: null };
    }
    if (preparing) return null;
    if (isFeatureAvailable('history') && document.getElementById('sharedHistoryRecording')?.checked) {
        preparing = true;
        try { return await (await import('../history-attribution/dev-ui/scorer.mjs')).prepareSharedCasual(playerSeeds, teams, gameType); }
        finally { preparing = false; }
    }
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
        '<p>Choose by verified player ID—not by a matching name or email. Leave guests unlinked. Private cloud history currently supports 501 and Cricket with only your own account linked. Other games or linked players remain local; choosing a profile does not grant consent to write their history.</p>' +
        '<label><input type="checkbox" id="casualLocalOnlyAck"> Keep this recorded game on this device if it cannot save to my private history. Preserve every linked player.</label>' +
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
    let nextCursor = null;
    let loading = false;
    const known = new Map();
    let start, starting = false;
    const startProblem = () => recordingStartProblem({ loading, ownerId: verifiedOwner, profileIds: known,
        selectedIds: selectors.map(select => select.value) });
    const updateStart = (announce = false) => {
        const problem = startProblem();
        if (start) { start.disabled = starting || !!problem; start.title = problem; }
        if (announce) status.textContent = problem || 'Ready to start. Selected profiles will be verified again before recording.';
    };
    selectors.forEach(select => select.addEventListener('change', () => updateStart(true)));
    const more = button('Load more verified profiles', 'casualLinkMore', () => load(true));
    more.hidden = true;
    const load = async (append = false) => {
        if (loading) return;
        loading = true;
        updateStart();
        more.disabled = true;
        status.textContent = 'Loading verified profiles online…';
        try {
            const { account, profiles, nextCursor: next } = await verifiedProfiles(null, append ? nextCursor : null);
            if (append && verifiedOwner !== account.uid) throw new Error('Account changed. Reload profiles before continuing.');
            nextCursor = next;
            more.hidden = nextCursor === null;
            profiles.forEach(profile => known.set(profile.id, profile));
            verifiedOwner = account.uid;
            selectors.forEach(select => {
                const selected = select.value;
                select.replaceChildren(new Option('Guest — no account statistics', ''));
                known.forEach(profile => select.add(new Option(`${profile.name} · ID ${profile.id}`, profile.id)));
                if (known.has(selected)) select.value = selected;
            });
            status.textContent = `Verified scorekeeper ID: ${account.uid}. ${slots.length} human slots; scroll the list to review each one.`;
        } catch (error) {
            verifiedOwner = null;
            status.textContent = `${error.message} You can retry, or play normally without recording.`;
        } finally {
            loading = false; more.disabled = false; updateStart();
            if (verifiedOwner && startProblem()) status.textContent = startProblem();
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
        start = button('Start recorded game', 'casualLinkStart', async () => {
            if (finished || starting) return;
            const problem = startProblem();
            if (problem) { status.textContent = problem; updateStart(); return; }
            starting = true; updateStart();
            status.textContent = 'Verifying selected profiles before starting…';
            try {
                const { account, profiles } = await verifiedProfiles(selectors.map(s => s.value).filter(Boolean));
                if (!verifiedOwner || account.uid !== verifiedOwner) throw new Error('Reload profiles for the current verified scorekeeper.');
                if (document.getElementById('gameType').value !== gameType) throw new Error('The selected game changed. Cancel and start again.');
                const linked = selectors.map(s => s.value).filter(Boolean);
                if (!linked.length) throw new Error('Link at least one verified player, or choose Play without recording.');
                if (new Set(linked).size !== linked.length) throw new Error('A verified player may occupy only one human slot.');
                if (linked.some(id => !profiles.some(p => p.id === id))) throw new Error('A selected profile is no longer available. Reload profiles.');
                if (!personalHistoryAllowed(gameType, linked, account.uid) && !content.querySelector('#casualLocalOnlyAck').checked) throw new Error('This selection cannot save to private cloud history. Confirm local recording, or change the links yourself. No players have been removed.');
                slots.forEach(({ member }, i) => { member.playerId = selectors[i].value || null; });
                const recording = {
                    backendKey: BACKEND_KEY, source: 'casual', resultId: newRecordId(), ownerId: account.uid,
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
                starting = false; updateStart();
            }
        });
        start.setAttribute('aria-describedby', 'casualLinkStatus');
        updateStart();
        content.querySelector('#casualLinkActions').append(
            start,
            button('Reload verified profiles', 'casualLinkReload', () => load(false)),
            more,
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
        const item = { backendKey: session.backendKey, resultId: session.resultId, ownerId: session.ownerId, gameType: session.gameType, savedAt: Date.now() };
        localStorage.setItem(HISTORY_KEY, JSON.stringify([item, ...history.filter(x => x.resultId !== item.resultId)].slice(0, 50)));
        return true;
    } catch (error) {
        console.warn('[Casual recording] Could not update the local saved-game index.', error);
        return false;
    }
}

export async function saveCasualResult() {
    if (!isFeatureAvailable('accounts')) {
        document.dispatchEvent(new CustomEvent('casualRecordingChanged', { detail: { message: ACCOUNTS_NOTICE } }));
        return;
    }
    const session = game.recording;
    if (!session || !recordingComplete() || session.status === 'saved' || saving) return;
    try { requireCurrentBackend(session); } catch (error) {
        document.dispatchEvent(new CustomEvent('casualRecordingChanged', { detail: { message: error.message } }));
        return;
    }
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
        if (session.history) {
            await (await import('../history-attribution/dev-ui/scorer.mjs')).saveFromScorer(session, session.pendingResult, saveActiveGame);
        } else {
        if (!personalHistoryAllowed(session.pendingResult.gameType, session.pendingResult.participantIds, session.ownerId)) throw Object.assign(new Error('This recording stays local under the current private-history scope.'), { code: 'permission-denied' });
        const { api, account, profiles } = await verifiedProfiles(session.pendingResult.participantIds);
        if (account.uid !== session.ownerId) throw new Error('Sign in as the original verified scorekeeper to save this record.');
        if (session.pendingResult.participantIds.some(id => !profiles.some(p => p.id === id))) throw new Error('A linked player profile is no longer available.');
        await api.saveCasualResult(session.resultId, session.pendingResult, session);
        }
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
        const denied = ['permission-denied', 'firestore/permission-denied'].includes(error.code);
        notify(denied
            ? 'Not saved: the current access policy does not allow this account to save this result. Linked players have not been removed. Kept on this device; check the account and permitted recording scope before retrying.'
            : `Not saved: ${error.message}. Kept on this device; reconnect and retry Save casual result.`);
    } finally {
        saving = false;
        const save = document.getElementById('casualSaveResult');
        if (save) save.disabled = !isFeatureAvailable('accounts') || session.status === 'saved';
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
        label.textContent = `${session.backendKey === BACKEND_KEY ? '' : 'Older backend · local only · '}${session.gameType.toUpperCase()} · ${session.status === 'saved' ? 'Saved' : 'Local / not sent'} · ${session.teams.map(t => t.name).join(' vs ')}`;
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
                row.textContent = `${saved.backendKey === BACKEND_KEY ? '' : 'Older backend · '}${saved.gameType.toUpperCase()} · Saved ${new Date(saved.savedAt).toLocaleString()} · Scorekeeper ID ${saved.ownerId}`;
                list.append(row);
            }
            const note = document.createElement('p');
            note.textContent = `${history.length} recent confirmed casual records on this device. ` + (isFeatureAvailable('accounts')
                ? 'Linked players can view their full statistics in Accounts.'
                : 'DEV uses sample Players & Records; local recorded games remain available above.');
            list.append(note);
        }
    } catch (error) {
        console.warn('[Casual recording] Could not read the local saved-game index.', error);
        const warning = document.createElement('p');
        warning.setAttribute('role', 'alert');
        warning.textContent = 'Saved-game history could not be read on this device. Pending games above are separate and have not been removed. ' + (isFeatureAvailable('accounts')
            ? 'Cloud records remain available in Accounts.'
            : 'DEV uses sample Players & Records.');
        list.append(warning);
    }
    if (!list.children.length) list.textContent = 'No local recorded games yet.';
}
