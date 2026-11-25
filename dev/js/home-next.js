// DEV test build: the refreshed home/setup experience ("New look").
// Presentation only. It never changes game rules, scoring, saves or the
// existing controls' IDs: every enhancement drives the original control
// (and fires its normal 'change' event) so setup.js keeps working unchanged.
// The Classic layout stays one tap away in Customize.

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
    document.querySelectorAll('#setupScreen :is(#gamePickerSection, #gameOptionsSection, #playersSection) > .setup-section-label').forEach(label => {
        if (layout === 'next') { label.setAttribute('role', 'heading'); label.setAttribute('aria-level', '2'); }
        else { label.removeAttribute('role'); label.removeAttribute('aria-level'); }
    });
}

// Screen readers hear the match summary with the Start button.
function describeStart(layout) {
    const start = document.getElementById('startGameBtn');
    if (!start) return;
    if (layout === 'next' && document.getElementById('homeNextSummary')) start.setAttribute('aria-describedby', 'homeNextSummary');
    else if (start.getAttribute('aria-describedby') === 'homeNextSummary') start.removeAttribute('aria-describedby');
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
        const short = document.documentElement.hasAttribute('data-hn-tight') || window.matchMedia?.('(max-width: 360px)').matches;
        // "4 players · all BotBlake" reads better than "4 BotBlakes". Start
        // refuses a match with no human, so the summary says what is missing.
        if (bots && bots === count) parts.push(count > 1 ? (short ? 'all bots' : 'all BotBlake') : 'BotBlake', 'add a human');
        else if (bots) parts.push(short ? (bots === 1 ? '1 bot' : `${bots} bots`) : (bots === 1 ? '1 BotBlake' : `${bots} BotBlakes`));
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
    describeStart(document.documentElement.dataset.home);
    // Each part stays whole, so a line only ever breaks between parts. The
    // dots between parts are drawn by CSS (and dropped at the start of a
    // line); screen readers hear commas.
    const row = document.createElement('span');
    row.className = 'hn-summary-row';
    summary.append(row);
    const update = () => {
        const parts = summaryText().split(' · ');
        row.replaceChildren(...parts.flatMap((part, i) => {
            const span = document.createElement('span');
            span.className = 'hn-summary-part';
            span.textContent = part;
            if (!i) return [span];
            const comma = document.createElement('span');
            comma.className = 'hn-visually-hidden';
            comma.textContent = ', ';
            return [comma, span];
        }));
    };
    document.addEventListener('change', () => later(update), true);
    document.addEventListener('hntightchange', update);
    window.matchMedia?.('(max-width: 360px)').addEventListener?.('change', update);
    update();
}

// --- Resume button: game on one line, players on the next ------------------
// setup.js writes "Resume GAME (names)" as plain text. In the New look the
// two parts get their own lines so a long game or long names never cut the
// label mid-word. The text itself stays exactly as setup.js wrote it.

function splitResume(button) {
    const text = button.textContent;
    const wrapped = button.querySelector('.hn-resume-main');
    // The split spans read as "( name vs name )"; the label keeps the
    // button's spoken name exactly as setup.js wrote it.
    if (!isNext()) {
        if (wrapped) button.textContent = text;
        button.removeAttribute('aria-label');
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
    inner.split(' vs ').forEach((name, i) => {
        const player = document.createElement('span');
        player.className = 'hn-resume-player';
        player.textContent = i ? ` vs ${name}` : name;
        names.append(player);
    });
    names.append(paren(')'));
    button.replaceChildren(main, names);
}

function mountResumeLabel() {
    const button = byId('resumeGameBtn');
    if (!button) return;
    const split = () => splitResume(button);
    new MutationObserver(split).observe(button, { childList: true });
    document.addEventListener('homelayoutchange', split);
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
    if (height < box.height) { pop.tabIndex = 0; if (!pop.hasAttribute('aria-label')) pop.setAttribute('aria-label', 'Rules, scrollable'); }
    else { pop.removeAttribute('tabindex'); pop.removeAttribute('aria-label'); }
    markRulesEnd(pop);
    let left = anchor.left + anchor.width / 2 - box.width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - box.width - margin));
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
    new MutationObserver(() => {
        if (!last || !isNext()) return;
        const active = document.activeElement;
        if (active && active !== document.body && document.contains(active)) return;
        const [attr, value] = last;
        const el = [...grid.querySelectorAll(`[${attr}]`)].find(node => node.getAttribute(attr) === value);
        el?.focus({ preventScroll: true });
    }).observe(grid, { childList: true });
}

