// DEV test build: the refreshed home/setup experience ("New look").
// Presentation only. It never changes game rules, scoring, saves or the
// existing controls' IDs: every enhancement drives the original control
// (and fires its normal 'change' event) so setup.js keeps working unchanged.
// The Classic layout stays one tap away in Customize.

import { BUILD_STORAGE } from './build-context.js';

export const HOME_LAYOUT_KEY = 'blakeout_dev_home_layout_v1';
const LAYOUTS = ['next', 'classic'];

function storedLayout() {
    try {
        const value = localStorage.getItem(HOME_LAYOUT_KEY);
        return LAYOUTS.includes(value) ? value : 'next';
    } catch { return 'next'; }
}

function applyLayout(value) {
    const layout = LAYOUTS.includes(value) ? value : 'next';
    document.documentElement.dataset.home = layout;
    // In the New look the segmented buttons drive the original select.
    // Only hide it once the replacement buttons exist.
    const count = document.getElementById('numPlayers');
    const countLabel = document.querySelector('label[for="numPlayers"]');
    const replaced = !!document.getElementById('homeNextPlayerCount');
    if (count) {
        if (layout === 'next' && replaced) {
            count.tabIndex = -1;
            count.setAttribute('aria-hidden', 'true');
            countLabel?.setAttribute('aria-hidden', 'true');
        } else {
            count.removeAttribute('tabindex');
            count.removeAttribute('aria-hidden');
            countLabel?.removeAttribute('aria-hidden');
        }
    }
    placeSections(layout);
    placePlayerControls(layout);
    markStepHeadings(layout);
    describeStart(layout);
    labelRosterFields(layout);
    syncRulesExpanded();
    document.querySelectorAll('input[name="homeLayoutChoice"]').forEach(input => {
        input.checked = input.value === layout;
    });
    document.dispatchEvent(new CustomEvent('homelayoutchange', { detail: { layout } }));
    return layout;
}

// Keep keyboard order matching what is on screen. In the New look the match
// setup comes first and ends with Start; the helpers (players on this
// device, app maintenance, roster, credits, QR) follow it. Classic gets the
// original order back.
function placeSections(layout) {
    const help = document.querySelector('#setupScreen .home-player-help');
    const play = byId('playSection');
    const presets = byId('presetsSection');
    const recording = byId('casualRecordingSetup');
    const roster = byId('rosterSection');
    const maintenance = byId('maintenanceSection');
    if (!play) return;
    const putAfter = (anchor, el) => { if (anchor && el && anchor.nextElementSibling !== el) anchor.after(el); };
    putAfter(presets, recording);
    putAfter(recording || presets, play);
    // Game card: "Jump back in" (Quick Start and recent games) above the
    // search, and the chosen game's description right above the list.
    const toolbar = document.querySelector('#gamePickerSection .picker-toolbar');
    const chips = byId('gameCategoryChips');
    const recents = byId('gameRecentsRow');
    const grid = byId('gameTypeGrid');
    const desc = byId('gameDescription');
    const select = byId('gameType');
    // Each moves with the line break in front of it, so Classic's markup comes
    // back exactly as it was.
    const withGap = el => (el.previousSibling?.nodeType === 3 && !el.previousSibling.textContent.trim() ? [el.previousSibling, el] : [el]);
    if (layout === 'next') {
        if (toolbar && recents && toolbar.previousElementSibling !== recents) toolbar.before(...withGap(recents));
        if (grid && desc && grid.previousElementSibling !== desc) grid.before(...withGap(desc));
    } else {
        if (chips && recents && chips.nextElementSibling !== recents) chips.after(...withGap(recents));
        if (grid && desc && grid.nextElementSibling !== desc) grid.after(...withGap(desc));
    }
    // The BotBlake note goes under the player rows, so the first name shows
    // without scrolling; Classic keeps it under the heading.
    const players = byId('playersSection');
    const botNote = players?.querySelector('.players-bot-note');
    const playersLabel = players?.querySelector(':scope > .setup-section-label');
    if (botNote && playersLabel) {
        if (layout === 'next') { if (players.lastElementChild !== botNote) players.append(botNote); }
        else if (playersLabel.nextSibling !== botNote) playersLabel.after(botNote);
    }
    if (layout === 'next') {
        let anchor = play;
        for (const el of [help, roster, maintenance]) {
            if (!el) continue;
            putAfter(anchor, el);
            anchor = el;
        }
    } else {
        const header = document.querySelector('#setupScreen .setup-header');
        putAfter(header, help);
        putAfter(play, maintenance);
        putAfter(maintenance, roster);
    }
}

// Resume sits before Start on screen, so it comes first for keyboard and
// screen readers too. In each player row the skill picker sits between the
// ▲ and ▼ buttons, matching the order they are drawn in. Classic keeps the
// original order.
function placePlayerControls(layout) {
    const start = byId('startGameBtn');
    const resume = byId('resumeGameBtn');
    if (start && resume && start.parentElement === resume.parentElement) {
        if (layout === 'next') { if (resume.nextElementSibling !== start) resume.after(start); }
        else if (start.nextElementSibling !== resume) start.after(resume);
    }
    [1, 2, 3, 4].forEach(n => {
        const row = byId(`player${n}Group`);
        const skill = byId(`player${n}Skill`)?.closest('label');
        const stepper = row?.querySelector('.player-order-stepper');
        const down = stepper?.querySelector('[data-player-order-action="down"]');
        if (!row || !skill || !stepper || !down) return;
        if (layout === 'next') { if (down.previousElementSibling !== skill) down.before(skill); }
        else if (stepper.nextElementSibling !== skill) stepper.after(skill);
    });
}

// The three numbered steps read as headings to screen readers.
function markStepHeadings(layout) {
    // Round 17: the Start card and App Maintenance too, and the setup card is
    // the page's main landmark.
    document.querySelectorAll('#setupScreen :is(#gamePickerSection, #gameOptionsSection, #playersSection, #playSection, #maintenanceSection) > .setup-section-label').forEach(label => {
        if (layout === 'next') { label.setAttribute('role', 'heading'); label.setAttribute('aria-level', '2'); }
        else { label.removeAttribute('role'); label.removeAttribute('aria-level'); }
    });
    const card = document.querySelector('#setupScreen > .setup-card');
    if (card) {
        if (layout === 'next') card.setAttribute('role', 'main');
        else card.removeAttribute('role');
    }
}

// The Manage Players fields keep a name once their placeholder is gone.
function labelRosterFields(layout) {
    [['rosterAddName', 'Player name'], ['rosterAddEmail', 'Player email']].forEach(([id, name]) => {
        const field = document.getElementById(id);
        if (!field) return;
        if (layout === 'next') field.setAttribute('aria-label', name);
        else if (field.getAttribute('aria-label') === name) field.removeAttribute('aria-label');
    });
}

// Screen readers hear the match summary with the Start button.
function describeStart(layout) {
    const start = document.getElementById('startGameBtn');
    if (!start) return;
    // One hidden sentence ("501, 2 players, Double Out"), so the browser
    // computes the description with the commas where they belong.
    const ids = 'homeNextStartDesc';
    if (layout === 'next' && document.getElementById(ids)) start.setAttribute('aria-describedby', ids);
    else if (['homeNextSummary', 'selectedGameTitle homeNextSummary', ids].includes(start.getAttribute('aria-describedby'))) start.removeAttribute('aria-describedby');
}

// Each ⓘ button says whether its rules are showing.
function syncRulesExpanded() {
    const pop = document.getElementById('gameRulesPop');
    const next = document.documentElement.dataset.home === 'next';
    document.querySelectorAll('#gameTypeGrid [data-rules-toggle]').forEach(button => {
        if (!next) { button.removeAttribute('aria-expanded'); return; }
        const open = !!pop && pop.dataset.gameId === button.dataset.rulesToggle;
        button.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
}

const isNext = () => document.documentElement.dataset.home === 'next';
const byId = id => document.getElementById(id);
const later = fn => setTimeout(fn, 0);

// A name cut short with an ellipsis can leave up to a letter's width of blank
// space after the "…" (the letter that did not fit). That reads as a double
// gap before the next word, so the words after it are pulled back by that
// amount. Returns the gap in pixels (0 when the text is not cut).
let ellipsisCanvas = null;
function ellipsisGap(el) {
    if (!el?.isConnected || !isNext() || el.scrollWidth <= el.clientWidth + 1) return 0;
    const text = [...el.childNodes].filter(node => node.nodeType === Node.TEXT_NODE && node.data.length).pop();
    if (!text) return 0;
    const cs = getComputedStyle(el);
    if (cs.textOverflow !== 'ellipsis' || cs.direction !== 'ltr') return 0;
    ellipsisCanvas ||= document.createElement('canvas').getContext('2d');
    ellipsisCanvas.font = cs.font;
    const dots = ellipsisCanvas.measureText('\u2026').width;
    const box = el.getBoundingClientRect();
    const limit = box.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight);
    const range = document.createRange();
    const rightAt = k => { range.setStart(text, 0); range.setEnd(text, k); return range.getBoundingClientRect().right; };
    let lo = 0, hi = text.data.length;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (rightAt(mid) + dots <= limit + 0.5) lo = mid; else hi = mid - 1; }
    if (!lo) return 0;
    const gap = limit - (rightAt(lo) + dots);
    return gap > 0.5 && gap < box.width ? gap : 0;
}
// Pulls each element back by the gaps of the cut texts before it.
function closeEllipsisGaps(pairs) {
    pairs.forEach(([, next]) => next?.style.removeProperty('translate'));
    let shift = 0;
    pairs.forEach(([el, next]) => {
        shift += ellipsisGap(el);
        if (next && shift) next.style.translate = `${-shift.toFixed(1)}px 0`;
    });
}

// --- Match summary in the Start bar -----------------------------------------

function visible(el) {
    return !!el && !el.closest('.hidden') && !el.hidden;
}

function summaryText() {
    const parts = [];
    const team = byId('teamMode');
    if (team?.checked) {
        parts.push('Teams');
    } else {
        const count = parseInt(byId('numPlayers')?.value || '2', 10) || 2;
        parts.push(count === 1 ? '1 player' : `${count} players`);
        const bots = [1, 2, 3, 4].slice(0, count)
            .filter(n => (byId(`player${n}Skill`)?.value || 'off') !== 'off').length;
        // "4 players · all BotBlakes" reads better than "4 BotBlakes". Start
        // refuses a match with no human, so the summary says what is missing.
        // Round 24: one wording at every size ("bots", as on phones).
        if (bots && bots === count) parts.push(count > 1 ? 'all bots' : 'BotBlake', 'add a human');
        else if (bots) parts.push(bots === 1 ? '1 bot' : `${bots} bots`);
    }
    const finish = byId('finishType');
    // 121 always plays double out, whatever the dropdown says.
    const fixedFinish = byId('gameType')?.value === '121';
    if (!fixedFinish && visible(byId('finishTypeOptions')) && finish?.selectedOptions?.[0]) {
        parts.push(finish.selectedOptions[0].textContent.trim());
    }
    return parts.join(' · ');
}

function mountSummary() {
    const title = byId('selectedGameTitle');
    if (!title || byId('homeNextSummary')) return;
    const summary = document.createElement('div');
    summary.id = 'homeNextSummary';
    summary.className = 'home-next-summary';
    title.after(summary);
    const wrap = document.createElement('div');
    wrap.className = 'home-next-match';
    title.before(wrap);
    wrap.append(title, summary);
    // With a game to resume, the summary gives way to Resume, so Start Game
    // carries the chosen game's name on a second line (drawn by CSS).
    const start = byId('startGameBtn');
    const nameStart = () => {
        if (!start) return;
        if (!isNext()) { delete start.dataset.hnGame; return; }
        if (start.dataset.hnGame !== title.textContent.trim()) start.dataset.hnGame = title.textContent.trim();
    };
    new MutationObserver(nameStart).observe(title, { childList: true, characterData: true, subtree: true });
    document.addEventListener('homelayoutchange', nameStart);
    nameStart();
    // Each part stays whole, so a line only ever breaks between parts. The
    // dots between parts are drawn by CSS (and dropped at the start of a
    // line); screen readers hear commas.
    const row = document.createElement('span');
    row.className = 'hn-summary-row';
    row.setAttribute('aria-hidden', 'true');
    const spoken = document.createElement('span');
    spoken.className = 'hn-visually-hidden';
    summary.append(row, spoken);
    const desc = document.createElement('span');
    desc.id = 'homeNextStartDesc';
    desc.hidden = true;
    document.body.append(desc);
    describeStart(document.documentElement.dataset.home);
    const startLive = document.createElement('div');
    startLive.id = 'homeNextStartLive';
    startLive.className = 'hn-visually-hidden';
    startLive.setAttribute('aria-live', 'polite');
    document.body.append(startLive);
    let warned = false;
    const update = () => {
        // "Add a human player" is a warning, not a fact: it goes last, on its own line.
        let parts = summaryText().split(' · ');
        const warn = parts.includes('add a human');
        if (warn) parts = [...parts.filter(part => part !== 'add a human'), 'Add a human player'];
        // The parts are drawn for the eye; screen readers get the same words
        // as one sentence with commas.
        row.replaceChildren(...parts.map((part, i) => {
            const span = document.createElement('span');
            span.className = warn && i === parts.length - 1 ? 'hn-summary-part hn-summary-warn' : 'hn-summary-part';
            span.textContent = part;
            return span;
        }));
        const sentence = parts.join(', ');
        if (spoken.textContent !== sentence) spoken.textContent = sentence;
        const full = [byId('selectedGameTitle')?.textContent.trim(), sentence].filter(Boolean).join(', ');
        if (desc.textContent !== full) desc.textContent = full;
        // While the warning shows, Start looks and reads as unavailable. A
        // press still gets the game's own message about adding a human.
        if (start) {
            if (warn && isNext()) { if (start.getAttribute('aria-disabled') !== 'true') start.setAttribute('aria-disabled', 'true'); }
            else if (start.hasAttribute('aria-disabled')) start.removeAttribute('aria-disabled');
        }
        // The change is read out once, when it happens.
        const warnNow = warn && isNext();
        if (warnNow !== warned) {
            warned = warnNow;
            startLive.textContent = '';
            if (warnNow) later(() => { startLive.textContent = 'Start needs a human player. Change a player from BotBlake to Human.'; });
        }
    };
    document.addEventListener('change', () => later(update), true);
    document.addEventListener('homelayoutchange', update);
    document.addEventListener('hntightchange', update);
    window.matchMedia?.('(max-width: 480px)').addEventListener?.('change', update);
    update();
}

// --- Resume button: game on one line, players on the next ------------------
// setup.js writes "Resume GAME (names)" as plain text. In the New look the
// two parts get their own lines so a long game or long names never cut the
// label mid-word. The text itself stays exactly as setup.js wrote it.

function splitResume(button) {
    const wrapped = button.querySelector('.hn-resume-main');
    // A split label's own text is in aria-label (its spans add "N players").
    const text = wrapped && button.hasAttribute('aria-label') ? button.getAttribute('aria-label') : button.textContent;
    // The split spans read as "( name vs name )"; the label keeps the
    // button's spoken name exactly as setup.js wrote it.
    if (!isNext()) {
        if (wrapped) button.textContent = text;
        button.removeAttribute('aria-label');
        ['data-hn-many', 'data-hn-count'].forEach(a => button.removeAttribute(a));
        return;
    }
    if (wrapped) return;
    button.removeAttribute('aria-label');
    const at = text.indexOf(' (');
    if (at < 0 || !text.endsWith(')')) return;
    button.setAttribute('aria-label', text);
    const main = document.createElement('span');
    main.className = 'hn-resume-main';
    main.textContent = text.slice(0, at + 1);
    const names = document.createElement('span');
    names.className = 'hn-resume-names';
    const inner = text.slice(at + 2, -1);
    const paren = ch => { const el = document.createElement('span'); el.className = 'hn-resume-paren'; el.textContent = ch; return el; };
    names.append(paren('('));
    // Split on the saved game's own names, so a name like "Tom vs Jerry"
    // stays whole; fall back to " vs " if they don't match the label.
    let list = null;
    try {
        const saved = JSON.parse(localStorage.getItem(BUILD_STORAGE.activeGame) || 'null');
        const savedNames = Array.isArray(saved?.players) ? saved.players.map(p => String(p?.name ?? '')) : null;
        if (savedNames?.length && savedNames.join(' vs ') === inner) list = savedNames;
    } catch { /* Unreadable storage: split on " vs ". */ }
    const all = list || inner.split(' vs ');
    all.forEach((name, i) => {
        const player = document.createElement('span');
        player.className = 'hn-resume-player';
        // The name has a box of its own, so a one-line row can cut each name
        // with its own "…" and keep every "vs" whole.
        const who = document.createElement('span');
        who.className = 'hn-resume-who';
        who.textContent = name;
        if (i) {
            // " vs " keeps its spaces in the text; on screen it is a fixed gap.
            const vs = document.createElement('span');
            vs.className = 'hn-resume-vs';
            vs.textContent = ' vs ';
            player.append(vs, who);
        } else player.append(who);
        names.append(player);
    });
    // Shown in place of the names when they would keep almost no letters
    // (the spoken name stays whole in aria-label).
    const count = document.createElement('span');
    count.className = 'hn-resume-count';
    count.setAttribute('aria-hidden', 'true');
    count.textContent = `${all.length} players`;
    names.append(count, paren(')'));
    button.toggleAttribute('data-hn-many', all.length > 2);
    button.replaceChildren(main, names);
}

