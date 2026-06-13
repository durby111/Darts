/* ============================================
   Theme picker — applies user-selected theme at
   boot and persists the choice to localStorage.
   Three themes are wired today: blue / red / neon.
   ============================================ */

const THEMES = ['blue', 'red', 'neon'];
const STORAGE_KEY = 'blakeout_theme';

export const themeMeta = {
    blue: { label: 'Classic', swatch: '#0066cc' },
    red:  { label: 'Crimson', swatch: '#cc1f3a' },
    neon: { label: 'Neon',    swatch: '#00d4ff' }
};

export function getTheme() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved && THEMES.includes(saved)) return saved;
    } catch { /* no storage — fall through */ }
    return 'blue';
}

export function applyTheme(theme) {
    if (!THEMES.includes(theme)) theme = 'blue';
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(STORAGE_KEY, theme); } catch {}
    document.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
}

// Apply at module load so the painted UI matches the saved theme on first
// render. theme.js is imported up-front from app.js for this side effect.
applyTheme(getTheme());

export function initThemePickerUI() {
    const container = document.getElementById('themePicker');
    if (!container) return;

    function render() {
        const current = getTheme();
        container.innerHTML = THEMES.map(t => {
            const meta = themeMeta[t];
            return `
                <button class="theme-swatch${t === current ? ' active' : ''}"
                        data-theme-choice="${t}"
                        aria-label="${meta.label} theme"
                        title="${meta.label}">
                    <span class="theme-swatch-dot" style="background:${meta.swatch};"></span>
                    <span class="theme-swatch-label">${meta.label}</span>
                </button>
            `;
        }).join('');
    }
    render();

    container.addEventListener('click', e => {
        const btn = e.target.closest('[data-theme-choice]');
        if (!btn) return;
        applyTheme(btn.dataset.themeChoice);
        render();
    });
}