// --- Team builder by keyboard and screen reader ----------------------------
// teams.js works on pointer presses. In the New look, keyboard presses on its
// buttons are passed through as the same press, every button says what it
// does, each member gets a Remove button, Home and Away take the chosen player
// with Enter or Space, and each move is read out.

function mountTeamA11y() {
    const screen = byId('teamBuilderScreen');
    if (!screen) return;
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
    byId('teamSwapFirstBtn')?.addEventListener('click', () => {
        if (!isNext()) return;
        later(() => say(`${zoneName(byId('teamZone1')?.classList.contains('first') ? 1 : 0)} throws first`));
    });
    const label = () => {
        const next = isNext();
        screen.querySelectorAll('.team-zone-member').forEach(member => {
            let remove = member.querySelector('[data-member-action="hn-remove"]');
            let grip = member.querySelector(':scope > .hn-grip');
            if (!next) { remove?.remove(); grip?.remove(); return; }
            // Swipes on the row scroll the page; dragging starts from this grip.
            if (!grip) {
                grip = document.createElement('span');
                grip.className = 'hn-grip';
                grip.setAttribute('aria-hidden', 'true');
                grip.title = 'Drag';
                grip.textContent = '⠿';
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
                }
                if (put.textContent !== text) put.textContent = text;
            } else if (put) {
                const hadFocus = put === document.activeElement;
                put.remove();
                if (hadFocus) focusFirst('#teamTray .team-chip', `#teamZone${idx} [data-member-action="hn-remove"]`, '#teamAddName');
            }
        });
        // A new pick: bring the Away button into view (Home sits above it).
        const pickId = chosen?.dataset.chipId || null;
        if (pickId && pickId !== lastPick) {
            const away = byId('teamZone1')?.querySelector(':scope > .hn-zone-put');
            const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
            // After any refocus of the chip, so nothing cancels the scroll.
            if (away) later(() => later(() => away.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' })));
        }
        lastPick = pickId;
    };
    let lastPick = null;
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
        const control = event.target.closest?.('[data-member-action], .team-chip[data-chip-id], .team-zone-label, .team-zone');
        if (!control || control.matches('[data-member-action="hn-remove"]')) { pending = null; return; }
        const key = control.dataset.memberAction ? ['member', control.dataset.memberId, control.dataset.memberAction]
            : control.dataset.chipId ? ['chip', control.dataset.chipId] : null;
        pending = { before: snapshot(), key };
    }, true);
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
            }
            for (const [id, was] of before.members) if (!after.members.has(id)) text = `${was.name} is back in Available Players`;
            if (!text && after.chip && after.chip !== before.chip) text = `${after.chipName} chosen. Now pick Home or Away.`;
            if (text) say(text);
            const active = document.activeElement;
            if (key && (!active || active === document.body || !document.contains(active))) {
                if (key[0] === 'member') focusFirst(`[data-member-id="${CSS.escape(key[1])}"][data-member-action="${key[2]}"]`, `[data-member-id="${CSS.escape(key[1])}"][data-member-action="swap"]`);
                else focusChip(`.team-chip[data-chip-id="${CSS.escape(key[1])}"]`, `.team-zone-member[data-zone-member-id="${CSS.escape(key[1])}"] [data-member-action="hn-remove"]`);
            }
        });
    }, true);
    const recentlyPressed = () => performance.now() - lastRealPress < 600;
    screen.addEventListener('click', event => {
        if (!isNext()) return;
        const action = event.target.closest('[data-member-action]');
        if (action?.dataset.memberAction === 'hn-remove') {
            const id = action.dataset.memberId;
            const name = nameIn(memberNode(id));
            const zone = zoneOf(id);
            dragToTray(memberNode(id));
            if (!memberNode(id)) say(`${name} is back in Available Players`);
            focusFirst(`#teamZone${zone} [data-member-action="hn-remove"]`, `.team-chip[data-chip-id="${CSS.escape(id)}"]`, '#teamTray .team-chip', '#teamAddName');
            return;
        }
        // A keyboard press reaches a button as a click with no pointer behind it.
        if (event.detail !== 0) return;
        const chip = event.target.closest('.team-chip[data-chip-id]');
        if (action && !action.disabled && !recentlyPressed(action)) {
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
            focusChip(`.team-chip[data-chip-id="${CSS.escape(id)}"]`);
        }
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
        if (placed) say(`${name} added to ${zoneName(idx)}`);
        else if (id) say(`${zoneName(idx)} is full`);
        focusFirst('#teamTray .team-chip', `#teamZone${idx} [data-member-action="hn-remove"]`, '#teamAddName');
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
        if (open && heading) { heading.tabIndex = -1; later(() => heading.focus()); }
        if (!open) heading?.removeAttribute('tabindex');
        else if (!open) later(() => {
            const setup = byId('setupScreen');
            const active = document.activeElement;
            const lost = !active || active === document.body || screen.contains(active) || active.offsetParent === null;
            if (setup && setup.style.display !== 'none' && lost) byId('startGameBtn')?.focus();
        });
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
    // Done goes last, after Menu Style, on screen and in the Tab order. Menu
    // Style keeps itself the dialog's last child, so Done goes at the end of
    // its section. The menu styles lay that section out themselves, so with
    // one of them on, and outside the New look dialog, Done stays where the
    // original puts it: just before Menu Style.
    const placeDone = () => {
        const done = byId('settingsCloseBtn');
        const menu = content?.querySelector(':scope > .menu-style-picker');
        if (!done || !menu) return;
        const last = active && !document.documentElement.dataset.menuStyle;
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
        content.prepend(closeX);
    };
    // A tap on the dimmed backdrop closes it too (New look only).
    modal.addEventListener('click', event => {
        if (active && event.target === modal) byId('settingsCloseBtn')?.click();
    });
    const activate = (keepFocus = false) => {
        active = true;
        addClose();
        syncPressed();
        if (!keepFocus) returnTo = document.activeElement;
        content.setAttribute('role', 'dialog');
        content.setAttribute('aria-modal', 'true');
        content.classList.add('hn-dialog');
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
    };
    const deactivate = () => {
        active = false;
        closeX?.remove();
        closeX = null;
        syncPressed();
        content.removeAttribute('role');
        content.removeAttribute('aria-modal');
        content.removeAttribute('aria-labelledby');
        content.classList.remove('hn-dialog');
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
}

// --- While typing on a phone, the Start bar steps aside --------------------
// With the on-screen keyboard up there is little room left; the docked bar
// would cover the search results or the field being typed in.

function mountTypingBar() {
    const setup = byId('setupScreen');
    if (!setup) return;
    let tallest = window.visualViewport?.height || window.innerHeight;
    const isField = el => el?.matches?.('input[type="text"], input[type="search"], input:not([type]), textarea') && setup.contains(el);
    const update = () => {
        const vh = window.visualViewport?.height || window.innerHeight;
        const typing = isField(document.activeElement);
        if (!typing) tallest = Math.max(vh, window.innerHeight);
        const squeezed = typing && window.innerWidth <= 720 && vh < tallest - 120;
        if (squeezed) document.documentElement.dataset.hnTyping = '1';
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
    const sync = () => {
        const quick = row.querySelector(':scope > [data-quickstart]');
        if (!quick) return;
        if (isNext()) { if (row.firstElementChild !== quick) row.prepend(quick); }
        else if (row.lastElementChild !== quick) row.append(quick);
    };
    new MutationObserver(sync).observe(row, { childList: true });
    document.addEventListener('homelayoutchange', sync);
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
    };
    const shownCards = () => [...grid.querySelectorAll('.game-card')].filter(card => card.offsetParent !== null);
    button.addEventListener('click', () => {
        const before = new Set(shownCards());
        open = !open;
        sync();
        if (!open) { later(() => button.scrollIntoView({ block: 'nearest' })); return; }
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
    sync();
}

// --- Small phones: short names for the BotBlake levels ---------------------
// "BotBlake — Medium" does not fit a 320px-wide row. Below 361px the closed
// select shows "Bot · Medium"; the option values never change.

function mountSkillLabels() {
    const narrow = window.matchMedia('(max-width: 360px)');
    const selects = () => document.querySelectorAll('#playersSection select[id^="player"][id$="Skill"]');
    const sync = () => {
        const on = isNext() && narrow.matches;
        selects().forEach(select => [...select.options].forEach(option => {
            if (on && option.value !== 'off') option.label = `Bot · ${option.value === 'auto' ? 'Auto' : option.value[0].toUpperCase() + option.value.slice(1)}`;
            else option.removeAttribute('label');
        }));
    };
    narrow.addEventListener?.('change', sync);
    document.addEventListener('homelayoutchange', sync);
    sync();
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
        if (!isNext() || setup.style.display === 'none') { section.style.removeProperty('--hn-lib-h'); list?.style.removeProperty('--hn-sbw'); return; }
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
        if (section.style.getPropertyValue('--hn-lib-h') === value) return;
        // A list scrolled to its end stays at its end as it grows or shrinks.
        const grid = byId('gameTypeGrid');
        const atEnd = grid && grid.scrollTop > 0 && grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 2;
        section.style.setProperty('--hn-lib-h', value);
        if (atEnd) grid.scrollTop = grid.scrollHeight;
    };
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
    ['♥', '❤️'], ['✕', '❌'], ['⚡', '⚡️'], ['⏱', '⏱️'], ['⚾', '⚾️'],
    ['⛳', '⛳️'], ['❎', '⭕'], ['⏬', '📉'],
]);
function mountGameIcons() {
    const grid = byId('gameTypeGrid');
    if (!grid) return;
    const sync = () => {
        const next = isNext();
        grid.querySelectorAll('.game-card-icon').forEach(icon => {
            const from = icon.textContent.trim();
            const to = next ? ICON_SWAP.get(from) : undefined;
            if (to && icon.dataset.hnIcon !== to) icon.dataset.hnIcon = to;
            else if (!to && icon.dataset.hnIcon) delete icon.dataset.hnIcon;
        });
    };
    new MutationObserver(sync).observe(grid, { childList: true, subtree: true, characterData: true });
    document.addEventListener('homelayoutchange', sync);
    sync();
}

// --- Large text -------------------------------------------------------------
// With big system text the screen is narrow in letters even on a normal phone.
// data-hn-tight marks under 19em of width, so the tabs, header and Start bar
// can stack instead of overlapping or cutting words.
function mountTextFit() {
    const root = document.documentElement;
    const sync = () => {
        const rem = parseFloat(getComputedStyle(root).fontSize) || 16;
        const tight = isNext() && window.innerWidth / rem < 19;
        if (tight === root.hasAttribute('data-hn-tight')) return;
        root.toggleAttribute('data-hn-tight', tight);
        document.dispatchEvent(new Event('hntightchange'));
    };
    window.addEventListener('resize', sync, { passive: true });
    document.addEventListener('homelayoutchange', sync);
    // Text size changes resize the page.
    if (window.ResizeObserver) new ResizeObserver(sync).observe(document.body);
    sync();
}

export function initHomeNext() {
    applyLayout(storedLayout());
    const run = (name, fn) => {
        try { fn(); } catch (error) { console.warn(`BlakeOut new look: ${name} skipped`, error); }
    };
    run('textFit', mountTextFit);
    run('summary', mountSummary);
    run('playerCount', mountPlayerCount);
    applyLayout(document.documentElement.dataset.home);
    run('layoutChoice', mountLayoutChoice);
    run('resumeLabel', mountResumeLabel);
    run('rulesA11y', mountRulesA11y);
    run('gridFocus', mountGridFocus);
    run('teamA11y', mountTeamA11y);
    run('customizeDialog', mountCustomizeDialog);
    run('fieldNames', mountFieldNames);
    run('clearSearch', mountClearSearch);
    run('chipA11y', mountChipA11y);
    run('skipLink', mountSkipLink);
    run('typingBar', mountTypingBar);
    run('gameExpander', mountGameExpander);
    run('quickStartFirst', mountQuickStartFirst);
    run('skillLabels', mountSkillLabels);
    run('libraryFit', mountLibraryFit);
    run('zoom', mountZoom);
    run('gameIcons', mountGameIcons);
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
    document.addEventListener('keydown', event => {
        const pop = byId('gameRulesPop');
        if (event.key !== 'Escape' || !pop || !isNext()) return;
        const button = [...document.querySelectorAll('[data-rules-toggle]')].find(el => el.dataset.rulesToggle === pop.dataset.gameId);
        pop.remove();
        syncRulesExpanded();
        button?.focus();
    });
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
