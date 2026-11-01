/* ============================================
   Recent player names (setup screen suggestions)

   Scope: this browser on this device only. Names are plain display text
   kept in localStorage under a build-scoped key, so DEV and production never
   share a list. Nothing here is synced, linked to an account, or used to
   sign anyone in: choosing a suggestion only fills the name field.
   ============================================ */

import { IS_DEV_BUILD } from './build-context.js';

export const RECENT_NAMES_KEY = IS_DEV_BUILD ? 'blakeout_dev_recent_player_names' : 'blakeout_recent_player_names';
export const RECENT_NAMES_MAX = 12;
const NAME_MAX_LENGTH = 40;

// Slot defaults are placeholders, not names worth suggesting back.
const DEFAULT_NAME = /^(home|away|player\s*\d+|botblake(\s*\d+)?)$/i;

export function isDefaultPlayerName(name) {
    return DEFAULT_NAME.test(String(name || '').trim());
}

function clean(name) {
    return String(name || '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX_LENGTH);
}

export function getRecentNames(storage) {
    try {
        storage ??= globalThis.localStorage;
        const parsed = JSON.parse(storage?.getItem(RECENT_NAMES_KEY) || '[]');
        return Array.isArray(parsed) ? parsed.map(clean).filter(Boolean).slice(0, RECENT_NAMES_MAX) : [];
    } catch {
        return [];
    }
}

/** Move these names to the front of the list (newest first, case-insensitive de-dupe). */
export function rememberNames(names, storage) {
    const fresh = names.map(clean).filter(name => name && !isDefaultPlayerName(name));
    if (!fresh.length) return getRecentNames(storage);
    const seen = new Set();
    const merged = [...fresh, ...getRecentNames(storage)].filter(name => {
        const key = name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    }).slice(0, RECENT_NAMES_MAX);
    try { (storage ?? globalThis.localStorage)?.setItem(RECENT_NAMES_KEY, JSON.stringify(merged)); } catch { /* storage full or blocked */ }
    return merged;
}

export function clearRecentNames(storage) {
    try {
        storage ??= globalThis.localStorage;
        if (!storage) return false;
        storage.removeItem(RECENT_NAMES_KEY);
        return storage.getItem(RECENT_NAMES_KEY) === null;
    } catch { return false; }
}

/**
 * Suggestions for one name field. Prefix matches rank ahead of word-start
 * matches; names already used in another slot are left out. An empty query
 * returns the most recent names so a tap on an empty field still helps.
 */
export function suggestNames(query, pool, { exclude = [], limit = 4 } = {}) {
    const q = clean(query).toLowerCase();
    const taken = new Set(exclude.map(name => clean(name).toLowerCase()).filter(Boolean));
    const seen = new Set();
    const ranked = [];
    pool.map(clean).filter(Boolean).forEach((name, order) => {
        const key = name.toLowerCase();
        if (seen.has(key) || taken.has(key) || key === q) return;
        seen.add(key);
        let rank;
        if (!q) rank = 0;
        else if (key.startsWith(q)) rank = 0;
        else if (key.split(' ').some(word => word.startsWith(q))) rank = 1;
        else return;
        ranked.push({ name, rank, order });
    });
    return ranked.sort((a, b) => a.rank - b.rank || a.order - b.order).slice(0, limit).map(item => item.name);
}
