import * as platform from '../platform.js';
import * as engine from './engine.js';
import { renderDiagram, teamLabel } from './diagram.js';

const $ = id => document.getElementById(id);
const GAMES = { chicago: 'Chicago', '301': '301', '501': '501', cricket: 'Cricket', spanish: 'Spanish Cricket', minnesota: 'Minnesota Cricket' };
let current = null, draft = [], profiles = [], rosterDirty = false, resultDirty = false;
let selectedMatch = null, busy = false, refreshing = false, previewTimer;
let list = [], diagramState = null;
let renderedAccount = null;
let needsAccountReload = false;
let ownProfile = null, ownProfileState = 'loading', ownProfileError = '';
let latestCloud = null;
let profileRequest = 0;
const guestReceipts = new Map();

const verified = () => {
    const user = platform.getAccount();
    return user && user.emailVerified && !user.isAnonymous;
};
const owner = () => verified() && current?.ownerId === platform.getAccount().uid;
const dirty = () => rosterDirty || resultDirty;
const id = prefix => `${prefix}-${crypto.randomUUID()}`;

function textElement(tag, text, className) {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
}

function notice(text, error = false) {
    $('message').textContent = text;
    $('message').classList.toggle('platform-error', error);
}

function publicLabel(value, label, limit = 40, allowEmpty = false) {
    const text = value.trim();
    if ((!text && !allowEmpty) || text.length > limit || /[@\u0000-\u001f]/.test(text)) {
        throw new Error(`${label}: use ${allowEmpty ? '0' : '1'}–${limit} public characters, without email addresses or control characters.`);
    }
    return text;
}

function validRoster() {
    return draft.map(entry => ({
        ...entry, name: publicLabel(entry.name, 'Player name'),
        tag: publicLabel(entry.tag, 'Team number', 100, true),
    }));
}

function accountUI() {
    $('createPanel').hidden = !verified();
    $('accountNotice').textContent = verified()
        ? 'Verified account connected. You can organize tournaments and add verified profiles or tournament-only guests.'
        : 'Spectators welcome. Sign in at Players & Records to organize a tournament or create your player profile.';
}

function controls() {
    $('createControls').disabled = busy || !verified();
    $('rosterControls').disabled = busy || needsAccountReload || !owner();
    $('resultControls').disabled = busy || needsAccountReload || !owner();
    $('launchScorer').disabled = busy || needsAccountReload;
    $('discard').hidden = !dirty();
    $('refresh').disabled = busy;
    const eligible = current && owner() && current.status === 'registration' && !engine.readiness(current).length;
    $('startTournament').disabled = busy || needsAccountReload || dirty() || !eligible;
    $('saveRoster').disabled = busy || needsAccountReload || !rosterDirty;
    joinUI();
}

function joinUI() {
    if (!current) return;
    const tournament = latestCloud?.id === current.id ? latestCloud : current;
    const joined = verified() && tournament.registrations.some(entry => entry.playerId === platform.getAccount().uid);
    const closed = tournament.status !== 'registration';
    $('joinTournament').textContent = joined ? 'Already registered' : closed ? 'Registration closed' : 'Join tournament';
    $('joinTournament').disabled = busy || needsAccountReload || !verified() || joined || closed || ownProfileState !== 'ready';
    $('joinProfileLink').hidden = !!joined || closed || (!!verified() && ownProfileState === 'ready');
    $('refreshJoinProfile').hidden = !verified() || !!joined || closed || !['missing', 'error'].includes(ownProfileState);
    $('refreshJoinProfile').disabled = busy;
    const guestId = guestReceipts.get(tournament.id);
    const guest = guestId && tournament.registrations.find(entry => entry.id === guestId && entry.playerId === null);
    $('guestJoinControls').disabled = busy || needsAccountReload || closed || !!guest;
    $('joinGuest').textContent = guest ? 'Guest already registered' : closed ? 'Registration closed' : 'Join as tournament-only guest';
    $('guestJoinHelp').textContent = guest
        ? `${guest.name} is confirmed in the cloud as a tournament-only guest. No lifetime statistics will be linked to this entry.`
        : closed ? 'Guest registration is closed.'
            : 'Your guest name appears in the public roster immediately after the server confirms registration. Repeating a request on this device does not create another entry.';
    $('joinHelp').textContent = joined
        ? (closed ? 'You are registered. Registration is now closed.' : 'Your registration is confirmed in the cloud. The organizer will assign your team.')
        : closed ? 'New registrations are closed because the tournament has started or finished.'
            : !verified() ? 'Sign in and verify your account at Players & Records to join with your own player identity.'
                : ownProfileState === 'loading' ? 'Checking your public player profile…'
                    : ownProfileState === 'missing' ? 'Create your public player profile at Players & Records, then refresh your profile here.'
                        : ownProfileState === 'error' ? `Your profile could not be loaded: ${ownProfileError}. Retry before joining.`
                            : `Join immediately as ${ownProfile.name}. No organizer approval is required. Use the guest form instead only if you do not want this entry linked to your verified player profile.`;
}

