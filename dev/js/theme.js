/* ============================================
   Theme picker — applies user-selected theme at
   boot and persists the choice to localStorage.

   12 themes: the 3 originals (blue / red / neon)
   plus 9 bright, bar-visible themes tuned for
   high contrast and readability at distance.
   Token blocks live in css/variables.css — add a
   theme there, list it here, done.
   ============================================ */

const STORAGE_KEY = 'blakeout_theme';

export const themeMeta = {
    blue:     { label: 'Classic',  swatch: '#0066cc' },
    red:      { label: 'Crimson',  swatch: '#cc1f3a' },
    neon:     { label: 'Neon',     swatch: '#00d4ff' },
    // Bright bar-visible themes — saturated hues on pure black for max
    // contrast, plus one light theme (Arctic) that maxes panel luminance.
    sunburst: { label: 'Sunburst', swatch: '#ffb300', bright: true },
    volt:     { label: 'Volt',     swatch: '#aaff00', bright: true },
    inferno:  { label: 'Inferno',  swatch: '#ff5500', bright: true },
    miami:    { label: 'Miami',    swatch: '#ff2ec4', bright: true },
    grape:    { label: 'Grape',    swatch: '#b44bff', bright: true },
    aqua:     { label: 'Aqua',     swatch: '#00e5c3', bright: true },
    royal:    { label: 'Royal',    swatch: '#2979ff', bright: true },
    shamrock: { label: 'Shamrock', swatch: '#00e639', bright: true },
    arctic:   { label: 'Arctic',   swatch: '#f4f7fa', bright: true, light: true }
};

const THEMES = Object.keys(themeMeta);

export function getTheme() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved && THEMES.includes(saved)) return saved;
    } catch { /* no storage — fall through */ }
    return 'blue';
}

export function listThemes() {
    return THEMES.slice();
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
                        title="${meta.label}${meta.bright ? ' — bright / bar-visible' : ''}">
                    <span class="theme-swatch-dot" style="background:${meta.swatch};"></span>
                    <span class="theme-swatch-label">${meta.label}</span>
                </button>`;
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