function mountResumeLabel() {
    const button = byId('resumeGameBtn');
    if (!button) return;
    // In the one-line row (three or four players, or a compact bar) the
    // names are shortened here, so each ends in its own "…" right before the
    // next "vs" and the row stays centred: names short enough keep their full
    // text and the rest share what is left evenly. If a name would keep
    // fewer than three letters, the row reads "4 players" instead.
    const measure = document.createElement('canvas').getContext('2d');
    const px = value => parseFloat(value) || 0;
    const gaps = () => later(() => {
        const players = [...button.querySelectorAll('.hn-resume-player')];
        const whos = [...button.querySelectorAll('.hn-resume-who')];
        whos.forEach(who => { if (who.dataset.full == null) who.dataset.full = who.textContent; });
        const restore = () => whos.forEach(who => { if (who.textContent !== who.dataset.full) who.textContent = who.dataset.full; });
        const setCount = on => { if (on !== button.hasAttribute('data-hn-count')) button.toggleAttribute('data-hn-count', on); };
        if (!players.length || !isNext()) { restore(); setCount(false); closeEllipsisGaps(players.map((player, i) => [player, players[i + 1]])); return; }
        // Measured with the names showing (setCount puts "4 players" back).
        button.removeAttribute('data-hn-count');
        const oneLine = getComputedStyle(players[0]).display === 'flex';
        if (!oneLine || !measure) {
            restore(); setCount(false);
            closeEllipsisGaps(players.map((player, i) => [player, players[i + 1]]));
            return;
        }
        players.forEach(player => player.style.removeProperty('translate'));
        const names = button.querySelector('.hn-resume-names');
        const main = button.querySelector('.hn-resume-main');
        const bcs = getComputedStyle(button);
        let avail = button.clientWidth - px(bcs.paddingLeft) - px(bcs.paddingRight);
        if (main && names) {
            const m = main.getBoundingClientRect(), n = names.getBoundingClientRect();
            // Title and names side by side (landscape): the names get what the title leaves.
            if (m.height && m.bottom > n.top + 1 && n.bottom > m.top + 1) avail -= m.width + px(getComputedStyle(main).marginRight) + px(bcs.columnGap);
        }
        const ncs = names && getComputedStyle(names);
        if (ncs) avail -= px(ncs.marginLeft) + px(ncs.marginRight) + px(ncs.paddingLeft) + px(ncs.paddingRight);
        let budget = avail - 2;
        button.querySelectorAll('.hn-resume-vs').forEach(vs => {
            const vcs = getComputedStyle(vs);
            budget -= vs.getBoundingClientRect().width + px(vcs.marginLeft) + px(vcs.marginRight);
        });
        const wcs = getComputedStyle(whos[0]);
        measure.font = `${wcs.fontStyle} ${wcs.fontWeight} ${wcs.fontSize} ${wcs.fontFamily}`;
        const width = str => measure.measureText(str).width;
        const fulls = whos.map(who => who.dataset.full);
        const sizes = fulls.map(width);
        // Even shares: a name narrower than its share keeps all of it, and
        // the room it leaves goes to the others.
        const share = new Array(whos.length).fill(0);
        let left = budget, open = whos.map((_, i) => i);
        while (open.length) {
            const each = left / open.length;
            const fits = open.filter(i => sizes[i] <= each);
            if (!fits.length) { open.forEach(i => { share[i] = each; }); break; }
            fits.forEach(i => { share[i] = sizes[i]; left -= sizes[i]; });
            open = open.filter(i => sizes[i] > each);
        }
        let few = false;
        const texts = fulls.map((full, i) => {
            if (sizes[i] <= share[i] + 0.5) return full;
            const chars = [...full];
            const cut = k => chars.slice(0, k).join('').trimEnd() + '\u2026';
            let lo = 0, hi = chars.length - 1;
            while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (width(cut(mid)) <= share[i]) lo = mid; else hi = mid - 1; }
            if (lo < 3) few = true;
            return cut(Math.max(lo, 1));
        });
        if (few) { restore(); setCount(true); return; }
        setCount(false);
        whos.forEach((who, i) => { if (who.textContent !== texts[i]) who.textContent = texts[i]; });
    });
    const split = () => { splitResume(button); gaps(); };
    new MutationObserver(split).observe(button, { childList: true });
    document.addEventListener('homelayoutchange', split);
    window.addEventListener('resize', gaps, { passive: true });
    document.addEventListener('hntightchange', gaps);
    if (window.ResizeObserver) new ResizeObserver(gaps).observe(button);
    split();
}

// --- Player count as large segmented buttons --------------------------------

function mountPlayerCount() {
    const group = byId('numPlayersGroup');
    const select = byId('numPlayers');
    if (!group || !select || byId('homeNextPlayerCount')) return;
    const fieldset = document.createElement('fieldset');
    fieldset.id = 'homeNextPlayerCount';
    fieldset.className = 'home-next-segmented';
    const legend = document.createElement('legend');
    legend.textContent = 'Players at the board';
    fieldset.append(legend);
    const row = document.createElement('div');
    row.className = 'home-next-segmented-row';
    fieldset.append(row);
    const radios = [...select.options].map(option => {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'homeNextPlayers';
        input.value = option.value;
        const text = document.createElement('span');
        text.textContent = option.value;
        const sr = document.createElement('span');
        sr.className = 'visually-hidden';
        sr.textContent = option.value === '1' ? ' player' : ' players';
        text.append(sr);
        label.append(input, text);
        row.append(label);
        input.addEventListener('change', () => {
            if (!input.checked || select.value === input.value) return;
            select.value = input.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        return { input, option };
    });
    const hint = document.createElement('p');
    hint.id = 'homeNextPlayerCountHint';
    hint.className = 'home-next-count-hint';
    fieldset.append(hint);
    const sync = () => {
        for (const { input, option } of radios) {
            input.checked = option.value === select.value;
            input.disabled = option.disabled;
            input.closest('label').classList.toggle('is-disabled', option.disabled);
        }
        const allowed = radios.filter(r => !r.option.disabled).map(r => r.option.value);
        const limited = allowed.length && allowed.length < radios.length;
        hint.hidden = !limited;
        hint.textContent = !limited ? ''
            : allowed.length === 1 ? `This game is for ${allowed[0]} ${allowed[0] === '1' ? 'player' : 'players'}.`
            : `This game is for ${allowed[0]} to ${allowed[allowed.length - 1]} players.`;
        if (limited) fieldset.setAttribute('aria-describedby', hint.id);
        else fieldset.removeAttribute('aria-describedby');
    };
    group.prepend(fieldset);
    group.classList.add('home-next-count-group');
    select.addEventListener('change', () => later(sync));
    byId('gameType')?.addEventListener('change', () => later(sync));
    sync();
}

// --- Customize: choose New look or Classic ----------------------------------

function mountLayoutChoice() {
    const host = document.querySelector('#settingsModal .settings-modal-content');
    if (!host || byId('homeLayoutSection')) return;
    const section = document.createElement('fieldset');
    section.id = 'homeLayoutSection';
    section.className = 'settings-section home-layout-choice';
    const legend = document.createElement('legend');
    legend.className = 'settings-section-label';
    legend.textContent = 'Home screen';
    section.append(legend);
    const options = [
        ['next', 'New look', 'Cleaner setup, big buttons'],
        ['classic', 'Classic', 'The original layout']
    ];
    const row = document.createElement('div');
    row.className = 'home-layout-choice-row';
    for (const [value, title, sub] of options) {
        const label = document.createElement('label');
        label.className = 'home-layout-option';
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'homeLayoutChoice';
        input.value = value;
        const strong = document.createElement('strong');
        strong.textContent = title;
        const small = document.createElement('span');
        small.textContent = sub;
        label.append(input, strong, small);
        row.append(label);
        input.addEventListener('change', () => {
            if (!input.checked) return;
            applyLayout(value);
            try { localStorage.setItem(HOME_LAYOUT_KEY, value); } catch { /* visit only */ }
        });
    }
    section.append(row);
    const done = byId('settingsCloseBtn');
    if (done && done.parentElement === host) host.insertBefore(section, done);
    else host.append(section);
    applyLayout(document.documentElement.dataset.home);
    // Mid-game Customize leaves the Home screen choice out. CSS does this
    // with :has(); this also covers browsers without it.
    const setup = byId('setupScreen');
    const hideMidGame = () => {
        const away = !!setup && setup.style.display === 'none';
        if (away !== section.hidden) section.hidden = away;
    };
    hideMidGame();
    if (setup) new MutationObserver(hideMidGame).observe(setup, { attributes: true, attributeFilter: ['style'] });
}

// --- Rules popover follows its card while the page scrolls -----------------

function markRulesEnd(pop) {
    const end = !pop.hasAttribute('tabindex') || pop.scrollTop + pop.clientHeight >= pop.scrollHeight - 2;
    pop.toggleAttribute('data-hn-more', !end);
}
// Tab from an open ⓘ goes into its scrollable rules; Tab from the rules goes
// on to whatever follows the ⓘ, and Shift+Tab goes back to the ⓘ.
function rulesTab(event) {
    if (event.key !== 'Tab' || !isNext()) return;
    const pop = byId('gameRulesPop');
    if (!pop || !pop.hasAttribute('tabindex')) return;
    const button = [...document.querySelectorAll('[data-rules-toggle]')].find(el => el.dataset.rulesToggle === pop.dataset.gameId);
    if (!button) return;
    if (document.activeElement === button && !event.shiftKey) {
        event.preventDefault();
        pop.focus();
    } else if (document.activeElement === pop) {
        event.preventDefault();
        if (event.shiftKey) { button.focus(); return; }
        const all = [...document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')]
            .filter(el => el !== pop && !el.disabled && el.offsetParent !== null && el.tabIndex >= 0);
        const after = all.find(el => button.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING && !button.contains(el));
        pop.remove();
        syncRulesExpanded();
        (after || button).focus();
    }
}

function followRulesPop(event) {
    const pop = byId('gameRulesPop');
    if (!pop || !isNext()) return;
    // Scrolling the popover's own text moves nothing, but updates its fade.
    if (event?.target === pop) { markRulesEnd(pop); return; }
    const id = pop.dataset.gameId;
    const button = id && [...document.querySelectorAll('[data-rules-toggle]')]
        .find(el => el.dataset.rulesToggle === id);
    const close = () => { pop.remove(); syncRulesExpanded(); };
    if (!button) { close(); return; }
    const anchor = button.getBoundingClientRect();
    // The Start bar sits over the page on phones (fixed) and at the bottom of
    // the list column on wider screens (sticky). Treat it as the floor only
    // where it actually covers the ⓘ button's column.
    const bar = byId('playSection');
    let barTop = window.innerHeight;
    if (bar && /^(fixed|sticky)$/.test(getComputedStyle(bar).position)) {
        const b = bar.getBoundingClientRect();
        if (b.width && b.left < anchor.right && b.right > anchor.left && b.top < window.innerHeight) barTop = b.top;
    }
    // Close once the button is partly hidden, by the page, the game list or the bar.
    const list = byId('gameTypeGrid')?.getBoundingClientRect();
    const visTop = Math.max(0, list ? list.top : 0) - 2;
    const visBottom = Math.min(window.innerHeight, list ? list.bottom : window.innerHeight, barTop) + 2;
    if (!anchor.width || anchor.top < visTop || anchor.bottom > visBottom) { close(); return; }
    const margin = 12;
    // While the rules are open the Start bar isn't needed: the popover may
    // run over it, so long rules get the whole height of the window.
    const floor = window.innerHeight - margin;
    // Below the button if it fits, otherwise above; if neither fits, the
    // larger side with the text scrolling, so it never covers its button.
    pop.style.maxHeight = '';
    pop.style.overflowY = '';
    // A long name like "Team Cricket/400" may break after its slash, never inside "400".
    const titleEl = pop.querySelector('strong');
    if (titleEl && !titleEl.dataset.hnWbr && titleEl.textContent.includes('/')) {
        titleEl.dataset.hnWbr = '1';
        // Split only the text, so the icon keeps its aria-hidden span.
        [...titleEl.childNodes].filter(n => n.nodeType === Node.TEXT_NODE && n.data.includes('/')).forEach(node => {
            const parts = node.data.split('/');
            node.replaceWith(...parts.flatMap((part, i) => i ? ['/', document.createElement('wbr'), part] : [part]));
        });
    }
    // It stays inside the column of game cards, side to side.
    const cardsBox = () => {
        const grid = byId('gameTypeGrid');
        if (!grid || !grid.clientWidth) return byId('gamePickerSection')?.getBoundingClientRect();
        const r = grid.getBoundingClientRect();
        const cs = getComputedStyle(grid);
        const left = r.left + grid.clientLeft + (parseFloat(cs.paddingLeft) || 0);
        return { left, right: r.left + grid.clientLeft + grid.clientWidth - (parseFloat(cs.paddingRight) || 0), width: 1 };
    };
    const panel = cardsBox();
    const lo = Math.max(margin, panel?.width ? panel.left : 0);
    const hi = Math.min(window.innerWidth - margin, panel?.width ? panel.right : window.innerWidth);
    pop.style.maxWidth = `${Math.floor(hi - lo)}px`;
    const box = pop.getBoundingClientRect();
    const below = floor - (anchor.bottom + 8);
    const above = anchor.top - 8 - margin;
    let side = 'below';
    if (box.height > below) side = box.height <= above || above > below ? 'above' : 'below';
    const room = side === 'below' ? below : above;
    const height = Math.min(box.height, Math.max(48, room));
    if (height < box.height) { pop.style.maxHeight = `${Math.floor(height)}px`; pop.style.overflowY = 'auto'; }
    // Text that still doesn't fit can be reached from the keyboard (Tab from
    // its ⓘ moves into it) and shows a fade while more is below.
    const heading = pop.querySelector('strong');
    // The name is the heading without its hidden icon, so "501" keeps its digits.
    const gameName = heading ? [...heading.childNodes].filter(n => !(n.nodeType === Node.ELEMENT_NODE && n.getAttribute('aria-hidden') === 'true')).map(n => n.textContent).join('').trim() : '';
    if (height < box.height) { pop.tabIndex = 0; pop.setAttribute('aria-label', gameName ? `${gameName} rules, scrollable` : 'Rules, scrollable'); }
    else { pop.removeAttribute('tabindex'); pop.removeAttribute('aria-label'); }
    markRulesEnd(pop);
    let left = anchor.left + anchor.width / 2 - box.width / 2;
    left = Math.max(lo, Math.min(left, hi - box.width));
    const top = side === 'below' ? anchor.bottom + 8 : anchor.top - 8 - height;
    pop.dataset.hnSide = side;
    pop.style.setProperty('--hn-arrow-x', `${Math.round(Math.max(14, Math.min(box.width - 14, anchor.left + anchor.width / 2 - left)))}px`);
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
}

// --- Rules popover for screen readers -------------------------------------
// The popover is a note tied to its ⓘ button, and its text is read out
// through a live region that stays in the page.

function mountRulesA11y() {
    const live = document.createElement('div');
    live.id = 'homeNextRulesLive';
    live.className = 'hn-visually-hidden';
    live.setAttribute('aria-live', 'polite');
    document.body.append(live);
    const sync = () => {
        const pop = byId('gameRulesPop');
        const next = isNext();
        document.querySelectorAll('#gameTypeGrid [data-rules-toggle]').forEach(button => {
            const open = next && !!pop && pop.dataset.gameId === button.dataset.rulesToggle;
            if (open) { button.setAttribute('aria-controls', 'gameRulesPop'); button.setAttribute('aria-describedby', 'gameRulesPop'); }
            else { button.removeAttribute('aria-controls'); button.removeAttribute('aria-describedby'); }
        });
        if (pop && next) {
            pop.setAttribute('role', 'note');
            const text = [...pop.children].map(c => c.textContent.replace(/\s+/g, ' ').replace(/^[^\p{L}\p{N}]+/u, '').trim()).filter(Boolean).join('. ');
            if (live.textContent !== text) live.textContent = text;
        } else if (live.textContent) {
            live.textContent = '';
        }
    };
    new MutationObserver(sync).observe(document.body, { childList: true });
    const grid = byId('gameTypeGrid');
    if (grid) new MutationObserver(sync).observe(grid, { childList: true });
    document.addEventListener('homelayoutchange', sync);
    // The page behind the popover is dimmed, so a tap there only closes the
    // popover (focus goes back to its ⓘ) and never acts on what lies beneath.
    // A swipe still scrolls; only a completed tap is taken.
    let swallow = null;
    const outside = target => {
        const pop = byId('gameRulesPop');
        if (!pop || !isNext() || !(target instanceof Element) || pop.contains(target)) return null;
        return target.closest('[data-rules-toggle]')?.dataset.rulesToggle === pop.dataset.gameId ? null : pop.dataset.gameId;
    };
    window.addEventListener('pointerdown', event => {
        swallow = event.isPrimary === false ? null : outside(event.target);
        // No focus moves to the dimmed control under the press.
        if (swallow) event.preventDefault();
    }, true);
    window.addEventListener('pointercancel', () => { swallow = null; }, true);
    window.addEventListener('click', event => {
        const id = swallow;
        swallow = null;
        if (!id || event.detail === 0) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const pop = byId('gameRulesPop');
        if (pop && pop.dataset.gameId === id) { pop.remove(); syncRulesExpanded(); }
        [...document.querySelectorAll('#gameTypeGrid [data-rules-toggle]')].find(b => b.dataset.rulesToggle === id)?.focus({ preventScroll: true });
    }, true);
    // Moving focus anywhere else closes the popover.
    document.addEventListener('focusin', event => {
        const pop = byId('gameRulesPop');
        if (!pop || !isNext()) return;
        const t = event.target;
        if (pop.contains(t)) return;
        if (t.closest?.('[data-rules-toggle]')?.dataset.rulesToggle === pop.dataset.gameId) return;
        pop.remove();
        syncRulesExpanded();
    });
    sync();
}

// --- Keep keyboard focus when the game list is rebuilt ---------------------
// Starring or picking a game redraws the list. Put focus back on the same
// control so keyboard and switch users don't land at the top of the page.

function mountGridFocus() {
    const grid = byId('gameTypeGrid');
    if (!grid) return;
    let last = null;
    const keyOf = el => {
        for (const attr of ['data-rules-toggle', 'data-fav-toggle', 'data-game-value']) {
            const hit = el.closest?.(`[${attr}]`);
            if (hit && grid.contains(hit)) return [attr, hit.getAttribute(attr)];
        }
        return null;
    };
    grid.addEventListener('focusin', event => { last = keyOf(event.target); });
    document.addEventListener('focusin', event => { if (!grid.contains(event.target)) last = null; });
    document.addEventListener('pointerdown', event => { if (!grid.contains(event.target)) last = null; }, true);
    new MutationObserver(() => {
        if (!last || !isNext()) return;
        const active = document.activeElement;
        if (active && active !== document.body && document.contains(active)) return;
        const [attr, value] = last;
        const el = [...grid.querySelectorAll(`[${attr}]`)].find(node => node.getAttribute(attr) === value);
        el?.focus({ preventScroll: true });
    }).observe(grid, { childList: true });
}

// --- Favourite stars as toggle buttons --------------------------------------
// In the New look each star keeps one name ("Favorite 701") with
// aria-pressed for its state, and a change is read out. Classic keeps the
// original "Favorite" / "Unfavorite" names.

function mountFavToggles() {
    const grid = byId('gameTypeGrid');
    if (!grid) return;
    const nameOf = button => (button.getAttribute('aria-label') || '').replace(/^(Unfavorite|Favorite)\s+/, '');
    const sync = () => {
        grid.querySelectorAll('[data-fav-toggle]').forEach(button => {
            const faved = button.classList.contains('faved');
            const name = button.dataset.hnFavName || nameOf(button);
            button.dataset.hnFavName = name;
            if (isNext()) {
                const label = `Favorite ${name}`;
                if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label);
                if (button.getAttribute('aria-pressed') !== String(faved)) button.setAttribute('aria-pressed', String(faved));
            } else {
                const label = `${faved ? 'Unfavorite' : 'Favorite'} ${name}`;
                if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label);
                button.removeAttribute('aria-pressed');
                delete button.dataset.hnFavName;
            }
        });
    };
    grid.addEventListener('click', event => {
        const button = event.target.closest?.('[data-fav-toggle]');
        if (!button || !grid.contains(button) || !isNext()) return;
        const id = button.dataset.favToggle;
        const name = button.dataset.hnFavName || nameOf(button);
        setTimeout(() => {
            const now = [...grid.querySelectorAll('[data-fav-toggle]')].find(node => node.dataset.favToggle === id);
            const live = byId('homeNextSearchLive');
            if (!now || !live) return;
            live.textContent = '';
            requestAnimationFrame(() => { live.textContent = `${name} ${now.classList.contains('faved') ? 'added to' : 'removed from'} favorites`; });
        }, 0);
    }, true);
    new MutationObserver(sync).observe(grid, { childList: true });
    document.addEventListener('homelayoutchange', sync);
    sync();
}

// --- "Jump back in": keep keyboard focus when the row is redrawn ------------
// Choosing a recent game redraws the row; focus goes back to the same chip.

function mountRecentsFocus() {
    const row = byId('gameRecentsRow');
    if (!row) return;
    let last = null;
    const keyOf = el => {
        const chip = el.closest?.('.picker-recent-chip');
        if (!chip || !row.contains(chip)) return null;
        return chip.hasAttribute('data-quickstart') ? ['data-quickstart', null] : ['data-recent', chip.dataset.recent];
    };
    row.addEventListener('focusin', event => { last = keyOf(event.target); });
    document.addEventListener('focusin', event => { if (!row.contains(event.target)) last = null; });
    // A press elsewhere (even on blank page, which moves no focus) ends it.
    document.addEventListener('pointerdown', event => { if (!row.contains(event.target)) last = null; }, true);
    new MutationObserver(() => {
        if (!last || !isNext()) return;
        const active = document.activeElement;
        if (active && active !== document.body && document.contains(active)) return;
        const [attr, value] = last;
        const el = [...row.querySelectorAll(`[${attr}]`)].find(node => value === null || node.getAttribute(attr) === value);
        if (el && el.getClientRects().length) el.focus({ preventScroll: true });
    }).observe(row, { childList: true });
}

// --- App tabs: wrap rather than scroll when they don't fit -----------------
// At large text sizes the three tabs may not fit on one row at any width;
// then they wrap onto two rows (as Classic does) instead of hiding the last.

function mountTabsFit() {
    const nav = document.querySelector('#setupScreen .dev-app-nav');
    if (!nav) return;
    // A tab whose words don't fit beside its Sample badge puts the badge
    // under the words (data-hn-stack); a row that still doesn't fit wraps.
    const overflows = el => el.scrollWidth > el.clientWidth + 1 || [...el.children].some(child => {
        const a = child.getBoundingClientRect(), b = el.getBoundingClientRect();
        return a.width && (a.left < b.left - 0.5 || a.right > b.right + 0.5);
    });
    const fit = () => {
        nav.removeAttribute('data-hn-wrap');
        nav.removeAttribute('data-hn-stack');
        nav.removeAttribute('data-hn-cols');
        if (!isNext() || !nav.clientWidth) return;
        const all = [...nav.querySelectorAll(':scope > :is(a, button)')];
        const tabs = all.filter(tab => tab.querySelector('.feature-test-badge'));
        const stack = () => { nav.removeAttribute('data-hn-stack'); if (tabs.some(overflows)) nav.setAttribute('data-hn-stack', ''); };
        stack();
        // Large text already lets the row wrap, so a wrap shows as tabs on
        // more than one line as well as a row wider than the bar.
        const lines = new Set(all.map(tab => Math.round(tab.getBoundingClientRect().top / 8)));
        if (nav.scrollWidth <= nav.clientWidth + 1 && lines.size < 2) return;
        nav.setAttribute('data-hn-wrap', '');
        // A wrapped row reads as three equal cells (words may wrap inside
        // one), or as one tab per row when a word won't fit a third, never
        // two on top and one alone underneath.
        nav.setAttribute('data-hn-cols', '3');
        stack();
        if (all.some(overflows)) { nav.setAttribute('data-hn-cols', '1'); stack(); }
    };
    let width = -1;
    new ResizeObserver(() => { if (nav.clientWidth !== width) { width = nav.clientWidth; fit(); } }).observe(nav);
    // A text-size change at the same width resizes the badges, so they are
    // watched too (the result only changes when the fit really changes).
    let queued = false;
    const soon = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; fit(); }); };
    const badges = new ResizeObserver(soon);
    nav.querySelectorAll('.feature-test-badge').forEach(badge => badges.observe(badge));
    ['homelayoutchange', 'hntightchange'].forEach(name => document.addEventListener(name, fit));
    window.addEventListener('resize', () => later(fit));
    document.fonts?.ready?.then(fit);
    fit();
}