async function loadOwnProfile() {
    const request = ++profileRequest;
    const userId = verified() ? platform.getAccount().uid : null;
    ownProfile = null;
    ownProfileError = '';
    ownProfileState = userId ? 'loading' : 'missing';
    joinUI();
    if (!userId) return;
    try {
        const profile = await platform.getProfile();
        if (request !== profileRequest || !verified() || platform.getAccount().uid !== userId) return;
        ownProfile = profile;
        ownProfileState = profile ? 'ready' : 'missing';
    } catch (error) {
        if (request !== profileRequest || !verified() || platform.getAccount().uid !== userId) return;
        ownProfileState = 'error';
        ownProfileError = error.message;
    }
    joinUI();
}

function publicRoster(tournament) {
    $('publicRosterHeading').textContent = `Registered players · ${tournament.registrations.length}`;
    $('publicRoster').replaceChildren();
    for (const entry of tournament.registrations) $('publicRoster').append(textElement('li', entry.name));
    $('publicTeams').replaceChildren();
    for (const team of tournament.teams) $('publicTeams').append(textElement('span', teamLabel(tournament, team.id)));
}

function observeCloud(tournament) {
    latestCloud = tournament;
    publicRoster(tournament);
    joinUI();
}

async function action(operation) {
    if (busy) return;
    busy = true;
    controls();
    try { await operation(); }
    catch (error) { notice(`${error.message} No successful cloud save was confirmed; your edits have been kept.`, true); }
    finally { busy = false; controls(); }
}

function draw() {
    if (!diagramState) return;
    if (!owner() && current.status === 'registration' && !current.matches.length) {
        $('diagram').replaceChildren(textElement('p', 'The organizer is preparing the draw. The connected bracket will appear when play starts.', 'diagram-empty'));
        return;
    }
    renderDiagram($('diagram'), diagramState, {
        preview: current.status === 'registration',
        canScore: !!owner(), onSelect: openResult, scale: $('diagramScale').value,
    });
}

function updatePreview() {
    if (!current) return;
    $('draftStatus').textContent = rosterDirty ? 'Unsaved changes · preview only. Save all changes before starting.' : 'Roster saved to cloud.';
    $('blockers').replaceChildren();
    if (current.status === 'registration' && owner()) {
        try {
            const candidate = engine.saveRoster(current, validRoster());
            const preview = engine.createPreview(candidate);
            diagramState = { ...candidate, teams: preview.teams, matches: preview.matches };
            for (const blocker of engine.readiness(candidate)) $('blockers').append(textElement('li', blocker));
        } catch (error) {
            diagramState = { ...current, matches: [] };
            $('blockers').append(textElement('li', error.message));
        }
    } else {
        // Spectator flags are redacted: never derive membership or previews from them.
        diagramState = current;
    }
    draw();
    controls();
}

function markRosterDirty() {
    rosterDirty = true;
    controls();
    clearTimeout(previewTimer);
    previewTimer = setTimeout(updatePreview, 120);
    $('draftStatus').textContent = 'Unsaved changes · preview only.';
}

