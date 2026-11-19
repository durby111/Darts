// TV spectator board page — DEV only, same-device, read-only.
// No writes, no locks, no service-worker registration, no network sync. Open it
// in a second window of the SAME browser that runs the organizer page/scorer
// and put that window on the TV (HDMI extend) or mirror the device screen.
import { applyScoreAppearance } from '../js/score-appearance.js';
import { renderDiagram } from '../js/brackets/diagram.js';
import { buildBoard, TOURNAMENT_KEY, ACTIVE_GAME_KEY } from './tv-model.js';

// Match the device's saved look by reading its preferences. The shared theme
// module re-saves the preference on load, so it is deliberately not imported:
// this page performs no storage writes at all.
try {
    const theme = localStorage.getItem('blakeout_theme');
    if (/^[a-z]{1,20}$/.test(theme || '')) document.documentElement.setAttribute('data-theme', theme);
} catch { /* default theme */ }
applyScoreAppearance();

const $ = id => document.getElementById(id);
const POLL_MS = 2000;
let requested = new URLSearchParams(location.search).get('event');
let lastSignature = null;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function teamBlock(team) {
    const block = el('div', 'tv-team');
    block.append(el('strong', 'tv-team-name', team.name));
    if (team.members.length) block.append(el('span', 'tv-team-members', team.members.join(' & ')));
    return block;
}

function renderNow(board) {
    const host = $('tvNow');
    host.replaceChildren();
    const current = board.current;
    if (!current) {
        const text = board.event.status === 'complete' ? 'Tournament complete.'
            : board.event.status === 'registration' ? 'The tournament has not started yet.'
                : 'No match is being scored on this device right now.';
        host.append(el('p', 'tv-empty', text));
        return;
    }
    host.append(el('p', 'tv-match-meta', `${current.code} · ${current.bracket} · ${current.legGame}${current.game !== current.legGame ? ` (${current.game})` : ''} · best of ${current.bestOf}`));
    const sides = el('div', 'tv-sides');
    for (const side of current.sides) {
        const card = el('article', `tv-side${side.throwing ? ' throwing' : ''}`);
        card.append(teamBlock(side));
        const score = el('p', 'tv-score');
        score.append(el('span', 'tv-score-value', side.score === null ? '—' : String(side.score)), el('span', 'tv-score-label', side.score === null ? 'score unavailable' : current.scoreLabel));
        card.append(score, el('p', 'tv-legs', `Legs won: ${side.legs === null ? '—' : side.legs}`));
        if (side.throwing) card.append(el('p', 'tv-throwing', 'Throwing'));
        sides.append(card);
    }
    host.append(sides);
    if (current.awaitingSave) host.append(el('p', 'tv-note', 'Scoring finished · result awaiting save by the scorekeeper.'));
}

function renderDeck(board) {
    const list = $('tvDeck');
    list.replaceChildren();
    if (!board.onDeck.length) {
        const item = el('li', 'tv-empty', board.event.status === 'live' ? 'No other match is ready yet.' : 'Nothing on deck.');
        list.append(item);
        return;
    }
    for (const match of board.onDeck) {
        const item = el('li', 'tv-deck-item');
        item.append(el('span', 'tv-deck-code', `${match.code} · ${match.game}${match.bestOf ? ` · best of ${match.bestOf}` : ''}`));
        const versus = el('div', 'tv-versus');
        versus.append(teamBlock(match.teams[0]), el('span', 'tv-vs', 'vs'), teamBlock(match.teams[1]));
        item.append(versus);
        list.append(item);
    }
}

function renderPicker(board) {
    const label = $('tvEventLabel'), select = $('tvEvent');
    label.hidden = board.events.length < 2;
    const options = board.events.map(event => `${event.id}\u0000${event.title}\u0000${event.status}`).join('\u0001');
    if (select.dataset.options !== options) {
        select.dataset.options = options;
        select.replaceChildren();
        if (!board.event) select.append(new Option('Choose a tournament', ''));
        for (const event of board.events) select.append(new Option(`${event.title} · ${event.status === 'live' ? 'live' : event.status === 'complete' ? 'complete' : 'not started'}`, event.id));
    }
    select.value = board.event?.id || '';
}

function render(board) {
    renderPicker(board);
    document.body.classList.toggle('tv-no-event', !board.event);
    if (!board.event) {
        $('tvTitle').textContent = 'Spectator board';
        $('tvStatus').textContent = board.error || (board.requestedMissing ? 'That tournament is not saved in this browser.'
            : board.events.length ? 'Choose a tournament to show.'
                : 'No device-local tournaments are saved in this browser. Create one on the organizer page of this same device and browser.');
        for (const id of ['tvNow', 'tvDeck', 'tvDiagram']) $(id).replaceChildren();
        $('tvChampion').hidden = true;
        return;
    }
    $('tvTitle').textContent = board.event.title;
    $('tvStatus').textContent = `${board.event.date} · ${board.event.status === 'live' ? 'Live' : board.event.status === 'complete' ? 'Complete' : 'Registration open'} · updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    renderNow(board);
    renderDeck(board);
    $('tvChampion').hidden = !board.champion;
    if (board.champion) $('tvChampion').textContent = `Champion: ${board.champion.name}${board.champion.members.length ? ` — ${board.champion.members.join(' & ')}` : ''}`;
    // View only: no scoring or correction actions are offered.
    renderDiagram($('tvDiagram'), board.tournament, { canScore: false, inProgressMatchId: board.inProgressMatchId });
}

function signature() {
    try { return `${requested}\u0000${localStorage.getItem(TOURNAMENT_KEY)}\u0000${localStorage.getItem(ACTIVE_GAME_KEY)}`; }
    catch { return 'unavailable'; }
}

function refresh(force = false) {
    const next = signature();
    if (!force && next === lastSignature) return;
    lastSignature = next;
    try { render(buildBoard(localStorage, requested)); }
    catch (error) {
        $('tvStatus').textContent = `The board could not be drawn: ${error.message} Saved data was not changed.`;
    }
}

$('tvEvent').addEventListener('change', event => {
    requested = event.target.value || null;
    const url = new URL(location.href);
    if (requested) url.searchParams.set('event', requested); else url.searchParams.delete('event');
    history.replaceState(null, '', url);
    refresh(true);
});
const fullscreen = $('tvFullscreen');
if (!document.documentElement.requestFullscreen) fullscreen.hidden = true;
fullscreen.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => { $('tvStatus').textContent = 'Full screen was not allowed by this browser.'; });
});
document.addEventListener('fullscreenchange', () => { fullscreen.textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen'; });
// Other same-origin tabs fire `storage`; the short poll covers browsers that throttle it.
window.addEventListener('storage', event => { if (event.key === null || event.key === TOURNAMENT_KEY || event.key === ACTIVE_GAME_KEY) refresh(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
setInterval(refresh, POLL_MS);
refresh(true);