// --- Team builder by keyboard and screen reader ----------------------------
// teams.js works on pointer presses. In the New look, keyboard presses on its
// buttons are passed through as the same press, every button says what it
// does, each member gets a Remove button, Home and Away take the chosen player
// with Enter or Space, and each move is read out.

function mountTeamA11y() {
    const screen = byId('teamBuilderScreen');
    if (!screen) return;
    // teams.js stops the browser's own focus change on these taps, so a tap
    // after typing a name would leave the phone keyboard up over the Put
    // buttons. The tapped button takes focus instead, which closes it.
    screen.addEventListener('pointerdown', event => {
        if (!isNext() || event.pointerId === 31337) return;
        const target = event.target.closest?.('.team-chip, .hn-zone-put, [data-member-action], [data-zone-member-id], .team-zone');
        const active = document.activeElement;
        if (!target || !active?.matches?.('input:not([type="checkbox"]):not([type="radio"]), textarea') || !screen.contains(active)) return;
        active.blur();
        const button = target.closest('button, .team-chip, [tabindex]');
        if (button) button.focus({ preventScroll: true });
    }, true);
    // With a player chosen, Tab goes from "Put in Home" straight to "Put in
    // Away" (the two choices), then on through Home's and Away's members.
    const focusable = el => !el.disabled && el.getClientRects().length && !el.closest('[hidden], .hidden, [inert]');
    const inZone = idx => [...(byId(`teamZone${idx}`)?.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') || [])].filter(focusable);
    screen.addEventListener('keydown', event => {
        if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey || !isNext()) return;
        const puts = [0, 1].map(idx => byId(`teamZone${idx}`)?.querySelector(':scope > .hn-zone-put'));
        if (!puts[0] || !puts[1] || !focusable(puts[0]) || !focusable(puts[1])) return;
        const order = [puts[0], puts[1], ...inZone(0).filter(el => el !== puts[0]), ...inZone(1).filter(el => el !== puts[1])];
        const away = byId('teamZone1');
        const after = [...screen.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
            .find(el => focusable(el) && !away.contains(el) && (away.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
        const at = order.indexOf(document.activeElement);
        let to = null;
        if (at < 0) {
            // Back from whatever follows the Away team: to the last member.
            if (event.shiftKey && after && document.activeElement === after) to = order[order.length - 1];
        } else {
            to = order[at + (event.shiftKey ? -1 : 1)];
            // Past the last member: on to whatever follows the Away team.
            if (!to && !event.shiftKey) to = after;
        }
        if (!to) return;
        event.preventDefault();
        to.focus();
    });
    const live = document.createElement('div');
    live.id = 'homeNextTeamLive';
    live.className = 'hn-visually-hidden';
    live.setAttribute('aria-live', 'polite');
    screen.append(live);
    const say = text => { live.textContent = ''; later(() => { live.textContent = text; }); };
    const nameIn = node => {
        const name = node?.querySelector('.team-zone-member-name')?.cloneNode(true);
        name?.querySelector('.team-chip-order')?.remove();
        return name ? name.textContent.trim() : '';
    };
    const memberNode = id => screen.querySelector(`.team-zone-member[data-zone-member-id="${CSS.escape(id)}"]`);
    const zoneName = idx => byId(`teamZone${idx}Label`)?.textContent.trim() || (idx ? 'Away' : 'Home');
    const zoneOf = id => { const m = memberNode(id); return m ? Number(m.dataset.zoneIdx) : null; };
    // Randomize and Load last change the whole line-up at once: read it out.
    const lineup = () => {
        const parts = [0, 1].map(idx => {
            const names = [...(byId(`teamZone${idx}`)?.querySelectorAll('.team-zone-member') || [])].map(nameIn).filter(Boolean);
            return `${zoneName(idx)}: ${names.length ? names.join(', ') : 'nobody yet'}.`;
        });
        return `${parts.join(' ')} ${zoneName(byId('teamZone1')?.classList.contains('first') ? 1 : 0)} throws first.`;
    };
    ['teamRandomizeBtn', 'teamLoadLastBtn'].forEach(id => byId(id)?.addEventListener('click', () => {
        if (!isNext()) return;
        later(() => say(id === 'teamRandomizeBtn' ? `New team order. ${lineup()}` : `Last team setup loaded. ${lineup()}`));
    }));
    byId('teamSwapFirstBtn')?.addEventListener('click', () => {
        if (!isNext()) return;
        later(() => say(`${zoneName(byId('teamZone1')?.classList.contains('first') ? 1 : 0)} throws first`));
    });
    const label = () => {
        const next = isNext();
        screen.querySelectorAll('.team-zone-member').forEach(member => {
            let remove = member.querySelector('[data-member-action="hn-remove"]');
            let grip = member.querySelector(':scope > .hn-grip');
            const skill = member.querySelector(':scope > label');
            if (!next) {
                remove?.remove(); grip?.remove();
                // Classic: the skill picker goes back to its original place.
                if (skill?.hnHome?.parentNode === member && skill.nextSibling !== skill.hnHome) member.insertBefore(skill, skill.hnHome);
                return;
            }
            // Swipes on the row scroll the page; dragging starts from this grip.
            if (!grip) {
                grip = document.createElement('span');
                grip.className = 'hn-grip';
                grip.setAttribute('aria-hidden', 'true');
                grip.title = 'Drag';
                grip.textContent = '☰';
                member.prepend(grip);
            }
            if (!remove) {
                remove = document.createElement('button');
                remove.type = 'button';
                remove.className = 'hn-member-remove';
                remove.dataset.memberAction = 'hn-remove';
                remove.dataset.memberId = member.dataset.zoneMemberId;
                remove.textContent = '✕';
                member.append(remove);
            }
            // Round 24: a bot's skill picker shows below the row's buttons, so
            // it comes after them for Tab and screen readers too.
            if (skill && member.lastElementChild !== skill) {
                if (!skill.hnHome) skill.hnHome = skill.nextSibling;
                member.append(skill);
            }
        });
        screen.querySelectorAll('[data-member-action]').forEach(button => {
            if (!next) { if (button.dataset.hnLabel) { button.removeAttribute('aria-label'); delete button.dataset.hnLabel; } return; }
            const name = nameIn(button.closest('.team-zone-member')) || 'player';
            const act = button.dataset.memberAction;
            const text = act === 'swap' ? `Move ${name} to the other team`
                : act === 'hn-remove' ? `Take ${name} off the team`
                : `Move ${name} ${act}`;
            if (button.getAttribute('aria-label') !== text) { button.setAttribute('aria-label', text); button.dataset.hnLabel = '1'; }
        });
        screen.querySelectorAll('.team-chip[data-chip-id]').forEach(chip => {
            if (next) chip.setAttribute('aria-pressed', chip.classList.contains('selected') ? 'true' : 'false');
            else chip.removeAttribute('aria-pressed');
        });
        const chosen = next ? screen.querySelector('.team-chip.selected') : null;
        const chosenName = chosen?.textContent.trim();
        [0, 1].forEach(idx => {
            const zone = byId(`teamZone${idx}`);
            if (!zone) return;
            let put = zone.querySelector(':scope > .hn-zone-put');
            if (next) {
                zone.setAttribute('role', 'group');
                if (zone.getAttribute('aria-labelledby') !== `teamZone${idx}Label`) zone.setAttribute('aria-labelledby', `teamZone${idx}Label`);
                ['aria-label', 'tabindex', 'aria-describedby'].forEach(a => zone.removeAttribute(a));
            } else {
                ['tabindex', 'role', 'aria-labelledby', 'aria-label', 'aria-describedby'].forEach(a => zone.removeAttribute(a));
            }
            // With a player chosen, each team shows its own button that takes them.
            if (next && chosen) {
                const text = `Put ${chosenName} in ${zoneName(idx)}`;
                if (!put) {
                    put = document.createElement('button');
                    put.type = 'button';
                    put.className = 'hn-zone-put';
                    put.dataset.zone = String(idx);
                    const anchor = byId(`teamZone${idx}FirstBadge`) || byId(`teamZone${idx}Label`);
                    if (anchor?.parentElement === zone) anchor.after(put); else zone.prepend(put);
                    putWatch?.observe(put);
                }
                if (put.getAttribute('aria-label') !== text) {
                    // A long name is cut short with an ellipsis so the team name stays on the button.
                    const who = document.createElement('span');
                    who.className = 'hn-put-name';
                    who.textContent = chosenName;
                    who.dataset.full = chosenName;
                    // The words round the name are spans of their own, so the
                    // spaces keep their width beside it in the one-line layout.
                    const before = document.createElement('span');
                    before.className = 'hn-put-word';
                    before.textContent = 'Put';
                    const after = document.createElement('span');
                    after.className = 'hn-put-word hn-put-word--after';
                    after.textContent = `in\u00a0${zoneName(idx)}`;
                    put.replaceChildren(before, who, after);
                    put.setAttribute('aria-label', text);
                }
                markCut(put);
            } else if (put) {
                const hadFocus = put === document.activeElement;
                put.remove();
                // Nobody left waiting: Start Match if it is ready, else the placed
                // player's ⇄ (never their ✕, which a repeated press would hit).
                const placed = justPlaced && `[data-member-id="${CSS.escape(justPlaced)}"][data-member-action="swap"]`;
                // Escape let go of the player: focus goes back to that player's chip.
                const back = letGo && `.team-chip[data-chip-id="${CSS.escape(letGo)}"]`;
                if (hadFocus) focusFirst(back, '#teamTray .team-chip', '#teamStartMatchBtn:not(:disabled)', placed, '#teamAddName');
            }
        });
        // A new pick: bring the Away button into view (Home sits above it).
        const pickId = chosen?.dataset.chipId || null;
        if (pickId && pickId !== lastPick) {
            const away = byId('teamZone1')?.querySelector(':scope > .hn-zone-put');
            const home = byId('teamZone0')?.querySelector(':scope > .hn-zone-put');
            const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
            // After any refocus of the chip, so nothing cancels the scroll.
            // When both buttons can't be in view at once (long names, large
            // text), Home's button comes into view instead, with Away below it.
            if (away) later(() => later(() => {
                const top = home ? home.getBoundingClientRect().top : away.getBoundingClientRect().top;
                const both = away.getBoundingClientRect().bottom - top <= (window.visualViewport?.height || innerHeight) - 16;
                (both || !home ? away : home).scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
            }));
        }
        lastPick = pickId;
    };
    // A name cut short ends in an ellipsis, whose own spacing would read as a
    // double gap before "in Home"; the button is marked so CSS can close it.
    // The name is shortened here, letter by letter, so the "…" is the last
    // thing in its box and the gap before "in Home" is always the same.
    // (The button's spoken name is its aria-label, with the whole name.)
    // Everything is measured without touching the page, and the name is
    // written only when the shortened text really changes, so redrawing the
    // button never sets off another round of measuring.
    const measure = document.createElement('canvas').getContext('2d');
    const px = value => parseFloat(value) || 0;
    // Both buttons show the same cut (the shorter one), so the name reads the
    // same in "Put … in Home" and "Put … in Away".
    const fitLength = (put, who, chars) => {
        const zone = put.parentElement;
        const zcs = getComputedStyle(zone);
        const pcs = getComputedStyle(put);
        // The button is centred with auto side margins, so it may use the zone's whole width.
        const avail = zone.clientWidth - px(zcs.paddingLeft) - px(zcs.paddingRight);
        let room = avail - px(pcs.paddingLeft) - px(pcs.paddingRight) - px(pcs.borderLeftWidth) - px(pcs.borderRightWidth);
        for (const el of put.children) {
            if (el === who) continue;
            const ecs = getComputedStyle(el);
            room -= el.getBoundingClientRect().width + px(ecs.marginLeft) + px(ecs.marginRight);
        }
        const wcs = getComputedStyle(who);
        room -= px(wcs.marginLeft) + px(wcs.marginRight) + px(wcs.paddingLeft) + px(wcs.paddingRight) + 1;
        measure.font = `${wcs.fontStyle} ${wcs.fontWeight} ${wcs.fontSize} ${wcs.fontFamily}`;
        const spacing = px(wcs.letterSpacing);
        const width = str => measure.measureText(str).width + spacing * [...str].length;
        if (width(chars.join('')) <= room) return chars.length;
        let lo = 1, hi = chars.length - 1;
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (width(shortened(chars, mid)) <= room) lo = mid; else hi = mid - 1; }
        return lo;
    };
    const shortened = (chars, k) => chars.slice(0, k).join('').trimEnd() + '\u2026';
    let cutPending = false;
    const markAllCut = () => {
        if (cutPending) return;
        cutPending = true;
        later(() => {
            cutPending = false;
            const puts = [...screen.querySelectorAll('.hn-zone-put')].map(put => ({ put, who: put.querySelector('.hn-put-name') })).filter(item => item.who && item.put.isConnected);
            if (!puts.length) return;
            puts.forEach(item => { item.full = item.who.dataset.full ?? item.who.textContent; if (item.who.dataset.full !== item.full) item.who.dataset.full = item.full; });
            const chars = [...puts[0].full];
            let k = chars.length;
            // Measured on one line; the wrapped layout comes off first.
            puts.forEach(({ put }) => put.removeAttribute('data-hn-wrap'));
            if (isNext() && !document.documentElement.hasAttribute('data-hn-tight') && measure) {
                puts.forEach(item => { if (item.full === puts[0].full) k = Math.min(k, fitLength(item.put, item.who, chars)); });
            }
            // Round 24: a cut that would keep fewer than three letters says
            // nothing about who is placed, so the full name wraps instead.
            const wrap = k < chars.length && k < 3;
            if (wrap) k = chars.length;
            puts.forEach(({ put, who, full }) => {
                if (wrap && full === puts[0].full) put.setAttribute('data-hn-wrap', '');
                const text = full === puts[0].full && k < chars.length ? shortened(chars, k) : full;
                if (who.textContent !== text) who.textContent = text;
                const cut = text !== full;
                if (cut !== put.hasAttribute('data-hn-cut')) put.toggleAttribute('data-hn-cut', cut);
            });
        });
    };
    const markCut = () => markAllCut();
    // A button that changes width (layout settling, the other team's button
    // appearing) measures its cut name again.
    const putWatch = window.ResizeObserver ? new ResizeObserver(entries => entries.forEach(entry => markCut(entry.target))) : null;
    window.addEventListener('resize', markAllCut, { passive: true });
    document.addEventListener('hntightchange', markAllCut);
    let lastPick = null;
    let justPlaced = null;
    let letGo = null;
    const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
    const point = el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
    const pointer = (type, target, at) => (target || document).dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, button: 0, pointerId: 31337, isPrimary: true, clientX: at.x, clientY: at.y,
    }));
    const press = target => { const at = point(target); pointer('pointerdown', target, at); pointer('pointerup', null, at); };
    // Taking a member off uses the same drag back to the tray that a finger would.
    const dragToTray = member => {
        const tray = byId('teamTray');
        if (!member || !tray) return;
        const from = point(member);
        const to = point(tray);
        pointer('pointerdown', member, from);
        pointer('pointermove', null, to);
        pointer('pointerup', null, to);
    };
    const focusIn = (preventScroll, selectors) => later(() => {
        for (const selector of selectors) {
            const el = selector && screen.querySelector(selector);
            if (el && !el.disabled && el.offsetParent !== null) { el.focus({ preventScroll }); return; }
        }
    });
    const focusFirst = (...selectors) => focusIn(false, selectors);
    // A chip that was just pressed is already on screen; refocusing it must not
    // undo the scroll that brings the Home and Away buttons into view.
    const focusChip = (...selectors) => focusIn(true, selectors);
    // The builder redraws its buttons on pointerdown, so the click that follows
    // a real press can land on a different button. Any no-detail click soon
    // after a real press, with no key pressed since, belongs to that press.
    let lastRealPress = 0;
    // A real tap or click (VoiceOver's double-tap included) gets the same
    // feedback as a keyboard press: the move is read out and focus stays.
    const snapshot = () => {
        const members = new Map();
        screen.querySelectorAll('.team-zone-member[data-zone-member-id]').forEach(m => {
            const list = [...m.parentElement.querySelectorAll(':scope > .team-zone-member')];
            members.set(m.dataset.zoneMemberId, { zone: Number(m.dataset.zoneIdx), index: list.indexOf(m), name: nameIn(m) });
        });
        const chip = screen.querySelector('.team-chip.selected');
        return { members, chip: chip?.dataset.chipId || null, chipName: chip?.textContent.trim() || '' };
    };
    let pending = null;
    screen.addEventListener('pointerdown', event => {
        if (!event.isTrusted) return;
        lastRealPress = performance.now();
        if (!isNext()) return;
        const grip = event.target.closest?.('.hn-grip');
        if (grip) {
            const id = grip.closest('.team-zone-member')?.dataset.zoneMemberId;
            pending = { before: snapshot(), key: id ? ['grip', id] : null };
            return;
        }
        const control = event.target.closest?.('[data-member-action], .team-chip[data-chip-id], .team-zone-label, .team-zone');
        if (!control || control.matches('[data-member-action="hn-remove"]')) { pending = null; return; }
        const before = snapshot();
        // A tap on a team (or its Put button) with a player chosen places
        // that player; focus then goes where the keyboard path sends it.
        const key = control.dataset.memberAction ? ['member', control.dataset.memberId, control.dataset.memberAction]
            : control.dataset.chipId ? ['chip', control.dataset.chipId]
            : before.chip && control.closest('.team-zone') ? ['place', before.chip] : null;
        pending = { before, key };
    }, true);
    // ⇄ ▲ ▼ act when a tap ends, not when a finger lands, so a swipe that
    // starts on one of them scrolls the page and moves nobody.
    let tap = null;
    screen.addEventListener('pointerdown', event => {
        if (!event.isTrusted || !isNext()) { tap = null; return; }
        const action = event.target.closest?.('[data-member-action]');
        if (!action || action.dataset.memberAction === 'hn-remove') { tap = null; return; }
        event.preventDefault();
        event.stopPropagation();
        pending = null;
        tap = action.disabled ? null : { id: action.dataset.memberId, act: action.dataset.memberAction, x: event.clientX, y: event.clientY, pointer: event.pointerId };
    }, true);
    document.addEventListener('pointermove', event => {
        if (tap && event.pointerId === tap.pointer && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 10) tap = null;
    }, true);
    document.addEventListener('pointercancel', () => { tap = null; }, true);
    window.addEventListener('scroll', () => { tap = null; }, true);
    const tapped = action => {
        const hit = tap && action && action.dataset.memberId === tap.id && action.dataset.memberAction === tap.act;
        tap = null;
        return hit && !action.disabled;
    };
    // A key press is the user's own, so it ends that window.
    screen.addEventListener('keydown', event => {
        if (event.isTrusted && (event.key === 'Enter' || event.key === ' ')) lastRealPress = 0;
    }, true);
    document.addEventListener('pointerup', event => {
        if (!event.isTrusted || !pending) return;
        const { before, key } = pending;
        pending = null;
        later(() => {
            const after = snapshot();
            let text = '';
            for (const [id, now] of after.members) {
                const was = before.members.get(id);
                if (!was) text = `${now.name} added to ${zoneName(now.zone)}`;
                else if (was.zone !== now.zone) text = `${now.name} moved to ${zoneName(now.zone)}`;
                else if (key?.[0] === 'member' && key[1] === id && was.index !== now.index) text = `${now.name} moved ${now.index < was.index ? 'up' : 'down'}`;
                else if (key?.[0] === 'grip' && key[1] === id && was.index !== now.index) text = `${now.name} moved ${now.index < was.index ? 'up' : 'down'}, now ${ordinal(now.index + 1)}`;
            }
            for (const [id, was] of before.members) if (!after.members.has(id)) text = `${was.name} is back in Available Players`;
            if (!text && after.chip && after.chip !== before.chip) text = `${after.chipName} chosen. Now pick Home or Away.`;
            // Tapping the chosen chip again lets it go, and says so, as Enter or Escape does.
            if (!text && before.chip && !after.chip && before.chipName) text = `${before.chipName} not chosen`;
            if (text) say(text);
            const active = document.activeElement;
            if (key && (!active || active === document.body || !document.contains(active))) {
                if (key[0] === 'place') focusChip('#teamTray .team-chip', '#teamStartMatchBtn:not(:disabled)', `.team-zone-member[data-zone-member-id="${CSS.escape(key[1])}"] [data-member-action="swap"]`);
                else if (key[0] === 'member') focusFirst(`[data-member-id="${CSS.escape(key[1])}"][data-member-action="${key[2]}"]`, `[data-member-id="${CSS.escape(key[1])}"][data-member-action="swap"]`);
                else focusChip(`.team-chip[data-chip-id="${CSS.escape(key[1])}"]`, '#teamTray .team-chip', '#teamStartMatchBtn:not(:disabled)', `.team-zone-member[data-zone-member-id="${CSS.escape(key[1])}"] [data-member-action="swap"]`);
            }
        });
    }, true);
    const recentlyPressed = () => performance.now() - lastRealPress < 600;
    let removedAt = -Infinity;
    screen.addEventListener('click', event => {
        if (!isNext()) return;
        const action = event.target.closest('[data-member-action]');
        if (action?.dataset.memberAction === 'hn-remove') {
            // The rows move up after a removal, so a quick second tap would
            // land on the next player's ✕. Pointer presses that soon are ignored.
            if (event.detail !== 0 && performance.now() - removedAt < 450) return;
            if (event.detail !== 0) removedAt = performance.now();
            const id = action.dataset.memberId;
            const name = nameIn(memberNode(id));
            const zone = zoneOf(id);
            dragToTray(memberNode(id));
            if (!memberNode(id)) say(`${name} is back in Available Players`);
            // Focus goes to the player's chip back in Available Players (or a
            // teammate's ⇄), never straight onto another ✕ a repeated press would hit.
            focusFirst(`.team-chip[data-chip-id="${CSS.escape(id)}"]`, `#teamZone${zone} [data-member-action="swap"]`, '#teamTray .team-chip', '#teamAddName', `#teamZone${zone} [data-member-action="hn-remove"]`);
            return;
        }
        const isTap = tapped(action);
        // A keyboard press reaches a button as a click with no pointer behind it.
        if (event.detail !== 0 && !isTap) return;
        const chip = event.target.closest('.team-chip[data-chip-id]');
        if (action && !action.disabled && (isTap || !recentlyPressed(action))) {
            const { memberId, memberAction } = action.dataset;
            const id = CSS.escape(memberId);
            const name = nameIn(memberNode(memberId));
            const before = zoneOf(memberId);
            press(action);
            const after = zoneOf(memberId);
            if (memberAction === 'swap') say(after !== before && after != null ? `${name} moved to ${zoneName(after)}` : `${name} can't move, that team is full`);
            else say(`${name} moved ${memberAction}`);
            const other = memberAction === 'up' ? 'down' : 'up';
            focusFirst(`[data-member-id="${id}"][data-member-action="${memberAction}"]`, `[data-member-id="${id}"][data-member-action="${other}"]`, `[data-member-id="${id}"][data-member-action="swap"]`);
        } else if (chip && !recentlyPressed(chip)) {
            const id = chip.dataset.chipId;
            const name = chip.textContent.trim();
            press(chip);
            const chosen = screen.querySelector(`.team-chip.selected[data-chip-id="${CSS.escape(id)}"]`);
            say(chosen ? `${name} chosen. Now pick Home or Away.` : `${name} not chosen`);
            // Chosen: the next press is "Put … in Home", so focus goes there.
            if (chosen) focusFirst('#teamZone0 > .hn-zone-put', '#teamZone1 > .hn-zone-put', `.team-chip[data-chip-id="${CSS.escape(id)}"]`);
            else focusChip(`.team-chip[data-chip-id="${CSS.escape(id)}"]`);
        }
    });
    // Escape lets go of a chosen player.
    screen.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || !isNext()) return;
        const chip = screen.querySelector('.team-chip.selected[data-chip-id]');
        if (!chip) return;
        event.preventDefault();
        const id = chip.dataset.chipId;
        const name = chip.textContent.trim();
        letGo = id;
        press(chip);
        if (!screen.querySelector('.team-chip.selected')) say(`${name} not chosen`);
        // The chip may have scrolled out of view while Home and Away were in use.
        focusFirst(`.team-chip[data-chip-id="${CSS.escape(id)}"]`);
        later(() => later(() => { letGo = null; }));
    });
    // Round 26: with a player chosen, a tap on a member row's name or tint
    // (not its buttons) counts as a tap on that team, as the rest of the
    // team box does.
    screen.addEventListener('click', event => {
        if (!isNext() || event.detail === 0) return;
        const row = event.target.closest?.('.team-zone-member');
        if (!row || event.target.closest('button, [data-member-action], .hn-grip, select, input, label, a')) return;
        if (!screen.querySelector('.team-chip.selected')) return;
        const zone = row.closest('.team-zone');
        const label = zone && byId(`${zone.id}Label`);
        if (label) press(label);
    });
    // "Put … in Home": a real tap already reached the team itself; a key
    // press arrives as a click with no pointer behind it.
    screen.addEventListener('click', event => {
        const put = event.target.closest?.('.hn-zone-put');
        if (!put || !isNext() || event.detail !== 0) return;
        const idx = Number(put.dataset.zone);
        const chip = screen.querySelector('.team-chip.selected');
        const id = chip?.dataset.chipId;
        const name = chip?.textContent.trim();
        const zoneLabel = byId(`teamZone${idx}Label`);
        if (zoneLabel) press(zoneLabel);
        const placed = id && memberNode(id);
        if (placed) { justPlaced = id; say(`${name} added to ${zoneName(idx)}`); }
        else if (id) say(`${zoneName(idx)} is full`);
        const own = placed && `[data-member-id="${CSS.escape(id)}"][data-member-action="swap"]`;
        focusFirst('#teamTray .team-chip', '#teamStartMatchBtn:not(:disabled)', own, '#teamAddName');
    });
    // New players and bots are read out as they join Available Players.
    const trayNames = () => [...screen.querySelectorAll('#teamTray .team-chip[data-chip-id]')].map(c => c.textContent.trim());
    const watchAdd = () => {
        if (!isNext()) return;
        const before = trayNames();
        later(() => {
            const added = trayNames().filter((n, i, all) => all.filter(x => x === n).length > before.filter(x => x === n).length && all.indexOf(n) === i);
            if (added.length) say(`${added.join(', ')} added to Available Players`);
        });
    };
    byId('teamAddName')?.addEventListener('keydown', event => { if (event.key === 'Enter') watchAdd(); }, true);
    ['teamAddBtn', 'teamAddBotBtn'].forEach(id => byId(id)?.addEventListener('click', watchAdd, true));
    // Opening the builder puts focus on its heading; going back returns it to Start.
    const heading = screen.querySelector('h1');
    let wasOpen = getComputedStyle(screen).display !== 'none';
    new MutationObserver(() => {
        const open = screen.style.display !== 'none' && getComputedStyle(screen).display !== 'none';
        if (open === wasOpen) return;
        wasOpen = open;
        if (!isNext()) return;
        if (open && heading) {
            heading.tabIndex = -1;
            // Not if someone has already started in a field of the builder.
            later(() => { const a = document.activeElement; if (!a || a === document.body || !screen.contains(a) || !a.getClientRects().length) heading.focus(); });
        }
        else if (!open) {
            heading?.removeAttribute('tabindex');
            later(() => {
                const setup = byId('setupScreen');
                const active = document.activeElement;
                const lost = !active || active === document.body || screen.contains(active) || active.offsetParent === null;
                if (setup && setup.style.display !== 'none' && lost) byId('startGameBtn')?.focus();
            });
        }
    }).observe(screen, { attributes: true, attributeFilter: ['style'] });
    new MutationObserver(label).observe(screen, { childList: true, subtree: true });
    document.addEventListener('homelayoutchange', label);
    document.addEventListener('homelayoutchange', () => { if (!isNext()) heading?.removeAttribute('tabindex'); });
    label();
}