function renderRoster() {
    $('rosterRows').replaceChildren();
    for (const entry of draft) {
        const row = document.createElement('tr');
        row.dataset.registration = entry.id;
        for (const field of ['name', 'tag', 'paid', 'checkedIn', 'standby']) {
            const cell = document.createElement('td');
            const input = document.createElement('input');
            const checkbox = ['paid', 'checkedIn', 'standby'].includes(field);
            input.type = checkbox ? 'checkbox' : 'text';
            input.dataset.field = field;
            input.setAttribute('aria-label', `${{ name: 'Display name', tag: 'Team number', paid: 'Paid', checkedIn: 'Checked in', standby: 'Standby' }[field]} for ${entry.name}`);
            if (checkbox) input.checked = entry[field];
            else {
                input.value = entry[field];
                input.maxLength = field === 'name' ? 40 : 100;
                if (field === 'tag') input.inputMode = 'numeric';
                input.required = field === 'name';
            }
            input.addEventListener(checkbox ? 'change' : 'input', () => {
                entry[field] = checkbox ? input.checked : input.value;
                markRosterDirty();
            });
            cell.append(input);
            if (field === 'name') cell.append(textElement('small', entry.playerId ? 'Verified profile · tournament display name' : 'Tournament-only guest'));
            row.append(cell);
        }
        const cell = document.createElement('td');
        const remove = textElement('button', 'Remove');
        remove.type = 'button';
        remove.setAttribute('aria-label', `Remove ${entry.name}`);
        remove.addEventListener('click', () => {
            draft = draft.filter(item => item.id !== entry.id);
            markRosterDirty();
            renderRoster();
            updatePreview();
        });
        cell.append(remove);
        row.append(cell);
        $('rosterRows').append(row);
    }
}

function renderProfiles() {
    $('profile').replaceChildren(new Option('Tournament-only guest', ''));
    for (const profile of profiles) {
        if (!draft.some(entry => entry.playerId === profile.id)) $('profile').append(new Option(profile.name, profile.id));
    }
    $('guestName').disabled = false;
    $('guestName').required = true;
}

function renderList() {
    for (const [container, completed] of [['currentList', false], ['historyList', true]]) {
        const host = $(container);
        host.replaceChildren();
        const entries = list.filter(t => (t.status === 'complete') === completed).sort((a, b) => b.date.localeCompare(a.date));
        if (!entries.length) host.append(textElement('p', completed ? 'No completed tournaments yet.' : 'No current tournaments.'));
        for (const tournament of entries) {
            const link = document.createElement('a');
            link.className = 'tournament-link';
            link.href = `?id=${encodeURIComponent(tournament.id)}`;
            link.append(textElement('strong', tournament.title), textElement('span', `${tournament.date} · ${GAMES[tournament.gameType]} · ${tournament.status}`));
            link.addEventListener('click', event => {
                event.preventDefault();
                if (busy || (dirty() && !confirm('Discard unsaved edits and open another tournament?'))) return;
                action(async () => {
                    const next = await platform.getTournament(tournament.id);
                    if (!next) throw new Error('Tournament not found.');
                    accept(next);
                    history.replaceState(null, '', `?id=${encodeURIComponent(next.id)}`);
                    notice('Tournament loaded from cloud.');
                });
            });
            host.append(link);
        }
    }
}

function accept(tournament) {
    needsAccountReload = false;
    current = tournament;
    latestCloud = tournament;
    draft = structuredClone(tournament.registrations);
    rosterDirty = false;
    resultDirty = false;
    selectedMatch = null;
    clearTimeout(previewTimer);
    list = [...list.filter(item => item.id !== tournament.id), tournament];
    renderList();
    renderTournament();
}

function renderTournament() {
    $('tournament').hidden = !current;
    if (!current) return;
    $('tournamentTitle').textContent = current.title;
    $('tournamentMeta').textContent = `${current.date} · ${GAMES[current.gameType]} · best of ${current.bestOf} · ${current.status} · revision ${current.revision}`;
    $('rosterPanel').hidden = !owner() || current.status !== 'registration';
    $('spectatorNote').hidden = !!owner();
    $('lockedNote').hidden = current.status === 'registration';
    $('resultPanel').hidden = true;
    // Do not render organizer flags or account IDs into spectator markup.
    publicRoster(current);
    $('champion').hidden = current.status !== 'complete';
    if (current.status === 'complete') {
        const final = current.matches.find(m => m.code === 'GF2' && m.status === 'complete') || current.matches.find(m => m.code === 'GF1');
        $('champion').textContent = `Champion: ${teamLabel(current, final?.winnerId)}`;
    }
    $('bracketHeading').textContent = current.status === 'registration'
        ? (owner() ? 'Connected preview · Not played' : 'Bracket not started') : 'Connected bracket';
    $('bracketHelp').textContent = current.status === 'registration'
        ? (owner() ? 'Complete pairs only; check-in is not required for preview. The draw will be shuffled once when the organizer starts.'
            : 'These are the saved teams. The organizer’s working preview is private until the tournament starts.')
        : '100% is the readable tablet view; scroll across rounds. Numbered loser references link upper-bracket drop-ins. GF2 is played only if the lower-bracket team wins GF1.';
    if (owner() && current.status === 'registration') {
        renderRoster();
        renderProfiles();
    } else $('rosterRows').replaceChildren();
    updatePreview();
}

