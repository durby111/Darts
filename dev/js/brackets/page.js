import * as platform from '../platform.js';
import * as engine from './engine.js';
import { renderDiagram, teamLabel } from './diagram.js';
import { registrationLabels } from './labels.js';
import { confirmDialog } from '../confirm-dialog.js';

const $ = id => document.getElementById(id);
const GAMES = { chicago: 'Chicago', '301': '301', '501': '501', cricket: 'Cricket', spanish: 'Spanish Cricket', minnesota: 'Minnesota Cricket' };
let current = null, draft = [], profiles = [], rosterDirty = false, resultDirty = false;
let selectedMatch = null, busy = false, refreshing = false, previewTimer;
let list = [], diagramState = null;
let renderedAccount = null, renderedUser = null;
let needsAccountReload = false;
let ownProfile = null, ownProfileState = 'loading', ownProfileError = '';
let latestCloud = null;
let profileRequest = 0;
const guestReceipts = new Map();
let contextVersion = 0, pendingConfirmation = null;

const verified = () => {
    const user = platform.getAccount();
    return user && user.emailVerified && !user.isAnonymous;
};
const owner = () => verified() && current?.ownerId === platform.getAccount().uid;
const dirty = () => rosterDirty || resultDirty;
const id = prefix => `${prefix}-${crypto.randomUUID()}`;

// Approval applies only to the account, event, match and exact draft shown
// when requested. Cloud polling continues while a confirmation is open.
function contextSnapshot() {
    const user = platform.getAccount();
    const fields = ['title', 'date', 'gameType', 'bestOf', 'winner', 'scoreA', 'scoreB'];
    return JSON.stringify([
        contextVersion, user?.uid, !!user?.emailVerified, !!user?.isAnonymous,
        current?.id, current?.ownerId, current?.revision, current?.status,
        latestCloud?.id, latestCloud?.revision, selectedMatch, rosterDirty, resultDirty,
        needsAccountReload, draft, fields.map(field => $(field).value), $('forfeit').checked,
        [...document.querySelectorAll('#rosterRows [data-field]')].map(input => [input.dataset.field, input.value, input.checked]),
    ]);
}

function captureContext({ requireOwner = false } = {}) {
    const snapshot = contextSnapshot();
    const user = platform.getAccount();
    return () => platform.getAccount() === user && !needsAccountReload && (!requireOwner || owner()) && contextSnapshot() === snapshot;
}

function invalidateConfirmation() {
    contextVersion++;
    pendingConfirmation?.controller.abort();
}

async function confirmCurrent(message, { requireOwner = false, confirmLabel = 'Continue' } = {}) {
    if (busy || pendingConfirmation || needsAccountReload || (requireOwner && !owner())) return null;
    contextVersion++;
    const isCurrent = captureContext({ requireOwner });
    const request = { controller: new AbortController() };
    pendingConfirmation = request;
    try {
        const answer = await confirmDialog(message, { confirmLabel, signal: request.controller.signal });
        // Even direct/programmatic form changes without an input event invalidate
        // approval. Never read a newer draft and save it under an older approval.
        return isCurrent() && !busy ? { answer, isCurrent } : null;
    } finally {
        if (pendingConfirmation === request) pendingConfirmation = null;
    }
}

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

function clearStartFeedback() {
    $('startFeedback').hidden = true;
    $('startFeedbackTitle').textContent = '';
    $('startFeedbackReasons').replaceChildren();
}

function startFeedback(title, messages, error = false) {
    const panel = $('startFeedback');
    $('startFeedbackTitle').textContent = title;
    $('startFeedbackReasons').replaceChildren(...messages.map(message => textElement('li', message)));
    panel.classList.toggle('platform-error', error);
    panel.hidden = false;
    panel.focus({ preventScroll: true });
    panel.scrollIntoView({ block: 'nearest' });
}

function startBlockers() {
    const blockers = [];
    if (dirty()) blockers.push('Save all roster changes before starting.');
    try {
        const candidate = rosterDirty ? engine.saveRoster(current, validRoster()) : current;
        blockers.push(...engine.readiness(candidate));
    } catch (error) { blockers.push(error.message); }
    return [...new Set(blockers)];
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
    // Let organizers ask to start so incomplete drafts can explain every blocker.
    const canAttemptStart = current && owner() && current.status === 'registration';
    $('startTournament').disabled = busy || needsAccountReload || !canAttemptStart;
    $('saveRoster').disabled = busy || needsAccountReload || !rosterDirty;
    for (const input of document.querySelectorAll('[data-bulk-field]')) {
        const rows = owner() && current.status === 'registration' ? draft : [];
        const count = rows.filter(entry => entry[input.dataset.bulkField]).length;
        input.checked = rows.length > 0 && count === rows.length;
        input.indeterminate = count > 0 && count < rows.length;
        input.disabled = busy || needsAccountReload || !rows.length;
    }
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
    const labels = registrationLabels(tournament.registrations);
    $('publicRosterHeading').textContent = `Registered players · ${tournament.registrations.length}`;
    $('publicRoster').replaceChildren();
    for (const entry of tournament.registrations) $('publicRoster').append(textElement('li', labels.get(entry.id)));
    $('publicTeams').replaceChildren();
    for (const team of tournament.teams) $('publicTeams').append(textElement('span', teamLabel(tournament, team.id, labels)));
}

