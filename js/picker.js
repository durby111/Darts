/* ============================================
   Game Picker — scalable game selection UI.

   Renders from registry.js:
   - search box (label / sub / desc / tags)
   - category chips (All / Favorites / per-category)
   - favorites: star toggle on each card → localStorage
   - recents: last 4 played games as one-tap chips
   - quick start: restart the last-played setup in one tap

   The hidden <select id="gameType"> stays the single source of truth
   for the selected game — the picker only reads/writes it and fires
   'change' so every existing listener keeps working.
   ============================================ */

import { listGames, searchGames, getGame, CATEGORIES, syncSelectWithRegistry } from './registry.js';

const FAVS_KEY = 'blakeout_game_favs';
const RECENTS_KEY = 'blakeout_recent_games';
const RECENTS_MAX = 4;

let currentCategory = 'all';
let currentQuery = '';
let onQuickStart = null;   // callback provided by setup.js

// --- Persistence ---

function loadIds(key) {
    try {
        const raw = localStorage.getItem(key);
        if (raw) {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr)) return arr.filter(id => getGame(id));
        }
    } catch { }
    return [];
}

function saveIds(key, ids) {
    try { localStorage.setItem(key, JSON.stringify(ids)); } catch { }
}

export function getFavorites() { return loadIds(FAVS_KEY); }
export function getRecents() { return loadIds(RECENTS_KEY); }

export function toggleFavorite(id) {
    const favs = getFavorites();
    const idx = favs.indexOf(id);
    if (idx >= 0) favs.splice(idx, 1);
    else favs.push(id);
    saveIds(FAVS_KEY, favs);
    return favs;
}

// Called by setup.js when a match actually starts.
export function recordRecentGame(id) {
    if (!getGame(id)) return;
    const recents = getRecents().filter(r => r !== id);
    recents.unshift(id);
    saveIds(RECENTS_KEY, recents.slice(0, RECENTS_MAX));
}

// --- DOM helpers ---

function el(id) { return document.getElementById(id); }

function selectedGameId() {
    const select = el('gameType');
    return select ? select.value : '501';
}

function setSelectedGame(id) {
    const select = el('gameType');
    if (!select || select.value === id) return;
    select.value = id;
    select.dispatchEvent(new Event('change', { bubbles: true }));
}

// --- Renderers ---

function renderChips() {
    const bar = el('gameCategoryChips');
    if (!bar) return;
    const favCount = getFavorites().length;
    bar.innerHTML = CATEGORIES.map(c => {
        if (c.id === 'fav' && favCount === 0) return '';
        const active = c.id === currentCategory;
        return `<button type="button" class="picker-chip${active ? ' active' : ''}" data-category="${c.id}">${c.label}</button>`;
    }).join('');
}

function renderRecents() {
    const row = el('gameRecentsRow');
    if (!row) return;
    const recents = getRecents();
    if (recents.length === 0) {
        row.classList.add('hidden');
        row.innerHTML = '';
        return;
    }
    row.classList.remove('hidden');
    const chips = recents.map(id => {
        const g = getGame(id);
        return `<button type="button" class="picker-recent-chip" data-recent="${id}">${g.icon} ${g.label}</button>`;
    }).join('');
    row.innerHTML = `<span class="picker-recents-label">Recent:</span>${chips}` +
        `<button type="button" class="picker-recent-chip picker-quickstart" data-quickstart="1">⚡ Quick Start</button>`;
}

function renderGrid() {
    const grid = el('gameTypeGrid');
    if (!grid) return;
    const favs = getFavorites();
    const current = selectedGameId();
    const games = searchGames(currentQuery, currentCategory, favs);
    const selectedTitle = el('selectedGameTitle');
    if (selectedTitle) selectedTitle.textContent = getGame(current)?.label || current;

    if (games.length === 0) {
        grid.innerHTML = `<div class="picker-empty">No games match “${escapeHtml(currentQuery)}”.</div>`;
        return;
    }

    grid.innerHTML = games.map(g => {
        const isActive = g.id === current;
        const isFav = favs.includes(g.id);
        return `
            <div class="game-card-wrap">
                <button type="button" class="game-card${isActive ? ' active' : ''}" data-game-value="${g.id}" data-game-engine="${g.engine}" aria-pressed="${isActive}" title="${escapeHtml(g.desc || '')}">
                    <span class="game-card-icon" aria-hidden="true">${g.icon}</span>
                    <span class="game-card-label">${g.label}</span>
                    ${g.sub ? `<span class="game-card-sub">${g.sub}</span>` : ''}
                    ${g.isNew ? '<span class="game-card-new">NEW</span>' : ''}
                </button>
                <button type="button" class="game-card-fav${isFav ? ' faved' : ''}" data-fav-toggle="${g.id}"
                        aria-label="${isFav ? 'Unfavorite' : 'Favorite'} ${g.label}" title="${isFav ? 'Remove from' : 'Add to'} favorites">★</button>
                <button type="button" class="game-card-info" data-rules-toggle="${g.id}"
                        aria-label="How to play ${g.label}" title="How to play">ⓘ</button>
            </div>`;
    }).join('');

    const descEl = el('gameDescription');
    if (descEl) {
        const meta = getGame(current);
        descEl.textContent = meta ? meta.desc : '';
    }
}