// --- Customize as a proper dialog on the home screen -----------------------
// Only in the New look and only when opened from the home screen; in a game
// it behaves exactly as before.

function mountCustomizeDialog() {
    const modal = byId('settingsModal');
    const opener = byId('settingsBtnSetup');
    if (!modal) return;
    const content = modal.querySelector('.modal-content');
    const title = content?.querySelector('h2');
    // The title gets its id only while it names the dialog.
    const ownId = title && !title.id;
    const nameOpener = () => {
        if (!opener) return;
        if (isNext()) opener.setAttribute('aria-label', 'Customize');
        else opener.setAttribute('aria-label', 'Settings');
    };
    let active = false;
    let returnTo = null;
    const focusables = () => [...content.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter(el => !el.disabled && el.offsetParent !== null);
    const setupShowing = () => byId('setupScreen')?.style.display !== 'none';
    const scale = byId('uiScale');
    const upload = modal.querySelector('.wallpaper-upload-btn');
    const uploadInput = byId('wallpaperUpload');
    let titleText = '';
    // The file input is hidden, so its button label takes keyboard presses.
    upload?.addEventListener('keydown', event => {
        if (!active || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        uploadInput?.click();
    });
    // Done goes last, after Menu Style, on screen and in the Tab order, in
    // every menu style. Menu Style keeps itself the dialog's last child, so
    // Done goes at the end of its section. Outside the New look dialog, Done
    // stays where the original puts it: just before Menu Style.
    const placeDone = () => {
        const done = byId('settingsCloseBtn');
        const menu = content?.querySelector(':scope > .menu-style-picker');
        if (!done || !menu) return;
        const last = active;
        // In the dialog, Menu Style's own label, field and note sit together in
        // a card of their own (as every other setting does in the Fable 5.2 and
        // Astra 6.2 styles), with Done after it rather than inside it.
        let card = menu.querySelector(':scope > .hn-menu-card');
        if (last && !card) {
            card = document.createElement('div');
            card.className = 'hn-menu-card';
            card.append(...[...menu.children].filter(el => el !== done));
            menu.prepend(card);
        } else if (!last && card) {
            card.replaceWith(...card.childNodes);
        }
        if (last && menu.lastElementChild !== done) menu.append(done);
        else if (!last && done.nextElementSibling !== menu) menu.before(done);
    };
    new MutationObserver(placeDone).observe(document.documentElement, { attributes: true, attributeFilter: ['data-menu-style'] });
    // Theme and wallpaper buttons say which one is chosen.
    const syncPressed = () => {
        content?.querySelectorAll('.theme-swatch, .wallpaper-choice').forEach(button => {
            if (active) {
                const on = button.classList.contains('active') ? 'true' : 'false';
                if (button.getAttribute('aria-pressed') !== on) button.setAttribute('aria-pressed', on);
            } else if (button.hasAttribute('aria-pressed')) {
                button.removeAttribute('aria-pressed');
            }
        });
    };
    ['themePicker', 'wallpaperChoices'].map(byId).filter(Boolean).forEach(el =>
        new MutationObserver(syncPressed).observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] }));
    // A close button that stays at the top of the dialog as it scrolls.
    let closeX = null;
    const addClose = () => {
        if (closeX || !content) return;
        closeX = document.createElement('button');
        closeX.type = 'button';
        closeX.className = 'hn-dialog-close';
        closeX.setAttribute('aria-label', 'Close Customize');
        closeX.textContent = '✕';
        closeX.addEventListener('click', () => byId('settingsCloseBtn')?.click());
        // It sits in a strip across the top that turns solid once the dialog
        // scrolls, so nothing scrolls into view underneath it.
        closeBar = document.createElement('div');
        closeBar.className = 'hn-dialog-bar';
        // Once the real title scrolls away, the strip shows its own small title.
        const barTitle = document.createElement('span');
        barTitle.className = 'hn-dialog-bar-title';
        barTitle.setAttribute('aria-hidden', 'true');
        barTitle.textContent = 'Customize';
        closeBar.append(barTitle, closeX);
        content.prepend(closeBar);
        measureBar();
        requestAnimationFrame(measureBar);
        syncBar();
    };
    // It spans the dialog edge to edge, whatever padding the menu style gives
    // it, in the dialog's own colour. Measured again whenever the theme or
    // menu style changes while the dialog is open.
    const measureBar = () => {
        if (!closeBar || !content) return;
        const pad = getComputedStyle(content);
        // A see-through dialog colour is made solid for the strip.
        const rgb = pad.backgroundColor.match(/[\d.]+/g);
        if (rgb && rgb.length >= 3) closeBar.style.setProperty('--hn-bar-bg', `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`);
        closeBar.style.setProperty('--hn-bar-pad', pad.paddingLeft);
        // The ✕ lines up with the title; the strip ends just below it.
        Object.assign(closeBar.style, {
            top: `-${pad.paddingTop}`, marginTop: `-${pad.paddingTop}`, marginLeft: `-${pad.paddingLeft}`, marginRight: `-${pad.paddingRight}`,
            paddingTop: pad.paddingTop, height: `calc(${pad.paddingTop} + 54px)`, marginBottom: `calc(-54px)`,
        });
        alignClose();
    };
    // Each menu style sets its title in its own size and spacing, so the ✕ is
    // nudged to sit level with the middle of the title's text (until the
    // dialog scrolls and the ✕ pins to the top).
    const alignClose = () => {
        if (!closeX || !title || !closeBar || closeBar.classList.contains('hn-stuck')) return;
        const range = document.createRange();
        range.selectNodeContents(title);
        const line = [...range.getClientRects()].find(r => r.height > 0);
        if (!line) return;
        const now = parseFloat(closeX.style.getPropertyValue('--hn-close-dy')) || 0;
        const box = closeX.getBoundingClientRect();
        const dy = Math.round((line.top + line.bottom) / 2 - ((box.top + box.bottom) / 2 - now));
        closeX.style.setProperty('--hn-close-dy', `${Math.max(-24, Math.min(24, dy))}px`);
    };
    addEventListener('resize', () => { if (active) measureBar(); });
    document.fonts?.ready?.then(() => { if (active) measureBar(); });
    new MutationObserver(() => {
        if (!closeBar) return;
        requestAnimationFrame(measureBar);
        // Themes fade their colours in; measure again once that is done.
        setTimeout(measureBar, 450);
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-menu-style'] });
    let closeBar = null;
    const syncBar = () => {
        if (!closeBar) return;
        const stuck = content.scrollTop > 4;
        if (stuck && !closeBar.classList.contains('hn-stuck')) measureBar();
        closeBar.classList.toggle('hn-stuck', stuck);
    };
    content?.addEventListener('scroll', syncBar, { passive: true });
    // A tap on the dimmed backdrop closes it too (New look only).
    // Only a press that starts and ends on the backdrop closes it, so a text
    // selection that overshoots the dialog's edge leaves it open.
    let downOnBackdrop = false;
    const inerted = [];
    // While the dialog is still opening, ui.js lets early taps fall through
    // to the backdrop so they do nothing: those never close it, and neither
    // does a press inside the dialog's box.
    const onBackdrop = event => {
        if (!active || event.target !== modal || !content) return false;
        if (content.style.pointerEvents === 'none') return false;
        const r = content.getBoundingClientRect();
        return !(event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom);
    };
    modal.addEventListener('pointerdown', event => { downOnBackdrop = onBackdrop(event); });
    modal.addEventListener('click', event => {
        const close = downOnBackdrop && onBackdrop(event);
        downOnBackdrop = false;
        if (close) byId('settingsCloseBtn')?.click();
    });
    const activate = (keepFocus = false) => {
        active = true;
        addClose();
        syncPressed();
        if (!keepFocus) returnTo = document.activeElement;
        content.setAttribute('role', 'dialog');
        content.setAttribute('aria-modal', 'true');
        content.classList.add('hn-dialog');
        // The page behind is out of reach for screen readers too.
        [...document.body.children].forEach(el => {
            if (el === modal || el.contains(modal) || el.inert || /^(SCRIPT|STYLE|TEMPLATE)$/.test(el.tagName)) return;
            el.inert = true;
            inerted.push(el);
        });
        if (title) {
            titleText = title.textContent;
            title.textContent = 'Customize';
            if (ownId) title.id = 'settingsModalTitle';
            content.setAttribute('aria-labelledby', title.id);
            title.tabIndex = -1;
        }
        scale?.setAttribute('aria-label', 'UI scale');
        if (upload) { upload.tabIndex = 0; upload.setAttribute('role', 'button'); }
        // Done goes last, after Menu Style, on screen and in the Tab order.
        placeDone();
        if (!keepFocus) later(() => (title || focusables()[0])?.focus());
        requestAnimationFrame(measureBar);
    };
    const deactivate = () => {
        active = false;
        closeBar?.remove();
        closeBar = null;
        closeX = null;
        syncPressed();
        content.removeAttribute('role');
        content.removeAttribute('aria-modal');
        content.removeAttribute('aria-labelledby');
        content.classList.remove('hn-dialog');
        inerted.splice(0).forEach(el => { el.inert = false; });
        if (title) { if (titleText) title.textContent = titleText; title.removeAttribute('tabindex'); if (ownId) title.removeAttribute('id'); }
        scale?.removeAttribute('aria-label');
        if (upload) { upload.removeAttribute('tabindex'); upload.removeAttribute('role'); }
        placeDone();
    };
    new MutationObserver(() => {
        const open = modal.style.display !== 'none';
        if (open && !active && isNext() && setupShowing() && content) {
            activate();
        } else if (!open && active) {
            deactivate();
            const back = returnTo && document.contains(returnTo) && returnTo.offsetParent !== null ? returnTo : opener;
            later(() => back?.focus());
        }
    }).observe(modal, { attributes: true, attributeFilter: ['style'] });
    // Switching to Classic inside the open dialog hands it back to the original
    // behaviour; switching back to the New look makes it a dialog again.
    document.addEventListener('homelayoutchange', () => {
        const open = modal.style.display !== 'none' && getComputedStyle(modal).display !== 'none';
        if (active && !isNext()) deactivate();
        else if (!active && isNext() && open && setupShowing() && content) activate(true);
    });
    modal.addEventListener('keydown', event => {
        if (!active) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            byId('settingsCloseBtn')?.click();
        } else if (event.key === 'Tab') {
            const list = focusables();
            if (!list.length) return;
            const first = list[0];
            const last = list[list.length - 1];
            // The title opens the dialog; the close button is the next stop after it.
            if (!event.shiftKey && closeX && document.activeElement === title) { event.preventDefault(); closeX.focus(); }
            else if (event.shiftKey && (document.activeElement === first || document.activeElement === title)) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
    });
    document.addEventListener('homelayoutchange', nameOpener);
    nameOpener();
}

// --- Clearer names for a few form fields -----------------------------------

function mountFieldNames() {
    const sync = () => {
        const next = isNext();
        const finishLabel = document.querySelector('#finishTypeOptions > label');
        if (finishLabel) {
            if (next) finishLabel.htmlFor = 'finishType';
            else finishLabel.removeAttribute('for');
        }
        [1, 2, 3, 4].forEach(n => {
            const select = byId(`player${n}Skill`);
            const order = document.querySelector(`label[for="player${n}"][data-player-order-label]`);
            if (!select) return;
            if (next && order) select.setAttribute('aria-label', `Skill level, ${order.textContent.trim().toLowerCase()}`);
            else select.removeAttribute('aria-label');
        });
    };
    document.addEventListener('homelayoutchange', sync);
    sync();
}

// --- A way out of an empty search ------------------------------------------

function mountClearSearch() {
    const grid = byId('gameTypeGrid');
    const search = byId('gameSearchInput');
    if (!grid || !search) return;
    const add = () => {
        const empty = grid.querySelector('.picker-empty');
        if (!empty || !isNext() || empty.querySelector('.hn-clear-search')) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'hn-clear-search';
        button.textContent = 'Clear search';
        button.addEventListener('click', () => {
            search.value = '';
            search.dispatchEvent(new Event('input', { bubbles: true }));
            search.focus();
        });
        empty.append(button);
    };
    new MutationObserver(add).observe(grid, { childList: true });
    add();
    // A full-size clear button inside the search field.
    const toolbar = search.parentElement;
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'hn-search-clear';
    clear.setAttribute('aria-label', 'Clear search');
    clear.textContent = '✕';
    clear.hidden = true;
    clear.addEventListener('click', () => {
        search.value = '';
        search.dispatchEvent(new Event('input', { bubbles: true }));
        search.focus();
    });
    toolbar.append(clear);
    const sync = () => { clear.hidden = !isNext() || !search.value; };
    search.addEventListener('input', sync);
    document.addEventListener('homelayoutchange', sync);
}

// --- Game type chips say which one is on, and keep focus when redrawn ------

function mountChipA11y() {
    const bar = byId('gameCategoryChips');
    if (!bar) return;
    let focused = null;
    const sync = () => {
        const next = isNext();
        if (next) { bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'Game type'); }
        else { bar.removeAttribute('role'); bar.removeAttribute('aria-label'); }
        bar.querySelectorAll('[data-category]').forEach(chip => {
            if (next) chip.setAttribute('aria-pressed', chip.classList.contains('active') ? 'true' : 'false');
            else chip.removeAttribute('aria-pressed');
        });
        if (next && focused) {
            const active = document.activeElement;
            if (!active || active === document.body || !document.contains(active)) {
                [...bar.querySelectorAll('[data-category]')].find(c => c.dataset.category === focused)?.focus({ preventScroll: true });
            }
        }
    };
    bar.addEventListener('focusin', event => { focused = event.target.closest('[data-category]')?.dataset.category || null; });
    document.addEventListener('focusin', event => { if (!bar.contains(event.target)) focused = null; });
    new MutationObserver(sync).observe(bar, { childList: true });
    document.addEventListener('homelayoutchange', sync);
    sync();
}

