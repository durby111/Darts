/* Shared presentation preference only: no scorer UI, account, or network imports.
   Keep the legacy key and Modern default so existing installations retain their
   chosen appearance across scoring, player records, and brackets. */
const STORAGE_KEY = 'blakeout_x01_skin';
const DEFAULT_SKIN = 'modern';

export const SCORE_SKINS = [
    { id: 'modern', label: 'Modern', desc: 'Themed keys, roomier pad' },
    { id: 'classic', label: 'Classic', desc: 'Original grey keypad' },
    { id: 'dc', label: 'DC Mode', desc: 'Black/red X01 + Cricket board' },
    { id: 'dot-better', label: 'Dot Better', desc: 'Charcoal panels, clear scores, full-width pad' }
];

function isScoreSkin(skin) {
    return SCORE_SKINS.some(option => option.id === skin);
}

export function getScoreSkin() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (isScoreSkin(saved)) return saved;
    } catch { /* storage unavailable: retain the ordinary default */ }
    return DEFAULT_SKIN;
}

export function saveScoreSkin(skin) {
    if (!isScoreSkin(skin)) return false;
    try { localStorage.setItem(STORAGE_KEY, skin); } catch { /* non-fatal */ }
    return true;
}

export function applyScoreAppearance(skin = getScoreSkin(), root = document.documentElement) {
    const selected = isScoreSkin(skin) ? skin : DEFAULT_SKIN;
    root.setAttribute('data-x01-skin', selected);
    root.setAttribute('data-scoreboard-mode', selected);
    return selected;
}