async function loadProfiles() {
    if (!verified()) { profiles = []; return; }
    try { profiles = await platform.listProfiles(); renderProfiles(); }
    catch (error) { notice(`Verified player directory unavailable: ${error.message}. Guests may still be added; no names will be matched to an account.`, true); }
}

export async function refreshSelected({ discard = false } = {}) {
    if (busy || refreshing) return;
    refreshing = true;
    try {
        if (current) {
            const selectedId = current.id;
            const reader = verified() ? platform.getAccount().uid : null;
            const next = await platform.getTournament(selectedId);
            const activeReader = verified() ? platform.getAccount().uid : null;
            if (busy || current?.id !== selectedId || reader !== activeReader) return;
            if (!next) throw new Error('This tournament is no longer available.');
            // A read started before a successful write can finish after that write.
            if (next.revision < current.revision) return;
            if (dirty() && !discard) {
                observeCloud(next);
                notice(next.revision !== current.revision
                    ? 'Newer cloud changes are available. Your unsaved edits are preserved. Discard & reload before editing the newer revision.'
                    : 'Unsaved edits preserved; cloud refresh did not replace your form.');
                return;
            }
            if (next.revision !== current.revision || discard || needsAccountReload) accept(next);
        } else {
            const next = await platform.listTournaments();
            if (!busy) { list = next; renderList(); }
        }
        notice('Cloud is up to date. Live view refreshes every 8 seconds.');
    } catch (error) { notice(`Cloud refresh failed: ${error.message}. Displayed data has not been replaced.`, true); }
    finally { refreshing = false; controls(); }
}