// --- A skip link past the game list ----------------------------------------

function mountSkipLink() {
    const grid = byId('gameTypeGrid');
    if (!grid || byId('homeNextSkipGames')) return;
    const link = document.createElement('a');
    link.id = 'homeNextSkipGames';
    link.className = 'hn-skip-link';
    link.href = '#gameOptionsSection';
    link.textContent = 'Skip to game options';
    link.addEventListener('click', event => {
        event.preventDefault();
        const target = [byId('gameOptionsSection'), byId('playersSection')]
            .map(section => section && !section.classList.contains('hidden') && section.offsetParent !== null
                ? [...section.querySelectorAll('input, select, button, [tabindex]:not([tabindex="-1"])')]
                    .find(el => !el.disabled && el.offsetParent !== null && el.tabIndex >= 0)
                : null)
            .find(Boolean);
        target?.focus();
    });
    grid.before(link);
    // When a game has no options the section is hidden, so the link names
    // and points at the players instead.
    const options = byId('gameOptionsSection');
    const label = () => {
        const shown = options && !options.classList.contains('hidden') && options.style.display !== 'none' && options.offsetParent !== null;
        const text = shown ? 'Skip to game options' : 'Skip to players';
        if (link.textContent !== text) link.textContent = text;
        link.href = shown ? '#gameOptionsSection' : '#playersSection';
    };
    label();
    if (options) new MutationObserver(label).observe(options, { attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
    link.addEventListener('focus', label);
    document.addEventListener('homelayoutchange', label);
    byId('gameTypeGrid')?.addEventListener('click', () => later(label));
}

// --- While typing on a phone, the Start bar steps aside --------------------
// With the on-screen keyboard up there is little room left; the docked bar
// would cover the search results or the field being typed in.

// --- Search results read out -----------------------------------------------
// After a short pause in typing, the New look says how many games match, so
// a screen reader hears the result of the search and not every keystroke.

function mountSearchStatus() {
    const grid = byId('gameTypeGrid');
    const search = byId('gameSearchInput');
    if (!grid || !search) return;
    const live = document.createElement('div');
    live.id = 'homeNextSearchLive';
    live.className = 'hn-visually-hidden';
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('role', 'status');
    document.body.append(live);
    let timer = 0;
    search.addEventListener('input', () => {
        clearTimeout(timer);
        if (!isNext()) return;
        timer = setTimeout(() => {
            if (!isNext()) return;
            const count = grid.querySelectorAll('.game-card').length;
            const text = !search.value.trim() ? ''
                : count ? `${count} ${count === 1 ? 'game' : 'games'}` : 'No games match';
            live.textContent = text;
        }, 700);
    });
    // A type chip changes the list too, so it says how many games it shows.
    byId('gameCategoryChips')?.addEventListener('click', event => {
        const chip = event.target.closest?.('[data-category]');
        if (!chip || !isNext()) return;
        clearTimeout(timer);
        later(() => {
            if (!isNext()) return;
            const count = grid.querySelectorAll('.game-card').length;
            const name = chip.textContent.trim();
            live.textContent = count ? `${name}, ${count} ${count === 1 ? 'game' : 'games'}` : `${name}, no games`;
        });
    });
}

function mountTypingBar() {
    const setup = byId('setupScreen');
    if (!setup) return;
    let tallest = window.visualViewport?.height || window.innerHeight;
    const isField = el => el?.matches?.('input[type="text"], input[type="search"], input:not([type]), textarea') && setup.contains(el);
    const update = () => {
        const vh = window.visualViewport?.height || window.innerHeight;
        const typing = isField(document.activeElement);
        if (!typing) tallest = Math.max(vh, window.innerHeight);
        const touch = window.matchMedia?.('(pointer: coarse)').matches;
        const small = window.innerWidth <= 720 || touch || vh <= 500;
        const squeezed = typing && small && vh < tallest - 120;
        if (squeezed && isNext()) document.documentElement.dataset.hnTyping = '1';
        else delete document.documentElement.dataset.hnTyping;
    };
    document.addEventListener('focusin', () => later(update));
    document.addEventListener('focusout', () => later(update));
    window.visualViewport?.addEventListener('resize', update);
    window.addEventListener('resize', update);
    update();
}

// --- "Jump back in": Quick Start first --------------------------------------
// The New look draws Quick Start before the recent games, so it comes first
// for Tab and screen readers too. Classic keeps it last, as the original.

function mountQuickStartFirst() {
    const row = byId('gameRecentsRow');
    if (!row) return;
    // When the row has to wrap, Quick Start takes a line of its own and
    // "Recent:" starts the next one with its games, so the label never ends
    // a line alone.
    // On phones and short landscape screens the row keeps to one line: the
    // oldest recent games give way first (they are all in the list below),
    // keeping at least the latest one.
    const compact = window.matchMedia('(max-width: 480px), (max-height: 480px)');
    const fit = () => {
        // A redraw (after a tap) keeps the row where it was scrolled.
        const keep = row.scrollLeft;
        const quick = row.querySelector(':scope > [data-quickstart]');
        const chips = [...row.querySelectorAll(':scope > .picker-recent-chip:not([data-quickstart])')];
        row.removeAttribute('data-hn-stack');
        row.removeAttribute('data-hn-quiet');
        row.removeAttribute('data-hn-squeeze');
        row.removeAttribute('data-hn-alone');
        row.removeAttribute('data-hn-scroll');
        row.removeAttribute('data-hn-more');
        row.removeAttribute('data-hn-less');
        row.style.removeProperty('--hn-fade');
        if (row.getAttribute('style') === '') row.removeAttribute('style');
        chips.forEach(chip => chip.removeAttribute('data-hn-overflow'));
        edge();
        if (!isNext() || !quick || !row.clientWidth) return;
        // Round 24: phones and short landscape screens keep every recent
        // game on one line that scrolls sideways, with a fade at the edge
        // while more is off to the right.
        if (compact.matches) {
            row.setAttribute('data-hn-scroll', '');
            // Measured from the start; the kept position comes back below.
            row.scrollLeft = 0;
            edge();
            // Games are read only up to where the fade starts.
            const line = () => row.getBoundingClientRect().right - (row.scrollWidth > row.clientWidth + 2 ? FADE : 0);
            const label = row.querySelector(':scope > .picker-recents-label');
            if (label?.getClientRects().length && label.getBoundingClientRect().right > line()) row.setAttribute('data-hn-quiet', '');
            // Too narrow to show the latest game whole (or most of a long
            // one): the "Recent" label goes first, then Quick Start stays alone.
            const shows = () => { const first = chips[0]; if (!first) return true; const r = first.getBoundingClientRect(); return line() - r.left >= r.width - 2; };
            if (!shows()) row.setAttribute('data-hn-quiet', '');
            if (!shows()) {
                chips.forEach(chip => chip.setAttribute('data-hn-overflow', ''));
                row.setAttribute('data-hn-alone', '');
                row.removeAttribute('data-hn-scroll');
            }
            if (row.hasAttribute('data-hn-scroll')) {
                row.scrollLeft = keep;
                // The focused game stays whole and clear of the fades.
                keepClear(row.contains(document.activeElement) ? document.activeElement.closest('.picker-recent-chip') : null);
            }
            edge();
            return;
        }
        const lastShown = () => [...row.children].filter(child => child.getClientRects().length).pop();
        const wraps = () => { const last = lastShown(); return !!last && last !== quick && last.offsetTop > quick.offsetTop + 4; };
        // Any width: the oldest recent games give way before the row wraps.
        for (let i = chips.length - 1; i > 0 && wraps(); i--) chips[i].setAttribute('data-hn-overflow', '');
        // Small screens, or a narrow column on a tablet.
        if (compact.matches || row.clientWidth < 480) {
            // Still too wide: the "Recent" label is kept for screen readers only.
            if (wraps()) row.setAttribute('data-hn-quiet', '');
            // Still too wide: the one game left shortens with an ellipsis.
            if (wraps()) row.setAttribute('data-hn-squeeze', '');
            // A game cut to its icon and a "…" says nothing: Quick Start stays alone.
            const last = chips.find(chip => !chip.hasAttribute('data-hn-overflow'));
            if (row.hasAttribute('data-hn-squeeze') && last && last.clientWidth < parseFloat(getComputedStyle(last).fontSize) * 5.5) {
                last.setAttribute('data-hn-overflow', '');
                row.setAttribute('data-hn-alone', '');
            }
            if (wraps()) { row.removeAttribute('data-hn-squeeze'); row.removeAttribute('data-hn-quiet'); }
        }
        if (wraps()) row.setAttribute('data-hn-stack', '');
    };
    // While games are off to the right, a quiet "+N ›" sits past the fade
    // (it takes no taps; a swipe or Tab scrolls the row), so the row never
    // looks complete when it isn't. Screen readers get every game already.
    // The panel's border and tint are drawn by a box behind the row, so
    // the fade touches the games and never the panel's own edge.
    // The fade is as wide as the "+N ›" it holds (it grows with the text
    // size), and never under 48px.
    let FADE = 52;
    let cue = null;
    const keepClear = chip => {
        if (!chip || !row.hasAttribute('data-hn-scroll')) return;
        const box = row.getBoundingClientRect();
        const r = chip.getBoundingClientRect();
        if (r.right > box.right - FADE - 4) row.scrollLeft += r.right - (box.right - FADE - 4);
        else if (r.left < box.left + 28) row.scrollLeft -= box.left + 28 - r.left;
    };
    const edge = () => {
        const scrolling = isNext() && row.hasAttribute('data-hn-scroll') && !row.classList.contains('hidden');
        const more = scrolling && row.scrollLeft + row.clientWidth < row.scrollWidth - 2;
        const less = scrolling && row.scrollLeft > 2;
        if (more !== row.hasAttribute('data-hn-more')) row.toggleAttribute('data-hn-more', more);
        if (less !== row.hasAttribute('data-hn-less')) row.toggleAttribute('data-hn-less', less);
        if (!scrolling) { cue?.remove(); cue = null; return; }
        if (!cue) {
            cue = document.createElement('div'); cue.className = 'hn-recents-more'; cue.setAttribute('aria-hidden', 'true');
            cue.append(Object.assign(document.createElement('span'), { className: 'hn-recents-count' }));
        }
        if (row.previousElementSibling !== cue) row.before(cue);
        // Sized for the longest count the row could show.
        const count = row.querySelectorAll(':scope > .picker-recent-chip').length;
        const probe = `+${count} \u203a`;
        if (cue.dataset.probe !== probe) {
            cue.dataset.probe = probe;
            const was = cue.firstChild.textContent;
            cue.firstChild.textContent = probe;
            cue.dataset.w = String(Math.ceil(cue.firstChild.getBoundingClientRect().width));
            cue.firstChild.textContent = was;
        }
        FADE = Math.max(48, Number(cue.dataset.w || 0) + 24);
        if (row.style.getPropertyValue('--hn-fade') !== `${FADE}px`) row.style.setProperty('--hn-fade', `${FADE}px`);
        const box = row.getBoundingClientRect();
        const hidden = more ? [...row.querySelectorAll(':scope > .picker-recent-chip')].filter(chip => chip.getClientRects().length && chip.getBoundingClientRect().right > box.right - FADE + 2).length : 0;
        const text = hidden ? `+${hidden} \u203a` : '';
        if (cue.firstChild.textContent !== text) cue.firstChild.textContent = text;
        // The box sits just before the row and takes no height, so it stays
        // on the row when anything above it moves.
        const at = cue.getBoundingClientRect();
        const place = { '--hn-row-x': `${box.left - at.left}px`, '--hn-row-y': `${box.top - at.top}px`, '--hn-row-w': `${box.width}px`, '--hn-row-h': `${box.height}px` };
        for (const [k, v] of Object.entries(place)) if (cue.style.getPropertyValue(k) !== v) cue.style.setProperty(k, v);
    };
    row.addEventListener('scroll', edge, { passive: true });
    // Round 26: a tap in a fade scrolls the row on (or back) instead of
    // choosing a game you can't see; Tab keeps the focused game clear of them.
    row.addEventListener('click', event => {
        if (!isNext() || event.detail === 0 || !row.hasAttribute('data-hn-scroll')) return;
        const box = row.getBoundingClientRect();
        const step = Math.max(80, row.clientWidth - FADE - 28);
        let by = 0;
        if (row.hasAttribute('data-hn-more') && event.clientX > box.right - FADE) by = step;
        else if (row.hasAttribute('data-hn-less') && event.clientX < box.left + 28) by = -step;
        if (!by) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        row.scrollBy({ left: by, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }, true);
    row.addEventListener('focusin', event => keepClear(event.target.closest?.('.picker-recent-chip')));
    compact.addEventListener?.('change', () => fit());
    const sync = () => {
        const quick = row.querySelector(':scope > [data-quickstart]');
        let gap = row.querySelector(':scope > .hn-recents-break');
        // "Recent" matches the other labels in the New look (no colon).
        const label = row.querySelector(':scope > .picker-recents-label');
        const want = isNext() ? 'Recent' : 'Recent:';
        if (label && /^Recent:?$/.test(label.textContent) && label.textContent !== want) label.textContent = want;
        if (!quick) { gap?.remove(); return; }
        if (isNext()) {
            if (row.firstElementChild !== quick) row.prepend(quick);
            if (!gap) { gap = document.createElement('span'); gap.className = 'hn-recents-break'; gap.setAttribute('aria-hidden', 'true'); }
            if (quick.nextElementSibling !== gap) quick.after(gap);
        } else {
            gap?.remove();
            row.removeAttribute('data-hn-stack');
            if (row.lastElementChild !== quick) row.append(quick);
        }
        fit();
    };
    new MutationObserver(sync).observe(row, { childList: true });
    let width = -1;
    new ResizeObserver(() => { if (row.clientWidth !== width) { width = row.clientWidth; fit(); } else edge(); }).observe(row);
    ['homelayoutchange', 'hntightchange'].forEach(name => document.addEventListener(name, sync));
    document.fonts?.ready?.then(fit);
    sync();
}

// --- Phones: a short game list with "Show all games" -----------------------
// A tall inner list would catch most swipes meant for the page. On phones
// the New look shows the first few games (plus the chosen one) in the page
// itself, and one button opens the rest. A search or a game type shows
// every match.

const FEW_GAMES = 5;
function mountGameExpander() {
    const section = byId('gamePickerSection');
    const grid = byId('gameTypeGrid');
    if (!section || !grid || byId('homeNextAllGames')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'homeNextAllGames';
    button.className = 'hn-all-games';
    button.setAttribute('aria-controls', 'gameTypeGrid');
    grid.after(button);
    let open = false;
    const search = section.querySelector('.picker-search');
    const sync = () => {
        if (!isNext()) { delete section.dataset.hnGames; button.hidden = true; return; }
        const count = grid.querySelectorAll('[data-game-value]').length;
        const chip = byId('gameCategoryChips')?.querySelector('.picker-chip.active');
        const filtered = !!search?.value.trim() || (chip && chip.dataset.category !== 'all');
        const short = count <= FEW_GAMES + 1;
        const state = filtered || short ? 'all' : open ? 'all' : 'few';
        if (section.dataset.hnGames !== state) section.dataset.hnGames = state;
        button.hidden = filtered || short;
        const text = open ? 'Show fewer games' : `Show all ${count} games`;
        if (button.textContent !== text) button.textContent = text;
        button.setAttribute('aria-expanded', open ? 'true' : 'false');
        refit();
    };
    const shownCards = () => [...grid.querySelectorAll('.game-card')].filter(card => card.offsetParent !== null);
    button.addEventListener('click', () => {
        const before = new Set(shownCards());
        // Collapsing keeps the button where it was on screen, so the
        // finger or pointer that pressed it is still on it.
        const y = button.getBoundingClientRect().top;
        open = !open;
        sync();
        if (!open) {
            later(() => {
                const now = button.getBoundingClientRect().top;
                const scroller = document.scrollingElement;
                let el = button.parentElement;
                while (el && el !== document.body && !(el.scrollHeight > el.clientHeight && /(auto|scroll)/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
                (el && el !== document.body ? el : scroller).scrollBy(0, now - y);
            });
            return;
        }
        // Focus goes on to the first game that just appeared, so the next Tab
        // walks through the rest instead of jumping past them.
        const first = shownCards().find(card => !before.has(card));
        // It takes the place of the button that was just pressed, so it is already in view.
        if (first) later(() => first.focus({ preventScroll: true }));
    });
    search?.addEventListener('input', sync);
    new MutationObserver(sync).observe(grid, { childList: true });
    const chips = byId('gameCategoryChips');
    if (chips) new MutationObserver(sync).observe(chips, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    document.addEventListener('homelayoutchange', sync);
    // Shorter laptops keep the library in view, so its short list has to fit
    // the window: games come off the end (a row at a time) until the list and
    // "Show all games" fit whole. If even three won't fit, the library joins
    // the page instead of scrolling inside itself.
    const SHORT_WIDE = matchMedia('(min-width: 721px) and (min-height: 561px) and (max-height: 819px)');
    let fitting = false;
    const fit = () => {
        if (fitting) return;
        fitting = true;
        grid.querySelectorAll(':scope > [data-hn-over]').forEach(wrap => wrap.removeAttribute('data-hn-over'));
        section.removeAttribute('data-hn-flow');
        if (isNext() && SHORT_WIDE.matches && section.dataset.hnGames === 'few') {
            const cols = Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length);
            const spare = () => [...grid.children].filter(wrap => wrap.classList.contains('game-card-wrap') && wrap.offsetParent !== null && !wrap.querySelector('.game-card.active'));
            const over = () => section.scrollHeight > section.clientHeight + 1;
            let list = spare();
            while (over() && list.length > 3) {
                list.splice(-Math.min(cols, list.length - 3)).forEach(wrap => wrap.setAttribute('data-hn-over', ''));
            }
            if (over()) {
                grid.querySelectorAll(':scope > [data-hn-over]').forEach(wrap => wrap.removeAttribute('data-hn-over'));
                section.setAttribute('data-hn-flow', '');
            }
        }
        fitting = false;
    };
    let queued = 0;
    const refit = () => { if (!queued) queued = requestAnimationFrame(() => { queued = 0; fit(); }); };
    addEventListener('resize', refit);
    SHORT_WIDE.addEventListener?.('change', refit);
    document.addEventListener('hntightchange', refit);
    document.fonts?.ready?.then(refit);
    new MutationObserver(refit).observe(grid, { subtree: true, attributes: true, attributeFilter: ['class'] });
    const watch = new ResizeObserver(refit);
    [...section.children].filter(el => el !== grid && el !== button).forEach(el => watch.observe(el));
    sync();
}

// --- Short names for the BotBlake levels when the full one won't fit ------
// "BotBlake — Medium" needs room that a narrow row or large text doesn't
// leave. The closed select then shows "Bot · Medium", "🤖 Medium" or just
// "Medium", whichever is the longest that fits. Decided by measuring, so it follows the text size too.
// The option values never change.

// --- Customize: theme swatches as wide as their longest name --------------
// The swatches sit in an even grid. The grid takes the most columns (6, 4, 3
// or 2, so the 12 themes fill whole rows) whose swatches still hold every
// theme name on one line with room either side, in each menu style and at
// every text size.

// --- Throw order: focus follows the player, each move is read out ----------
// setup.js moves names between the fixed rows. In the New look, after ▲ or ▼
// focus goes to the same button in the player's new row (or the other arrow
// there when that one is off), and every move, tap-to-place and Randomize
// says what changed.

function mountOrderA11y() {
    const list = document.querySelector('#playersSection .player-order-list') || byId('playersSection');
    if (!list) return;
    const live = document.createElement('div');
    live.id = 'homeNextOrderLive';
    live.className = 'hn-visually-hidden';
    live.setAttribute('aria-live', 'polite');
    document.body.append(live);
    const say = text => { live.textContent = ''; later(() => { live.textContent = text; }); };
    const ord = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
    const count = () => Number(byId('numPlayers')?.value) || 0;
    const names = () => [1, 2, 3, 4].map(n => byId(`player${n}`)?.value.trim() || '');
    const nameOf = (list, i) => list[i] || `Player ${i + 1}`;
    let before = null;
    let picked = null;
    const area = byId('playersSection');
    // Throw-order tiles: the spoken name starts with the visible "1st", so
    // voice control can say what it sees, and names the player being moved.
    const relabel = () => {
        if (!area) return;
        const next = isNext();
        const list = names();
        const pickedRow = area.querySelector('.player-row--picked');
        const pickedIndex = pickedRow ? Number(pickedRow.querySelector('[data-player-drag-index]')?.dataset.playerDragIndex) : null;
        area.querySelectorAll('[data-player-drag-index]').forEach(handle => {
            if (!next) {
                if (handle.dataset.hnOrig != null) { handle.setAttribute('aria-label', handle.dataset.hnOrig); delete handle.dataset.hnOrig; delete handle.dataset.hnText; }
                return;
            }
            const current = handle.getAttribute('aria-label') || '';
            // setup.js rewrote it: keep its text for Classic.
            if (current !== handle.dataset.hnText) handle.dataset.hnOrig = current;
            const index = Number(handle.dataset.playerDragIndex);
            const place = ord(index + 1);
            const text = pickedIndex == null || Number.isNaN(pickedIndex) ? `${place}: ${nameOf(list, index)}. Move in throw order`
                : pickedIndex === index ? `${place}: ${nameOf(list, index)}. Cancel moving`
                : `${place}: Move ${nameOf(list, pickedIndex)} to throw ${place}`;
            handle.dataset.hnText = text;
            if (current !== text) handle.setAttribute('aria-label', text);
        });
    };
    if (area) {
        new MutationObserver(relabel).observe(area, { subtree: true, attributes: true, attributeFilter: ['aria-label', 'class'] });
        area.addEventListener('input', relabel);
        document.addEventListener('homelayoutchange', relabel);
        relabel();
    }
    // Escape puts a picked-up player back, and says so.
    // It speaks only once the player really was put back (a dialog or the
    // rules popover may take that Escape for itself).
    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || !isNext() || !area) return;
        const row = area.querySelector('.player-row--picked');
        if (!row) return;
        const index = Number(row.querySelector('[data-player-drag-index]')?.dataset.playerDragIndex);
        const name = nameOf(names(), index);
        later(() => { if (!area.querySelector('.player-row--picked')) say(`${name} put back`); });
    }, true);
    area?.addEventListener('click', event => {
        if (!isNext()) { before = null; return; }
        before = names();
        const row = area.querySelector('.player-row--picked');
        picked = row ? Number(row.querySelector('[data-player-drag-index]')?.dataset.playerDragIndex) : null;
    }, true);
    area?.addEventListener('click', event => {
        if (!isNext() || !before) return;
        const was = before;
        const from = picked;
        before = null;
        const step = event.target.closest?.('[data-player-order-action]');
        const handle = event.target.closest?.('[data-player-drag-index]');
        const shuffle = event.target.closest?.('#randomizePlayersBtn');
        if (step) {
            const index = Number(step.dataset.playerIndex);
            const dir = step.dataset.playerOrderAction;
            const to = index + (dir === 'up' ? -1 : 1);
            if (to < 0 || to >= count()) return;
            say(`${nameOf(was, index)} now throws ${ord(to + 1)}`);
            const other = dir === 'up' ? 'down' : 'up';
            const row = byId(`player${to + 1}Group`);
            const same = row?.querySelector(`[data-player-order-action="${dir}"]`);
            const back = row?.querySelector(`[data-player-order-action="${other}"]`);
            const target = same && !same.disabled ? same : back;
            if (target && !target.disabled) later(() => target.focus({ preventScroll: false }));
        } else if (handle && from != null) {
            const to = Number(handle.dataset.playerDragIndex);
            if (to !== from && names().join('\n') !== was.join('\n')) say(`${nameOf(was, from)} now throws ${ord(to + 1)}`);
            else if (to === from) say(`${nameOf(was, from)} put back`);
            // Focus stays with the player who moved, on their new tile.
            const tile = byId(`player${to + 1}Group`)?.querySelector('[data-player-drag-index]');
            if (tile) later(() => tile.focus({ preventScroll: true }));
        } else if (handle) {
            const row = area.querySelector('.player-row--picked');
            if (row) say(`${nameOf(was, Number(handle.dataset.playerDragIndex))} picked up. Press or tap where they should throw.`);
        } else if (shuffle) {
            const now = names();
            say(`New throw order: ${now.slice(0, count()).map((n, i) => n || `Player ${i + 1}`).join(', ')}`);
        }
    });
}

// --- Change Settings mid-game: focus starts on Back to Game -------------------
// Opening the setup screen from a game's menu would leave focus on the page
// itself; it goes to Back to Game, the way back to the game in progress.

function mountBackFocus() {
    const back = byId('backToGameBtn');
    const screen = byId('setupScreen');
    if (!back || !screen) return;
    let shown = !back.classList.contains('hidden');
    new MutationObserver(() => {
        const now = !back.classList.contains('hidden');
        if (now === shown) return;
        shown = now;
        if (!now || !isNext()) return;
        // Bring it fully into view: below the top of the window and clear
        // of the docked Start bar. Measured again as the large-text header
        // and the compact bar settle, while focus is still on it.
        const clear = () => {
            if (document.activeElement !== back || back.classList.contains('hidden')) return;
            const r = back.getBoundingClientRect();
            const bar = byId('playSection');
            const floating = bar && !bar.contains(back) && /fixed|sticky/.test(getComputedStyle(bar).position);
            const barTop = floating ? bar.getBoundingClientRect().top : innerHeight;
            const bottom = Math.min(innerHeight, barTop) - 8;
            const delta = r.top < 8 ? r.top - 8 : r.bottom > bottom ? Math.min(r.bottom - bottom, r.top - 8) : 0;
            if (!delta) return;
            const scroller = screen.scrollHeight > screen.clientHeight + 1 ? screen : document.scrollingElement;
            scroller.scrollTop += delta;
        };
        later(() => {
            const active = document.activeElement;
            if (!back.getClientRects().length || !(!active || active === document.body || !active.getClientRects().length)) return;
            back.focus({ preventScroll: true });
            // Round 25: the re-checks stop the moment the user scrolls,
            // taps or types, so the page never jumps back on them.
            let stopped = false;
            const EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
            const stop = () => { stopped = true; EVENTS.forEach(name => window.removeEventListener(name, stop, true)); };
            EVENTS.forEach(name => window.addEventListener(name, stop, { capture: true, passive: true }));
            // Any scroll since the last check (a scrollbar drag, a page
            // script) also counts as the user's move.
            const scroller = () => screen.scrollHeight > screen.clientHeight + 1 ? screen : document.scrollingElement;
            let at = 0;
            const check = () => { clear(); at = scroller().scrollTop; };
            const again = () => { if (stopped) return; if (Math.abs(scroller().scrollTop - at) > 2) { stop(); return; } check(); };
            check();
            requestAnimationFrame(() => requestAnimationFrame(again));
            [250, 700].forEach(ms => setTimeout(again, ms));
            setTimeout(() => { again(); stop(); }, 1500);
        });
    }).observe(back, { attributes: true, attributeFilter: ['class'] });
}

// --- UI scale slider says its size -------------------------------------
// In the New look the slider reads "1.2 times" rather than a bare 1.2.

function mountScaleText() {
    const scale = byId('uiScale');
    if (!scale) return;
    // Only in Customize opened from the home screen; mid-game Visual
    // Settings keeps the original slider exactly.
    const set = () => {
        if (isNext() && scale.closest('.hn-dialog')) {
            scale.setAttribute('aria-valuetext', `${Number(scale.value).toFixed(1)} times`);
            if (!scale.hasAttribute('aria-label')) { scale.setAttribute('aria-label', 'UI scale'); scale.dataset.hnLabel = '1'; }
        } else {
            scale.removeAttribute('aria-valuetext');
            if (scale.dataset.hnLabel || scale.getAttribute('aria-label') === 'UI scale') { scale.removeAttribute('aria-label'); delete scale.dataset.hnLabel; }
        }
    };
    const content = scale.closest('.modal-content');
    if (content) new MutationObserver(set).observe(content, { attributes: true, attributeFilter: ['class'] });
    set();
    scale.addEventListener('input', set);
    scale.addEventListener('change', set);
    document.addEventListener('homelayoutchange', set);
    document.querySelectorAll('#settingsBtn, #settingsBtnSetup').forEach(b => b.addEventListener('click', () => later(set)));
}

// --- Header and Start card fit their own width ---------------------------
// On tablets and laptops large text can make the header title run into Login
// and squeeze the one-row Start card until words break. Each one checks its
// own room: the header puts Login and Customize on a second line, and the
// Start card puts the game above a full-width Start. Phones already do both.

function mountFitStack() {
    const header = document.querySelector('#setupScreen .setup-header');
    const play = byId('playSection');
    if (!header && !play) return;
    const shown = el => el && el.offsetParent !== null;
    const check = () => {
        const wide = isNext() && window.innerWidth > 720;
        // Short landscape phones keep the header on one row too, so they check as well.
        const oneRow = wide || (isNext() && !!window.matchMedia?.('(max-height: 500px)').matches);
        const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
        if (header) {
            let wrap = false;
            if (oneRow) {
                const h1 = header.querySelector('h1');
                const logo = header.querySelector('.setup-logo');
                const side = header.querySelector('.setup-header-side');
                const cs = getComputedStyle(header);
                const gap = parseFloat(cs.columnGap) || 0;
                const kids = side ? [...side.children].filter(shown) : [];
                const sideGap = side ? parseFloat(getComputedStyle(side).columnGap) || 0 : 0;
                const sideWidth = kids.reduce((sum, el) => sum + el.offsetWidth, 0) + sideGap * Math.max(0, kids.length - 1);
                const need = (shown(logo) ? logo.offsetWidth + gap : 0) + (h1 ? h1.scrollWidth : 0)
                    + (sideWidth ? sideWidth + gap : 0) + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + 8;
                wrap = need > header.getBoundingClientRect().width;
                header.style.setProperty('--hn-side-indent', `${shown(logo) ? logo.offsetWidth + gap : 0}px`);
            } else if (header.style.getPropertyValue('--hn-side-indent')) {
                // Leaving the New look (or its one-row header) leaves nothing behind.
                header.style.removeProperty('--hn-side-indent');
                if (header.getAttribute('style') === '') header.removeAttribute('style');
            }
            if (wrap !== header.hasAttribute('data-hn-wrap')) header.toggleAttribute('data-hn-wrap', wrap);
        }
        if (play) {
            const stack = wide && play.clientWidth / rem < 24;
            if (stack !== play.hasAttribute('data-hn-stack')) play.toggleAttribute('data-hn-stack', stack);
            // Resume beside Start on a docked card: if either player's name
            // would be cut short, Resume goes above a full-width Start and the
            // names may wrap (as on phones).
            const resume = byId('resumeGameBtn');
            let resumeStack = false;
            if (wide && shown(resume)) {
                play.removeAttribute('data-hn-resume-stack');
                const names = resume.querySelector('.hn-resume-names');
                const cut = el => el.scrollWidth > el.clientWidth + 1;
                resumeStack = !!names && (names.scrollHeight > names.clientHeight + 1
                    || [...names.querySelectorAll('.hn-resume-player')].some(cut));
            }
            if (resumeStack !== play.hasAttribute('data-hn-resume-stack')) play.toggleAttribute('data-hn-resume-stack', resumeStack);
            // Phones and landscape phones at large text: a docked Start bar
            // taller than a fifth of the window drops its summary line (the
            // game name moves into Start), so the page keeps room to work.
            let compact = false;
            const phone = window.innerWidth <= 720 || !!window.matchMedia?.('(max-height: 500px)').matches;
            if (isNext() && phone && play.getClientRects().length && /^(fixed|sticky)$/.test(getComputedStyle(play).position)) {
                play.removeAttribute('data-hn-compact');
                compact = play.offsetHeight > window.innerHeight * 0.2;
            }
            if (compact !== play.hasAttribute('data-hn-compact')) play.toggleAttribute('data-hn-compact', compact);
        }
    };
    let queued = false;
    const soon = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; check(); }); };
    check();
    window.addEventListener('resize', soon, { passive: true });
    ['homelayoutchange', 'hntightchange'].forEach(name => document.addEventListener(name, soon));
    document.fonts?.ready?.then(soon);
    if (window.ResizeObserver) {
        const observer = new ResizeObserver(soon);
        [header, play, header?.querySelector('h1'), header?.querySelector('.setup-header-side')].filter(Boolean).forEach(el => observer.observe(el));
    }
    new MutationObserver(soon).observe(document.documentElement, { attributes: true, attributeFilter: ['data-home', 'data-menu-style', 'style', 'class'] });
    const resume = byId('resumeGameBtn');
    if (resume) new MutationObserver(soon).observe(resume, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true, characterData: true });
}

