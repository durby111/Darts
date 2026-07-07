/* ============================================
   Unified Settings (a5 / a3 / a8)

   One modal, opened from BOTH the setup screen (gear button in the
   header) and in-game (Game Menu → Visual Settings). Contains:
     - Theme picker (moved off the setup screen)
     - Wallpaper: bundled presets, Default photo, None, or user upload
     - UI Scale

   Wallpaper persistence: localStorage 'blakeout_wallpaper'
     { type: 'default' } | { type: 'none' } |
     { type: 'preset', id } | { type: 'custom', dataUrl }
   Applied as the --app-wallpaper CSS var consumed by .setup-screen.
   Uploads are downscaled through a canvas (max 1600px, JPEG q0.8) so a
   phone photo doesn't blow the localStorage quota.
   ============================================ */

import { showModal, hideModal } from './ui.js';

const WALLPAPER_KEY = 'blakeout_wallpaper';

export const WALLPAPER_PRESETS = [
    { id: 'slate', label: 'Slate' },
    { id: 'felt', label: 'Felt' },
    { id: 'wood', label: 'Wood' },
    { id: 'carbon', label: 'Carbon' }
];

function el(id) { return document.getElementById(id); }

// --- Wallpaper state ---

function getWallpaper() {
    try {
        const raw = localStorage.getItem(WALLPAPER_KEY);
        if (raw) return JSON.parse(raw);
    } catch { /* fall through */ }
    return { type: 'default' };
}

function saveWallpaper(wp) {
    try {
        localStorage.setItem(WALLPAPER_KEY, JSON.stringify(wp));
        return true;
    } catch {
        // QuotaExceeded — usually a too-large custom image.
        alert('Could not save the wallpaper — the image may be too large for this device.');
        return false;
    }
}

export function applyWallpaper(wp = getWallpaper()) {
    const root = document.documentElement;
    if (!wp || wp.type === 'default') {
        root.style.removeProperty('--app-wallpaper');
    } else if (wp.type === 'none') {
        root.style.setProperty('--app-wallpaper', 'none');
    } else if (wp.type === 'preset') {
        root.style.setProperty('--app-wallpaper', `url('assets/wallpapers/${wp.id}.svg')`);
    } else if (wp.type === 'custom' && wp.dataUrl) {
        root.style.setProperty('--app-wallpaper', `url('${wp.dataUrl}')`);
    }
    renderWallpaperChoices();
}

// --- Upload handling ---

function handleUpload(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
        const img = new Image();
        img.onload = () => {
            const MAX = 1600;
            let { width, height } = img;
            if (width > MAX || height > MAX) {
                const k = MAX / Math.max(width, height);
                width = Math.round(width * k);
                height = Math.round(height * k);
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
            const wp = { type: 'custom', dataUrl };
            if (saveWallpaper(wp)) applyWallpaper(wp);
        };
        img.src = reader.result;
    };
    reader.readAsDataURL(file);
}

// --- Choice grid ---

function renderWallpaperChoices() {
    const grid = el('wallpaperChoices');
    if (!grid) return;
    const current = getWallpaper();
    const isActive = (type, id) =>
        current.type === type && (type !== 'preset' || current.id === id);

    const choices = [
        { type: 'default', label: 'Default', style: "background-image:url('assets/background.png');background-size:cover;" },
        { type: 'none', label: 'None', style: 'background:var(--color-bg);' },
        ...WALLPAPER_PRESETS.map(p => ({
            type: 'preset', id: p.id, label: p.label,
            style: `background-image:url('assets/wallpapers/${p.id}.svg');background-size:cover;`
        }))
    ];
    if (current.type === 'custom') {
        choices.push({
            type: 'custom', label: 'Yours',
            style: `background-image:url('${current.dataUrl}');background-size:cover;`
        });
    }

    grid.innerHTML = choices.map(c => `
        <button type="button" class="wallpaper-choice${isActive(c.type, c.id) ? ' active' : ''}"
                data-wallpaper-type="${c.type}"${c.id ? ` data-wallpaper-id="${c.id}"` : ''}
                aria-label="${c.label} wallpaper">
            <span class="wallpaper-thumb" style="${c.style}"></span>
            <span class="wallpaper-label">${c.label}</span>
        </button>`).join('');
}

// --- Modal open/close ---

export function openSettingsModal() {
    renderWallpaperChoices();
    showModal('settingsModal');
}

// --- Init ---

export function initSettings() {
    applyWallpaper();

    const setupBtn = el('settingsBtnSetup');
    if (setupBtn) setupBtn.addEventListener('click', openSettingsModal);

    const gameMenuBtn = el('gameMenuVisualBtn');
    if (gameMenuBtn) gameMenuBtn.addEventListener('click', () => {
        const menu = el('gameMenuModal');
        if (menu) menu.style.display = 'none';
        openSettingsModal();
    });

    const closeBtn = el('settingsCloseBtn');
    if (closeBtn) closeBtn.addEventListener('click', () => hideModal('settingsModal'));

    const grid = el('wallpaperChoices');
    if (grid) {
        grid.addEventListener('click', e => {
            const btn = e.target.closest('[data-wallpaper-type]');
            if (!btn) return;
            const type = btn.dataset.wallpaperType;
            if (type === 'custom') return;           // already applied
            const wp = type === 'preset'
                ? { type, id: btn.dataset.wallpaperId }
                : { type };
            if (saveWallpaper(wp)) applyWallpaper(wp);
        });
    }

    const upload = el('wallpaperUpload');
    if (upload) {
        upload.addEventListener('change', () => {
            handleUpload(upload.files && upload.files[0]);
            upload.value = '';
        });
    }
}
