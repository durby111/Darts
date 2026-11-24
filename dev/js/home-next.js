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
    const count = document.getElementById('numPlayers');
    if (count) {
        if (layout === 'next') { count.tabIndex = -1; count.setAttribute('aria-hidden', 'true'); }
        else { count.removeAttribute('tabindex'); count.removeAttribute('aria-hidden'); }
    }
    document.querySelectorAll('input[name="homeLayoutChoice"]').forEach(input => {
        input.checked = input.value === layout;
    });
    document.dispatchEvent(new CustomEvent('homelayoutchange', { detail: { layout } }));
    return layout;
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
    if (visible(byId('finishTypeOptions')) && finish?.selectedOptions?.[0]) {
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
    const update = () => { summary.textContent = summaryText(); };
    document.addEventListener('change', () => later(update), true);
    update();
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
    if (!button) { pop.remove(); return; }
    const anchor = button.getBoundingClientRect();
    if (anchor.bottom < 0 || anchor.top > window.innerHeight || !anchor.width) { pop.remove(); return; }
    const box = pop.getBoundingClientRect();
    const margin = 8;
    let left = anchor.left + anchor.width / 2 - box.width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - box.width - margin));
    let top = anchor.bottom + 6;
    if (top + box.height > window.innerHeight - margin) top = Math.max(margin, anchor.top - box.height - 6);
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
    run('layoutChoice', mountLayoutChoice);
    // The game list no longer scrolls inside its own box, so keep an open
    // rules popover (fixed to the window) next to its button as the page
    // scrolls, and close it once that button leaves the screen.
    document.addEventListener('scroll', followRulesPop, { capture: true, passive: true });
    window.addEventListener('storage', event => {
        if (event.key === HOME_LAYOUT_KEY || event.key === null) applyLayout(storedLayout());
    });
}

export { isNext };