function updateEventLabels() {
    const labels = registrationLabels(draft);
    for (const row of $('rosterRows').rows) {
        const entry = draft.find(item => item.id === row.dataset.registration);
        const label = labels.get(entry.id);
        const hint = row.querySelector('.event-name-label');
        hint.hidden = label === entry.name;
        hint.textContent = hint.hidden ? '' : `Event label: ${label}`;
        for (const input of row.querySelectorAll('[data-field]')) {
            input.setAttribute('aria-label', `${{ name: 'Display name', tag: 'Team number', paid: 'Paid', checkedIn: 'Checked in', standby: 'Standby' }[input.dataset.field]} for ${label}`);
        }
        row.querySelector('button:not([data-move])').setAttribute('aria-label', `Remove ${label}`);
    }
}

function observeCloud(tournament) {
    if (latestCloud?.id !== tournament.id || latestCloud?.revision !== tournament.revision) invalidateConfirmation();
    latestCloud = tournament;
    publicRoster(tournament);
    joinUI();
}

async function action(operation, onError, isCurrent = () => true) {
    if (busy || pendingConfirmation || !isCurrent()) return;
    busy = true;
    controls();
    try { await operation(); }
    catch (error) {
        if (!isCurrent()) return;
        if (onError) onError(error);
        else notice(`${error.message} No successful cloud save was confirmed; your edits have been kept.`, true);
    }
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
    $('rosterSummary').textContent = '';
    $('rosterWarning').textContent = '';
    $('rosterWarning').hidden = true;
    if (current.status === 'registration' && owner()) {
        updateEventLabels();
        const playing = draft.filter(entry => !entry.standby);
        const groups = new Map();
        for (const entry of playing) {
            const tag = entry.tag.trim();
            if (tag) groups.set(tag, (groups.get(tag) || 0) + 1);
        }
        const paired = playing.filter(entry => groups.get(entry.tag.trim()) === 2).length;
        $('rosterSummary').textContent = `${draft.length} total · ${draft.length - playing.length} standby · ${playing.length} non-standby · ${paired} in complete pairs · ${playing.length - paired} without a complete pair`;
        if (playing.length % 2) {
            $('rosterWarning').textContent = 'There is an odd number of non-standby players. Check who is playing and who should be on standby. This warning alone does not block Start; the requirements below still apply.';
            $('rosterWarning').hidden = false;
        }
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
    invalidateConfirmation();
    rosterDirty = true;
    clearStartFeedback();
    controls();
    clearTimeout(previewTimer);
    previewTimer = setTimeout(updatePreview, 120);
    $('draftStatus').textContent = 'Unsaved changes · preview only.';
}

function renderRoster() {
    $('rosterRows').replaceChildren();
    for (const [index, entry] of draft.entries()) {
        const row = document.createElement('tr');
        row.dataset.registration = entry.id;
        const number = textElement('th', String(index + 1));
        number.scope = 'row';
        row.append(number);
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
            if (field === 'name') {
                cell.append(textElement('small', entry.playerId ? 'Verified profile · tournament display name' : 'Tournament-only guest'));
                cell.append(textElement('small', '', 'event-name-label'));
            }
            row.append(cell);
        }
        const orderCell = document.createElement('td');
        for (const [direction, offset, label] of [['up', -1, '↑'], ['down', 1, '↓']]) {
            const move = textElement('button', label);
            move.type = 'button';
            move.dataset.move = direction;
            move.setAttribute('aria-label', `Move row ${index + 1} (${entry.name}) ${direction}`);
            move.disabled = index + offset < 0 || index + offset >= draft.length;
            move.addEventListener('click', () => {
                if (!owner() || busy || needsAccountReload || current.status !== 'registration') return;
                const from = draft.findIndex(item => item.id === entry.id);
                const to = from + offset;
                if (from < 0 || to < 0 || to >= draft.length) return;
                [draft[from], draft[to]] = [draft[to], draft[from]];
                markRosterDirty();
                renderRoster();
                updatePreview();
                const movedRow = [...$('rosterRows').rows].find(item => item.dataset.registration === entry.id);
                const sameDirection = movedRow.querySelector(`[data-move="${direction}"]`);
                (sameDirection.disabled ? movedRow.querySelector('[data-move]:not(:disabled)') : sameDirection)?.focus();
            });
            orderCell.append(move);
        }
        row.append(orderCell);
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
            link.addEventListener('click', async event => {
                event.preventDefault();
                if (busy || pendingConfirmation) return;
                const confirmation = dirty() ? await confirmCurrent('Discard unsaved edits and open another tournament?')
                    : { answer: true, isCurrent: captureContext() };
                if (!confirmation?.answer || !confirmation.isCurrent()) return;
                const isCurrent = confirmation.isCurrent;
                action(async () => {
                    const next = await platform.getTournament(tournament.id);
                    if (!isCurrent()) return;
                    if (!next) throw new Error('Tournament not found.');
                    accept(next);
                    history.replaceState(null, '', `?id=${encodeURIComponent(next.id)}`);
                    notice('Tournament loaded from cloud.');
                }, null, isCurrent);
            });
            host.append(link);
        }
    }
}