// --- Team builder: skill names start with a capital ----------------------
// teams.js writes the bot's skill choices in lower case ("medium"); the field
// above them says "Medium". In the New look they match; Classic keeps its own.

function mountTeamSkillNames() {
    const screen = byId('teamBuilderScreen');
    if (!screen) return;
    const sync = () => {
        const next = isNext();
        screen.querySelectorAll('select[data-bot-skill] option').forEach(option => {
            const word = option.value;
            const text = next ? word.charAt(0).toUpperCase() + word.slice(1) : word;
            if (option.textContent !== text) option.textContent = text;
        });
        // Each bot's picker is named for its bot, so two bots on a team differ.
        screen.querySelectorAll('.team-zone-member select[data-bot-skill]').forEach(select => {
            const nameEl = select.closest('.team-zone-member')?.querySelector('.team-zone-member-name');
            const name = nameEl && [...nameEl.childNodes].filter(n => !n.classList?.contains('team-chip-order')).map(n => n.textContent).join('').trim();
            const label = next && name ? `${name} skill level` : null;
            if (label && select.getAttribute('aria-label') !== label) select.setAttribute('aria-label', label);
            else if (!label && select.hasAttribute('aria-label')) select.removeAttribute('aria-label');
        });
    };
    sync();
    new MutationObserver(sync).observe(screen, { childList: true, subtree: true });
    document.addEventListener('homelayoutchange', sync);
}

