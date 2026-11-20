// DEV-only menu preference. Independent of game/scoreboard appearance and data.
export const MENU_STYLE_KEY = 'blakeout_dev_menu_style_v1';
const labels = new Map([['current', 'Current']]);
const allowed = new Set(['astra62', 'fable52', 'neon']);
const pickers = [];
let selected = 'current';
let initialized = false;
function stored() {
    try { return localStorage.getItem(MENU_STYLE_KEY) || 'current'; } catch { return 'current'; }
}
function apply(value) {
    selected = labels.has(value) ? value : 'current';
    if (selected === 'current') delete document.documentElement.dataset.menuStyle;
    else document.documentElement.dataset.menuStyle = selected;
    for (const { select } of pickers) select.value = selected;
}
// Register ONLY after a genuine variant's stylesheet is included in the build.
// Safe before or after init; unknown/missing styles never become selectable.
export function registerMenuStyle(id, label) {
    if (!allowed.has(id) || typeof label !== 'string' || !label.trim()) throw Error('Invalid menu style');
    labels.set(id, label);
    for (const { select } of pickers) options(select);
    if (initialized) apply(stored());
}
function options(select) {
    select.replaceChildren(...[...labels].map(([value, label]) => new Option(label, value)));
    select.value = selected;
}
export function initMenuStyles() {
    if (initialized) return;
    initialized = true;
    for (const id of ['gameMenuModal', 'settingsModal']) {
        const host = document.querySelector(`#${id} .modal-content`);
        if (!host) continue;
        const section = document.createElement('section');
        section.className = 'menu-style-picker';
        const label = document.createElement('label');
        const select = document.createElement('select');
        select.id = `${id}MenuStyle`;
        label.htmlFor = select.id;
        label.textContent = 'Menu Style';
        const note = document.createElement('p');
        note.textContent = 'Menu and Customize only. Game styles stay unchanged.';
        const status = document.createElement('p');
        status.setAttribute('role', 'status');
        options(select);
        select.addEventListener('change', () => {
            apply(select.value);
            let saved = true;
            try { localStorage.setItem(MENU_STYLE_KEY, selected); } catch { saved = false; }
            for (const picker of pickers) picker.status.textContent = saved ? '' : 'Applied for this visit only; browser storage is unavailable.';
        });
        section.append(label, select, note, status);
        host.append(section);
        pickers.push({ select, status });
        // platform-nav.js can execute after app initialization; preserve its
        // anchors/buttons and order while keeping this escape hatch last.
        new MutationObserver(() => {
            if (host.lastElementChild !== section) host.append(section);
        }).observe(host, { childList: true });
    }
    apply(stored());
    window.addEventListener('storage', event => {
        if (event.key === MENU_STYLE_KEY || event.key === null) apply(stored());
    });
}
