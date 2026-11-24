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
    describeStart(layout);
    syncRulesExpanded();
    document.querySelectorAll('input[name="homeLayoutChoice"]').forEach(input => {
        input.checked = input.value === layout;
    });
    document.dispatchEvent(new CustomEvent('homelayoutchange', { detail: { layout } }));
    return layout;
}

// Keep keyboard order matching what is on screen. In the New look,
// "Players on this device" sits just above Start and App Maintenance comes
// after the roster. Classic gets the original order back.
function placeSections(layout) {
    const help = document.querySelector('#setupScreen .home-player-help');
    const play = document.getElementById('playSection');
    const roster = document.getElementById('rosterSection');
    const maintenance = document.getElementById('maintenanceSection');
    if (layout === 'next') {
        if (help && play && play.previousElementSibling !== help) play.before(help);
        if (maintenance && roster && roster.nextElementSibling !== maintenance) roster.after(maintenance);
    } else {
        const header = document.querySelector('#setupScreen .setup-header');
        if (help && header && header.nextElementSibling !== help) header.after(help);
        if (maintenance && play && play.nextElementSibling !== maintenance) play.after(maintenance);
    }
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
    const update = () => { summary.textContent = summaryText(); };
    document.addEventListener('change', () => later(update), true);
    update();
}

// --- Resume button: centre a label that fits on one line -------------------

function mountResumeFit() {
    const button = byId('resumeGameBtn');
    if (!button) return;
    const fit = () => {
        button.classList.remove('hn-one-line');
        if (!isNext() || button.classList.contains('hidden')) return;
        const style = getComputedStyle(button);
        const line = parseFloat(style.lineHeight) || 20;
        const pad = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
        if (button.scrollHeight - pad <= line * 1.5) button.classList.add('hn-one-line');
    };
    new MutationObserver(() => later(fit)).observe(button, { childList: true, characterData: true, subtree: true });
    if (window.ResizeObserver) new ResizeObserver(() => fit()).observe(button.parentElement);
    document.addEventListener('homelayoutchange', () => later(fit));
    fit();
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

function followRulesPop() {
    const pop = byId('gameRulesPop');
    if (!pop || !isNext()) return;
    const id = pop.dataset.gameId;
    const button = id && [...document.querySelectorAll('[data-rules-toggle]')]
        .find(el => el.dataset.rulesToggle === id);
    const close = () => { pop.remove(); syncRulesExpanded(); };
    if (!button) { close(); return; }
    const anchor = button.getBoundingClientRect();
    // Close once the button is partly hidden, by the page or the game list.
    const list = byId('gameTypeGrid')?.getBoundingClientRect();
    const visTop = Math.max(0, list ? list.top : 0) - 2;
    const visBottom = Math.min(window.innerHeight, list ? list.bottom : window.innerHeight) + 2;
    if (!anchor.width || anchor.top < visTop || anchor.bottom > visBottom) { close(); return; }
    const box = pop.getBoundingClientRect();
    const margin = 8;
    let left = anchor.left + anchor.width / 2 - box.width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - box.width - margin));
    // Keep clear of the docked Start bar on phones.
    const bar = byId('playSection');
    const barTop = bar && getComputedStyle(bar).position === 'fixed' ? bar.getBoundingClientRect().top : window.innerHeight;
    const floor = Math.min(window.innerHeight, barTop) - margin;
    let top = anchor.bottom + 6;
    if (top + box.height > floor) top = Math.max(margin, anchor.top - box.height - 6);
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
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
    run('resumeFit', mountResumeFit);
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