function mountSwatchFit() {
    const picker = document.querySelector('#settingsModal .theme-picker');
    if (!picker) return;
    const fit = () => {
        // Only in Customize opened from home; mid-game Visual Settings
        // keeps the original grids exactly.
        if (!isNext() || !picker.closest('.hn-dialog')) {
            const walls = byId('wallpaperChoices');
            picker.style.removeProperty('--hn-swatch-cols');
            walls?.style.removeProperty('grid-template-columns');
            // Leave no empty style attribute behind, as the original has none.
            for (const el of [picker, walls]) if (el && el.getAttribute('style') === '') el.removeAttribute('style');
            return;
        }
        const swatches = [...picker.querySelectorAll('.theme-swatch')];
        const width = picker.clientWidth;
        if (!swatches.length || !width) return;
        let need = 0;
        for (const swatch of swatches) {
            const label = swatch.querySelector('.theme-swatch-label');
            if (!label) continue;
            const cs = getComputedStyle(swatch);
            // 6px clear of the edge on each side, inside the border.
            const border = (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0);
            need = Math.max(need, label.getBoundingClientRect().width + border + 12);
        }
        const gap = parseFloat(getComputedStyle(picker).columnGap) || 0;
        const cols = [6, 4, 3, 2, 1].find(c => (width - gap * (c - 1)) / c >= need) || 1;
        if (picker.style.getPropertyValue('--hn-swatch-cols') !== String(cols)) picker.style.setProperty('--hn-swatch-cols', String(cols));
        // The wallpapers fill whole rows too: the most columns (of 88px or
        // more) that divide their number, so no tile is left on its own.
        const walls = byId('wallpaperChoices');
        if (walls) {
            const count = walls.querySelectorAll('.wallpaper-choice').length;
            const wallWidth = walls.clientWidth;
            const wallGap = parseFloat(getComputedStyle(walls).columnGap) || 0;
            const wallCols = count && wallWidth ? [6, 5, 4, 3, 2, 1].find(c => c <= count && count % c === 0 && (wallWidth - wallGap * (c - 1)) / c >= 88) : 0;
            const value = wallCols ? `repeat(${wallCols}, minmax(0, 1fr))` : '';
            if (walls.style.gridTemplateColumns !== value) walls.style.gridTemplateColumns = value;
        }
    };
    let frame = 0;
    const queue = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(fit); };
    let lastWidth = -1;
    new ResizeObserver(() => { if (picker.clientWidth !== lastWidth) { lastWidth = picker.clientWidth; queue(); } }).observe(picker);
    new MutationObserver(queue).observe(document.documentElement, { attributes: true, attributeFilter: ['data-menu-style', 'data-theme', 'style'] });
    new MutationObserver(queue).observe(picker, { childList: true });
    const dialog = picker.closest('.modal-content');
    if (dialog) new MutationObserver(queue).observe(dialog, { attributes: true, attributeFilter: ['class'] });
    const wallGrid = byId('wallpaperChoices');
    if (wallGrid) new MutationObserver(queue).observe(wallGrid, { childList: true });
    document.addEventListener('homelayoutchange', queue);
    document.addEventListener('hntightchange', queue);
    window.addEventListener('resize', queue);
    document.fonts?.ready?.then(queue);
    fit();
}

function mountSkillLabels() {
    const selects = () => [...document.querySelectorAll('#playersSection select[id^="player"][id$="Skill"]')];
    const canvas = document.createElement('canvas');
    const level = value => value === 'auto' ? 'Auto' : value[0].toUpperCase() + value.slice(1);
    const tiers = [
        // Round 17: every level reads "BotBlake — Level" (the original says "BotBlake Auto").
        option => `BotBlake \u2014 ${level(option.value)}`,
        option => `Bot · ${level(option.value)}`,
        option => `Bot ${level(option.value)}`,
        option => level(option.value),
    ];
    // Round 25: the list that opens (full screen on phones) shows the full
    // names; the short ones are only for the closed picker.
    // Round 26: however it opens (a tap, Alt+Down, Space, Enter, F4 or
    // keyboard focus), the list reads "BotBlake — Level" for every level.
    let open = null;
    const SKILL = '#playersSection select[id^="player"][id$="Skill"]';
    const full = select => {
        if (!isNext()) return;
        open = select;
        [...select.options].filter(option => option.value !== 'off').forEach(option => { const text = tiers[0](option); if (option.getAttribute('label') !== text) option.label = text; });
    };
    document.addEventListener('pointerdown', event => { const select = event.target.closest?.(SKILL); if (select) full(select); }, true);
    document.addEventListener('keydown', event => {
        const select = event.target.closest?.(SKILL);
        if (select && (event.key === ' ' || event.key === 'Enter' || event.key === 'F4' || (event.altKey && /^Arrow(Down|Up)$/.test(event.key)))) full(select);
    }, true);
    document.addEventListener('focusin', event => { const select = event.target.closest?.(SKILL); if (select?.matches(':focus-visible')) full(select); });
    const shut = event => { if (open && event.target === open) { open = null; soon(); } };
    document.addEventListener('change', shut, true);
    document.addEventListener('blur', shut, true);
    const sync = () => {
        const next = isNext();
        selects().forEach(select => {
            if (select === open) return;
            const bots = [...select.options].filter(option => option.value !== 'off');
            if (!next || !select.clientWidth) {
                if (!next) bots.forEach(option => option.removeAttribute('label'));
                return;
            }
            const cs = getComputedStyle(select);
            const room = select.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 2;
            const ctx = canvas.getContext('2d');
            ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
            const widest = make => Math.max(...bots.map(option => ctx.measureText(make(option) ?? option.text).width));
            const pick = tiers.find(make => widest(make) <= room) || tiers[tiers.length - 1];
            bots.forEach(option => {
                const text = pick(option);
                if (text == null) option.removeAttribute('label');
                else if (option.getAttribute('label') !== text) option.label = text;
            });
        });
    };
    let queued = false;
    const soon = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; sync(); }); };
    const watch = new ResizeObserver(soon);
    selects().forEach(select => watch.observe(select));
    ['homelayoutchange', 'hntightchange'].forEach(name => document.addEventListener(name, soon));
    window.addEventListener('resize', soon);
    document.fonts?.ready?.then(soon);
    sync();
}

// --- Manage Players: the status line reads without brackets ----------------
// The roster status under "Manage Players" is written in brackets; the New
// look shows it as a plain sub-line. Classic keeps the original text.

function mountRosterStatus() {
    const status = document.querySelector('#rosterSection > summary .roster-status');
    if (!status) return;
    let original = null;
    const sync = () => {
        const text = status.textContent;
        const bare = /^\((.*)\)$/s.exec(text.trim());
        if (isNext() && bare) { original = text; status.textContent = bare[1]; }
        else if (!isNext() && original != null && status.textContent === original.trim().slice(1, -1)) { status.textContent = original; original = null; }
    };
    new MutationObserver(sync).observe(status, { childList: true, characterData: true, subtree: true });
    document.addEventListener('homelayoutchange', sync);
    sync();
}

// --- Team builder: the name box has a visible label ------------------------
// A placeholder disappears as soon as you type, so the New look puts a
// short label above the box. Classic keeps the original row.

function mountTeamAddLabel() {
    const input = byId('teamAddName');
    if (!input) return;
    let label = null;
    const sync = () => {
        if (isNext()) {
            if (!label) { label = document.createElement('label'); label.className = 'hn-team-add-label'; label.htmlFor = 'teamAddName'; label.textContent = 'Add a player by name'; }
            if (input.previousElementSibling !== label) input.before(label);
        } else { label?.remove(); }
    };
    document.addEventListener('homelayoutchange', sync);
    sync();
}

// --- The contact address breaks after its "@" on narrow screens -----------
// At large text sizes the address is wider than a phone. In the New look it
// may break after the "@" (and nowhere else); Classic keeps the plain text.

function mountEmailBreak() {
    const link = document.querySelector('#setupScreen .setup-credit a[href^="mailto:"]');
    if (!link) return;
    const plain = link.textContent;
    const at = plain.indexOf('@');
    if (at < 1) return;
    const sync = () => {
        const has = !!link.querySelector('wbr');
        // The break is for the eye only; the address is still read as one.
        if (isNext() && !has) { link.replaceChildren(plain.slice(0, at + 1), document.createElement('wbr'), plain.slice(at + 1)); link.setAttribute('aria-label', plain); }
        else if (!isNext() && has) { link.textContent = plain; link.removeAttribute('aria-label'); }
    };
    document.addEventListener('homelayoutchange', sync);
    sync();
}

// --- Wide screens: whole controls only above the docked Start card --------
// While the Start card is docked at the bottom of the right column, the page
// fades out above it. A control that would show only a sliver there (the
// tops of a row, half a segmented control) fades out with it, so the column
// only ever shows whole controls, like the game list's whole rows. It is
// still there for the keyboard: focusing it scrolls it into full view.