// --- Rules tooltip (ⓘ badge on every card) ---

function hideRulesPop() {
    const pop = document.getElementById('gameRulesPop');
    if (pop) pop.remove();
}

function showRulesPop(gameId, anchorBtn) {
    hideRulesPop();
    const meta = getGame(gameId);
    if (!meta) return;
    const pop = document.createElement('div');
    pop.id = 'gameRulesPop';
    pop.className = 'game-rules-pop';
    pop.dataset.gameId = gameId;
    pop.innerHTML = `<strong>${escapeHtml(meta.icon + ' ' + meta.label)}</strong>` +
        `<span>${escapeHtml(meta.rules || meta.desc || '')}</span>`;
    // The grid scrolls inside its panel, so an absolutely-positioned popover
    // would be clipped by the scroll container. Anchor it to the viewport
    // instead and clamp it inside the window.
    document.body.appendChild(pop);
    const anchor = anchorBtn.getBoundingClientRect();
    const box = pop.getBoundingClientRect();
    const margin = 8;
    let left = anchor.left + anchor.width / 2 - box.width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - box.width - margin));
    let top = anchor.bottom + 6;
    if (top + box.height > window.innerHeight - margin) {
        top = Math.max(margin, anchor.top - box.height - 6);
    }
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
}

export function refreshPicker() {
    renderChips();
    renderRecents();
    renderGrid();
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

// --- Init ---

export function initGamePicker(quickStartFn) {
    onQuickStart = quickStartFn || null;
    syncSelectWithRegistry(el('gameType'));

    // Search
    const search = el('gameSearchInput');
    if (search) {
        search.addEventListener('input', () => {
            currentQuery = search.value;
            renderGrid();
        });
    }

    // Category chips
    const chips = el('gameCategoryChips');
    if (chips) {
        chips.addEventListener('click', e => {
            const btn = e.target.closest('[data-category]');
            if (!btn) return;
            currentCategory = btn.dataset.category;
            renderChips();
            renderGrid();
        });
    }

    // Recents + quick start
    const recentsRow = el('gameRecentsRow');
    if (recentsRow) {
        recentsRow.addEventListener('click', e => {
            const quick = e.target.closest('[data-quickstart]');
            if (quick) {
                if (onQuickStart) onQuickStart();
                return;
            }
            const btn = e.target.closest('[data-recent]');
            if (!btn) return;
            setSelectedGame(btn.dataset.recent);
            refreshPicker();
        });
    }

    // Grid: card select + favorite star + rules ⓘ
    const grid = el('gameTypeGrid');
    if (grid) {
        let rulesScrollTop = 0;
        grid.addEventListener('click', e => {
            const info = e.target.closest('[data-rules-toggle]');
            if (info) {
                const already = document.getElementById('gameRulesPop');
                const sameCard = already && already.dataset.gameId === info.dataset.rulesToggle;
                if (sameCard) { hideRulesPop(); return; }
                rulesScrollTop = grid.scrollTop;
                showRulesPop(info.dataset.rulesToggle, info);
                return;
            }
            hideRulesPop();
            const fav = e.target.closest('[data-fav-toggle]');
            if (fav) {
                toggleFavorite(fav.dataset.favToggle);
                // If we're viewing Favorites and just removed the last one,
                // fall back to All so the grid doesn't strand the user.
                if (currentCategory === 'fav' && getFavorites().length === 0) currentCategory = 'all';
                refreshPicker();
                return;
            }
            const card = e.target.closest('[data-game-value]');
            if (!card) return;
            setSelectedGame(card.dataset.gameValue);
            renderGrid();
        });
        // Scrolling the grid would leave the popover floating over the
        // wrong card, so drop it.
        grid.addEventListener('scroll', () => {
            if (grid.scrollTop !== rulesScrollTop) hideRulesPop();
        }, { passive: true });
    }

    // Keep the active card in sync if something else changes the select
    // (config load, applyConfig, etc.).
    const select = el('gameType');
    if (select) select.addEventListener('change', renderGrid);

    // Tapping anywhere outside the grid (or the popover itself) closes an
    // open rules popover.
    document.addEventListener('click', e => {
        if (!e.target.closest('#gameTypeGrid') && !e.target.closest('#gameRulesPop')) hideRulesPop();
    });

    refreshPicker();
}
