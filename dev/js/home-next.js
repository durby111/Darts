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
    if (layout === 'next') {
        let anchor = play;
        for (const el of [help, maintenance, roster]) {
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
        if (bots) parts.push(bots === 1 ? '1 BotBlake' : `${bots} BotBlakes`);
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
    // Each part stays whole, so a line only ever breaks between parts.
    const update = () => {
        const parts = summaryText().split(' · ');
        summary.replaceChildren(...parts.flatMap((part, i) => {
            const span = document.createElement('span');
            span.className = 'hn-summary-part';
            span.textContent = part;
            return i ? [document.createTextNode(' · '), span] : [span];
        }));
    };
    document.addEventListener('change', () => later(update), true);
    update();
}

// --- Resume button: game on one line, players on the next ------------------
// setup.js writes "Resume GAME (names)" as plain text. In the New look the
// two parts get their own lines so a long game or long names never cut the
// label mid-word. The text itself stays exactly as setup.js wrote it.

function splitResume(button) {
    const text = button.textContent;
    const wrapped = button.querySelector('.hn-resume-main');
    if (!isNext()) {
        if (wrapped) button.textContent = text;
        return;
    }
    if (wrapped) return;
    const at = text.indexOf(' (');
    if (at < 0 || !text.endsWith(')')) return;
    const main = document.createElement('span');
    main.className = 'hn-resume-main';
    main.textContent = text.slice(0, at + 1);
    const names = document.createElement('span');
    names.className = 'hn-resume-names';
    names.textContent = text.slice(at + 1);
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
    const sync = () => {
        for (const { input, option } of radios) {
            input.checked = option.value === select.value;
            input.disabled = option.disabled;
            input.closest('label').classList.toggle('is-disabled', option.disabled);
        }
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

function followRulesPop(event) {
    const pop = byId('gameRulesPop');
    if (!pop || !isNext()) return;
    // Scrolling the popover's own text moves nothing.
    if (event?.target === pop) return;
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
    const margin = 8;
    const floor = Math.min(window.innerHeight, barTop) - margin;
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
            const text = [...pop.children].map(c => c.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).join('. ');
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
    const label = () => {
        const next = isNext();
        screen.querySelectorAll('.team-zone-member').forEach(member => {
            let remove = member.querySelector('[data-member-action="hn-remove"]');
            if (!next) { remove?.remove(); return; }
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
        const choosing = next && !!screen.querySelector('.team-chip.selected');
        [0, 1].forEach(idx => {
            const zone = byId(`teamZone${idx}`);
            if (!zone) return;
            if (next) {
                zone.setAttribute('role', 'group');
                zone.setAttribute('aria-labelledby', `teamZone${idx}Label`);
                if (choosing) { zone.tabIndex = 0; zone.setAttribute('aria-describedby', 'teamBuilderHint'); }
                else { zone.removeAttribute('tabindex'); zone.removeAttribute('aria-describedby'); }
            } else {
                ['tabindex', 'role', 'aria-labelledby', 'aria-describedby'].forEach(a => zone.removeAttribute(a));
            }
        });
    };
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
    const focusFirst = (...selectors) => later(() => {
        for (const selector of selectors) {
            const el = selector && screen.querySelector(selector);
            if (el && !el.disabled && el.offsetParent !== null) { el.focus({ preventScroll: false }); return; }
        }
    });
    let lastRealPress = { target: null, at: 0 };
    screen.addEventListener('pointerdown', event => {
        if (event.isTrusted) lastRealPress = { target: event.target, at: performance.now() };
    }, true);
    const recentlyPressed = el => lastRealPress.target && el.contains(lastRealPress.target) && performance.now() - lastRealPress.at < 600;
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
            focusFirst(`.team-chip[data-chip-id="${CSS.escape(id)}"]`);
        }
    });
    // Enter or Space on Home or Away places the chosen player there.
    screen.addEventListener('keydown', event => {
        if (!isNext() || (event.key !== 'Enter' && event.key !== ' ')) return;
        const zone = event.target.closest?.('.team-zone[tabindex]');
        if (!zone || event.target !== zone) return;
        event.preventDefault();
        const chip = screen.querySelector('.team-chip.selected');
        const id = chip?.dataset.chipId;
        const name = chip?.textContent.trim();
        const zoneLabel = zone.querySelector('.team-zone-label');
        if (zoneLabel) press(zoneLabel);
        const placed = id && memberNode(id);
        if (placed) say(`${name} added to ${zoneName(Number(zone.dataset.team))}`);
        else if (id) say(`${zoneName(Number(zone.dataset.team))} is full`);
        focusFirst('#teamTray .team-chip', `#${zone.id} [data-member-action="hn-remove"]`, '#teamAddName');
    });
    // Opening the builder puts focus on its heading; going back returns it to Start.
    const heading = screen.querySelector('h1');
    let wasOpen = getComputedStyle(screen).display !== 'none';
    new MutationObserver(() => {
        const open = screen.style.display !== 'none' && getComputedStyle(screen).display !== 'none';
        if (open === wasOpen) return;
        wasOpen = open;
        if (!isNext()) return;
        if (open && heading) { heading.tabIndex = -1; later(() => heading.focus()); }
        else if (!open) later(() => {
            const setup = byId('setupScreen');
            const active = document.activeElement;
            const lost = !active || active === document.body || screen.contains(active) || active.offsetParent === null;
            if (setup && setup.style.display !== 'none' && lost) byId('startGameBtn')?.focus();
        });
    }).observe(screen, { attributes: true, attributeFilter: ['style'] });
    new MutationObserver(label).observe(screen, { childList: true, subtree: true });
    document.addEventListener('homelayoutchange', label);
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
    if (title && !title.id) title.id = 'settingsModalTitle';
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
    new MutationObserver(() => {
        const open = modal.style.display !== 'none';
        if (open && !active && isNext() && setupShowing() && content) {
            active = true;
            returnTo = document.activeElement;
            content.setAttribute('role', 'dialog');
            content.setAttribute('aria-modal', 'true');
            if (title) { content.setAttribute('aria-labelledby', title.id); title.tabIndex = -1; }
            later(() => (title || focusables()[0])?.focus());
        } else if (!open && active) {
            active = false;
            content.removeAttribute('role');
            content.removeAttribute('aria-modal');
            content.removeAttribute('aria-labelledby');
            title?.removeAttribute('tabindex');
            const back = returnTo && document.contains(returnTo) && returnTo.offsetParent !== null ? returnTo : opener;
            later(() => back?.focus());
        }
    }).observe(modal, { attributes: true, attributeFilter: ['style'] });
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
            if (event.shiftKey && (document.activeElement === first || document.activeElement === title)) { event.preventDefault(); last.focus(); }
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
}

export function initHomeNext() {
    applyLayout(storedLayout());
    const run = (name, fn) => {
        try { fn(); } catch (error) { console.warn(`BlakeOut new look: ${name} skipped`, error); }
    };
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
    // The rules popover is fixed to the window: keep it next to its button
    // as the page scrolls, and close it once that button leaves the screen.
    document.addEventListener('scroll', followRulesPop, { capture: true, passive: true });
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