function accept(tournament) {
    invalidateConfirmation();
    clearStartFeedback();
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
            const reader = platform.getAccount();
            const next = await platform.getTournament(selectedId);
            const activeReader = platform.getAccount();
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

async function openResult(matchId) {
    if (!owner() || busy || pendingConfirmation || needsAccountReload) return;
    const confirmation = resultDirty ? await confirmCurrent('Discard the unsaved result entry?', { requireOwner: true })
        : { answer: true, isCurrent: captureContext({ requireOwner: true }) };
    if (!confirmation?.answer || !confirmation.isCurrent()) return;
    const match = current.matches.find(item => item.id === matchId);
    if (!match || match.status !== 'ready') return;
    invalidateConfirmation();
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

$('createForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || pendingConfirmation || !verified() || needsAccountReload) return;
    const confirmation = dirty() ? await confirmCurrent('Discard unsaved edits and create a new tournament?')
        : { answer: true, isCurrent: captureContext() };
    if (!confirmation?.answer || !confirmation.isCurrent()) return;
    const isCurrent = confirmation.isCurrent;
    action(async () => {
        const user = platform.requireVerifiedAccount();
        const next = engine.createTournament({
            id: id('t'), ownerId: user.uid, title: publicLabel($('title').value, 'Title', 100),
            date: $('date').value, gameType: $('gameType').value, bestOf: Number($('bestOf').value),
        });
        const saved = await platform.createTournamentDocument(next);
        if (!isCurrent()) return;
        accept(saved);
        history.replaceState(null, '', `?id=${encodeURIComponent(saved.id)}`);
        $('createForm').reset();
        $('bestOf').disabled = true;
        $('date').value = new Date().toLocaleDateString('en-CA');
        $('createPanel').open = false;
        notice('Tournament created in cloud. Add players and pair team numbers.');
    }, null, isCurrent);
});
$('createForm').addEventListener('input', invalidateConfirmation);
$('createForm').addEventListener('change', invalidateConfirmation);
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
for (const input of document.querySelectorAll('[data-bulk-field]')) {
    input.addEventListener('change', () => {
        if (!owner() || busy || needsAccountReload || current.status !== 'registration' || !draft.length) return;
        for (const entry of draft) entry[input.dataset.bulkField] = input.checked;
        markRosterDirty();
        renderRoster();
        updatePreview();
    });
}
$('startTournament').addEventListener('click', async () => {
    if (busy || pendingConfirmation || needsAccountReload || !owner() || current.status !== 'registration') return;
    const blockers = startBlockers();
    if (blockers.length) {
        startFeedback('Tournament not started', blockers, true);
        return;
    }
    const confirmation = await confirmCurrent('Start this tournament? This shuffles the draw once and permanently locks the roster.',
        { requireOwner: true, confirmLabel: 'Start tournament' });
    if (!confirmation || !confirmation.isCurrent()) return;
    if (!confirmation.answer) {
        startFeedback('Start canceled', ['The roster is still unlocked. You can keep editing or start when ready.']);
        return;
    }
    const sameStartContext = confirmation.isCurrent;
    action(async () => {
        startFeedback('Starting tournament…', ['Waiting for cloud confirmation. Please wait before trying again.']);
        // Transaction callbacks may retry: the randomized draw must be computed once.
        const started = engine.startTournament(current);
        const saved = await platform.updateTournament(current.id, current.revision, () => structuredClone(started));
        if (!sameStartContext()) return;
        accept(saved);
        notice('Tournament started and roster locked. Select a ready match to launch the scorer.');
        $('bracketHeading').focus({ preventScroll: true });
        $('bracketHeading').scrollIntoView({ block: 'nearest' });
    }, error => {
        if (!sameStartContext()) return;
        startFeedback('Start was not confirmed', [
            error.message,
            'No successful cloud save was confirmed. Check your connection and organizer sign-in, then refresh from cloud before retrying.',
        ], true);
    });
});
const markResultDirty = () => { invalidateConfirmation(); resultDirty = true; controls(); };
$('resultForm').addEventListener('input', markResultDirty);
$('resultForm').addEventListener('change', markResultDirty);
$('forfeit').addEventListener('change', scoreControls);
$('resultForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || pendingConfirmation || needsAccountReload || !owner()) return;
    const matchId = selectedMatch;
    const forfeit = $('forfeit').checked;
    const result = { winnerId: $('winner').value, forfeit,
        scoreA: forfeit ? null : Number($('scoreA').value),
        scoreB: forfeit ? null : Number($('scoreB').value) };
    try { engine.recordResult(current, matchId, result); }
    catch (error) { notice(error.message, true); return; }
    const confirmation = await confirmCurrent('Save this manual match result? No per-dart or lifetime statistics will be created or adjusted.',
        { requireOwner: true, confirmLabel: 'Save result' });
    if (!confirmation?.answer || !confirmation.isCurrent()) return;
    action(async () => {
        const saved = await platform.updateTournament(current.id, current.revision, stored => engine.recordResult(stored, matchId, result));
        if (!confirmation.isCurrent()) return;
        accept(saved);
        notice('Manual result saved; bracket updated. No per-dart or lifetime statistics were written.');
    }, null, confirmation.isCurrent);
});
$('closeResult').addEventListener('click', async () => {
    if (busy || pendingConfirmation || needsAccountReload || !owner()) return;
    const confirmation = resultDirty ? await confirmCurrent('Discard the unsaved result entry?', { requireOwner: true })
        : { answer: true, isCurrent: captureContext({ requireOwner: true }) };
    if (!confirmation?.answer || !confirmation.isCurrent()) return;
    invalidateConfirmation();
    resultDirty = false;
    selectedMatch = null;
    $('resultPanel').hidden = true;
    controls();
});
$('launchScorer').addEventListener('click', async () => {
    if (busy || pendingConfirmation || needsAccountReload || !owner()) return;
    const confirmation = resultDirty ? await confirmCurrent('Discard unsaved manual scores and launch the scorer?', { requireOwner: true })
        : { answer: true, isCurrent: captureContext({ requireOwner: true }) };
    if (!confirmation?.answer || !confirmation.isCurrent()) return;
    const isCurrent = confirmation.isCurrent;
    action(async () => {
        const fresh = await platform.getTournament(current.id);
        if (!isCurrent()) return;
        if (!fresh || fresh.revision !== current.revision) throw new Error('The tournament changed. Reload before launching.');
        const match = fresh.matches.find(item => item.id === selectedMatch);
        if (fresh.status !== 'live' || match?.status !== 'ready') throw new Error('This match is no longer ready.');
        localStorage.setItem('blakeout_dev_match_launch', JSON.stringify({
            tournamentId: fresh.id, matchId: match.id, revision: fresh.revision,
        }));
        resultDirty = false;
        location.assign(new URL('../?tournamentMatch=1', location.href).href);
    }, null, isCurrent);
});
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
$('discard').addEventListener('click', async () => {
    if (busy || pendingConfirmation || needsAccountReload || !owner()) return;
    const confirmation = await confirmCurrent('Discard your unsaved edits and reload from cloud?', { requireOwner: true });
    if (!confirmation?.answer || !confirmation.isCurrent()) return;
    action(async () => {
        const next = await platform.getTournament(current.id);
        if (!confirmation.isCurrent()) return;
        if (!next) throw new Error('This tournament is no longer available.');
        if (next.revision < current.revision) throw new Error('A newer tournament revision is already displayed. Refresh again.');
        accept(next);
        notice('Cloud is up to date. Live view refreshes every 8 seconds.');
    }, null, confirmation.isCurrent);
});
$('diagramScale').addEventListener('change', draw);
new ResizeObserver(() => { if ($('diagramScale').value === 'fit') draw(); }).observe($('diagram'));
for (const event of ['pagehide', 'popstate', 'hashchange']) window.addEventListener(event, invalidateConfirmation);
window.addEventListener('beforeunload', event => {
    invalidateConfirmation();
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
        const user = platform.getAccount();
        const accountChanged = accountId !== renderedAccount || user !== renderedUser;
        if (accountChanged) invalidateConfirmation();
        if (current && accountChanged) {
            clearStartFeedback();
            needsAccountReload = true;
            rosterDirty = false;
            resultDirty = false;
            selectedMatch = null;
            renderTournament();
            refreshSelected({ discard: true });
        }
        renderedAccount = accountId;
        renderedUser = user;
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