function openResult(matchId) {
    if (!owner() || busy || needsAccountReload) return;
    if (resultDirty && !confirm('Discard the unsaved result entry?')) return;
    const match = current.matches.find(item => item.id === matchId);
    if (!match || match.status !== 'ready') return;
    selectedMatch = match.id;
    resultDirty = false;
    $('resultPanel').hidden = false;
    $('resultHeading').textContent = `${match.code} · Ready to play`;
    $('resultNames').textContent = `${teamLabel(current, match.teamA)} vs ${teamLabel(current, match.teamB)}`;
    $('winner').replaceChildren(new Option(teamLabel(current, match.teamA), match.teamA), new Option(teamLabel(current, match.teamB), match.teamB));
    $('winner').value = match.winnerId || match.teamA;
    $('scoreALabel').textContent = `${current.teams.find(t => t.id === match.teamA).name} legs`;
    $('scoreBLabel').textContent = `${current.teams.find(t => t.id === match.teamB).name} legs`;
    $('scoreA').value = match.scoreA ?? '';
    $('scoreB').value = match.scoreB ?? '';
    $('forfeit').checked = match.forfeit;
    $('launchScorer').hidden = match.status !== 'ready';
    scoreControls();
    controls();
    $('resultPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function scoreControls() {
    for (const field of ['scoreA', 'scoreB']) {
        $(field).disabled = $('forfeit').checked;
        $(field).required = !$('forfeit').checked;
    }
}

$('createForm').addEventListener('submit', event => {
    event.preventDefault();
    action(async () => {
        if (dirty() && !confirm('Discard unsaved edits and create a new tournament?')) return;
        const user = platform.requireVerifiedAccount();
        const next = engine.createTournament({
            id: id('t'), ownerId: user.uid, title: publicLabel($('title').value, 'Title', 100),
            date: $('date').value, gameType: $('gameType').value, bestOf: Number($('bestOf').value),
        });
        const saved = await platform.createTournamentDocument(next);
        accept(saved);
        history.replaceState(null, '', `?id=${encodeURIComponent(saved.id)}`);
        $('createForm').reset();
        $('bestOf').disabled = true;
        $('date').value = new Date().toLocaleDateString('en-CA');
        $('createPanel').open = false;
        notice('Tournament created in cloud. Add players and pair team numbers.');
    });
});
$('gameType').addEventListener('change', () => {
    $('bestOf').disabled = $('gameType').value === 'chicago';
    if ($('bestOf').disabled) $('bestOf').value = '3';
});
$('profile').addEventListener('change', () => {
    $('guestName').disabled = !!$('profile').value;
    $('guestName').required = !$('profile').value;
});
$('addForm').addEventListener('submit', event => {
    event.preventDefault();
    try {
        if (!owner() || busy || current.status !== 'registration') throw new Error('Roster editing is closed.');
        const profile = profiles.find(item => item.id === $('profile').value);
        if ($('profile').value && !profile) throw new Error('Select a verified player from the directory.');
        if (profile && draft.some(entry => entry.playerId === profile.id)) throw new Error('That verified player is already registered.');
        draft.push({
            id: id('r'), playerId: profile?.id || null,
            name: publicLabel(profile?.name || $('guestName').value, 'Player name'), tag: '',
            paid: false, checkedIn: false, standby: false,
        });
        $('guestName').value = '';
        markRosterDirty();
        renderRoster();
        renderProfiles();
        updatePreview();
    } catch (error) { notice(error.message, true); }
});
$('rosterForm').addEventListener('submit', event => {
    event.preventDefault();
    action(async () => {
        const rows = validRoster();
        engine.saveRoster(current, rows);
        const saved = await platform.updateTournament(current.id, current.revision, stored => engine.saveRoster(stored, rows));
        accept(saved);
        notice('All roster changes saved to cloud. Preview remains unlocked.');
    });
});
$('startTournament').addEventListener('click', () => action(async () => {
    if (dirty()) throw new Error('Save all roster edits before starting.');
    if (!confirm('Start this tournament? This shuffles the draw once and permanently locks the roster.')) return;
    // Transaction callbacks may retry: the randomized draw must be computed once.
    const started = engine.startTournament(current);
    const saved = await platform.updateTournament(current.id, current.revision, () => structuredClone(started));
    accept(saved);
    notice('Tournament started and roster locked. Select a ready match to launch the scorer.');
}));
$('resultForm').addEventListener('input', () => { resultDirty = true; controls(); });
$('forfeit').addEventListener('change', scoreControls);
$('resultForm').addEventListener('submit', event => {
    event.preventDefault();
    action(async () => {
        const matchId = selectedMatch;
        const forfeit = $('forfeit').checked;
        const result = { winnerId: $('winner').value, forfeit,
            scoreA: forfeit ? null : Number($('scoreA').value),
            scoreB: forfeit ? null : Number($('scoreB').value) };
        engine.recordResult(current, matchId, result);
        if (!confirm('Save this manual match result? No per-dart or lifetime statistics will be created or adjusted.')) return;
        const saved = await platform.updateTournament(current.id, current.revision, stored => engine.recordResult(stored, matchId, result));
        accept(saved);
        notice('Manual result saved; bracket updated. No per-dart or lifetime statistics were written.');
    });
});
$('closeResult').addEventListener('click', () => {
    if (resultDirty && !confirm('Discard the unsaved result entry?')) return;
    resultDirty = false;
    selectedMatch = null;
    $('resultPanel').hidden = true;
    controls();
});
$('launchScorer').addEventListener('click', () => action(async () => {
    if (resultDirty && !confirm('Discard unsaved manual scores and launch the scorer?')) return;
    const fresh = await platform.getTournament(current.id);
    if (!fresh || fresh.revision !== current.revision) throw new Error('The tournament changed. Reload before launching.');
    const match = fresh.matches.find(item => item.id === selectedMatch);
    if (fresh.status !== 'live' || match?.status !== 'ready') throw new Error('This match is no longer ready.');
    localStorage.setItem('blakeout_dev_match_launch', JSON.stringify({
        tournamentId: fresh.id, matchId: match.id, revision: fresh.revision,
    }));
    resultDirty = false;
    location.assign(new URL('../?tournamentMatch=1', location.href).href);
}));
$('joinTournament').addEventListener('click', () => action(async () => {
    const user = platform.requireVerifiedAccount();
    const selectedId = current.id;
    if (current.status !== 'registration') throw new Error('Registration is closed.');
    if (ownProfileState !== 'ready') throw new Error('Create your public player profile before joining.');
    const saved = await platform.joinTournament(selectedId);
    if (!verified() || platform.getAccount().uid !== user.uid || current?.id !== selectedId) {
        throw new Error('The active account changed. Reload to see the current registration.');
    }
    if (!saved.registrations.some(entry => entry.playerId === user.uid)) {
        throw new Error('The server did not confirm your registration. Refresh before retrying.');
    }
    if (dirty()) {
        observeCloud(saved);
        notice('Registration confirmed in cloud. Your unsaved organizer edits are preserved; discard & reload before saving against the new roster.');
    } else {
        accept(saved);
        notice('You are registered! Your name is immediately visible to the organizer and other players.');
    }
}));
$('guestJoinForm').addEventListener('submit', event => {
    event.preventDefault();
    action(async () => {
        const tournamentId = current.id;
        if (current.status !== 'registration') throw new Error('Registration is closed.');
        const name = publicLabel($('guestJoinName').value, 'Guest name');
        const { tournament, registrationId } = await platform.joinTournamentAsGuest(tournamentId, name);
        if (current?.id !== tournamentId || tournament?.id !== tournamentId) throw new Error('Reload this tournament to confirm the guest registration.');
        const entry = tournament.registrations.find(item => item.id === registrationId && item.playerId === null);
        if (!entry) throw new Error('The server did not confirm this device’s guest entry. Refresh before retrying.');
        guestReceipts.set(tournamentId, registrationId);
        if (dirty()) {
            observeCloud(tournament);
            notice('Guest registration confirmed in cloud. Your unsaved organizer edits are preserved; discard & reload before saving against the new roster.');
        } else {
            accept(tournament);
            notice('Guest registration confirmed! Your name is publicly visible. This tournament-only entry has no lifetime statistics.');
        }
        $('guestJoinName').value = entry.name;
    });
});
$('refreshJoinProfile').addEventListener('click', loadOwnProfile);
$('refresh').addEventListener('click', () => { refreshSelected(); loadOwnProfile(); });
$('discard').addEventListener('click', () => {
    if (confirm('Discard your unsaved edits and reload from cloud?')) refreshSelected({ discard: true });
});
$('diagramScale').addEventListener('change', draw);
new ResizeObserver(() => { if ($('diagramScale').value === 'fit') draw(); }).observe($('diagram'));
window.addEventListener('beforeunload', event => {
    if (dirty()) { event.preventDefault(); event.returnValue = ''; }
});
window.addEventListener('online', () => refreshSelected());
setInterval(() => { if (!document.hidden) refreshSelected(); }, 8000);

async function boot() {
    busy = true;
    $('date').value = new Date().toLocaleDateString('en-CA');
    accountUI();
    controls();
    platform.subscribeAccount(() => {
        accountUI();
        const accountId = verified() ? platform.getAccount().uid : null;
        const accountChanged = accountId !== renderedAccount;
        if (current && accountChanged) {
            needsAccountReload = true;
            rosterDirty = false;
            resultDirty = false;
            selectedMatch = null;
            renderTournament();
            refreshSelected({ discard: true });
        }
        renderedAccount = accountId;
        if (accountChanged && !busy) { loadProfiles(); loadOwnProfile(); }
        if (!accountId) { profiles = []; renderProfiles(); }
        controls();
    });
    try {
        await platform.initPlatform();
        accountUI();
        list = await platform.listTournaments();
        renderList();
        const selectedId = new URLSearchParams(location.search).get('id');
        if (selectedId) {
            const tournament = await platform.getTournament(selectedId);
            if (!tournament) throw new Error('Tournament not found.');
            accept(tournament);
        }
        notice('Cloud connected. Choose a tournament or create one. Live view refreshes every 8 seconds.');
        await Promise.all([loadProfiles(), loadOwnProfile()]);
    } catch (error) { notice(`Cloud unavailable: ${error.message}. Nothing has been saved offline. Scoring remains available from the navigation.`, true); }
    busy = false;
    controls();
}
boot();