function mountDockSlivers() {
    const play = byId('playSection');
    const setup = byId('setupScreen');
    if (!play || !setup) return;
    const WIDE = window.matchMedia?.('(min-width: 1001px), (min-width: 721px) and (min-height: 561px)');
    const BLOCKS = '#gameOptionsSection, #playersSection, #presetsSection, #casualRecordingSetup';
    let marked = [];
    let clipped = new Map();
    const unclip = el => { el.removeAttribute('data-hn-clip'); el.style.removeProperty('--hn-clip'); if (el.getAttribute('style') === '') el.removeAttribute('style'); };
    const clear = () => { marked.forEach(el => el.removeAttribute('data-hn-sliver')); marked = []; clipped.forEach((_, el) => unclip(el)); clipped = new Map(); };
    // Round 25: a row the fade crosses is cut just above the first text
    // line or control that reaches into the fade, so nothing shows half
    // faded. A boxed piece (a tile with its own border or tint) counts as
    // one piece.
    const boxed = el => { const cs = getComputedStyle(el); return parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderBottomWidth) > 0 || (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') || cs.backgroundImage !== 'none'; };
    const ATOM = 'input, select, textarea, button, img, svg, canvas, video, [role="button"], [role="switch"], [role="checkbox"], [role="radio"], [role="slider"]';
    // Round 26: a piece only counts as crossing once it reaches 6px into
    // the fade (the fade is still nearly clear there); a field cut away
    // takes its label with it.
    const DEEP = 6;
    const drawn = el => ['::before', '::after'].some(pseudo => { const c = getComputedStyle(el, pseudo).content; return c && c !== 'none' && c !== 'normal' && c !== '""' && c !== "''"; });
    const cutAt = (row, band) => {
        let cut = Infinity;
        let above = -Infinity;
        const pieces = [];
        const take = (r, piece) => {
            if (!r.width || !r.height) return;
            if (piece) pieces.push(r);
            if (r.bottom > band + DEEP) { if (r.top < cut) cut = r.top; }
            else if (r.bottom > above) above = r.bottom;
        };
        const walk = el => {
            for (const node of el.childNodes) {
                if (node.nodeType === 3) {
                    if (!node.textContent.trim()) continue;
                    const range = document.createRange();
                    range.selectNodeContents(node);
                    for (const r of range.getClientRects()) take(r);
                } else if (node.nodeType === 1) {
                    if (!node.getClientRects().length) continue;
                    const cs = getComputedStyle(node);
                    if (cs.visibility === 'hidden' || cs.position === 'absolute' || cs.position === 'fixed') continue;
                    // A tall tile (like a player's whole drag row) is
                    // opened into its own pieces, so it never takes a row
                    // with it just for reaching the fade.
                    if (node.matches(ATOM) || (boxed(node) && node.getBoundingClientRect().height <= 48)) take(node.getBoundingClientRect(), true);
                    else walk(node);
                }
            }
        };
        walk(row);
        const top = row.getBoundingClientRect().top;
        if (cut === Infinity) {
            // Nothing measurable reaches the fade. Text drawn by CSS (like a
            // card's hint line) can't be measured: the row is then cut just
            // below the last piece clear of it. Otherwise only padding or a
            // border passes under the fade, and the row stays as it is.
            if (!drawn(row) || row.getBoundingClientRect().bottom <= band + DEEP) return Infinity;
            return above === -Infinity ? top : Math.min(band, above + 4);
        }
        // Only a label would be left above the cut: the row goes whole.
        if (pieces.length && !pieces.some(r => r.bottom <= cut + 1)) return top;
        return cut;
    };
    // The rows a card is made of: its children, opening any child taller
    // than a row into its own children.
    const rows = card => {
        const out = [];
        const walk = (el, depth) => [...el.children].forEach(child => {
            if (!child.getClientRects().length || getComputedStyle(child).position === 'absolute') return;
            const h = child.getBoundingClientRect().height;
            if (h > 140 && depth < 4 && child.children.length) walk(child, depth + 1);
            else if (h > 0) out.push(child);
        });
        walk(card, 0);
        return out;
    };
    let frame = 0;
    const check = () => {
        frame = 0;
        if (!isNext() || !WIDE?.matches || setup.style.display === 'none' || getComputedStyle(play).position !== 'sticky') { clear(); play.removeAttribute('data-hn-cover'); return; }
        const p = play.getBoundingClientRect();
        const bottom = parseFloat(getComputedStyle(play).bottom) || 0;
        // Docked: at its sticky spot, with the cards that follow it pushed
        // further down than its own margin (at rest they sit right below it).
        const after = [byId('rosterSection'), document.querySelector('#setupScreen .home-player-help'), byId('maintenanceSection')].find(el => el && el.getClientRects().length);
        const docked = Math.abs(p.bottom - (innerHeight - bottom)) < 2 && (!after || after.getBoundingClientRect().top - p.bottom > 24);
        const next = [];
        const clips = new Map();
        let behind = false;
        if (docked) {
            // Round 24: the fade above the card is 24px and mostly opaque
            // from about 14px above it. Only a row cut by that line and
            // showing less than 24px above it is hidden; rows clear of the
            // line always show.
            const line = p.top - 14;
            const band = p.top - 24;
            const shells = new Set();
            document.querySelectorAll('#setupScreen .setup-panel:not(#playSection), ' + BLOCKS).forEach(card => {
                if (!card.getClientRects().length) return;
                const c = card.getBoundingClientRect();
                if (!(c.right > p.left + 8 && c.left < p.right - 8 && c.bottom > band + 2 && c.top < p.top)) return;
                // A card whose top edge shows less than 24px above the line
                // would read as an empty strip: it hides whole.
                if (line - c.top < 24 && !card.contains(document.activeElement)) { next.push(card); shells.add(card); }
                // The fade's colour follows what is right under its solid end.
                else if (c.bottom > p.top - 4) behind = true;
            });
            document.querySelectorAll(BLOCKS).forEach(card => {
                if (!card.getClientRects().length || shells.has(card)) return;
                const c = card.getBoundingClientRect();
                if (c.bottom <= band || c.top >= p.top) return;
                const all = rows(card);
                let gone = 0;
                all.forEach(row => {
                    const r = row.getBoundingClientRect();
                    if (r.top >= p.top) { gone++; return; }
                    if (r.bottom <= band + 1 || row.contains(document.activeElement)) return;
                    const cut = row.matches(ATOM) ? r.top : cutAt(row, band);
                    if (cut === Infinity) return;
                    // Less than 24px would be left above the cut: the row is
                    // cut at the fade instead when 24px of it shows there,
                    // and only hides whole when it doesn't.
                    if (cut - r.top >= 24) clips.set(row, Math.ceil(r.bottom - cut + 2));
                    else if (band - r.top >= 24) clips.set(row, Math.ceil(r.bottom - band + 2));
                    else { next.push(row); gone++; }
                });
                // A card left with nothing showing hides as a whole.
                if (all.length && gone === all.length && !card.contains(document.activeElement)) next.push(card);
            });
        }
        // The fade takes the panels' colour only while a card passes behind
        // it; over a gap between cards it stays the page colour.
        if (play.hasAttribute('data-hn-cover') !== behind) play.toggleAttribute('data-hn-cover', behind);
        marked.filter(el => !next.includes(el)).forEach(el => el.removeAttribute('data-hn-sliver'));
        next.filter(el => !marked.includes(el)).forEach(el => el.setAttribute('data-hn-sliver', ''));
        marked = next;
        clipped.forEach((_, el) => { if (!clips.has(el)) unclip(el); });
        clips.forEach((px, el) => {
            if (el.style.getPropertyValue('--hn-clip') !== `${px}px`) el.style.setProperty('--hn-clip', `${px}px`);
            if (!el.hasAttribute('data-hn-clip')) el.setAttribute('data-hn-clip', '');
        });
        clipped = clips;
    };
    const soon = () => { if (!frame) frame = requestAnimationFrame(check); };
    setup.addEventListener('scroll', soon, { passive: true });
    window.addEventListener('scroll', soon, { passive: true });
    window.addEventListener('resize', soon);
    setup.addEventListener('focusin', soon);
    ['homelayoutchange', 'hntightchange', 'change'].forEach(name => document.addEventListener(name, soon));
    if (window.ResizeObserver) new ResizeObserver(soon).observe(document.querySelector('#setupScreen .setup-card') || setup);
    document.fonts?.ready?.then(soon);
    soon();
}

// --- Wide screens: the game library ends at the bottom of the window -------
// It stays in view on the left; its height follows the space left below it,
// so its bottom edge is always on screen, at rest and while scrolled.

function mountLibraryFit() {
    const section = byId('gamePickerSection');
    const setup = byId('setupScreen');
    if (!section || !setup) return;
    let frame = 0;
    const fit = () => {
        frame = 0;
        const list = byId('gameTypeGrid');
        if (!isNext() || setup.style.display === 'none') {
            section.style.removeProperty('--hn-lib-h'); list?.style.removeProperty('--hn-sbw');
            if (!isNext()) [section, list].forEach(el => { if (el && el.getAttribute('style') === '') el.removeAttribute('style'); });
            return;
        }
        if (list) {
            // No further than the card's own padding allows (wide scrollbars on
            // some systems keep a few pixels of their gap).
            const room = Math.max(0, (parseFloat(getComputedStyle(section).paddingRight) || 0) - 8);
            const sbw = `${Math.min(room, Math.max(0, list.offsetWidth - list.clientWidth))}px`;
            if (list.style.getPropertyValue('--hn-sbw') !== sbw) list.style.setProperty('--hn-sbw', sbw);
        }
        // The library ends where the sticky Start card ends, so their bottom
        // edges line up.
        const play = byId('playSection');
        const cs = play && getComputedStyle(play);
        const gap = cs?.position === 'sticky' ? (parseFloat(cs.bottom) || 16) : 16;
        const top = Math.max(16, section.getBoundingClientRect().top);
        const height = Math.floor(window.innerHeight - top - gap);
        const value = `${height}px`;
        if (section.style.getPropertyValue('--hn-lib-h') !== value) {
            // A list scrolled to its end stays at its end as it grows or shrinks.
            const grid = byId('gameTypeGrid');
            const atEnd = grid && grid.scrollTop > 0 && grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 2;
            section.style.setProperty('--hn-lib-h', value);
            if (atEnd) grid.scrollTop = grid.scrollHeight;
        }
        moreCue();
    };
    // Round 16: under a list that scrolls, a quiet "N more games" line, so a
    // list whose last visible row happens to end cleanly still shows there is more.
    const TALL_WIDE = window.matchMedia?.('(min-width: 721px) and (min-height: 820px)');
    let cue = null;
    const moreCue = () => {
        const grid = byId('gameTypeGrid');
        if (!grid) return;
        const on = isNext() && !!TALL_WIDE?.matches && setup.style.display !== 'none';
        if (on && !cue) {
            cue = document.createElement('div');
            cue.className = 'hn-more-cue';
            cue.setAttribute('aria-hidden', 'true');
            cue.hidden = true;
            cue.addEventListener('click', () => {
                const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
                grid.scrollBy({ top: Math.max(80, grid.clientHeight * 0.8), behavior: reduce ? 'auto' : 'smooth' });
            });
            grid.after(cue);
        }
        if (!cue) return;
        if (cue.previousElementSibling !== grid) grid.after(cue);
        const scrolls = on && grid.scrollHeight > grid.clientHeight + 1;
        if (cue.hidden === scrolls) cue.hidden = !scrolls;
        if (!scrolls) return;
        const bottom = grid.getBoundingClientRect().bottom - (parseFloat(getComputedStyle(grid).paddingBottom) || 0);
        const below = [...grid.children].filter(el => el.getClientRects().length && el.getBoundingClientRect().bottom > bottom + 1).length;
        const text = below === 1 ? '1 more game' : `${below} more games`;
        if (below && cue.textContent !== text) cue.textContent = text;
        if (!below !== cue.hasAttribute('data-end')) cue.toggleAttribute('data-end', !below);
    };
    let cueFrame = 0;
    const cueSoon = () => { if (!cueFrame) cueFrame = requestAnimationFrame(() => { cueFrame = 0; moreCue(); }); };
    const gridEl = byId('gameTypeGrid');
    if (gridEl) {
        gridEl.addEventListener('scroll', cueSoon, { passive: true });
        new MutationObserver(cueSoon).observe(gridEl, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
    }
    TALL_WIDE?.addEventListener?.('change', cueSoon);
    const soon = () => { if (!frame) frame = requestAnimationFrame(fit); };
    setup.addEventListener('scroll', soon, { passive: true });
    window.addEventListener('scroll', soon, { passive: true });
    window.addEventListener('resize', soon);
    const card = setup.querySelector('.setup-card');
    if (card && 'ResizeObserver' in window) new ResizeObserver(soon).observe(card);
    new MutationObserver(soon).observe(setup, { attributes: true, attributeFilter: ['style'] });
    document.addEventListener('homelayoutchange', soon);
    fit();
}

// --- Phones: a swipe on the docked Start bar scrolls the page -------------
// On portrait phones the bar is fixed to the window, so a swipe that starts on
// it would reach no scroller; it scrolls the setup screen instead, and a swipe
// that ends on a button does not press it.

function mountBarSwipe() {
    const play = byId('playSection');
    const setup = byId('setupScreen');
    if (!play || !setup) return;
    let start = null;
    let moved = false;
    let last = null;
    const active = () => isNext() && getComputedStyle(play).position === 'fixed';
    play.addEventListener('touchstart', event => {
        if (event.touches.length !== 1 || !active()) { start = null; return; }
        const t = event.touches[0];
        start = { x: t.clientX, y: t.clientY, top: setup.scrollTop };
        last = { y: t.clientY, time: event.timeStamp, v: 0 };
        moved = false;
    }, { passive: true });
    play.addEventListener('touchmove', event => {
        if (!start || event.touches.length !== 1) return;
        const t = event.touches[0];
        const dy = t.clientY - start.y;
        if (!moved && Math.abs(dy) < 10) return;
        if (!moved && Math.abs(t.clientX - start.x) > Math.abs(dy)) { start = null; return; }
        moved = true;
        setup.scrollTop = start.top - dy;
        const dt = Math.max(1, event.timeStamp - last.time);
        last = { y: t.clientY, time: event.timeStamp, v: (t.clientY - last.y) / dt };
    }, { passive: true });
    const end = event => {
        if (!start) return;
        start = null;
        if (!moved) return;
        // A short glide in the direction of a quick swipe.
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        const glide = Math.max(-600, Math.min(600, -last.v * 220));
        if (Math.abs(glide) > 24) setup.scrollBy({ top: glide, behavior: reduce ? 'auto' : 'smooth' });
        // A click the swipe itself leaves behind arrives at once and is
        // dropped; the next real tap always goes through.
        const endedAt = event.timeStamp;
        const drop = click => {
            if (click.timeStamp - endedAt > 60) return;
            click.preventDefault(); click.stopPropagation();
        };
        play.addEventListener('click', drop, { capture: true, once: true });
        const clear = () => { play.removeEventListener('click', drop, { capture: true }); play.removeEventListener('touchstart', clear, true); };
        play.addEventListener('touchstart', clear, { capture: true, passive: true, once: true });
        setTimeout(clear, 400);
        moved = false;
    };
    play.addEventListener('touchend', end, { passive: true });
    play.addEventListener('touchcancel', () => { start = null; moved = false; }, { passive: true });
}

// --- Pinch-zoom on the home screen -----------------------------------------
// The scoreboards keep zoom off (fast taps must not zoom). On the New look's
// setup and team screens people can pinch to enlarge text.

function mountZoom() {
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return;
    const original = meta.getAttribute('content') || '';
    const zoomable = original.split(',').map(part => part.trim()).filter(part => part && !/^(user-scalable|maximum-scale)\s*=/i.test(part)).join(', ');
    const screens = ['setupScreen', 'teamBuilderScreen'].map(byId).filter(Boolean);
    const game = byId('gameScreen');
    const showing = el => el.style.display !== 'none' && getComputedStyle(el).display !== 'none';
    // Never while a game is live underneath ("Change settings"), so the
    // scoreboard always comes back at its own fixed scale.
    const sync = () => {
        const content = isNext() && screens.some(showing) && !(game && showing(game)) ? zoomable : original;
        if (meta.getAttribute('content') !== content) meta.setAttribute('content', content);
    };
    [...screens, game].filter(Boolean).forEach(el => new MutationObserver(sync).observe(el, { attributes: true, attributeFilter: ['style'] }));
    document.addEventListener('homelayoutchange', sync);
    sync();
}

// --- One family of game icons ----------------------------------------------
// The game list mixes text symbols (♥ ✕ ⚡) with colour emoji, and two emoji
// bring their own square. In the New look every game shows a colour emoji
// with no frame of its own; the registry and Classic keep the originals.

const ICON_SWAP = new Map([
    ['♥', '❤️'], ['✕', '🏏'], ['⚡', '⚡️'], ['⏱', '⏱️'], ['⚾', '⚾️'],
    ['⛳', '⛳️'], ['❎', '⭕'], ['⏬', '📉'], ['🔺', '🏝️'],
]);
// Games that share a symbol but should look different at a glance.
const GAME_ICON = new Map([['bullshit', '🐂']]);
const iconFor = (id, from) => GAME_ICON.get(id) || ICON_SWAP.get(from);
function mountGameIcons() {
    const grid = byId('gameTypeGrid');
    if (!grid) return;
    const sync = () => {
        const next = isNext();
        grid.querySelectorAll('.game-card-icon').forEach(icon => {
            const from = icon.textContent.trim();
            const to = next ? iconFor(icon.closest('[data-game-value]')?.dataset.gameValue, from) : undefined;
            if (to && icon.dataset.hnIcon !== to) icon.dataset.hnIcon = to;
            else if (!to && icon.dataset.hnIcon) delete icon.dataset.hnIcon;
        });
    };
    new MutationObserver(sync).observe(grid, { childList: true, subtree: true, characterData: true });
    document.addEventListener('homelayoutchange', sync);
    sync();
    // "Jump back in" chips show the same icons as the cards.
    const recents = byId('gameRecentsRow');
    const syncChips = () => {
        recents?.querySelectorAll('.picker-recent-chip').forEach(chip => {
            if (!isNext()) {
                if (chip.dataset.hnText != null) { chip.textContent = chip.dataset.hnText; delete chip.dataset.hnText; }
                return;
            }
            if (chip.dataset.hnText != null || chip.children.length) return;
            const text = chip.textContent;
            const [first, ...rest] = text.split(' ');
            if (!rest.length) return;
            // The icon is decoration: screen readers hear only the game's name.
            const icon = document.createElement('span');
            icon.setAttribute('aria-hidden', 'true');
            icon.textContent = iconFor(chip.dataset.recent, first) || first;
            chip.dataset.hnText = text;
            chip.replaceChildren(icon, ` ${rest.join(' ')}`);
        });
    };
    if (recents) new MutationObserver(syncChips).observe(recents, { childList: true });
    document.addEventListener('homelayoutchange', syncChips);
    syncChips();
    // The rules popover's title shows the same icon as its card.
    new MutationObserver(() => {
        const title = isNext() && byId('gameRulesPop')?.querySelector('strong');
        if (!title || title.dataset.hnIcon) return;
        const [first, ...rest] = title.textContent.split(' ');
        const to = iconFor(byId('gameRulesPop')?.dataset.gameId, first);
        title.dataset.hnIcon = to || first;
        if (!rest.length || title.children.length) return;
        const icon = document.createElement('span');
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = to || first;
        title.replaceChildren(icon, ` ${rest.join(' ')}`);
    }).observe(document.body, { childList: true });
}

// --- Large text -------------------------------------------------------------
// With big system text the screen is narrow in letters even on a normal phone.
// data-hn-tight marks under 19em of width, so the tabs, header and Start bar
// can stack instead of overlapping or cutting words.
function mountTextFit() {
    const root = document.documentElement;
    let probe = null;
    const sync = () => {
        // The probe lives only in the New look, so Classic's page is untouched.
        if (probe && isNext() !== probe.isConnected) { if (isNext()) document.body.append(probe); else probe.remove(); }
        const rem = parseFloat(getComputedStyle(root).fontSize) || 16;
        const tight = isNext() && window.innerWidth / rem < 19;
        if (tight === root.hasAttribute('data-hn-tight')) return;
        root.toggleAttribute('data-hn-tight', tight);
        document.dispatchEvent(new Event('hntightchange'));
    };
    window.addEventListener('resize', sync, { passive: true });
    document.addEventListener('homelayoutchange', sync);
    // Text size changes resize the page, and always this 1rem probe (the
    // page itself may keep the window's height whatever the text size).
    if (window.ResizeObserver) {
        probe = document.createElement('span');
        probe.setAttribute('aria-hidden', 'true');
        probe.style.cssText = 'position:absolute;top:0;left:0;width:1rem;height:1rem;visibility:hidden;pointer-events:none;';
        if (isNext()) document.body.append(probe);
        const observer = new ResizeObserver(sync);
        observer.observe(document.body);
        observer.observe(probe);
    }
    sync();
}

// --- Team mode hint for screen readers ---------------------------------------
// The Players subtitle "You split into teams after Start" is drawn by CSS, so
// the Team mode switch carries the same hint for screen readers.
// Team rows: a name that fits beside the grip and buttons shares their line;
// a longer one keeps its own line above them.
function mountTeamRowFit() {
    const zones = byId('teamZones');
    if (!zones) return;
    let width = -1;
    const fit = () => {
        const rows = [...zones.querySelectorAll('.team-zone-member')];
        if (!isNext()) { rows.forEach(row => row.removeAttribute('data-hn-inline')); return; }
        rows.forEach(row => row.setAttribute('data-hn-inline', ''));
        // One team keeps one layout: if any name there needs its own line, all of them get one.
        const tooLong = new Set(rows.filter(row => {
            const name = row.querySelector('.team-zone-member-name');
            return !name || name.clientWidth < 40 || getComputedStyle(row).gridTemplateColumns.split(' ').length !== 6 || name.scrollWidth > name.clientWidth + 1;
        }).map(row => row.closest('.team-zone')));
        // Side by side, both teams share that choice, so their rows line up.
        const [z0, z1] = [byId('teamZone0'), byId('teamZone1')];
        const sideBySide = z0 && z1 && Math.abs(z0.getBoundingClientRect().top - z1.getBoundingClientRect().top) < 2;
        rows.forEach(row => { if (tooLong.has(row.closest('.team-zone')) || (sideBySide && tooLong.size)) row.removeAttribute('data-hn-inline'); });
    };
    let queued = false;
    const soon = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; fit(); }); };
    new MutationObserver(soon).observe(zones, { childList: true, subtree: true });
    new ResizeObserver(() => { if (zones.clientWidth !== width) { width = zones.clientWidth; soon(); } }).observe(zones);
    ['homelayoutchange', 'hntightchange'].forEach(name => document.addEventListener(name, soon));
    window.addEventListener('resize', soon);
    document.fonts?.ready?.then(soon);
    fit();
}

// Team builder hint: in the New look players go in with the "Put … in Home"
// buttons, so the hint names those instead of tapping a zone.
function mountTeamHintText() {
    const hint = byId('teamBuilderHint');
    if (!hint) return;
    let original = null;
    let shown = null;
    const rewrite = text => {
        if (text === 'Now tap Home or Away.') return 'Now press Put in Home or Put in Away.';
        if (/^Drag a player into Home or Away/.test(text) || /^Tap a player chip/.test(text)) return 'Tap a name, then press Put in Home or Put in Away. ✕ takes a player off a team.';
        if (/Drag or tap players into Home and Away\.$/.test(text)) return text.replace('Drag or tap players into Home and Away.', 'Tap a name, then press Put in Home or Put in Away.');
        if (/Drag or use ▲▼ to reorder within a team; ⇄ moves a member across\.$/.test(text)) return text.replace('Drag or use ▲▼ to reorder within a team; ⇄ moves a member across.', 'Drag ☰ or use ▲▼ to reorder; ⇄ moves a player to the other team.');
        return text;
    };
    const sync = () => {
        const text = hint.textContent;
        if (text !== shown) original = text;
        if (!isNext()) {
            if (shown != null && text === shown) hint.textContent = original;
            shown = null;
            return;
        }
        const next = rewrite(original);
        shown = next;
        if (text !== next) hint.textContent = next;
    };
    new MutationObserver(sync).observe(hint, { childList: true, characterData: true, subtree: true });
    document.addEventListener('homelayoutchange', sync);
    sync();
}

function mountTeamHint() {
    const team = byId('teamMode');
    if (!team) return;
    const hint = document.createElement('span');
    hint.id = 'homeNextTeamHint';
    hint.className = 'hn-visually-hidden';
    hint.textContent = 'You split into teams after Start.';
    const sync = () => {
        if (isNext()) {
            if (!hint.isConnected) team.closest('label')?.after(hint);
            if (!team.hasAttribute('aria-describedby')) team.setAttribute('aria-describedby', hint.id);
        } else {
            hint.remove();
            if (team.getAttribute('aria-describedby') === hint.id) team.removeAttribute('aria-describedby');
        }
    };
    document.addEventListener('homelayoutchange', sync);
    sync();
}

// --- Room for a tall Start bar ---------------------------------------------
// With large text the docked Start bar grows, so the page keeps room for its
// real height (the CSS default fits normal text).
function mountBarRoom() {
    const bar = byId('playSection');
    if (!bar || !window.ResizeObserver) return;
    const root = document.documentElement;
    const sync = () => {
        const docked = isNext() && root.hasAttribute('data-hn-tight') && getComputedStyle(bar).position === 'fixed';
        const value = docked && bar.offsetHeight ? `${Math.ceil(bar.offsetHeight)}px` : '';
        if (root.style.getPropertyValue('--hn-bar-height') !== value) {
            if (value) root.style.setProperty('--hn-bar-height', value);
            else root.style.removeProperty('--hn-bar-height');
        }
    };
    new ResizeObserver(sync).observe(bar);
    document.addEventListener('hntightchange', sync);
    document.addEventListener('homelayoutchange', sync);
    window.addEventListener('resize', sync, { passive: true });
    sync();
}

export function initHomeNext() {
    applyLayout(storedLayout());
    const run = (name, fn) => {
        try { fn(); } catch (error) { console.warn(`BlakeOut new look: ${name} skipped`, error); }
    };
    run('textFit', mountTextFit);
    run('barRoom', mountBarRoom);
    run('teamHint', mountTeamHint);
    run('teamRowFit', mountTeamRowFit);
    run('teamHintText', mountTeamHintText);
    run('summary', mountSummary);
    run('playerCount', mountPlayerCount);
    applyLayout(document.documentElement.dataset.home);
    run('layoutChoice', mountLayoutChoice);
    run('resumeLabel', mountResumeLabel);
    run('rulesA11y', mountRulesA11y);
    run('gridFocus', mountGridFocus);
    run('favToggles', mountFavToggles);
    run('backFocus', mountBackFocus);
    run('recentsFocus', mountRecentsFocus);
    run('tabsFit', mountTabsFit);
    run('teamA11y', mountTeamA11y);
    run('customizeDialog', mountCustomizeDialog);
    run('fieldNames', mountFieldNames);
    run('clearSearch', mountClearSearch);
    run('chipA11y', mountChipA11y);
    run('skipLink', mountSkipLink);
    run('typingBar', mountTypingBar);
    run('searchStatus', mountSearchStatus);
    run('gameExpander', mountGameExpander);
    run('quickStartFirst', mountQuickStartFirst);
    run('skillLabels', mountSkillLabels);
    run('swatchFit', mountSwatchFit);
    run('orderA11y', mountOrderA11y);
    run('scaleText', mountScaleText);
    run('fitStack', mountFitStack);
    run('teamSkillNames', mountTeamSkillNames);
    run('libraryFit', mountLibraryFit);
    run('dockSlivers', mountDockSlivers);
    run('emailBreak', mountEmailBreak);
    run('teamAddLabel', mountTeamAddLabel);
    run('rosterStatus', mountRosterStatus);
    run('zoom', mountZoom);
    run('gameIcons', mountGameIcons);
    run('barSwipe', mountBarSwipe);
    // The rules popover is fixed to the window: keep it next to its button
    // as the page scrolls, and close it once that button leaves the screen.
    document.addEventListener('scroll', followRulesPop, { capture: true, passive: true });
    document.addEventListener('keydown', rulesTab, true);
    // Place it right after it opens too, and let Escape close it.
    byId('gameTypeGrid')?.addEventListener('click', event => {
        if (event.target.closest('[data-rules-toggle]')) later(followRulesPop);
    });
    // The rules popover is added to and removed from <body>: keep the ⓘ
    // buttons' expanded state in step however it opens or closes.
    new MutationObserver(records => {
        if (records.some(r => [...r.addedNodes, ...r.removedNodes].some(n => n.id === 'gameRulesPop'))) syncRulesExpanded();
    }).observe(document.body, { childList: true });
    // One Escape does one thing: while the rules are open it only closes them.
    document.addEventListener('keydown', event => {
        const pop = byId('gameRulesPop');
        if (event.key !== 'Escape' || !pop || !isNext()) return;
        event.stopImmediatePropagation();
        const button = [...document.querySelectorAll('[data-rules-toggle]')].find(el => el.dataset.rulesToggle === pop.dataset.gameId);
        pop.remove();
        syncRulesExpanded();
        button?.focus();
    }, true);
    // The account panel can mount after this runs.
    const card = document.querySelector('#setupScreen .setup-card');
    if (card) new MutationObserver(() => placeSections(document.documentElement.dataset.home)).observe(card, { childList: true });
    // The game list is rebuilt when filtering: keep the ⓘ buttons labelled.
    const grid = byId('gameTypeGrid');
    if (grid) new MutationObserver(() => syncRulesExpanded()).observe(grid, { childList: true });
    window.addEventListener('storage', event => {
        if (event.key === HOME_LAYOUT_KEY || event.key === null) applyLayout(storedLayout());
    });
}

export { isNext };
